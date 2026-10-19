pub mod maps;
pub mod packager;
pub mod png_encoder;
pub mod sobel;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BakeConfig {
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_normal_strength")]
    pub normal_strength: f32,
    #[serde(default)]
    pub invert_normal_y: bool,
    #[serde(default = "default_ao_strength")]
    pub ao_strength: f32,
    #[serde(default = "default_metallic_mode")]
    pub metallic_mode: String,
}

fn default_normal_strength() -> f32 {
    2.0
}
fn default_ao_strength() -> f32 {
    1.0
}
fn default_metallic_mode() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawPixelBuffers {
    pub albedo: Vec<u8>,
    pub normal: Vec<u8>,
    pub roughness: Vec<u8>,
    pub height_map: Vec<u8>,
    pub metallic: Vec<u8>,
    pub ao: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PbrBakeOutput {
    pub albedo_png: Vec<u8>,
    pub normal_png: Vec<u8>,
    pub roughness_png: Vec<u8>,
    pub height_png: Vec<u8>,
    pub metallic_png: Vec<u8>,
    pub ao_png: Vec<u8>,
    pub zip_archive: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Computes raw pixel buffers for all 6 PBR maps.
pub fn generate_pixel_buffers(pixels: &[u8], config: &BakeConfig) -> Result<RawPixelBuffers, String> {
    let width = config.width;
    let height = config.height;
    let total_pixels = (width * height) as usize;

    if pixels.len() != total_pixels * 4 {
        return Err(format!(
            "Pixel slice length {} does not match dimensions {}x{}x4",
            pixels.len(),
            width,
            height
        ));
    }

    // 1. Compute Heights / Luminance buffer (ITU-R BT.601)
    let mut heights = Vec::with_capacity(total_pixels);
    for i in 0..total_pixels {
        let r = pixels[i * 4];
        let g = pixels[i * 4 + 1];
        let b = pixels[i * 4 + 2];
        heights.push(maps::perceptual_luminance(r, g, b));
    }

    // 2. Allocate output buffers
    let albedo = pixels.to_vec();
    let mut height_map = vec![0u8; total_pixels * 4];
    let mut normal = vec![0u8; total_pixels * 4];
    let mut roughness = vec![0u8; total_pixels * 4];
    let mut metallic = vec![0u8; total_pixels * 4];
    let mut ao = vec![0u8; total_pixels * 4];

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let h_center = heights[(y * width + x) as usize];
            let h_byte = (h_center * 255.0).round().clamp(0.0, 255.0) as u8;

            // Height Map
            height_map[idx] = h_byte;
            height_map[idx + 1] = h_byte;
            height_map[idx + 2] = h_byte;
            height_map[idx + 3] = 255;

            // Normal Map (Sobel filter)
            let (nx, ny, nz) = sobel::compute_sobel_normal(
                &heights,
                width,
                height,
                x,
                y,
                config.normal_strength,
                config.invert_normal_y,
            );
            normal[idx] = ((nx * 0.5 + 0.5) * 255.0).round().clamp(0.0, 255.0) as u8;
            normal[idx + 1] = ((ny * 0.5 + 0.5) * 255.0).round().clamp(0.0, 255.0) as u8;
            normal[idx + 2] = ((nz * 0.5 + 0.5) * 255.0).round().clamp(0.0, 255.0) as u8;
            normal[idx + 3] = 255;

            // Roughness Map
            let rough_val = maps::compute_roughness(h_center, nx, ny);
            roughness[idx] = rough_val;
            roughness[idx + 1] = rough_val;
            roughness[idx + 2] = rough_val;
            roughness[idx + 3] = 255;

            // Metallic Map
            let r_val = pixels[idx];
            let g_val = pixels[idx + 1];
            let b_val = pixels[idx + 2];
            let metal_val = maps::compute_metallic(r_val, g_val, b_val, h_center, &config.metallic_mode);
            metallic[idx] = metal_val;
            metallic[idx + 1] = metal_val;
            metallic[idx + 2] = metal_val;
            metallic[idx + 3] = 255;

            // Cavity AO Map
            let ao_val = maps::compute_cavity_ao(
                &heights,
                width,
                height,
                x,
                y,
                h_center,
                config.ao_strength,
            );
            ao[idx] = ao_val;
            ao[idx + 1] = ao_val;
            ao[idx + 2] = ao_val;
            ao[idx + 3] = 255;
        }
    }

    Ok(RawPixelBuffers {
        albedo,
        normal,
        roughness,
        height_map,
        metallic,
        ao,
        width,
        height,
    })
}

/// Orchestrates full PBR baking: computes raw buffers, encodes PNGs, and bundles in-memory ZIP.
pub fn bake_pbr_full(pixels: &[u8], config: &BakeConfig) -> Result<PbrBakeOutput, String> {
    let raw = generate_pixel_buffers(pixels, config)?;

    let albedo_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.albedo)?;
    let normal_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.normal)?;
    let roughness_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.roughness)?;
    let height_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.height_map)?;
    let metallic_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.metallic)?;
    let ao_png = png_encoder::encode_png_rgba(raw.width, raw.height, &raw.ao)?;

    let manifest = serde_json::json!({
        "generator": "Shader Studio PBR Baker (Rust Wasm Engine)",
        "resolution": format!("{}x{}", raw.width, raw.height),
        "maps": {
            "albedo": "albedo.png",
            "normal": "normal.png",
            "roughness": "roughness.png",
            "height": "height.png",
            "metallic": "metallic.png",
            "ao": "ao.png"
        },
        "instructions": {
            "blender": "Plug Albedo into Base Color, Normal into Normal Map node, Roughness into Roughness, Height into Displacement.",
            "unrealEngine": "Connect Albedo to Base Color, Normal to Normal, Roughness to Roughness, Metallic to Metallic, AO to Ambient Occlusion.",
            "unity": "Use Standard/Lit shader. Assign Albedo, Metallic/Smoothness, and Normal Map."
        }
    });

    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    let files = [
        ("material_manifest.json", manifest_bytes.as_slice()),
        ("albedo.png", albedo_png.as_slice()),
        ("normal.png", normal_png.as_slice()),
        ("roughness.png", roughness_png.as_slice()),
        ("height.png", height_png.as_slice()),
        ("metallic.png", metallic_png.as_slice()),
        ("ao.png", ao_png.as_slice()),
    ];

    let zip_archive = packager::create_zip_archive(&files)?;

    Ok(PbrBakeOutput {
        albedo_png,
        normal_png,
        roughness_png,
        height_png,
        metallic_png,
        ao_png,
        zip_archive,
        width: raw.width,
        height: raw.height,
    })
}
