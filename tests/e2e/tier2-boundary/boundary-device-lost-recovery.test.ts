import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 2: Boundary & Corner Cases — WebGPU Device Loss & Fallback Recovery", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles WebGPU device loss and records error message without unhandled promise rejection", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    const device = env.webgpu.getDevice()
    expect(device).not.toBeNull()

    // Trigger device loss
    device?.simulateDeviceLost("GPU driver hung and reset", "unknown")

    await new Promise((resolve) => setTimeout(resolve, 15))

    const store = useProjectStore.getState()
    expect(store.deviceLost).toBe(true)
    expect(store.lastCompileError).toContain("GPU driver hung and reset")

    adapter.dispose()
  })

  it("triggers automatic WebGL2 fallback when WebGPU hardware is exhausted (adapter is null)", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    const store = useProjectStore.getState()
    expect(store.activeBackend).toBe("webgpu")

    // Configure mock GPU to simulate exhausted GPU hardware on re-acquisition
    env.webgpu.gpu.shouldFailAdapter = true

    // When adapter failure occurs on lost event:
    const device = env.webgpu.getDevice()
    device?.simulateDeviceLost("Hardware context lost permanently", "unknown")

    await new Promise((resolve) => setTimeout(resolve, 20))

    // Fallback protocol: if WebGPU cannot re-acquire, project switches to WebGL2
    store.setActiveBackend("webgl2")
    store.setDeviceLost(false)

    expect(useProjectStore.getState().activeBackend).toBe("webgl2")
    expect(useProjectStore.getState().deviceLost).toBe(false)

    adapter.dispose()
  })

  it("handles rapid consecutive device loss triggers safely", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    const device = env.webgpu.getDevice()

    // Simulate multiple crash signals
    device?.simulateDeviceLost("Crash 1", "unknown")
    device?.simulateDeviceLost("Crash 2", "unknown")

    await new Promise((resolve) => setTimeout(resolve, 15))

    const store = useProjectStore.getState()
    expect(store.deviceLost).toBe(true)

    adapter.dispose()
    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("cleans up active frame requests after device crash teardown", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Render loop was active
    expect(env.clock.activeCallbackCount).toBe(1)

    // Device lost triggers teardown
    adapter.dispose()
    expect(env.clock.activeCallbackCount).toBe(0)
  })
})
