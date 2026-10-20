use shaderstudio_wasm::mesh::normal_synth::synthesize_smooth_normals;
use shaderstudio_wasm::mesh::normalizer::normalize_positions;
use shaderstudio_wasm::mesh::obj_parser::parse_and_normalize_obj;
use shaderstudio_wasm::mesh::normalize_geometry;
use std::time::Instant;

#[test]
fn test_100k_vertex_obj_stress_and_performance() {
    let triangle_count = 34_000; // 34,000 * 3 = 102,000 vertices
    let mut obj_text = String::with_capacity(triangle_count * 120);

    for i in 0..triangle_count {
        let x = (i % 100) as f32 * 0.5;
        let y = (i / 100) as f32 * 0.5;
        let z = ((i as f32) * 0.1).sin() * 5.0;

        obj_text.push_str(&format!("v {} {} {}\n", x, y, z));
        obj_text.push_str(&format!("v {} {} {}\n", x + 0.2, y, z));
        obj_text.push_str(&format!("v {} {} {}\n", x, y + 0.2, z + 0.1));
    }

    for i in 0..triangle_count {
        let v1 = i * 3 + 1;
        let v2 = i * 3 + 2;
        let v3 = i * 3 + 3;
        obj_text.push_str(&format!("f {} {} {}\n", v1, v2, v3));
    }

    assert!(obj_text.len() > 2_000_000); // Over 2MB text

    let start = Instant::now();
    let result = parse_and_normalize_obj(&obj_text, "stress_100k.obj").expect("100K OBJ parsing failed");
    let elapsed = start.elapsed();

    // Verify correct vertex count (102,000)
    assert_eq!(result.vertex_count, 102_000);
    assert_eq!(result.triangle_count, 34_000);
    assert_eq!(result.positions.len(), 102_000 * 3);
    assert_eq!(result.normals.len(), 102_000 * 3);
    assert_eq!(result.uvs.len(), 102_000 * 2);

    // Performance assertion: 100K+ vertices must process in well under 500ms
    println!("100K+ vertex OBJ processing took: {:?}", elapsed);
    // Timing is only meaningful with optimizations: the debug profile is ~10-30x slower and
    // varies with machine load, so the tight 500ms bound is enforced on release builds only.
    // Debug builds still guard against pathological (quadratic) behaviour with a loose bound.
    let limit_ms = if cfg!(debug_assertions) { 15_000 } else { 500 };
    assert!(elapsed.as_millis() < limit_ms, "100K OBJ processing exceeded {limit_ms}ms");

    // Centering verification
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    let mut max_r = 0.0f32;

    for i in (0..result.positions.len()).step_by(3) {
        let x = result.positions[i];
        let y = result.positions[i + 1];
        let z = result.positions[i + 2];

        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);

        let dist = (x * x + y * y + z * z).sqrt();
        max_r = max_r.max(dist);
    }

    assert!(((min_x + max_x) * 0.5).abs() < 1e-3, "Mesh not centered on X");
    assert!(((min_y + max_y) * 0.5).abs() < 1e-3, "Mesh not centered on Y");
    assert!((max_r - 1.2).abs() < 0.02, "Bounding radius not normalized to ~1.2");

    // All synthesized normals must be valid unit vectors
    for i in (0..result.normals.len()).step_by(3) {
        let nx = result.normals[i];
        let ny = result.normals[i + 1];
        let nz = result.normals[i + 2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        assert!((len - 1.0).abs() < 1e-4, "Normal at index {} not unit length: {}", i, len);
    }
}

#[test]
fn test_raw_vertex_buffer_100k_stress() {
    let vertex_count = 150_000; // 150,000 raw vertices (50,000 triangles)
    let mut positions = Vec::with_capacity(vertex_count * 3);

    for i in 0..vertex_count {
        let fi = i as f32;
        positions.push(fi * 0.01 + 500.0);
        positions.push((fi * 0.05).cos() * 200.0 - 300.0);
        positions.push((fi * 0.02).sin() * 100.0 + 1000.0);
    }

    let start = Instant::now();
    let mesh = normalize_geometry(positions, None, None, "raw_150k").expect("Raw normalization failed");
    let elapsed = start.elapsed();

    println!("150K raw vertex buffer normalization took: {:?}", elapsed);
    assert_eq!(mesh.vertex_count, 150_000);
    assert_eq!(mesh.triangle_count, 50_000);
    assert_eq!(mesh.normals.len(), 150_000 * 3);
    assert_eq!(mesh.uvs.len(), 150_000 * 2);

    // Same rationale as the OBJ test above: tight bound on release, loose sanity bound in debug.
    let limit_ms = if cfg!(debug_assertions) { 10_000 } else { 250 };
    assert!(elapsed.as_millis() < limit_ms, "Raw geometry processing exceeded {limit_ms}ms");

    // Check unit normals
    for i in (0..mesh.normals.len()).step_by(3) {
        let nx = mesh.normals[i];
        let ny = mesh.normals[i + 1];
        let nz = mesh.normals[i + 2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        assert!((len - 1.0).abs() < 1e-4, "Raw normal not unit length");
    }
}

#[test]
fn test_normal_orthogonality_and_winding_accuracy() {
    // 1. Counter-clockwise triangle in XY plane
    let ccw_tri = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
    ];
    let n_ccw = synthesize_smooth_normals(&ccw_tri);
    assert_eq!(n_ccw.len(), 9);
    for v in 0..3 {
        let idx = v * 3;
        assert!((n_ccw[idx] - 0.0).abs() < 1e-6);
        assert!((n_ccw[idx + 1] - 0.0).abs() < 1e-6);
        assert!((n_ccw[idx + 2] - 1.0).abs() < 1e-6, "CCW normal must point +Z");
    }

    // 2. Clockwise triangle in XY plane (inverted winding)
    let cw_tri = vec![
        0.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        1.0, 0.0, 0.0,
    ];
    let n_cw = synthesize_smooth_normals(&cw_tri);
    for v in 0..3 {
        let idx = v * 3;
        assert!((n_cw[idx] - 0.0).abs() < 1e-6);
        assert!((n_cw[idx + 1] - 0.0).abs() < 1e-6);
        assert!((n_cw[idx + 2] - (-1.0)).abs() < 1e-6, "CW normal must point -Z");
    }

    // 3. Arbitrary rotated 3D triangle: verify normal is perpendicular to both edges
    let p0 = [1.2, 3.4, -2.1];
    let p1 = [-4.5, 0.8, 1.9];
    let p2 = [0.3, -2.7, 5.0];
    let tri3d = vec![
        p0[0], p0[1], p0[2],
        p1[0], p1[1], p1[2],
        p2[0], p2[1], p2[2],
    ];
    let n3d = synthesize_smooth_normals(&tri3d);
    let normal = [n3d[0], n3d[1], n3d[2]];

    let edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

    let dot1 = normal[0] * edge1[0] + normal[1] * edge1[1] + normal[2] * edge1[2];
    let dot2 = normal[0] * edge2[0] + normal[1] * edge2[1] + normal[2] * edge2[2];

    assert!(dot1.abs() < 1e-5, "Normal not orthogonal to edge 1: dot={}", dot1);
    assert!(dot2.abs() < 1e-5, "Normal not orthogonal to edge 2: dot={}", dot2);
}

#[test]
fn test_degenerate_triangles_and_fallback_safety() {
    // 1. Zero-area triangle (all points identical)
    let zero_area = vec![
        5.0, 5.0, 5.0,
        5.0, 5.0, 5.0,
        5.0, 5.0, 5.0,
    ];
    let n_zero = synthesize_smooth_normals(&zero_area);
    assert_eq!(n_zero.len(), 9);
    for v in 0..3 {
        let idx = v * 3;
        assert_eq!(n_zero[idx], 0.0);
        assert_eq!(n_zero[idx + 1], 1.0); // Safe up-vector fallback
        assert_eq!(n_zero[idx + 2], 0.0);
    }

    // 2. Collinear triangle (edges are parallel)
    let collinear = vec![
        0.0, 0.0, 0.0,
        1.0, 1.0, 1.0,
        2.0, 2.0, 2.0,
    ];
    let n_collinear = synthesize_smooth_normals(&collinear);
    for v in 0..3 {
        let idx = v * 3;
        assert!(!n_collinear[idx].is_nan());
        assert!(!n_collinear[idx + 1].is_nan());
        assert!(!n_collinear[idx + 2].is_nan());
        assert_eq!(n_collinear[idx + 1], 1.0);
    }
}

#[test]
fn test_extreme_bounding_scales_and_offsets() {
    // 1. Asymmetric huge offset
    let mut offset_geom = vec![
        10_000.0, 20_000.0, 30_000.0,
        10_002.0, 20_000.0, 30_000.0,
        10_000.0, 20_004.0, 30_000.0,
    ];
    normalize_positions(&mut offset_geom);

    let min_x = offset_geom[0].min(offset_geom[3]).min(offset_geom[6]);
    let max_x = offset_geom[0].max(offset_geom[3]).max(offset_geom[6]);
    let center_x = (min_x + max_x) * 0.5;
    assert!(center_x.abs() < 1e-4, "Extreme offset not centered on X");

    let mut max_r = 0.0f32;
    for i in (0..offset_geom.len()).step_by(3) {
        let r = (offset_geom[i].powi(2) + offset_geom[i + 1].powi(2) + offset_geom[i + 2].powi(2)).sqrt();
        max_r = max_r.max(r);
    }
    assert!((max_r - 1.2).abs() < 1e-4, "Scale not normalized to 1.2");

    // 2. Microscopic scale (1e-5)
    let mut micro_geom = vec![
        -1e-5, -1e-5, 0.0,
        1e-5, -1e-5, 0.0,
        0.0, 1e-5, 0.0,
    ];
    normalize_positions(&mut micro_geom);
    let mut max_r_micro = 0.0f32;
    for i in (0..micro_geom.len()).step_by(3) {
        let r = (micro_geom[i].powi(2) + micro_geom[i + 1].powi(2) + micro_geom[i + 2].powi(2)).sqrt();
        max_r_micro = max_r_micro.max(r);
    }
    assert!((max_r_micro - 1.2).abs() < 1e-4, "Microscopic mesh not scaled to 1.2");

    // 3. Astronomical scale (1e6)
    let mut astro_geom = vec![
        -1e6, -1e6, 0.0,
        1e6, -1e6, 0.0,
        0.0, 1e6, 0.0,
    ];
    normalize_positions(&mut astro_geom);
    let mut max_r_astro = 0.0f32;
    for i in (0..astro_geom.len()).step_by(3) {
        let r = (astro_geom[i].powi(2) + astro_geom[i + 1].powi(2) + astro_geom[i + 2].powi(2)).sqrt();
        max_r_astro = max_r_astro.max(r);
    }
    assert!((max_r_astro - 1.2).abs() < 1e-4, "Astronomical mesh not scaled to 1.2");
}

#[test]
fn test_polygon_fan_triangulation_and_indexing_robustness() {
    // Quad (f 1 2 3 4) and Hexagon (f 1 2 3 4 5 6)
    let poly_obj = r#"
# Test quad and hexagon
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 1.0 1.0 0.0
v 0.0 1.0 0.0
f 1 2 3 4

# Hexagon
v 2.0 0.0 0.0
v 3.0 0.0 0.0
v 3.5 1.0 0.0
v 3.0 2.0 0.0
v 2.0 2.0 0.0
v 1.5 1.0 0.0
f 5 6 7 8 9 10
"#;

    let res = parse_and_normalize_obj(poly_obj, "polygons.obj").unwrap();
    // Quad produces 2 triangles (6 vertices)
    // Hexagon produces 4 triangles (12 vertices)
    // Total = 18 vertices, 6 triangles
    assert_eq!(res.triangle_count, 6);
    assert_eq!(res.vertex_count, 18);
    assert_eq!(res.positions.len(), 18 * 3);
    assert_eq!(res.normals.len(), 18 * 3);
    assert_eq!(res.uvs.len(), 18 * 2);

    // Negative indexing test
    let neg_idx_obj = r#"
v -1.0 -1.0 0.0
v 1.0 -1.0 0.0
v 0.0 1.0 0.0
f -3 -2 -1
"#;
    let res_neg = parse_and_normalize_obj(neg_idx_obj, "neg.obj").unwrap();
    assert_eq!(res_neg.vertex_count, 3);
    assert_eq!(res_neg.triangle_count, 1);
}

#[test]
fn test_malformed_obj_and_error_handling() {
    // Empty OBJ
    assert!(parse_and_normalize_obj("", "empty.obj").is_err());
    // Only comments
    assert!(parse_and_normalize_obj("# Just a comment\n# Another", "comments.obj").is_err());
    // Positions not multiple of 3
    assert!(normalize_geometry(vec![1.0, 2.0], None, None, "bad").is_err());
    // Empty positions
    assert!(normalize_geometry(vec![], None, None, "empty").is_err());
}
