use std::fs;
use std::path::Path;
use shaderstudio_desktop_lib::commands::fs_dialog::{load_project_native, save_project_native};
use shaderstudio_desktop_lib::commands::mcp_bridge::{get_mcp_bridge_status, start_mcp_bridge, stop_mcp_bridge};

#[tokio::test]
async fn test_adversarial_extension_enforcement() {
    let dummy_json = r#"{"name": "AdversarialTest", "version": 1}"#.to_string();

    // 1. Invalid extensions that must be rejected
    let invalid_extensions = vec![
        "test.json",
        "test.txt",
        "test.glsl",
        "test.wgsl",
        "test.shader",
        "test.shaderstudio.bak",
        "test.shaderstudio.tmp",
        "test.shaderstudio/",
        "test.shaderstudio\\",
        "test.shaderstudio ",
        "test.shaderstudio.json",
        "test",
        "test.",
        "shaderstudio",
        ".shaderstudio.old",
    ];

    for path in invalid_extensions {
        let res = save_project_native(Some(path.to_string()), dummy_json.clone()).await;
        assert!(
            res.is_err(),
            "Expected save_project_native to reject invalid path: '{}', but got Ok({:?})",
            path,
            res
        );
        let err = res.err().unwrap();
        assert_eq!(
            err, "File extension must be .shaderstudio",
            "Error for '{}' was expected to be 'File extension must be .shaderstudio', got: '{}'",
            path, err
        );
    }
}

#[tokio::test]
async fn test_case_sensitivity_extension() {
    let dummy_json = r#"{"name": "CaseTest"}"#.to_string();

    // The current specification enforces exact lowercase ".shaderstudio"
    let uppercase_paths = vec![
        "test.SHADERSTUDIO",
        "test.ShaderStudio",
        "test.Shaderstudio",
    ];

    for path in uppercase_paths {
        let res = save_project_native(Some(path.to_string()), dummy_json.clone()).await;
        assert!(
            res.is_err(),
            "Expected save_project_native to reject non-lowercase path '{}', got Ok({:?})",
            path,
            res
        );
        assert_eq!(res.err().unwrap(), "File extension must be .shaderstudio");
    }
}

#[tokio::test]
async fn test_empty_and_whitespace_paths() {
    let dummy_json = r#"{"name": "EmptyPathTest"}"#.to_string();

    // Empty string in save_project_native
    let res_empty = save_project_native(Some("".to_string()), dummy_json.clone()).await;
    assert!(
        res_empty.is_err(),
        "Expected empty path in save to fail, got Ok({:?})",
        res_empty
    );
    assert_eq!(res_empty.err().unwrap(), "File extension must be .shaderstudio");

    // Whitespace string in save_project_native
    let res_spaces = save_project_native(Some("   ".to_string()), dummy_json.clone()).await;
    assert!(res_spaces.is_err());
    assert_eq!(res_spaces.err().unwrap(), "File extension must be .shaderstudio");

    // Empty path in load_project_native
    let res_load_empty = load_project_native(Some("".to_string())).await;
    assert!(res_load_empty.is_err());
    assert_eq!(res_load_empty.err().unwrap(), "File not found: (empty path)");

    // None path in load_project_native
    let res_load_none = load_project_native(None).await;
    assert!(res_load_none.is_err());
    assert_eq!(res_load_none.err().unwrap(), "File not found: (empty path)");
}

#[tokio::test]
async fn test_non_existent_file_load() {
    let fake_path = "target/adversarial_tmp/does_not_exist_98765.shaderstudio".to_string();
    let res = load_project_native(Some(fake_path.clone())).await;
    assert!(res.is_err());
    let err = res.err().unwrap();
    assert!(
        err.starts_with("File not found:"),
        "Expected error to start with 'File not found:', got '{}'",
        err
    );
    assert!(err.contains(&fake_path));
}

#[tokio::test]
async fn test_roundtrip_deep_nested_and_unicode_fidelity() {
    let deep_dir = "target/adversarial_tmp/deep/level1/level2/level3";
    let test_file = format!("{}/unicode_project_🔥.shaderstudio", deep_dir);

    // Clean up if existed
    if Path::new(&test_file).exists() {
        let _ = fs::remove_file(&test_file);
    }

    // Complex shader studio project with unicode, escaped quotes, GLSL code, and math symbols
    let complex_project = serde_json::json!({
        "projectName": "🌟 Neo-Tokyo Cyber Shaders 2026 🌟",
        "author": "Binit / ShaderStudio 团队",
        "description": "Complex multi-pass raymarching with λ, π, √2 and emojis 🚀💻",
        "glslSource": "precision highp float;\nuniform float u_time;\n// Comment with non-ascii: äöü çã ñ\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / vec2(1920.0, 1080.0);\n  gl_FragColor = vec4(uv.x, uv.y, sin(u_time * 3.14159265), 1.0);\n}\n",
        "nodeCount": 42,
        "metadata": {
            "tags": ["raymarching", "PBR", "WebGPU", "tauri-v2"],
            "whitespaceTest": "\t  \r\n\t\t\n  spaced  \n",
            "nestedObject": {
                "depth": 5,
                "values": [1.0, -0.00001, 1e8, "quote: \"hello world\""]
            }
        }
    }).to_string();

    // 1. Save to deeply nested path (tests create_dir_all and unicode path)
    let save_res = save_project_native(Some(test_file.clone()), complex_project.clone()).await;
    assert!(save_res.is_ok(), "Failed to save to deep unicode path: {:?}", save_res);
    assert_eq!(save_res.unwrap(), test_file);
    assert!(Path::new(&test_file).exists());

    // 2. Load from path
    let load_res = load_project_native(Some(test_file.clone())).await;
    assert!(load_res.is_ok(), "Failed to load saved unicode project: {:?}", load_res);
    let (loaded_path, loaded_content) = load_res.unwrap();
    assert_eq!(loaded_path, test_file);
    assert_eq!(loaded_content, complex_project, "Content corrupted during round-trip!");

    // Verify JSON parse round-trip
    let parsed: serde_json::Value = serde_json::from_str(&loaded_content).expect("Loaded content is not valid JSON");
    assert_eq!(parsed["projectName"], "🌟 Neo-Tokyo Cyber Shaders 2026 🌟");
    assert_eq!(parsed["metadata"]["tags"][3], "tauri-v2");

    // Clean up
    let _ = fs::remove_file(&test_file);
}

#[tokio::test]
async fn test_large_payload_stress() {
    let large_file = "target/adversarial_tmp/large_stress.shaderstudio".to_string();
    if Path::new(&large_file).exists() {
        let _ = fs::remove_file(&large_file);
    }

    // Generate ~2MB of project JSON with 1000 nodes
    let mut nodes = Vec::new();
    for i in 0..1000 {
        nodes.push(serde_json::json!({
            "id": format!("node_{}", i),
            "type": "customNode",
            "position": { "x": i * 10, "y": i * 20 },
            "data": {
                "title": format!("Procedural Node {}", i),
                "glsl": "vec4 compute(vec2 uv) { return vec4(sin(uv.x), cos(uv.y), 0.5, 1.0); }",
                "params": [i as f64 * 0.1, i as f64 * 0.2, i as f64 * 0.3]
            }
        }));
    }
    let large_project = serde_json::json!({ "nodes": nodes }).to_string();
    assert!(large_project.len() > 100_000, "Payload smaller than expected");

    let save_res = save_project_native(Some(large_file.clone()), large_project.clone()).await;
    assert!(save_res.is_ok(), "Failed to save large payload: {:?}", save_res);

    let load_res = load_project_native(Some(large_file.clone())).await;
    assert!(load_res.is_ok(), "Failed to load large payload: {:?}", load_res);
    let (_, content) = load_res.unwrap();
    assert_eq!(content.len(), large_project.len());

    let _ = fs::remove_file(&large_file);
}

#[tokio::test]
async fn test_directory_target_conflict() {
    let dir_as_file = "target/adversarial_tmp/a_directory.shaderstudio";
    let _ = fs::create_dir_all(dir_as_file);

    // Attempting to save over an existing directory path should fail
    let res = save_project_native(Some(dir_as_file.to_string()), "{}".to_string()).await;
    assert!(res.is_err(), "Saving over a directory path should return Err");

    // Attempting to load an existing directory should fail
    let load_res = load_project_native(Some(dir_as_file.to_string())).await;
    assert!(load_res.is_err(), "Loading a directory path should return Err");

    let _ = fs::remove_dir_all(dir_as_file);
}

static BRIDGE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn test_adversarial_mcp_bridge_ports() {
    let _guard = BRIDGE_TEST_LOCK.lock().unwrap();
    // 1. Privileged / reserved ports
    for port in [0, 1, 22, 80, 443, 1024] {
        let res = start_mcp_bridge(port).await;
        assert!(res.is_err(), "Port {} should have been rejected", port);
        assert_eq!(
            res.err().unwrap(),
            format!("Invalid port: {}. Must be between 1025 and 65535", port)
        );
    }

    // 2. Out of range ports > 65535
    for port in [65536, 70000, 999999] {
        let res = start_mcp_bridge(port).await;
        assert!(res.is_err(), "Port {} should have been rejected", port);
        assert_eq!(
            res.err().unwrap(),
            format!("Invalid port: {}. Must be between 1025 and 65535", port)
        );
    }

    // 3. Boundary ports 1025 and 65535
    let res_1025 = start_mcp_bridge(1025).await;
    assert!(res_1025.is_ok());
    assert_eq!(res_1025.unwrap(), "MCP Bridge active on port 1025");
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    let stop_res = stop_mcp_bridge().await;
    assert!(stop_res.is_ok());
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);

    let res_65535 = start_mcp_bridge(65535).await;
    assert!(res_65535.is_ok());
    assert_eq!(res_65535.unwrap(), "MCP Bridge active on port 65535");
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    let _ = stop_mcp_bridge().await;
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);
}

#[tokio::test]
async fn test_live_mcp_bridge_http_server_and_graceful_shutdown() {
    let _guard = BRIDGE_TEST_LOCK.lock().unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let test_port: u32 = 29584;

    // Start real MCP server
    let start_res = start_mcp_bridge(test_port).await;
    assert!(start_res.is_ok());
    assert_eq!(get_mcp_bridge_status().await.unwrap(), true);

    // Give server a brief moment to bind
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // 1. Test GET /health over real TCP socket
    let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", test_port))
        .await
        .expect("Failed to connect to MCP server on 127.0.0.1");
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).await.unwrap();
    assert!(resp.contains("200 OK"), "Expected 200 OK, got: {}", resp);
    assert!(resp.contains("\"status\":\"ok\""));
    assert!(resp.contains("\"app\":\"ShaderStudio\""));
    assert!(resp.contains(&format!("\"port\":{}", test_port)));
    assert!(resp.contains("\"mcp_version\":\"2024-11-05\""));

    // 2. Test GET /status over real TCP socket
    let mut stream2 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).await.unwrap();
    stream2
        .write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut resp2 = String::new();
    stream2.read_to_string(&mut resp2).await.unwrap();
    assert!(resp2.contains("200 OK"));
    assert!(resp2.contains("\"status\":\"ok\""));

    // 3. Test POST /mcp with JSON-RPC initialize
    let init_payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 42,
        "method": "initialize",
        "params": {}
    })
    .to_string();

    let mut stream3 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).await.unwrap();
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        init_payload.len(),
        init_payload
    );
    stream3.write_all(req.as_bytes()).await.unwrap();
    let mut resp3 = String::new();
    stream3.read_to_string(&mut resp3).await.unwrap();
    assert!(resp3.contains("200 OK"));
    assert!(resp3.contains("\"protocolVersion\":\"2024-11-05\""));
    assert!(resp3.contains("ShaderStudio MCP Bridge"));

    // 4. Test POST /mcp with JSON-RPC tools/list
    let tools_payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 43,
        "method": "tools/list"
    })
    .to_string();

    let mut stream4 = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).await.unwrap();
    let req_tools = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        tools_payload.len(),
        tools_payload
    );
    stream4.write_all(req_tools.as_bytes()).await.unwrap();
    let mut resp4 = String::new();
    stream4.read_to_string(&mut resp4).await.unwrap();
    assert!(resp4.contains("200 OK"));
    assert!(resp4.contains("compile_shader"));
    assert!(resp4.contains("inspect_graph"));

    // 5. Test Graceful Shutdown
    let stop_res = stop_mcp_bridge().await;
    assert!(stop_res.is_ok());
    assert_eq!(get_mcp_bridge_status().await.unwrap(), false);

    // Give server a brief moment to shut down
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Verify socket is closed and connection is refused
    let conn_after = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).await;
    assert!(
        conn_after.is_err(),
        "Expected connection to be refused after shutdown, but it succeeded!"
    );
}

