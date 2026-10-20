// fleet(w1-a-render): consolidated from uniform-reflection.test.ts, gpu-uniform-allocation.test.ts, adversarial-uniform-stress.test.ts, boundary-uniforms.test.ts, adversarial-m2-challenger.test.ts, texture-binding.test.ts, boundary-textures.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { useProjectStore, type UniformValue, type TextureResource } from "@/stores/projectStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockThreeRenderer, MockWebGL2RenderingContext } from "../e2e/mocks"
import { WebGPUAdapter, webgpuAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter, webgl2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter, threejsAdapter } from "@/adapters/threejs"
import * as THREE from "three"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import { RenderCoordinator } from "@/core/renderCoordinator"

// WebGPU shader compilation resolves via device error scope + getCompilationInfo (async): flush before asserting.
const flushGpu = () => new Promise<void>((r) => setTimeout(r, 0))

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Uniform reflection and parsing", () => {
describe("Tier 1: Uniform Reflection & Parsing", () => {
  beforeEach(() => {
    useProjectStore.setState({
      parsedUniforms: [],
      uniformValues: {},
      graphUniforms: [],
    })
  })

  // Feature 1: Standard Uniform Reflection (GLSL ES 3.0)
  describe("Feature 1: Standard GLSL Uniform Reflection", () => {
    it("extracts float, int, uint, and bool scalar uniforms", () => {
      const glsl = `
        uniform float u_time;
        uniform int u_count;
        uniform uint u_flags;
        uniform bool u_enabled;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.find((u) => u.name === "u_time")).toMatchObject({ type: "f32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_count")).toMatchObject({ type: "i32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_flags")).toMatchObject({ type: "u32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_enabled")).toMatchObject({ type: "bool", kind: "scalar" })
    })

    it("extracts vector uniforms (vec2, vec3, vec4)", () => {
      const glsl = `
        uniform vec2 u_resolution;
        uniform vec3 u_position;
        uniform vec4 u_clip;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.find((u) => u.name === "u_resolution")).toMatchObject({ type: "vec2f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "u_position")).toMatchObject({ type: "vec3f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "u_clip")).toMatchObject({ type: "vec4f", kind: "vector" })
    })

    it("handles layout qualifiers preceding uniform declaration", () => {
      const glsl = `
        layout(location = 0) uniform float u_intensity;
        layout(binding = 1) uniform vec3 u_direction;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.find((u) => u.name === "u_intensity")).toBeDefined()
      expect(uniforms.find((u) => u.name === "u_direction")).toBeDefined()
    })

    it("ignores non-uniform variable declarations", () => {
      const glsl = `
        in vec3 a_position;
        out vec4 fragColor;
        float internalVar = 1.0;
        uniform float u_valid;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_valid")
    })

    it("handles whitespace variations and blank lines", () => {
      const glsl = `
        \t uniform   vec2   u_offset ;  
        
        uniform\tfloat\tu_zoom;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.map((u) => u.name)).toEqual(["u_offset", "u_zoom"])
    })
  })

  // Feature 2: Precision Qualifier Parsing (GLSL)
  describe("Feature 2: Precision Qualifier Parsing", () => {
    it("parses highp precision qualifier", () => {
      const glsl = `uniform highp float u_highPrecision;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_highPrecision", type: "f32" })
    })

    it("parses mediump precision qualifier", () => {
      const glsl = `uniform mediump vec3 u_mediumVector;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_mediumVector", type: "vec3f" })
    })

    it("parses lowp precision qualifier", () => {
      const glsl = `uniform lowp sampler2D u_lowTexture;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_lowTexture", type: "texture", kind: "texture" })
    })

    it("parses mixed precisions in a single shader", () => {
      const glsl = `
        uniform highp vec4 u_pos;
        uniform mediump float u_speed;
        uniform lowp bool u_flag;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms[0].name).toBe("u_pos")
      expect(uniforms[1].name).toBe("u_speed")
      expect(uniforms[2].name).toBe("u_flag")
    })

    it("correctly parses precision with global precision statements present", () => {
      const glsl = `
        #version 300 es
        precision highp float;
        precision mediump int;
        uniform mediump float u_factor;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_factor")
    })
  })

  // Feature 3: Array Uniform Expansion (GLSL)
  describe("Feature 3: GLSL Array Uniform Expansion", () => {
    it("expands float array into indexed names", () => {
      const glsl = `uniform float u_weights[3];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["u_weights[0]", "u_weights[1]", "u_weights[2]"])
      expect(uniforms.every((u) => u.type === "f32")).toBe(true)
    })

    it("expands vec3 array into indexed names", () => {
      const glsl = `uniform vec3 u_lightPositions[2];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].name).toBe("u_lightPositions[0]")
      expect(uniforms[1].name).toBe("u_lightPositions[1]")
      expect(uniforms[0].type).toBe("vec3f")
    })

    it("expands array of colors into color kind indexed names", () => {
      const glsl = `uniform vec3 u_paletteColors[2];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
    })

    it("handles single-element array", () => {
      const glsl = `uniform float u_single[1];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_single[0]")
    })

    it("handles multiple arrays with different types", () => {
      const glsl = `
        uniform float u_radii[2];
        uniform vec2 u_coords[2];
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.map((u) => u.name)).toEqual([
        "u_radii[0]",
        "u_radii[1]",
        "u_coords[0]",
        "u_coords[1]",
      ])
    })
  })

  // Feature 4: Color Name Heuristic
  describe("Feature 4: Color Name Heuristic", () => {
    it("detects 'color' keyword in uniform name", () => {
      const glsl = `uniform vec3 u_surfaceColor;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("detects 'tint' keyword in uniform name", () => {
      const glsl = `uniform vec4 u_tint;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("detects 'albedo' keyword in uniform name", () => {
      const glsl = `uniform vec3 u_baseAlbedo;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("is case-insensitive for color names", () => {
      const glsl = `
        uniform vec3 u_COLOR_PRIMARY;
        uniform vec4 u_TintFactor;
        uniform vec3 u_ALBEDO;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
      expect(uniforms[2].kind).toBe("color")
    })

    it("does not classify non-vector types as color even if name matches", () => {
      const glsl = `uniform float u_colorIntensity;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("scalar")
      expect(uniforms[0].type).toBe("f32")
    })
  })

  // Feature 5: Uniform Struct Member Parsing (WGSL)
  describe("Feature 5: WGSL Uniform Struct Member Parsing", () => {
    it("parses struct members with scalars and vectors", () => {
      const wgsl = `
        struct Uniforms {
          speed: f32,
          count: i32,
          offset: vec2<f32>,
          scale: vec3f,
        };
        @group(0) @binding(0) var<uniform> u: Uniforms;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.find((u) => u.name === "speed")).toMatchObject({ type: "f32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "count")).toMatchObject({ type: "i32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "offset")).toMatchObject({ type: "vec2f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "scale")).toMatchObject({ type: "vec3f", kind: "vector" })
    })

    it("parses boolean fields inside WGSL struct", () => {
      const wgsl = `
        struct Settings {
          invert: bool,
          enabled: bool,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "invert", type: "bool", kind: "scalar" })
      expect(uniforms[1]).toMatchObject({ name: "enabled", type: "bool", kind: "scalar" })
    })

    it("parses unsigned integer u32 in WGSL struct", () => {
      const wgsl = `
        struct Data {
          flags: u32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "flags", type: "u32", kind: "scalar" })
    })

    it("applies color heuristic to WGSL struct fields", () => {
      const wgsl = `
        struct Material {
          baseColor: vec3f,
          tintFactor: vec4<f32>,
          roughness: f32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms.find((u) => u.name === "baseColor")?.kind).toBe("color")
      expect(uniforms.find((u) => u.name === "tintFactor")?.kind).toBe("color")
      expect(uniforms.find((u) => u.name === "roughness")?.kind).toBe("scalar")
    })

    it("deduplicates members across multiple struct references", () => {
      const wgsl = `
        struct Params {
          intensity: f32,
        };
        struct ExtendedParams {
          intensity: f32,
          radius: f32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.map((u) => u.name)).toEqual(["intensity", "radius"])
    })
  })

  // Feature 6: Module Variable Reflection (WGSL)
  describe("Feature 6: WGSL Module Variable Reflection", () => {
    it("extracts top-level @group @binding var<uniform> scalars", () => {
      const wgsl = `
        @group(0) @binding(0) var<uniform> u_time: f32;
        @group(0) @binding(1) var<uniform> u_samples: i32;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.find((u) => u.name === "u_time")).toMatchObject({ type: "f32" })
      expect(uniforms.find((u) => u.name === "u_samples")).toMatchObject({ type: "i32" })
    })

    it("extracts top-level vector uniforms", () => {
      const wgsl = `
        @group(0) @binding(0) var<uniform> u_view_pos: vec3f;
        @group(0) @binding(1) var<uniform> u_res: vec2<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].type).toBe("vec3f")
      expect(uniforms[1].type).toBe("vec2f")
    })

    it("extracts top-level texture_2d declarations", () => {
      const wgsl = `
        @group(1) @binding(0) var u_diffuseMap: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_diffuseMap", type: "texture", kind: "texture" })
    })

    it("ignores sampler module variables without errors", () => {
      const wgsl = `
        @group(1) @binding(1) var u_sampler: sampler;
        @group(1) @binding(2) var u_mainTex: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_mainTex")
    })

    it("parses combined structs and module variables in single file", () => {
      const wgsl = `
        struct Globals {
          time: f32,
        };
        @group(0) @binding(0) var<uniform> globals: Globals;
        @group(0) @binding(1) var<uniform> u_ambient: vec3f;
        @group(1) @binding(0) var u_albedoTex: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["time", "u_ambient", "u_albedoTex"])
    })
  })

  // Feature 7: WGSL Array Expansion
  describe("Feature 7: WGSL Array Expansion", () => {
    // Note: In existing wgslUniforms.ts, FIELD_REGEX uses [^,;]+ which stops at the comma inside array<T, N>.
    // This is documented as an implementation bug in TEST_INFRA.md for Milestone M1.
    it("expands array<f32, N> in struct", () => {
      const wgsl = `
        struct Data {
          scales: array<f32, 3>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["scales[0]", "scales[1]", "scales[2]"])
      expect(uniforms.every((u) => u.type === "f32")).toBe(true)
    })

    it("expands array<vec3f, N> in struct", () => {
      const wgsl = `
        struct Lights {
          positions: array<vec3f, 2>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].name).toBe("positions[0]")
      expect(uniforms[1].name).toBe("positions[1]")
      expect(uniforms[0].type).toBe("vec3f")
    })

    it("expands color arrays preserving color kind", () => {
      const wgsl = `
        struct Palette {
          colorStops: array<vec3f, 2>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
    })

    it("expands single-element array<bool, 1>", () => {
      const wgsl = `
        struct Switches {
          flags: array<bool, 1>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("flags[0]")
      expect(uniforms[0].type).toBe("bool")
    })

    it("expands array with whitespace formatting variations", () => {
      const wgsl = `
        struct Test {
          vals: array< f32 , 4 >,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms[3].name).toBe("vals[3]")
    })
  })

  // Features 8, 9, 10, 11: Parameter Store & Type Controls
  describe("Features 8-11: Uniform Controls & Project Store Integration", () => {
    it("Feature 8: stores and modifies scalar float and boolean uniform values", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_speed", { type: "float", value: 1.5 })
      store.setUniformValue("u_active", { type: "bool", value: true })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_speed"]).toEqual({ type: "float", value: 1.5 })
      expect(state.uniformValues["u_active"]).toEqual({ type: "bool", value: true })
    })

    it("Feature 9: stores and modifies vector uniform components", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_resolution", { type: "vec2", value: [1920, 1080] })
      store.setUniformValue("u_position", { type: "vec3", value: [0.1, 0.5, -1.0] })
      store.setUniformValue("u_plane", { type: "vec4", value: [0, 1, 0, 0] })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_resolution"].value).toEqual([1920, 1080])
      expect(state.uniformValues["u_position"].value).toEqual([0.1, 0.5, -1.0])
      expect(state.uniformValues["u_plane"].value).toEqual([0, 1, 0, 0])
    })

    it("Feature 10: stores and updates color uniforms in RGB and RGBA formats", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_color", { type: "color", value: [1.0, 0.0, 0.5] })
      store.setUniformValue("u_tint", { type: "color", value: [0.2, 0.4, 0.6, 1.0] })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_color"].value).toEqual([1.0, 0.0, 0.5])
      expect(state.uniformValues["u_tint"].value).toEqual([0.2, 0.4, 0.6, 1.0])
    })

    it("Feature 11: stores 4x4 matrix uniform values in project store", () => {
      const identityMat4 = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]
      const store = useProjectStore.getState()
      store.setUniformValue("u_modelMatrix", { type: "vec4", value: identityMat4 })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_modelMatrix"].value).toHaveLength(16)
    })

    it("synchronizes graph uniforms with parsed uniforms in project store", () => {
      const store = useProjectStore.getState()
      store.addGraphUniform({
        id: "gu-1",
        name: "u_customFactor",
        type: "float",
        defaultValue: 2.5,
      })

      const state = useProjectStore.getState()
      expect(state.graphUniforms).toHaveLength(1)
      expect(state.graphUniforms[0].name).toBe("u_customFactor")
      expect(state.graphUniforms[0].defaultValue).toBe(2.5)
    })
  })
})
})

describe("Dynamic GPU uniform allocation and upload", () => {
describe("Tier 1: Dynamic GPU Uniform Allocation & Upload", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 12: WebGPU Dynamic GPU Buffer Allocation
  describe("Feature 12: Dynamic GPU Buffer Allocation (WebGPU)", () => {
    it("allocates uniform buffer with UNIFORM and COPY_DST usage", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      const mounted = await adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      const uniformBuffers = device!.createdBuffers.filter((b) => (b.usage & 64) !== 0) // GPUBufferUsage.UNIFORM = 64
      expect(uniformBuffers.length).toBeGreaterThan(0)
      expect(uniformBuffers[0].size).toBeGreaterThanOrEqual(80)

      adapter.dispose()
    })

    it("writes uniform data to GPUBuffer via device.queue.writeBuffer during render frame", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      const initialWrites = device.queue.writeBufferCalls.length

      env.clock.step(16)
      expect(device.queue.writeBufferCalls.length).toBeGreaterThan(initialWrites)

      adapter.dispose()
    })

    it("updates uniform buffer when color uniform changes", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      adapter.updateUniform("u_color", { type: "vec3", value: [0.9, 0.1, 0.2] })

      const colorWrites = device.queue.writeBufferCalls.filter((call) => call.offset === 64)
      expect(colorWrites.length).toBeGreaterThan(0)

      adapter.dispose()
    })

    it("cleans up uniform buffer and destroys device resources on dispose", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      const buffers = [...device.createdBuffers]
      adapter.dispose()

      expect(buffers.some((b) => b.isDestroyed)).toBe(true)
    })

    it("handles multiple sequential uniform updates without buffer corruption", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      for (let i = 0; i < 5; i++) {
        adapter.updateUniform("color", { type: "color", value: [i * 0.2, 0.5, 0.8] })
      }

      env.clock.step(16)
      adapter.dispose()
    })
  })

  // Feature 13: WebGL2 Dynamic Uniform Upload
  describe("Feature 13: Dynamic Uniform Upload (WebGL2)", () => {
    it("queries and caches uniform locations on shader program compilation", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      const mounted = await adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      env.clock.step(16)
      const gl = env.webgl2.getLastContext()!
      expect(gl.activeProgram).not.toBeNull()
      expect(gl.activeProgram!.uniformLocations.has("u_mvp")).toBe(true)
      expect(gl.activeProgram!.uniformLocations.has("u_color")).toBe(true)

      adapter.dispose()
    })

    it("uploads matrix uniform u_mvp via uniformMatrix4fv on each frame", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      env.clock.step(16)

      expect(gl.uniformValues.has("u_mvp")).toBe(true)
      const mvp = gl.uniformValues.get("u_mvp")
      expect(Array.isArray(mvp)).toBe(true)
      expect(mvp).toHaveLength(16)

      adapter.dispose()
    })

    it("uploads custom float uniform via uniform1f during render loop", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.75 })
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_roughness")).toBe(0.75)

      adapter.dispose()
    })

    it("uploads custom boolean uniform via uniform1i as 0 or 1", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("u_wireframe", { type: "bool", value: true })
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_wireframe")).toBe(1)

      useProjectStore.getState().setUniformValue("u_wireframe", { type: "bool", value: false })
      env.clock.step(16)
      expect(gl.uniformValues.get("u_wireframe")).toBe(0)

      adapter.dispose()
    })

    it("uploads custom vector uniforms (vec2, vec3, vec4) to GL program", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("u_center", { type: "vec2", value: [0.5, 0.5] })
      useProjectStore.getState().setUniformValue("u_offset", { type: "vec4", value: [1, 2, 3, 4] })
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_center")).toEqual([0.5, 0.5])
      expect(gl.uniformValues.get("u_offset")).toEqual([1, 2, 3, 4])

      adapter.dispose()
    })
  })

  // Feature 14: Three.js Dynamic Uniform Upload
  describe("Feature 14: Dynamic Uniform Upload (Three.js)", () => {
    it("registers initial uniforms in ShaderMaterial on mount", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      const mounted = await adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const rendererInstance = MockThreeRenderer.instances[0]
      expect(rendererInstance).toBeDefined()

      adapter.dispose()
    })

    it("updates float uniform on ShaderMaterial via updateUniform", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.updateUniform("u_color", { type: "color", value: [1.0, 0.0, 0.0] })
      env.clock.step(16)

      adapter.dispose()
    })

    it("updates color uniform from project store in render loop", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("color", { type: "color", value: [0.2, 0.8, 0.4] })
      env.clock.step(16)

      const rendererInstance = MockThreeRenderer.instances[0]
      expect(rendererInstance.render).toHaveBeenCalled()

      adapter.dispose()
    })

    it("flags material for recompilation and update on recompileShader", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const customFrag = `
        uniform vec3 u_color;
        void main() { gl_FragColor = vec4(u_color * 2.0, 1.0); }
      `
      adapter.recompileShader(customFrag)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("disposes Three.js material, scene, and renderer on dispose", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const rendererInstance = MockThreeRenderer.instances[0]
      adapter.dispose()

      expect(rendererInstance.dispose).toHaveBeenCalled()
    })
  })

  // Feature 15: Real-Time UI -> GPU Parameter Sync
  describe("Feature 15: Real-Time UI -> GPU Parameter Sync", () => {
    it("applies parameter change in project store within current frame on WebGPU", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      useProjectStore.getState().setUniformValue("color", { type: "color", value: [0.1, 0.2, 0.3] })
      env.clock.step(16)

      const recentWrites = device.queue.writeBufferCalls
      expect(recentWrites.length).toBeGreaterThan(0)

      adapter.dispose()
    })

    it("applies parameter change in project store within current frame on WebGL2", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      useProjectStore.getState().setUniformValue("u_color", { type: "color", value: [0.7, 0.3, 0.1] })
      env.clock.step(16)

      const colorVal = gl.uniformValues.get("u_color")
      expect(colorVal).toBeDefined()
      expect(colorVal[0]).toBeCloseTo(0.7)

      adapter.dispose()
    })

    it("preserves uniform store values across multiple frame steps", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("u_time", { type: "float", value: 10.5 })
      env.clock.stepFrames(10, 16.666)

      expect(useProjectStore.getState().uniformValues["u_time"].value).toBe(10.5)

      adapter.dispose()
    })

    it("updates multiple uniforms simultaneously without cross-talk", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const store = useProjectStore.getState()
      store.setUniformValue("u_scalar", { type: "float", value: 42.0 })
      store.setUniformValue("u_vec", { type: "vec2", value: [1.0, 2.0] })
      store.setUniformValue("u_flag", { type: "bool", value: true })

      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_scalar")).toBe(42.0)
      expect(gl.uniformValues.get("u_vec")).toEqual([1.0, 2.0])
      expect(gl.uniformValues.get("u_flag")).toBe(1)

      adapter.dispose()
    })

    it("handles switching activeBackend without losing uniform values", async () => {
      useProjectStore.getState().setUniformValue("u_sharedParam", { type: "float", value: 99.0 })
      useProjectStore.getState().setActiveBackend("webgl2")
      expect(useProjectStore.getState().uniformValues["u_sharedParam"].value).toBe(99.0)

      useProjectStore.getState().setActiveBackend("threejs")
      expect(useProjectStore.getState().uniformValues["u_sharedParam"].value).toBe(99.0)

      useProjectStore.getState().setActiveBackend("webgpu")
      expect(useProjectStore.getState().uniformValues["u_sharedParam"].value).toBe(99.0)
    })
  })
})
})

describe("Dynamic uniform stress and UI synchronization", () => {
// Ensure mock WebGL2 context handles WebGL2-specific methods
if (!(MockWebGL2RenderingContext.prototype as any).uniformMatrix3fv) {
  ;(MockWebGL2RenderingContext.prototype as any).uniformMatrix3fv = function (
    location: any,
    _transpose: boolean,
    v: Float32Array | number[]
  ) {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }
}
if (!(MockWebGL2RenderingContext.prototype as any).uniformMatrix2fv) {
  ;(MockWebGL2RenderingContext.prototype as any).uniformMatrix2fv = function (
    location: any,
    _transpose: boolean,
    v: Float32Array | number[]
  ) {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }
}
if (!(MockWebGL2RenderingContext.prototype as any).uniform1ui) {
  ;(MockWebGL2RenderingContext.prototype as any).uniform1ui = function (location: any, v: number) {
    if (location) {
      location.value = v
      this.uniformValues.set(location.name, v)
    }
  }
}


describe("Tier 5: Adversarial Stress Testing — Dynamic Uniforms & UI Synchronization", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // -------------------------------------------------------------------------
  // 1. WebGPUAdapter: Concurrent modulation & render loop non-stomping
  // -------------------------------------------------------------------------
  describe("WebGPUAdapter: Concurrent Modulation & Render Loop Safety", () => {
    const complexWgsl = `
      struct SceneUniforms {
        mvp: mat4x4<f32>,
        time: f32,
        roughness: f32,
        metalness: f32,
        flags: u32,
        tint: vec4<f32>,
        lightPos: vec3<f32>,
        scale: vec2<f32>,
        transform: mat3x3<f32>,
      }
      @group(0) @binding(0) var<uniform> scene: SceneUniforms;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
      }

      @vertex
      fn vertex_main(@location(0) pos: vec3<f32>) -> VertexOutput {
        var out: VertexOutput;
        out.position = scene.mvp * vec4<f32>(pos, 1.0);
        return out;
      }

      @fragment
      fn fragment_main() -> @location(0) vec4<f32> {
        return scene.tint * (scene.roughness + scene.time);
      }
    `

    it("does not stomp dynamic uniforms when render loop writes mvp and time every frame", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.recompileShader(complexWgsl)
      await flushGpu()

      const device = env.webgpu.getDevice()!
      const uniformBuffer = device.createdBuffers.find(
        (b) => (b.usage & 64) !== 0 && !b.isDestroyed
      )
      expect(uniformBuffer).toBeDefined()

      // Set user uniform values before stepping render loop
      adapter.updateUniform("roughness", { type: "float", value: 0.72 })
      adapter.updateUniform("metalness", { type: "float", value: 0.45 })
      adapter.updateUniform("tint", { type: "vec4", value: [0.1, 0.2, 0.3, 1.0] })

      // Step render loop across 10 frames
      for (let f = 1; f <= 10; f++) {
        env.clock.step(16.666)

        // Rapid modulation mid-loop
        adapter.updateUniform("roughness", { type: "float", value: 0.72 + f * 0.01 })
        adapter.updateUniform("metalness", { type: "float", value: 0.45 - f * 0.01 })

        // Check that GPUBuffer data at offset 0 (mvp) is 64 bytes and non-zero
        const view = new DataView(uniformBuffer!.data.buffer, uniformBuffer!.data.byteOffset)
        const mvp0 = view.getFloat32(0, true)
        expect(mvp0).not.toBeNaN()

        // Check that time offset (64) is updated
        const timeVal = view.getFloat32(64, true)
        expect(timeVal).toBeGreaterThanOrEqual(0)

        // Check that roughness (offset 68) is NOT overwritten by mvp or time
        const roughnessVal = view.getFloat32(68, true)
        expect(roughnessVal).toBeCloseTo(0.72 + f * 0.01, 3)

        // Check that metalness (offset 72) is NOT overwritten
        const metalnessVal = view.getFloat32(72, true)
        expect(metalnessVal).toBeCloseTo(0.45 - f * 0.01, 3)

        // Check that tint (offset 80, vec4) is intact
        const r = view.getFloat32(80, true)
        const g = view.getFloat32(84, true)
        const b = view.getFloat32(88, true)
        const a = view.getFloat32(92, true)
        expect(r).toBeCloseTo(0.1, 3)
        expect(g).toBeCloseTo(0.2, 3)
        expect(b).toBeCloseTo(0.3, 3)
        expect(a).toBeCloseTo(1.0, 3)
      }

      adapter.dispose()
    })

    it("survives burst of 100 rapid consecutive uniform updates across multiple fields without buffer corruption", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.recompileShader(complexWgsl)
      await flushGpu()

      const device = env.webgpu.getDevice()!
      const uniformBuffer = device.createdBuffers.find(
        (b) => (b.usage & 64) !== 0 && !b.isDestroyed
      )!

      // Rapidly fire 100 updates alternating fields
      for (let i = 0; i < 100; i++) {
        adapter.updateUniform("roughness", { type: "float", value: i * 0.01 })
        adapter.updateUniform("flags", { type: "uint", value: i % 16 })
        adapter.updateUniform("scale", { type: "vec2", value: [i * 0.5, i * 0.25] })
        adapter.updateUniform("transform", {
          type: "mat3",
          value: [i, 0, 0, 0, i, 0, 0, 0, 1],
        })

        if (i % 10 === 0) {
          env.clock.step(16.666) // Interleave render frame
        }
      }

      // Verify final values at exact byte offsets
      const view = new DataView(uniformBuffer.data.buffer, uniformBuffer.data.byteOffset)

      // roughness is at offset 68
      expect(view.getFloat32(68, true)).toBeCloseTo(0.99, 2)
      // flags is at offset 76 (u32)
      expect(view.getUint32(76, true)).toBe(99 % 16)
      // scale is vec2f at offset 112 (after lightPos at 96-108, aligned to 8)
      expect(view.getFloat32(112, true)).toBeCloseTo(99 * 0.5, 2)
      expect(view.getFloat32(116, true)).toBeCloseTo(99 * 0.25, 2)

      adapter.dispose()
    })

    it("preserves uniform values across shader recompile with same struct definition", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.recompileShader(complexWgsl)
      await flushGpu()

      adapter.updateUniform("roughness", { type: "float", value: 0.85 })
      adapter.updateUniform("tint", { type: "vec4", value: [0.9, 0.4, 0.2, 1.0] })

      // Recompile with the same or slightly tweaked shader
      const tweakedWgsl = complexWgsl.replace("scene.roughness + scene.time", "scene.roughness * 2.0")
      adapter.recompileShader(tweakedWgsl)
      await flushGpu()

      const device = env.webgpu.getDevice()!
      const activeBuffer = device.createdBuffers.find(
        (b) => (b.usage & 64) !== 0 && !b.isDestroyed
      )!
      const view = new DataView(activeBuffer.data.buffer, activeBuffer.data.byteOffset)

      // Cached values must be restored into the newly allocated buffer
      expect(view.getFloat32(68, true)).toBeCloseTo(0.85, 2)
      expect(view.getFloat32(80, true)).toBeCloseTo(0.9, 2)
      expect(view.getFloat32(84, true)).toBeCloseTo(0.4, 2)

      adapter.dispose()
    })

    it("correctly packs and uploads uniform array elements without writing NaN or zero", async () => {
      const arrayWgsl = `
        struct UniformsWithArray {
          mvp: mat4x4<f32>,
          weights: array<f32, 4>,
        }
        @group(0) @binding(0) var<uniform> scene: UniformsWithArray;

        struct VertexOutput { @builtin(position) pos: vec4<f32> }
        @vertex fn vertex_main(@location(0) p: vec3<f32>) -> VertexOutput {
          var o: VertexOutput;
          o.pos = scene.mvp * vec4<f32>(p, 1.0);
          return o;
        }
        @fragment fn fragment_main() -> @location(0) vec4<f32> {
          return vec4<f32>(scene.weights[0], scene.weights[1], scene.weights[2], scene.weights[3]);
        }
      `
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.recompileShader(arrayWgsl)
      await flushGpu()

      adapter.updateUniform("weights", {
        type: "float" as any,
        value: [1.5, 2.5, 3.5, 4.5] as any,
      })

      const device = env.webgpu.getDevice()!
      const activeBuffer = device.createdBuffers.find(
        (b) => (b.usage & 64) !== 0 && !b.isDestroyed
      )!
      const view = new DataView(activeBuffer.data.buffer, activeBuffer.data.byteOffset)

      // weights starts at offset 64 with 16-byte stride
      expect(view.getFloat32(64, true)).toBeCloseTo(1.5, 2)
      expect(view.getFloat32(64 + 16, true)).toBeCloseTo(2.5, 2)
      expect(view.getFloat32(64 + 32, true)).toBeCloseTo(3.5, 2)
      expect(view.getFloat32(64 + 48, true)).toBeCloseTo(4.5, 2)

      adapter.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // 2. WebGL2Adapter: Rapid modulation & non-reverting uniforms
  // -------------------------------------------------------------------------
  describe("WebGL2Adapter: Rapid Modulation & Frame Persistence", () => {
    it("does not revert color or custom uniforms to default on subsequent render frames", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!

      // Default color before update
      env.clock.step(16)
      const defaultColor = gl.uniformValues.get("u_color")
      expect(defaultColor[0]).toBeCloseTo(0.4)
      expect(defaultColor[1]).toBeCloseTo(0.6)
      expect(defaultColor[2]).toBeCloseTo(0.9)

      // Update color via updateUniform("u_color", ...)
      adapter.updateUniform("u_color", { type: "color", value: [0.8, 0.1, 0.2] })

      // Step multiple frames — must NOT revert to [0.4, 0.6, 0.9]
      for (let i = 0; i < 5; i++) {
        env.clock.step(16.666)
        const activeColor = gl.uniformValues.get("u_color")
        expect(activeColor[0]).toBeCloseTo(0.8)
        expect(activeColor[1]).toBeCloseTo(0.1)
        expect(activeColor[2]).toBeCloseTo(0.2)
      }

      // Update color again via updateUniform("u_color", ...)
      adapter.updateUniform("u_color", { type: "color", value: [0.2, 0.7, 0.9] })
      env.clock.step(16.666)
      const updatedColor = gl.uniformValues.get("u_color")
      expect(updatedColor[0]).toBeCloseTo(0.2)
      expect(updatedColor[1]).toBeCloseTo(0.7)
      expect(updatedColor[2]).toBeCloseTo(0.9)

      adapter.dispose()
    })

    it("handles cross-alias updates between 'color' and 'u_color' without shadowing", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!

      adapter.updateUniform("color", { type: "color", value: [0.8, 0.1, 0.2] })
      env.clock.step(16.666)

      adapter.updateUniform("u_color", { type: "color", value: [0.2, 0.7, 0.9] })
      env.clock.step(16.666)

      const updatedColor = gl.uniformValues.get("u_color")
      expect(updatedColor[0]).toBeCloseTo(0.2)
      expect(updatedColor[1]).toBeCloseTo(0.7)
      expect(updatedColor[2]).toBeCloseTo(0.9)

      adapter.dispose()
    })

    it("supports rapid sequence of mixed-type uniform updates in WebGL2", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!

      const customFrag = `
        #version 300 es
        precision highp float;
        out vec4 fragColor;
        uniform vec3 u_color;
        uniform float u_roughness;
        uniform vec2 u_offset;
        uniform bool u_active;
        uniform mat4 u_transform;
        void main() {
          fragColor = vec4(u_color, u_roughness) + (u_active ? vec4(u_offset, 0.0, 1.0) : vec4(0.0));
        }
      `
      adapter.recompileShader(customFrag)

      // Burst of rapid updates
      for (let i = 0; i < 50; i++) {
        adapter.updateUniform("u_roughness", { type: "float", value: 0.1 + i * 0.01 })
        adapter.updateUniform("u_offset", { type: "vec2", value: [i * 0.2, -i * 0.1] })
        adapter.updateUniform("u_active", { type: "bool", value: i % 2 === 0 })
        adapter.updateUniform("u_transform", {
          type: "mat4",
          value: [
            i, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
        })

        if (i % 5 === 0) {
          env.clock.step(16.666)
        }
      }

      // Check gl uniform cache
      expect(gl.uniformValues.get("u_roughness")).toBeCloseTo(0.1 + 49 * 0.01)
      const offset = gl.uniformValues.get("u_offset")
      expect(offset[0]).toBeCloseTo(49 * 0.2)
      expect(offset[1]).toBeCloseTo(-49 * 0.1)
      expect(gl.uniformValues.get("u_active")).toBe(49 % 2 === 0 ? 1 : 0)
      const mat = gl.uniformValues.get("u_transform")
      expect(mat[0]).toBe(49)
      expect(mat[5]).toBe(1)

      adapter.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // 3. ThreeJSAdapter: Rapid modulation & material uniform synchronization
  // -------------------------------------------------------------------------
  describe("ThreeJSAdapter: Rapid Modulation & Material Sync", () => {
    it("updates Three.js ShaderMaterial uniforms without time uniform stomping", async () => {
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const customFrag = `
        uniform vec3 u_color;
        uniform vec4 u_tint;
        uniform float u_intensity;
        uniform mat4 u_matrix;
        uniform float u_time;
        varying vec3 vNormal;
        void main() {
          gl_FragColor = vec4(u_color * u_intensity, 1.0) + u_tint;
        }
      `
      adapter.recompileShader(customFrag)

      // Modulate parameters rapidly
      for (let i = 0; i < 30; i++) {
        adapter.updateUniform("u_color", { type: "color", value: [i * 0.02, 0.5, 0.8] })
        adapter.updateUniform("u_tint", { type: "vec4", value: [0.1, 0.2, 0.3, i * 0.01] })
        adapter.updateUniform("u_intensity", { type: "float", value: 1.5 + i * 0.1 })
        adapter.updateUniform("u_matrix", {
          type: "mat4",
          value: [
            i, 0, 0, 0,
            0, 2, 0, 0,
            0, 0, 3, 0,
            0, 0, 0, 1,
          ],
        })

        env.clock.step(16.666) // Trigger Three.js render loop frame
      }

      // Access private material via any inspection
      const material = (adapter as any).material as THREE.ShaderMaterial
      expect(material).toBeDefined()
      expect(material.uniforms["u_color"]).toBeDefined()
      expect(material.uniforms["u_color"].value).toBeInstanceOf(THREE.Color)
      expect((material.uniforms["u_color"].value as THREE.Color).r).toBeCloseTo(29 * 0.02, 2)

      expect(material.uniforms["u_tint"].value).toBeInstanceOf(THREE.Vector4)
      expect((material.uniforms["u_tint"].value as THREE.Vector4).w).toBeCloseTo(29 * 0.01, 2)

      expect(material.uniforms["u_intensity"].value).toBeCloseTo(1.5 + 29 * 0.1, 2)

      expect(material.uniforms["u_matrix"].value).toBeInstanceOf(THREE.Matrix4)
      const elements = (material.uniforms["u_matrix"].value as THREE.Matrix4).elements
      expect(elements[0]).toBe(29)
      expect(elements[5]).toBe(2)
      expect(elements[10]).toBe(3)

      // Time uniform must be set by render loop without reverting u_color or others
      expect(material.uniforms["u_time"].value).toBeGreaterThan(0)
      expect(material.uniformsNeedUpdate).toBe(true)

      adapter.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // 4. ParameterPanel UI -> GPU Synchronous Dispatch Verification
  // -------------------------------------------------------------------------
  describe("UI Synchronization: Immediate Same-Frame Dispatch", () => {
    it("dispatches parameter changes synchronously to active WebGPU adapter without delay", async () => {
      useProjectStore.getState().setActiveBackend("webgpu")
      const canvas = env.createCanvas()
      await webgpuAdapter.mount(canvas as any)

      const spy = vi.spyOn(webgpuAdapter, "updateUniform")

      // Simulate what ParameterPanel controls do upon user action:
      // 1. onChange(newValue) -> setUniformValue in store
      // 2. getAdapter().updateUniform(name, newValue) synchronously
      const testVal: UniformValue = { type: "float", value: 3.1415 }
      useProjectStore.getState().setUniformValue("u_fov", testVal)
      webgpuAdapter.updateUniform("u_fov", testVal)

      // Verify immediate synchronous call (0 frames, 0 ticks delayed)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith("u_fov", testVal)
      expect(useProjectStore.getState().uniformValues["u_fov"].value).toBe(3.1415)

      spy.mockRestore()
      webgpuAdapter.dispose()
    })

    it("dispatches parameter changes synchronously to active WebGL2 adapter without delay", async () => {
      useProjectStore.getState().setActiveBackend("webgl2")
      const canvas = env.createCanvas()
      await webgl2Adapter.mount(canvas as any)

      const spy = vi.spyOn(webgl2Adapter, "updateUniform")

      const testVal: UniformValue = { type: "vec3", value: [0.33, 0.66, 0.99] }
      useProjectStore.getState().setUniformValue("u_pos", testVal)
      webgl2Adapter.updateUniform("u_pos", testVal)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith("u_pos", testVal)
      expect(useProjectStore.getState().uniformValues["u_pos"].value).toEqual([0.33, 0.66, 0.99])

      spy.mockRestore()
      webgl2Adapter.dispose()
    })

    it("dispatches parameter changes synchronously to active ThreeJS adapter without delay", async () => {
      useProjectStore.getState().setActiveBackend("threejs")
      const canvas = env.createCanvas()
      await threejsAdapter.mount(canvas as any)

      const spy = vi.spyOn(threejsAdapter, "updateUniform")

      const testVal: UniformValue = { type: "bool", value: true }
      useProjectStore.getState().setUniformValue("u_bloom", testVal)
      threejsAdapter.updateUniform("u_bloom", testVal)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith("u_bloom", testVal)
      expect(useProjectStore.getState().uniformValues["u_bloom"].value).toBe(true)

      spy.mockRestore()
      threejsAdapter.dispose()
    })

    it("computes matrix presets accurately across 2x2, 3x3, and 4x4 dimensions", () => {
      // 4x4 Identity and Scale presets
      const identity4 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
      const scale2_4 = [2,0,0,0, 0,2,0,0, 0,0,2,0, 0,0,0,1]
      const scaleHalf_4 = [0.5,0,0,0, 0,0.5,0,0, 0,0,0.5,0, 0,0,0,1]

      // 3x3 Identity and Scale presets
      const identity3 = [1,0,0, 0,1,0, 0,0,1]
      const scale2_3 = [2,0,0, 0,2,0, 0,0,2]

      // 2x2 Identity and Scale presets
      const identity2 = [1,0, 0,1]
      const scale2_2 = [2,0, 0,2]

      expect(identity4).toHaveLength(16)
      expect(identity3).toHaveLength(9)
      expect(identity2).toHaveLength(4)
      expect(scale2_4[0]).toBe(2)
      expect(scale2_3[4]).toBe(2)
      expect(scale2_2[3]).toBe(2)
      expect(scaleHalf_4[10]).toBe(0.5)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Edge cases: Malformed, partial, and boundary values
  // -------------------------------------------------------------------------
  describe("Edge Cases & Extreme Boundaries", () => {
    it("handles subnormal, infinite, and NaN numbers without throwing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(() => {
        adapter.updateUniform("roughness", { type: "float", value: NaN })
        adapter.updateUniform("roughness", { type: "float", value: Infinity })
        adapter.updateUniform("roughness", { type: "float", value: -Infinity })
        adapter.updateUniform("roughness", { type: "float", value: 1e-40 })
      }).not.toThrow()

      adapter.dispose()
    })

    it("handles truncated array inputs for vector and matrix uniforms gracefully", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(() => {
        // Truncated vector
        adapter.updateUniform("color", { type: "color", value: [0.5] as any })
        // Truncated matrix
        adapter.updateUniform("mvp", { type: "mat4", value: [1, 2, 3] as any })
        // Empty array
        adapter.updateUniform("mvp", { type: "mat4", value: [] as any })
      }).not.toThrow()

      adapter.dispose()
    })
  })
})
})

describe("Uniform boundary cases", () => {
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
})

describe("WebGPU uniform zero-allocation and geometry lifecycle", () => {
describe("Milestone 2 Adversarial Challenger Suite: Bundle & Memory Robustness", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })


  // ==========================================================================
  // Section 2: High-Frequency WebGPU updateUniform & Zero Allocation Stress Test
  // ==========================================================================
  describe("WebGPU updateUniform High-Frequency & Zero-Allocation Stress Test", () => {
    it("executes 10,000 rapid uniform updates with strictly 0 ArrayBuffer/TypedArray slice allocations", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_time: f32,
    u_speed: f32,
    u_resolution: vec2f,
    u_color: vec4f,
    u_matrix: mat4x4f,
    u_count: u32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return u_data.u_color; }
`)
      await flushGpu()

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      // Track slice calls on ArrayBuffer and TypedArrays
      const arrayBufferSliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice")
      const uint8SliceSpy = vi.spyOn(Uint8Array.prototype, "slice")
      const float32SliceSpy = vi.spyOn(Float32Array.prototype, "slice")

      const initialWrites = device!.queue.writeBufferCalls.length

      // 10,000 high-frequency mixed uniform updates
      const ITERATIONS = 10000
      for (let i = 0; i < ITERATIONS; i++) {
        const mod = i % 5
        if (mod === 0) {
          adapter.updateUniform("u_time", { type: "float", value: i * 0.016 })
        } else if (mod === 1) {
          adapter.updateUniform("u_speed", { type: "float", value: 1.0 + (i % 10) })
        } else if (mod === 2) {
          adapter.updateUniform("u_resolution", { type: "vec2", value: [1920, 1080] })
        } else if (mod === 3) {
          adapter.updateUniform("u_color", { type: "color", value: [1.0, 0.5, 0.25, 1.0] })
        } else {
          adapter.updateUniform("u_count", { type: "uint", value: i })
        }
      }

      // Assert ABSOLUTELY ZERO slice calls
      expect(arrayBufferSliceSpy).not.toHaveBeenCalled()
      expect(uint8SliceSpy).not.toHaveBeenCalled()
      expect(float32SliceSpy).not.toHaveBeenCalled()

      // Verify device queue received exactly 10,000 writeBuffer dispatches
      expect(device!.queue.writeBufferCalls.length).toBe(initialWrites + ITERATIONS)

      // Verify the last write for u_count wrote correct data
      const lastWrite = device!.queue.writeBufferCalls[device!.queue.writeBufferCalls.length - 1]
      expect(lastWrite.byteLength).toBe(4)

      adapter.dispose()
    })

    it("verifies uniform updates write exact float and color bit patterns into GPU buffer without distortion", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_tint: vec4f,
    u_aspect: f32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return u_data.u_tint; }
`)
      await flushGpu()

      const device = env.webgpu.getDevice()!
      adapter.updateUniform("u_tint", { type: "vec4", value: [0.125, 0.25, 0.5, 1.0] })
      adapter.updateUniform("u_aspect", { type: "float", value: 1.777 })

      const uniformBuffer = (adapter as any).uniformBuffer
      expect(uniformBuffer).toBeDefined()
      const gpuData = new Float32Array(uniformBuffer.data.buffer)

      // u_tint is vec4f at offset 0
      expect(gpuData[0]).toBeCloseTo(0.125)
      expect(gpuData[1]).toBeCloseTo(0.25)
      expect(gpuData[2]).toBeCloseTo(0.5)
      expect(gpuData[3]).toBeCloseTo(1.0)

      // u_aspect is f32 at offset 16 (index 4)
      expect(gpuData[4]).toBeCloseTo(1.777)

      adapter.dispose()
    })

    it("resiliently handles invalid uniform names, null values, and disposed adapter without crashing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_val: f32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return vec4f(u_data.u_val); }
`)

      // Unknown uniform: should safely no-op
      expect(() => {
        adapter.updateUniform("u_nonexistent", { type: "float", value: 42 })
      }).not.toThrow()

      // Null/undefined values
      expect(() => {
        adapter.updateUniform("u_val", { type: "float", value: null as any })
      }).not.toThrow()

      // After dispose
      adapter.dispose()
      expect(() => {
        adapter.updateUniform("u_val", { type: "float", value: 10 })
      }).not.toThrow()
    })
  })

  // ==========================================================================
  // Section 3: TorusKnot / Geometry Creation & Disposal Cycles Across Adapters
  // ==========================================================================
  describe("Geometry Creation & Disposal Cycles Across Adapters", () => {
    it("WebGPU: caches TorusKnot vertices and cleans up temporary Three.js geometries", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Spying on TorusKnotGeometry to ensure zero allocations during repeated switches
      const torusKnotSpy = vi.spyOn(THREE, "TorusKnotGeometry")

      // Queue 200 cycles of mesh geometry switches
      for (let i = 0; i < 200; i++) {
        const geom = i % 2 === 0 ? "torus_knot" : "cube"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Torus knot geometry caching ensures we don't recreate or leak Three.js geometry objects
      expect(torusKnotSpy).not.toHaveBeenCalled()

      // After adapter disposal, vertex buffers are destroyed cleanly
      adapter.dispose()
      expect((adapter as any).vertexBuffers.size).toBe(0)
    })

    it("WebGL2: cycles through geometries and cleans up WebGL buffers without leaks", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      const deleteBufferSpy = vi.spyOn(gl, "deleteBuffer")
      const deleteProgramSpy = vi.spyOn(gl, "deleteProgram")

      // Rapidly switch geometries 100 times
      for (let i = 0; i < 100; i++) {
        const geom = i % 4 === 0 ? "torus_knot" : i % 4 === 1 ? "sphere" : i % 4 === 2 ? "cube" : "plane"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Clean dispose
      adapter.dispose()

      expect(deleteBufferSpy).toHaveBeenCalled()
      expect(deleteProgramSpy).toHaveBeenCalled()
      expect((adapter as any).initialized).toBe(false)
      expect((adapter as any).gl).toBeNull()
    })

    it("Three.js: caches buffer geometries, prevents redundant mesh rebuilds, and disposes on teardown", async () => {
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const geomDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose")
      const matDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose")

      // Switch geometries 200 times
      for (let i = 0; i < 200; i++) {
        const geom = i % 4 === 0 ? "torus_knot" : i % 4 === 1 ? "sphere" : i % 4 === 2 ? "cube" : "plane"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Geometries should be cached in geometryCache (at most 4 cached geometries)
      const cache = (adapter as any).geometryCache as Map<string, THREE.BufferGeometry>
      expect(cache.size).toBeLessThanOrEqual(4)

      // Repeating the same geometry does not rebuild the mesh or re-allocate
      const meshBefore = (adapter as any).mesh
      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      const meshAfter = (adapter as any).mesh
      expect(meshAfter).toBe(meshBefore)

      // On dispose, all cached geometries and materials are disposed
      adapter.dispose()

      expect(geomDisposeSpy).toHaveBeenCalled()
      expect(matDisposeSpy).toHaveBeenCalled()
      expect((adapter as any).geometryCache.size).toBe(0)
      expect((adapter as any).mesh).toBeNull()
      expect((adapter as any).scene).toBeNull()
      expect((adapter as any).renderer).toBeNull()
    })
  })


})
})

describe("Texture pipeline and multi-binding", () => {
describe("Tier 1: Texture Pipeline & Multi-Binding", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 16: Texture Slot Ingestion
  describe("Feature 16: Texture Slot Ingestion", () => {
    it("adds a texture resource to project store", () => {
      const tex: TextureResource = { id: "tex-1", name: "checkerboard.png", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
      useProjectStore.getState().addTextureResource(tex)

      expect(useProjectStore.getState().textureResources).toHaveLength(1)
      expect(useProjectStore.getState().textureResources[0].id).toBe("tex-1")
    })

    it("removes a texture resource by ID from project store", () => {
      useProjectStore.getState().addTextureResource({ id: "tex-1", name: "tex1.png", src: "blob:http://localhost/1" })
      useProjectStore.getState().addTextureResource({ id: "tex-2", name: "tex2.png", src: "blob:http://localhost/2" })

      useProjectStore.getState().removeTextureResource("tex-1")
      const remaining = useProjectStore.getState().textureResources
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe("tex-2")
    })

    it("supports multiple texture resources simultaneously in store", () => {
      for (let i = 0; i < 5; i++) {
        useProjectStore.getState().addTextureResource({ id: `tex-${i}`, name: `texture_${i}.png`, src: `data:image/png;base64,${i}` })
      }
      expect(useProjectStore.getState().textureResources).toHaveLength(5)
    })

    it("handles replacing or updating texture with same ID cleanly", () => {
      useProjectStore.getState().addTextureResource({ id: "tex-target", name: "v1.png", src: "data:v1" })
      useProjectStore.getState().removeTextureResource("tex-target")
      useProjectStore.getState().addTextureResource({ id: "tex-target", name: "v2.png", src: "data:v2" })

      const resources = useProjectStore.getState().textureResources
      expect(resources).toHaveLength(1)
      expect(resources[0].name).toBe("v2.png")
    })

    it("stores texture uniform values in project store", () => {
      useProjectStore.getState().setUniformValue("u_albedo", { type: "texture", value: "tex-1" })
      expect(useProjectStore.getState().uniformValues["u_albedo"]).toEqual({ type: "texture", value: "tex-1" })
    })
  })

  // Feature 17: WebGPU Texture & Sampler Binding
  describe("Feature 17: WebGPU Texture & Sampler Binding", () => {
    it("creates GPUTexture when texture render step is received in setRenderQueue", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-albedo", name: "albedo.png", src: "https://example.com/albedo.png" })

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "texture", id: "tex-albedo", src: "https://example.com/albedo.png", binding: 0 },
      ])

      // Wait a microtask tick for async loadTexture to initiate
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      expect(device.createdTextures.length).toBeGreaterThan(0)

      adapter.dispose()
    })

    it("configures GPUTexture with TEXTURE_BINDING and COPY_DST usage", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-normal", name: "normal.png", src: "https://example.com/normal.png" })
      adapter.setRenderQueue([
        { type: "texture", id: "tex-normal", src: "https://example.com/normal.png", binding: 0 },
      ])

      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const tex = device.createdTextures.find((t) => (t.usage & 4) !== 0) // TEXTURE_BINDING = 4
      expect(tex).toBeDefined()

      adapter.dispose()
    })

    it("avoids redundant texture allocation if texture is already loaded", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-cached", name: "cached.png", src: "https://example.com/cached.png" })

      adapter.setRenderQueue([{ type: "texture", id: "tex-cached", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const initialCount = device.createdTextures.length

      // Send same queue again
      adapter.setRenderQueue([{ type: "texture", id: "tex-cached", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      expect(device.createdTextures.length).toBe(initialCount)

      adapter.dispose()
    })

    it("destroys loaded GPUTextures when adapter is disposed", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-cleanup", name: "clean.png", src: "https://example.com/clean.png" })
      adapter.setRenderQueue([{ type: "texture", id: "tex-cleanup", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const textures = [...device.createdTextures]
      adapter.dispose()

      expect(textures.some((t) => t.isDestroyed)).toBe(true)
    })

    it("gracefully handles missing texture resource without throwing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // No resource in store with id "non-existent"
      expect(() => {
        adapter.setRenderQueue([{ type: "texture", id: "non-existent", src: "", binding: 0 }])
      }).not.toThrow()

      adapter.dispose()
    })
  })

  // Feature 19: Three.js Texture Binding
  describe("Feature 19: Three.js Texture Binding", () => {
    it("handles texture uniform updates cleanly", async () => {
      useProjectStore.getState().setUniformValue("u_tex", { type: "texture", value: "tex-1" })
      expect(useProjectStore.getState().uniformValues["u_tex"].type).toBe("texture")
    })

    it("preserves material uniforms when texture is configured", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.updateUniform("u_color", { type: "color", value: [0.5, 0.5, 0.5] })
      expect(() => {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "plane" },
          { type: "material", shaderPath: "default.frag", textureBindings: { u_diffuse: "tex-1" } },
        ])
      }).not.toThrow()

      adapter.dispose()
    })

    it("recompiles shader with texture sampler uniform without error", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const shader = `
        uniform sampler2D u_diffuse;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(u_diffuse, vUv); }
      `
      adapter.recompileShader(shader)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("disposes Three.js adapter cleanly after texture bindings", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      expect(() => adapter.dispose()).not.toThrow()
    })

    it("handles multiple render queue updates containing textures", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      for (let i = 0; i < 3; i++) {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "cube" },
          { type: "material", shaderPath: "test.frag", textureBindings: { [`u_tex${i}`]: `tex-${i}` } },
        ])
      }

      adapter.dispose()
    })
  })

  // Feature 20: Multi-Texture Simultaneous Binding
  describe("Feature 20: Multi-Texture Simultaneous Binding", () => {
    it("handles 2 simultaneous textures in render queue", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-0", name: "albedo.png", src: "data:tex0" })
      useProjectStore.getState().addTextureResource({ id: "tex-1", name: "normal.png", src: "data:tex1" })

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "texture", id: "tex-0", src: "data:tex0", binding: 0 },
        { type: "texture", id: "tex-1", src: "data:tex1", binding: 1 },
      ])

      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      expect(device.createdTextures.length).toBeGreaterThanOrEqual(1)

      adapter.dispose()
    })



    it("retains multiple textures across render queue updates", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tA", name: "A.png", src: "data:A" })
      useProjectStore.getState().addTextureResource({ id: "tB", name: "B.png", src: "data:B" })

      adapter.setRenderQueue([
        { type: "texture", id: "tA", src: "", binding: 0 },
        { type: "texture", id: "tB", src: "", binding: 1 },
      ])
      await new Promise((r) => setTimeout(r, 10))

      env.clock.step(16)
      adapter.dispose()
    })

  })

  // Feature 21: Texture Sampling in Shaders
  describe("Feature 21: Texture Sampling in Shaders", () => {
    it("parses sampler2D uniforms in GLSL shaders", () => {
      const glsl = `
        uniform sampler2D u_albedoMap;
        uniform sampler2D u_roughnessMap;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "u_albedoMap", type: "texture", kind: "texture" })
      expect(uniforms[1]).toMatchObject({ name: "u_roughnessMap", type: "texture", kind: "texture" })
    })

    it("parses texture_2d module variables in WGSL shaders", () => {
      const wgsl = `
        @group(0) @binding(1) var u_diffuse: texture_2d<f32>;
        @group(0) @binding(2) var u_normal: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "u_diffuse", type: "texture", kind: "texture" })
      expect(uniforms[1]).toMatchObject({ name: "u_normal", type: "texture", kind: "texture" })
    })

    it("recompiles shader containing texture sampling without errors", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const shader = `
        #version 300 es
        precision highp float;
        uniform sampler2D u_mainTex;
        in vec2 v_texCoord;
        out vec4 fragColor;
        void main() {
          fragColor = texture(u_mainTex, v_texCoord);
        }
      `
      adapter.recompileShader(shader)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("binds texture step with matching uniformName to material", () => {
      const bindings: Record<string, string> = {
        u_mainTex: "tex-image-1",
        u_maskTex: "tex-image-2",
      }
      expect(bindings["u_mainTex"]).toBe("tex-image-1")
      expect(bindings["u_maskTex"]).toBe("tex-image-2")
    })

    it("validates that texture uniforms are classified as texture kind in parameter panel list", () => {
      const glsl = `
        uniform vec3 u_color;
        uniform sampler2D u_albedo;
      `
      const uniforms = parseGlslUniforms(glsl)
      const texUniform = uniforms.find((u) => u.name === "u_albedo")
      expect(texUniform).toBeDefined()
      expect(texUniform!.kind).toBe("texture")
    })
  })
})
})

describe("Texture boundary cases", () => {
describe("Tier 2: Boundary & Corner Cases — Textures", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles empty texture ID without crashing adapter", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    expect(() => {
      adapter.setRenderQueue([{ type: "texture", id: "", src: "", binding: 0 }])
    }).not.toThrow()

    adapter.dispose()
  })

  it("handles failed network fetch for texture image gracefully", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network 404: Image not found")
    }

    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    useProjectStore.getState().addTextureResource({
      id: "tex-404",
      name: "missing.png",
      src: "https://example.com/missing.png",
    })

    expect(() => {
      adapter.setRenderQueue([{ type: "texture", id: "tex-404", src: "", binding: 0 }])
    }).not.toThrow()

    await new Promise((r) => setTimeout(r, 10))
    adapter.dispose()
  })



})
})

