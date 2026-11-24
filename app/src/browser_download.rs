//! The managed-Chromium option for the document track. The app can
//! keep using the PC's own browser, or the user can download a pinned
//! Chrome-for-Testing build once and have the app use that instead.
//! Nothing is downloaded unless the user asks for it.

use crate::{BROWSER_MODE_KEY, BROWSER_PATH_KEY};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Where Chrome for Testing publishes its current stable build.
const VERSIONS_URL: &str =
    "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

/// The version we last downloaded, remembered for the Settings label.
const BROWSER_VERSION_KEY: &str = "browser.version";

/// What the Diagnostics tab needs to show the browser choice.
#[derive(Debug, Clone, Serialize)]
pub struct BrowserInfo {
    /// "system" or "managed".
    pub mode: String,
    /// The downloaded browser, when the file still exists.
    pub managed_path: Option<String>,
    /// The downloaded browser's version.
    pub version: Option<String>,
    /// Installed browsers the app detected on this PC.
    pub system: Vec<String>,
}

/// Build the Settings view from the saved settings and the file system.
pub fn info(settings: &BTreeMap<String, String>) -> BrowserInfo {
    let managed_path = settings
        .get(BROWSER_PATH_KEY)
        .map(|p| PathBuf::from(p.trim()))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned());
    BrowserInfo {
        mode: settings
            .get(BROWSER_MODE_KEY)
            .filter(|m| m.as_str() == "managed" && managed_path.is_some())
            .map_or_else(|| "system".into(), |m| m.clone()),
        managed_path,
        version: settings.get(BROWSER_VERSION_KEY).cloned(),
        system: pn_browser::system_browsers()
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    }
}

/// The Chrome-for-Testing platform name for this machine.
fn platform() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("win64"),
        ("windows", "aarch64") => Ok("win-arm64"),
        ("linux", "x86_64") => Ok("linux64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        ("macos", "x86_64") => Ok("mac-x64"),
        ("macos", "aarch64") => Ok("mac-arm64"),
        _ => Err("Chromium downloads are not available on this platform".into()),
    }
}

/// The name of the browser executable inside the downloaded archive.
fn executable_name() -> &'static str {
    if cfg!(windows) {
        "chrome.exe"
    } else {
        "chrome"
    }
}

fn find_executable(dir: &Path, name: &str) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_executable(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

/// Download and unpack the stable Chrome-for-Testing build, remember
/// its path in the settings, and return that path. Idempotent: a
/// second call replaces the same directory.
pub async fn download(data_dir: &Path, store: &crate::Store) -> Result<String, String> {
    let platform = platform()?;
    let client = reqwest::Client::builder()
        .user_agent("PrintNinja")
        .build()
        .map_err(|e| e.to_string())?;
    let config: serde_json::Value = client
        .get(VERSIONS_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let stable = &config["channels"]["Stable"];
    let version = stable["version"]
        .as_str()
        .ok_or("the browser release list had no stable version")?;
    let url = stable["downloads"]["chrome"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|d| d["platform"].as_str() == Some(platform))
        })
        .and_then(|d| d["url"].as_str())
        .ok_or("the browser release list had no download for this platform")?;

    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let dir = data_dir.join("browser").join(version);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    archive.extract(&dir).map_err(|e| e.to_string())?;

    let executable = find_executable(&dir, executable_name())
        .ok_or("the downloaded archive had no browser executable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let path = executable.to_string_lossy().into_owned();
    store.save_setting(BROWSER_PATH_KEY, &path)?;
    store.save_setting(BROWSER_VERSION_KEY, version)?;
    store.save_setting(BROWSER_MODE_KEY, "managed")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_download_is_only_used_when_it_exists() {
        let mut settings = BTreeMap::new();
        settings.insert(BROWSER_MODE_KEY.into(), "managed".into());
        settings.insert(BROWSER_PATH_KEY.into(), "/no/such/chrome".into());
        let info = info(&settings);
        assert_eq!(info.mode, "system");
        assert!(info.managed_path.is_none());
    }
}
