//! 3x3 Sobel tangent normal filter computation.
//! Matches the perceptual gradient calculation and DirectX / OpenGL Y-flip toggle.

pub fn compute_sobel_normal(
    heights: &[f32],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    normal_strength: f32,
    invert_normal_y: bool,
) -> (f32, f32, f32) {
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

    let dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    let mut dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
    if invert_normal_y {
        dy = -dy;
    }

    let dz = 1.0 / normal_strength.max(0.01);
    let len = (dx * dx + dy * dy + dz * dz).sqrt();

    let nx = -dx / len;
    let ny = -dy / len;
    let nz = dz / len;

    (nx, ny, nz)
}
