use std::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use shaderstudio_desktop_lib::commands::fs_dialog::{load_project_native, save_project_native};
use shaderstudio_desktop_lib::commands::mcp_bridge::{get_mcp_bridge_status, start_mcp_bridge, stop_mcp_bridge};

static GATE3_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn test_gate3_mcp_stress_and_lifecycle() {
    let _guard = GATE3_LOCK.lock().unwrap();
    let port: u32 = 39820;

    let start_res = start_mcp_bridge(port).await;
    assert!(start_res.is_ok(), "Failed to start MCP bridge on port {}: {:?}", port, start_res);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    let mut handles = Vec::new();
    for i in 0..40 {
        let task_port = port;
        handles.push(tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", task_port))
                .await
                .expect("Failed to connect in concurrent task");

            match i % 4 {
                0 => {
                    // GET /health
                    stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
                    let mut resp = String::new();
                    stream.read_to_string(&mut resp).await.unwrap();
                    assert!(resp.contains("200 OK"));
                    assert!(resp.contains("\"status\":\"ok\""));
                }
                1 => {
                    // GET /status
                    stream.write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
                    let mut resp = String::new();
                    stream.read_to_string(&mut resp).await.unwrap();
                    assert!(resp.contains("200 OK"));
                    assert!(resp.contains(&format!("\"port\":{}", task_port)));
                }
                2 => {
                    // POST /mcp initialize
                    let body = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": format!("init-{}", i),
                        "method": "initialize"
                    }).to_string();
                    let req = format!(
                        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    stream.write_all(req.as_bytes()).await.unwrap();
                    let mut resp = String::new();
                    stream.read_to_string(&mut resp).await.unwrap();
                    assert!(resp.contains("200 OK"));
                    assert!(resp.contains("\"protocolVersion\":\"2024-11-05\""));
                    assert!(resp.contains(&format!("\"id\":\"init-{}\"", i)));
                }
                _ => {
                    // POST /mcp tools/list
                    let body = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": i,
                        "method": "tools/list"
                    }).to_string();
                    let req = format!(
                        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    stream.write_all(req.as_bytes()).await.unwrap();
                    let mut resp = String::new();
                    stream.read_to_string(&mut resp).await.unwrap();
                    assert!(resp.contains("200 OK"));
                    assert!(resp.contains("compile_shader"));
                    assert!(resp.contains("inspect_graph"));
                }
            }
        }));
    }

    for h in handles {
        h.await.expect("Concurrent stress task panicked");
    }

    let stop_res = stop_mcp_bridge().await;
    assert!(stop_res.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);

    // Verify socket closed
    let conn_after = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await;
    assert!(conn_after.is_err(), "Socket should be closed after graceful shutdown");
}

#[tokio::test]
async fn test_gate3_mcp_json_rpc_adversarial_types() {
    let _guard = GATE3_LOCK.lock().unwrap();
    let port: u32 = 39821;

    assert!(start_mcp_bridge(port).await.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Test with boolean id
    let mut stream1 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let body1 = serde_json::json!({
        "jsonrpc": "2.0",
        "id": true,
        "method": "tools/list"
    }).to_string();
    let req1 = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body1.len(),
        body1
    );
    stream1.write_all(req1.as_bytes()).await.unwrap();
    let mut resp1 = String::new();
    stream1.read_to_string(&mut resp1).await.unwrap();
    assert!(resp1.contains("200 OK"));
    assert!(resp1.contains("\"id\":true"));

    // Test with null id (should default to 1)
    let mut stream2 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let body2 = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "initialize"
    }).to_string();
    let req2 = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body2.len(),
        body2
    );
    stream2.write_all(req2.as_bytes()).await.unwrap();
    let mut resp2 = String::new();
    stream2.read_to_string(&mut resp2).await.unwrap();
    assert!(resp2.contains("200 OK"));
    assert!(resp2.contains("\"id\":1"));

    let _ = stop_mcp_bridge().await;
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

#[tokio::test]
async fn test_gate3_fs_empty_and_corrupt_paths() {
    // 1. Explicit empty string
    let res_save_empty = save_project_native(Some("".to_string()), "{}".to_string()).await;
    assert!(res_save_empty.is_err());
    assert_eq!(res_save_empty.err().unwrap(), "File extension must be .shaderstudio");

    // 2. Whitespace only
    let res_save_space = save_project_native(Some("    ".to_string()), "{}".to_string()).await;
    assert!(res_save_space.is_err());
    assert_eq!(res_save_space.err().unwrap(), "File extension must be .shaderstudio");

    // 3. Load with empty string or None
    let res_load_empty = load_project_native(Some("".to_string())).await;
    assert!(res_load_empty.is_err());
    assert_eq!(res_load_empty.err().unwrap(), "File not found: (empty path)");

    let res_load_none = load_project_native(None).await;
    assert!(res_load_none.is_err());
    assert_eq!(res_load_none.err().unwrap(), "File not found: (empty path)");

    // 4. Save and load unicode & deep nested path
    let target_dir = "target/adversarial_gate3/深層ディレクトリー";
    let target_file = format!("{}/テスト.shaderstudio", target_dir);
    let payload = r#"{"name": "シェーダースタジオ", "unicode_tested": true}"#.to_string();

    let save_ok = save_project_native(Some(target_file.clone()), payload.clone()).await;
    assert!(save_ok.is_ok(), "Deep unicode path save failed: {:?}", save_ok);

    let load_ok = load_project_native(Some(target_file.clone())).await;
    assert!(load_ok.is_ok(), "Deep unicode path load failed: {:?}", load_ok);
    let (loaded_path, loaded_content) = load_ok.unwrap();
    assert_eq!(loaded_path, target_file);
    assert_eq!(loaded_content, payload);

    // Clean up
    let _ = fs::remove_file(&target_file);
    let _ = fs::remove_dir_all("target/adversarial_gate3");
}
