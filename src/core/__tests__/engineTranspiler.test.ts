import { describe, it, expect } from "vitest"
import { transpileToUnityHLSL, transpileToGodotShader, transpileToShadertoy, type EngineExportOptions } from "../engineTranspiler"

describe("Game Engine Transpiler Suite", () => {
  const sampleOptions: EngineExportOptions = {
    shaderName: "Custom/NeonPulse",
    shaderSource: `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color * sin(u_time * u_speed);
    fragColor = vec4(col, 1.0);
}
`,
    parsedUniforms: [
      { name: "u_color", type: "vec3f", kind: "color" },
      { name: "u_speed", type: "f32", kind: "scalar" },
    ],
    uniformValues: {
      u_color: { type: "vec3", value: [0.9, 0.2, 0.5] },
      u_speed: { type: "float", value: 2.5 },
    },
  }

  it("transpiles GLSL to Unity URP ShaderLab / HLSL with properties and CBUFFER", () => {
    const hlsl = transpileToUnityHLSL(sampleOptions)
    expect(hlsl).toContain('Shader "Custom/NeonPulse"')
    expect(hlsl).toContain('_u_color ("u_color", Color) = (0.9, 0.2, 0.5, 1)')
    expect(hlsl).toContain('_u_speed ("u_speed", Float) = 2.5')
    expect(hlsl).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(hlsl).toContain("float4 _u_color;")
    expect(hlsl).toContain("float _u_speed;")
    expect(hlsl).toContain("TransformObjectToHClip")
    expect(hlsl).toContain("_Time.y")
    expect(hlsl).toContain("_ScreenParams.xy")
    expect(hlsl).toContain("SV_Target")
  })

  it("transpiles GLSL to Godot 4 Spatial Shader (.gdshader)", () => {
    const gdshader = transpileToGodotShader(sampleOptions)
    expect(gdshader).toContain("shader_type spatial;")
    expect(gdshader).toContain("uniform vec4 u_color : source_color = vec4(0.9, 0.2, 0.5, 1);")
    expect(gdshader).toContain("uniform float u_speed = 2.5;")
    expect(gdshader).toContain("TIME")
    expect(gdshader).toContain("VIEWPORT_SIZE")
    expect(gdshader).toContain("ALBEDO = fragColor.rgb;")
  })

  it("transpiles to Shadertoy format with iTime and iResolution", () => {
    const shadertoy = transpileToShadertoy(sampleOptions)
    expect(shadertoy).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
    expect(shadertoy).toContain("iTime")
    expect(shadertoy).toContain("iResolution.xy")
  })
})
