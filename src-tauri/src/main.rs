#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod session;
mod startup;
mod storage;
mod tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Priority Queue").build())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("PRIORITY_QUEUE_TEST_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(directory);
            app.manage(storage::SecureStorage::new(directory));
            session::start(app.handle().clone())?;
            Ok(())
        })
        .invoke_handler(|invoke| {
            #[cfg(all(debug_assertions, windows))]
            if invoke.message.command() == "test_tray" {
                let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![tray::test_tray];
                return handler(invoke);
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![session::get_session_state, startup::set_startup_enabled, storage::read_app_data, storage::save_queue_data, storage::save_app_preference, tray::initialize_tray];
            handler(invoke)
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                session::stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start Priority Queue");
}