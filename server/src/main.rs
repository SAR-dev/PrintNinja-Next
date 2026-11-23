//! The `pn-server` entrypoint: the registry server and its terminal
//! commands — applying the database migrations and rebuilding the
//! database, the way you would from a terminal in any other project.

use std::sync::Arc;

use axum::serve;
use tokio::net::TcpListener;

use pn_server::config::Config;
use pn_server::migrate;
use pn_server::router::router;
use pn_server::store::Store;
use pn_server::ServerState;

const USAGE: &str = "\
pn-server — the PrintNinja community registry

Commands:
  serve                run the server (the default)
  migrate make <name>  write the next numbered migration file, ready to edit
  migrate apply        apply every migration file not applied yet
  migrate status       which migrations are applied, which are waiting
  db reset             delete the database and rebuild it from every migration
  help                 this text

Environment:
  PN_SERVER_BIND            where to listen (default 127.0.0.1:8787)
  PN_SERVER_DB              the database file (default printninja-server.db)
  PN_SERVER_MIGRATIONS_DIR  where the migration files live";

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("serve") => run_server().await,
        Some("migrate") => match args.get(1).map(String::as_str) {
            Some("make") => match args.get(2) {
                Some(name) => migrate_make(name),
                None => Err("migrate make needs a name: pn-server migrate make \
                             add_cover"
                    .into()),
            },
            Some("apply") => migrate_apply(),
            Some("status") => migrate_status(),
            Some(other) => Err(format!(
                "unknown migrate command {other:?} — try make, apply or status"
            )),
            None => Err("migrate needs a command: make, apply or status".into()),
        },
        Some("db") => match args.get(1).map(String::as_str) {
            Some("reset") => db_reset(),
            Some(other) => Err(format!("unknown db command {other:?} — try reset")),
            None => Err("db needs a command: reset".into()),
        },
        Some("help") | Some("-h") | Some("--help") => {
            println!("{USAGE}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command {other:?}\n\n{USAGE}")),
    };
    if let Err(msg) = result {
        eprintln!("pn-server: {msg}");
        std::process::exit(1);
    }
}

/// Run the server: open the database, apply whatever migration is
/// waiting, and serve until interrupted.
async fn run_server() -> Result<(), String> {
    let config = Config::from_env()?;
    let store = Store::open(&config.db_path)?;
    let dir = migrate::migrations_dir();
    if !dir.is_dir() {
        eprintln!(
            "pn-server: no migrations directory at {} — the built-in schema only; set \
             PN_SERVER_MIGRATIONS_DIR to apply later migrations",
            dir.display()
        );
    } else {
        let ran = store.with_conn(|conn| migrate::apply(conn, &dir))?;
        for name in ran {
            eprintln!("pn-server: applied migration {name}");
        }
    }
    let state = ServerState {
        store: Arc::new(store),
    };
    let app = router(state);

    let listener = TcpListener::bind(config.bind)
        .await
        .map_err(|e| format!("cannot bind {}: {e}", config.bind))?;
    eprintln!(
        "pn-server: listening on {} (db: {})",
        config.bind,
        config.db_path.display()
    );
    serve(listener, app).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// `pn-server migrate make <name>` — the next numbered file, ready to
/// edit.
fn migrate_make(name: &str) -> Result<(), String> {
    let dir = migrate::migrations_dir();
    let file = migrate::make(&dir, name)?;
    println!(
        "wrote {} — edit it, then: pn-server migrate apply",
        file.display()
    );
    Ok(())
}

/// `pn-server migrate apply` — run every file not recorded yet.
fn migrate_apply() -> Result<(), String> {
    let config = Config::from_env()?;
    let store = Store::open(&config.db_path)?;
    let dir = migrate::migrations_dir();
    let ran = store.with_conn(|conn| migrate::apply(conn, &dir))?;
    if ran.is_empty() {
        println!("nothing to apply — the database is up to date");
    } else {
        for name in ran {
            println!("applied {name}");
        }
    }
    Ok(())
}

/// `pn-server migrate status` — each file, applied or waiting.
fn migrate_status() -> Result<(), String> {
    let config = Config::from_env()?;
    let store = Store::open(&config.db_path)?;
    let dir = migrate::migrations_dir();
    let states = store.with_conn(|conn| migrate::status(conn, &dir))?;
    if states.is_empty() {
        println!("no migration files in {}", dir.display());
    } else {
        for state in states {
            let mark = if state.applied {
                "applied  "
            } else {
                "pending  "
            };
            println!("{mark} {}", state.name);
        }
    }
    Ok(())
}

/// `pn-server db reset` — delete the file and rebuild from every
/// migration, in order.
fn db_reset() -> Result<(), String> {
    let config = Config::from_env()?;
    let dir = migrate::migrations_dir();
    let ran = migrate::reset(&config.db_path, &dir)
        .map_err(|e| format!("{e} — stop the server first if it is running on this database"))?;
    for name in ran {
        println!("applied {name}");
    }
    println!("the database at {} is rebuilt", config.db_path.display());
    Ok(())
}
