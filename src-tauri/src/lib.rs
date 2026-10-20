pub mod commands;
pub mod tray;

use commands::fs_dialog::{
    load_project_native, pick_open_project_native, pick_save_project_native, save_project_native, PickedPaths,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PickedPaths::default())
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
            pick_open_project_native,
            pick_save_project_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShaderStudio desktop application");
}
