//! The local print API (plan phase 8): the same job pipeline the UI
//! drives, over HTTP on this PC. A till, a script or a web page on the
//! same machine prints without touching the app.
//!
//! Local by default: the listener binds `127.0.0.1` only, so nothing
//! off this PC can reach it. With the LAN switch on (the setting
//! `api.lan`), the listener binds the whole network instead, and a
//! request from off this PC must carry the `X-PrintNinja-Device-Token`
//! of a paired device. Pairing: the PC opens a short-lived window with
//! a one-time code (`begin_pairing` in the settings screen), the
//! device presents the code to `POST /v1/pair/claim` and receives its
//! token; `GET /v1/pair/hello` tells a device whether this PC is a
//! PrintNinja and whether a window is open.
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
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use pn_job::JobResult;
use pn_profiles::ProfileSet;
use pn_scene::{Records, Template};
use serde::{Deserialize, Serialize};
use tower::layer::Layer;
use tower::Service;

use crate::pairing::{self, PairingWindow};
use crate::pipeline::{
    factory, prepare_units, print_units, profile_infos, report_of, with_delivery_overrides,
    JobReport, Transport,
};
use crate::store::{ApiJob, PairedDevice, Store};

/// The port the API listens on — the same one the app it replaces used.
pub const DEFAULT_PORT: u16 = 17717;

/// How many copies one job may ask for.
pub const MAX_COPIES: u32 = 1000;

/// How many accepted jobs `GET /v1/jobs` reports.
const JOB_LIST_LIMIT: usize = 50;

/// What the API's handlers can reach: the loaded profiles, the local
/// store, and the pairing window — shared with the Tauri commands that
/// run the same pipeline.
#[derive(Clone)]
pub struct ApiState {
    pub profiles: Arc<ProfileSet>,
    pub store: Arc<Store>,
    /// The one open pairing window, if any. Memory only: the code is
    /// never written to the store.
    pub window: Arc<Mutex<Option<PairingWindow>>>,
}

/// The router, held apart from the socket so the endpoints can be
/// tested without binding a port. The LAN gate is not here — it reads
/// the peer address, which only the listener knows.
pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/printers", get(list_printers))
        .route("/v1/templates", get(list_templates))
        .route("/v1/print", post(print))
        .route("/v1/jobs", get(list_jobs))
        .route("/v1/jobs/{id}", get(get_job).delete(cancel_job))
        .route("/v1/jobs/{id}/retry", post(retry_job))
        .route("/v1/pair/hello", get(pair_hello))
        .route("/v1/pair/claim", post(pair_claim))
        .with_state(state)
}

/// Listen. With the LAN switch off the listener binds `127.0.0.1`
/// only; with it on, the whole network, behind the device-token gate.
/// The switch is read at start, so flipping it applies from the next
/// start. When the port is taken the app keeps running — the failure
/// is named, nothing else changes.
pub async fn serve(state: Arc<ApiState>) {
    let lan_on = state
        .store
        .load_settings()
        .ok()
        .is_some_and(|s| s.get("api.lan").is_some_and(|v| v == "true"));
    let addr: SocketAddr = if lan_on {
        ([0, 0, 0, 0], DEFAULT_PORT).into()
    } else {
        ([127, 0, 0, 1], DEFAULT_PORT).into()
    };
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("the local print API could not bind {addr}: {e}");
            return;
        }
    };
    let scope = if lan_on { "the network" } else { "127.0.0.1" };
    eprintln!("the local print API is listening on http://{addr} ({scope})");
    let app = router(state.as_ref().clone())
        .layer(LanGate {
            store: state.store.clone(),
        })
        .into_make_service_with_connect_info::<SocketAddr>();
    if let Err(e) = axum::serve(listener, app).await {
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

/// The word for a pairing attempt when there is no pairing to attempt
/// — LAN off or no window open. One wording, so a scanner cannot tell
/// the two apart.
fn pairing_unavailable() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "error": "pairing is not available on this device"
        })),
    )
}

/// Tell a device on the network that this PC is a PrintNinja — and
/// whether a pairing window is open right now.
async fn pair_hello(
    State(state): State<ApiState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let lan_on = state
        .store
        .load_settings()
        .map(|s| s.get("api.lan").is_some_and(|v| v == "true"))
        .unwrap_or(false);
    if !lan_on {
        return Err(pairing_unavailable());
    }
    let window_open = state
        .window
        .lock()
        .expect("the pairing window lock is not poisoned")
        .as_ref()
        .is_some_and(|w| w.is_open(std::time::Instant::now()));
    Ok(Json(serde_json::json!({
        "protocol": 1,
        "provider": "printninja",
        "windowOpen": window_open,
    })))
}

/// A device claiming the pairing window: the one-time code in, a
/// per-device token out — shown once, the PC keeps its hash.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimRequest {
    code: String,
    device_name: Option<String>,
    platform: Option<String>,
}

async fn pair_claim(
    State(state): State<ApiState>,
    Json(req): Json<ClaimRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let lan_on = state
        .store
        .load_settings()
        .map(|s| s.get("api.lan").is_some_and(|v| v == "true"))
        .unwrap_or(false);
    if !lan_on {
        return Err(pairing_unavailable());
    }
    let now = std::time::Instant::now();
    let mut guard = state
        .window
        .lock()
        .expect("the pairing window lock is not poisoned");
    let Some(window) = guard.as_mut() else {
        return Err(pairing_unavailable());
    };
    match window.claim(&req.code, now) {
        Ok(()) => {
            let token = pairing::mint_token();
            let hash = pairing::token_hash(&token);
            let device = PairedDevice {
                id: uuid::Uuid::new_v4().to_string(),
                name: req
                    .device_name
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| "unnamed device".into()),
                platform: req
                    .platform
                    .filter(|p| !p.trim().is_empty())
                    .unwrap_or_else(|| "unknown".into()),
                paired_at: now_ms(),
            };
            state
                .store
                .add_paired_device(&device, &hash)
                .map_err(|e| store_error(&e))?;
            Ok((
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "token": token,
                    "deviceId": device.id,
                })),
            ))
        }
        Err(pairing::ClaimError::Wrong { left }) => Err(bad(&format!(
            "the code is not right; {left} tries left on this window"
        ))),
        Err(pairing::ClaimError::BadFormat) => Err(bad(&format!(
            "a pairing code has {} characters",
            pairing::CODE_LEN
        ))),
        Err(pairing::ClaimError::Unavailable) => Err(pairing_unavailable()),
    }
}

/// The LAN gate: a request that reaches the listener from off this
/// PC must carry a paired device's token. Applied only in `serve` —
/// the peer address is not part of a router-level test.
#[derive(Clone)]
struct LanGate {
    store: Arc<Store>,
}

/// The whole decision, in pure form so it can be tested with a store
/// and a fake peer, socket or not. `None` means the request goes
/// through; `Some` is the response the caller gets instead.
fn lan_rejection(
    store: &Store,
    peer: Option<SocketAddr>,
    path: &str,
    token: Option<&str>,
) -> Option<Response> {
    // From this PC — or the peer unknown, which only a router-level
    // test can be — the API is local and needs no token.
    if peer.is_none_or(|p| p.ip().is_loopback()) {
        return None;
    }
    // The pairing routes are reachable from the network: that is how
    // a device finds the PC and claims the window.
    if path == "/v1/pair/hello" || path == "/v1/pair/claim" {
        return None;
    }
    let lan_on = store
        .load_settings()
        .ok()
        .is_some_and(|s| s.get("api.lan").is_some_and(|v| v == "true"));
    if !lan_on {
        // LAN off: the listener binds 127.0.0.1, so this should not
        // be reachable at all. Say not found, name nothing.
        return Some(not_found_404());
    }
    let Some(token) = token.filter(|t| !t.trim().is_empty()) else {
        return Some(unpaired());
    };
    let known = store
        .has_paired_device(&pairing::token_hash(token))
        .unwrap_or(false);
    if !known {
        return Some(unpaired());
    }
    None
}

/// The word for a device that is not paired with this PC.
fn unpaired() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": "this device is not paired with this PC"
        })),
    )
        .into_response()
}

/// A plain 404, the shape of an unknown path.
fn not_found_404() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": "not found" })),
    )
        .into_response()
}

impl<S> Layer<S> for LanGate
where
    S: Service<Request<Body>, Response = Response, Error = std::convert::Infallible>
        + Clone
        + Send
        + 'static,
{
    type Service = LanGateService<S>;
    fn layer(&self, inner: S) -> Self::Service {
        LanGateService {
            inner,
            store: self.store.clone(),
        }
    }
}

#[derive(Clone)]
struct LanGateService<S> {
    inner: S,
    store: Arc<Store>,
}

impl<S> Service<Request<Body>> for LanGateService<S>
where
    S: Service<Request<Body>, Response = Response, Error = std::convert::Infallible>
        + Clone
        + Send
        + 'static,
    S::Future: Send,
{
    type Response = Response;
    type Error = std::convert::Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Response, std::convert::Infallible>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let store = self.store.clone();
        let path = req.uri().path().to_string();
        let token = req
            .headers()
            .get("X-PrintNinja-Device-Token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0);
        let mut inner = self.inner.clone();
        Box::pin(async move {
            if let Some(rejection) = lan_rejection(&store, peer, &path, token.as_deref()) {
                return Ok(rejection);
            }
            inner.call(req).await
        })
    }
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
        ApiState {
            profiles,
            store,
            window: Arc::new(Mutex::new(None)),
        }
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
            window: Arc::new(Mutex::new(None)),
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

    /// A store with the LAN switch as named — the gate's other input.
    fn lan_store(lan_on: bool) -> Arc<Store> {
        let store = Arc::new(Store::in_memory().expect("an in-memory store must open"));
        store
            .save_setting("api.lan", if lan_on { "true" } else { "false" })
            .expect("the setting must be saved");
        store
    }

    /// A peer off this PC — the gate's network side.
    fn lan_peer() -> SocketAddr {
        "10.0.0.5:5555".parse().expect("a valid peer")
    }

    /// A peer on this PC — the gate's local side.
    fn local_peer() -> SocketAddr {
        "127.0.0.1:5555".parse().expect("a valid peer")
    }

    /// The gate lets this PC through, whatever the switch and the
    /// token.
    #[test]
    fn the_lan_gate_lets_this_pc_through() {
        for lan_on in [false, true] {
            let store = lan_store(lan_on);
            assert!(lan_rejection(&store, Some(local_peer()), "/v1/print", None).is_none());
            assert!(lan_rejection(&store, None, "/v1/print", None).is_none());
        }
    }

    /// With LAN off a peer off this PC gets a plain not-found — the
    /// listener should not be reachable, and if it is, it says
    /// nothing.
    #[test]
    fn lan_off_hides_the_api_from_the_network() {
        let store = lan_store(false);
        let res = lan_rejection(&store, Some(lan_peer()), "/v1/print", None).unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    /// With LAN on, a peer off this PC is unpaired without a token,
    /// with a token the PC has not minted, and through with a token
    /// it has.
    #[tokio::test]
    async fn lan_on_needs_a_paired_token() {
        let store = lan_store(true);
        let res = lan_rejection(&store, Some(lan_peer()), "/v1/print", None).unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            body_of(res).await["error"].as_str(),
            Some("this device is not paired with this PC")
        );

        let res =
            lan_rejection(&store, Some(lan_peer()), "/v1/print", Some("not-a-token")).unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

        let token = pairing::mint_token();
        let device = PairedDevice {
            id: "d1".into(),
            name: "the till".into(),
            platform: "windows".into(),
            paired_at: 1,
        };
        store
            .add_paired_device(&device, &pairing::token_hash(&token))
            .unwrap();
        assert!(lan_rejection(&store, Some(lan_peer()), "/v1/print", Some(&token)).is_none());
    }

    /// The pairing routes stay reachable from the network — that is
    /// how a device finds the PC.
    #[test]
    fn the_pairing_routes_are_exempt_from_the_gate() {
        let store = lan_store(true);
        for path in ["/v1/pair/hello", "/v1/pair/claim"] {
            assert!(lan_rejection(&store, Some(lan_peer()), path, None).is_none());
        }
    }

    /// The body of a rejection, as JSON.
    async fn body_of(res: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// Open the one pairing window the API state holds.
    fn open_window(st: &ApiState, code: &str) {
        *st.window.lock().unwrap() = Some(PairingWindow::new(code.to_string()));
    }

    fn lan_state() -> ApiState {
        let st = state();
        st.store
            .save_setting("api.lan", "true")
            .expect("the setting must be saved");
        st
    }

    /// With LAN off, hello says pairing is not available — the same
    /// words a closed window gives.
    #[tokio::test]
    async fn hello_says_no_when_lan_is_off() {
        let st = state();
        let res = get(st.clone(), "/v1/pair/hello").await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            body(res).await["error"].as_str(),
            Some("pairing is not available on this device")
        );
    }

    /// With LAN on and no window, hello says the PC is here but the
    /// window is closed.
    #[tokio::test]
    async fn hello_reports_the_window() {
        let st = lan_state();
        let res = get(st.clone(), "/v1/pair/hello").await;
        assert_eq!(res.status(), StatusCode::OK);
        let v = body(res).await;
        assert_eq!(v["protocol"], 1);
        assert_eq!(v["windowOpen"], false);

        open_window(&st, "K7QM4XPD");
        let res = get(st.clone(), "/v1/pair/hello").await;
        assert_eq!(body(res).await["windowOpen"], true);
    }

    /// A claim with the right code takes the window up, mints the
    /// token, and stores its hash — a second claim gets nothing.
    #[tokio::test]
    async fn a_claim_with_the_right_code_paired_once() {
        let st = lan_state();
        open_window(&st, "K7QM4XPD");
        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({
                "code": "k7qm 4xpd",
                "deviceName": "the till",
                "platform": "android",
            })
            .to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
        let v = body(res).await;
        let token = v["token"].as_str().unwrap();
        assert_eq!(token.len(), 32);
        assert!(v["deviceId"].as_str().is_some());

        let devices = st.store.list_paired_devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "the till");
        assert_eq!(devices[0].platform, "android");
        assert!(st
            .store
            .has_paired_device(&pairing::token_hash(token))
            .unwrap());

        // The window is single use.
        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({ "code": "K7QM4XPD" }).to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    /// A wrong code is named as such, and a misshapen one is its own
    /// error; neither touches the window's life.
    #[tokio::test]
    async fn a_wrong_or_misshapen_code_is_rejected() {
        let st = lan_state();
        open_window(&st, "K7QM4XPD");
        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({ "code": "AAAAAAAA" }).to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("not right"));

        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({ "code": "short" }).to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(body(res).await["error"]
            .as_str()
            .unwrap()
            .contains("8 characters"));

        // The window still works for the right code.
        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({ "code": "K7QM4XPD" }).to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::CREATED);
    }

    /// With LAN on but no window open, a claim gets the closed-window
    /// wording, not a hint that the window was ever opened.
    #[tokio::test]
    async fn a_claim_without_a_window_is_not_available() {
        let st = lan_state();
        let res = post(
            st.clone(),
            "/v1/pair/claim",
            &serde_json::json!({ "code": "K7QM4XPD" }).to_string(),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            body(res).await["error"].as_str(),
            Some("pairing is not available on this device")
        );
    }
}
