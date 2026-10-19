use shaderstudio_desktop_lib::commands::fs_dialog::{get_default_project_path, load_project_native, save_project_native};
use std::fs;
use std::path::Path;
use warp::Filter;

#[tokio::test]
async fn test_default_project_path_resolution() {
    let default_path = get_default_project_path();
    assert!(
        default_path.ends_with(".shaderstudio"),
        "Default path must end with .shaderstudio, got: {}",
        default_path
    );
    assert!(
        !default_path.contains('\\'),
        "Default path must have forward slashes only: {}",
        default_path
    );
}

#[tokio::test]
async fn test_save_with_none_path_uses_default() {
    let dummy_json = r#"{"test": "default_save"}"#.to_string();
    let res = save_project_native(None, dummy_json.clone()).await;
    assert!(res.is_ok(), "Saving with None path should succeed using default path: {:?}", res);
    let saved_path = res.unwrap();
    assert!(saved_path.ends_with(".shaderstudio"));
    assert!(Path::new(&saved_path).exists());

    // Clean up
    let _ = fs::remove_file(&saved_path);
}

#[tokio::test]
async fn test_empty_string_path_rejection() {
    let res_save = save_project_native(Some("".to_string()), "{}".to_string()).await;
    assert!(res_save.is_err(), "Empty path string in save should fail");
    assert_eq!(res_save.err().unwrap(), "File extension must be .shaderstudio");

    let res_load = load_project_native(Some("".to_string())).await;
    assert!(res_load.is_err(), "Empty path string in load should fail");
    assert_eq!(res_load.err().unwrap(), "File not found: (empty path)");
}

#[tokio::test]
async fn test_none_path_in_load_rejected() {
    let res_load = load_project_native(None).await;
    assert!(res_load.is_err(), "None path in load should fail");
    assert_eq!(res_load.err().unwrap(), "File not found: (empty path)");
}

#[tokio::test]
async fn test_warp_try_bind_graceful_shutdown() {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let route = warp::path("ping").map(|| "pong");
    let test_port: u16 = 33891;

    let bind_result = warp::serve(route)
        .try_bind_with_graceful_shutdown(([127, 0, 0, 1], test_port), async {
            let _ = rx.await;
        });

    assert!(bind_result.is_ok(), "Failed to bind warp server");
    let (addr, server) = bind_result.unwrap();
    assert_eq!(addr.port(), test_port);

    let server_task = tokio::spawn(server);

    // Verify response
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    let resp = reqwest_like_get(test_port).await;
    assert!(resp.contains("pong"));

    // Send shutdown
    let _ = tx.send(());
    let _ = server_task.await;
}

async fn reqwest_like_get(port: u16) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
        .await
        .expect("Failed to connect");
    stream
        .write_all(b"GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).await.unwrap();
    resp
}

#[tokio::test]
async fn test_multithreaded_save_load_stress() {
    let test_dir = "target/adversarial_tmp/multithreaded";
    let _ = fs::create_dir_all(test_dir);

    let mut handles = Vec::new();
    for i in 0..10 {
        let file_path = format!("{}/thread_{}.shaderstudio", test_dir, i);
        let content = format!(r#"{{"threadId": {}, "timestamp": 123456789}}"#, i);
        handles.push(tokio::spawn(async move {
            let save_res = save_project_native(Some(file_path.clone()), content.clone()).await;
            assert!(save_res.is_ok());

            let load_res = load_project_native(Some(file_path.clone())).await;
            assert!(load_res.is_ok());
            let (_, loaded) = load_res.unwrap();
            assert_eq!(loaded, content);

            let _ = fs::remove_file(&file_path);
        }));
    }

    for h in handles {
        h.await.unwrap();
    }
}
