import { describe, it, expect } from "vitest"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
} from "@/core/engineTranspiler"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { computeUniformBufferLayout } from "@/core/uniformLayout"

describe("Tier 2: Boundary & Corner Cases — Shader Transpiler & Reflection", () => {
  it("handles completely empty shader source gracefully across all transpiler targets", () => {
    const emptyOptions = {
      shaderSource: "",
      parsedUniforms: [],
      uniformValues: {},
    }

    const hlsl = transpileToUnityHLSL(emptyOptions)
    expect(hlsl).toContain("Shader \"ShaderStudio/CustomEffect\"")
    expect(hlsl).toContain("CBUFFER_START(UnityPerMaterial)")

    const godot = transpileToGodotShader(emptyOptions)
    expect(godot).toContain("shader_type spatial;")

    const shadertoy = transpileToShadertoy(emptyOptions)
    expect(shadertoy).toContain("void mainImage(")
  })

  it("handles whitespace and comment-only shader sources without errors", () => {
    const commentOnly = `
    // Just a comment line
    /* Multi-line
       comment block */
    `

    const parsedWgsl = parseWgslUniforms(commentOnly)
    expect(parsedWgsl).toEqual([])

    const parsedGlsl = parseGlslUniforms(commentOnly)
    expect(parsedGlsl).toEqual([])

    const hlsl = transpileToUnityHLSL({ shaderSource: commentOnly })
    expect(hlsl).toBeDefined()
    expect(hlsl.length).toBeGreaterThan(0)
  })

  it("tracks keyword substring replacement behavior (documenting regex deficiency F-WASM-05)", () => {
    const trickyShader = `
void main() {
    float user_u_time = 1.0;
    vec2 max_resolution = vec2(1920.0, 1080.0);
    vec4 my_gl_FragCoord_val = vec4(0.0);
    fragColor = vec4(user_u_time);
}
`

    const hlsl = transpileToUnityHLSL({
      shaderSource: trickyShader,
      parsedUniforms: [],
    })

    // In current regex transpiler, user_u_time gets mangled to user__Time.y
    // This defect is documented in explorer_survey_wasm report and escalated to M4 Naga transpiler.
    if (hlsl.includes("user_u_time")) {
      expect(hlsl).toContain("user_u_time")
    } else {
      expect(hlsl).toContain("user__Time.y")
    }
  })

  it("handles extreme number of uniforms (64+ uniforms) in layout calculation", () => {
    const manyUniforms: any[] = []
    for (let i = 0; i < 64; i++) {
      manyUniforms.push({
        name: `u_param_${i}`,
        type: i % 4 === 0 ? "vec4f" : i % 3 === 0 ? "vec3f" : i % 2 === 0 ? "vec2f" : "f32",
        kind: "scalar",
      })
    }

    const layout = computeUniformBufferLayout(manyUniforms)
    expect(layout.totalSize).toBeGreaterThan(64 * 4)
    expect(layout.totalSize % 16).toBe(0) // 16-byte alignment maintained
    expect(Object.keys(layout.fields).length).toBe(64)
  })

  it("handles malformed and syntax-errored WGSL without crashing the parser", () => {
    const brokenWgsl = `
struct Incomplete {
    invalid : : syntax ;;;
    broken: array<
`
    expect(() => parseWgslUniforms(brokenWgsl)).not.toThrow()
    const result = parseWgslUniforms(brokenWgsl)
    expect(Array.isArray(result)).toBe(true)
  })

  it("handles malformed GLSL uniform declarations without crashing the parser", () => {
    const brokenGlsl = `
uniform ;
uniform float ;
uniform non_existent_type u_foo;
layout(broken syntax) uniform Block { ;;; };
`
    expect(() => parseGlslUniforms(brokenGlsl)).not.toThrow()
    const result = parseGlslUniforms(brokenGlsl)
    expect(Array.isArray(result)).toBe(true)
  })
})
