//! WGSL -> GLSL / HLSL cross-compilation through naga (front::wgsl + back::glsl / back::hlsl).

use naga::back::{glsl, hlsl};
use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::ShaderStage;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum WgslTranspileResult {
    Ok { code: String },
    Err {
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        line: Option<u32>,
    },
}

fn err(message: impl Into<String>, line: Option<u32>) -> WgslTranspileResult {
    WgslTranspileResult::Err { error: message.into(), line }
}

/// Transpiles WGSL `source`.
///
/// `target`: `"glsl"` (GLSL ES 3.00), `"glsl330"` (desktop GLSL 3.30 core) or `"hlsl"` (SM 5.1).
/// `stage` (GLSL only): `"vertex"`, `"fragment"` (default) or `"compute"`; if the module has no
/// entry point for that stage and `stage` was not given, the first entry point is used.
pub fn transpile_wgsl(source: &str, target: &str, stage: Option<&str>) -> WgslTranspileResult {
    let module = match naga::front::wgsl::parse_str(source) {
        Ok(m) => m,
        Err(e) => {
            let line = e.location(source).map(|l| l.line_number);
            return err(e.message().to_string(), line);
        }
    };

    let info = match Validator::new(ValidationFlags::all(), Capabilities::all()).validate(&module) {
        Ok(i) => i,
        Err(e) => {
            let line = e.location(source).map(|l| l.line_number);
            return err(e.as_inner().to_string(), line);
        }
    };

    match target {
        "hlsl" => {
            let options = hlsl::Options::default();
            let mut out = String::new();
            match hlsl::Writer::new(&mut out, &options).write(&module, &info, None) {
                Ok(_) => WgslTranspileResult::Ok { code: out },
                Err(e) => err(format!("HLSL backend: {e}"), None),
            }
        }
        "glsl" | "glsl330" => {
            let wanted = match stage {
                Some("vertex") => Some(ShaderStage::Vertex),
                Some("compute") => Some(ShaderStage::Compute),
                Some("fragment") | None => Some(ShaderStage::Fragment),
                Some(other) => return err(format!("Unknown stage: {other}"), None),
            };
            let entry = module
                .entry_points
                .iter()
                .find(|ep| Some(ep.stage) == wanted)
                .or_else(|| if stage.is_none() { module.entry_points.first() } else { None });
            let Some(entry) = entry else {
                return err(format!("No {} entry point found in WGSL module", stage.unwrap_or("fragment")), None);
            };

            let options = glsl::Options {
                version: if target == "glsl330" {
                    glsl::Version::Desktop(330)
                } else {
                    glsl::Version::Embedded { version: 300, is_webgl: false }
                },
                ..Default::default()
            };
            let pipeline = glsl::PipelineOptions {
                shader_stage: entry.stage,
                entry_point: entry.name.clone(),
                multiview: None,
            };
            let mut out = String::new();
            let result = glsl::Writer::new(
                &mut out,
                &module,
                &info,
                &options,
                &pipeline,
                naga::proc::BoundsCheckPolicies::default(),
            )
            .and_then(|mut w| w.write());
            match result {
                Ok(_) => WgslTranspileResult::Ok { code: out },
                Err(e) => err(format!("GLSL backend: {e}"), None),
            }
        }
        other => err(format!("Unsupported WGSL target: {other} (expected glsl | glsl330 | hlsl)"), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WGSL: &str = r#"
struct U { tint: vec4f, time: f32 };
@group(0) @binding(0) var<uniform> u: U;
@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return u.tint * sin(u.time + uv.x);
}
"#;

    #[test]
    fn glsl_es300_and_desktop() {
        match transpile_wgsl(WGSL, "glsl", None) {
            WgslTranspileResult::Ok { code } => {
                assert!(code.starts_with("#version 300 es"), "{code}");
                assert!(code.contains("void main()"));
            }
            e => panic!("{e:?}"),
        }
        match transpile_wgsl(WGSL, "glsl330", Some("fragment")) {
            WgslTranspileResult::Ok { code } => assert!(code.starts_with("#version 330 core"), "{code}"),
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn hlsl_output() {
        match transpile_wgsl(WGSL, "hlsl", None) {
            WgslTranspileResult::Ok { code } => assert!(code.contains("fs_main"), "{code}"),
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn parse_error_reports_line() {
        let src = "@fragment\nfn fs_main() -> @location(0) vec4f {\n    return vec4f(1.0, 2.0;\n}\n";
        match transpile_wgsl(src, "glsl", None) {
            WgslTranspileResult::Err { error, line } => {
                assert!(!error.is_empty());
                assert_eq!(line, Some(3));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn bad_target_and_missing_stage() {
        assert!(matches!(transpile_wgsl(WGSL, "msl", None), WgslTranspileResult::Err { .. }));
        assert!(matches!(transpile_wgsl(WGSL, "glsl", Some("vertex")), WgslTranspileResult::Err { .. }));
    }
}
