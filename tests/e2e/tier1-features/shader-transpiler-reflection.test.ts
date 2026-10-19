import { describe, it, expect } from "vitest"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
  type EngineExportOptions,
} from "@/core/engineTranspiler"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { computeUniformBufferLayout } from "@/core/uniformLayout"

describe("Tier 1: Feature Coverage — Naga Shader AST Reflection & Cross-Compiler", () => {
  const testShaderSource = `
struct MaterialUniforms {
    u_color: vec4f,
    u_intensity: f32,
    u_roughness: f32,
    u_offset: vec2f,
};

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color.rgb * sin(u_time * u_intensity);
    fragColor = vec4(col, 1.0);
}
`

  const complexOptions: EngineExportOptions = {
    shaderName: "ShaderStudio/PBRStandard",
    shaderSource: testShaderSource,
    parsedUniforms: [
      { name: "u_color", type: "vec4f", kind: "color" },
      { name: "u_intensity", type: "f32", kind: "scalar" },
      { name: "u_roughness", type: "f32", kind: "scalar" },
      { name: "u_offset", type: "vec2f", kind: "vector" },
      { name: "u_normalMap", type: "texture", kind: "texture" },
    ],
    uniformValues: {
      u_color: { type: "color", value: [0.8, 0.4, 0.2, 1.0] },
      u_intensity: { type: "float", value: 3.5 },
      u_roughness: { type: "float", value: 0.25 },
      u_offset: { type: "vec2", value: [0.5, 0.5] },
    },
  }

  it("transpiles shader to valid Unity Universal Render Pipeline (URP) ShaderLab / HLSL", () => {
    const hlsl = transpileToUnityHLSL(complexOptions)

    // 1. Shader Header & Tags
    expect(hlsl).toContain('Shader "ShaderStudio/PBRStandard"')
    expect(hlsl).toContain('"RenderPipeline" = "UniversalPipeline"')
    expect(hlsl).toContain('"LightMode" = "UniversalForward"')

    // 2. Properties Block
    expect(hlsl).toContain('_u_color ("u_color", Color) = (0.8, 0.4, 0.2, 1)')
    expect(hlsl).toContain('_u_intensity ("u_intensity", Float) = 3.5')
    expect(hlsl).toContain('_u_roughness ("u_roughness", Float) = 0.25')
    expect(hlsl).toContain('_u_offset ("u_offset", Vector) = (0.5, 0.5, 0.0, 0.0)')
    expect(hlsl).toContain('_u_normalMap ("u_normalMap", 2D) = "white" {}')

    // 3. CBUFFER Block (SRP Batcher compatibility)
    expect(hlsl).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(hlsl).toContain("float4 _u_color;")
    expect(hlsl).toContain("float _u_intensity;")
    expect(hlsl).toContain("float _u_roughness;")
    expect(hlsl).toContain("float2 _u_offset;")
    expect(hlsl).toContain("CBUFFER_END")

    // 4. HLSL Function Semantics & Vertex/Fragment Program
    expect(hlsl).toContain("TransformObjectToHClip")
    expect(hlsl).toContain("TransformObjectToWorldNormal")
    expect(hlsl).toContain("SV_Target")
    expect(hlsl).toContain("float4 frag(Varyings i) : SV_Target")

    // 5. Keyword Replacements
    expect(hlsl).toContain("i.positionCS.xy")
    expect(hlsl).toContain("_ScreenParams.xy")
    expect(hlsl).toContain("_Time.y")
  })

  it("transpiles shader to valid Godot 4 Spatial Shader (.gdshader)", () => {
    const gdshader = transpileToGodotShader(complexOptions)

    // 1. Godot Shader Type Declaration
    expect(gdshader).toContain("shader_type spatial;")

    // 2. Uniform Declarations with default hints
    expect(gdshader).toContain("uniform vec4 u_color : source_color = vec4(0.8, 0.4, 0.2, 1);")
    expect(gdshader).toContain("uniform float u_intensity = 3.5;")
    expect(gdshader).toContain("uniform float u_roughness = 0.25;")
    expect(gdshader).toContain("uniform vec2 u_offset = vec2(0.5, 0.5);")

    // 3. Builtin mappings & Fragment stage
    expect(gdshader).toContain("TIME")
    expect(gdshader).toContain("VIEWPORT_SIZE")
    expect(gdshader).toContain("ALBEDO = fragColor.rgb;")
    expect(gdshader).toContain("ALPHA = fragColor.a;")
  })

  it("transpiles shader to valid Shadertoy GLSL ES 3.0 format", () => {
    const shadertoy = transpileToShadertoy(complexOptions)

    // 1. Entry point format
    expect(shadertoy).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")

    // 2. Environment uniform replacement
    expect(shadertoy).toContain("iTime")
    expect(shadertoy).toContain("iResolution.xy")
    expect(shadertoy).toContain("fragCoord.xy")
  })

  it("reflects complex WGSL uniform structures and nested fields", () => {
    const wgslSource = `
struct CameraData {
    viewMatrix: mat4x4f,
    projMatrix: mat4x4f,
    cameraPos: vec3f,
    fov: f32,
};

@group(0) @binding(1)
var<uniform> u_albedo: vec4f;

@fragment
fn fs_main() -> @location(0) vec4f {
    return u_albedo;
}
`

    const uniforms = parseWgslUniforms(wgslSource)
    expect(uniforms.length).toBeGreaterThanOrEqual(4)

    const viewMatrix = uniforms.find((u) => u.name === "viewMatrix")
    expect(viewMatrix).toBeDefined()
    expect(viewMatrix?.type).toBe("mat4x4f")

    const cameraPos = uniforms.find((u) => u.name === "cameraPos")
    expect(cameraPos).toBeDefined()
    expect(cameraPos?.type).toBe("vec3f")

    const fov = uniforms.find((u) => u.name === "fov")
    expect(fov).toBeDefined()
    expect(fov?.type).toBe("f32")

    const albedo = uniforms.find((u) => u.name === "u_albedo")
    expect(albedo).toBeDefined()
    expect(albedo?.type).toBe("vec4f")
  })

  it("reflects GLSL uniform blocks and calculates std140 layout alignment", () => {
    const glslSource = `
#version 300 es
precision highp float;

layout(std140) uniform LightBlock {
    vec3 u_lightPos;
    float u_lightRadius;
    vec4 u_lightColor;
};

uniform float u_metallic;
uniform vec2 u_tiling;

out vec4 fragColor;

void main() {
    fragColor = u_lightColor * u_metallic;
}
`

    const uniforms = parseGlslUniforms(glslSource)
    const names = uniforms.map((u) => u.name)

    expect(names).toContain("u_lightPos")
    expect(names).toContain("u_lightRadius")
    expect(names).toContain("u_lightColor")
    expect(names).toContain("u_metallic")
    expect(names).toContain("u_tiling")

    // Verify std140 layout calculation
    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.totalSize).toBeGreaterThan(0)
    // std140 buffer sizes must be multiples of 16 bytes
    expect(layout.totalSize % 16).toBe(0)

    const lightPosField = layout.fields["u_lightPos"]
    expect(lightPosField).toBeDefined()
    expect(lightPosField?.size).toBe(12) // vec3 = 3 * 4 bytes
  })
})
