/// Bounding box centering and target radius scaling (~1.2).

pub fn normalize_positions(positions: &mut [f32]) {
    if positions.is_empty() {
        return;
    }

    // 1. Compute AABB bounding box
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    let mut min_z = f32::INFINITY;
    let mut max_z = f32::NEG_INFINITY;

    for i in (0..positions.len()).step_by(3) {
        let x = positions[i];
        let y = positions[i + 1];
        let z = positions[i + 2];

        if x < min_x { min_x = x; }
        if x > max_x { max_x = x; }
        if y < min_y { min_y = y; }
        if y > max_y { max_y = y; }
        if z < min_z { min_z = z; }
        if z > max_z { max_z = z; }
    }

    let center_x = (min_x + max_x) * 0.5;
    let center_y = (min_y + max_y) * 0.5;
    let center_z = (min_z + max_z) * 0.5;

    // 2. Center around origin
    for i in (0..positions.len()).step_by(3) {
        positions[i] -= center_x;
        positions[i + 1] -= center_y;
        positions[i + 2] -= center_z;
    }

    // 3. Compute bounding sphere radius from centered coordinates
    let mut max_radius = 0.0f32;
    for i in (0..positions.len()).step_by(3) {
        let x = positions[i];
        let y = positions[i + 1];
        let z = positions[i + 2];
        let dist = (x * x + y * y + z * z).sqrt();
        if dist > max_radius {
            max_radius = dist;
        }
    }

    // 4. Scale to target radius ~1.2
    if max_radius > 1e-6 {
        let scale_factor = 1.2 / max_radius;
        for i in 0..positions.len() {
            positions[i] *= scale_factor;
        }
    }
}
