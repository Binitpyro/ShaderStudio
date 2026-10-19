import { describe, it, expect } from "vitest"
import { SHADER_TEMPLATES } from "@/core/templates"
import { transpileToUnityHLSL, transpileToGodotShader, transpileToShadertoy } from "@/core/engineTranspiler"

describe("MCP Server Engine & Catalog", () => {
  it("provides all curated production templates with full metadata", () => {
    expect(SHADER_TEMPLATES.length).toBeGreaterThanOrEqual(6)
    const ids = SHADER_TEMPLATES.map((t) => t.id)
    expect(ids).toContain("holographic-shield")
    expect(ids).toContain("solar-plasma-orb")
    expect(ids).toContain("synthwave-grid")
    expect(ids).toContain("liquid-metal-iridescence")
    expect(ids).toContain("ocean-caustics")
    expect(ids).toContain("cosmic-nebula")

    for (const tmpl of SHADER_TEMPLATES) {
      expect(tmpl.name).toBeTruthy()
      expect(tmpl.shaderSource).toBeTruthy()
      expect(tmpl.geometry).toBeTruthy()
      expect(tmpl.backend).toBe("threejs")
      expect(Object.keys(tmpl.uniforms).length).toBeGreaterThan(0)
    }
  })

  it("transpiles GLSL to Unity URP HLSL through engine transpiler", () => {
    const code = transpileToUnityHLSL({
      shaderName: "Custom/Plasma",
      shaderSource: "void main() { vec3 c = u_color * sin(u_time); gl_FragColor = vec4(c, 1.0); }",
      parsedUniforms: [
        { name: "u_color", type: "vec3f", kind: "color" },
      ],
      uniformValues: {
        u_color: { type: "vec3", value: [1, 0, 0] },
      },
    })
    expect(code).toContain('Shader "Custom/Plasma"')
    expect(code).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(code).toContain("_Time.y")
    expect(code).toContain("SV_Target")
  })

  it("transpiles GLSL to Godot 4 Spatial Shader through Node transpiler", () => {
    const code = transpileToGodotShader({
      shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; }",
      parsedUniforms: [
        { name: "u_speed", type: "f32", kind: "scalar" },
      ],
      uniformValues: {
        u_speed: { type: "float", value: 2.0 },
      },
    })
    expect(code).toContain("shader_type spatial;")
    expect(code).toContain("uniform float u_speed = 2;")
    expect(code).toContain("VIEWPORT_SIZE")
    expect(code).toContain("FRAGCOORD")
  })

  it("transpiles GLSL to Shadertoy format through Node transpiler", () => {
    const code = transpileToShadertoy({
      shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; }",
      parsedUniforms: [],
      uniformValues: {},
    })
    expect(code).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
    expect(code).toContain("iResolution.xy")
  })
})
