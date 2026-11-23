//! The `pn-server` entrypoint: read the configuration, open the registry
//! database, and serve the router until interrupted.

use std::sync::Arc;

use axum::serve;
use tokio::net::TcpListener;

use pn_server::config::Config;
use pn_server::router::router;
use pn_server::store::Store;
use pn_server::ServerState;

#[tokio::main]
async fn main() -> Result<(), String> {
    let config = Config::from_env()?;
    let store = Store::open(&config.db_path)?;
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
