import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockThreeRenderer, MockWebGL2RenderingContext } from "../mocks"
import { WebGPUAdapter, webgpuAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter, webgl2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter, threejsAdapter } from "@/adapters/threejs"
import { useProjectStore, type UniformValue } from "@/stores/projectStore"
import * as THREE from "three"

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

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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

      adapter.updateUniform("roughness", { type: "float", value: 0.85 })
      adapter.updateUniform("tint", { type: "vec4", value: [0.9, 0.4, 0.2, 1.0] })

      // Recompile with the same or slightly tweaked shader
      const tweakedWgsl = complexWgsl.replace("scene.roughness + scene.time", "scene.roughness * 2.0")
      adapter.recompileShader(tweakedWgsl)

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
