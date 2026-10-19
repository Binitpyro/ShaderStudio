pub mod commands;
pub mod tray;

use commands::fs_dialog::{load_project_native, save_project_native};
use commands::mcp_bridge::{get_mcp_bridge_status, start_mcp_bridge, stop_mcp_bridge};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = tray::setup_tray(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_project_native,
            load_project_native,
            start_mcp_bridge,
            get_mcp_bridge_status,
            stop_mcp_bridge
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShaderStudio desktop application");
}
