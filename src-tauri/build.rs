fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_session_state",
            "set_startup_enabled",
            "read_app_data",
            "save_queue_data",
            "save_app_preference",
        ]),
    )).expect("Could not build app permissions");
}