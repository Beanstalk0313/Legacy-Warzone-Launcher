mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST come first. When the user launches the app
        // a second time, this plugin:
        //   1. Tells the existing process to refocus its main window.
        //   2. Drops the duplicate launch silently.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // Relaunch support for the auto-updater (relaunch() after install).
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Auto-updater: checks the configured update endpoint (GitHub
            // release) and installs signed update bundles. Requires the
            // pubkey + endpoints config in tauri.conf.json — see
            // AUTO_UPDATE.md for the release/signing setup.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .expect("failed to register the updater plugin");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::run_rtm_command,
            commands::rtm_exe_path_command,
            commands::write_rtm_file_command,
            commands::load_settings_command,
            commands::save_settings_command,
            commands::load_user_identity_command,
            commands::save_user_identity_command,
            commands::clear_user_identity_command,
            commands::apply_display_mode_command,
            commands::minimize_window_command,
            commands::request_window_close_command,
            commands::exit_app_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
