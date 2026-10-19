use tokio::io::{AsyncReadExt, AsyncWriteExt};
use shaderstudio_desktop_lib::commands::fs_dialog::get_default_project_path;
use shaderstudio_desktop_lib::commands::mcp_bridge::{get_mcp_bridge_status, start_mcp_bridge, stop_mcp_bridge};

static CHALLENGER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn test_concurrent_http_stress_requests() {
    let _guard = CHALLENGER_LOCK.lock().unwrap();
    let port: u32 = 39811;

    let start_res = start_mcp_bridge(port).await;
    assert!(start_res.is_ok(), "Failed to start MCP bridge on port {}: {:?}", port, start_res);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let mut handles = Vec::new();
    for i in 0..30 {
        let task_port = port;
        handles.push(tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", task_port))
                .await
                .expect("Failed to connect in concurrent task");

            if i % 3 == 0 {
                // GET /health
                stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
                let mut resp = String::new();
                stream.read_to_string(&mut resp).await.unwrap();
                assert!(resp.contains("200 OK"));
                assert!(resp.contains("\"status\":\"ok\""));
            } else if i % 3 == 1 {
                // GET /status
                stream.write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
                let mut resp = String::new();
                stream.read_to_string(&mut resp).await.unwrap();
                assert!(resp.contains("200 OK"));
                assert!(resp.contains("\"app\":\"ShaderStudio\""));
            } else {
                // POST /mcp initialize
                let body = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": i,
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
            }
        }));
    }

    for h in handles {
        h.await.expect("Concurrent task panicked");
    }

    let _ = stop_mcp_bridge().await;
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);
}

#[tokio::test]
async fn test_rapid_port_rebinding_and_lifecycle() {
    let _guard = CHALLENGER_LOCK.lock().unwrap();
    let port1: u32 = 39812;
    let port2: u32 = 39813;

    // 1. Start and stop on port1
    assert!(start_mcp_bridge(port1).await.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    assert!(stop_mcp_bridge().await.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);

    // 2. Immediately restart on SAME port1
    let restart_res = start_mcp_bridge(port1).await;
    assert!(restart_res.is_ok(), "Failed to rebind same port: {:?}", restart_res);
    tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    // Verify it responds
    let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port1)).await.unwrap();
    stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).await.unwrap();
    assert!(resp.contains("200 OK"));

    // 3. Switch port directly to port2 WITHOUT explicit stop call
    let switch_res = start_mcp_bridge(port2).await;
    assert!(switch_res.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    // Old port1 should now be refused
    let old_conn = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port1)).await;
    assert!(old_conn.is_err(), "Old port1 should have been closed when switching to port2");

    // New port2 should be active and responsive
    let mut stream2 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port2)).await.unwrap();
    stream2.write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
    let mut resp2 = String::new();
    stream2.read_to_string(&mut resp2).await.unwrap();
    assert!(resp2.contains("200 OK"));
    assert!(resp2.contains(&format!("\"port\":{}", port2)));

    let _ = stop_mcp_bridge().await;
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);
}

#[tokio::test]
async fn test_adversarial_json_rpc_malformed_and_edge_cases() {
    let _guard = CHALLENGER_LOCK.lock().unwrap();
    let port: u32 = 39814;

    assert!(start_mcp_bridge(port).await.is_ok());
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // 1. Non-JSON body on POST /mcp -> warp should reject with 400 Bad Request
    let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let bad_body = "NOT VALID JSON AT ALL";
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        bad_body.len(),
        bad_body
    );
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).await.unwrap();
    assert!(resp.contains("400 Bad Request"), "Expected 400 Bad Request for invalid JSON, got: {}", resp);

    // 2. Empty body on POST /mcp -> 400 Bad Request
    let mut stream2 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let req2 = "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    stream2.write_all(req2.as_bytes()).await.unwrap();
    let mut resp2 = String::new();
    stream2.read_to_string(&mut resp2).await.unwrap();
    assert!(resp2.contains("400 Bad Request"));

    // 3. String id in JSON-RPC request
    let mut stream3 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let payload3 = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "custom-uuid-string-99",
        "method": "tools/list"
    }).to_string();
    let req3 = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload3.len(),
        payload3
    );
    stream3.write_all(req3.as_bytes()).await.unwrap();
    let mut resp3 = String::new();
    stream3.read_to_string(&mut resp3).await.unwrap();
    assert!(resp3.contains("200 OK"));
    assert!(resp3.contains("\"id\":\"custom-uuid-string-99\""));
    assert!(resp3.contains("compile_shader"));

    // 4. Unknown method fallback acknowledgment
    let mut stream4 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    let payload4 = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 777,
        "method": "custom/arbitrary_method"
    }).to_string();
    let req4 = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload4.len(),
        payload4
    );
    stream4.write_all(req4.as_bytes()).await.unwrap();
    let mut resp4 = String::new();
    stream4.read_to_string(&mut resp4).await.unwrap();
    assert!(resp4.contains("200 OK"));
    assert!(resp4.contains("\"status\":\"acknowledged\""));
    assert!(resp4.contains("\"method\":\"custom/arbitrary_method\""));
    assert!(resp4.contains("\"id\":777"));

    // 5. Invalid HTTP Method (DELETE /mcp) -> 405 Method Not Allowed
    let mut stream5 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    stream5.write_all(b"DELETE /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
    let mut resp5 = String::new();
    stream5.read_to_string(&mut resp5).await.unwrap();
    assert!(resp5.contains("405 Method Not Allowed"));

    // 6. Unknown Path (GET /nonexistent) -> 404 Not Found
    let mut stream6 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.unwrap();
    stream6.write_all(b"GET /nonexistent HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
    let mut resp6 = String::new();
    stream6.read_to_string(&mut resp6).await.unwrap();
    assert!(resp6.contains("404 Not Found"));

    let _ = stop_mcp_bridge().await;
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

#[tokio::test]
async fn test_filesystem_default_path_and_normalization() {
    let default_path = get_default_project_path();
    assert!(default_path.ends_with(".shaderstudio"));
    // Verify forward slashes only (cross-platform normalization)
    assert!(!default_path.contains('\\'), "Default path contains backslashes: {}", default_path);
    assert!(default_path.contains("Documents/ShaderStudio/untitled.shaderstudio") || default_path == "./untitled.shaderstudio");
}
