//! A small in-memory log for the app's own events. It is deliberately
//! std-only: a bounded ring buffer that the Diagnostics settings tab
//! can show and export, plus a line on stderr for the console. It is
//! not a replacement for a real logging framework — it is the answer
//! to "why did that print fail?" without asking the user to find a
//! terminal.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Keep the last few hundred events: enough to follow one session,
/// small enough to hold in memory and copy into a text file.
const MAX_ENTRIES: usize = 500;

/// One app event, newest first when handed to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    /// Milliseconds since the Unix epoch; the UI formats it locally.
    pub at_ms: u64,
    pub level: &'static str,
    pub target: &'static str,
    pub message: String,
}

#[derive(Default)]
struct AppLog {
    entries: Mutex<VecDeque<LogEntry>>,
}

static LOG: OnceLock<AppLog> = OnceLock::new();

fn log() -> &'static AppLog {
    LOG.get_or_init(AppLog::default)
}

fn lock(entries: &Mutex<VecDeque<LogEntry>>) -> std::sync::MutexGuard<'_, VecDeque<LogEntry>> {
    entries.lock().unwrap_or_else(|e| e.into_inner())
}

/// Record an event. Also writes a line to stderr, so a developer
/// watching the console sees the same thing the user can export.
pub fn push(level: &'static str, target: &'static str, message: impl Into<String>) {
    let message = message.into();
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut entries = lock(&log().entries);
    if entries.len() == MAX_ENTRIES {
        entries.pop_front();
    }
    entries.push_back(LogEntry {
        at_ms,
        level,
        target,
        message: message.clone(),
    });
    drop(entries);
    eprintln!("[{level}] {target}: {message}");
}

/// The recorded events, newest first.
pub fn entries() -> Vec<LogEntry> {
    lock(&log().entries).iter().rev().cloned().collect()
}

/// Forget everything recorded so far.
pub fn clear() {
    lock(&log().entries).clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_log_keeps_the_newest_entries_first() {
        clear();
        push("info", "test", "first");
        push("warn", "test", "second");
        let got = entries();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].message, "second");
        assert_eq!(got[1].message, "first");
        clear();
    }

    #[test]
    fn a_log_is_bounded() {
        clear();
        for i in 0..MAX_ENTRIES + 5 {
            push("info", "test", format!("event {i}"));
        }
        let got = entries();
        assert_eq!(got.len(), MAX_ENTRIES);
        assert_eq!(got[0].message, format!("event {}", MAX_ENTRIES + 4));
        clear();
    }
}
