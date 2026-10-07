import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
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

describe("Tier 1: Render Loop Consolidation & Safety", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 29: Single Authoritative Render Loop
  describe("Feature 29: Single Authoritative Render Loop", () => {
    it("maintains exactly one active rAF callback on WebGPU adapter lifecycle", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)
      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })

    it("maintains exactly one active rAF callback on WebGL2 adapter lifecycle", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)
      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })

    it("maintains exactly one active rAF callback on Three.js adapter lifecycle", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })

    it("does not spawn secondary render loops on shader recompilation", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader("void main() { fragColor = vec4(1.0); }")
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })

    it("does not spawn secondary loops on setRenderQueue updates", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })
  })

  // Feature 30: Zombie Loop Elimination
  describe("Feature 30: Zombie Loop Elimination", () => {
    it("cancels pending rAF when WebGPUAdapter is disposed", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("cancels pending rAF when WebGL2Adapter is disposed", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("cancels pending rAF when ThreeJSAdapter is disposed", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(env.clock.activeCallbackCount).toBe(1)
      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("does not schedule any callbacks when stepping clock after disposal", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.dispose()

      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("allows remounting new adapter without inheriting disposed loops", async () => {
      const adapter1 = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter1.mount(canvas as any)
      adapter1.dispose()

      const adapter2 = new WebGL2Adapter()
      await adapter2.mount(canvas as any)
      expect(env.clock.activeCallbackCount).toBe(1)
      adapter2.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // Feature 31: Async Mount Cancellation
  describe("Feature 31: Async Mount Cancellation", () => {
    it("cancels mounting process cleanly if cancellation token is marked", async () => {
      let isCancelled = false
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()

      const mountPromise = (async () => {
        await adapter.mount(canvas as any)
        if (isCancelled) {
          adapter.dispose()
          return false
        }
        return true
      })()

      // Cancel immediately before promise finishes
      isCancelled = true
      const result = await mountPromise
      expect(result).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("handles rapid mount and immediate disposal sequence with cancellation token", async () => {
      let isCancelled = false
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()

      const mountPromise = (async () => {
        await adapter.mount(canvas as any)
        if (isCancelled) {
          adapter.dispose()
        }
      })()

      isCancelled = true
      await mountPromise

      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("handles switching backends while mount is unresolved", async () => {
      const canvas = env.createCanvas()
      const adapter1 = new WebGPUAdapter()
      const adapter2 = new WebGL2Adapter()

      let activeAdapter = adapter1
      let isCancelled1 = false

      const mount1 = (async () => {
        await adapter1.mount(canvas as any)
        if (isCancelled1) {
          adapter1.dispose()
        }
      })()

      // Switch to adapter2
      isCancelled1 = true
      activeAdapter = adapter2
      await adapter2.mount(canvas as any)
      await mount1

      expect(activeAdapter).toBe(adapter2)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter2.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("ensures unmounted canvas references are detached on dispose", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      adapter.dispose()

      expect(() => adapter.resize(500, 500)).not.toThrow()
    })

    it("prevents zombie callbacks when component unmounts mid-animation", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      env.clock.step(16)
      // Unmount occurs
      adapter.dispose()

      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // Feature 32: Viewport Resize Safety
  describe("Feature 32: Viewport Resize Safety", () => {
    it("updates canvas dimensions considering devicePixelRatio on WebGPU", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(400, 300)
      await adapter.mount(canvas as any)

      adapter.resize(800, 600)
      expect(canvas.width).toBe(800)
      expect(canvas.height).toBe(600)

      adapter.dispose()
    })

    it("updates gl.viewport dimensions on WebGL2 resize", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(300, 200)
      await adapter.mount(canvas as any)

      adapter.resize(1024, 768)
      const gl = env.webgl2.getLastContext()!
      expect(gl.viewportRect.width).toBe(1024)
      expect(gl.viewportRect.height).toBe(768)

      adapter.dispose()
    })

    it("resizes Three.js camera and renderer without aspect distortion", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas(640, 480)
      await adapter.mount(canvas as any)

      adapter.resize(1280, 720)
      expect(canvas.width).toBe(1280)
      expect(canvas.height).toBe(720)

      adapter.dispose()
    })

    it("ignores redundant resize calls with identical dimensions", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      const initialTextureCount = device.createdTextures.length

      adapter.resize(800, 600)
      expect(device.createdTextures.length).toBe(initialTextureCount)

      adapter.dispose()
    })

    it("recreates WebGPU depth texture matching new dimensions", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(400, 400)
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      const initialTextures = device.createdTextures.length

      adapter.resize(800, 600)
      expect(device.createdTextures.length).toBeGreaterThan(initialTextures)

      adapter.dispose()
    })
  })

  // Feature 33: Unified Performance Metrics
  describe("Feature 33: Unified Performance Metrics", () => {
    it("reports performance metrics after 1000ms on WebGPU", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      // Advance clock by 1000ms
      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()
      const metrics = perfSpy.mock.calls[0][0]
      expect(metrics).toHaveProperty("fps")
      expect(metrics).toHaveProperty("frameTime")
      expect(metrics).toHaveProperty("timestamp")

      adapter.dispose()
    })

    it("reports performance metrics on WebGL2 after 1000ms elapsed", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(1001)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
    })

    it("reports performance metrics on Three.js after 1000ms elapsed", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
    })

    it("does not invoke perf callback before 1000ms threshold", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(500)
      expect(perfSpy).not.toHaveBeenCalled()

      adapter.dispose()
    })

    it("resets frame count after reporting metrics", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(1000)
      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalledTimes(2)

      adapter.dispose()
    })
  })

  // Feature 34: Context Loss Handling
  describe("Feature 34: Context Loss Handling", () => {
    it("stops render loop on WebGL2 context loss event", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      expect(env.clock.activeCallbackCount).toBe(1)

      gl.simulateContextLost()
      expect(useProjectStore.getState().deviceLost).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(0)

      adapter.dispose()
    })

    it("re-initializes WebGL2 adapter on context restored event", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      gl.simulateContextLost()
      expect(useProjectStore.getState().deviceLost).toBe(true)

      gl.simulateContextRestored()
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.dispose()
    })

    it("records deviceLost in project store on WebGPU device loss", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      device.simulateDeviceLost("GPU out of memory")

      await new Promise((r) => setTimeout(r, 10))
      expect(useProjectStore.getState().deviceLost).toBe(true)

      adapter.dispose()
    })

    it("removes event listeners on disposal to prevent memory leaks", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.dispose()
      const gl = env.webgl2.getLastContext()
      if (gl) {
        expect(() => gl.simulateContextLost()).not.toThrow()
      }
    })

    it("sets lastCompileError on context lost", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      gl.simulateContextLost()

      expect(useProjectStore.getState().lastCompileError).toContain("WebGL2 context lost")
      adapter.dispose()
    })
  })
})
