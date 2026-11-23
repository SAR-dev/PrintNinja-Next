//! The registry database's migrations, runnable from the terminal.
//!
//! A migration is a `NNNN_name.sql` file in the migrations directory —
//! plain portable SQLite, applied in file-name order, one transaction
//! per file. Each file runs once and is then recorded in
//! `schema_migrations`. The commands the `pn-server` binary exposes:
//!
//! - `migrate make <name>` — write the next numbered file, ready to edit;
//! - `migrate apply` — run every file not recorded yet;
//! - `migrate status` — which files are applied and which are waiting;
//! - `db reset` — delete the database file and rebuild it from every
//!   migration, in order.
//!
//! `Store::open` applies the first migration (embedded at compile time)
//! to a fresh database, so the server and the tests never need the
//! migrations directory to start; everything after that arrives as files.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::store::{now_unix, Store};

/// The table that records which migrations have run.
const TRACKING_SQL: &str = "CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
)";

/// The first migration, embedded at compile time. The file on disk is
/// the source of truth this is compiled from.
const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const INITIAL_NAME: &str = "0001_initial.sql";

/// Where the migrations live: the `PN_SERVER_MIGRATIONS_DIR` environment
/// variable, then `./migrations` (running from the server directory or a
/// deployed layout), then `./server/migrations` (running from the repo
/// root). The first that exists wins; when none exists, the default is
/// named in the error, so a wrong working directory says so plainly.
pub fn migrations_dir() -> PathBuf {
    if let Ok(raw) = std::env::var("PN_SERVER_MIGRATIONS_DIR") {
        if !raw.trim().is_empty() {
            return PathBuf::from(raw.trim());
        }
    }
    for candidate in [
        PathBuf::from("migrations"),
        PathBuf::from("server/migrations"),
    ] {
        if candidate.is_dir() {
            return candidate;
        }
    }
    PathBuf::from("migrations")
}

/// One row of `migrate status`: a file and whether it has run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationState {
    pub name: String,
    pub applied: bool,
}

/// A migration file is `NNNN_name.sql`: four digits, an underscore, a
/// non-empty name, and the `.sql` extension.
fn is_migration_name(name: &str) -> bool {
    let Some((head, rest)) = name.split_once('_') else {
        return false;
    };
    let Some(stem) = rest.strip_suffix(".sql") else {
        return false;
    };
    stem.len() > 1 && head.len() == 4 && head.bytes().all(|b| b.is_ascii_digit())
}

/// The migration files, in the order they apply.
fn list_migrations(dir: &Path) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = dir
        .read_dir()
        .map_err(|e| {
            format!(
                "cannot read the migrations directory {}: {e}",
                dir.display()
            )
        })?
        .filter_map(|entry| {
            entry
                .ok()
                .map(|e| e.file_name().to_string_lossy().into_owned())
        })
        .filter(|name| is_migration_name(name))
        .collect();
    names.sort();
    Ok(names)
}

/// Whether the file is recorded in the tracking table.
fn recorded(conn: &Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT count(*) FROM schema_migrations WHERE name = ?1",
        (name,),
        |row| row.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .map_err(|e| format!("cannot read the migration tracking table: {e}"))
}

/// Apply the embedded first migration when it has not run yet — the way
/// a fresh database self-initializes. Returns whether it ran.
pub fn ensure_initial(conn: &mut Connection) -> Result<bool, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("cannot start the migration: {e}"))?;
    tx.execute_batch(TRACKING_SQL)
        .map_err(|e| format!("cannot create the migration tracking table: {e}"))?;
    let ran = !recorded(&tx, INITIAL_NAME)?;
    if ran {
        tx.execute_batch(INITIAL_MIGRATION)
            .map_err(|e| format!("the first migration failed: {e}"))?;
        tx.execute(
            "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, ?2)",
            (INITIAL_NAME, now_unix()),
        )
        .map_err(|e| format!("cannot record the first migration: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("the first migration could not be committed: {e}"))?;
    Ok(ran)
}

/// The state of every migration file: applied or waiting.
pub fn status(conn: &Connection, dir: &Path) -> Result<Vec<MigrationState>, String> {
    conn.execute_batch(TRACKING_SQL)
        .map_err(|e| format!("cannot create the migration tracking table: {e}"))?;
    Ok(list_migrations(dir)?
        .into_iter()
        .map(|name| MigrationState {
            applied: recorded(conn, &name).unwrap_or(false),
            name,
        })
        .collect())
}

/// Apply every file not recorded yet, in order. Each file is one
/// transaction: a failure rolls back only that file, and the files
/// before it keep their record. Returns the files that ran.
pub fn apply(conn: &mut Connection, dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Err(format!(
            "no migrations directory at {} — set PN_SERVER_MIGRATIONS_DIR or run from the \
             server's directory",
            dir.display()
        ));
    }
    conn.execute_batch(TRACKING_SQL)
        .map_err(|e| format!("cannot create the migration tracking table: {e}"))?;
    let mut ran = Vec::new();
    for name in list_migrations(dir)? {
        if recorded(conn, &name)? {
            continue;
        }
        let sql = std::fs::read_to_string(dir.join(&name))
            .map_err(|e| format!("cannot read the migration {name}: {e}"))?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("cannot start the migration {name}: {e}"))?;
        tx.execute_batch(&sql)
            .map_err(|e| format!("the migration {name} failed: {e}"))?;
        tx.execute(
            "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, ?2)",
            (name.as_str(), now_unix()),
        )
        .map_err(|e| format!("cannot record the migration {name}: {e}"))?;
        tx.commit()
            .map_err(|e| format!("the migration {name} could not be committed: {e}"))?;
        ran.push(name);
    }
    Ok(ran)
}

/// Write the next numbered file, ready to edit. The name is lowered:
/// spaces become underscores, punctuation is dropped, letters, digits
/// and hyphens stay.
pub fn make(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let cleaned: String = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                Some(c)
            } else if c.is_whitespace() {
                Some('_')
            } else {
                None
            }
        })
        .collect();
    if cleaned.is_empty() {
        return Err("the migration name is empty".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| {
        format!(
            "cannot create the migrations directory {}: {e}",
            dir.display()
        )
    })?;
    let next = list_migrations(dir)?
        .iter()
        .filter_map(|n| n.get(..4).and_then(|d| d.parse::<u32>().ok()))
        .max()
        .unwrap_or(0)
        + 1;
    // The number is the highest one present plus one, so the file can
    // never already exist — a make never overwrites anything.
    let file = dir.join(format!("{next:04}_{cleaned}.sql"));
    let body = format!(
        "-- {file_name}\n-- One transaction, plain portable SQLite, and no statement that \
         undoes an earlier one — migrations only add.\n",
        file_name = file.file_name().unwrap().to_string_lossy()
    );
    std::fs::write(&file, body)
        .map_err(|e| format!("cannot write the migration {}: {e}", file.display()))?;
    Ok(file)
}

/// Delete the database file (and its WAL side files) and rebuild it from
/// every migration, in order. The server must not be running against the
/// file while this happens. Returns the files that ran.
pub fn reset(db_path: &Path, dir: &Path) -> Result<Vec<String>, String> {
    let ext = db_path
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "db".into());
    for suffix in ["", "-wal", "-shm"] {
        let path = db_path.with_extension(format!("{ext}{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("cannot delete {}: {e}", path.display()))?;
        }
    }
    let store = Store::open(db_path)?;
    store.with_conn(|conn| apply(conn, dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A temp directory that deletes itself when the test ends, even on
    /// a panic.
    struct DirGuard(PathBuf);
    impl Drop for DirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.as_path());
        }
    }

    fn temp_dir(tag: &str) -> DirGuard {
        let dir =
            std::env::temp_dir().join(format!("pn-server-migrate-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a temp dir for the test");
        DirGuard(dir)
    }

    fn seed_migrations(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("0001_initial.sql"),
            "CREATE TABLE t1 (id INTEGER);",
        )
        .unwrap();
        std::fs::write(dir.join("0002_second.sql"), "CREATE TABLE t2 (id INTEGER);").unwrap();
    }

    #[test]
    fn apply_runs_each_file_once_and_records_it() {
        let dir = temp_dir("apply");
        let mig = dir.0.join("migrations");
        seed_migrations(&mig);
        let mut conn = Connection::open_in_memory().unwrap();
        let ran = apply(&mut conn, &mig).unwrap();
        assert_eq!(ran, vec!["0001_initial.sql", "0002_second.sql"]);
        // A second apply runs nothing.
        assert_eq!(apply(&mut conn, &mig).unwrap(), Vec::<String>::new());
        let states = status(&conn, &mig).unwrap();
        assert!(states.iter().all(|s| s.applied));
    }

    #[test]
    fn status_shows_what_is_waiting() {
        let dir = temp_dir("status");
        let mig = dir.0.join("migrations");
        std::fs::create_dir_all(&mig).unwrap();
        std::fs::write(
            mig.join("0001_initial.sql"),
            "CREATE TABLE t1 (id INTEGER);",
        )
        .unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        std::fs::write(mig.join("0002_second.sql"), "CREATE TABLE t2 (id INTEGER);").unwrap();
        let states = status(&conn, &mig).unwrap();
        assert_eq!(
            states,
            vec![
                MigrationState {
                    name: "0001_initial.sql".into(),
                    applied: false
                },
                MigrationState {
                    name: "0002_second.sql".into(),
                    applied: false
                }
            ]
        );
        apply(&mut conn, &mig).unwrap();
        assert!(status(&conn, &mig).unwrap().iter().all(|s| s.applied));
    }

    #[test]
    fn a_failed_migration_rolls_back_only_itself() {
        let dir = temp_dir("fail");
        let mig = dir.0.join("migrations");
        std::fs::create_dir_all(&mig).unwrap();
        std::fs::write(
            mig.join("0001_initial.sql"),
            "CREATE TABLE t1 (id INTEGER);",
        )
        .unwrap();
        std::fs::write(mig.join("0002_bad.sql"), "CREATE TABLE t1 (id INTEGER);").unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        let err = apply(&mut conn, &mig).unwrap_err();
        assert!(err.contains("0002_bad.sql"), "got: {err}");
        // 0001 ran and keeps its record; only the bad file rolled back.
        let states = status(&conn, &mig).unwrap();
        assert!(states[0].applied);
        assert!(!states[1].applied);
        // The table 0001 made is still there — nothing was lost.
        let t1: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(t1, 1);
    }

    #[test]
    fn make_writes_the_next_numbered_file() {
        let dir = temp_dir("make");
        let mig = dir.0.join("migrations");
        std::fs::create_dir_all(&mig).unwrap();
        std::fs::write(mig.join("0001_initial.sql"), "").unwrap();
        let file = make(&mig, "Add the thing!").unwrap();
        assert_eq!(
            file.file_name().unwrap().to_string_lossy(),
            "0002_add_the_thing.sql"
        );
        // The same name again gets the next number — never an overwrite.
        let again = make(&mig, "Add the thing!").unwrap();
        assert_eq!(
            again.file_name().unwrap().to_string_lossy(),
            "0003_add_the_thing.sql"
        );
    }

    #[test]
    fn reset_rebuilds_the_database_from_every_migration() {
        let dir = temp_dir("reset");
        let db = dir.0.join("registry.db");
        let mig = dir.0.join("migrations");
        seed_migrations(&mig);
        // The store is dropped before the reset: while its connection
        // is open the file cannot be deleted on Windows — the same
        // reason `db reset` says to stop the server first.
        {
            let store = Store::open(&db).unwrap();
            store
                .with_conn(|c| c.execute("CREATE TABLE t1 (id INTEGER)", []))
                .unwrap();
            store
                .with_conn(|c| c.execute("INSERT INTO t1 (id) VALUES (1)", []))
                .unwrap();
        }
        // The migrations file 0001 is the fake t1 one, but the store
        // recorded the embedded one under the same name — so the reset
        // applies only the file it has not run.
        let ran = reset(&db, &mig).unwrap();
        assert_eq!(ran, vec!["0002_second.sql"]);
        // The old table and its row are gone; the migrations rebuilt it.
        let conn = Connection::open(&db).unwrap();
        let t1: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(t1, 0);
        let t2: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 't2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(t2, 1);
    }

    #[test]
    fn names_that_are_not_migrations_are_ignored() {
        let dir = temp_dir("names");
        let mig = dir.0.join("migrations");
        std::fs::create_dir_all(&mig).unwrap();
        std::fs::write(mig.join("README.md"), "how migrations work").unwrap();
        std::fs::write(mig.join("notes.sql"), "-- no number").unwrap();
        std::fs::write(mig.join("0001x.sql"), "bad").unwrap();
        std::fs::write(mig.join("0001_.sql"), "no stem").unwrap();
        assert_eq!(list_migrations(&mig).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn ensure_initial_runs_once_and_records_it() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert!(ensure_initial(&mut conn).unwrap());
        assert!(!ensure_initial(&mut conn).unwrap());
        // The registry tables are there.
        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name IN ('users', 'templates')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 2);
    }
}
