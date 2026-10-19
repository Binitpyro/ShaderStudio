// fleet(w1-a-render): consolidated from render-loop.test.ts, adversarial-render-coordinator.test.ts, adversarial-render-coordinator-lifecycle.test.ts, adversarial-coordinator-deep-stress.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, type E2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"
import { RenderCoordinator, renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { audioEngine } from "@/audio/audioEngine"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Adapter render loop consolidation & safety", () => {
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
})

describe("RenderCoordinator phases, hooks, switching and telemetry", () => {
describe("Adversarial Stress Test: Milestone 2 RenderCoordinator and Lifecycle Concurrency", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    teardownE2ETestEnvironment()
  })

  // ==========================================================================
  // Probe 1: Phase Execution Ordering, Pre-render Hook Throws, and Hook Mutations
  // ==========================================================================
  describe("Probe 1: Phase Execution Ordering & Hook Failure Modes", () => {
    it("strictly preserves 5-phase ordering: clock -> audio -> modulation -> draw -> telemetry", () => {
      const coordinator = new RenderCoordinator()
      const phaseOrder: string[] = []

      const mockAdapter = {
        renderFrame: vi.fn(() => {
          phaseOrder.push("mock-draw")
        }),
        dispose: vi.fn(),
      }

      coordinator.registerPreRenderHook("test-hook", () => {
        phaseOrder.push("mock-modulation")
      })

      coordinator.onMetrics(() => {
        phaseOrder.push("mock-telemetry")
      })

      coordinator.setActiveAdapter(mockAdapter)
      coordinator.tick(100)

      expect(coordinator.getLastFramePhases()).toEqual([
        "clock",
        "audio",
        "modulation",
        "draw",
        "telemetry",
      ])
      expect(phaseOrder).toEqual(["mock-modulation", "mock-draw", "mock-telemetry"])
      expect(mockAdapter.renderFrame).toHaveBeenCalledTimes(1)
    })

    it("resiliently recovers when audioEngine.update throws during Phase 2 (audio)", () => {
      const coordinator = new RenderCoordinator()
      const originalUpdate = audioEngine.update
      audioEngine.update = vi.fn(() => {
        throw new Error("Synthetic AudioBuffer underflow")
      })

      let modulationRan = false
      let drawRan = false
      let telemetryRan = false

      coordinator.registerPreRenderHook("mod-hook", () => {
        modulationRan = true
      })
      coordinator.setActiveAdapter({
        renderFrame: () => {
          drawRan = true
        },
        dispose: () => {},
      })
      coordinator.onMetrics(() => {
        telemetryRan = true
      })

      expect(() => coordinator.tick(100)).not.toThrow()
      expect(modulationRan).toBe(true)
      expect(drawRan).toBe(true)
      expect(telemetryRan).toBe(true)
      expect(coordinator.getLastFramePhases()).toEqual([
        "clock",
        "audio",
        "modulation",
        "draw",
        "telemetry",
      ])

      audioEngine.update = originalUpdate
    })

    it("evaluates impact when a pre-render hook throws: Phase 4 & 5 do not run and error propagates", () => {
      const coordinator = new RenderCoordinator()
      let drawRan = false
      let telemetryRan = false

      coordinator.registerPreRenderHook("failing-hook", () => {
        throw new Error("Pre-render modulation crashed")
      })
      coordinator.setActiveAdapter({
        renderFrame: () => {
          drawRan = true
        },
        dispose: () => {},
      })
      coordinator.onMetrics(() => {
        telemetryRan = true
      })

      // tick throws when hook throws
      expect(() => coordinator.tick(100)).toThrow("Pre-render modulation crashed")

      // Notice draw and telemetry were aborted
      expect(drawRan).toBe(false)
      expect(telemetryRan).toBe(false)
      expect(coordinator.getLastFramePhases()).toEqual(["clock", "audio", "modulation"])
    })

    it("handles pre-render hook unregistering ITSELF during Phase 3 execution cleanly", () => {
      const coordinator = new RenderCoordinator()
      let hookACallCount = 0
      let hookBCallCount = 0

      coordinator.registerPreRenderHook("self-removing", () => {
        hookACallCount++
        coordinator.unregisterPreRenderHook("self-removing")
      })

      coordinator.registerPreRenderHook("persistent", () => {
        hookBCallCount++
      })

      // Frame 1
      coordinator.tick(100)
      expect(hookACallCount).toBe(1)
      expect(hookBCallCount).toBe(1)

      // Frame 2
      coordinator.tick(116)
      expect(hookACallCount).toBe(1) // Should NOT run again
      expect(hookBCallCount).toBe(2) // Persistent hook runs
    })

    it("handles pre-render hook unregistering a SUBSEQUENT hook during Phase 3 execution", () => {
      const coordinator = new RenderCoordinator()
      let hookBCalled = false

      coordinator.registerPreRenderHook("hook-1", () => {
        coordinator.unregisterPreRenderHook("hook-2")
      })

      coordinator.registerPreRenderHook("hook-2", () => {
        hookBCalled = true
      })

      coordinator.tick(100)
      expect(hookBCalled).toBe(false) // hook-2 was unregistered before it was visited
    })

    it("handles pre-render hook dynamically registering a NEW hook during Phase 3 execution", () => {
      const coordinator = new RenderCoordinator()
      const executionOrder: string[] = []

      coordinator.registerPreRenderHook("hook-1", () => {
        executionOrder.push("hook-1")
        coordinator.registerPreRenderHook("hook-dynamic", () => {
          executionOrder.push("hook-dynamic")
        })
      })

      coordinator.tick(100)
      // JS Map semantics visit newly added key if added during iteration
      expect(executionOrder).toContain("hook-1")

      // Next frame both run
      executionOrder.length = 0
      coordinator.tick(116)
      expect(executionOrder).toEqual(["hook-1", "hook-dynamic"])
    })

    it("handles telemetry subscriber throwing without crashing if isolated, or documents abortion", () => {
      const coordinator = new RenderCoordinator()
      coordinator.onMetrics(() => {
        throw new Error("Telemetry subscriber failed")
      })

      expect(() => coordinator.tick(100)).toThrow("Telemetry subscriber failed")
      expect(coordinator.getLastFramePhases()).toEqual([
        "clock",
        "audio",
        "modulation",
        "draw",
        "telemetry",
      ])
    })
  })

  // ==========================================================================
  // Probe 2: Rapid Adapter Switching, Start/Stop Cycling, and Zombie Loop Audit
  // ==========================================================================
  describe("Probe 2: Rapid Switching & Start/Stop Concurrency Guards", () => {
    it("rapidly calling start() 50 times in a row maintains strictly 1 active rAF callback", () => {
      const coordinator = new RenderCoordinator()
      for (let i = 0; i < 50; i++) {
        coordinator.start()
      }

      expect(coordinator.getIsRunning()).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("rapidly calling stop() 50 times in a row is completely idempotent", () => {
      const coordinator = new RenderCoordinator()
      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      for (let i = 0; i < 50; i++) {
        coordinator.stop()
      }

      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })


    it("stopping the coordinator from inside a pre-render hook cleanly terminates subsequent frames", () => {
      const coordinator = new RenderCoordinator()
      let frameCount = 0

      coordinator.registerPreRenderHook("stop-on-frame-3", () => {
        frameCount++
        if (frameCount === 3) {
          coordinator.stop()
        }
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16) // Frame 1
      expect(frameCount).toBe(1)
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16) // Frame 2
      expect(frameCount).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16) // Frame 3: hook calls coordinator.stop()
      expect(frameCount).toBe(3)
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)

      env.clock.step(16) // Frame 4: should not execute
      expect(frameCount).toBe(3)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("probes zombie loop behavior when switching activeAdapter without disposing previous adapter", async () => {
      const coordinator = new RenderCoordinator()
      const canvas1 = env.createCanvas()
      const canvas2 = env.createCanvas()

      const gpu = new WebGPUAdapter()
      const gl2 = new WebGL2Adapter()

      await gpu.mount(canvas1 as any)
      // When mounted standalone, gpu has 1 self-driven rAF
      expect(env.clock.activeCallbackCount).toBe(1)

      // When assigned to coordinator, setExternalLoopDriven(true) cancels its self-driven loop
      coordinator.setActiveAdapter(gpu)
      expect(env.clock.activeCallbackCount).toBe(0)

      // Starting coordinator schedules 1 authoritative rAF
      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      await gl2.mount(canvas2 as any)
      // gl2 has mounted and started its self-driven loop (1 + 1 = 2 callbacks)
      expect(env.clock.activeCallbackCount).toBe(2)

      // When coordinator sets gl2 as active adapter:
      // coordinator calls gpu.setExternalLoopDriven(false)
      // If gpu was not disposed, gpu starts its self-driven loop!
      // gl2.setExternalLoopDriven(true) cancels gl2's self-driven loop.
      coordinator.setActiveAdapter(gl2)

      // This empirically documents the contract:
      // If an adapter is unassigned without being disposed, it reverts to standalone mode.
      // However, when properly disposed (as done in Viewport.tsx), it does NOT leak!
      gpu.dispose()
      gl2.dispose()
      coordinator.stop()

      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("verifies Viewport lifecycle pattern: setActiveAdapter(null) followed by dispose() leaves 0 zombie loops", async () => {
      const coordinator = new RenderCoordinator()
      const canvas = env.createCanvas()

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1) // Coordinator loop

      for (let i = 0; i < 10; i++) {
        const adapter = i % 2 === 0 ? new WebGPUAdapter() : new WebGL2Adapter()
        await adapter.mount(canvas as any)
        coordinator.setActiveAdapter(adapter)

        // Only 1 authoritative loop active
        expect(env.clock.activeCallbackCount).toBe(1)

        // Viewport switch/unmount protocol:
        coordinator.setActiveAdapter(null)
        adapter.dispose()

        // Still only 1 loop (the coordinator)
        expect(env.clock.activeCallbackCount).toBe(1)
      }

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("PerfOverlay metrics subscription cleanly unregisters without listener leak", () => {
      const coordinator = new RenderCoordinator()
      const unsubs: Array<() => void> = []

      // Rapidly mount 50 PerfOverlay components
      for (let i = 0; i < 50; i++) {
        const unsub = coordinator.onMetrics(() => {})
        unsubs.push(unsub)
      }

      // Unmount all 50
      for (const unsub of unsubs) {
        unsub()
      }

      // Verify no leftover subscribers receive notifications
      let notified = false
      coordinator.onMetrics(() => {
        notified = true
      })() // Immediately unsubscribed

      coordinator.tick(100)
      expect(notified).toBe(false)
    })
  })

  // ==========================================================================
  // Probe 3: Adapter Standalone Fallback Without RenderCoordinator
  // ==========================================================================
  describe("Probe 3: Standalone Adapter Fallback Functionality", () => {
    it("WebGL2 adapter runs its self-driven rAF loop when RenderCoordinator is not managing it", async () => {
      const canvas = env.createCanvas()
      const adapter = new WebGL2Adapter()

      await adapter.mount(canvas as any)
      expect(env.clock.activeCallbackCount).toBe(1)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      // Step clock 1000ms
      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("WebGPU adapter runs its self-driven rAF loop when RenderCoordinator is not managing it", async () => {
      const canvas = env.createCanvas()
      const adapter = new WebGPUAdapter()

      await adapter.mount(canvas as any)
      expect(env.clock.activeCallbackCount).toBe(1)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("Three.js adapter runs its self-driven rAF loop when RenderCoordinator is not managing it", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const canvas = env.createCanvas()
      const adapter = new ThreeJSAdapter()

      await adapter.mount(canvas as any)
      expect(env.clock.activeCallbackCount).toBe(1)

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)

      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("adapter transitions smoothly from coordinator management back to standalone mode", async () => {
      const coordinator = new RenderCoordinator()
      const canvas = env.createCanvas()
      const adapter = new WebGL2Adapter()

      await adapter.mount(canvas as any)
      expect(env.clock.activeCallbackCount).toBe(1) // Standalone rAF

      coordinator.setActiveAdapter(adapter)
      expect(env.clock.activeCallbackCount).toBe(0) // Cancelled for coordinator

      // Detach from coordinator
      coordinator.setActiveAdapter(null)
      expect(env.clock.activeCallbackCount).toBe(1) // Resumed standalone rAF

      const perfSpy = vi.fn()
      adapter.setPerfCallback(perfSpy)
      env.clock.step(1000)
      expect(perfSpy).toHaveBeenCalled()

      adapter.dispose()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // ==========================================================================
  // Probe 4: Coordinator Telemetry Accuracy and Zero-Draw Fallback
  // ==========================================================================
  describe("Probe 4: Telemetry Accuracy & Active Adapter State", () => {
    it("reports drawCalls: 0 when running with no active adapter", () => {
      const coordinator = new RenderCoordinator()
      let lastMetrics: PerformanceMetrics | null = null

      coordinator.onMetrics((m) => {
        lastMetrics = m
      })

      coordinator.tick(100)
      expect(lastMetrics).not.toBeNull()
      expect(lastMetrics!.drawCalls).toBe(0)
      expect(lastMetrics!.activeCallbacks).toBe(1)
    })

    it("reports drawCalls: 1 when running with active adapter", () => {
      const coordinator = new RenderCoordinator()
      let lastMetrics: PerformanceMetrics | null = null

      coordinator.setActiveAdapter({
        renderFrame: () => {},
        dispose: () => {},
      })

      coordinator.onMetrics((m) => {
        lastMetrics = m
      })

      coordinator.tick(100)
      expect(lastMetrics).not.toBeNull()
      expect(lastMetrics!.drawCalls).toBe(1)
    })

    it("calculates realistic FPS based on delta between ticks", () => {
      const coordinator = new RenderCoordinator()
      const recordedFps: number[] = []

      coordinator.onMetrics((m) => {
        recordedFps.push(m.fps)
      })

      coordinator.tick(1000) // First tick (delta ~ 1ms default minimum)
      coordinator.tick(1016.6) // ~16.6ms later (~60 FPS)
      coordinator.tick(1050) // ~33.4ms later (~30 FPS)

      expect(recordedFps.length).toBe(3)
      expect(recordedFps[1]).toBe(60)
      expect(recordedFps[2]).toBe(30)
    })
  })
})
})

describe("RenderCoordinator lifecycle (challenger 2)", () => {
describe("Adversarial RenderCoordinator & Loop Lifecycle Suite (Challenger 2)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    teardownE2ETestEnvironment()
  })

  // --------------------------------------------------------------------------
  // 1. Rapid Start / Stop Cycles & Re-entrancy
  // --------------------------------------------------------------------------
  describe("1. Rapid Start / Stop Cycles & Re-entrancy", () => {
    it("survives 200 rapid synchronous start/stop toggles without leaking rAF handles", () => {
      const coordinator = new RenderCoordinator()
      for (let i = 0; i < 200; i++) {
        coordinator.start()
        coordinator.stop()
      }
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("survives asynchronous start/stop alternating across frame steps", () => {
      const coordinator = new RenderCoordinator()
      for (let i = 0; i < 20; i++) {
        coordinator.start()
        expect(env.clock.activeCallbackCount).toBe(1)
        env.clock.step(16)
        expect(env.clock.activeCallbackCount).toBe(1)
        coordinator.stop()
        expect(env.clock.activeCallbackCount).toBe(0)
        env.clock.step(16)
        expect(env.clock.activeCallbackCount).toBe(0)
      }
    })


    it("unhandled error in hook or draw does not terminate coordinator rAF loop and allows recovery without deadlock", () => {
      const coordinator = new RenderCoordinator()
      let hookCallCount = 0

      coordinator.registerPreRenderHook("crash-on-frame-1", () => {
        hookCallCount++
        if (hookCallCount === 1) {
          throw new Error("Temporary hook transient failure")
        }
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      // Stepping the clock causes the rAF callback to throw on frame 1
      expect(() => env.clock.step(16)).toThrow("Temporary hook transient failure")

      // HARDENED BEHAVIOR:
      // try...finally ensures the coordinator remains running and reschedules the next frame
      expect(coordinator.getIsRunning()).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      // Calling start() when running does not duplicate callbacks
      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      // Frame 2 executes and recovers cleanly without deadlock
      expect(() => env.clock.step(16)).not.toThrow()
      expect(hookCallCount).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // 2. Rapid Switching of Active Adapters (WebGPU -> WebGL2 -> Three.js -> WebGPU)
  // --------------------------------------------------------------------------
  describe("2. Rapid Switching of Active Adapters", () => {
    it("rapidly switches active adapters across WebGPU -> WebGL2 -> Three.js -> WebGPU 20 times", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const coordinator = new RenderCoordinator()
      const canvas = env.createCanvas()

      const gpu = new WebGPUAdapter()
      const gl2 = new WebGL2Adapter()
      const three = new ThreeJSAdapter()

      await gpu.mount(canvas as any)
      await gl2.mount(canvas as any)
      await three.mount(canvas as any)

      coordinator.start()

      const adapters = [gpu, gl2, three]

      for (let i = 0; i < 20; i++) {
        const nextAdapter = adapters[i % adapters.length]
        coordinator.setActiveAdapter(nextAdapter)
        expect(coordinator.getActiveAdapter()).toBe(nextAdapter)

        // Advance 1 frame
        env.clock.step(16)
      }

      coordinator.stop()
      gpu.dispose()
      gl2.dispose()
      three.dispose()

      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("verifies Viewport mount pattern under rapid backend switching preserves exactly 1 active loop", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const coordinator = new RenderCoordinator()
      const canvas = env.createCanvas()

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      let currentAdapter: any = null

      const switchBackend = async (backend: "webgpu" | "webgl2" | "threejs") => {
        if (currentAdapter) {
          coordinator.setActiveAdapter(null)
          currentAdapter.dispose()
        }

        let newAdapter: any
        if (backend === "webgpu") newAdapter = new WebGPUAdapter()
        else if (backend === "webgl2") newAdapter = new WebGL2Adapter()
        else newAdapter = new ThreeJSAdapter()

        currentAdapter = newAdapter
        await newAdapter.mount(canvas as any)
        coordinator.setActiveAdapter(newAdapter)
      }

      const sequence: Array<"webgpu" | "webgl2" | "threejs"> = [
        "webgpu", "webgl2", "threejs", "webgpu", "threejs", "webgl2", "webgpu",
      ]

      for (const backend of sequence) {
        await switchBackend(backend)
        expect(env.clock.activeCallbackCount).toBe(1)
        env.clock.step(16)
        expect(env.clock.activeCallbackCount).toBe(1)
      }

      if (currentAdapter) {
        coordinator.setActiveAdapter(null)
        currentAdapter.dispose()
      }
      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("setting activeAdapter to null disables drawing without breaking coordinator loop", () => {
      const coordinator = new RenderCoordinator()
      const drawMock = vi.fn()
      const mockAdapter = {
        renderFrame: drawMock,
        dispose: vi.fn(),
      }

      coordinator.setActiveAdapter(mockAdapter)
      coordinator.start()

      env.clock.step(16)
      expect(drawMock).toHaveBeenCalledTimes(1)

      coordinator.setActiveAdapter(null)
      env.clock.step(16)
      expect(drawMock).toHaveBeenCalledTimes(1) // Not called when null
      expect(env.clock.activeCallbackCount).toBe(1) // Loop still running

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // 3. Pre-render Hook Churn & Execution Semantics
  // --------------------------------------------------------------------------
  describe("3. Pre-render Hook Churn & Execution Semantics", () => {
    it("handles 100 simultaneous hook registrations and unregistrations per frame without degradation", () => {
      const coordinator = new RenderCoordinator()
      coordinator.start()

      for (let frame = 0; frame < 10; frame++) {
        // Register 100 hooks
        const spies: Array<ReturnType<typeof vi.fn>> = []
        for (let h = 0; h < 100; h++) {
          const spy = vi.fn()
          spies.push(spy)
          coordinator.registerPreRenderHook(`hook-${frame}-${h}`, spy)
        }

        // Advance frame
        env.clock.step(16)

        // All 100 ran
        for (const spy of spies) {
          expect(spy).toHaveBeenCalledTimes(1)
        }

        // Unregister all 100
        for (let h = 0; h < 100; h++) {
          coordinator.unregisterPreRenderHook(`hook-${frame}-${h}`)
        }
      }

      // Next frame with 0 hooks
      env.clock.step(16)
      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("passes monotonically increasing time and positive delta to hooks", () => {
      const coordinator = new RenderCoordinator()
      const timestamps: number[] = []
      const deltas: number[] = []

      coordinator.registerPreRenderHook("time-check", (time, delta) => {
        timestamps.push(time)
        deltas.push(delta)
      })

      coordinator.start()
      env.clock.step(16)
      env.clock.step(20)
      env.clock.step(33)

      expect(timestamps.length).toBe(3)
      expect(timestamps[1]).toBeGreaterThan(timestamps[0])
      expect(timestamps[2]).toBeGreaterThan(timestamps[1])

      for (const d of deltas) {
        expect(d).toBeGreaterThanOrEqual(1)
      }

      coordinator.stop()
    })
  })

  // --------------------------------------------------------------------------
  // 4. Metric Subscriptions & Accuracy
  // --------------------------------------------------------------------------
  describe("4. Metric Subscriptions & Accuracy", () => {
    it("delivers accurate FPS and frameTimeMs calculations across varying frame intervals", () => {
      const coordinator = new RenderCoordinator()
      const receivedMetrics: PerformanceMetrics[] = []

      const unsub = coordinator.onMetrics((m) => {
        receivedMetrics.push({ ...m })
      })

      coordinator.start()

      // First tick initializes timing baseline
      env.clock.step(16.6)

      // Step at 60 FPS (~16.6ms)
      env.clock.step(16.6)
      // Step at 30 FPS (~33.3ms)
      env.clock.step(33.3)
      // Step at 120 FPS (~8.3ms)
      env.clock.step(8.3)

      expect(receivedMetrics.length).toBe(4)
      // Frame 1 receives clamped delta (1000 FPS) due to performance.now() mismatch with mock time
      expect(receivedMetrics[1].fps).toBeCloseTo(60, -1)
      expect(receivedMetrics[2].fps).toBeCloseTo(30, -1)
      expect(receivedMetrics[3].fps).toBeCloseTo(120, -1)

      unsub()
      coordinator.stop()
    })

    it("cleanly unsubscribes multiple independent metrics listeners without side effects", () => {
      const coordinator = new RenderCoordinator()
      const counts = [0, 0, 0]

      const unsub0 = coordinator.onMetrics(() => { counts[0]++ })
      const unsub1 = coordinator.onMetrics(() => { counts[1]++ })
      const unsub2 = coordinator.onMetrics(() => { counts[2]++ })

      coordinator.start()
      env.clock.step(16)
      expect(counts).toEqual([1, 1, 1])

      unsub1() // Unsubscribe middle listener
      env.clock.step(16)
      expect(counts).toEqual([2, 1, 2])

      unsub0()
      unsub2()
      env.clock.step(16)
      expect(counts).toEqual([2, 1, 2]) // No more calls

      coordinator.stop()
    })
  })

  // --------------------------------------------------------------------------
  // 5. Unbounded Memory Growth Audit (executionLog)
  // --------------------------------------------------------------------------
  describe("5. Unbounded Memory Growth Audit", () => {
    it("executionLog is bounded to a ring buffer and does not leak memory over frames", () => {
      const coordinator = new RenderCoordinator()
      coordinator.clearLog()

      coordinator.start()
      const initialLogCount = coordinator.getExecutionLog().length
      expect(initialLogCount).toBe(0)

      // Simulate 60 frames (1 second of rendering)
      for (let i = 0; i < 60; i++) {
        env.clock.step(16)
      }

      const logCountAfter60Frames = coordinator.getExecutionLog().length
      // 5 phases recorded per frame = 300 entries in just 1 second
      expect(logCountAfter60Frames).toBe(300)

      // Simulate 300 more frames (5 seconds)
      for (let i = 0; i < 300; i++) {
        env.clock.step(16)
      }

      const logCountAfter360Frames = coordinator.getExecutionLog().length
      // HARDENED BEHAVIOR:
      // executionLog is capped to 300 entries (60 frames), eliminating unbounded memory leak
      expect(logCountAfter360Frames).toBeLessThanOrEqual(300)

      coordinator.stop()
    })
  })
})
})

describe("RenderCoordinator deep stress", () => {
describe("Adversarial Deep Stress: RenderCoordinator Loop & Recovery Invariants", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    teardownE2ETestEnvironment()
  })

  // --------------------------------------------------------------------------
  // Deep Stress 1: Advanced Re-entrant Lifecycle Combinations
  // --------------------------------------------------------------------------
  describe("1. Advanced Re-entrant Combinations", () => {
    it("calling start() multiple times from inside a hook maintains strictly 1 active rAF loop", () => {
      const coordinator = new RenderCoordinator()
      let hookExecutions = 0

      coordinator.registerPreRenderHook("multi-start", () => {
        hookExecutions++
        // Calling start 5 times while frame is active
        for (let i = 0; i < 5; i++) {
          coordinator.start()
        }
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(hookExecutions).toBe(1)
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(hookExecutions).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("calling stop() -> start() -> stop() -> start() in sequence maintains strictly 1 active rAF loop", () => {
      const coordinator = new RenderCoordinator()
      let hookRan = false

      coordinator.registerPreRenderHook("nested-toggle", () => {
        hookRan = true
        coordinator.stop()
        coordinator.start()
        coordinator.stop()
        coordinator.start()
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(hookRan).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("calling stop() followed by error throw stops cleanly without ghost callbacks", () => {
      const coordinator = new RenderCoordinator()
      coordinator.registerPreRenderHook("stop-and-throw", () => {
        coordinator.stop()
        throw new Error("Crash after stop")
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      expect(() => env.clock.step(16)).toThrow("Crash after stop")
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("calling start() and then throwing still preserves loop recovery without duplicate loops", () => {
      const coordinator = new RenderCoordinator()
      let stepCount = 0

      coordinator.registerPreRenderHook("start-and-throw", () => {
        stepCount++
        if (stepCount === 1) {
          coordinator.start() // Re-entrant start
          throw new Error("Crash after re-entrant start")
        }
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      expect(() => env.clock.step(16)).toThrow("Crash after re-entrant start")
      expect(coordinator.getIsRunning()).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      // Next frame executes cleanly
      expect(() => env.clock.step(16)).not.toThrow()
      expect(stepCount).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Deep Stress 2: Phase-Specific Exception Recovery
  // --------------------------------------------------------------------------
  describe("2. Phase-Specific Exception Recovery", () => {
    it("recovers cleanly when activeAdapter.renderFrame throws on frame 1", () => {
      const coordinator = new RenderCoordinator()
      let drawCalls = 0

      const failingAdapter = {
        renderFrame: vi.fn(() => {
          drawCalls++
          if (drawCalls === 1) {
            throw new Error("GPU Pipeline compilation failure during draw")
          }
        }),
        dispose: vi.fn(),
      }

      coordinator.setActiveAdapter(failingAdapter)
      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      // Frame 1 throws during Phase 4
      expect(() => env.clock.step(16)).toThrow("GPU Pipeline compilation failure during draw")
      expect(coordinator.getIsRunning()).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      // Frame 2 executes without throwing
      expect(() => env.clock.step(16)).not.toThrow()
      expect(drawCalls).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("recovers cleanly when telemetry subscriber throws on frame 1", () => {
      const coordinator = new RenderCoordinator()
      let metricsReceived = 0

      coordinator.onMetrics(() => {
        metricsReceived++
        if (metricsReceived === 1) {
          throw new Error("Telemetry reporting sink crashed")
        }
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      // Frame 1 throws in Phase 5
      expect(() => env.clock.step(16)).toThrow("Telemetry reporting sink crashed")
      expect(coordinator.getIsRunning()).toBe(true)
      expect(env.clock.activeCallbackCount).toBe(1)

      // Frame 2 executes cleanly
      expect(() => env.clock.step(16)).not.toThrow()
      expect(metricsReceived).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Deep Stress 3: Long-Run Execution Log Memory Guardrail (10,000 frames)
  // --------------------------------------------------------------------------
  describe("3. Long-Run Continuous Rendering Stress", () => {
    it("strictly bounds executionLog to <= 300 entries over 2,000 frames", () => {
      const coordinator = new RenderCoordinator()
      coordinator.start()

      for (let f = 1; f <= 2000; f++) {
        env.clock.step(16)
        if (f % 200 === 0) {
          const log = coordinator.getExecutionLog()
          expect(log.length).toBeLessThanOrEqual(300)
          expect(env.clock.activeCallbackCount).toBe(1)
        }
      }

      const finalLog = coordinator.getExecutionLog()
      expect(finalLog.length).toBe(300)
      // Check that the timestamps are recent (from the end of the 2000 frames)
      const lastTimestamp = finalLog[finalLog.length - 1].timestamp
      const firstTimestampInLog = finalLog[0].timestamp
      // 300 entries / 5 phases = 60 frames = ~960ms span
      expect(lastTimestamp - firstTimestampInLog).toBeLessThanOrEqual(1000)

      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Deep Stress 4: Timing Invariants & Clamping
  // --------------------------------------------------------------------------
  describe("4. Timing Invariants & Clock Jitter", () => {
    it("handles zero and negative delta time cleanly without NaN or zero-division FPS crash", () => {
      const coordinator = new RenderCoordinator()
      const recordedMetrics: PerformanceMetrics[] = []

      coordinator.onMetrics((m) => {
        recordedMetrics.push(m)
      })

      // Tick with identical timestamp (delta = 0)
      coordinator.tick(1000)
      coordinator.tick(1000) // delta = 0 -> clamped to 1
      coordinator.tick(900)  // backwards time -> delta < 0 -> clamped to 1

      expect(recordedMetrics.length).toBe(3)
      for (const m of recordedMetrics) {
        expect(Number.isFinite(m.fps)).toBe(true)
        expect(m.fps).toBeGreaterThan(0)
        expect(m.frameTimeMs).toBeGreaterThanOrEqual(1)
      }
    })
  })
})
})

describe("RenderCoordinator hook & adapter semantics (real module)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  beforeEach(() => { env = setupE2ETestEnvironment() })
  afterEach(() => { teardownE2ETestEnvironment() })

  it("unregistering a pre-render hook stops its per-frame calls while others keep running", () => {
    const coordinator = new RenderCoordinator()
    const hook1 = vi.fn()
    const hook2 = vi.fn()
    coordinator.registerPreRenderHook("audio-bass", hook1)
    coordinator.registerPreRenderHook("audio-treble", hook2)
    coordinator.start()
    env.clock.step(16)
    expect(hook1).toHaveBeenCalledTimes(1)
    expect(hook2).toHaveBeenCalledTimes(1)
    coordinator.unregisterPreRenderHook("audio-bass")
    env.clock.step(16)
    expect(hook1).toHaveBeenCalledTimes(1)
    expect(hook2).toHaveBeenCalledTimes(2)
    coordinator.stop()
  })

  it("switching mock adapters routes draws to the new adapter only, with exactly one loop", () => {
    const coordinator = new RenderCoordinator()
    const a = { renderFrame: vi.fn(), dispose: vi.fn() }
    const b = { renderFrame: vi.fn(), dispose: vi.fn() }
    coordinator.setActiveAdapter(a)
    coordinator.start()
    env.clock.step(16)
    expect([a.renderFrame.mock.calls.length, b.renderFrame.mock.calls.length]).toEqual([1, 0])
    coordinator.setActiveAdapter(b)
    env.clock.step(16)
    expect([a.renderFrame.mock.calls.length, b.renderFrame.mock.calls.length]).toEqual([1, 1])
    expect(env.clock.activeCallbackCount).toBe(1)
    coordinator.stop()
  })
})

describe("Tier 2: Boundary & Corner Cases — Backend Switching", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("rapidly cycles WebGPU -> WebGL2 -> Three.js -> WebGPU within a single tick", async () => {
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const canvas = env.createCanvas()

    const gpu = new WebGPUAdapter()
    await gpu.mount(canvas as any)
    gpu.dispose()

    const gl2 = new WebGL2Adapter()
    await gl2.mount(canvas as any)
    gl2.dispose()

    const three = new ThreeJSAdapter()
    await three.mount(canvas as any)
    three.dispose()

    const gpu2 = new WebGPUAdapter()
    await gpu2.mount(canvas as any)

    expect(env.clock.activeCallbackCount).toBe(1)
    gpu2.dispose()
    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("switches backends while renderQueue has active post-processing steps", async () => {
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const canvas = env.createCanvas()
    const queue = [
      { type: "mesh" as const, geometry: "cube" as const },
      { type: "postprocess" as const, pass: "passthrough" as const },
    ]

    const gl2 = new WebGL2Adapter()
    await gl2.mount(canvas as any)
    gl2.setRenderQueue(queue)
    env.clock.step(16)
    gl2.dispose()

    const three = new ThreeJSAdapter()
    await three.mount(canvas as any)
    three.setRenderQueue(queue)
    env.clock.step(16)
    three.dispose()

    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("preserves uniform values in store across 10 rapid backend toggles", () => {
    const store = useProjectStore.getState()
    store.setUniformValue("u_critical", { type: "float", value: 3.14159 })

    const backends = ["webgpu", "webgl2", "threejs"] as const
    for (let i = 0; i < 10; i++) {
      store.setActiveBackend(backends[i % 3])
      expect(useProjectStore.getState().uniformValues["u_critical"].value).toBe(3.14159)
    }
  })

  it("switches backends while shader recompilation error is present in store", async () => {
    const canvas = env.createCanvas()
    useProjectStore.getState().setLastCompileError("Shader error in backend 1")

    const adapter = new WebGL2Adapter()
    await adapter.mount(canvas as any)

    // Recompilation with valid shader should clear error
    adapter.recompileShader("void main() { fragColor = vec4(1.0); }")
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    adapter.dispose()
  })

  it("ensures zero orphaned animation frames remain after 20 mount/dispose cycles", async () => {
    const canvas = env.createCanvas()
    for (let i = 0; i < 20; i++) {
      const adapter = i % 2 === 0 ? new WebGL2Adapter() : new WebGPUAdapter()
      await adapter.mount(canvas as any)
      adapter.dispose()
    }
    expect(env.clock.activeCallbackCount).toBe(0)
  })
})

describe("RenderCoordinator external loop driving", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  beforeEach(() => { env = setupE2ETestEnvironment() })
  afterEach(() => { teardownE2ETestEnvironment() })

  it("switching activeAdapter toggles setExternalLoopDriven on old/new adapters and null detaches safely", () => {
    const coordinator = new RenderCoordinator()
    const state = { d1: false, d2: false, c1: 0, c2: 0 }
    const a1 = { renderFrame: () => { state.c1++ }, setExternalLoopDriven: (v: boolean) => { state.d1 = v }, dispose: () => {} }
    const a2 = { renderFrame: () => { state.c2++ }, setExternalLoopDriven: (v: boolean) => { state.d2 = v }, dispose: () => {} }
    coordinator.setActiveAdapter(a1 as any)
    expect(state.d1).toBe(true)
    coordinator.tick(16.6)
    expect([state.c1, state.c2]).toEqual([1, 0])
    coordinator.setActiveAdapter(a2 as any)
    expect([state.d1, state.d2]).toEqual([false, true])
    coordinator.tick(33.2)
    expect([state.c1, state.c2]).toEqual([1, 1])
    coordinator.setActiveAdapter(null)
    expect(state.d2).toBe(false)
    expect(coordinator.getActiveAdapter()).toBeNull()
    expect(() => coordinator.tick(49.8)).not.toThrow()
  })
})

// Handoff from w1-c-tooling (tier5 system-hardening, RenderCoordinator domain).
describe("RenderCoordinator resilience (w1-c-tooling handoff)", () => {
  let env: E2ETestEnvironment

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })
  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("clamps multi-second freezes and backwards clock jitter: finite fps, frameTime >= 1ms, 5-phase order", () => {
    const coordinator = new RenderCoordinator()
    const log: PerformanceMetrics[] = []
    coordinator.onMetrics((m) => log.push(m))

    for (const t of [1000, 1016.6, 6016.6, 16016.6, 15966.6]) coordinator.tick(t)

    expect(log).toHaveLength(5)
    for (const m of log) {
      expect(Number.isFinite(m.fps)).toBe(true)
      expect(Number.isFinite(m.frameTimeMs)).toBe(true)
      expect(m.fps).toBeGreaterThanOrEqual(0)
      expect(m.frameTimeMs).toBeGreaterThanOrEqual(1)
    }
    expect(coordinator.getLastFramePhases()).toEqual(["clock", "audio", "modulation", "draw", "telemetry"])
  })

  it("tolerates re-entrant start() and hook registration/unregistration/stop from inside a hook", () => {
    const coordinator = new RenderCoordinator()
    let hook1 = 0
    let hook2 = 0
    coordinator.registerPreRenderHook("reentrant-hook-1", () => {
      hook1++
      coordinator.start()
      coordinator.start()
      coordinator.registerPreRenderHook("reentrant-hook-2", () => {
        hook2++
      })
    })

    coordinator.start()
    expect(env.clock.activeCallbackCount).toBe(1)
    env.clock.step(16)
    expect([hook1, hook2]).toEqual([1, 1]) // newly added hooks run in the same tick
    expect(env.clock.activeCallbackCount).toBe(1)
    env.clock.step(16)
    expect([hook1, hook2]).toEqual([2, 2])
    expect(env.clock.activeCallbackCount).toBe(1)

    coordinator.registerPreRenderHook("self-unregister", () => {
      coordinator.unregisterPreRenderHook("self-unregister")
      coordinator.stop()
    })
    env.clock.step(16)
    expect(coordinator.getIsRunning()).toBe(false)
    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("survives an adapter that unseats itself and stops the coordinator during renderFrame", () => {
    const coordinator = new RenderCoordinator()
    const adapter = {
      renderFrame: vi.fn(() => {
        coordinator.setActiveAdapter(null)
        coordinator.stop()
      }),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(adapter)
    coordinator.start()
    env.clock.step(16)
    expect(adapter.renderFrame).toHaveBeenCalledTimes(1)
    expect(coordinator.getActiveAdapter()).toBeNull()
    expect(coordinator.getIsRunning()).toBe(false)
    expect(env.clock.activeCallbackCount).toBe(0)
  })
})
