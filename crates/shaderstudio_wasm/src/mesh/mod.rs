pub mod normal_synth;
pub mod normalizer;
pub mod obj_parser;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshOutput {
    pub name: String,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub vertex_count: u32,
    pub triangle_count: u32,
}

/// Normalizes arbitrary raw vertex geometry (positions, optional normals, optional uvs).
pub fn normalize_geometry(
    mut positions: Vec<f32>,
    normals: Option<Vec<f32>>,
    uvs: Option<Vec<f32>>,
    name: &str,
) -> Result<MeshOutput, String> {
    if positions.is_empty() || !positions.len().is_multiple_of(3) {
        return Err("Positions must be non-empty and a multiple of 3 floats".to_string());
    }

    let vertex_count = (positions.len() / 3) as u32;
    let triangle_count = vertex_count / 3;

    // Normal synthesis if not provided or length mismatch
    let resolved_normals = match normals {
        Some(n) if n.len() == positions.len() => n,
        _ => normal_synth::synthesize_smooth_normals(&positions),
    };

    // UVs: fill with 0.0 if not provided or wrong length
    let resolved_uvs = match uvs {
        Some(u) if u.len() == (vertex_count * 2) as usize => u,
        _ => vec![0.0f32; (vertex_count * 2) as usize],
    };

    // Center and scale
    normalizer::normalize_positions(&mut positions);

    Ok(MeshOutput {
        name: name.to_string(),
        positions,
        normals: resolved_normals,
        uvs: resolved_uvs,
        vertex_count,
        triangle_count,
    })
}
