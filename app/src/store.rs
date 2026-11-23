//! Local persistence (plan phase 7): the templates, the recent jobs
//! and the settings live in one SQLite file in the app's data
//! directory, owned by this crate. The schema is created on open, so
//! the file is self-describing. Everything is stored as text — the
//! template, transport and report columns are JSON text the UI already
//! speaks — so a column layout change never needs a migration in the
//! v1 sense: the UI re-serializes what it has.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// How many recent jobs the app keeps, on disk and in the list.
pub const RECENT_LIMIT: usize = 10;

/// A template row: the fields the UI keeps, the template itself as
/// JSON text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    /// "scene" or "document".
    pub track: String,
    /// The template document, as JSON text.
    pub template: String,
    /// The data field's starting records, as JSON text.
    pub sample: String,
}

/// A recent-job row: the job frozen at print time, with the result of
/// its latest run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredJob {
    pub id: String,
    pub template_name: String,
    /// The template as it was when the job printed, as JSON text.
    pub template: String,
    /// "scene" or "document".
    pub track: String,
    pub profile: String,
    pub data: String,
    pub copies: u32,
    /// The transport, as JSON text.
    pub transport: String,
    /// The job report, as JSON text.
    pub result: String,
    /// When it last ran, as `Date.now()` milliseconds.
    pub at: i64,
}

/// The app's storage: one SQLite connection behind a mutex.
/// `rusqlite::Connection` is not `Sync` and Tauri's managed state must
/// be, so the lock is part of the type.
pub struct Store {
    conn: Mutex<Connection>,
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

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .expect("a panicked thread must not wedge the store for everyone")
    }

    /// All the saved templates, in the order they were saved.
    pub fn load_templates(&self) -> Result<Vec<StoredTemplate>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT id, name, description, track, template, sample FROM templates")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(StoredTemplate {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    track: r.get(3)?,
                    template: r.get(4)?,
                    sample: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Save or replace one template.
    pub fn save_template(&self, t: &StoredTemplate) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT OR REPLACE INTO templates (id, name, description, track, template, sample)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![t.id, t.name, t.description, t.track, t.template, t.sample],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// The recent jobs, newest first, the kept limit at most.
    pub fn load_recent_jobs(&self) -> Result<Vec<StoredJob>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, template_name, template, track, profile, data, copies,
                        transport, result, at
                 FROM recent_jobs ORDER BY at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![RECENT_LIMIT as i64], job_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Remember a job (or refresh its result when it ran again) and
    /// keep only the newest `RECENT_LIMIT`.
    pub fn remember_job(&self, j: &StoredJob) -> Result<(), String> {
        let conn = self.lock();
        conn.execute(
            "INSERT OR REPLACE INTO recent_jobs
                 (id, template_name, template, track, profile, data, copies,
                  transport, result, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                j.id,
                j.template_name,
                j.template,
                j.track,
                j.profile,
                j.data,
                j.copies,
                j.transport,
                j.result,
                j.at
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM recent_jobs
             WHERE id NOT IN (SELECT id FROM recent_jobs ORDER BY at DESC LIMIT ?1)",
            params![RECENT_LIMIT as i64],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// All the saved settings, key to value.
    pub fn load_settings(&self) -> Result<BTreeMap<String, String>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings ORDER BY key")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<BTreeMap<String, String>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Save or replace one setting.
    pub fn save_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  track TEXT NOT NULL,
  template TEXT NOT NULL,
  sample TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recent_jobs (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  template TEXT NOT NULL,
  track TEXT NOT NULL,
  profile TEXT NOT NULL,
  data TEXT NOT NULL,
  copies INTEGER NOT NULL,
  transport TEXT NOT NULL,
  result TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

fn job_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<StoredJob> {
    Ok(StoredJob {
        id: r.get(0)?,
        template_name: r.get(1)?,
        template: r.get(2)?,
        track: r.get(3)?,
        profile: r.get(4)?,
        data: r.get(5)?,
        copies: r.get(6)?,
        transport: r.get(7)?,
        result: r.get(8)?,
        at: r.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        let s = Store {
            conn: Mutex::new(Connection::open_in_memory().expect("an in-memory store must open")),
        };
        s.lock()
            .execute_batch(SCHEMA)
            .expect("the schema must create");
        s
    }

    fn template(id: &str) -> StoredTemplate {
        StoredTemplate {
            id: id.into(),
            name: format!("T {id}"),
            description: "a template".into(),
            track: "scene".into(),
            template: r#"{"format":"scene"}"#.into(),
            sample: "[]".into(),
        }
    }

    fn job(id: &str, at: i64) -> StoredJob {
        StoredJob {
            id: id.into(),
            template_name: "Parts label".into(),
            template: r#"{"format":"scene"}"#.into(),
            track: "scene".into(),
            profile: "GK420d".into(),
            data: "[{\"name\":\"bolt\"}]".into(),
            copies: 1,
            transport: r#"{"kind":"tcp","host":"127.0.0.1","port":9100}"#.into(),
            result: r#"{"result":"confirmed","counts":null,"reason":null}"#.into(),
            at,
        }
    }

    #[test]
    fn a_saved_template_comes_back() {
        let s = store();
        s.save_template(&template("a")).unwrap();
        let rows = s.load_templates().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "a");
        assert_eq!(rows[0].name, "T a");
        assert_eq!(rows[0].template, r#"{"format":"scene"}"#);
    }

    #[test]
    fn saving_the_same_id_replaces_the_row() {
        let s = store();
        s.save_template(&template("a")).unwrap();
        let mut t = template("a");
        t.name = "renamed".into();
        s.save_template(&t).unwrap();
        let rows = s.load_templates().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "renamed");
    }

    #[test]
    fn the_recent_list_keeps_the_ten_newest() {
        let s = store();
        for i in 0..12 {
            s.remember_job(&job(&format!("j{i}"), i)).unwrap();
        }
        let rows = s.load_recent_jobs().unwrap();
        assert_eq!(rows.len(), RECENT_LIMIT);
        // Newest first.
        assert_eq!(rows[0].at, 11);
        assert_eq!(rows[0].id, "j11");
        assert_eq!(rows.last().unwrap().id, "j2");
    }

    #[test]
    fn a_rerun_of_the_same_job_moves_it_to_the_front() {
        let s = store();
        s.remember_job(&job("a", 1)).unwrap();
        s.remember_job(&job("b", 2)).unwrap();
        let mut rerun = job("a", 3);
        rerun.result = r#"{"result":"failed","counts":null,"reason":"it stopped"}"#.into();
        s.remember_job(&rerun).unwrap();
        let rows = s.load_recent_jobs().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "a");
        assert!(rows[0].result.contains("failed"));
    }

    #[test]
    fn settings_round_trip_as_key_value() {
        let s = store();
        s.save_setting("theme", "dark").unwrap();
        s.save_setting("theme", "light").unwrap();
        s.save_setting("pacing", "100").unwrap();
        let all = s.load_settings().unwrap();
        assert_eq!(all.get("theme").map(String::as_str), Some("light"));
        assert_eq!(all.get("pacing").map(String::as_str), Some("100"));
        assert_eq!(all.len(), 2);
    }
}
