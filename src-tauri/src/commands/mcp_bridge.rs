use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Mutex;
use tokio::sync::oneshot;
use warp::Filter;
use futures_util::FutureExt;

static MCP_BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);
static MCP_BRIDGE_PORT: AtomicU16 = AtomicU16::new(0);
static MCP_SHUTDOWN_TX: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

fn stop_mcp_bridge_internal() {
    if let Ok(mut lock) = MCP_SHUTDOWN_TX.lock() {
        if let Some(tx) = lock.take() {
            let _ = tx.send(());
        }
    }
    MCP_BRIDGE_RUNNING.store(false, Ordering::SeqCst);
    MCP_BRIDGE_PORT.store(0, Ordering::SeqCst);
}

#[tauri::command]
pub async fn start_mcp_bridge(port: u32) -> Result<String, String> {
    if port <= 1024 || port > 65535 {
        return Err(format!("Invalid port: {}. Must be between 1025 and 65535", port));
    }

    // Stop any existing bridge before starting on new port
    stop_mcp_bridge_internal();

    let server_port = port as u16;

    // GET /health and GET /status
    let health_port = port;
    let health_route = warp::path("health")
        .and(warp::get())
        .map(move || {
            warp::reply::json(&serde_json::json!({
                "status": "ok",
                "app": "ShaderStudio",
                "port": health_port,
                "mcp_version": "2024-11-05"
            }))
        });

    let status_port = port;
    let status_route = warp::path("status")
        .and(warp::get())
        .map(move || {
            warp::reply::json(&serde_json::json!({
                "status": "ok",
                "app": "ShaderStudio",
                "port": status_port,
                "mcp_version": "2024-11-05"
            }))
        });

    // POST /mcp JSON-RPC endpoint
    let mcp_route = warp::path("mcp")
        .and(warp::post())
        .and(warp::body::json())
        .map(|body: serde_json::Value| {
            let id = body.get("id").cloned().unwrap_or(serde_json::json!(1));
            let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
            let response = match method {
                "initialize" => serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "ShaderStudio MCP Bridge",
                            "version": "0.1.0"
                        }
                    }
                }),
                "tools/list" => serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "compile_shader",
                                "description": "Compile GLSL / WGSL shader code",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "source": { "type": "string" },
                                        "stage": { "type": "string", "enum": ["fragment", "vertex"] }
                                    },
                                    "required": ["source"]
                                }
                            },
                            {
                                "name": "inspect_graph",
                                "description": "Inspect active node graph topology and uniforms",
                                "inputSchema": { "type": "object" }
                            }
                        ]
                    }
                }),
                _ => serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "status": "acknowledged",
                        "method": method
                    }
                })
            };
            warp::reply::json(&response)
        });

    let routes = health_route.or(status_route).or(mcp_route);

    let (tx, rx) = oneshot::channel::<()>();

    let (_addr, server) = warp::serve(routes)
        .bind_with_graceful_shutdown(([127, 0, 0, 1], server_port), rx.map(|_| ()));

    tokio::spawn(server);

    MCP_BRIDGE_RUNNING.store(true, Ordering::SeqCst);
    MCP_BRIDGE_PORT.store(server_port, Ordering::SeqCst);
    if let Ok(mut lock) = MCP_SHUTDOWN_TX.lock() {
        *lock = Some(tx);
    }

    Ok(format!("MCP Bridge active on port {}", port))
}

#[tauri::command]
pub async fn get_mcp_bridge_status() -> Result<bool, String> {
    Ok(MCP_BRIDGE_RUNNING.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn stop_mcp_bridge() -> Result<String, String> {
    stop_mcp_bridge_internal();
    Ok("MCP Bridge stopped".to_string())
}

