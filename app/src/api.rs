//! The local print API (plan phase 8): the same job pipeline the UI
//! drives, over HTTP on this PC. A till, a script or a web page on the
//! same machine prints without touching the app.
//!
//! Local by default: the listener binds `127.0.0.1` only, so nothing
//! off this PC can reach it. LAN exposure with per-device pairing and
//! device tokens is a later increment of the same phase.
//!
//! A job is accepted with `POST /v1/print` — a saved template by
//! name, a printer, the data, the copies, and a transport (or the
//! saved default for the printer) — and starts running at once, the
//! same pipeline the print screen runs. `GET /v1/jobs` and `GET
//! /v1/jobs/{id}` say where the job stands and what it came out to,
//! `DELETE /v1/jobs/{id}` cancels a job that has not started, and
//! `POST /v1/jobs/{id}/retry` re-runs a finished one. A request may
//! carry an `Idempotency-Key` header: a retried request with the same
//! key comes back the same job — 409, the original id, nothing new
//! printed.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use pn_job::JobResult;
use pn_profiles::ProfileSet;
use pn_scene::{Records, Template};
use serde::{Deserialize, Serialize};

use crate::pipeline::{
    factory, prepare_units, print_units, profile_infos, report_of, with_delivery_overrides,
    JobReport, Transport,
};
use crate::store::{ApiJob, Store};

/// The port the API listens on — the same one the app it replaces used.
pub const DEFAULT_PORT: u16 = 17717;

/// How many copies one job may ask for.
pub const MAX_COPIES: u32 = 1000;

/// How many accepted jobs `GET /v1/jobs` reports.
const JOB_LIST_LIMIT: usize = 50;

/// What the API's handlers can reach: the loaded profiles and the
/// local store, shared with the Tauri commands that run the same
/// pipeline.
#[derive(Clone)]
pub struct ApiState {
    pub profiles: Arc<ProfileSet>,
    pub store: Arc<Store>,
}

/// The router, held apart from the socket so the endpoints can be
/// tested without binding a port.
pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/printers", get(list_printers))
        .route("/v1/templates", get(list_templates))
        .route("/v1/print", post(print))
        .route("/v1/jobs", get(list_jobs))
        .route("/v1/jobs/{id}", get(get_job).delete(cancel_job))
        .route("/v1/jobs/{id}/retry", post(retry_job))
        .with_state(state)
}

/// Listen on 127.0.0.1. When the port is taken the app keeps running —
/// the failure is named, nothing else changes.
pub async fn serve(state: ApiState) {
    let addr: SocketAddr = ([127, 0, 0, 1], DEFAULT_PORT).into();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("the local print API could not bind {addr}: {e}");
            return;
        }
    };
    eprintln!("the local print API is listening on http://{addr}");
    if let Err(e) = axum::serve(listener, router(state)).await {
        eprintln!("the local print API stopped: {e}");
    }
}

/// Alive, and whether the store is with it.
async fn health(State(state): State<ApiState>) -> Json<serde_json::Value> {
    let db_ok = state.store.load_settings().is_ok();
    Json(serde_json::json!({
        "status": if db_ok { "ok" } else { "degraded" },
    }))
}

/// The printers the app can print to — the profile set, as the UI
/// shows it.
async fn list_printers(State(state): State<ApiState>) -> Json<serde_json::Value> {
    let printers = profile_infos(&state.profiles);
    Json(serde_json::json!({
        "printers": printers,
        "count": printers.len(),
    }))
}

/// One saved template, as the API lists it: the identity, not the
/// body (a print request names the template and brings the data).
#[derive(Debug, Serialize)]
struct TemplateListItem {
    id: String,
    name: String,
    description: String,
    track: String,
}

/// The saved templates, by name and id.
async fn list_templates(
    State(state): State<ApiState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let rows = state.store.load_templates().map_err(|e| store_error(&e))?;
    let templates: Vec<TemplateListItem> = rows
        .iter()
        .map(|t| TemplateListItem {
            id: t.id.clone(),
            name: t.name.clone(),
            description: t.description.clone(),
            track: t.track.clone(),
        })
        .collect();
    Ok(Json(serde_json::json!({
        "templates": templates,
        "count": templates.len(),
    })))
}

/// A print request: a saved template by name (or id), a printer by
/// model (or alias), the data, and where the job goes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintRequest {
    template: String,
    printer: String,
    /// The data as JSON — a record, or a list of them — or a string
    /// holding JSON or CSV text.
    data: serde_json::Value,
    /// One copy when left out.
    copies: Option<u32>,
    /// The printer's transport; when left out, the saved default for
    /// the printer (the setting `transport.<model>`) is used.
    transport: Option<Transport>,
}

/// Accept a job and start it running. The job is queued at once — the
/// answer is the job's id, not the print result; `GET /v1/jobs/{id}`
/// carries that. A retried request with the same `Idempotency-Key`
/// header comes back the same job: 409, the original id, nothing new
/// printed.
async fn print(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(req): Json<PrintRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let key = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string);

    let rows = state.store.load_templates().map_err(|e| store_error(&e))?;
    let row = rows
        .iter()
        .find(|t| t.name == req.template || t.id == req.template)
        .ok_or_else(|| bad(&format!("no saved template named \"{}\"", req.template)))?;

    let profile = state
        .profiles
        .find(&req.printer)
        .ok_or_else(|| bad(&format!("no printer named \"{}\"", req.printer)))?;
    let model = profile.profile.model.clone();

    let copies = req.copies.unwrap_or(1).max(1);
    if copies > MAX_COPIES {
        return Err(bad(&format!(
            "copies is {copies}; the most is {MAX_COPIES}"
        )));
    }

    let settings = state.store.load_settings().map_err(|e| store_error(&e))?;
    let transport = resolve_transport(req.transport, &model, &settings)?;
    let transport_json = serde_json::to_string(&transport).map_err(|e| bad(&e.to_string()))?;

    // The data as the pipeline takes it: a string is JSON or CSV text,
    // anything else is compact JSON.
    let data = match &req.data {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    let job = ApiJob {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: key,
        template_name: row.name.clone(),
        template: row.template.clone(),
        track: row.track.clone(),
        profile: model,
        data,
        copies,
        transport: transport_json,
        status: "queued".into(),
        result: None,
        created_at: now_ms(),
        finished_at: None,
    };
    // When the key is already held, the store hands back the original
    // job's id: the caller retries against that job, so it never
    // prints twice.
    let id = state
        .store
        .insert_api_job(&job)
        .map_err(|e| store_error(&e))?;
    if id != job.id {
        return Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "status": "duplicate", "jobId": id })),
        ));
    }
    tauri::async_runtime::spawn(run_api_job(state, id.clone()));
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "jobId": id, "status": "queued" })),
    ))
}

/// The transport a job goes out on: the one the request named, or the
/// saved default for the printer.
fn resolve_transport(
    named: Option<Transport>,
    model: &str,
    settings: &BTreeMap<String, String>,
) -> Result<Transport, (StatusCode, Json<serde_json::Value>)> {
    if let Some(t) = named {
        return Ok(t);
    }
    let raw = settings.get(&format!("transport.{model}")).ok_or_else(|| {
        bad(&format!(
            "no transport: name one in the request, or save a default for {model} as the setting \"transport.{model}\""
        ))
    })?;
    serde_json::from_str(raw).map_err(|e| {
        bad(&format!(
            "the saved default transport for {model} does not parse: {e}"
        ))
    })
}

/// The accepted jobs, newest first.
async fn list_jobs(
    State(state): State<ApiState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let jobs = state
        .store
        .list_api_jobs(JOB_LIST_LIMIT)
        .map_err(|e| store_error(&e))?;
    Ok(Json(
        serde_json::json!({ "jobs": jobs, "count": jobs.len() }),
    ))
}

/// One accepted job, by id.
async fn get_job(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.store.api_job(&id).map_err(|e| store_error(&e))? {
        Some(job) => Ok(Json(serde_json::json!({ "job": job }))),
        None => Err(not_found_job(&id)),
    }
}

/// Cancel a job that has not started. A job that already prints, is
/// done, or is already cancelled is not touched — the answer says why.
async fn cancel_job(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(job) = state.store.api_job(&id).map_err(|e| store_error(&e))? else {
        return Err(not_found_job(&id));
    };
    let cancelled = state
        .store
        .cancel_queued_job(&id)
        .map_err(|e| store_error(&e))?;
    if !cancelled {
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": format!("the job is {} and cannot be cancelled", job.status)
            })),
        ));
    }
    Ok(Json(
        serde_json::json!({ "jobId": id, "status": "cancelled" }),
    ))
}

/// Re-run a finished job — done or cancelled: the same row, the same
/// frozen request. A job still in flight is not re-queued.
async fn retry_job(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let Some(job) = state.store.api_job(&id).map_err(|e| store_error(&e))? else {
        return Err(not_found_job(&id));
    };
    let queued = state
        .store
        .retry_finished_job(&id)
        .map_err(|e| store_error(&e))?;
    if !queued {
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": format!("the job is {} and is still in flight", job.status)
            })),
        ));
    }
    tauri::async_runtime::spawn(run_api_job(state, id.clone()));
    Ok(Json(serde_json::json!({ "jobId": id, "status": "queued" })))
}

/// Run one accepted job to the end: the same pipeline the UI drives —
/// prepare the units, deliver them over the job's transport, and leave
/// the honest report on the row.
async fn run_api_job(state: ApiState, id: String) {
    // A cancel may have beaten the job to the wire; only one runner
    // can win the queued-to-running move.
    let Ok(Some(job)) = state.store.api_job(&id) else {
        return;
    };
    if job.status != "queued" || state.store.start_queued_job(&id).ok() != Some(true) {
        return;
    }
    let job_state = state.clone();
    let report =
        tauri::async_runtime::spawn_blocking(move || run_api_job_blocking(&job_state, &job))
            .await
            .unwrap_or_else(|e| failed(&e.to_string()));
    let text = serde_json::to_string(&report).expect("a job report serializes");
    let _ = state.store.finish_api_job(&id, &text, now_ms());
}

/// The pipeline for one job: the frozen row is the whole request, so
/// this is the print screen's path with the same inputs.
fn run_api_job_blocking(state: &ApiState, job: &ApiJob) -> JobReport {
    let Ok(transport) = serde_json::from_str::<Transport>(&job.transport) else {
        return failed("the job's transport does not parse");
    };
    let Ok(template) = Template::from_json(&job.template) else {
        return failed("the job's template does not parse");
    };
    let Some(profile) = state.profiles.find(&job.profile) else {
        return failed(&format!("no printer named \"{}\" anymore", job.profile));
    };
    let settings = state.store.load_settings().unwrap_or_default();
    let profile = with_delivery_overrides(profile, &settings);
    let records = match Records::from_text(&job.data) {
        Ok(records) => records,
        Err(e) => return failed(&e.to_string()),
    };
    let units = match prepare_units(&template, &profile, &records, job.copies) {
        Ok(units) => units,
        Err(e) => return failed(&e.to_string()),
    };
    let factory = factory(&transport, units.document_format);
    let result: JobResult = print_units(&units.spec, &profile, factory);
    report_of(result)
}

/// A job that cannot even be prepared: the plan's vocabulary says
/// "failed", in the app's own words.
fn failed(reason: &str) -> JobReport {
    JobReport {
        result: "failed".into(),
        counts: None,
        reason: Some(reason.to_string()),
    }
}

/// Now, as `Date.now()` milliseconds.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The caller's request does not hold together: 400, in plain words.
fn bad(e: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": e })),
    )
}

fn not_found_job(id: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": format!("no job named \"{id}\"") })),
    )
}

/// A store failure is the app's problem, not the caller's: 500, in
/// plain words.
fn store_error(e: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": e })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{method::Method, Request};
    use std::io::{Read, Write};
    use std::thread::{self, JoinHandle};
    use tower::ServiceExt;

    /// The state the read endpoints are tested on: the shipped profile
    /// set and an in-memory store.
    fn state() -> ApiState {
        let profiles = Arc::new(
            pn_profiles::load_dir(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../core/profiles/profiles"
            ))
            .expect("the shipped profile set must load in the test"),
        );
        let store = Arc::new(Store::in_memory().expect("an in-memory store must open"));
        ApiState { profiles, store }
    }

    /// The fake ZPL label printer with a status dialect — the same
    /// shape the pipeline's live-print tests use, so a job can end
    /// `confirmed`.
    const FAKE_ZPL: &str = r#"
[profile]
model = "Fake Label"
language = "zpl"
mode = "zpl"
media = ["label"]
dpi = 203
head_width_dots = 384
printable_width_mm = 48
[fonts]
native = ["0"]
code_pages = ["437"]
[barcodes]
native = ["CODE128"]
[delivery]
chunk_bytes = 512
pause_ms = 10
close_delay_ms = 0
keep_open_for_status = true
[status]
query = "~HS"
expected_prefix = "\u0002"
poll_after_ms = 200
"#;

    /// A 40 × 50 mm label with one bound field, as JSON text.
    fn label_template_json() -> String {
        let template = Template {
            format: Default::default(),
            html: None,
            media: pn_scene::Media::Label {
                width_mm: 40.0,
                height_mm: 50.0,
            },
            fields: vec![pn_scene::Field {
                name: "name".into(),
                kind: Default::default(),
            }],
            elements: vec![pn_scene::Element::Text {
                at: pn_scene::At {
                    x_mm: 2.0,
                    y_mm: 2.0,
                },
                size: pn_scene::Size {
                    w_mm: 36.0,
                    h_mm: 4.0,
                },
                content: "{{name}}".into(),
                style: pn_scene::TextStyle {
                    size_mm: 3.0,
                    font: None,
                    bold: false,
                    italic: false,
                    align: Default::default(),
                },
                page: Default::default(),
            }],
        };
        serde_json::to_string(&template).expect("the template serializes")
    }

    /// A state whose profile set is the single fake ZPL printer, with
    /// one saved label template. The profiles live in memory once
    /// loaded, so the throwaway directory goes away at once.
    fn state_with_label_template() -> ApiState {
        let dir =
            std::env::temp_dir().join(format!("pn-next-fake-profiles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("the temp dir must be made");
        std::fs::write(dir.join("fake-label.toml"), FAKE_ZPL)
            .expect("the fake profile must be written");
        let profiles = pn_profiles::load_dir(&dir).expect("the fake profile set must load");
        let _ = std::fs::remove_dir_all(&dir);

        let store = Arc::new(Store::in_memory().expect("an in-memory store must open"));
        store
            .save_template(&crate::store::StoredTemplate {
                id: "t1".into(),
                name: "Labels".into(),
                description: "part labels".into(),
                track: "scene".into(),
                template: label_template_json(),
                sample: "[]".into(),
            })
            .expect("the template must be saved");
        ApiState {
            profiles: Arc::new(profiles),
            store,
        }
    }

    /// A fake raw printer: a TCP listener that answers the status
    /// query and records every byte it was sent.
    struct FakePrinter {
        port: u16,
        got: Arc<std::sync::Mutex<Vec<u8>>>,
        handle: Option<JoinHandle<()>>,
    }

    impl Drop for FakePrinter {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    impl FakePrinter {
        fn spawn(status_ok: bool) -> Self {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let got = Arc::new(std::sync::Mutex::new(Vec::new()));
            let log = got.clone();
            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let ready = b"\x02030,0,0,1234,000,0,0,0,000,0,0,0\x03\r\n";
                let fault = b"\x02030,1,0,1234,000,0,0,0,000,0,0,0\x03\r\n";
                let mut byte = [0u8; 1];
                let mut prev = 0u8;
                loop {
                    if stream.read(&mut byte).unwrap() == 0 {
                        break;
                    }
                    if prev == b'~' && byte[0] == b'H' {
                        // The status query (~HS): answer ready or fault.
                        stream
                            .write_all(if status_ok { ready } else { fault })
                            .unwrap();
                        stream.flush().unwrap();
                    } else {
                        log.lock().unwrap().extend_from_slice(&byte);
                    }
                    prev = byte[0];
                }
            });
            FakePrinter {
                port,
                got,
                handle: Some(handle),
            }
        }
    }

    async fn get(state: ApiState, uri: &str) -> axum::response::Response {
        router(state)
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn post(
        state: ApiState,
        uri: &str,
        body: &str,
        headers: HeaderMap,
    ) -> axum::response::Response {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header("content-type", "application/json");
        for (k, v) in headers.iter() {
            builder = builder.header(k, v);
        }
        router(state)
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
    }

    async fn delete(state: ApiState, uri: &str) -> axum::response::Response {
        router(state)
            .oneshot(
                Request::builder()
                    .method(Method::DELETE)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn body(res: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// A queued job row, inserted without going through `print` — no
    /// worker in flight, so the endpoint's state mapping is on its
    /// own.
    fn queued_job(id: &str) -> ApiJob {
        ApiJob {
            id: id.into(),
            idempotency_key: None,
            template_name: "Labels".into(),
            template: r#"{"format":"scene"}"#.into(),
            track: "scene".into(),
            profile: "Fake Label".into(),
            data: "[{\"name\":\"BOLT M8\"}]".into(),
            copies: 1,
            transport: r#"{"kind":"tcp","host":"127.0.0.1","port":9100}"#.into(),
            status: "queued".into(),
            result: None,
            created_at: 1,
            finished_at: None,
        }
    }

    /// Wait for the job's runner to finish it, as a real caller polls.
    /// The cap is a fail-safe, not a budget: in the Docker gate the
    /// runner cold-starts several thread pools at once and a slow
    /// container can take a while to get there — the poll ends the
    /// moment the job is done, so a generous cap only delays a real
    /// deadlock.
    async fn wait_until_done(state: &ApiState, id: &str) {
        for _ in 0..3000 {
            if state.store.api_job(id).unwrap().unwrap().status == "done" {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("the job did not finish in time");
    }

    #[tokio::test]
    async fn health_reports_ok() {
        let res = get(state(), "/v1/health").await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body(res).await["status"], "ok");
    }

    #[tokio::test]
    async fn printers_lists_the_profile_set() {
        let res = get(state(), "/v1/printers").await;
        assert_eq!(res.status(), StatusCode::OK);
        let v = body(res).await;
        assert!(
            v["count"].as_u64().unwrap() >= 10,
            "the shipped set is here"
        );
        assert!(v["printers"][0]["model"].is_string());
    }

    #[tokio::test]
    async fn templates_lists_the_saved_rows() {
        let st = state();
        st.store
            .save_template(&crate::store::StoredTemplate {
                id: "t1".into(),
                name: "Receipt".into(),
                description: "a receipt".into(),
                track: "scene".into(),
                template: r#"{"format":"scene"}"#.into(),
                sample: "[]".into(),
            })
            .unwrap();
        let res = get(st, "/v1/templates").await;
        assert_eq!(res.status(), StatusCode::OK);
        let v = body(res).await;
        assert_eq!(v["count"], 1);
        assert_eq!(v["templates"][0]["name"], "Receipt");
        assert!(
            v["templates"][0].get("template").is_none(),
            "the listing must not carry the template body"
        );
    }

    #[tokio::test]
    async fn an_unknown_route_is_a_plain_404() {
        let res = get(state(), "/v1/nope").await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn print_accepts_a_job_and_queues_it() {
        let st = state_with_label_template();
        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": [{"name": "BOLT M8"}],
                "copies": 2,
                "transport": { "kind": "tcp", "host": "127.0.0.1", "port": 9100 },
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let v = body(res).await;
        assert_eq!(v["status"], "queued");
        assert!(v["jobId"].is_string());
        let id = v["jobId"].as_str().unwrap().to_string();

        // The frozen request is in the store (the status moves on its
        // own: a runner may already have taken the job).
        let job = st.store.api_job(&id).unwrap().unwrap();
        assert_eq!(job.template_name, "Labels");
        assert_eq!(job.profile, "Fake Label");
        assert_eq!(job.copies, 2);
    }

    #[tokio::test]
    async fn the_same_idempotency_key_never_prints_twice() {
        let st = state_with_label_template();
        let payload = serde_json::json!({
            "template": "Labels",
            "printer": "Fake Label",
            "data": [{"name": "BOLT M8"}],
            "transport": { "kind": "tcp", "host": "127.0.0.1", "port": 9100 },
        })
        .to_string();
        let mut headers = HeaderMap::new();
        headers.insert("Idempotency-Key", "order-42".parse().unwrap());

        let res = post(st.clone(), "/v1/print", &payload, headers.clone()).await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let id = body(res).await["jobId"].as_str().unwrap().to_string();

        // A retry — the till's duplicate request — comes back the same
        // job, not a new one.
        let res = post(st.clone(), "/v1/print", &payload, headers).await;
        assert_eq!(res.status(), StatusCode::CONFLICT);
        let v = body(res).await;
        assert_eq!(v["status"], "duplicate");
        assert_eq!(v["jobId"], id);
        assert_eq!(
            st.store.list_api_jobs(JOB_LIST_LIMIT).unwrap().len(),
            1,
            "no second job was made"
        );
    }

    #[tokio::test]
    async fn print_names_what_is_missing() {
        let st = state_with_label_template();
        let transport = serde_json::json!({ "kind": "tcp", "host": "127.0.0.1", "port": 9100 });

        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Nope",
                "printer": "Fake Label",
                "data": "[{}]",
                "transport": transport,
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("no saved template"));

        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Nope",
                "data": "[{}]",
                "transport": transport,
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("no printer"));

        // No transport in the request, no saved default: a 400 that
        // names the setting.
        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": "[{}]",
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("transport.Fake Label"));

        // Copies above the cap: a 400.
        let res = post(
            st,
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": "[{}]",
                "copies": MAX_COPIES + 1,
                "transport": transport,
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_saved_default_transport_is_used_when_the_request_has_none() {
        let st = state_with_label_template();
        st.store
            .save_setting(
                "transport.Fake Label",
                r#"{"kind":"tcp","host":"127.0.0.1","port":9100}"#,
            )
            .unwrap();
        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": [{"name": "BOLT M8"}],
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let id = body(res).await["jobId"].as_str().unwrap().to_string();
        let job = st.store.api_job(&id).unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<Transport>(&job.transport).unwrap(),
            Transport::Tcp {
                host: "127.0.0.1".into(),
                port: 9100
            },
            "the saved default is what the job is frozen with"
        );
    }

    #[tokio::test]
    async fn jobs_are_listed_and_one_can_be_fetched_by_id() {
        let st = state_with_label_template();
        let id = "job-1".to_string();
        st.store.insert_api_job(&queued_job(&id)).unwrap();

        let v = body(get(st.clone(), "/v1/jobs").await).await;
        assert_eq!(v["count"], 1);
        assert_eq!(v["jobs"][0]["id"], id);
        assert_eq!(v["jobs"][0]["templateName"], "Labels");

        let v = body(get(st.clone(), &format!("/v1/jobs/{id}")).await).await;
        assert_eq!(v["job"]["id"], id);
        assert_eq!(v["job"]["profile"], "Fake Label");

        let res = get(st, "/v1/jobs/unknown").await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("no job named"));
    }

    #[tokio::test]
    async fn a_queued_job_cancels_and_a_done_one_does_not() {
        let st = state_with_label_template();

        // A queued job (no runner in flight): the cancel sticks.
        let id = "job-cancel".to_string();
        st.store.insert_api_job(&queued_job(&id)).unwrap();
        let res = delete(st.clone(), &format!("/v1/jobs/{id}")).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body(res).await["status"], "cancelled");
        assert_eq!(st.store.api_job(&id).unwrap().unwrap().status, "cancelled");
        // Cancelling again is a conflict, not a silent second cancel.
        let res = delete(st.clone(), &format!("/v1/jobs/{id}")).await;
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("cancelled"));

        // A done job: the cancel is refused, named.
        let id = "job-done".to_string();
        st.store.insert_api_job(&queued_job(&id)).unwrap();
        let _ = st
            .store
            .finish_api_job(&id, r#"{"result":"done"}"#, now_ms());
        let res = delete(st, &format!("/v1/jobs/{id}")).await;
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert!(body(res).await["error"].as_str().unwrap().contains("done"));
    }

    #[tokio::test]
    async fn a_finished_job_retries_and_an_in_flight_one_does_not() {
        let st = state_with_label_template();

        // In flight (queued): the retry is refused, named.
        let id = "job-busy".to_string();
        st.store.insert_api_job(&queued_job(&id)).unwrap();
        let res = post(
            st.clone(),
            &format!("/v1/jobs/{id}/retry"),
            "{}",
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("queued"));

        // Done: the retry is a 200 and the job is queued again. (A
        // runner is started for it; its outcome is not this endpoint's
        // concern.)
        let id = "job-done".to_string();
        st.store.insert_api_job(&queued_job(&id)).unwrap();
        let _ = st
            .store
            .finish_api_job(&id, r#"{"result":"failed"}"#, now_ms());
        let res = post(st, &format!("/v1/jobs/{id}/retry"), "{}", HeaderMap::new()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body(res).await["status"], "queued");
    }

    /// The whole path: a request the API accepted runs the same
    /// pipeline the UI drives and ends done, with the printer's own
    /// confirmation on the row.
    #[tokio::test]
    async fn an_accepted_job_prints_confirmed_and_reports_it() {
        let fake = FakePrinter::spawn(true);
        let st = state_with_label_template();
        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": [{"name": "BOLT M8"}],
                "transport": { "kind": "tcp", "host": "127.0.0.1", "port": fake.port },
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let id = body(res).await["jobId"].as_str().unwrap().to_string();

        wait_until_done(&st, &id).await;
        let job = st.store.api_job(&id).unwrap().unwrap();
        assert_eq!(job.status, "done");
        let report: serde_json::Value =
            serde_json::from_str(job.result.as_deref().unwrap()).unwrap();
        assert_eq!(
            report["result"], "confirmed",
            "the fake printer answered ready"
        );
        assert!(job.finished_at.is_some());

        let got = fake.got.lock().unwrap();
        let text = String::from_utf8_lossy(&got);
        assert!(
            text.contains("BOLT M8"),
            "the binding made it to the wire: {text:?}"
        );
    }

    /// The honest-failure half of the same path: the data the request
    /// brought is neither JSON nor CSV, and the job ends failed with
    /// the reason on the row — the API accepted it, the pipeline
    /// refused it.
    #[tokio::test]
    async fn an_unprintable_job_ends_failed_with_the_reason() {
        let st = state_with_label_template();
        let res = post(
            st.clone(),
            "/v1/print",
            &serde_json::json!({
                "template": "Labels",
                "printer": "Fake Label",
                "data": "a,,b",
                "transport": { "kind": "tcp", "host": "127.0.0.1", "port": 9100 },
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let id = body(res).await["jobId"].as_str().unwrap().to_string();

        wait_until_done(&st, &id).await;
        let job = st.store.api_job(&id).unwrap().unwrap();
        assert_eq!(job.status, "done");
        let report: serde_json::Value =
            serde_json::from_str(job.result.as_deref().unwrap()).unwrap();
        assert_eq!(report["result"], "failed");
        assert!(
            report["reason"]
                .as_str()
                .unwrap()
                .contains("neither JSON nor CSV"),
            "the reason is named, not empty: {report:?}"
        );
    }
}
