import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  RenderCoordinatorHarness,
  type FramePhase,
  type PerformanceMetrics,
  type RenderAdapterContract,
} from "../mocks/gen2Harness"

describe("Tier 1: Feature Coverage — Unified RenderCoordinator", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let coordinator: RenderCoordinatorHarness

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    coordinator = new RenderCoordinatorHarness()
  })

  afterEach(() => {
    coordinator.stop()
    teardownE2ETestEnvironment()
  })

  it("maintains a single authoritative requestAnimationFrame loop when running", () => {
    coordinator.start()
    expect(coordinator.getIsRunning()).toBe(true)

    // Verify exactly 1 rAF callback registered in clock
    expect(env.clock.activeCallbackCount).toBe(1)

    // Step clock forward by 16ms frames
    env.clock.step(16)
    expect(env.clock.activeCallbackCount).toBe(1)

    env.clock.step(16)
    expect(env.clock.activeCallbackCount).toBe(1)

    coordinator.stop()
    expect(coordinator.getIsRunning()).toBe(false)
    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("executes strict 5-phase frame cycle in authoritative order (Clock -> Audio -> Mod -> Draw -> Telemetry)", () => {
    const expectedOrder: FramePhase[] = ["clock", "audio", "modulation", "draw", "telemetry"]

    const mockAdapter: RenderAdapterContract = {
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(mockAdapter)

    coordinator.start()
    env.clock.step(16)

    const executedPhases = coordinator.getLastFramePhases()
    expect(executedPhases).toEqual(expectedOrder)
    expect(mockAdapter.renderFrame).toHaveBeenCalledTimes(1)
  })

  it("registers and unregisters pre-render hooks for audio parameter modulation", () => {
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

    expect(hook1).toHaveBeenCalledTimes(1) // Not called again
    expect(hook2).toHaveBeenCalledTimes(2) // Called for second frame
  })

  it("switches active adapters seamlessly without creating duplicate or orphaned rAF loops", () => {
    const webgpuMock: RenderAdapterContract = { renderFrame: vi.fn(), dispose: vi.fn() }
    const webgl2Mock: RenderAdapterContract = { renderFrame: vi.fn(), dispose: vi.fn() }

    coordinator.setActiveAdapter(webgpuMock)
    coordinator.start()

    env.clock.step(16)
    expect(webgpuMock.renderFrame).toHaveBeenCalledTimes(1)
    expect(webgl2Mock.renderFrame).toHaveBeenCalledTimes(0)
    expect(env.clock.activeCallbackCount).toBe(1)

    // Switch to WebGL2 adapter
    coordinator.setActiveAdapter(webgl2Mock)
    env.clock.step(16)

    expect(webgpuMock.renderFrame).toHaveBeenCalledTimes(1)
    expect(webgl2Mock.renderFrame).toHaveBeenCalledTimes(1)
    expect(env.clock.activeCallbackCount).toBe(1) // Still exactly 1 loop
  })

  it("notifies performance telemetry subscribers with accurate FPS and frame metrics", () => {
    const telemetryEvents: PerformanceMetrics[] = []
    const unsubscribe = coordinator.onMetrics((metrics) => {
      telemetryEvents.push(metrics)
    })

    coordinator.start()
    env.clock.step(16)
    env.clock.step(16)

    expect(telemetryEvents.length).toBe(2)
    expect(telemetryEvents[0].fps).toBeGreaterThan(0)
    expect(telemetryEvents[0].frameTimeMs).toBeGreaterThan(0)
    expect(telemetryEvents[0].activeCallbacks).toBe(1)

    unsubscribe()
    env.clock.step(16)
    expect(telemetryEvents.length).toBe(2) // No new notifications after unsubscribe
  })
})
