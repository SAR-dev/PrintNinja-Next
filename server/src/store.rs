//! The registry database: accounts and sessions (increment A), published
//! templates (increment B), saved templates (increment C). Later
//! increments add the offline-first sync state on top of the same
//! connection.
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

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

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

/// A published template. Gallery listings carry only the card's fields;
/// fetching one fills in `template` and `sample` — everything a saved
/// local copy needs to open and print at once.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub slug: String,
    pub name: String,
    /// The owner's handle, as typed.
    pub owner: String,
    pub readme: String,
    /// "scene" or "document".
    pub track: String,
    /// The template document, as JSON text (on the fetch only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// Starting records for the data fields, as JSON text (on the fetch
    /// only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// The parts of a new template the caller supplies; the store fills in
/// the owner, the timestamps and the row id.
#[derive(Debug)]
pub struct NewTemplate {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub readme: String,
    /// "scene" or "document".
    pub track: String,
    /// The template document, as JSON text.
    pub template: String,
    /// Starting records for the data fields, as JSON text.
    pub sample: String,
}

/// Why publishing a template failed.
#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    /// That slug is already published on this account.
    #[error("that slug is already taken on this account")]
    SlugExists,
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
CREATE TABLE IF NOT EXISTS templates (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT NOT NULL,
    name       TEXT NOT NULL,
    readme     TEXT NOT NULL,
    track      TEXT NOT NULL,
    template   TEXT NOT NULL,
    sample     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (owner_id, slug)
);
CREATE INDEX IF NOT EXISTS templates_track ON templates (track);
CREATE INDEX IF NOT EXISTS templates_owner ON templates (owner_id);
CREATE TABLE IF NOT EXISTS saved_templates (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    saved_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, template_id)
);
CREATE INDEX IF NOT EXISTS saved_templates_template ON saved_templates (template_id);
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

    /// Publish a template. `SlugExists` when the account already has a
    /// template under that slug. Like `create_user`, the taken check is
    /// a query, not a driver-specific error code, so it runs on Turso;
    /// the `UNIQUE (owner_id, slug)` index stays as the integrity
    /// backstop for the (rare) concurrent-insert race.
    pub fn create_template(
        &self,
        owner_id: &str,
        t: &NewTemplate,
        now: i64,
    ) -> Result<(), TemplateError> {
        if self
            .slug_is_taken(owner_id, &t.slug)
            .map_err(TemplateError::Other)?
            .is_some()
        {
            return Err(TemplateError::SlugExists);
        }
        match self.lock().execute(
            "INSERT INTO templates
                 (id, owner_id, slug, name, readme, track, template, sample,
                  created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                t.id, owner_id, t.slug, t.name, t.readme, t.track, t.template, t.sample, now, now
            ],
        ) {
            Ok(_) => Ok(()),
            Err(e) => {
                // If the slug is visible now, a concurrent insert won
                // the race — report it the same way the pre-check does.
                if self
                    .slug_is_taken(owner_id, &t.slug)
                    .map_err(TemplateError::Other)?
                    .is_some()
                {
                    Err(TemplateError::SlugExists)
                } else {
                    Err(TemplateError::Other(e.to_string()))
                }
            }
        }
    }

    /// Whether this account already publishes a template under `slug`.
    fn slug_is_taken(&self, owner_id: &str, slug: &str) -> Result<Option<i64>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT 1 FROM templates WHERE owner_id = ?1 AND slug = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![owner_id, slug], |r| r.get::<_, i64>(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    /// The template an owner (by match key, so the caller passes
    /// `handle_key`) published under `slug`, with its full document, if
    /// any.
    pub fn find_template(&self, owner_key: &str, slug: &str) -> Result<Option<Template>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.slug, t.name, u.handle, t.readme, t.track,
                        t.template, t.sample, t.created_at, t.updated_at
                 FROM templates t JOIN users u ON u.id = t.owner_id
                 WHERE u.handle_key = ?1 AND t.slug = ?2",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![owner_key, slug], |r| {
            Ok(Template {
                id: r.get(0)?,
                slug: r.get(1)?,
                name: r.get(2)?,
                owner: r.get(3)?,
                readme: r.get(4)?,
                track: r.get(5)?,
                template: Some(r.get(6)?),
                sample: Some(r.get(7)?),
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
    }

    /// A page of the community gallery, newest first. `q`, when
    /// non-empty, is a case-insensitive substring match on the name,
    /// the readme or the owner's handle (plain `LIKE`, the same way the
    /// old server searched); `track` narrows to one of the two tracks.
    /// Returns the page's cards (without the documents) and the total
    /// count that the filters match.
    pub fn list_templates(
        &self,
        q: Option<&str>,
        track: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Template>, i64), String> {
        let conn = self.lock();

        // Build the filter with positional parameters, so the same
        // where-clause serves the page query and the count query.
        let mut where_sql = String::from("1 = 1");
        let mut args: Vec<String> = Vec::new();
        if let Some(q) = q.filter(|q| !q.is_empty()) {
            let (n1, n2, n3) = (args.len() + 1, args.len() + 2, args.len() + 3);
            where_sql.push_str(&format!(
                " AND (t.name LIKE ?{n1} OR t.readme LIKE ?{n2} OR u.handle LIKE ?{n3})"
            ));
            let like = format!("%{q}%");
            args.extend([like.clone(), like.clone(), like]);
        }
        if let Some(track) = track.filter(|t| !t.is_empty()) {
            let n = args.len() + 1;
            where_sql.push_str(&format!(" AND t.track = ?{n}"));
            args.push(track.to_string());
        }

        let limit_p = args.len() + 1;
        let offset_p = args.len() + 2;
        let list_sql = format!(
            "SELECT t.id, t.slug, t.name, u.handle, t.readme, t.track,
                    t.created_at, t.updated_at
             FROM templates t JOIN users u ON u.id = t.owner_id
             WHERE {where_sql}
             ORDER BY t.updated_at DESC, t.id DESC
             LIMIT ?{limit_p} OFFSET ?{offset_p}"
        );
        let count_sql = format!(
            "SELECT COUNT(*)
             FROM templates t JOIN users u ON u.id = t.owner_id
             WHERE {where_sql}"
        );

        let mut list_args = args.clone();
        list_args.push(limit.to_string());
        list_args.push(offset.to_string());
        let mut stmt = conn.prepare(&list_sql).map_err(|e| e.to_string())?;
        let items = stmt
            .query_map(params_from_iter(list_args.iter()), |r| {
                Ok(Template {
                    id: r.get(0)?,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    owner: r.get(3)?,
                    readme: r.get(4)?,
                    track: r.get(5)?,
                    template: None,
                    sample: None,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut stmt = conn.prepare(&count_sql).map_err(|e| e.to_string())?;
        let total = stmt
            .query_row(params_from_iter(args.iter()), |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        Ok((items, total))
    }

    /// Unpublish a template. Returns how many rows went; 0 when the
    /// account has nothing under that slug.
    pub fn delete_template(&self, owner_id: &str, slug: &str) -> Result<u64, String> {
        let conn = self.lock();
        // Saved copies die with the template. Done explicitly — SQLite
        // foreign-key enforcement is a per-connection pragma a remote
        // backend may not share, and the ON DELETE CASCADE clause is
        // the backstop, not the mechanism.
        conn.execute(
            "DELETE FROM saved_templates WHERE template_id IN (
                 SELECT id FROM templates WHERE owner_id = ?1 AND slug = ?2)",
            params![owner_id, slug],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM templates WHERE owner_id = ?1 AND slug = ?2",
            params![owner_id, slug],
        )
        .map(|n| n as u64)
        .map_err(|e| e.to_string())
    }

    /// Mark a published template as saved by an account. Idempotent:
    /// saving the same template twice changes nothing.
    pub fn save_template(
        &self,
        user_id: &str,
        template_id: &str,
        saved_at: i64,
    ) -> Result<u64, String> {
        self.lock()
            .execute(
                "INSERT OR IGNORE INTO saved_templates (user_id, template_id, saved_at)
                 VALUES (?1, ?2, ?3)",
                params![user_id, template_id, saved_at],
            )
            .map(|n| n as u64)
            .map_err(|e| e.to_string())
    }

    /// Stop saving a published template. Idempotent: unsaving something
    /// not saved changes nothing.
    pub fn unsave_template(&self, user_id: &str, template_id: &str) -> Result<u64, String> {
        self.lock()
            .execute(
                "DELETE FROM saved_templates WHERE user_id = ?1 AND template_id = ?2",
                params![user_id, template_id],
            )
            .map(|n| n as u64)
            .map_err(|e| e.to_string())
    }

    /// Everything an account has saved, with the full documents — the
    /// app materializes its editable local copies from this list.
    /// Newest save first.
    pub fn list_saved(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Template>, i64), String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.slug, t.name, u.handle, t.readme, t.track,
                        t.template, t.sample, t.created_at, t.updated_at
                 FROM saved_templates s
                 JOIN templates t ON t.id = s.template_id
                 JOIN users u ON u.id = t.owner_id
                 WHERE s.user_id = ?1
                 ORDER BY s.saved_at DESC, t.id DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| e.to_string())?;
        let items = stmt
            .query_map(params![user_id, limit, offset], |r| {
                Ok(Template {
                    id: r.get(0)?,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    owner: r.get(3)?,
                    readme: r.get(4)?,
                    track: r.get(5)?,
                    template: Some(r.get(6)?),
                    sample: Some(r.get(7)?),
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM saved_templates WHERE user_id = ?1",
                params![user_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok((items, total))
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

    /// A template with the documents pinned to the shortest JSON.
    fn new_template(id: &str, slug: &str, name: &str, readme: &str, track: &str) -> NewTemplate {
        NewTemplate {
            id: id.into(),
            slug: slug.into(),
            name: name.into(),
            readme: readme.into(),
            track: track.into(),
            template: "{}".into(),
            sample: "[]".into(),
        }
    }

    #[test]
    fn a_template_is_published_and_found_by_owner_and_slug() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_template(
            "u1",
            &new_template("t1", "shipping", "Shipping label", "A 58mm label", "scene"),
            10,
        )
        .expect("the first publish is created");
        // Found by the owner's match key, not the id.
        let t = s
            .find_template("jane", "shipping")
            .unwrap()
            .expect("the fetch resolves");
        assert_eq!(t.id, "t1");
        assert_eq!(t.owner, "jane");
        assert_eq!(t.name, "Shipping label");
        assert_eq!(t.readme, "A 58mm label");
        assert_eq!(t.track, "scene");
        assert_eq!(t.template.as_deref(), Some("{}"));
        assert_eq!(t.sample.as_deref(), Some("[]"));
        // The store matches the key exactly; case-folding is the
        // router's job (handle_key), which the fetch test covers.
        assert!(s.find_template("jane", "shipping").unwrap().is_some());
        assert!(s.find_template("jane", "missing").unwrap().is_none());
    }

    #[test]
    fn a_slug_is_unique_per_owner_not_global() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_user("u2", "john", "john", "h", 0).unwrap();
        s.create_template("u1", &new_template("t1", "shipping", "A", "", "scene"), 10)
            .unwrap();
        // A different owner may use the same slug.
        s.create_template("u2", &new_template("t2", "shipping", "B", "", "scene"), 11)
            .expect("slugs are per account, not global");
        // ...but the same account cannot.
        let err = s
            .create_template("u1", &new_template("t3", "shipping", "C", "", "scene"), 12)
            .expect_err("the second publish under the slug must fail");
        assert!(matches!(err, TemplateError::SlugExists), "got: {err:?}");
        // The first one is untouched.
        assert_eq!(
            s.find_template("jane", "shipping").unwrap().unwrap().name,
            "A"
        );
    }

    #[test]
    fn the_gallery_finds_templates_by_name_readme_owner_and_track() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_user("u2", "john", "john", "h", 0).unwrap();
        s.create_template(
            "u1",
            &new_template("t1", "shipping", "Shipping label", "For parcels", "scene"),
            10,
        )
        .unwrap();
        s.create_template(
            "u2",
            &new_template(
                "t2",
                "page-one",
                "Invoice",
                "One page per order",
                "document",
            ),
            11,
        )
        .unwrap();

        // By name.
        let (items, total) = s.list_templates(Some("shipping"), None, 20, 0).unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].id, "t1");
        assert!(items[0].template.is_none(), "cards carry no documents");
        // By readme (case-insensitive).
        let (items, _) = s
            .list_templates(Some("PAGE per order"), None, 20, 0)
            .unwrap();
        assert_eq!(items[0].id, "t2");
        // By the owner's handle.
        let (items, _) = s.list_templates(Some("jane"), None, 20, 0).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "t1");
        // No search matches everything.
        let (_, total) = s.list_templates(None, None, 20, 0).unwrap();
        assert_eq!(total, 2);
        // The track filter narrows.
        let (items, total) = s.list_templates(None, Some("document"), 20, 0).unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].track, "document");
    }

    #[test]
    fn the_gallery_pages_newest_first() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        for (i, (id, updated)) in [("a", 10i64), ("b", 30), ("c", 20)].into_iter().enumerate() {
            s.create_template(
                "u1",
                &new_template(&format!("t{id}"), &format!("slug-{i}"), id, "", "scene"),
                updated,
            )
            .unwrap();
        }
        let (items, total) = s.list_templates(None, None, 2, 0).unwrap();
        assert_eq!(total, 3);
        assert_eq!(
            items.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            ["b", "c"],
            "newest first"
        );
        let (items, _) = s.list_templates(None, None, 2, 2).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a");
    }

    #[test]
    fn unpublishing_removes_the_template() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_template("u1", &new_template("t1", "shipping", "A", "", "scene"), 10)
            .unwrap();
        assert_eq!(s.delete_template("u1", "shipping").unwrap(), 1);
        assert!(s.find_template("jane", "shipping").unwrap().is_none());
        // Idempotent: a second delete removes nothing.
        assert_eq!(s.delete_template("u1", "shipping").unwrap(), 0);
    }

    #[test]
    fn a_template_is_saved_found_and_unsaved() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_user("u2", "john", "john", "h", 0).unwrap();
        s.create_template(
            "u1",
            &new_template("t1", "shipping", "Shipping label", "For parcels", "scene"),
            10,
        )
        .unwrap();

        // john saves jane's template.
        assert_eq!(s.save_template("u2", "t1", 20).unwrap(), 1);
        // Saving twice changes nothing.
        assert_eq!(s.save_template("u2", "t1", 21).unwrap(), 0);

        // The saved list carries the full documents, owner included.
        let (items, total) = s.list_saved("u2", 20, 0).unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].id, "t1");
        assert_eq!(items[0].owner, "jane");
        assert_eq!(items[0].template.as_deref(), Some("{}"));
        assert_eq!(items[0].sample.as_deref(), Some("[]"));

        // jane did not save it, so her list is empty.
        assert_eq!(s.list_saved("u1", 20, 0).unwrap().0.len(), 0);

        // Unsave is idempotent too.
        assert_eq!(s.unsave_template("u2", "t1").unwrap(), 1);
        assert_eq!(s.unsave_template("u2", "t1").unwrap(), 0);
        assert_eq!(s.list_saved("u2", 20, 0).unwrap().0.len(), 0);
    }

    #[test]
    fn a_saved_template_list_orders_newest_save_first() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_user("u2", "john", "john", "h", 0).unwrap();
        for (id, saved_at) in [("a", 10i64), ("b", 30), ("c", 20)] {
            s.create_template("u1", &new_template(id, id, id, "", "scene"), saved_at)
                .unwrap();
        }
        // Saved in a different order than they were published.
        s.save_template("u2", "a", 100).unwrap();
        s.save_template("u2", "c", 300).unwrap();
        s.save_template("u2", "b", 200).unwrap();
        let (items, total) = s.list_saved("u2", 20, 0).unwrap();
        assert_eq!(total, 3);
        assert_eq!(
            items.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["c", "b", "a"],
            "newest save first"
        );
        // Paging.
        let (items, _) = s.list_saved("u2", 2, 0).unwrap();
        assert_eq!(items.len(), 2);
        let (items, _) = s.list_saved("u2", 2, 2).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "a");
    }

    #[test]
    fn unpublishing_drops_the_saves_that_point_at_it() {
        let s = store();
        s.create_user("u1", "jane", "jane", "h", 0).unwrap();
        s.create_user("u2", "john", "john", "h", 0).unwrap();
        s.create_template("u1", &new_template("t1", "shipping", "A", "", "scene"), 10)
            .unwrap();
        s.save_template("u2", "t1", 20).unwrap();
        assert_eq!(s.list_saved("u2", 20, 0).unwrap().0.len(), 1);

        // jane unpublishes; john's save must go with the row.
        s.delete_template("u1", "shipping").unwrap();
        let (items, total) = s.list_saved("u2", 20, 0).unwrap();
        assert_eq!(total, 0);
        assert_eq!(items.len(), 0);
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
