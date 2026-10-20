//! Native project save/load behaviour. Every test writes only inside its own unique temp dir
//! (no shared or global state, so tests are safe to run in parallel) and never touches ~/Documents.

use shaderstudio_desktop_lib::commands::fs_dialog::{
    default_project_path_in, get_default_project_path, load_project, save_project, validate_project_path,
    PickedPaths, EXTENSION_ERROR, NOT_PICKED_ERROR,
};
use std::fs;
use std::path::PathBuf;

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("shaderstudio_test_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
    fn file(&self, rel: &str) -> String {
        self.0.join(rel).to_string_lossy().replace('\\', "/")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Save as if the user had picked `path` in the native dialog (paths with a bad extension are not recordable).
async fn save_project_native(path: Option<String>, json: String) -> Result<String, String> {
    let picked = PickedPaths::default();
    if let Some(p) = &path {
        let _ = picked.record(p);
    }
    save_project(&picked, path, json).await
}

/// Load as if the user had picked `path` in the native dialog.
async fn load_project_native(path: Option<String>) -> Result<(String, String), String> {
    let picked = PickedPaths::default();
    if let Some(p) = &path {
        let _ = picked.record(p);
    }
    load_project(&picked, path).await
}

#[tokio::test]
async fn unpicked_path_is_rejected_even_with_a_valid_extension() {
    let dir = TempDir::new("unpicked");
    let victim = dir.file("package.json");
    fs::write(&victim, "{\"name\":\"precious\"}").unwrap();
    let picked = PickedPaths::default();

    let err = save_project(&picked, Some(victim.clone()), "{\"pwned\":true}".into()).await.unwrap_err();
    assert_eq!(err, NOT_PICKED_ERROR);
    assert_eq!(fs::read_to_string(&victim).unwrap(), "{\"name\":\"precious\"}", "file must be untouched");
    assert_eq!(load_project(&picked, Some(victim)).await.unwrap_err(), NOT_PICKED_ERROR);

    // Picking one file does not unlock its neighbours.
    let chosen = dir.file("mine.shaderstudio");
    picked.record(&chosen).unwrap();
    assert!(save_project(&picked, Some(dir.file("other.shaderstudio")), "{}".into()).await.is_err());
}

#[tokio::test]
async fn picked_path_is_allowed_for_save_and_load() {
    let dir = TempDir::new("picked");
    let chosen = dir.file("nested/new/mine.shaderstudio"); // dialog-chosen files may not exist yet
    let picked = PickedPaths::default();
    picked.record(&chosen).unwrap();
    assert_eq!(save_project(&picked, Some(chosen.clone()), "{\"k\":2}".into()).await.unwrap(), chosen);
    assert_eq!(load_project(&picked, Some(chosen.clone())).await.unwrap(), (chosen, "{\"k\":2}".into()));
}

#[tokio::test]
async fn parent_dir_components_are_rejected_even_when_they_resolve_to_a_picked_file() {
    let dir = TempDir::new("dotdot");
    let chosen = dir.file("sub/mine.shaderstudio");
    fs::create_dir_all(dir.file("sub")).unwrap();
    let picked = PickedPaths::default();
    picked.record(&chosen).unwrap();

    let sneaky = dir.file("sub/../sub/mine.shaderstudio");
    assert!(sneaky.contains(".."));
    assert_eq!(save_project(&picked, Some(sneaky.clone()), "{}".into()).await.unwrap_err(), "Path may not contain '..'");
    assert_eq!(load_project(&picked, Some(sneaky.clone())).await.unwrap_err(), "Path may not contain '..'");
    assert!(picked.record(&sneaky).is_err());
    assert!(!std::path::Path::new(&chosen).exists(), "nothing may be written through a '..' path");
}

#[tokio::test]
async fn extension_whitelist_rejects_everything_else() {
    let dummy = "{}".to_string();
    for path in [
        "test.txt",
        "test.glsl",
        "test.wgsl",
        "test.shader",
        "test.shaderstudio.bak",
        "test.shaderstudio.tmp",
        "test.shaderstudio/",
        "test.shaderstudio\\",
        "test.shaderstudio ",
        "test.shaderstudio.exe",
        "test.json.exe",
        "test.shaderstudio.json",
        "evil.exe.json",
        "evil.bat.shaderstudio",
        "test",
        "test.",
        "shaderstudio",
        ".shaderstudio",
        ".json",
        ".shaderstudio.old",
        "test.SHADERSTUDIO",
        "test.ShaderStudio",
        "test.JSON",
        "",
        "   ",
    ] {
        let res = save_project_native(Some(path.to_string()), dummy.clone()).await;
        assert!(res.is_err(), "save should reject {path:?}, got {res:?}");
        let res = load_project_native(Some(path.to_string())).await;
        assert!(res.is_err(), "load should reject {path:?}, got {res:?}");
    }
    assert_eq!(validate_project_path("a.txt").unwrap_err(), EXTENSION_ERROR);
}

#[tokio::test]
async fn both_allowed_extensions_round_trip() {
    let dir = TempDir::new("both_ext");
    for name in ["a.shaderstudio", "b.json", "my.project.v2.shaderstudio", ".hidden.json"] {
        let path = dir.file(name);
        assert_eq!(save_project_native(Some(path.clone()), "{\"k\":1}".into()).await.unwrap(), path);
        assert_eq!(load_project_native(Some(path.clone())).await.unwrap(), (path, "{\"k\":1}".into()));
    }
}

#[tokio::test]
async fn empty_and_missing_paths() {
    assert_eq!(load_project_native(Some("".into())).await.unwrap_err(), "File not found: (empty path)");
    assert_eq!(load_project_native(None).await.unwrap_err(), "File not found: (empty path)");

    let dir = TempDir::new("missing");
    let fake = dir.file("does_not_exist.shaderstudio");
    let err = load_project_native(Some(fake.clone())).await.unwrap_err();
    assert!(err.starts_with("File not found:") && err.contains(&fake), "{err}");
}

#[tokio::test]
async fn default_path_resolution_is_pure_and_forward_slashed() {
    assert_eq!(
        default_project_path_in(Some("C:\\Users\\Alice")),
        "C:/Users/Alice/Documents/ShaderStudio/untitled.shaderstudio"
    );
    assert_eq!(default_project_path_in(None), "./untitled.shaderstudio");
    let real = get_default_project_path();
    assert!(real.ends_with(".shaderstudio") && !real.contains('\\'), "{real}");
    validate_project_path(&real).expect("default path must pass validation");
}

#[tokio::test]
async fn deep_unicode_round_trip_preserves_content() {
    let dir = TempDir::new("unicode");
    let file = dir.file("深層/level1/level2/unicode_project_\u{1F525}.shaderstudio");
    let project = serde_json::json!({
        "projectName": "\u{1F31F} Neo-Tokyo \u{1F31F}",
        "glslSource": "void main() {\n  // \u{e4}\u{f6}\u{fc}\n}\n",
        "metadata": { "whitespace": "\t \r\n", "values": [1.0, -0.00001, 1e8, "quote: \"hi\""] }
    })
    .to_string();

    assert_eq!(save_project_native(Some(file.clone()), project.clone()).await.unwrap(), file);
    let (loaded_path, content) = load_project_native(Some(file.clone())).await.unwrap();
    assert_eq!(loaded_path, file);
    assert_eq!(content, project);
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["projectName"], "\u{1F31F} Neo-Tokyo \u{1F31F}");
}

#[tokio::test]
async fn large_payload_round_trip() {
    let dir = TempDir::new("large");
    let file = dir.file("large.shaderstudio");
    let nodes: Vec<_> = (0..1000)
        .map(|i| serde_json::json!({ "id": format!("node_{i}"), "glsl": "vec4 f(vec2 uv){return vec4(uv,0.,1.);}" }))
        .collect();
    let big = serde_json::json!({ "nodes": nodes }).to_string();
    assert!(big.len() > 50_000);
    save_project_native(Some(file.clone()), big.clone()).await.unwrap();
    assert_eq!(load_project_native(Some(file)).await.unwrap().1.len(), big.len());
}

#[tokio::test]
async fn directory_targets_fail_cleanly() {
    let dir = TempDir::new("dir_target");
    let as_dir = dir.file("a_directory.shaderstudio");
    fs::create_dir_all(&as_dir).unwrap();
    assert!(save_project_native(Some(as_dir.clone()), "{}".into()).await.is_err());
    assert!(load_project_native(Some(as_dir)).await.is_err());
}

#[tokio::test]
async fn concurrent_save_load_is_isolated_per_file() {
    let dir = TempDir::new("concurrent");
    let mut handles = Vec::new();
    for i in 0..10 {
        let path = dir.file(&format!("thread_{i}.shaderstudio"));
        let content = format!("{{\"threadId\": {i}}}");
        handles.push(tokio::spawn(async move {
            save_project_native(Some(path.clone()), content.clone()).await.unwrap();
            assert_eq!(load_project_native(Some(path)).await.unwrap().1, content);
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
}
