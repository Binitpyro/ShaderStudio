use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Extensions the native open/save commands will touch (exact, lowercase).
const ALLOWED_EXTENSIONS: [&str; 2] = [".shaderstudio", ".json"];
/// Inner extensions that make a name a double extension (`evil.exe.json`, `a.shaderstudio.json`).
const BLOCKED_INNER_EXTENSIONS: [&str; 16] = [
    "exe", "bat", "cmd", "com", "scr", "ps1", "msi", "dll", "vbs", "js", "lnk", "sh", "jar", "reg",
    "shaderstudio", "json",
];
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;

pub const EXTENSION_ERROR: &str = "File extension must be .shaderstudio or .json";

pub fn default_project_path_in(home: Option<&str>) -> String {
    match home {
        Some(h) => Path::new(h)
            .join("Documents")
            .join("ShaderStudio")
            .join("untitled.shaderstudio")
            .to_string_lossy()
            .replace('\\', "/"),
        None => "./untitled.shaderstudio".to_string(),
    }
}

pub fn get_default_project_path() -> String {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    default_project_path_in(home.as_deref())
}

/// Accepts only `<stem>.shaderstudio` / `<stem>.json`: exact lowercase suffix on the raw string
/// (so trailing spaces, slashes and `.bak`-style suffixes fail), a non-empty stem, and no
/// executable-looking or repeated inner extension.
pub fn validate_project_path(path: &str) -> Result<(), String> {
    let ext = ALLOWED_EXTENSIONS
        .iter()
        .find(|e| path.ends_with(**e))
        .ok_or_else(|| EXTENSION_ERROR.to_string())?;
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = &name[..name.len() - ext.len()];
    if stem.is_empty() {
        return Err(EXTENSION_ERROR.to_string());
    }
    if let Some((_, inner)) = stem.rsplit_once('.') {
        if BLOCKED_INNER_EXTENSIONS.contains(&inner.to_ascii_lowercase().as_str()) {
            return Err(format!("Double extension not allowed: {}", name));
        }
    }
    Ok(())
}

pub const NOT_PICKED_ERROR: &str = "Path was not chosen in a native file dialog this session";

/// Paths the user picked in a native dialog this session (canonical form). Save/load only touch these, so a
/// compromised webview cannot write or read arbitrary `*.json` files (package.json, ...) on its own.
#[derive(Default)]
pub struct PickedPaths(Mutex<HashSet<PathBuf>>);

/// Canonicalizes through the longest existing ancestor (resolving symlinks) and appends the not-yet-existing rest.
/// Callers have already rejected `..`, so the remainder is plain names.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        match std::fs::canonicalize(&cur) {
            Ok(base) => return Ok(rest.iter().rev().fold(base, |acc, c| acc.join(c))),
            Err(_) => {
                let name = cur.file_name().ok_or_else(|| format!("Invalid path: {}", path.display()))?.to_os_string();
                rest.push(name);
                cur = match cur.parent() {
                    Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
                    _ => std::env::current_dir().map_err(|e| e.to_string())?,
                };
            }
        }
    }
}

fn reject_parent_dirs(path: &str) -> Result<(), String> {
    if Path::new(path).components().any(|c| c == Component::ParentDir) {
        return Err("Path may not contain '..'".to_string());
    }
    Ok(())
}

impl PickedPaths {
    /// Remembers a path chosen in a native dialog (extension and `..` checked first).
    pub fn record(&self, path: &str) -> Result<(), String> {
        validate_project_path(path)?;
        reject_parent_dirs(path)?;
        let canon = canonicalize_lenient(Path::new(path))?;
        self.0.lock().map_err(|e| e.to_string())?.insert(canon);
        Ok(())
    }

    /// Ok only for a valid project path that was picked this session, or the app's own fixed default path.
    pub fn check(&self, path: &str) -> Result<(), String> {
        validate_project_path(path)?;
        reject_parent_dirs(path)?;
        if path == get_default_project_path() {
            return Ok(());
        }
        let canon = canonicalize_lenient(Path::new(path))?;
        if self.0.lock().map_err(|e| e.to_string())?.contains(&canon) {
            Ok(())
        } else {
            Err(NOT_PICKED_ERROR.to_string())
        }
    }
}

pub async fn save_project(picked: &PickedPaths, path: Option<String>, project_json: String) -> Result<String, String> {
    let target_path = path.unwrap_or_else(get_default_project_path);
    picked.check(&target_path)?;

    if let Some(parent) = Path::new(&target_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    std::fs::write(&target_path, &project_json).map_err(|e| e.to_string())?;
    Ok(target_path)
}

pub async fn load_project(picked: &PickedPaths, path: Option<String>) -> Result<(String, String), String> {
    let target_path = match path {
        Some(p) if !p.is_empty() => p,
        _ => return Err("File not found: (empty path)".to_string()),
    };
    picked.check(&target_path)?;

    let meta = std::fs::metadata(&target_path)
        .map_err(|_| format!("File not found: {}", target_path))?;
    if !meta.is_file() {
        return Err(format!("Not a file: {}", target_path));
    }
    if meta.len() > MAX_PROJECT_BYTES {
        return Err(format!("File too large (max {} MB): {}", MAX_PROJECT_BYTES >> 20, target_path));
    }

    let content = std::fs::read_to_string(&target_path).map_err(|e| e.to_string())?;
    Ok((target_path, content))
}

fn record_choice(picked: &PickedPaths, chosen: Option<FilePath>) -> Result<Option<String>, String> {
    let Some(fp) = chosen else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    picked.record(&path)?;
    Ok(Some(path))
}

/// Opens the native "open project" dialog and records the choice. `None` when cancelled.
#[tauri::command]
pub async fn pick_open_project_native(app: AppHandle, picked: State<'_, PickedPaths>) -> Result<Option<String>, String> {
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().add_filter("ShaderStudio Project", &["shaderstudio"]).blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    record_choice(&picked, chosen)
}

/// Opens the native "save project" dialog (optionally pre-filled from `default_path`) and records the choice.
#[tauri::command]
pub async fn pick_save_project_native(
    app: AppHandle,
    picked: State<'_, PickedPaths>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().add_filter("ShaderStudio Project", &["shaderstudio"]);
        if let Some(d) = default_path.as_deref().map(Path::new) {
            if let Some(dir) = d.parent().filter(|p| p.is_dir()) {
                dialog = dialog.set_directory(dir);
            }
            if let Some(name) = d.file_name() {
                dialog = dialog.set_file_name(name.to_string_lossy());
            }
        }
        dialog.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    record_choice(&picked, chosen)
}

#[tauri::command]
pub async fn save_project_native(
    picked: State<'_, PickedPaths>,
    path: Option<String>,
    project_json: String,
) -> Result<String, String> {
    save_project(&picked, path, project_json).await
}

#[tauri::command]
pub async fn load_project_native(picked: State<'_, PickedPaths>, path: Option<String>) -> Result<(String, String), String> {
    load_project(&picked, path).await
}
