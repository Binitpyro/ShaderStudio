use shaderstudio_wasm::baker::{self, maps, BakeConfig};
use shaderstudio_wasm::transpiler::{self, reflection, TranspileRequest};
use shaderstudio_wasm::mesh::obj_parser;
use std::io::Read;

#[test]
fn test_sobel_non_square_dimensions_and_boundary_clamping() {
    // Test 1x1 image (extreme boundary)
    let config_1x1 = BakeConfig {
        width: 1,
        height: 1,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto".to_string(),
    };
    let pixels_1x1 = vec![128, 128, 128, 255];
    let raw_1x1 = baker::generate_pixel_buffers(&pixels_1x1, &config_1x1).expect("1x1 bake failed");
    assert_eq!(raw_1x1.width, 1);
    assert_eq!(raw_1x1.height, 1);
    // On 1x1, gradients are 0, normal should point straight out (0, 0, 1) -> RGBA (128, 128, 255, 255)
    assert_eq!(raw_1x1.normal[0], 128);
    assert_eq!(raw_1x1.normal[1], 128);
    assert_eq!(raw_1x1.normal[2], 255);
    assert_eq!(raw_1x1.normal[3], 255);

    // Test highly non-square: 16x2
    let width = 16;
    let height = 2;
    let mut pixels_wide = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            pixels_wide[idx] = (x * 16) as u8;
            pixels_wide[idx + 1] = (y * 128) as u8;
            pixels_wide[idx + 2] = 50;
            pixels_wide[idx + 3] = 255;
        }
    }
    let config_wide = BakeConfig {
        width,
        height,
        normal_strength: 1.5,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto".to_string(),
    };
    let raw_wide = baker::generate_pixel_buffers(&pixels_wide, &config_wide).expect("16x2 bake failed");
    assert_eq!(raw_wide.normal.len(), (width * height * 4) as usize);

    // Test highly non-square: 3x17 (odd dimensions)
    let width_odd = 3;
    let height_odd = 17;
    let mut pixels_odd = vec![200u8; (width_odd * height_odd * 4) as usize];
    for i in (0..pixels_odd.len()).step_by(4) {
        pixels_odd[i + 3] = 255;
    }
    let config_odd = BakeConfig {
        width: width_odd,
        height: height_odd,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "dielectric".to_string(),
    };
    let raw_odd = baker::generate_pixel_buffers(&pixels_odd, &config_odd).expect("3x17 bake failed");
    assert_eq!(raw_odd.normal.len(), (width_odd * height_odd * 4) as usize);
}

#[test]
fn test_directx_vs_opengl_y_flip_mathematical_symmetry() {
    let width = 8;
    let height = 8;
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            pixels[idx] = (y * 32) as u8; // Vertical gradient along Y
            pixels[idx + 1] = (y * 32) as u8;
            pixels[idx + 2] = (y * 32) as u8;
            pixels[idx + 3] = 255;
        }
    }

    let config_ogl = BakeConfig {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto".to_string(),
    };
    let config_dx = BakeConfig {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: true,
        ao_strength: 1.0,
        metallic_mode: "auto".to_string(),
    };

    let raw_ogl = baker::generate_pixel_buffers(&pixels, &config_ogl).unwrap();
    let raw_dx = baker::generate_pixel_buffers(&pixels, &config_dx).unwrap();

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;

            // X (Red) channel must be strictly identical
            assert_eq!(raw_ogl.normal[idx], raw_dx.normal[idx], "X channel mismatch at ({}, {})", x, y);

            // Z (Blue) channel must be strictly identical
            assert_eq!(raw_ogl.normal[idx + 2], raw_dx.normal[idx + 2], "Z channel mismatch at ({}, {})", x, y);

            // Alpha channel must be 255
            assert_eq!(raw_ogl.normal[idx + 3], 255);
            assert_eq!(raw_dx.normal[idx + 3], 255);

            // Y (Green) channel must invert across 128
            let g_ogl = raw_ogl.normal[idx + 1] as i32;
            let g_dx = raw_dx.normal[idx + 1] as i32;
            let sum = g_ogl + g_dx;
            // Mathematical expectation: round((ny * 0.5 + 0.5) * 255) + round((-ny * 0.5 + 0.5) * 255) = 255 (within +-1 rounding)
            assert!(
                (sum - 255).abs() <= 1,
                "Y flip symmetry violation at ({}, {}): ogl={}, dx={}, sum={}",
                x, y, g_ogl, g_dx, sum
            );
        }
    }
}

#[test]
fn test_roughness_metallic_and_cavity_ao_math() {
    // 1. Roughness: test luminance inversion + normal deviation
    let rough_flat_dark = maps::compute_roughness(0.0, 0.0, 0.0);
    // (1.0 - 0.0) * 200 + 0 = 200
    assert_eq!(rough_flat_dark, 200);

    let rough_flat_bright = maps::compute_roughness(1.0, 0.0, 0.0);
    // (1.0 - 1.0) * 200 + 0 = 0
    assert_eq!(rough_flat_bright, 0);

    let rough_bumpy = maps::compute_roughness(0.5, 0.5, 0.5);
    // (1.0 - 0.5) * 200 + (0.5 + 0.5) * 55 = 100 + 55 = 155
    assert_eq!(rough_bumpy, 155);

    // 2. Metallic modes
    assert_eq!(maps::compute_metallic(100, 100, 100, 0.5, "metal"), 255);
    assert_eq!(maps::compute_metallic(100, 100, 100, 0.5, "dielectric"), 0);

    // Auto mode: saturation > 50 -> 255
    assert_eq!(maps::compute_metallic(100, 40, 40, 0.2, "auto"), 255); // sat = 60
    assert_eq!(maps::compute_metallic(50, 40, 40, 0.2, "auto"), 0);    // sat = 10

    // Auto mode: specular highlight (h_center > 0.85 and sat > 20)
    assert_eq!(maps::compute_metallic(255, 230, 230, 0.90, "auto"), 255); // sat = 25, h > 0.85 -> 255
    assert_eq!(maps::compute_metallic(255, 230, 230, 0.80, "auto"), 0);   // sat = 25, h <= 0.85 -> 0

    // 3. Cavity AO
    let heights_flat = vec![0.5f32; 9];
    let ao_flat = maps::compute_cavity_ao(&heights_flat, 3, 3, 1, 1, 0.5, 1.0);
    assert_eq!(ao_flat, 255); // No cavity darkening on flat surface

    // Center is depressed (h_center = 0.1, neighbors = 0.9)
    let mut heights_cavity = vec![0.9f32; 9];
    heights_cavity[4] = 0.1;
    let ao_dark = maps::compute_cavity_ao(&heights_cavity, 3, 3, 1, 1, 0.1, 1.0);
    // cavity = 0.9 - 0.1 = 0.8; ao_val = 255 - 0.8 * 400 * 1.0 = 255 - 320 = -65 -> clamped to 0
    assert_eq!(ao_dark, 0);
}

#[test]
fn test_png_and_zip_decoding_parity() {
    let width = 4;
    let height = 4;
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    for i in (0..pixels.len()).step_by(4) {
        pixels[i] = 180;
        pixels[i + 1] = 120;
        pixels[i + 2] = 60;
        pixels[i + 3] = 255;
    }

    let config = BakeConfig {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto".to_string(),
    };

    let raw = baker::generate_pixel_buffers(&pixels, &config).unwrap();
    let full = baker::bake_pbr_full(&pixels, &config).unwrap();

    // Verify PNG decoding matches raw buffer
    let decoder = png::Decoder::new(&full.albedo_png[..]);
    let mut reader = decoder.read_info().expect("PNG decode failed");
    let mut decoded = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut decoded).expect("Frame decode failed");
    assert_eq!(info.width, width);
    assert_eq!(info.height, height);
    assert_eq!(&decoded[..info.buffer_size()], &raw.albedo[..]);

    // Verify ZIP archive contents
    let cursor = std::io::Cursor::new(&full.zip_archive);
    let mut zip = zip::ZipArchive::new(cursor).expect("ZIP archive invalid");
    let file_names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
    assert!(file_names.contains(&"albedo.png".to_string()));
    assert!(file_names.contains(&"normal.png".to_string()));
    assert!(file_names.contains(&"roughness.png".to_string()));
    assert!(file_names.contains(&"height.png".to_string()));
    assert!(file_names.contains(&"metallic.png".to_string()));
    assert!(file_names.contains(&"ao.png".to_string()));
    assert!(file_names.contains(&"material_manifest.json".to_string()));

    // Verify manifest JSON is valid
    let mut manifest_file = zip.by_name("material_manifest.json").unwrap();
    let mut manifest_str = String::new();
    manifest_file.read_to_string(&mut manifest_str).unwrap();
    assert!(manifest_str.contains("Shader Studio PBR Baker (Rust Wasm Engine)"));
    assert!(manifest_str.contains("4x4"));
}

#[test]
fn test_naga_reflection_nested_structs_and_arrays() {
    let wgsl_complex = r#"
struct LightInfo {
    position: vec3f,
    intensity: f32,
    color: vec4f,
};

struct SceneData {
    viewProj: mat4x4f,
    light: LightInfo,
    exposure: f32,
    ambient: vec3f,
};

@group(0) @binding(0)
var<uniform> u_scene: SceneData;

@group(0) @binding(1)
var u_diffuseMap: texture_2d<f32>;

@group(0) @binding(2)
var u_sampler: sampler;

@fragment
fn fs_main() -> @location(0) vec4f {
    return u_scene.light.color;
}
"#;

    let uniforms = reflection::reflect_uniforms(wgsl_complex, "wgsl");
    assert!(!uniforms.is_empty());

    let names: Vec<&str> = uniforms.iter().map(|u| u.name.as_str()).collect();

    // Must reflect outer struct members
    assert!(names.contains(&"viewProj"), "Missing viewProj");
    assert!(names.contains(&"exposure"), "Missing exposure");
    assert!(names.contains(&"ambient"), "Missing ambient");

    // Must reflect nested LightInfo members
    assert!(names.contains(&"position"), "Missing nested position");
    assert!(names.contains(&"intensity"), "Missing nested intensity");
    assert!(names.contains(&"color"), "Missing nested color");

    // Verify types
    let vp = uniforms.iter().find(|u| u.name == "viewProj").unwrap();
    assert_eq!(vp.type_name, "mat4x4f");
    assert_eq!(vp.kind, "matrix");

    let col = uniforms.iter().find(|u| u.name == "color").unwrap();
    assert_eq!(col.type_name, "vec4f");
    assert_eq!(col.kind, "color");
}

#[test]
fn test_transpile_targets_parity_standard() {
    let shader = r#"
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_tint.rgb * sin(u_time);
    fragColor = vec4(col, 1.0);
}
"#;

    // 1. Unity URP HLSL
    let req_unity = TranspileRequest {
        shader_source: shader.to_string(),
        shader_name: Some("Adversarial/TestShader".to_string()),
        target: "unity".to_string(),
        source_lang: "glsl".to_string(),
    };
    let unity = transpiler::transpile(&req_unity).expect("Unity transpile failed");
    assert!(unity.contains("Shader \"Adversarial/TestShader\""));
    assert!(unity.contains("UniversalPipeline"));
    assert!(unity.contains("TransformObjectToHClip"));
    assert!(unity.contains("_ScreenParams.xy"));
    assert!(unity.contains("_Time.y"));

    // 2. Godot 4 Spatial
    let req_godot = TranspileRequest {
        shader_source: shader.to_string(),
        shader_name: None,
        target: "godot".to_string(),
        source_lang: "glsl".to_string(),
    };
    let godot = transpiler::transpile(&req_godot).expect("Godot transpile failed");
    assert!(godot.contains("shader_type spatial;"));
    assert!(godot.contains("VIEWPORT_SIZE"));
    assert!(godot.contains("TIME"));
    assert!(godot.contains("ALBEDO = fragColor.rgb;"));

    // 3. Shadertoy GLSL ES 3.0
    let req_shadertoy = TranspileRequest {
        shader_source: shader.to_string(),
        shader_name: None,
        target: "shadertoy".to_string(),
        source_lang: "glsl".to_string(),
    };
    let shadertoy = transpiler::transpile(&req_shadertoy).expect("Shadertoy transpile failed");
    assert!(shadertoy.contains("void mainImage( out vec4 fragColor, in vec2 fragCoord )"));
    assert!(shadertoy.contains("iTime"));
    assert!(shadertoy.contains("iResolution.xy"));
    assert!(shadertoy.contains("fragCoord.xy"));
}

#[test]
fn test_transpile_targets_parity_and_keyword_isolation() {
    // Verify that variable names containing keyword substrings (e.g. `custom_u_resolution`)
    // are strictly isolated via word boundaries (\b) and not corrupted into `custom__ScreenParams.xy`.
    let shader = r#"
void main() {
    vec2 custom_u_resolution = vec2(1.0);
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
}
"#;

    let req_unity = TranspileRequest {
        shader_source: shader.to_string(),
        shader_name: None,
        target: "unity".to_string(),
        source_lang: "glsl".to_string(),
    };
    let unity = transpiler::transpile(&req_unity).expect("Unity transpile failed");
    // Verify identifier containing keyword substring is preserved
    assert!(unity.contains("custom_u_resolution"), "custom_u_resolution was corrupted by naive replacement");
    assert!(!unity.contains("custom__ScreenParams.xy"), "Keyword was improperly replaced within another identifier");
    assert!(unity.contains("_ScreenParams.xy"), "True u_resolution.xy was not mapped to _ScreenParams.xy");
}

#[test]
fn test_mesh_obj_parser_corner_cases() {
    // OBJ with negative indices, comments, extra whitespace, quad polygon
    let tricky_obj = r#"
# Tricky Wavefront OBJ
v -1.0 -1.0 0.0
v  1.0 -1.0 0.0
v  1.0  1.0 0.0
v -1.0  1.0 0.0

# Quad face using negative relative indices
f -4 -3 -2 -1
"#;

    let mesh = obj_parser::parse_and_normalize_obj(tricky_obj, "quad.obj").expect("OBJ parse failed");
    assert_eq!(mesh.name, "quad.obj");
    // Quad face is triangulated into 2 triangles = 6 vertices = 18 position floats
    assert_eq!(mesh.triangle_count, 2);
    assert_eq!(mesh.vertex_count, 6);
    assert_eq!(mesh.positions.len(), 18);
    assert_eq!(mesh.normals.len(), 18);

    // Check normal synthesis: for quad in XY plane, normal should be (0, 0, 1) or (0, 0, -1)
    for i in (0..mesh.normals.len()).step_by(3) {
        assert_eq!(mesh.normals[i].abs().round(), 0.0);
        assert_eq!(mesh.normals[i + 2].abs().round(), 1.0);
    }
}

#[test]
fn test_naga_glsl_error_inspection() {
    let glsl = r#"#version 450
layout(std140, binding = 0) uniform CameraBlock {
    mat4 u_view;
    mat4 u_proj;
    vec3 u_eye;
    float u_near;
};
layout(binding = 1) uniform sampler2D u_tex;
void main() {
}
"#;
    let mut frontend = naga::front::glsl::Frontend::default();
    let options = naga::front::glsl::Options::from(naga::ShaderStage::Fragment);
    match frontend.parse(&options, glsl) {
        Ok(m) => {
            println!("Naga GLSL parse OK, globals: {}", m.global_variables.len());
            for (_, var) in m.global_variables.iter() {
                println!("  var: {:?}, ty: {:?}", var.name, m.types[var.ty].name);
            }
        }
        Err(e) => {
            println!("Naga GLSL parse ERROR: {:?}", e);
        }
    }

    let uniforms = reflection::reflect_uniforms(glsl, "glsl");
    println!("Reflected uniforms: {}", uniforms.len());
    for u in &uniforms {
        println!("  uniform: {}, type: {}, kind: {}", u.name, u.type_name, u.kind);
    }
}
