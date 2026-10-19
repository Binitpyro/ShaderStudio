use std::path::Path;

pub fn get_default_project_path() -> String {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    if let Some(h) = home {
        let p = Path::new(&h).join("Documents").join("ShaderStudio").join("untitled.shaderstudio");
        p.to_string_lossy().replace('\\', "/")
    } else {
        "./untitled.shaderstudio".to_string()
    }
}

#[tauri::command]
pub async fn save_project_native(path: Option<String>, project_json: String) -> Result<String, String> {
    let target_path = path.unwrap_or_else(get_default_project_path);
    
    if !target_path.ends_with(".shaderstudio") {
        return Err("File extension must be .shaderstudio".to_string());
    }

    if let Some(parent) = Path::new(&target_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    std::fs::write(&target_path, &project_json).map_err(|e| e.to_string())?;
    Ok(target_path)
}

#[tauri::command]
pub async fn load_project_native(path: Option<String>) -> Result<(String, String), String> {
    let target_path = match path {
        Some(p) if !p.is_empty() => p,
        _ => return Err("File not found: (empty path)".to_string()),
    };

    let path_obj = Path::new(&target_path);
    if !path_obj.exists() {
        return Err(format!("File not found: {}", target_path));
    }

    let content = std::fs::read_to_string(&target_path).map_err(|e| e.to_string())?;
    Ok((target_path, content))
}
