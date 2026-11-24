//! Account passwords, handle rules and session tokens.
//!
//! Passwords are hashed with argon2id at the old server's parameters
//! (m=19456, t=2, p=1); the PHC string carries the salt, so a hash
//! verifies with no side state. Accounts are keyed by a handle, not an
//! email: the handle is stored as typed and matched on its lowercase
//! key, so `Jane` and `jane` are the same account. A login issues a
//! high-entropy session token; only its SHA-256 hash is stored, so a
//! leaked database does not leak live sessions — the same pattern the
//! app's device pairing uses for its tokens.

use std::time::Duration;

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use axum::extract::FromRequestParts;
use axum::http::{header, request::Parts, StatusCode};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::store::now_unix;
use crate::ServerState;

/// How long a session stays valid.
pub const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

/// Password bounds (the old server's rule, kept).
pub const PASSWORD_MIN_LEN: usize = 8;
pub const PASSWORD_MAX_LEN: usize = 128;

/// Handle rules: 1 to 32 of A-Z a-z 0-9 _ -.
pub const HANDLE_MIN_LEN: usize = 1;
pub const HANDLE_MAX_LEN: usize = 32;

/// How many sessions one account keeps: logins mint a row each and
/// devices rarely log out, so the store prunes to this many.
pub const MAX_SESSIONS_PER_USER: i64 = 20;

/// Argon2id hash of a random string, generated once with the
/// production parameters. Unknown handles verify against it at login so
/// the timing matches a real password check. Never a real credential.
pub const DUMMY_HASH: &str =
    "$argon2id$v=19$m=19456,p=1,t=2$BSHKwZWRmYtcTNE5Gay2Eg$avJrUxjYLTBhKQ/qXa/0KaYxmpMiQ37w0vRTOC3151g";

/// The hasher at the old server's parameters (m=19456 KiB, t=2, p=1).
fn argon2() -> Argon2<'static> {
    let params = Params::new(19456, 2, 1, Some(32)).expect("valid argon2 parameters");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Hash a password for storage.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    argon2()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("could not hash the password: {e}"))
}

/// Verify a password against a stored PHC hash. A malformed hash is a
/// failed login, not an error — it must never panic.
pub fn verify_password(password: &str, stored: &str) -> bool {
    let Ok(hash) = PasswordHash::new(stored) else {
        return false;
    };
    argon2().verify_password(password.as_bytes(), &hash).is_ok()
}

/// What is wrong with a handle, in plain words (or nothing).
pub fn handle_problem(handle: &str) -> Option<String> {
    let h = handle.trim();
    if h.len() < HANDLE_MIN_LEN || h.len() > HANDLE_MAX_LEN {
        return Some("the handle must be 1 to 32 characters".into());
    }
    if !h
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Some("the handle may only use letters, numbers, _ and -".into());
    }
    None
}

/// What is wrong with a password, in plain words (or nothing).
pub fn password_problem(password: &str) -> Option<String> {
    if password.len() < PASSWORD_MIN_LEN {
        return Some(format!(
            "the password must be at least {PASSWORD_MIN_LEN} characters"
        ));
    }
    if password.len() > PASSWORD_MAX_LEN {
        return Some(format!(
            "the password must be at most {PASSWORD_MAX_LEN} characters"
        ));
    }
    None
}

/// The case-insensitive match key: trimmed and lowercased. The store
/// matches on this key exactly.
pub fn handle_key(handle: &str) -> String {
    handle.trim().to_lowercase()
}

/// A fresh session token: 32 random bytes as base64url — the same shape
/// as the old server's tokens.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The SHA-256 of a token, for storage and lookup.
pub fn token_hash(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex::encode(h.finalize())
}

/// The authenticated caller of a request, resolved from the
/// `Authorization: Bearer <token>` header. Rejected with a JSON `401`
/// when the header is missing, the token is unknown, or its session has
/// expired (the registry's contract: all bodies are JSON, including
/// errors).
pub struct AuthedUser {
    pub id: String,
    pub handle: String,
    /// The account's match key, so a handle change can see whether it is
    /// a case-only rename.
    pub handle_key: String,
    /// The raw token, so the handler can keep or revoke this session.
    pub token: String,
    /// The stored hash, so a password change can verify the current
    /// password without a second query.
    pub password_hash: String,
}

impl FromRequestParts<ServerState> for AuthedUser {
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &ServerState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts).ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "no session token" })),
        ))?;
        let th = token_hash(&token);
        let user_id = state
            .store
            .find_session(&th, now_unix())
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "the registry hit a problem" })),
                )
            })?
            .ok_or((
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "no session token" })),
            ))?;
        let rec = state
            .store
            .find_user_record(&user_id)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "the registry hit a problem" })),
                )
            })?
            .ok_or((
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "no session token" })),
            ))?;
        Ok(AuthedUser {
            id: rec.id,
            handle: rec.handle,
            handle_key: rec.handle_key,
            token,
            password_hash: rec.password_hash,
        })
    }
}

/// The bearer token in the `Authorization` header, if present.
fn bearer_token(parts: &Parts) -> Option<String> {
    let header = parts.headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = header.strip_prefix("Bearer ")?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_hash_verifies_only_its_own_password() {
        let h = hash_password("correct horse battery").expect("the hash is made");
        assert!(
            h.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"),
            "the agreed parameters: {h}"
        );
        assert!(verify_password("correct horse battery", &h));
        assert!(!verify_password("correct horse batteri", &h));
        // A different salt each time: two hashes of the same password
        // differ, yet both verify.
        let h2 = hash_password("correct horse battery").unwrap();
        assert_ne!(h, h2);
        assert!(verify_password("correct horse battery", &h2));
    }

    #[test]
    fn a_malformed_stored_hash_is_a_failed_login_not_a_panic() {
        assert!(!verify_password("x", "not a phc hash"));
        assert!(!verify_password("x", ""));
    }

    #[test]
    fn a_handle_is_1_to_32_letters_digits_underscore_dash() {
        assert_eq!(handle_problem("jane"), None);
        assert_eq!(handle_problem("Jane_D-2"), None);
        // Trimmed first, like the old server.
        assert_eq!(handle_problem("  jane  "), None);
        assert!(handle_problem("").is_some(), "empty is too short");
        assert!(handle_problem(&"a".repeat(33)).is_some(), "33 is too long");
        assert_eq!(handle_problem(&"a".repeat(32)), None);
        assert!(handle_problem("has space").is_some());
        assert!(handle_problem("dot.ted").is_some());
        assert!(handle_problem("ünïcode").is_some());
    }

    #[test]
    fn the_match_key_is_trimmed_and_lowercased() {
        assert_eq!(handle_key("  JaneDoe "), "janedoe");
        assert_eq!(handle_key("AL"), "al");
    }

    #[test]
    fn a_password_is_8_to_128_characters() {
        assert_eq!(password_problem("12345678"), None);
        assert_eq!(password_problem(&"x".repeat(128)), None);
        assert!(password_problem("1234567").is_some());
        assert!(password_problem(&"x".repeat(129)).is_some());
    }

    #[test]
    fn tokens_are_base64url_and_their_hash_is_stable() {
        let t1 = new_token();
        let t2 = new_token();
        assert_ne!(t1, t2);
        assert!(
            t1.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "base64url: {t1}"
        );
        let h = token_hash(&t1);
        assert_eq!(h.len(), 64); // sha-256, hex
        assert_eq!(h, token_hash(&t1), "the hash is deterministic");
        assert_ne!(h, token_hash(&t2));
    }

    #[test]
    fn a_bearer_token_is_extracted_only_from_a_well_formed_header() {
        use axum::http::Request;
        fn parts_with(header: Option<&str>) -> Parts {
            let mut req = Request::builder().uri("/");
            if let Some(h) = header {
                req = req.header(header::AUTHORIZATION, h);
            }
            req.body(()).expect("a request").into_parts().0
        }
        assert_eq!(
            bearer_token(&parts_with(Some("Bearer abc123"))),
            Some("abc123".into())
        );
        assert_eq!(bearer_token(&parts_with(Some("  Bearer abc"))), None);
        assert_eq!(bearer_token(&parts_with(Some("Basic abc"))), None);
        assert_eq!(bearer_token(&parts_with(Some("Bearer "))), None);
        assert_eq!(bearer_token(&parts_with(None)), None);
    }
}
