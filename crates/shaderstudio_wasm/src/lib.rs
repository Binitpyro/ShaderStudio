pub mod baker;
pub mod mesh;
pub mod transpiler;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn bake_pbr_wasm(pixels: &[u8], config_val: JsValue) -> Result<JsValue, JsValue> {
    let config: baker::BakeConfig = serde_wasm_bindgen::from_value(config_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid BakeConfig: {}", e)))?;

    let output = baker::bake_pbr_full(pixels, &config)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn reflect_uniforms_wasm(source: &str, lang: &str) -> Result<JsValue, JsValue> {
    let uniforms = transpiler::reflection::reflect_uniforms(source, lang);
    serde_wasm_bindgen::to_value(&uniforms)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn transpile_shader_wasm(request_val: JsValue) -> Result<String, JsValue> {
    let request: transpiler::TranspileRequest = serde_wasm_bindgen::from_value(request_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid TranspileRequest: {}", e)))?;

    transpiler::transpile(&request)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn normalize_obj_wasm(obj_text: &str, name: &str) -> Result<JsValue, JsValue> {
    let output = mesh::obj_parser::parse_and_normalize_obj(obj_text, name)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn normalize_geometry_wasm(
    positions: &[f32],
    normals: Option<Vec<f32>>,
    uvs: Option<Vec<f32>>,
    name: &str,
) -> Result<JsValue, JsValue> {
    let output = mesh::normalize_geometry(positions.to_vec(), normals, uvs, name)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_baker_pixel_buffers_and_zip() {
        let width = 8;
        let height = 8;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                pixels[idx] = ((x as f32 / (width - 1) as f32) * 255.0) as u8;
                pixels[idx + 1] = ((y as f32 / (height - 1) as f32) * 255.0) as u8;
                pixels[idx + 2] = 180;
                pixels[idx + 3] = 255;
            }
        }

        let config = baker::BakeConfig {
            width,
            height,
            normal_strength: 2.0,
            invert_normal_y: false,
            ao_strength: 1.0,
            metallic_mode: "auto".to_string(),
        };

        let output = baker::bake_pbr_full(&pixels, &config).expect("Baking failed");
        assert_eq!(output.width, 8);
        assert_eq!(output.height, 8);
        assert!(!output.albedo_png.is_empty());
        assert!(!output.normal_png.is_empty());
        assert!(!output.roughness_png.is_empty());
        assert!(!output.height_png.is_empty());
        assert!(!output.metallic_png.is_empty());
        assert!(!output.ao_png.is_empty());
        assert!(!output.zip_archive.is_empty());

        // Check standard PKZIP magic bytes: 0x50, 0x4B, 0x03, 0x04
        assert_eq!(output.zip_archive[0], 0x50);
        assert_eq!(output.zip_archive[1], 0x4b);
        assert_eq!(output.zip_archive[2], 0x03);
        assert_eq!(output.zip_archive[3], 0x04);
    }

    #[test]
    fn test_baker_sobel_y_flip() {
        let width = 6;
        let height = 6;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                let val = if y < height / 2 { 0 } else { 255 };
                pixels[idx] = val;
                pixels[idx + 1] = val;
                pixels[idx + 2] = val;
                pixels[idx + 3] = 255;
            }
        }

        let config_opengl = baker::BakeConfig {
            width,
            height,
            normal_strength: 2.0,
            invert_normal_y: false,
            ao_strength: 1.0,
            metallic_mode: "dielectric".to_string(),
        };

        let config_directx = baker::BakeConfig {
            width,
            height,
            normal_strength: 2.0,
            invert_normal_y: true,
            ao_strength: 1.0,
            metallic_mode: "dielectric".to_string(),
        };

        let raw_ogl = baker::generate_pixel_buffers(&pixels, &config_opengl).unwrap();
        let raw_dx = baker::generate_pixel_buffers(&pixels, &config_directx).unwrap();

        // Examine normal y channel at transition (y=3, x=3)
        let idx = ((3 * width + 3) * 4) as usize;
        let y_ogl = raw_ogl.normal[idx + 1] as i32;
        let y_dx = raw_dx.normal[idx + 1] as i32;

        assert_ne!(y_ogl, y_dx);
        let dev_ogl = y_ogl - 128;
        let dev_dx = y_dx - 128;
        assert!((dev_ogl + dev_dx).abs() <= 2);
    }

    #[test]
    fn test_baker_metallic_modes() {
        let width = 4;
        let height = 4;
        let pixels = vec![128u8; (width * height * 4) as usize];

        let mut config = baker::BakeConfig {
            width,
            height,
            normal_strength: 2.0,
            invert_normal_y: false,
            ao_strength: 1.0,
            metallic_mode: "dielectric".to_string(),
        };

        let dielectric = baker::generate_pixel_buffers(&pixels, &config).unwrap();
        assert!(dielectric.metallic.iter().step_by(4).all(|&b| b == 0));

        config.metallic_mode = "metal".to_string();
        let metal = baker::generate_pixel_buffers(&pixels, &config).unwrap();
        assert!(metal.metallic.iter().step_by(4).all(|&b| b == 255));
    }

    #[test]
    fn test_naga_uniform_reflection_wgsl() {
        let wgsl = r#"
struct CameraData {
    viewMatrix: mat4x4f,
    projMatrix: mat4x4f,
    cameraPos: vec3f,
    fov: f32,
};

@group(0) @binding(1)
var<uniform> u_albedo: vec4f;

@fragment
fn fs_main() -> @location(0) vec4f {
    return u_albedo;
}
"#;

        let uniforms = transpiler::reflection::reflect_uniforms(wgsl, "wgsl");
        assert!(uniforms.len() >= 4);

        let names: Vec<&str> = uniforms.iter().map(|u| u.name.as_str()).collect();
        assert!(names.contains(&"viewMatrix"));
        assert!(names.contains(&"projMatrix"));
        assert!(names.contains(&"cameraPos"));
        assert!(names.contains(&"fov"));
        assert!(names.contains(&"u_albedo"));

        let view_mat = uniforms.iter().find(|u| u.name == "viewMatrix").unwrap();
        assert_eq!(view_mat.type_name, "mat4x4f");
        assert_eq!(view_mat.kind, "matrix");

        let cam_pos = uniforms.iter().find(|u| u.name == "cameraPos").unwrap();
        assert_eq!(cam_pos.type_name, "vec3f");
        assert_eq!(cam_pos.kind, "vector");

        let fov = uniforms.iter().find(|u| u.name == "fov").unwrap();
        assert_eq!(fov.type_name, "f32");
        assert_eq!(fov.kind, "scalar");
    }

    #[test]
    fn test_transpiler_all_targets() {
        let shader_source = r#"
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color.rgb * sin(u_time * u_intensity);
    fragColor = vec4(col, 1.0);
}
"#;

        let req_unity = transpiler::TranspileRequest {
            shader_source: shader_source.to_string(),
            shader_name: Some("ShaderStudio/PBRStandard".to_string()),
            target: "unity".to_string(),
            source_lang: "glsl".to_string(),
        };
        let hlsl = transpiler::transpile(&req_unity).unwrap();
        assert!(hlsl.contains("Shader \"ShaderStudio/PBRStandard\""));
        assert!(hlsl.contains("\"RenderPipeline\" = \"UniversalPipeline\""));
        assert!(hlsl.contains("TransformObjectToHClip"));
        assert!(hlsl.contains("SV_Target"));

        let req_godot = transpiler::TranspileRequest {
            shader_source: shader_source.to_string(),
            shader_name: None,
            target: "godot".to_string(),
            source_lang: "glsl".to_string(),
        };
        let godot = transpiler::transpile(&req_godot).unwrap();
        assert!(godot.contains("shader_type spatial;"));
        assert!(godot.contains("TIME"));
        assert!(godot.contains("VIEWPORT_SIZE"));
        assert!(godot.contains("ALBEDO = fragColor.rgb;"));

        let req_shadertoy = transpiler::TranspileRequest {
            shader_source: shader_source.to_string(),
            shader_name: None,
            target: "shadertoy".to_string(),
            source_lang: "glsl".to_string(),
        };
        let shadertoy = transpiler::transpile(&req_shadertoy).unwrap();
        assert!(shadertoy.contains("void mainImage( out vec4 fragColor, in vec2 fragCoord )"));
        assert!(shadertoy.contains("iTime"));
        assert!(shadertoy.contains("iResolution.xy"));
    }

    #[test]
    fn test_mesh_normalizer_centering_and_scaling() {
        let obj_text = r#"
v -1000.0 -1000.0 0.0
v 1000.0 -1000.0 0.0
v 0.0 1000.0 0.0
f 1 2 3
"#;

        let output = mesh::obj_parser::parse_and_normalize_obj(obj_text, "triangle.obj").unwrap();
        assert_eq!(output.name, "triangle.obj");
        assert_eq!(output.positions.len(), 9);
        assert_eq!(output.normals.len(), 9);
        assert_eq!(output.uvs.len(), 6);
        assert_eq!(output.vertex_count, 3);
        assert_eq!(output.triangle_count, 1);

        // Verify centering
        let mut min_x = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        let mut max_r = 0.0f32;

        for i in (0..output.positions.len()).step_by(3) {
            let x = output.positions[i];
            let y = output.positions[i + 1];
            let z = output.positions[i + 2];
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            let r = (x * x + y * y + z * z).sqrt();
            max_r = max_r.max(r);
        }

        let center_x = (min_x + max_x) * 0.5;
        let center_y = (min_y + max_y) * 0.5;
        assert!(center_x.abs() < 0.01);
        assert!(center_y.abs() < 0.01);

        // Normalized bounding radius must be close to 1.2
        assert!((max_r - 1.2).abs() < 0.05);

        // Check normal unit length
        for i in (0..output.normals.len()).step_by(3) {
            let nx = output.normals[i];
            let ny = output.normals[i + 1];
            let nz = output.normals[i + 2];
            let len = (nx * nx + ny * ny + nz * nz).sqrt();
            assert!((len - 1.0).abs() < 0.01);
        }
    }
}
