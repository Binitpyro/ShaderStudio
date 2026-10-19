import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { RenderCoordinator, renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { audioEngine } from "@/audio/audioEngine"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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

    it("rapidly toggling start() and stop() 100 times leaves 0 leaked rAF callbacks", () => {
      const coordinator = new RenderCoordinator()
      for (let i = 0; i < 100; i++) {
        coordinator.start()
        coordinator.stop()
      }

      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)
      coordinator.stop()
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
