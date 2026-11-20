//! PrintNinja (next) — Tauri shell. Windows and Linux first; Android in
//! phase 11. The frontend lives in `app/ui` and is embedded at compile
//! time via `tauri::generate_context!` (build it first).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running PrintNinja");
}
