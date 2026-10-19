import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { RenderCoordinator, renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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

    it("calling stop() and then start() inside a pre-render hook preserves strictly 1 active rAF loop", () => {
      const coordinator = new RenderCoordinator()
      let hookRan = false

      coordinator.registerPreRenderHook("reentrant-toggle", () => {
        hookRan = true
        // Re-entrant lifecycle reset during active frame execution
        coordinator.stop()
        coordinator.start()
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      // Step frame: hook executes, stops and restarts coordinator
      env.clock.step(16)
      expect(hookRan).toBe(true)

      const callbackCount = env.clock.activeCallbackCount
      coordinator.stop()

      // HARDENED BEHAVIOR:
      // In RenderCoordinator.scheduleTick(), rafId is reset at callback entry and the finally block
      // checks that rafId === null before rescheduling. Re-entrant start() sets rafId, so finally does
      // not duplicate the loop. Exactly 1 loop is preserved!
      expect(callbackCount).toBe(1)
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
