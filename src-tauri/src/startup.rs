use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn set_startup_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    let run_key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|error| error.to_string())?
        .0;

    if enabled {
        app.autolaunch().enable().map_err(|error| error.to_string())?;
        #[cfg(windows)]
        {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            run_key
                .set_value("Priority Queue", &format!("\"{}\"", executable.display()))
                .map_err(|error| error.to_string())?;
        }
    } else {
        #[cfg(windows)]
        match run_key.delete_value("Priority Queue") {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        #[cfg(not(windows))]
        app.autolaunch().disable().map_err(|error| error.to_string())?;
    }
    Ok(())
}