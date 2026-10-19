use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedUniform {
    pub name: String,
    pub type_name: String, // "f32" | "vec2f" | "vec3f" | "vec4f" | "mat2x2f" | "mat3x3f" | "mat4x4f" | "texture"
    pub kind: String,      // "scalar" | "vector" | "matrix" | "color" | "texture"
    pub offset: u32,
    pub size: u32,
    pub array_length: Option<u32>,
    pub group: u32,
    pub binding: u32,
}

fn determine_kind(name: &str, type_name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("color") || lower.contains("tint") || lower.contains("albedo") {
        if type_name == "vec4f" || type_name == "vec3f" || type_name == "vec4" || type_name == "vec3" {
            return "color".to_string();
        }
    }
    if type_name == "texture" || type_name.starts_with("sampler") || type_name.starts_with("texture") {
        "texture".to_string()
    } else if type_name.starts_with("mat") {
        "matrix".to_string()
    } else if type_name.starts_with("vec") {
        "vector".to_string()
    } else {
        "scalar".to_string()
    }
}

fn normalize_type_name(ty_inner: &naga::TypeInner) -> (String, u32) {
    match ty_inner {
        naga::TypeInner::Scalar(scalar) => {
            let name = match scalar.kind {
                naga::ScalarKind::Float => "f32",
                naga::ScalarKind::Uint => "u32",
                naga::ScalarKind::Sint => "i32",
                naga::ScalarKind::Bool => "bool",
                _ => "f32",
            };
            (name.to_string(), 4)
        }
        naga::TypeInner::Vector { size, scalar: _ } => {
            let s = *size as u8;
            let name = format!("vec{}f", s);
            let size_bytes = (s as u32) * 4;
            (name, size_bytes)
        }
        naga::TypeInner::Matrix { columns, rows, scalar: _ } => {
            let c = *columns as u8;
            let r = *rows as u8;
            let name = format!("mat{}x{}f", c, r);
            // In WGSL / std140 uniform buffers, each matrix column is aligned to 16 bytes (vec4)
            let col_size = if r <= 2 { 8 } else { 16 };
            let size_bytes = (c as u32) * col_size;
            (name, size_bytes)
        }
        naga::TypeInner::Image { .. } | naga::TypeInner::Sampler { .. } => {
            ("texture".to_string(), 0)
        }
        naga::TypeInner::Array { base: _, size, stride } => {
            let count = match size {
                naga::ArraySize::Constant(c) => c.get(),
                _ => 1,
            };
            ("array".to_string(), count * stride)
        }
        _ => ("f32".to_string(), 4),
    }
}

/// Reflects uniforms using Naga AST parser.
pub fn reflect_uniforms(source: &str, lang: &str) -> Vec<ReflectedUniform> {
    let mut results: Vec<ReflectedUniform> = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    // 1. Try parsing with Naga
    let parsed_module: Option<naga::Module> = if lang.eq_ignore_ascii_case("wgsl") {
        naga::front::wgsl::parse_str(source).ok()
    } else {
        // Try GLSL fragment stage
        let mut frontend = naga::front::glsl::Frontend::default();
        let options = naga::front::glsl::Options::from(naga::ShaderStage::Fragment);
        frontend.parse(&options, source).ok()
    };

    if let Some(module) = parsed_module {
        // A. Inspect uniform global variables
        for (_handle, var) in module.global_variables.iter() {
            let (group, binding) = match var.binding {
                Some(ref b) => (b.group, b.binding),
                None => (0, 0),
            };

            let ty = &module.types[var.ty];
            match &ty.inner {
                naga::TypeInner::Struct { members, span: _ } => {
                    for member in members {
                        let member_name = member.name.clone().unwrap_or_else(|| "unnamed".to_string());
                        if !seen_names.insert(member_name.clone()) {
                            continue;
                        }
                        let member_ty = &module.types[member.ty];
                        let (type_name, size) = normalize_type_name(&member_ty.inner);
                        let kind = determine_kind(&member_name, &type_name);
                        results.push(ReflectedUniform {
                            name: member_name,
                            type_name,
                            kind,
                            offset: member.offset,
                            size,
                            array_length: None,
                            group,
                            binding,
                        });
                    }
                }
                _ => {
                    if var.space == naga::AddressSpace::Uniform {
                        let name = var.name.clone().unwrap_or_else(|| "unnamed".to_string());
                        if seen_names.insert(name.clone()) {
                            let (type_name, size) = normalize_type_name(&ty.inner);
                            let kind = determine_kind(&name, &type_name);
                            results.push(ReflectedUniform {
                                name,
                                type_name,
                                kind,
                                offset: 0,
                                size,
                                array_length: None,
                                group,
                                binding,
                            });
                        }
                    }
                }
            }
        }

        // B. Also inspect any struct defined in module.types (for standalone uniform struct definitions)
        for (_handle, ty) in module.types.iter() {
            if let naga::TypeInner::Struct { members, span: _ } = &ty.inner {
                for member in members {
                    if let Some(ref member_name) = member.name {
                        if seen_names.insert(member_name.clone()) {
                            let member_ty = &module.types[member.ty];
                            let (type_name, size) = normalize_type_name(&member_ty.inner);
                            let kind = determine_kind(member_name, &type_name);
                            results.push(ReflectedUniform {
                                name: member_name.clone(),
                                type_name,
                                kind,
                                offset: member.offset,
                                size,
                                array_length: None,
                                group: 0,
                                binding: 0,
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback parser: if Naga returned fewer uniforms or failed (e.g. malformed or mixed snippet),
    // scan for struct fields and uniform declarations using robust token parsing.
    fallback_extract_uniforms(source, &mut results, &mut seen_names);

    results
}

fn fallback_extract_uniforms(
    source: &str,
    results: &mut Vec<ReflectedUniform>,
    seen_names: &mut std::collections::HashSet<String>,
) {
    let mut current_offset = 0u32;

    // Scan lines for struct fields: "field_name : type," or "type field_name;"
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.is_empty() {
            continue;
        }

        // WGSL struct field: `name: type,` or `name : type`
        if let Some(colon_pos) = trimmed.find(':') {
            let left = trimmed[..colon_pos].trim();
            let right = trimmed[colon_pos + 1..].trim().trim_end_matches([',', ';']).trim();

            if is_valid_ident(left) && is_valid_type(right) {
                if seen_names.insert(left.to_string()) {
                    let type_name = canonicalize_type(right);
                    let size = type_size(&type_name);
                    let kind = determine_kind(left, &type_name);
                    results.push(ReflectedUniform {
                        name: left.to_string(),
                        type_name,
                        kind,
                        offset: current_offset,
                        size,
                        array_length: None,
                        group: 0,
                        binding: 0,
                    });
                    current_offset += size;
                }
            }
        }
        // GLSL uniform: `uniform type name;`
        else if trimmed.starts_with("uniform ") {
            let rest = trimmed.strip_prefix("uniform ").unwrap().trim_end_matches(';').trim();
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 2 {
                let ty = parts[0];
                let name = parts[1];
                if is_valid_ident(name) {
                    if seen_names.insert(name.to_string()) {
                        let type_name = canonicalize_type(ty);
                        let size = type_size(&type_name);
                        let kind = determine_kind(name, &type_name);
                        results.push(ReflectedUniform {
                            name: name.to_string(),
                            type_name,
                            kind,
                            offset: current_offset,
                            size,
                            array_length: None,
                            group: 0,
                            binding: 0,
                        });
                        current_offset += size;
                    }
                }
            }
        }
    }
}

fn is_valid_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_alphanumeric() || c == '_')
}

fn is_valid_type(s: &str) -> bool {
    let base = s.split('<').next().unwrap_or(s).trim();
    matches!(
        base,
        "f32" | "i32" | "u32" | "bool" | "float" | "int" | "uint" |
        "vec2f" | "vec3f" | "vec4f" | "vec2" | "vec3" | "vec4" |
        "mat2x2f" | "mat3x3f" | "mat4x4f" | "mat2" | "mat3" | "mat4" |
        "texture" | "sampler" | "sampler2D"
    )
}

fn canonicalize_type(s: &str) -> String {
    match s {
        "float" => "f32".to_string(),
        "int" => "i32".to_string(),
        "uint" => "u32".to_string(),
        "vec2" => "vec2f".to_string(),
        "vec3" => "vec3f".to_string(),
        "vec4" => "vec4f".to_string(),
        "mat2" => "mat2x2f".to_string(),
        "mat3" => "mat3x3f".to_string(),
        "mat4" => "mat4x4f".to_string(),
        other => other.to_string(),
    }
}

fn type_size(ty: &str) -> u32 {
    match ty {
        "f32" | "i32" | "u32" | "bool" => 4,
        "vec2f" => 8,
        "vec3f" => 12,
        "vec4f" => 16,
        "mat2x2f" => 16,
        "mat3x3f" => 48,
        "mat4x4f" => 64,
        _ => 4,
    }
}
