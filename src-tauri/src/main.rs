#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod session;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            session::start(app.handle().clone())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![session::get_session_state])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                session::stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start Priority Queue");
}