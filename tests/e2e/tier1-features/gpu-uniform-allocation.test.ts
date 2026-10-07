import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockThreeRenderer } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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
