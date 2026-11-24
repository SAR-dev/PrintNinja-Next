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

/// A job the local print API accepted (plan phase 8): the frozen
/// request, where it stands, and what it came out to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiJob {
    pub id: String,
    /// The key the caller may have sent; a second job with the same key
    /// is refused, so it never prints twice.
    pub idempotency_key: Option<String>,
    pub template_name: String,
    /// The template as it was when the job was accepted, as JSON text.
    pub template: String,
    /// "scene" or "document".
    pub track: String,
    pub profile: String,
    pub data: String,
    pub copies: u32,
    /// The transport, as JSON text.
    pub transport: String,
    /// "queued", "running", "done" or "cancelled".
    pub status: String,
    /// The job report, as JSON text, once it is done.
    pub result: Option<String>,
    /// When it was accepted, as `Date.now()` milliseconds.
    pub created_at: i64,
    /// When it finished, as `Date.now()` milliseconds.
    pub finished_at: Option<i64>,
}

/// A device paired to the local print API over the LAN (plan phase 8,
/// LAN increment): what the settings screen lists and can revoke. The
/// token itself is not stored — only its hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// When it paired, as `Date.now()` milliseconds.
    pub paired_at: i64,
}

/// A printer the user saved from a scan or by hand: the name they
/// chose, the profile it speaks, and the transport that reaches it.
/// The profile stays the shipped, validated set — this row only says
/// which profile, and how, to use.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPrinter {
    pub name: String,
    /// The profile's model, the key the print path looks it up by.
    pub model: String,
    /// The transport, as JSON text.
    pub transport: String,
}

/// A row of the community registry's change feed as the app has
/// applied it (plan phase 9): the local mirror the Community tab
/// shows. `template` and `sample` are always full on a live row — the
/// feed carries them inline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityTemplate {
    pub owner: String,
    pub slug: String,
    pub name: String,
    /// The registry's readme, as the tab shows it.
    pub readme: String,
    /// "scene" or "document".
    pub track: String,
    /// The template document, as JSON text.
    pub template: String,
    /// The data field's starting records, as JSON text.
    pub sample: String,
    /// When the registry last changed it (Unix seconds).
    pub changed_at: i64,
    /// Whether the signed-in account has saved it.
    pub saved: bool,
}

/// A local template's publication on the registry (plan phase 9): the
/// last document that went up, so a refresh can tell when a local edit
/// is newer than what the registry has.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication {
    pub id: String,
    pub local_template_id: String,
    /// The owner's handle, as the registry serves it.
    pub owner: String,
    pub slug: String,
    pub name: String,
    pub readme: String,
    /// The template document last pushed, as JSON text.
    pub last_template: String,
    /// The sample last pushed, as JSON text.
    pub last_sample: String,
    /// When it last went up, as `Date.now()` milliseconds.
    pub published_at: i64,
}

/// A registry operation waiting for a connection (plan phase 9,
/// offline-first): kind plus the operation as JSON text, kept in the
/// order it was queued.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedOp {
    pub id: i64,
    /// "publish", "unpublish", "save" or "unsave".
    pub kind: String,
    /// The operation, as JSON text.
    pub payload: String,
    /// When it was queued, as `Date.now()` milliseconds.
    pub created_at: i64,
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

    /// An in-memory store with the schema created — the tests in the
    /// other modules of this crate build their state on it.
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

    /// Accept a job the API printed a request for. When another job
    /// already holds the same idempotency key, that job's id comes back
    /// instead — the caller retries against the same job, so a job is
    /// never printed twice for one key.
    pub fn insert_api_job(&self, j: &ApiJob) -> Result<String, String> {
        let conn = self.lock();
        if let Some(key) = &j.idempotency_key {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT id FROM api_jobs WHERE idempotency_key = ?1",
                    params![key],
                    |r| r.get(0),
                )
                .ok();
            if let Some(id) = existing {
                return Ok(id);
            }
        }
        conn.execute(
            "INSERT INTO api_jobs (id, idempotency_key, template_name, template, track,
                                   profile, data, copies, transport, status, result,
                                   created_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                j.id,
                j.idempotency_key,
                j.template_name,
                j.template,
                j.track,
                j.profile,
                j.data,
                j.copies,
                j.transport,
                j.status,
                j.result,
                j.created_at,
                j.finished_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(j.id.clone())
    }

    /// One job by id.
    pub fn api_job(&self, id: &str) -> Result<Option<ApiJob>, String> {
        let conn = self.lock();
        let row: Option<ApiJob> = conn
            .query_row(
                "SELECT id, idempotency_key, template_name, template, track, profile,
                        data, copies, transport, status, result, created_at, finished_at
                 FROM api_jobs WHERE id = ?1",
                params![id],
                api_job_from_row,
            )
            .ok();
        Ok(row)
    }

    /// The accepted jobs, newest first, the kept limit at most.
    pub fn list_api_jobs(&self, limit: usize) -> Result<Vec<ApiJob>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, idempotency_key, template_name, template, track, profile,
                        data, copies, transport, status, result, created_at, finished_at
                 FROM api_jobs ORDER BY rowid DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit as i64], api_job_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// A queued job becomes cancelled. False when it is not queued
    /// anymore — printing, done, or already cancelled.
    pub fn cancel_queued_job(&self, id: &str) -> Result<bool, String> {
        let conn = self.lock();
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM api_jobs WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        if status.as_deref() != Some("queued") {
            return Ok(false);
        }
        conn.execute(
            "UPDATE api_jobs SET status = 'cancelled' WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// A queued job becomes running. False when a cancel beat it to it.
    pub fn start_queued_job(&self, id: &str) -> Result<bool, String> {
        let conn = self.lock();
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM api_jobs WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        if status.as_deref() != Some("queued") {
            return Ok(false);
        }
        conn.execute(
            "UPDATE api_jobs SET status = 'running' WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// A running job becomes done, its result and finishing time set.
    pub fn finish_api_job(&self, id: &str, result: &str, at: i64) -> Result<(), String> {
        self.lock()
            .execute(
                "UPDATE api_jobs SET status = 'done', result = ?2, finished_at = ?3
                 WHERE id = ?1",
                params![id, result, at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// The paired devices, oldest first.
    pub fn list_paired_devices(&self) -> Result<Vec<PairedDevice>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, platform, paired_at
                 FROM paired_devices ORDER BY paired_at, rowid",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PairedDevice {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    platform: r.get(2)?,
                    paired_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// A device that claimed a pairing code, under the hash of its
    /// token. The claimant keeps the token; the PC keeps the hash.
    pub fn add_paired_device(&self, d: &PairedDevice, token_hash: &str) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT INTO paired_devices (id, name, platform, token_hash, paired_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![d.id, d.name, d.platform, token_hash, d.paired_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Whether a paired device holds the token with this hash — the
    /// LAN gate's check on the `X-PrintNinja-Device-Token` header.
    pub fn has_paired_device(&self, token_hash: &str) -> Result<bool, String> {
        let conn = self.lock();
        let found: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM paired_devices WHERE token_hash = ?1)",
                params![token_hash],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(found)
    }

    /// A paired device is gone. False when no device has that id.
    pub fn revoke_paired_device(&self, id: &str) -> Result<bool, String> {
        let n = self
            .lock()
            .execute("DELETE FROM paired_devices WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// The saved printers, by name.
    pub fn list_saved_printers(&self) -> Result<Vec<SavedPrinter>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT name, model, transport FROM saved_printers ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SavedPrinter {
                    name: r.get(0)?,
                    model: r.get(1)?,
                    transport: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// A saved printer, upserted by name: re-saving one with the same
    /// name replaces it, the way the print screen expects.
    pub fn save_printer(&self, p: &SavedPrinter) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT INTO saved_printers (name, model, transport)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(name) DO UPDATE SET
                   model = excluded.model,
                   transport = excluded.transport",
                params![p.name, p.model, p.transport],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// A saved printer is gone. False when no printer has that name.
    pub fn remove_printer(&self, name: &str) -> Result<bool, String> {
        let n = self
            .lock()
            .execute("DELETE FROM saved_printers WHERE name = ?1", params![name])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// The community mirror, as the change feed last left it.
    pub fn community_templates(&self) -> Result<Vec<CommunityTemplate>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT owner, slug, name, readme, track, template, sample,
                        changed_at, saved
                 FROM registry_templates ORDER BY owner, slug",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], community_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// One mirror row by owner and slug, the key the feed applies by.
    pub fn community_template(
        &self,
        owner: &str,
        slug: &str,
    ) -> Result<Option<CommunityTemplate>, String> {
        let conn = self.lock();
        let row: Option<CommunityTemplate> = conn
            .query_row(
                "SELECT owner, slug, name, readme, track, template, sample,
                        changed_at, saved
                 FROM registry_templates WHERE owner = ?1 AND slug = ?2",
                params![owner, slug],
                community_from_row,
            )
            .ok();
        Ok(row)
    }

    /// Apply one feed entry to the mirror: a live entry upserts, a
    /// tombstone drops the row.
    pub fn upsert_community_template(&self, t: &CommunityTemplate) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT OR REPLACE INTO registry_templates
                     (owner, slug, name, readme, track, template, sample, changed_at, saved)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    t.owner,
                    t.slug,
                    t.name,
                    t.readme,
                    t.track,
                    t.template,
                    t.sample,
                    t.changed_at,
                    t.saved as i64
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// A tombstone goes through: the local copy of the feed entry is
    /// gone. False when the mirror did not hold it.
    pub fn drop_community_template(&self, owner: &str, slug: &str) -> Result<bool, String> {
        let n = self
            .lock()
            .execute(
                "DELETE FROM registry_templates WHERE owner = ?1 AND slug = ?2",
                params![owner, slug],
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// The account's saved list changed: the flag on one mirror row.
    pub fn set_community_saved(&self, owner: &str, slug: &str, saved: bool) -> Result<(), String> {
        self.lock()
            .execute(
                "UPDATE registry_templates SET saved = ?3 WHERE owner = ?1 AND slug = ?2",
                params![owner, slug, saved as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Every publication the app has on the registry.
    pub fn publications(&self) -> Result<Vec<Publication>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, local_template_id, owner, slug, name, readme,
                        last_template, last_sample, published_at
                 FROM publications ORDER BY published_at, rowid",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Publication {
                    id: r.get(0)?,
                    local_template_id: r.get(1)?,
                    owner: r.get(2)?,
                    slug: r.get(3)?,
                    name: r.get(4)?,
                    readme: r.get(5)?,
                    last_template: r.get(6)?,
                    last_sample: r.get(7)?,
                    published_at: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// The publication of one local template, if it has one.
    pub fn publication_for_local(
        &self,
        local_template_id: &str,
    ) -> Result<Option<Publication>, String> {
        let conn = self.lock();
        let row: Option<Publication> = conn
            .query_row(
                "SELECT id, local_template_id, owner, slug, name, readme,
                        last_template, last_sample, published_at
                 FROM publications WHERE local_template_id = ?1",
                params![local_template_id],
                |r| {
                    Ok(Publication {
                        id: r.get(0)?,
                        local_template_id: r.get(1)?,
                        owner: r.get(2)?,
                        slug: r.get(3)?,
                        name: r.get(4)?,
                        readme: r.get(5)?,
                        last_template: r.get(6)?,
                        last_sample: r.get(7)?,
                        published_at: r.get(8)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// Record that a local template is on the registry. One
    /// publication per local template: publishing the same template
    /// again is an update of the same row.
    pub fn upsert_publication(&self, p: &Publication) -> Result<(), String> {
        self.lock()
            .execute(
                "INSERT OR REPLACE INTO publications
                     (id, local_template_id, owner, slug, name, readme,
                      last_template, last_sample, published_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    p.id,
                    p.local_template_id,
                    p.owner,
                    p.slug,
                    p.name,
                    p.readme,
                    p.last_template,
                    p.last_sample,
                    p.published_at
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// The template is off the registry: its publication row goes.
    /// False when it had none.
    pub fn delete_publication_for_local(&self, local_template_id: &str) -> Result<bool, String> {
        let n = self
            .lock()
            .execute(
                "DELETE FROM publications WHERE local_template_id = ?1",
                params![local_template_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// The offline queue, oldest first — the order the refresh replays
    /// it in.
    pub fn queued_ops(&self) -> Result<Vec<QueuedOp>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT id, kind, payload, created_at FROM sync_queue ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(QueuedOp {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    payload: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Queue one operation; its id comes back so the caller can say
    /// which one it queued.
    pub fn enqueue_op(&self, kind: &str, payload: &str, now: i64) -> Result<i64, String> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO sync_queue (kind, payload, created_at) VALUES (?1, ?2, ?3)",
            params![kind, payload, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    /// One operation left the queue: it is done (or dead).
    pub fn drop_queued_op(&self, id: i64) -> Result<(), String> {
        self.lock()
            .execute("DELETE FROM sync_queue WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// A done or cancelled job goes back to queued, its result cleared.
    /// False when it is still in flight — queued or running.
    pub fn retry_finished_job(&self, id: &str) -> Result<bool, String> {
        let conn = self.lock();
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM api_jobs WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        if matches!(status.as_deref(), Some("queued") | Some("running")) {
            return Ok(false);
        }
        conn.execute(
            "UPDATE api_jobs SET status = 'queued', result = NULL, finished_at = NULL
             WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
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
CREATE TABLE IF NOT EXISTS paired_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  paired_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_printers (
  name TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  transport TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registry_templates (
  owner TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  readme TEXT NOT NULL,
  track TEXT NOT NULL,
  template TEXT NOT NULL,
  sample TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  saved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, slug)
);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  local_template_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  readme TEXT NOT NULL,
  last_template TEXT NOT NULL,
  last_sample TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE (owner, slug)
);
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  template_name TEXT NOT NULL,
  template TEXT NOT NULL,
  track TEXT NOT NULL,
  profile TEXT NOT NULL,
  data TEXT NOT NULL,
  copies INTEGER NOT NULL,
  transport TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
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

fn community_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CommunityTemplate> {
    Ok(CommunityTemplate {
        owner: r.get(0)?,
        slug: r.get(1)?,
        name: r.get(2)?,
        readme: r.get(3)?,
        track: r.get(4)?,
        template: r.get(5)?,
        sample: r.get(6)?,
        changed_at: r.get(7)?,
        saved: r.get::<_, i64>(8)? != 0,
    })
}

fn api_job_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ApiJob> {
    Ok(ApiJob {
        id: r.get(0)?,
        idempotency_key: r.get(1)?,
        template_name: r.get(2)?,
        template: r.get(3)?,
        track: r.get(4)?,
        profile: r.get(5)?,
        data: r.get(6)?,
        copies: r.get(7)?,
        transport: r.get(8)?,
        status: r.get(9)?,
        result: r.get(10)?,
        created_at: r.get(11)?,
        finished_at: r.get(12)?,
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

    fn api_job(id: &str, key: Option<&str>, status: &str) -> ApiJob {
        ApiJob {
            id: id.into(),
            idempotency_key: key.map(str::to_string),
            template_name: "Receipt".into(),
            template: r#"{"format":"scene"}"#.into(),
            track: "scene".into(),
            profile: "GK420d".into(),
            data: "[{\"name\":\"bolt\"}]".into(),
            copies: 1,
            transport: r#"{"kind":"tcp","host":"127.0.0.1","port":9100}"#.into(),
            status: status.into(),
            result: None,
            created_at: 1,
            finished_at: None,
        }
    }

    #[test]
    fn a_reused_idempotency_key_gets_the_original_job_id() {
        let s = store();
        assert_eq!(
            s.insert_api_job(&api_job("a", Some("k-1"), "queued"))
                .unwrap(),
            "a"
        );
        assert_eq!(
            s.insert_api_job(&api_job("b", Some("k-1"), "queued"))
                .unwrap(),
            "a",
            "the same key maps to the first job, so it never prints twice"
        );
        assert_eq!(
            s.insert_api_job(&api_job("c", None, "queued")).unwrap(),
            "c",
            "a keyless job is always a new job"
        );
        assert_eq!(s.list_api_jobs(10).unwrap().len(), 2);
    }

    #[test]
    fn a_job_moves_queued_running_done_and_back_again() {
        let s = store();
        s.insert_api_job(&api_job("a", None, "queued")).unwrap();
        assert!(
            !s.cancel_queued_job("nope").unwrap(),
            "an unknown job does not cancel"
        );
        assert!(s.cancel_queued_job("a").unwrap(), "a queued job cancels");
        assert!(
            !s.cancel_queued_job("a").unwrap(),
            "a cancelled job does not cancel again"
        );

        s.insert_api_job(&api_job("b", None, "queued")).unwrap();
        assert!(s.start_queued_job("b").unwrap(), "a queued job starts");
        assert!(
            !s.start_queued_job("b").unwrap(),
            "a running job does not start again"
        );
        assert!(
            !s.retry_finished_job("b").unwrap(),
            "a running job does not retry"
        );
        s.finish_api_job(
            "b",
            r#"{"result":"confirmed","counts":null,"reason":null}"#,
            123,
        )
        .unwrap();
        let j = s.api_job("b").unwrap().unwrap();
        assert_eq!(j.status, "done");
        assert_eq!(j.finished_at, Some(123));

        assert!(s.retry_finished_job("b").unwrap(), "a done job retries");
        let j = s.api_job("b").unwrap().unwrap();
        assert_eq!(j.status, "queued");
        assert_eq!(j.result, None, "the old result is cleared");
        assert_eq!(j.finished_at, None);
    }

    fn community(owner: &str, slug: &str) -> CommunityTemplate {
        CommunityTemplate {
            owner: owner.into(),
            slug: slug.into(),
            name: format!("{owner}/{slug}"),
            readme: "use it".into(),
            track: "scene".into(),
            template: r#"{"format":"scene"}"#.into(),
            sample: "[]".into(),
            changed_at: 1,
            saved: false,
        }
    }

    #[test]
    fn the_community_mirror_upserts_and_drops() {
        let s = store();
        s.upsert_community_template(&community("ana", "labels"))
            .unwrap();
        let mut c = community("ana", "labels");
        c.name = "renamed".into();
        c.changed_at = 2;
        s.upsert_community_template(&c).unwrap();

        let rows = s.community_templates().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "renamed");
        assert_eq!(rows[0].changed_at, 2);
        assert!(!rows[0].saved);

        assert!(s.set_community_saved("ana", "labels", true).is_ok());
        assert!(
            s.community_template("ana", "labels")
                .unwrap()
                .unwrap()
                .saved
        );
        assert!(s.drop_community_template("ana", "labels").unwrap());
        assert!(!s.drop_community_template("ana", "labels").unwrap());
        assert!(s.community_templates().unwrap().is_empty());
    }

    fn publication(local_id: &str) -> Publication {
        Publication {
            id: format!("pub-{local_id}"),
            local_template_id: local_id.into(),
            owner: "ana".into(),
            slug: "labels".into(),
            name: "T".into(),
            readme: "r".into(),
            last_template: r#"{"format":"scene"}"#.into(),
            last_sample: "[]".into(),
            published_at: 1,
        }
    }

    #[test]
    fn one_publication_per_local_template() {
        let s = store();
        s.upsert_publication(&publication("t1")).unwrap();
        let mut p = publication("t1");
        p.published_at = 5;
        s.upsert_publication(&p).unwrap();
        let mut p2 = publication("t2");
        // A different slug: the registry has one entry per owner/slug.
        p2.slug = "tags".into();
        s.upsert_publication(&p2).unwrap();

        assert_eq!(s.publications().unwrap().len(), 2);
        let p = s.publication_for_local("t1").unwrap().unwrap();
        assert_eq!(p.published_at, 5);
        assert!(s.publication_for_local("nope").unwrap().is_none());
        assert!(s.delete_publication_for_local("t1").unwrap());
        assert!(!s.delete_publication_for_local("t1").unwrap());
        assert_eq!(s.publications().unwrap().len(), 1);
    }

    #[test]
    fn the_sync_queue_keeps_its_order_and_releases_ops() {
        let s = store();
        let a = s.enqueue_op("publish", "{}", 1).unwrap();
        let b = s.enqueue_op("save", "{}", 2).unwrap();
        let c = s.enqueue_op("unsave", "{}", 3).unwrap();

        let ops = s.queued_ops().unwrap();
        assert_eq!(ops.iter().map(|o| o.id).collect::<Vec<_>>(), vec![a, b, c]);
        assert_eq!(ops[1].kind, "save");

        s.drop_queued_op(b).unwrap();
        let ops = s.queued_ops().unwrap();
        assert_eq!(ops.iter().map(|o| o.id).collect::<Vec<_>>(), vec![a, c]);
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
