import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { RenderCoordinator, renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"

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
