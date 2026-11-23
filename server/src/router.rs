//! The registry's HTTP surface. Increment A: health, accounts (by
//! handle), sessions, password change and handle change. Increment B:
//! publishing a template and the community gallery (browse, search,
//! fetch, unpublish). Increment C: saving published templates to a
//! per-account list, with the full documents, so an app can keep
//! editable local copies. Later increments add offline-first sync on
//! the same router.
//!
//! The router is built over [`ServerState`] and held apart from the
//! socket, so the endpoints are tested with `oneshot` — no port is
//! bound.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::{
    self, handle_key, handle_problem, password_problem, verify_password, AuthedUser,
    MAX_SESSIONS_PER_USER, SESSION_TTL,
};
use crate::store::{now_unix, NewTemplate, TemplateError, UserError};
use crate::template::{check_template, name_problem, readme_problem, sample_problem, slug_problem};
use crate::ServerState;

/// The router for the registry.
pub fn router(state: ServerState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/account", post(create_account))
        .route("/v1/login", post(login))
        .route("/v1/logout", post(logout))
        .route("/v1/me", get(me))
        .route("/v1/password/change", post(change_password))
        .route("/v1/handle", post(change_handle))
        .route(
            "/v1/templates",
            post(publish_template).get(gallery_templates),
        )
        .route(
            "/v1/templates/{owner}/{slug}",
            get(fetch_template).delete(unpublish_template),
        )
        .route(
            "/v1/templates/{owner}/{slug}/save",
            post(save_template).delete(unsave_template),
        )
        .route("/v1/saved", get(list_saved))
        .with_state(state)
}

/// Liveness.
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// A JSON error body, the same shape for every failure the client can
/// act on.
fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountReq {
    handle: String,
    password: String,
}

/// Register an account by handle. Returns a working session token.
async fn create_account(State(state): State<ServerState>, Json(req): Json<AccountReq>) -> Response {
    let handle = req.handle.trim().to_string();
    if let Some(msg) = handle_problem(&handle) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    if let Some(msg) = password_problem(&req.password) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    let hash = match auth::hash_password(&req.password) {
        Ok(h) => h,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let key = handle_key(&handle);
    let id = Uuid::new_v4().to_string();
    let now = now_unix();
    match state.store.create_user(&id, &handle, &key, &hash, now) {
        Ok(()) => issue_session(state, &id, &handle, now).await,
        Err(UserError::HandleExists) => {
            err(StatusCode::CONFLICT, "a handle like that is already taken")
        }
        Err(UserError::Other(e)) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginReq {
    handle: String,
    password: String,
}

/// Log in with a handle and password; receive a session token.
async fn login(State(state): State<ServerState>, Json(req): Json<LoginReq>) -> Response {
    let key = handle_key(&req.handle);
    let rec = match state.store.find_user_by_handle_key(&key) {
        Ok(rec) => rec,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    // Unknown handles verify against a dummy hash with the same
    // parameters, so both paths take the same time — and both get the
    // same 401, so handles cannot be probed.
    let stored = rec
        .as_ref()
        .map(|r| r.password_hash.as_str())
        .unwrap_or(auth::DUMMY_HASH);
    if rec.is_none() || !verify_password(&req.password, stored) {
        return err(
            StatusCode::UNAUTHORIZED,
            "no account with that handle and password",
        );
    }
    let rec = rec.expect("checked above");
    issue_session(state, &rec.id, &rec.handle, now_unix()).await
}

/// Mint a session for a just-verified account and cap its sessions.
async fn issue_session(state: ServerState, user_id: &str, handle: &str, now: i64) -> Response {
    let expires = now + SESSION_TTL.as_secs() as i64;
    let token = auth::new_token();
    let th = auth::token_hash(&token);
    if let Err(e) = state.store.create_session(&th, user_id, now, expires) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    if let Err(e) = state.store.prune_sessions(user_id, MAX_SESSIONS_PER_USER) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    (
        StatusCode::CREATED,
        Json(json!({ "handle": handle, "token": token, "expiresAt": expires })),
    )
        .into_response()
}

/// Revoke this request's session. Idempotent.
async fn logout(State(state): State<ServerState>, user: AuthedUser) -> Response {
    match state.store.delete_session(&auth::token_hash(&user.token)) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// The caller's account.
async fn me(user: AuthedUser) -> Json<Value> {
    Json(json!({ "handle": user.handle }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordReq {
    current_password: String,
    new_password: String,
}

/// Change the password. The current one must verify, and every other
/// session is revoked — a leaked password stops working everywhere
/// except the device that changed it.
async fn change_password(
    State(state): State<ServerState>,
    user: AuthedUser,
    Json(req): Json<ChangePasswordReq>,
) -> Response {
    if let Some(msg) = password_problem(&req.new_password) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    if !verify_password(&req.current_password, &user.password_hash) {
        return err(
            StatusCode::UNAUTHORIZED,
            "no account with that handle and password",
        );
    }
    let hash = match auth::hash_password(&req.new_password) {
        Ok(h) => h,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    if let Err(e) = state.store.update_password_hash(&user.id, &hash) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    let keep = auth::token_hash(&user.token);
    match state.store.delete_others_for_user(&user.id, &keep) {
        Ok(revoked) => Json(json!({ "revoked": revoked })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeHandleReq {
    handle: String,
}

/// Rename the account's handle. The new handle must be valid and free;
/// a case-only change (same key) is allowed. The account id never
/// changes, so sessions and, later, ownership are unaffected.
async fn change_handle(
    State(state): State<ServerState>,
    user: AuthedUser,
    Json(req): Json<ChangeHandleReq>,
) -> Response {
    let handle = req.handle.trim().to_string();
    if let Some(msg) = handle_problem(&handle) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    let key = handle_key(&handle);
    if key != user.handle_key {
        match state.store.find_user_by_handle_key(&key) {
            Ok(Some(_)) => return err(StatusCode::CONFLICT, "a handle like that is already taken"),
            Ok(None) => {}
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        }
    }
    match state.store.update_handle(&user.id, &handle, &key) {
        Ok(()) => Json(json!({ "handle": handle })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishReq {
    name: String,
    slug: String,
    #[serde(default)]
    readme: String,
    template: Value,
    /// Starting records for the data fields; an empty list when absent.
    #[serde(default)]
    sample: Option<Value>,
}

/// Publish a template to the community gallery. The document is checked
/// against the scene schema — never rendered or printed.
async fn publish_template(
    State(state): State<ServerState>,
    user: AuthedUser,
    Json(req): Json<PublishReq>,
) -> Response {
    let name = req.name.trim().to_string();
    if let Some(msg) = name_problem(&name) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    let slug = req.slug.trim().to_string();
    if let Some(msg) = slug_problem(&slug) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    if let Some(msg) = readme_problem(&req.readme) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    let (track, template_text) = match check_template(&req.template) {
        Ok(t) => t,
        Err(e) => return err(StatusCode::BAD_REQUEST, &e),
    };
    let sample = req.sample.unwrap_or(Value::Array(Vec::new()));
    if let Some(msg) = sample_problem(&sample) {
        return err(StatusCode::BAD_REQUEST, &msg);
    }
    let sample_text = match serde_json::to_string(&sample) {
        Ok(t) => t,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let new = NewTemplate {
        id: Uuid::new_v4().to_string(),
        slug,
        name,
        readme: req.readme,
        track,
        template: template_text,
        sample: sample_text,
    };
    let now = now_unix();
    match state.store.create_template(&user.id, &new, now) {
        Ok(()) => (
            StatusCode::CREATED,
            Json(json!({
                "id": new.id,
                "slug": new.slug,
                "owner": user.handle
            })),
        )
            .into_response(),
        Err(TemplateError::SlugExists) => err(
            StatusCode::CONFLICT,
            "that slug is already taken on this account",
        ),
        Err(TemplateError::Other(e)) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GalleryQuery {
    q: Option<String>,
    track: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

/// The community gallery: browse and search published templates. No
/// sign-in needed to look around.
async fn gallery_templates(
    State(state): State<ServerState>,
    Query(q): Query<GalleryQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 100) as i64;
    let offset = q.offset.unwrap_or(0).min(10_000) as i64;
    match state
        .store
        .list_templates(q.q.as_deref(), q.track.as_deref(), limit, offset)
    {
        Ok((items, total)) => Json(json!({ "items": items, "total": total })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// One published template by the owner's handle and slug, with its full
/// document — everything an app needs to save it as a local copy.
async fn fetch_template(
    State(state): State<ServerState>,
    Path((owner, slug)): Path<(String, String)>,
) -> Response {
    let key = handle_key(&owner);
    let slug = slug.trim().to_lowercase();
    match state.store.find_template(&key, &slug) {
        Ok(Some(t)) => Json(json!({ "template": t })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "no published template there"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// Add a published template to this account's saved list. Idempotent —
/// saving twice changes nothing. The account keeps the full documents,
/// so an app can materialize editable local copies offline.
async fn save_template(
    State(state): State<ServerState>,
    user: AuthedUser,
    Path((owner, slug)): Path<(String, String)>,
) -> Response {
    let key = handle_key(&owner);
    let slug = slug.trim().to_lowercase();
    match state.store.find_template(&key, &slug) {
        Ok(Some(t)) => match state.store.save_template(&user.id, &t.id, now_unix()) {
            Ok(_) => Json(json!({ "ok": true })).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        },
        Ok(None) => err(StatusCode::NOT_FOUND, "no published template there"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// Take a published template off this account's saved list. Idempotent,
/// like the save.
async fn unsave_template(
    State(state): State<ServerState>,
    user: AuthedUser,
    Path((owner, slug)): Path<(String, String)>,
) -> Response {
    let key = handle_key(&owner);
    let slug = slug.trim().to_lowercase();
    match state.store.find_template(&key, &slug) {
        Ok(Some(t)) => match state.store.unsave_template(&user.id, &t.id) {
            Ok(_) => Json(json!({ "ok": true })).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        },
        // Not published (unpublished in the meantime): a plain 404,
        // same as the fetch — the app treats it as "already gone".
        Ok(None) => err(StatusCode::NOT_FOUND, "no published template there"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}

/// This account's saved templates, newest save first, with the full
/// documents.
async fn list_saved(
    State(state): State<ServerState>,
    user: AuthedUser,
    Query(q): Query<SavedQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 100) as i64;
    let offset = q.offset.unwrap_or(0).min(10_000) as i64;
    match state.store.list_saved(&user.id, limit, offset) {
        Ok((items, total)) => Json(json!({ "items": items, "total": total })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// Unpublish a template. Owner only, and an unknown slug is a 404, so
/// the endpoint does not say which slugs other accounts have.
async fn unpublish_template(
    State(state): State<ServerState>,
    user: AuthedUser,
    Path((owner, slug)): Path<(String, String)>,
) -> Response {
    let key = handle_key(&owner);
    let slug = slug.trim().to_lowercase();
    match state.store.find_template(&key, &slug) {
        // The row the URL names must belong to the caller — handles are
        // unique up to case, so the match keys decide. Anything else is
        // the same 404, so the endpoint does not say which slugs other
        // accounts have (even when they share a slug with the caller).
        Ok(Some(t)) if handle_key(&t.owner) == handle_key(&user.handle) => {
            match state.store.delete_template(&user.id, &slug) {
                Ok(_) => Json(json!({ "ok": true })).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
            }
        }
        // Not on this account (or gone): a plain 404, either way.
        Ok(_) => err(StatusCode::NOT_FOUND, "no published template there"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Method, Request};
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn state() -> ServerState {
        ServerState {
            store: Arc::new(crate::store::Store::in_memory().expect("the in-memory store opens")),
        }
    }

    /// Run one request through the router and return its status and the
    /// parsed JSON body.
    async fn call(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(t) = token {
            b = b.header("authorization", format!("Bearer {t}"));
        }
        let body = match body {
            Some(v) => {
                b = b.header("content-type", "application/json");
                Body::from(serde_json::to_vec(&v).expect("the body serializes"))
            }
            None => Body::empty(),
        };
        let req = b.body(body).expect("the request is built");
        let res = app
            .clone()
            .oneshot(req)
            .await
            .expect("the request completes");
        let status = res.status();
        let bytes = res
            .into_body()
            .collect()
            .await
            .expect("the body reads")
            .to_bytes();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    async fn register(app: &Router, handle: &str, password: &str) -> (StatusCode, Value) {
        call(
            app,
            Method::POST,
            "/v1/account",
            Some(json!({ "handle": handle, "password": password })),
            None,
        )
        .await
    }

    async fn login(app: &Router, handle: &str, password: &str) -> (StatusCode, Value) {
        call(
            app,
            Method::POST,
            "/v1/login",
            Some(json!({ "handle": handle, "password": password })),
            None,
        )
        .await
    }

    /// Log in and take the session token.
    async fn token_for(app: &Router, handle: &str, password: &str) -> String {
        let (s, v) = login(app, handle, password).await;
        assert_eq!(s, StatusCode::CREATED, "the login succeeds");
        v["token"].as_str().expect("a token is issued").to_string()
    }

    #[tokio::test]
    async fn health_is_ok() {
        let app = router(state());
        let (s, v) = call(&app, Method::GET, "/v1/health", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["status"], "ok");
    }

    #[tokio::test]
    async fn an_account_registers_then_logs_in_and_reads_itself() {
        let app = router(state());
        let (s, v) = register(&app, "jane", "supersecret1").await;
        assert_eq!(s, StatusCode::CREATED);
        assert_eq!(v["handle"], "jane");
        assert!(v["token"].is_string());
        assert!(v["expiresAt"].is_number());

        let (s, v) = login(&app, "jane", "supersecret1").await;
        assert_eq!(s, StatusCode::CREATED);
        let token = v["token"].as_str().expect("a token is issued");

        let (s, v) = call(&app, Method::GET, "/v1/me", None, Some(token)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["handle"], "jane");
    }

    #[tokio::test]
    async fn login_is_case_insensitive_on_the_handle() {
        let app = router(state());
        register(&app, "JaneDoe", "supersecret1").await;
        let (s, v) = login(&app, "janedoe", "supersecret1").await;
        assert_eq!(s, StatusCode::CREATED, "the key matches case-insensitively");
        assert_eq!(v["handle"], "JaneDoe", "the handle is served as typed");
    }

    #[tokio::test]
    async fn a_duplicate_handle_is_a_conflict_not_a_second_account() {
        let app = router(state());
        let (s, _) = register(&app, "jane", "supersecret1").await;
        assert_eq!(s, StatusCode::CREATED);
        // Case-insensitive, like the old server's handle_key.
        let (s, v) = register(&app, "JANE", "supersecret1").await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert!(v["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn a_bad_handle_is_rejected() {
        let app = router(state());
        let (s, v) = register(&app, "has space", "supersecret1").await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(v["error"].as_str().is_some());
        let (s, _) = register(&app, &"a".repeat(33), "supersecret1").await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        let (s, _) = register(&app, "", "supersecret1").await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_short_or_long_password_is_rejected() {
        let app = router(state());
        let (s, v) = register(&app, "jane", "short").await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(v["error"].as_str().unwrap().contains("at least"));
        let (s, _) = register(&app, "jane", &"x".repeat(129)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_wrong_password_is_a_401() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let (s, _) = login(&app, "jane", "the-wrong-one").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn an_unknown_handle_is_the_same_401() {
        let app = router(state());
        // No account at all — indistinguishable from a wrong password.
        let (s, _) = login(&app, "ghost", "supersecret1").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn me_requires_a_valid_session() {
        let app = router(state());
        let (s, _) = call(&app, Method::GET, "/v1/me", None, None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
        let (s, _) = call(&app, Method::GET, "/v1/me", None, Some("not-a-real-token")).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logout_revokes_the_session() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let token = token_for(&app, "jane", "supersecret1").await;

        assert_eq!(
            call(&app, Method::GET, "/v1/me", None, Some(&token))
                .await
                .0,
            StatusCode::OK
        );
        let (s, v) = call(&app, Method::POST, "/v1/logout", None, Some(&token)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["ok"], true);
        // The token is dead.
        let (s, _) = call(&app, Method::GET, "/v1/me", None, Some(&token)).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_password_change_keeps_the_current_session_and_kills_the_rest() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t1 = token_for(&app, "jane", "supersecret1").await;
        let t2 = token_for(&app, "jane", "supersecret1").await;

        let (s, v) = call(
            &app,
            Method::POST,
            "/v1/password/change",
            Some(json!({
                "currentPassword": "supersecret1",
                "newPassword": "evenlonger2"
            })),
            Some(&t1),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        // Two sessions existed besides t1's: the one the register
        // issued and t2's.
        assert_eq!(v["revoked"], 2, "the other sessions are revoked");

        // The current session survives; the other one is dead.
        assert_eq!(
            call(&app, Method::GET, "/v1/me", None, Some(&t1)).await.0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, Method::GET, "/v1/me", None, Some(&t2)).await.0,
            StatusCode::UNAUTHORIZED
        );
        // The new password works from now on.
        assert_eq!(
            login(&app, "jane", "evenlonger2").await.0,
            StatusCode::CREATED
        );
        assert_eq!(
            login(&app, "jane", "supersecret1").await.0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn a_password_change_with_the_wrong_current_password_is_a_401() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;
        let (s, _) = call(
            &app,
            Method::POST,
            "/v1/password/change",
            Some(json!({
                "currentPassword": "the-wrong-one",
                "newPassword": "evenlonger2"
            })),
            Some(&t),
        )
        .await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_handle_change_renames_the_account() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;

        let (s, v) = call(
            &app,
            Method::POST,
            "/v1/handle",
            Some(json!({ "handle": "janedoe" })),
            Some(&t),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["handle"], "janedoe");

        // The session survived the rename; the old handle is gone.
        let (s, v) = call(&app, Method::GET, "/v1/me", None, Some(&t)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["handle"], "janedoe");
        assert_eq!(
            login(&app, "jane", "supersecret1").await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            login(&app, "janedoe", "supersecret1").await.0,
            StatusCode::CREATED
        );
    }

    #[tokio::test]
    async fn a_case_only_handle_change_is_allowed() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;
        let (s, v) = call(
            &app,
            Method::POST,
            "/v1/handle",
            Some(json!({ "handle": "Jane" })),
            Some(&t),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["handle"], "Jane");
        assert_eq!(
            call(&app, Method::GET, "/v1/me", None, Some(&t)).await.1["handle"],
            "Jane"
        );
    }

    #[tokio::test]
    async fn a_handle_change_to_a_taken_handle_is_a_conflict() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        register(&app, "john", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;
        let (s, _) = call(
            &app,
            Method::POST,
            "/v1/handle",
            Some(json!({ "handle": "JOHN" })),
            Some(&t),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);
        // The original handle is untouched.
        assert_eq!(
            call(&app, Method::GET, "/v1/me", None, Some(&t)).await.1["handle"],
            "jane"
        );
    }

    #[tokio::test]
    async fn a_missing_body_field_is_unprocessable() {
        let app = router(state());
        // Well-formed JSON, wrong shape — axum answers 422 (a 400 is
        // reserved for JSON that does not parse at all).
        let (s, _) = call(
            &app,
            Method::POST,
            "/v1/account",
            Some(json!({ "handle": "jane" })),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// A scene template that passes the registry's checks.
    fn label_template() -> Value {
        json!({
            "media": { "kind": "label", "width_mm": 58.0, "height_mm": 40.0 },
            "fields": [ { "name": "name" } ],
            "elements": [
                {
                    "type": "text",
                    "at": { "x_mm": 2.0, "y_mm": 2.0 },
                    "size": { "w_mm": 50.0, "h_mm": 6.0 },
                    "content": "Hi {{name}}",
                    "style": { "size_mm": 5.0 }
                }
            ]
        })
    }

    async fn publish(
        app: &Router,
        token: Option<&str>,
        name: &str,
        slug: &str,
        template: Value,
    ) -> (StatusCode, Value) {
        call(
            app,
            Method::POST,
            "/v1/templates",
            Some(json!({
                "name": name,
                "slug": slug,
                "template": template,
                "sample": [ { "name": "Jane" } ]
            })),
            token,
        )
        .await
    }

    #[tokio::test]
    async fn publishing_a_valid_template_stores_and_returns_it() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;

        let (s, v) = publish(
            &app,
            Some(&t),
            "Shipping",
            "shipping-label",
            label_template(),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        assert!(v["id"].is_string());
        assert_eq!(v["slug"], "shipping-label");
        assert_eq!(v["owner"], "jane");

        // The gallery finds it without signing in.
        let (s, v) = call(&app, Method::GET, "/v1/templates", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 1);
        assert_eq!(v["items"][0]["slug"], "shipping-label");
        assert_eq!(v["items"][0]["name"], "Shipping");
        assert_eq!(v["items"][0]["owner"], "jane");
        assert_eq!(v["items"][0]["track"], "scene");
    }

    #[tokio::test]
    async fn an_invalid_template_is_rejected_with_a_plain_words_error() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;

        // html on thermal media fails the schema check.
        let doc = json!({
            "format": "html",
            "media": { "kind": "label", "width_mm": 58.0, "height_mm": 40.0 },
            "html": "<p>no</p>",
            "elements": []
        });
        let (s, v) = publish(&app, Some(&t), "Nope", "nope", doc).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(v["error"].is_string());

        // A bad slug and an empty name are 400s too.
        let (s, _) = publish(&app, Some(&t), "Shipping", "Upper", label_template()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        let (s, _) = publish(&app, Some(&t), "   ", "ok", label_template()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_duplicate_slug_on_the_same_account_is_a_conflict() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        register(&app, "john", "supersecret1").await;
        let tj = token_for(&app, "jane", "supersecret1").await;
        let tjo = token_for(&app, "john", "supersecret1").await;

        assert_eq!(
            publish(
                &app,
                Some(&tj),
                "Shipping",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );
        // Same slug, same account: 409.
        let (s, _) = publish(&app, Some(&tj), "Other", "shipping-label", label_template()).await;
        assert_eq!(s, StatusCode::CONFLICT);
        // Same slug, other account: fine — slugs are per owner.
        assert_eq!(
            publish(
                &app,
                Some(&tjo),
                "Their own",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );
    }

    #[tokio::test]
    async fn publishing_without_a_session_is_unauthorized() {
        let app = router(state());
        let (s, _) = publish(&app, None, "Shipping", "shipping-label", label_template()).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn the_gallery_searches_and_filters() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;

        assert_eq!(
            publish(
                &app,
                Some(&t),
                "Shipping Label",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );
        // The document track: an html template on page media.
        let doc = json!({
            "format": "html",
            "media": { "kind": "page", "width_mm": 210.0, "height_mm": 297.0 },
            "html": "<p>Order page</p>",
            "elements": []
        });
        assert_eq!(
            publish(&app, Some(&t), "Order Page", "order-page", doc)
                .await
                .0,
            StatusCode::CREATED
        );

        // By name.
        let (s, v) = call(&app, Method::GET, "/v1/templates?q=shipping", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 1);
        assert_eq!(v["items"][0]["slug"], "shipping-label");
        // By owner.
        let (s, v) = call(&app, Method::GET, "/v1/templates?q=JANE", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 2);
        // No match.
        let (s, v) = call(&app, Method::GET, "/v1/templates?q=zzz", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 0);
        // By track.
        let (s, v) = call(
            &app,
            Method::GET,
            "/v1/templates?track=document",
            None,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 1);
        assert_eq!(v["items"][0]["slug"], "order-page");
        // Combined: q AND track.
        let (s, v) = call(
            &app,
            Method::GET,
            "/v1/templates?q=order&track=document",
            None,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 1);
        // Paging: limit 1 gives one item but still the full total.
        let (s, v) = call(&app, Method::GET, "/v1/templates?limit=1", None, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 2);
        assert_eq!(v["items"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn fetching_a_published_template_returns_the_full_document() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        let t = token_for(&app, "jane", "supersecret1").await;
        assert_eq!(
            publish(
                &app,
                Some(&t),
                "Shipping",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );

        // Case-insensitive on the owner, as the app will type it.
        let (s, v) = call(
            &app,
            Method::GET,
            "/v1/templates/JANE/shipping-label",
            None,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["template"]["slug"], "shipping-label");
        assert_eq!(v["template"]["owner"], "jane");
        assert!(
            v["template"]["template"].is_string(),
            "the full document is there"
        );
        assert!(v["template"]["sample"].is_string());

        // An unknown owner or slug is a 404.
        assert_eq!(
            call(
                &app,
                Method::GET,
                "/v1/templates/nobody/shipping-label",
                None,
                None
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(&app, Method::GET, "/v1/templates/jane/nope", None, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn unpublishing_removes_the_template_and_only_the_owner_can() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        register(&app, "john", "supersecret1").await;
        let tj = token_for(&app, "jane", "supersecret1").await;
        let tjo = token_for(&app, "john", "supersecret1").await;
        assert_eq!(
            publish(
                &app,
                Some(&tj),
                "Shipping",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );

        // A non-owner gets the same 404 as an unknown slug — the
        // endpoint does not say whose templates exist.
        let (s, _) = call(
            &app,
            Method::DELETE,
            "/v1/templates/jane/shipping-label",
            None,
            Some(&tjo),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(
            call(
                &app,
                Method::GET,
                "/v1/templates/jane/shipping-label",
                None,
                None
            )
            .await
            .0,
            StatusCode::OK
        );

        // The hard case: john publishes under the same slug, then tries
        // to unpublish jane's. His own copy must survive.
        assert_eq!(
            publish(
                &app,
                Some(&tjo),
                "John's copy",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );
        let (s, _) = call(
            &app,
            Method::DELETE,
            "/v1/templates/jane/shipping-label",
            None,
            Some(&tjo),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(
            call(
                &app,
                Method::GET,
                "/v1/templates/john/shipping-label",
                None,
                None
            )
            .await
            .0,
            StatusCode::OK,
            "john's own same-slug template is untouched"
        );

        // The owner unpublishes.
        let (s, v) = call(
            &app,
            Method::DELETE,
            "/v1/templates/jane/shipping-label",
            None,
            Some(&tj),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["ok"], true);
        assert_eq!(
            call(
                &app,
                Method::GET,
                "/v1/templates/jane/shipping-label",
                None,
                None
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }

    async fn save_call(
        app: &Router,
        token: Option<&str>,
        owner: &str,
        slug: &str,
    ) -> (StatusCode, Value) {
        call(
            app,
            Method::POST,
            &format!("/v1/templates/{owner}/{slug}/save"),
            None,
            token,
        )
        .await
    }

    #[tokio::test]
    async fn saving_a_published_template_lists_it_back_with_documents() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        register(&app, "john", "supersecret1").await;
        let tj = token_for(&app, "jane", "supersecret1").await;
        let tjo = token_for(&app, "john", "supersecret1").await;
        assert_eq!(
            publish(
                &app,
                Some(&tj),
                "Shipping",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );

        // Saving requires a session.
        assert_eq!(
            save_call(&app, None, "jane", "shipping-label").await.0,
            StatusCode::UNAUTHORIZED
        );
        // An unknown template is a 404.
        assert_eq!(
            save_call(&app, Some(&tjo), "jane", "nope").await.0,
            StatusCode::NOT_FOUND
        );

        let (s, v) = save_call(&app, Some(&tjo), "jane", "shipping-label").await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["ok"], true);
        // Saving twice changes nothing.
        assert_eq!(
            save_call(&app, Some(&tjo), "jane", "shipping-label")
                .await
                .0,
            StatusCode::OK
        );

        // The saved list is the caller's, and carries the full documents
        // — everything an app needs to open a local copy.
        let (s, v) = call(&app, Method::GET, "/v1/saved", None, Some(&tjo)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 1);
        assert_eq!(v["items"][0]["slug"], "shipping-label");
        assert_eq!(v["items"][0]["owner"], "jane");
        assert!(v["items"][0]["template"].is_string());
        assert!(v["items"][0]["sample"].is_string());

        // jane's own list is empty — saving is per account.
        let (s, v) = call(&app, Method::GET, "/v1/saved", None, Some(&tj)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["total"], 0);
    }

    #[tokio::test]
    async fn unsaving_is_idempotent_and_unpublishing_drops_saves() {
        let app = router(state());
        register(&app, "jane", "supersecret1").await;
        register(&app, "john", "supersecret1").await;
        let tj = token_for(&app, "jane", "supersecret1").await;
        let tjo = token_for(&app, "john", "supersecret1").await;
        assert_eq!(
            publish(
                &app,
                Some(&tj),
                "Shipping",
                "shipping-label",
                label_template()
            )
            .await
            .0,
            StatusCode::CREATED
        );
        assert_eq!(
            save_call(&app, Some(&tjo), "jane", "shipping-label")
                .await
                .0,
            StatusCode::OK
        );

        // Unsave twice: the second is a plain ok, like the save.
        assert_eq!(
            call(
                &app,
                Method::DELETE,
                "/v1/templates/jane/shipping-label/save",
                None,
                Some(&tjo)
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &app,
                Method::DELETE,
                "/v1/templates/jane/shipping-label/save",
                None,
                Some(&tjo)
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, Method::GET, "/v1/saved", None, Some(&tjo))
                .await
                .1["total"],
            0
        );

        // Re-save, then the owner unpublishes — the save goes with it.
        assert_eq!(
            save_call(&app, Some(&tjo), "jane", "shipping-label")
                .await
                .0,
            StatusCode::OK
        );
        call(
            &app,
            Method::DELETE,
            "/v1/templates/jane/shipping-label",
            None,
            Some(&tj),
        )
        .await;
        let v = call(&app, Method::GET, "/v1/saved", None, Some(&tjo))
            .await
            .1;
        assert_eq!(v["total"], 0);
        // Unsaving the now-gone template is a 404, like the fetch.
        assert_eq!(
            call(
                &app,
                Method::DELETE,
                "/v1/templates/jane/shipping-label/save",
                None,
                Some(&tjo)
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
}
