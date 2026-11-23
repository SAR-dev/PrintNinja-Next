//! PrintNinja (next) — Tauri shell. Windows and Linux first; Android in
//! phase 11. The frontend lives in `app/ui` and is embedded at compile
//! time via `tauri::generate_context!` (build it first).
//!
//! This file is the thin Tauri layer: it holds the loaded printer
//! profiles, exposes the `pipeline` module through three commands —
//! list printers, prepare a job, print a job — and keeps the heavy
//! work off the UI thread.

mod api;
mod deeplink;
mod pairing;
mod pipeline;
mod registry;
mod store;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use pn_job::JobResult;
use pn_profiles::{Profile, ProfileSet};
use pn_scene::{Records, Template};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State,
};
use tauri_plugin_autostart::ManagerExt;

pub use pipeline::{
    delivery_key, factory, load_profiles, prepare_units, print_units, profile_infos, report_of,
    JobReport, PipelineError, PrepareReport, ProfileInfo, Transport, Units,
};
pub use registry::RegistryStatus;
pub use store::{CommunityTemplate, PairedDevice, Publication, Store, StoredJob, StoredTemplate};

/// The printer profiles, loaded once at startup (plan phase 7: the
/// profile set *is* the printer list). An `Arc` because the local
/// print API (plan phase 8) runs the same pipeline from its own
/// task.
struct AppProfiles {
    profiles: Arc<ProfileSet>,
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
/// The profile comes back with the user's delivery override applied —
/// pacing and close delay as the settings screen has them (plan
/// phase 7).
fn load_inputs(
    profiles: &ProfileSet,
    store: &Arc<Store>,
    template_json: &str,
    profile_name: &str,
    data_json: &str,
) -> Result<(Profile, Template, Records), String> {
    let template = Template::from_json(template_json).map_err(|e| e.to_string())?;
    let profile = profiles
        .find(profile_name)
        .ok_or_else(|| format!("no printer profile named \"{profile_name}\""))?;
    // The data field is JSON or CSV, whichever the text is (a local
    // data file lands here as plain text).
    let records = Records::from_text(data_json).map_err(|e| e.to_string())?;
    let settings = store.load_settings().unwrap_or_default();
    Ok((
        pipeline::with_delivery_overrides(profile, &settings),
        template,
        records,
    ))
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
    store: State<'_, Arc<Store>>,
    template: String,
    profile: String,
    data: String,
    copies: u32,
) -> Result<PrepareReport, String> {
    let (profile, template, records) =
        load_inputs(&state.profiles, &store, &template, &profile, &data)?;
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
    store: State<'_, Arc<Store>>,
    template: String,
    profile: String,
    data: String,
    copies: u32,
    transport: Transport,
) -> Result<JobReport, String> {
    let (profile, template, records) =
        load_inputs(&state.profiles, &store, &template, &profile, &data)?;
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
fn load_templates(state: State<'_, Arc<Store>>) -> Result<Vec<StoredTemplate>, String> {
    state.load_templates()
}

/// Save or replace one template.
#[tauri::command]
fn save_template(state: State<'_, Arc<Store>>, template: StoredTemplate) -> Result<(), String> {
    state.save_template(&template)
}

/// The recent jobs, newest first (the kept limit at most).
#[tauri::command]
fn load_recent_jobs(state: State<'_, Arc<Store>>) -> Result<Vec<StoredJob>, String> {
    state.load_recent_jobs()
}

/// Remember a job, or refresh its result when it ran again.
#[tauri::command]
fn remember_job(state: State<'_, Arc<Store>>, job: StoredJob) -> Result<(), String> {
    state.remember_job(&job)
}

/// The saved settings, key to value.
#[tauri::command]
fn load_settings(state: State<'_, Arc<Store>>) -> Result<BTreeMap<String, String>, String> {
    state.load_settings()
}

/// Save or replace one setting.
#[tauri::command]
fn save_setting(state: State<'_, Arc<Store>>, key: String, value: String) -> Result<(), String> {
    state.save_setting(&key, &value)
}

/// Whether PrintNinja starts with the computer (plan phase 7:
/// start-with-computer).
#[tauri::command]
fn is_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Turn start-with-computer on or off; the choice outlives the app.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| e.to_string())
}

/// Open the pairing window (plan phase 8, LAN): mint the one-time
/// code, leave the window open for its TTL, and hand the code back to
/// show on the screen. A new call takes the place of any window left
/// open.
#[tauri::command]
fn begin_pairing(state: State<'_, Arc<api::ApiState>>) -> Result<String, String> {
    let code = pairing::generate_code();
    *state.window.lock().map_err(|e| e.to_string())? =
        Some(pairing::PairingWindow::new(code.clone()));
    Ok(code)
}

/// The devices paired to the local API, the order they paired in
/// (plan phase 8, LAN). The tokens are not among them — only their
/// names.
#[tauri::command]
fn paired_devices(state: State<'_, Arc<Store>>) -> Result<Vec<PairedDevice>, String> {
    state.list_paired_devices()
}

/// Revoke a paired device: its token stops being accepted at once —
/// the gate checks the store on every request.
#[tauri::command]
fn revoke_device(state: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    state.revoke_paired_device(&id).and_then(|gone| {
        if gone {
            Ok(())
        } else {
            Err(format!("no paired device named \"{id}\""))
        }
    })
}

/// Turn a delivered `printninja://` URL into the print values it
/// carries (plan phase 8, deep link). The frontend does the rest —
/// the values prefill the print screen, and the screen's Print button
/// is the confirmation.
#[tauri::command]
fn parse_deeplink(url: String) -> Result<deeplink::DeepLinkPrint, String> {
    deeplink::parse_deep_link(&url)
}

/// The registry the app talks to: the stored URL, the environment
/// override, or the local default (plan phase 9 — any shared server
/// works, the way the old app's shared server URL did).
#[tauri::command]
fn registry_url(state: State<'_, Arc<Store>>) -> Result<String, String> {
    Ok(registry::Registry::base_url(
        &state.load_settings().unwrap_or_default(),
    ))
}

/// What the header chip shows without syncing: the signed-in handle,
/// whether the registry answers, and what is queued for it.
#[tauri::command]
async fn registry_status(state: State<'_, Arc<Store>>) -> Result<RegistryStatus, String> {
    Ok(registry::Registry::from_settings(&state)?
        .status(&state)
        .await)
}

/// The whole sync: replay the queued operations, push the local edits,
/// pull the change feed, and refresh the saved flags. Offline is a
/// state, not an error — the queue waits.
#[tauri::command]
async fn registry_refresh(state: State<'_, Arc<Store>>) -> Result<RegistryStatus, String> {
    registry::Registry::from_settings(&state)?
        .refresh(&state)
        .await
}

/// Sign in to the registry — or create the account when `create`. The
/// session is stored, so the next call signs in as the same account;
/// the account's handle, as the registry serves it, comes back.
#[tauri::command]
async fn registry_login(
    state: State<'_, Arc<Store>>,
    handle: String,
    password: String,
    create: bool,
) -> Result<String, String> {
    registry::Registry::from_settings(&state)?
        .login(&state, &handle, &password, create)
        .await
}

/// Sign out: the session is revoked (best effort) and the stored
/// account is cleared. The community mirror and the local copies stay
/// — they are the app's own rows.
#[tauri::command]
async fn registry_logout(state: State<'_, Arc<Store>>) -> Result<(), String> {
    registry::Registry::from_settings(&state)?
        .logout(&state)
        .await
}

/// Publish a local template to the registry (plan phase 9): the
/// operation is queued with the document as a JSON value — the
/// registry's format — and the sync replays it, online or later.
#[tauri::command]
async fn publish_template(
    state: State<'_, Arc<Store>>,
    local_template_id: String,
    name: String,
    slug: String,
    readme: String,
) -> Result<(), String> {
    let t = state
        .load_templates()?
        .into_iter()
        .find(|t| t.id == local_template_id)
        .ok_or_else(|| format!("no template named \"{local_template_id}\""))?;
    // A blank slug means the app drafts one from the name; the
    // registry checks the result itself.
    let slug = if slug.trim().is_empty() {
        registry::slugify(&name)
    } else {
        slug
    };
    let template: serde_json::Value =
        serde_json::from_str(&t.template).map_err(|e| format!("the template is not JSON: {e}"))?;
    let sample: serde_json::Value =
        serde_json::from_str(&t.sample).unwrap_or_else(|_| serde_json::Value::Array(Vec::new()));
    let body = serde_json::json!({
        "localTemplateId": t.id,
        "name": name,
        "slug": slug,
        "readme": readme,
        "template": template,
        "sample": sample,
    });
    state
        .enqueue_op(
            "publish",
            &body.to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
        .map_err(|e| format!("the operation could not be queued: {e}"))?;
    registry::Registry::from_settings(&state)?
        .refresh(&state)
        .await?;
    Ok(())
}

/// Unpublish a local template: the registry's copy is deleted, the
/// operation queued, and the sync applies it — the tombstone drops the
/// mirror row.
#[tauri::command]
async fn unpublish_template(
    state: State<'_, Arc<Store>>,
    local_template_id: String,
) -> Result<(), String> {
    let pub_ = state
        .publication_for_local(&local_template_id)?
        .ok_or_else(|| format!("\"{local_template_id}\" is not published to the registry"))?;
    let body = serde_json::json!({ "owner": pub_.owner, "slug": pub_.slug });
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state.enqueue_op("unpublish", &body.to_string(), ms)?;
    registry::Registry::from_settings(&state)?
        .refresh(&state)
        .await?;
    Ok(())
}

/// Save a community template: the flag is queued, the sync sets it on
/// the registry, and the template lands as an editable local copy
/// (id `saved-{owner}-{slug}`).
#[tauri::command]
async fn save_community_template(
    state: State<'_, Arc<Store>>,
    owner: String,
    slug: String,
) -> Result<(), String> {
    let body = serde_json::json!({ "owner": owner, "slug": slug });
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state.enqueue_op("save", &body.to_string(), ms)?;
    registry::Registry::from_settings(&state)?
        .refresh(&state)
        .await?;
    Ok(())
}

/// Unsave a community template: the flag falls, the local copy stays.
#[tauri::command]
async fn unsave_community_template(
    state: State<'_, Arc<Store>>,
    owner: String,
    slug: String,
) -> Result<(), String> {
    let body = serde_json::json!({ "owner": owner, "slug": slug });
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state.enqueue_op("unsave", &body.to_string(), ms)?;
    registry::Registry::from_settings(&state)?
        .refresh(&state)
        .await?;
    Ok(())
}

/// The community mirror: what the change feed has put there, the
/// saved flags as the registry says them.
#[tauri::command]
fn community_templates(state: State<'_, Arc<Store>>) -> Result<Vec<CommunityTemplate>, String> {
    state.community_templates()
}

/// What this account has published: the local template each one came
/// from, and the text the last push sent.
#[tauri::command]
fn publications(state: State<'_, Arc<Store>>) -> Result<Vec<Publication>, String> {
    state.publications()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Start-with-computer (plan phase 7): the plugin writes where
        // the OS looks — a Run key on Windows, an autostart entry on
        // Linux — and keeps the choice across runs.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::default(),
            None,
        ))
        // printninja:// deep links (plan phase 8): registered before
        // single-instance, because that plugin's `deep-link` feature
        // re-parses a second instance's CLI args through this plugin
        // and emits the URL on the running app's handle — the instance
        // that received the link from the OS exits right after
        // forwarding. The frontend listens and, at start-up, reads
        // the current URL to pick up a link that arrived before the
        // webview was ready.
        .plugin(tauri_plugin_deep_link::init())
        // A second launch (or a deep link) focuses the running window
        // instead of starting a second app — required once
        // close-to-tray keeps the process alive after the window is
        // gone.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_the_main_window(app)
        }))
        .setup(|app| {
            let dir = profiles_dir(app.handle());
            let profiles =
                Arc::new(load_profiles(&dir).unwrap_or_else(|e| {
                    panic!("the profile set at {} must load: {e}", dir.display())
                }));
            app.manage(AppProfiles {
                profiles: profiles.clone(),
            });
            // The local store: one SQLite file in the app's data
            // directory. When it cannot open, the app still runs —
            // the commands say so, and the UI keeps its in-memory
            // copies and names the failure. An `Arc` because the local
            // print API reads and writes it from its own task.
            let db_path = app
                .path()
                .app_data_dir()
                .expect("the app must have a data directory")
                .join("printninja.db");
            let store = match Store::open(&db_path) {
                Ok(store) => Some(Arc::new(store)),
                Err(e) => {
                    eprintln!("the local store at {} did not open: {e}", db_path.display());
                    None
                }
            };
            if let Some(store) = &store {
                app.manage(store.clone());
            }
            // The local print API (plan phase 8): 127.0.0.1 by
            // default, the whole network with the LAN switch on —
            // the profiles, the store and the pairing window shared
            // with the commands above. Without a store the templates
            // and the print endpoint could only fail, so the API does
            // not start at all.
            if let Some(store) = store {
                let api_state = Arc::new(api::ApiState {
                    profiles,
                    store: store.clone(),
                    window: Arc::new(std::sync::Mutex::new(None)),
                });
                app.manage(api_state.clone());
                tauri::async_runtime::spawn(api::serve(api_state));
            }
            // The tray icon (plan phase 7): the app lives in the tray,
            // so the window's close button hides it instead of
            // quitting; the menu holds the way back and the way out.
            let show = MenuItem::with_id(app, "tray-show", "Show PrintNinja", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "Quit PrintNinja", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("the app must carry its own icon"),
                )
                .tooltip("PrintNinja")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-show" => show_the_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            show_the_main_window(tray.app_handle());
                        }
                    }
                })
                .build(app)?;
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
            save_setting,
            is_autostart,
            set_autostart,
            begin_pairing,
            paired_devices,
            revoke_device,
            parse_deeplink,
            registry_url,
            registry_status,
            registry_refresh,
            registry_login,
            registry_logout,
            publish_template,
            unpublish_template,
            save_community_template,
            unsave_community_template,
            community_templates,
            publications
        ])
        .build(tauri::generate_context!())
        .expect("error while building PrintNinja");
    app.run(|app_handle, event| match event {
        // The window's close button hides the app to the tray;
        // quitting is the tray menu's "Quit PrintNinja".
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
            }
            api.prevent_close();
        }
        _ => {}
    });
}

/// Bring the main window back: shown, focused, unminimised.
fn show_the_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
