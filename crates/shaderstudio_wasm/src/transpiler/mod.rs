pub mod godot;
pub mod naga_export;
pub mod reflection;
pub mod shadertoy;
pub mod unity_hlsl;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranspileRequest {
    pub shader_source: String,
    pub shader_name: Option<String>,
    pub target: String,      // "unity" | "unity_hlsl" | "godot" | "shadertoy"
    #[serde(default = "default_source_lang")]
    pub source_lang: String, // "wgsl" | "glsl"
}

fn default_source_lang() -> String {
    "wgsl".to_string()
}

pub fn transpile(request: &TranspileRequest) -> Result<String, String> {
    let name = request
        .shader_name
        .clone()
        .unwrap_or_else(|| "ShaderStudio/CustomEffect".to_string());

    let uniforms = reflection::reflect_uniforms(&request.shader_source, &request.source_lang);

    match request.target.as_str() {
        "unity" | "unity_hlsl" => {
            Ok(unity_hlsl::transpile_to_unity_hlsl(&name, &request.shader_source, &uniforms))
        }
        "godot" => {
            Ok(godot::transpile_to_godot(&request.shader_source, &uniforms))
        }
        "shadertoy" => {
            Ok(shadertoy::transpile_to_shadertoy(&request.shader_source))
        }
        other => Err(format!("Unsupported transpilation target: {}", other)),
    }
}
