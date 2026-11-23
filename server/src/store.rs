//! The registry database: accounts and sessions (increment A). Later
//! increments add templates, saved templates and the offline-first sync
//! state on top of the same connection.
//!
//! `rusqlite::Connection` is not `Sync`, and the router's state is shared
//! across tasks, so the lock is part of the type (the same pattern the
//! app's local store uses).
//!
//! The schema and every query are plain portable SQLite — no
//! local-file-only pragmas in the schema itself (WAL is set per-backend
//! at open time) and no driver-specific error-code matching — so the
//! production backend, Turso (cloud SQLite over `libsql`), can back this
//! same store without the SQL changing.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

/// One account, the public shape the API returns.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub handle: String,
}

/// A user row with its password hash and match key, read only for
/// authentication and account changes.
pub struct UserRecord {
    pub id: String,
    pub handle: String,
    pub handle_key: String,
    pub password_hash: String,
}

/// Why creating or renaming an account failed.
#[derive(Debug, thiserror::Error)]
pub enum UserError {
    /// A handle like that (case-insensitive) is already taken.
    #[error("a handle like that is already taken")]
    HandleExists,
    /// Any other database trouble, in plain words.
    #[error("{0}")]
    Other(String),
}

/// The schema so far. Tables are added idempotently as later increments
/// land; the database version tracks how far the migrations have run.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    handle        TEXT NOT NULL,
    handle_key    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
"#;

pub struct Store {
    conn: Mutex<Connection>,
}

/// The current Unix time in seconds — the unit every timestamp is stored
/// in, so "is this session still valid" is a plain integer compare.
pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Store {
    /// Open the database at `path`, creating the file and its schema
    /// when they do not exist yet.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("cannot create the data directory {}: {e}", parent.display())
            })?;
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("cannot open the store at {path:?}: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("cannot set the store's journal mode: {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("cannot create the store's schema: {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// An in-memory store with the schema created — the tests build their
    /// state on it.
    #[cfg(test)]
    pub(crate) fn in_memory() -> Result<Self, String> {
        let conn =
            Connection::open_in_memory().map_err(|e| format!("cannot open the store: {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("cannot create the store's schema: {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .expect("a panicked thread must not wedge the store for everyone")
    }

    /// Create an account. `HandleExists` when the handle is taken. The
    /// taken-handle check is a query, not a driver-specific error code,
    /// so the same logic runs on Turso; the UNIQUE index stays as the
    /// integrity backstop for the (rare) concurrent-insert race.
    pub fn create_user(
        &self,
        id: &str,
        handle: &str,
        handle_key: &str,
        password_hash: &str,
        created_at: i64,
    ) -> Result<(), UserError> {
        if self
            .find_user_by_handle_key(handle_key)
            .map_err(UserError::Other)?
            .is_some()
        {
            return Err(UserError::HandleExists);
        }
        match self.lock().execute(
            "INSERT INTO users (id, handle, handle_key, password_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, handle, handle_key, password_hash, created_at],
        ) {
            Ok(_) => Ok(()),
            Err(e) => {
                // If the handle is visible now, a concurrent insert won
                // the race — report it the same way the pre-check does.
                if self
                    .find_user_by_handle_key(handle_key)
                    .map_err(UserError::Other)?
                    .is_some()
                {
                    Err(UserError::HandleExists)
                } else {
                    Err(UserError::Other(e.to_string()))
                }
            }
        }
    }

    /// The account with this match key, if any.
    pub fn find_user_by_handle_key(&self, handle_key: &str) -> Result<Option<UserRecord>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, handle, handle_key, password_hash FROM users WHERE handle_key = ?1",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![handle_key], |r| {
            Ok(UserRecord {
                id: r.get(0)?,
                handle: r.get(1)?,
                handle_key: r.get(2)?,
                password_hash: r.get(3)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
    }

    /// The account with this id, if any.
    pub fn find_user_record(&self, id: &str) -> Result<Option<UserRecord>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT id, handle, handle_key, password_hash FROM users WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |r| {
            Ok(UserRecord {
                id: r.get(0)?,
                handle: r.get(1)?,
                handle_key: r.get(2)?,
                password_hash: r.get(3)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Replace an account's password hash.
    pub fn update_password_hash(&self, id: &str, password_hash: &str) -> Result<(), String> {
        self.lock()
            .execute(
                "UPDATE users SET password_hash = ?1 WHERE id = ?2",
                params![password_hash, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Rename an account: the handle as typed and its match key. The id
    /// never changes, so sessions and, later, ownership are unaffected.
    pub fn update_handle(&self, id: &str, handle: &str, handle_key: &str) -> Result<(), String> {
        self.lock()
            .execute(
                "UPDATE users SET handle = ?1, handle_key = ?2 WHERE id = ?3",
                params![handle, handle_key, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Record a session: the SHA-256 hash of a fresh token, bound to a
    /// user, valid until `expires_at`.
    pub fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        created_at: i64,
        expires_at: i64,
    ) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![token_hash, user_id, created_at, expires_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// The session a token belongs to — its user id — if it still exists
    /// and has not expired. `now` is the current Unix time.
    pub fn find_session(&self, token_hash: &str, now: i64) -> Result<Option<String>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![token_hash, now], |r| r.get::<_, String>(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Revoke one session. Idempotent: an unknown token deletes nothing.
    pub fn delete_session(&self, token_hash: &str) -> Result<(), String> {
        self.lock()
            .execute(
                "DELETE FROM sessions WHERE token_hash = ?1",
                params![token_hash],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// End every session of a user except the one whose hash is
    /// `keep_token_hash` (pass an empty string to end all of them, as a
    /// password reset would). Returns how many were ended.
    pub fn delete_others_for_user(
        &self,
        user_id: &str,
        keep_token_hash: &str,
    ) -> Result<u64, String> {
        self.lock()
            .execute(
                "DELETE FROM sessions WHERE user_id = ?1 AND token_hash <> ?2",
                params![user_id, keep_token_hash],
            )
            .map(|n| n as u64)
            .map_err(|e| e.to_string())
    }

    /// Keep at most `keep` of a user's newest sessions; logins mint a
    /// row each and devices rarely log out, so without this one account
    /// would grow a row per login until the TTL purge.
    pub fn prune_sessions(&self, user_id: &str, keep: i64) -> Result<u64, String> {
        self.lock()
            .execute(
                "DELETE FROM sessions WHERE user_id = ?1 AND token_hash NOT IN (
                    SELECT token_hash FROM sessions WHERE user_id = ?1
                    ORDER BY created_at DESC LIMIT ?2
                 )",
                params![user_id, keep],
            )
            .map(|n| n as u64)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::in_memory().expect("the in-memory store opens")
    }

    #[test]
    fn an_account_is_created_and_found_by_its_match_key() {
        let s = store();
        s.create_user("u1", "JaneDoe", "janedoe", "hash", 0)
            .expect("the first account is created");
        // The match is exact on the key; case-insensitivity is the
        // caller's job (auth::handle_key lowercases before calling).
        let rec = s
            .find_user_by_handle_key("janedoe")
            .unwrap()
            .expect("the key resolves");
        assert_eq!(rec.id, "u1");
        assert_eq!(rec.handle, "JaneDoe");
        assert_eq!(rec.password_hash, "hash");
        let rec = s.find_user_record("u1").unwrap().expect("the id resolves");
        assert_eq!(rec.handle_key, "janedoe");
    }

    #[test]
    fn a_taken_handle_is_reported_not_overwritten() {
        let s = store();
        s.create_user("u1", "al", "al", "h1", 0).unwrap();
        let err = s
            .create_user("u2", "AL", "al", "h2", 0)
            .expect_err("a second account with the same handle must fail");
        assert!(matches!(err, UserError::HandleExists), "got: {err:?}");
        // The original account is untouched.
        let rec = s.find_user_by_handle_key("al").unwrap().unwrap();
        assert_eq!(rec.id, "u1");
        assert_eq!(rec.password_hash, "h1");
    }

    #[test]
    fn an_account_can_change_its_handle_and_password() {
        let s = store();
        s.create_user("u1", "al", "al", "h1", 0).unwrap();
        s.update_handle("u1", "alice", "alice").unwrap();
        s.update_password_hash("u1", "h2").unwrap();
        assert!(
            s.find_user_by_handle_key("al").unwrap().is_none(),
            "the old key is gone"
        );
        let rec = s
            .find_user_by_handle_key("alice")
            .unwrap()
            .expect("the new key resolves");
        assert_eq!(rec.handle, "alice");
        assert_eq!(rec.password_hash, "h2");
        assert_eq!(rec.id, "u1", "the id never changes");
    }

    #[test]
    fn a_session_resolves_its_user_until_it_expires() {
        let s = store();
        s.create_user("u1", "al", "al", "h", 0).unwrap();
        s.create_session("tok1", "u1", 1000, 2000).unwrap();
        assert_eq!(s.find_session("tok1", 1999).unwrap().as_deref(), Some("u1"));
        // At the expiry second the session is gone (expires_at > now).
        assert_eq!(s.find_session("tok1", 2000).unwrap(), None);
        // An unknown token is never a session.
        assert_eq!(s.find_session("nope", 1500).unwrap(), None);
    }

    #[test]
    fn a_session_can_be_revoked() {
        let s = store();
        s.create_user("u1", "al", "al", "h", 0).unwrap();
        s.create_session("tok1", "u1", 1000, 2000).unwrap();
        s.create_session("tok2", "u1", 1001, 2000).unwrap();
        assert_eq!(s.find_session("tok1", 1500).unwrap(), Some("u1".into()));
        s.delete_session("tok1").unwrap();
        assert_eq!(s.find_session("tok1", 1500).unwrap(), None);
        s.delete_session("tok1").unwrap(); // idempotent
    }

    #[test]
    fn other_sessions_can_be_ended_excluding_one() {
        let s = store();
        s.create_user("u1", "al", "al", "h", 0).unwrap();
        s.create_user("u2", "bo", "bo", "h", 0).unwrap();
        s.create_session("t1", "u1", 1, 9).unwrap();
        s.create_session("t2", "u1", 2, 9).unwrap();
        s.create_session("t3", "u2", 3, 9).unwrap();
        let n = s.delete_others_for_user("u1", "t2").unwrap();
        assert_eq!(n, 1, "only the non-kept session of the user is ended");
        assert_eq!(s.find_session("t1", 5).unwrap(), None);
        assert_eq!(s.find_session("t2", 5).unwrap(), Some("u1".into()));
        assert_eq!(
            s.find_session("t3", 5).unwrap(),
            Some("u2".into()),
            "other users are untouched"
        );
    }

    #[test]
    fn sessions_are_pruned_to_the_newest_keep() {
        let s = store();
        s.create_user("u1", "al", "al", "h", 0).unwrap();
        for i in 1..=5 {
            s.create_session(&format!("t{i}"), "u1", i as i64, 100)
                .unwrap();
        }
        let n = s.prune_sessions("u1", 2).unwrap();
        assert_eq!(n, 3, "the three oldest are dropped");
        assert_eq!(s.find_session("t1", 50).unwrap(), None);
        assert_eq!(s.find_session("t4", 50).unwrap(), Some("u1".into()));
        assert_eq!(s.find_session("t5", 50).unwrap(), Some("u1".into()));
    }

    #[test]
    fn the_real_file_store_round_trips() {
        let dir = std::env::temp_dir().join(format!("pn-server-store-{}", std::process::id()));
        let path = dir.join("registry.db");
        {
            let s = Store::open(&path).expect("the file store opens");
            s.create_user("u1", "al", "al", "h", 0).unwrap();
            s.create_session("tok1", "u1", 0, 1_000_000).unwrap();
        }
        // Reopening the same file finds the same account (WAL is clean).
        let s = Store::open(&path).expect("reopening works");
        assert!(s.find_user_by_handle_key("al").unwrap().is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
