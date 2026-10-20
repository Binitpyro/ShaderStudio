//! Synthesizes smooth vertex normals for un-indexed triangle positions.
//! Normalizes each vector to unit length ~1.0.

pub fn synthesize_smooth_normals(positions: &[f32]) -> Vec<f32> {
    let mut normals = vec![0.0f32; positions.len()];

    // Accumulate face normals onto each vertex
    for i in (0..positions.len()).step_by(9) {
        if i + 8 >= positions.len() {
            break;
        }

        let p0 = [positions[i], positions[i + 1], positions[i + 2]];
        let p1 = [positions[i + 3], positions[i + 4], positions[i + 5]];
        let p2 = [positions[i + 6], positions[i + 7], positions[i + 8]];

        let v10 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let v20 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

        // Cross product: v10 x v20
        let nx = v10[1] * v20[2] - v10[2] * v20[1];
        let ny = v10[2] * v20[0] - v10[0] * v20[2];
        let nz = v10[0] * v20[1] - v10[1] * v20[0];

        // Add to each vertex of the triangle
        for v in 0..3 {
            let offset = i + v * 3;
            normals[offset] += nx;
            normals[offset + 1] += ny;
            normals[offset + 2] += nz;
        }
    }

    // Normalize each normal to unit length
    for i in (0..normals.len()).step_by(3) {
        let nx = normals[i];
        let ny = normals[i + 1];
        let nz = normals[i + 2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();

        if len > 1e-6 {
            normals[i] = nx / len;
            normals[i + 1] = ny / len;
            normals[i + 2] = nz / len;
        } else {
            // Default up vector if degenerate face
            normals[i] = 0.0;
            normals[i + 1] = 1.0;
            normals[i + 2] = 0.0;
        }
    }

    normals
}
