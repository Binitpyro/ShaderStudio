use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::thread;
use std::time::Duration;

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

const PORT_TRIES: u16 = 20;
const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Bind `start`, or the next free port up to PORT_TRIES ports later.
fn bind_from(start: u16) -> Option<(TcpListener, u16)> {
    (0..PORT_TRIES)
        .filter_map(|i| start.checked_add(i))
        .find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (l, p)))
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

fn handle_connection(mut stream: TcpStream) {
    // Slow/idle clients must not pin a thread forever.
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let mut raw_path = parts[1];

    if method != "GET" && method != "HEAD" {
        let response = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // Strip query parameters and hash
    if let Some(pos) = raw_path.find('?') {
        raw_path = &raw_path[..pos];
    }
    if let Some(pos) = raw_path.find('#') {
        raw_path = &raw_path[..pos];
    }

    // Check health endpoint
    if raw_path == "/api/health" {
        let body = r#"{"status":"ok","app":"ShaderStudio","version":"0.1.0"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // Normalize path
    let mut clean_path = raw_path.trim_start_matches('/');
    if clean_path.is_empty() {
        clean_path = "index.html";
    }

    // Look for embedded asset
    let asset = EMBEDDED_ASSETS
        .iter()
        .find(|a| a.path == clean_path)
        .or_else(|| {
            // SPA fallback: return index.html for non-asset routes
            EMBEDDED_ASSETS.iter().find(|a| a.path == "index.html")
        });

    match asset {
        Some(a) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                a.mime,
                a.bytes.len()
            );
            if stream.write_all(header.as_bytes()).is_ok() && method == "GET" {
                let _ = stream.write_all(a.bytes);
            }
        }
        None => {
            let body = "404 Not Found — ShaderStudio asset bundle missing index.html";
            let response = format!(
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    }
}

fn print_banner(port: u16, asset_count: usize) {
    println!();
    println!("  ================================================================");
    println!("     ____ _               _              ____  _             _ _");
    println!("    / ___| |__   __ _  __| | ___ _ __  / ___|| |_ _   _  __| (_) ___");
    println!("    \\___ \\| '_ \\ / _` |/ _` |/ _ \\ '__| \\___ \\| __| | | |/ _` | |/ _ \\");
    println!("     ___) | | | | (_| | (_| |  __/ |     ___) | |_| |_| | (_| | | (_) |");
    println!("    |____/|_| |_|\\__,_|\\__,_|\\___|_|    |____/ \\__|\\__,_|\\__,_|_|\\___/");
    println!();
    println!("    High-Performance Visual Shader Compositor & AI Sandbox");
    println!("  ================================================================");
    println!("    Status:       Running");
    println!("    Local URL:    http://127.0.0.1:{}", port);
    println!("    Assets:       {} files embedded in executable", asset_count);
    println!("    Zero-Deps:    Standalone portable binary");
    println!("  ================================================================");
    println!("    Press Ctrl+C in this console window to exit.");
    println!();
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = 8650;
    let mut auto_open = true;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if i + 1 < args.len() {
                    if let Ok(p) = args[i + 1].parse::<u16>() {
                        port = p;
                    }
                    i += 1;
                }
            }
            "--no-open" | "--headless" => {
                auto_open = false;
            }
            "--help" | "-h" => {
                println!("ShaderStudio Desktop Executable");
                println!();
                println!("Usage: ShaderStudio.exe [OPTIONS]");
                println!();
                println!("Options:");
                println!("  -p, --port <PORT>    Local HTTP port to bind (default: 8650)");
                println!("      --no-open        Do not automatically open the default browser");
                println!("      --headless       Run server in headless mode (same as --no-open)");
                println!("  -h, --help           Show this help message");
                return;
            }
            _ => {}
        }
        i += 1;
    }

    // Bind the requested port; if it is in use, try the next ones.
    let first_port = port;
    let listener = match bind_from(first_port) {
        Some((l, p)) => {
            if p != first_port {
                eprintln!("Port {} is already in use; using port {} instead.", first_port, p);
            }
            port = p;
            l
        }
        None => {
            eprintln!(
                "Could not bind any port in {}-{} (all in use). Close the other program or pick one with --port <PORT>.",
                first_port,
                first_port.saturating_add(PORT_TRIES - 1)
            );
            std::process::exit(1);
        }
    };

    let url = format!("http://127.0.0.1:{}", port);
    print_banner(port, EMBEDDED_ASSETS.len());

    if auto_open {
        let launch_url = url.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            open_browser(&launch_url);
        });
    }

    // Ctrl+C: the OS default handler terminates the process; the server is stateless, so no cleanup is needed.
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                thread::spawn(move || {
                    handle_connection(s);
                });
            }
            Err(e) => {
                eprintln!("Connection failed: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_from_skips_ports_in_use() {
        let (held, p) = bind_from(38650).expect("bind");
        let (_next, p2) = bind_from(p).expect("fallback");
        assert!(p2 > p, "expected a later port, got {p2} vs {p}");
        drop(held);
    }
}
