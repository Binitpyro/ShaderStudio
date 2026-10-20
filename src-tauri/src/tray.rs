use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// The MCP server (`scripts/mcp-server.js`) speaks JSON-RPC over stdio, so it must be launched by
/// the AI client (Claude Desktop, Cursor, ...), not by this app. The tray item explains how.
const MCP_HELP: &str = "ShaderStudio's MCP server is a stdio process that your AI client starts.\n\n\
1. In the ShaderStudio folder run:  npm run bridge   (dev bridge on port 8642)\n\
2. Add this to your MCP client config (e.g. claude_desktop_config.json):\n\n\
{ \"mcpServers\": { \"shaderstudio\": { \"command\": \"node\", \"args\": [\"<path to ShaderStudio>/scripts/mcp-server.js\"] } } }\n\n\
Node.js must be installed. See README: \"Connecting External AI Agents via MCP\".";

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open ShaderStudio", true, None::<&str>)?;
    let mcp_item = MenuItem::with_id(app, "mcp_help", "Connect AI agent (MCP)...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &mcp_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ShaderStudio")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "mcp_help" => {
                app.dialog()
                    .message(MCP_HELP)
                    .title("Connect an AI agent via MCP")
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
