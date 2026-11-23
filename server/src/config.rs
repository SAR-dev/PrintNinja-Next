//! Server configuration, read from the environment.

use std::net::SocketAddr;
use std::path::PathBuf;

/// The default bind address: this PC only, like the app's API. A
/// deployment sets `PN_SERVER_BIND` to `0.0.0.0:…` to be reached from
/// off the PC.
pub const DEFAULT_BIND: &str = "127.0.0.1:8787";
/// The default registry database file.
pub const DEFAULT_DB: &str = "printninja-server.db";

/// Where the server listens and where its database lives.
#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub db_path: PathBuf,
}

impl Config {
    /// Build the configuration from the environment, applying the
    /// defaults where a variable is absent or blank.
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            bind: bind_from(std::env::var("PN_SERVER_BIND").ok().as_deref())?,
            db_path: db_from(std::env::var("PN_SERVER_DB").ok().as_deref()),
        })
    }
}

/// Parse the bind address: a blank or absent value is the default.
pub(crate) fn bind_from(raw: Option<&str>) -> Result<SocketAddr, String> {
    match raw {
        Some(s) if !s.trim().is_empty() => s
            .trim()
            .parse::<SocketAddr>()
            .map_err(|e| format!("PN_SERVER_BIND is not an address: {e}")),
        _ => Ok(DEFAULT_BIND
            .parse()
            .expect("the default bind is a valid address")),
    }
}

/// The database path: a blank or absent value is the default.
pub(crate) fn db_from(raw: Option<&str>) -> PathBuf {
    match raw {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => PathBuf::from(DEFAULT_DB),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bind_defaults_when_absent_or_blank() {
        assert_eq!(bind_from(None).unwrap().to_string(), DEFAULT_BIND);
        assert_eq!(bind_from(Some("")).unwrap().to_string(), DEFAULT_BIND);
        assert_eq!(bind_from(Some("   ")).unwrap().to_string(), DEFAULT_BIND);
        assert_eq!(
            bind_from(Some("0.0.0.0:9000")).unwrap().to_string(),
            "0.0.0.0:9000"
        );
    }

    #[test]
    fn a_malformed_bind_is_rejected_in_plain_words() {
        let err = bind_from(Some("not-an-address")).unwrap_err();
        assert!(err.contains("not an address"), "got: {err}");
    }

    #[test]
    fn the_db_path_defaults_when_absent_or_blank() {
        assert_eq!(db_from(None), PathBuf::from(DEFAULT_DB));
        assert_eq!(db_from(Some("  ")), PathBuf::from(DEFAULT_DB));
        assert_eq!(
            db_from(Some("/data/registry.db")),
            PathBuf::from("/data/registry.db")
        );
    }
}
