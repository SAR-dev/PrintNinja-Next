//! PrintNinja (next) — Tauri shell. Windows and Linux first; Android in
//! phase 11. The frontend lives in `app/ui` and is embedded at compile
//! time via `tauri::generate_context!` (build it first).
//!
//! This file is the thin Tauri layer: it holds the loaded printer
//! profiles, exposes the `pipeline` module through three commands —
//! list printers, prepare a job, print a job — and keeps the heavy
//! work off the UI thread.

mod pipeline;
mod store;

use std::collections::BTreeMap;
use std::path::PathBuf;

use pn_job::JobResult;
use pn_profiles::{Profile, ProfileSet};
use pn_scene::{Records, Template};
use tauri::{Manager, State};

pub use pipeline::{
    factory, load_profiles, prepare_units, print_units, profile_infos, report_of, JobReport,
    PipelineError, PrepareReport, ProfileInfo, Transport, Units,
};
pub use store::{Store, StoredJob, StoredTemplate};

/// The printer profiles, loaded once at startup (plan phase 7: the
/// profile set *is* the printer list).
struct AppProfiles {
    profiles: ProfileSet,
}

/// Where the profiles live: an explicit override, then the shipped set
/// next to the source tree (dev), then the bundled resource directory
/// (release; the bundling lands with the packaging phase).
fn profiles_dir(handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("PN_PROFILES_DIR") {
        return PathBuf::from(dir);
    }
    let dev = PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../core/profiles/profiles"
    ));
    if dev.is_dir() {
        return dev;
    }
    handle
        .path()
        .resource_dir()
        .expect("the app must have a resource directory")
        .join("profiles")
}

/// The three inputs every job command shares, checked before any
/// work: the template parses, the printer exists, the data is records.
fn load_inputs<'a>(
    profiles: &'a ProfileSet,
    template_json: &str,
    profile_name: &str,
    data_json: &str,
) -> Result<(&'a Profile, Template, Records), String> {
    let template = Template::from_json(template_json).map_err(|e| e.to_string())?;
    let profile = profiles
        .find(profile_name)
        .ok_or_else(|| format!("no printer profile named \"{profile_name}\""))?;
    // The data field is JSON or CSV, whichever the text is (a local
    // data file lands here as plain text).
    let records = Records::from_text(data_json).map_err(|e| e.to_string())?;
    Ok((profile, template, records))
}

/// The printer list, in the shape the UI shows it.
#[tauri::command]
fn list_printers(state: State<'_, AppProfiles>) -> Vec<ProfileInfo> {
    profile_infos(&state.profiles)
}

/// Prepare a job: pick the output path, encode the units, render the
/// preview. Returns the report; nothing has touched the wire.
#[tauri::command]
async fn plan_job(
    state: State<'_, AppProfiles>,
    template: String,
    profile: String,
    data: String,
    copies: u32,
) -> Result<PrepareReport, String> {
    let (profile, template, records) = load_inputs(&state.profiles, &template, &profile, &data)?;
    let (profile, template, records) = (profile.clone(), template.clone(), records.clone());
    tauri::async_runtime::spawn_blocking(move || {
        prepare_units(&template, &profile, &records, copies).map(|units| units.report)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: PipelineError| e.to_string())
}

/// Prepare and print a job in one call, over the given transport.
/// The report is what actually happened — every state in the plan's
/// result vocabulary is possible.
#[tauri::command]
async fn print_job(
    state: State<'_, AppProfiles>,
    template: String,
    profile: String,
    data: String,
    copies: u32,
    transport: Transport,
) -> Result<JobReport, String> {
    let (profile, template, records) = load_inputs(&state.profiles, &template, &profile, &data)?;
    let (profile, template, records) = (profile.clone(), template.clone(), records.clone());
    let report = tauri::async_runtime::spawn_blocking(move || {
        let units = prepare_units(&template, &profile, &records, copies)?;
        let factory = factory(&transport, units.document_format);
        let result: JobResult = print_units(&units.spec, &profile, factory);
        Ok::<_, PipelineError>(report_of(result))
    })
    .await
    .map_err(|e| e.to_string())?;
    report.map_err(|e| e.to_string())
}

/// The templates as the user has them (plan phase 7: persistence).
#[tauri::command]
fn load_templates(state: State<'_, Store>) -> Result<Vec<StoredTemplate>, String> {
    state.load_templates()
}

/// Save or replace one template.
#[tauri::command]
fn save_template(state: State<'_, Store>, template: StoredTemplate) -> Result<(), String> {
    state.save_template(&template)
}

/// The recent jobs, newest first (the kept limit at most).
#[tauri::command]
fn load_recent_jobs(state: State<'_, Store>) -> Result<Vec<StoredJob>, String> {
    state.load_recent_jobs()
}

/// Remember a job, or refresh its result when it ran again.
#[tauri::command]
fn remember_job(state: State<'_, Store>, job: StoredJob) -> Result<(), String> {
    state.remember_job(&job)
}

/// The saved settings, key to value.
#[tauri::command]
fn load_settings(state: State<'_, Store>) -> Result<BTreeMap<String, String>, String> {
    state.load_settings()
}

/// Save or replace one setting.
#[tauri::command]
fn save_setting(state: State<'_, Store>, key: String, value: String) -> Result<(), String> {
    state.save_setting(&key, &value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = profiles_dir(app.handle());
            let profiles = load_profiles(&dir)
                .unwrap_or_else(|e| panic!("the profile set at {} must load: {e}", dir.display()));
            app.manage(AppProfiles { profiles });
            // The local store: one SQLite file in the app's data
            // directory. When it cannot open, the app still runs —
            // the commands say so, and the UI keeps its in-memory
            // copies and names the failure.
            let db_path = app
                .path()
                .app_data_dir()
                .expect("the app must have a data directory")
                .join("printninja.db");
            match Store::open(&db_path) {
                Ok(store) => {
                    app.manage(store);
                }
                Err(e) => eprintln!("the local store at {} did not open: {e}", db_path.display()),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_printers,
            plan_job,
            print_job,
            load_templates,
            save_template,
            load_recent_jobs,
            remember_job,
            load_settings,
            save_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrintNinja");
}
