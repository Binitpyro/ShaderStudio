use super::normal_synth::synthesize_smooth_normals;
use super::normalizer::normalize_positions;
use super::MeshOutput;

/// Fast, low-allocation Wavefront OBJ parser and normalizer.
pub fn parse_and_normalize_obj(obj_text: &str, name: &str) -> Result<MeshOutput, String> {
    let mut raw_positions: Vec<[f32; 3]> = Vec::new();
    let mut raw_normals: Vec<[f32; 3]> = Vec::new();
    let mut raw_uvs: Vec<[f32; 2]> = Vec::new();

    let mut out_positions: Vec<f32> = Vec::new();
    let mut out_normals: Vec<f32> = Vec::new();
    let mut out_uvs: Vec<f32> = Vec::new();

    let mut has_explicit_normals = false;

    for line in obj_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let cmd = match parts.next() {
            Some(c) => c,
            None => continue,
        };

        match cmd {
            "v" => {
                let x = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                let y = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                let z = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                raw_positions.push([x, y, z]);
            }
            "vn" => {
                let x = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                let y = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                let z = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                raw_normals.push([x, y, z]);
            }
            "vt" => {
                let u = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                let v = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
                raw_uvs.push([u, v]);
            }
            "f" => {
                let mut face_indices: Vec<(i32, Option<i32>, Option<i32>)> = Vec::with_capacity(4);
                for token in parts {
                    let mut subtokens = token.split('/');
                    let v_idx = subtokens.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
                    let vt_idx = subtokens.next().and_then(|s| if s.is_empty() { None } else { s.parse::<i32>().ok() });
                    let vn_idx = subtokens.next().and_then(|s| if s.is_empty() { None } else { s.parse::<i32>().ok() });
                    face_indices.push((v_idx, vt_idx, vn_idx));
                }

                if face_indices.len() < 3 {
                    continue;
                }

                // Fan triangulation
                for i in 1..(face_indices.len() - 1) {
                    let tri = [face_indices[0], face_indices[i], face_indices[i + 1]];
                    for &(v_idx, vt_idx, vn_idx) in &tri {
                        // Resolve 1-based or negative position index
                        let p_idx = if v_idx > 0 {
                            (v_idx - 1) as usize
                        } else if v_idx < 0 {
                            (raw_positions.len() as i32 + v_idx) as usize
                        } else {
                            0
                        };

                        if let Some(p) = raw_positions.get(p_idx) {
                            out_positions.extend_from_slice(p);
                        } else {
                            out_positions.extend_from_slice(&[0.0, 0.0, 0.0]);
                        }

                        // Resolve normal
                        if let Some(vn) = vn_idx {
                            let n_idx = if vn > 0 {
                                (vn - 1) as usize
                            } else if vn < 0 {
                                (raw_normals.len() as i32 + vn) as usize
                            } else {
                                0
                            };
                            if let Some(n) = raw_normals.get(n_idx) {
                                out_normals.extend_from_slice(n);
                                has_explicit_normals = true;
                            } else {
                                out_normals.extend_from_slice(&[0.0, 1.0, 0.0]);
                            }
                        }

                        // Resolve UV
                        if let Some(vt) = vt_idx {
                            let uv_idx = if vt > 0 {
                                (vt - 1) as usize
                            } else if vt < 0 {
                                (raw_uvs.len() as i32 + vt) as usize
                            } else {
                                0
                            };
                            if let Some(uv) = raw_uvs.get(uv_idx) {
                                out_uvs.extend_from_slice(uv);
                            } else {
                                out_uvs.extend_from_slice(&[0.0, 0.0]);
                            }
                        } else {
                            out_uvs.extend_from_slice(&[0.0, 0.0]);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if out_positions.is_empty() {
        return Err("No vertices found in OBJ file".to_string());
    }

    // Synthesize normals if absent
    if !has_explicit_normals || out_normals.len() != out_positions.len() {
        out_normals = synthesize_smooth_normals(&out_positions);
    }

    // Center and scale to target radius ~1.2
    normalize_positions(&mut out_positions);

    let vertex_count = (out_positions.len() / 3) as u32;
    let triangle_count = vertex_count / 3;

    Ok(MeshOutput {
        name: name.to_string(),
        positions: out_positions,
        normals: out_normals,
        uvs: out_uvs,
        vertex_count,
        triangle_count,
    })
}
