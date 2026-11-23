//! The registry's HTTP surface. Increment A: health, accounts (by
//! handle), sessions, password change and handle change. Later
//! increments add publishing, the gallery and sync on the same router.
//!
//! The router is built over [`ServerState`] and held apart from the
//! socket, so the endpoints are tested with `oneshot` — no port is
//! bound.

use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::{
    self, handle_key, handle_problem, password_problem, verify_password, AuthedUser,
    MAX_SESSIONS_PER_USER, SESSION_TTL,
};
use crate::store::{now_unix, UserError};
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
}
