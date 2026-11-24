//! The Diagnostics tab's two remaining tools: an exported bundle a user
//! can attach to a bug report, and a repair that really acts on the OS
//! print service (with elevation) rather than just retrying our own
//! listener. Both are user-initiated and report exactly what happened.

use crate::api::ApiStatus;
use crate::app_log::LogEntry;
use crate::browser_download::BrowserInfo;
use crate::{BROWSER_MODE_KEY, BROWSER_PATH_KEY};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Keys whose values are credentials or account state — never exported.
fn is_secret(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    ["token", "password", "secret", "account", "credential"]
        .iter()
        .any(|word| lower.contains(word))
}

/// A saved transport may carry an IPP user; drop it from the bundle.
pub fn redact_transport(raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(mut map)) => {
            for key in ["user", "username", "password", "token"] {
                if map.contains_key(key) {
                    map.insert(key.into(), json!("<redacted>"));
                }
            }
            Value::Object(map)
        }
        Ok(other) => other,
        Err(_) => json!("<unreadable transport>"),
    }
}

/// The exportable settings only — secret-like keys are left out.
pub fn safe_settings(settings: &BTreeMap<String, String>) -> BTreeMap<&str, &str> {
    settings
        .iter()
        .filter(|(key, _)| !is_secret(key))
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect()
}

/// Build the JSON bundle. Nothing here is sent anywhere by the app;
/// the UI offers it as a file download.
pub fn bundle(
    settings: &BTreeMap<String, String>,
    api: &ApiStatus,
    browser: &BrowserInfo,
    printers: &[(String, String, String)],
    logs: &[LogEntry],
) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    json!({
        "app": {
            "version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "at_ms": now,
        },
        "local_api": api,
        "browser": {
            "mode": browser.mode,
            "managed_path": browser.managed_path,
            "version": browser.version,
            "system": browser.system,
        },
        "settings": safe_settings(settings),
        "browser_keys": [BROWSER_MODE_KEY, BROWSER_PATH_KEY],
        "saved_printers": printers
            .iter()
            .map(|(name, model, transport)| json!({
                "name": name,
                "profile": model,
                "transport": redact_transport(transport),
            }))
            .collect::<Vec<_>>(),
        "log": logs,
    })
    .to_string()
}

/// What the repair did, in plain words, for the UI to show.
#[derive(Debug, Clone, Serialize)]
pub struct RepairReport {
    pub steps: Vec<String>,
    pub ok: bool,
}

#[cfg(windows)]
fn run_elevated(script: &str) -> String {
    use std::process::Command;
    let args = format!(
        "-NoProfile -Command Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command \"{}\"'",
        script.replace('\'', "''")
    );
    match Command::new("powershell")
        .args(["-NoProfile", "-Command", &args])
        .output()
    {
        Ok(out) => format!(
            "{} {}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        )
        .trim()
        .to_string(),
        Err(e) => format!("could not start the repair command: {e}"),
    }
}

#[cfg(target_os = "linux")]
fn run_privileged(program: &str, args: &[&str]) -> String {
    use std::process::Command;
    match Command::new("pkexec").arg(program).args(args).output() {
        Ok(out) if out.status.success() => format!("{program} {}: ok", args.join(" ")),
        Ok(out) => format!(
            "{program} {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Err(e) => format!("could not start {program}: {e}"),
    }
}

/// Restart the OS print service, and optionally stop whatever holds
/// port 17717. Both need elevation — the OS may ask the user for it.
pub fn repair(stop_port_owner: bool) -> RepairReport {
    let mut steps: Vec<String> = Vec::new();
    #[cfg(windows)]
    {
        steps.push(format!(
            "Spooler: {}",
            run_elevated("Restart-Service -Name Spooler -Force")
        ));
        if stop_port_owner {
            steps.push(format!(
                "port 17717: {}",
                run_elevated(
                    "$p = Get-NetTCPConnection -LocalPort 17717 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1; if ($p) { Stop-Process -Id $p -Force; \"stopped $p\" } else { \"no process on 17717\" }"
                )
            ));
        }
    }
    #[cfg(target_os = "linux")]
    {
        steps.push(run_privileged("systemctl", &["restart", "cups"]));
        if stop_port_owner {
            steps.push(run_privileged("fuser", &["-k", "17717/tcp"]));
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        steps.push("automatic repair is not available on this platform".into());
        let _ = stop_port_owner;
    }
    let ok = steps
        .iter()
        .all(|s| !s.contains("could not start") && !s.contains("not available"));
    RepairReport { steps, ok }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_not_exported() {
        let mut settings = BTreeMap::new();
        settings.insert("theme".into(), "dark".into());
        settings.insert("registry.account.token".into(), "secret-token".into());
        let safe = safe_settings(&settings);
        assert_eq!(safe.get("theme"), Some(&"dark"));
        assert!(!safe.contains_key("registry.account.token"));
    }

    #[test]
    fn transport_users_are_redacted() {
        let value = redact_transport(r#"{"kind":"ipp","address":"http://x","user":"alice"}"#);
        assert_eq!(value["user"], json!("<redacted>"));
        assert_eq!(value["address"], json!("http://x"));
    }
}
