use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "priority-queue";

fn request_mode(app: &AppHandle, compact: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("tray-mode", compact);
    }
}

fn menu_action(app: &AppHandle, id: &str) {
    match id {
        "open-full" => request_mode(app, false),
        "show-mini" => request_mode(app, true),
        "quit" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        _ => {}
    }
}

#[cfg(all(debug_assertions, windows))]
#[tauri::command]
pub async fn test_tray(app: AppHandle, action: String) -> Result<serde_json::Value, String> {
    if std::env::var_os("PRIORITY_QUEUE_TEST_DATA_DIR").is_none() {
        return Err("Tray tests require an isolated debug profile.".into());
    }
    match action.as_str() {
        "state" => {}
        "click" => request_mode(&app, false),
        "open-full" | "show-mini" | "quit" => menu_action(&app, &action),
        _ => return Err("Unknown tray test action.".into()),
    }
    let window = app.get_webview_window("main").ok_or("Main window is unavailable.")?;
    Ok(serde_json::json!({
        "trayExists": app.tray_by_id(TRAY_ID).is_some(),
        "visible": window.is_visible().map_err(|error| error.to_string())?,
    }))
}

#[tauri::command]
pub async fn initialize_tray(app: AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() { return Ok(()); }
    let full = MenuItem::with_id(&app, "open-full", "Open full view", true, None::<&str>).map_err(|error| error.to_string())?;
    let mini = MenuItem::with_id(&app, "show-mini", "Show mini overlay", true, None::<&str>).map_err(|error| error.to_string())?;
    let separator = PredefinedMenuItem::separator(&app).map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|error| error.to_string())?;
    let menu = Menu::with_items(&app, &[&full, &mini, &separator, &quit]).map_err(|error| error.to_string())?;
    let icon = app.default_window_icon().cloned().ok_or("The tray icon is unavailable.")?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Priority Queue")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { menu_action(&app, event.id.as_ref()); });
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                let app = tray.app_handle().clone();
                tauri::async_runtime::spawn(async move { request_mode(&app, false); });
            }
        })
        .build(&app)
        .map_err(|error| error.to_string())?;
    Ok(())
}