//! PBR material map generation algorithms (Luminance/Height, Roughness, Metallic, Cavity AO).

/// Perceptual luminance formula according to ITU-R BT.601
#[inline]
pub fn perceptual_luminance(r: u8, g: u8, b: u8) -> f32 {
    (0.299 * (r as f32) + 0.587 * (g as f32) + 0.114 * (b as f32)) / 255.0
}

/// Computes roughness from inverted luminance and surface normal deviation
#[inline]
pub fn compute_roughness(h_center: f32, nx: f32, ny: f32) -> u8 {
    let normal_deviation = nx.abs() + ny.abs();
    let rough_val = (1.0 - h_center) * 200.0 + normal_deviation * 55.0;
    rough_val.round().clamp(0.0, 255.0) as u8
}

/// Metallic map rule: "metal" -> 255, "dielectric" -> 0, "auto" -> saturation/specular heuristic
pub fn compute_metallic(r: u8, g: u8, b: u8, h_center: f32, mode: &str) -> u8 {
    match mode {
        "metal" => 255,
        "dielectric" => 0,
        _ => {
            let max_val = r.max(g).max(b);
            let min_val = r.min(g).min(b);
            let sat = max_val.saturating_sub(min_val);
            if sat > 50 || (h_center > 0.85 && sat > 20) {
                255
            } else {
                0
            }
        }
    }
}

/// Cavity AO calculation based on neighborhood height curvature
pub fn compute_cavity_ao(
    heights: &[f32],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    h_center: f32,
    ao_strength: f32,
) -> u8 {
    let get_height = |px: i32, py: i32| -> f32 {
        let cx = px.clamp(0, (width as i32) - 1) as u32;
        let cy = py.clamp(0, (height as i32) - 1) as u32;
        heights[(cy * width + cx) as usize]
    };

    let ix = x as i32;
    let iy = y as i32;

    let tl = get_height(ix - 1, iy - 1);
    let t  = get_height(ix,     iy - 1);
    let tr = get_height(ix + 1, iy - 1);
    let l  = get_height(ix - 1, iy);
    let r  = get_height(ix + 1, iy);
    let bl = get_height(ix - 1, iy + 1);
    let b  = get_height(ix,     iy + 1);
    let br = get_height(ix + 1, iy + 1);

    let avg_neighbors = (tl + t + tr + l + r + bl + b + br) / 8.0;
    let cavity = (avg_neighbors - h_center).max(0.0);
    let ao_val = 255.0 - cavity * 400.0 * ao_strength;
    ao_val.round().clamp(0.0, 255.0) as u8
}
