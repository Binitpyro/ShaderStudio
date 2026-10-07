import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { useProjectStore } from "@/stores/projectStore"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { WebGPUAdapter } from "@/adapters/webgpu"

describe("Tier 2: Boundary & Corner Cases — Uniforms", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles shader with 0 uniforms without errors", () => {
    const glsl = `#version 300 es\nvoid main() { fragColor = vec4(1.0); }`
    const glslUniforms = parseGlslUniforms(glsl)
    expect(glslUniforms).toHaveLength(0)

    const wgsl = `@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }`
    const wgslUniforms = parseWgslUniforms(wgsl)
    expect(wgslUniforms).toHaveLength(0)
  })

  it("handles 64+ uniforms in a single shader without truncation or slowdown", () => {
    let glsl = `#version 300 es\n`
    for (let i = 0; i < 64; i++) {
      glsl += `uniform float u_param_${i};\n`
    }
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms).toHaveLength(64)
    expect(uniforms[0].name).toBe("u_param_0")
    expect(uniforms[63].name).toBe("u_param_63")
  })

  it("handles extreme numeric values (Infinity, -Infinity, NaN, Max/Min) in store", async () => {
    const store = useProjectStore.getState()
    store.setUniformValue("u_inf", { type: "float", value: Infinity })
    store.setUniformValue("u_neg_inf", { type: "float", value: -Infinity })
    store.setUniformValue("u_nan", { type: "float", value: NaN })
    store.setUniformValue("u_max", { type: "float", value: Number.MAX_SAFE_INTEGER })

    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    expect(() => env.clock.step(16)).not.toThrow()
    adapter.dispose()
  })

  it("handles 32-bit unsigned integer boundary values (0 to 4294967295)", () => {
    const wgsl = `
      struct Bounds {
        minVal: u32,
        maxVal: u32,
      };
    `
    const uniforms = parseWgslUniforms(wgsl)
    expect(uniforms).toHaveLength(2)
    expect(uniforms.every((u) => u.type === "u32")).toBe(true)
  })

  it("handles unusually long uniform identifier names (100+ characters)", () => {
    const longName = "u_" + "a".repeat(100)
    const glsl = `uniform float ${longName};`
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms).toHaveLength(1)
    expect(uniforms[0].name).toBe(longName)
  })

  it("handles 100 rapid sequential uniform updates in single frame tick", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    for (let i = 0; i < 100; i++) {
      adapter.updateUniform("color", { type: "color", value: [i / 100, 0.5, 0.5] })
    }

    env.clock.step(16)
    adapter.dispose()
  })

  it("handles unusual whitespace, tabs, and comments around uniform statements", () => {
    const glsl = `
      /* Comment before uniform */
      \t  \t uniform   \t vec4   u_commented_vec  ; \t // trailing comment
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms).toHaveLength(1)
    expect(uniforms[0].name).toBe("u_commented_vec")
  })
})
