import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { MockGPUDevice, MockGPUBuffer, MockGPUTexture } from "./e2e/mocks/mockWebGPU"
import { useProjectStore } from "@/stores/projectStore"
import { WebGPUAdapter } from "@/adapters/webgpu"

describe("Milestone 3 Adversarial Challenger 2: WebGPU Device Loss, Auto-Recovery & Fallback Stress", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().setActiveBackend("webgpu")
    useProjectStore.getState().setDeviceLost(false)
    useProjectStore.getState().setLastCompileError(null)
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Phase 1 Context Re-acquisition & Dead Handle Invalidation
  // ==========================================================================
  describe("Phase 1: Context Re-acquisition & Resource Invalidation", () => {
    it("reflects deviceLost === true during backoff and restores deviceLost === false upon successful remount", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 25
      const canvas = env.createCanvas()
      const mounted = await adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const oldDevice = env.webgpu.getDevice() as MockGPUDevice
      expect(oldDevice).toBeInstanceOf(MockGPUDevice)

      // Initial clean state
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      // Trigger unexpected TDR crash
      oldDevice.simulateDeviceLost("TDR crash: graphics driver reset", "unknown")

      // Allow microtask to process device.lost promise rejection/resolution
      await new Promise((r) => setTimeout(r, 8))

      // Intermediate verification: during backoff interval
      const storeDuringCrash = useProjectStore.getState()
      expect(storeDuringCrash.deviceLost).toBe(true)
      expect(storeDuringCrash.lastCompileError).toContain("Device lost: TDR crash: graphics driver reset")
      expect((adapter as any).isRecovering).toBe(true)
      expect((adapter as any).initialized).toBe(false)

      // Wait for backoff (25ms) + remount execution
      await new Promise((r) => setTimeout(r, 50))

      // Post-recovery verification
      const storeAfterRecovery = useProjectStore.getState()
      expect(storeAfterRecovery.deviceLost).toBe(false)
      expect(storeAfterRecovery.lastCompileError).toBeNull()
      expect(storeAfterRecovery.activeBackend).toBe("webgpu")

      // Verify adapter is re-initialized and recovery flags cleared
      expect((adapter as any).isRecovering).toBe(false)
      expect((adapter as any).recoveryAttempts).toBe(0)
      expect((adapter as any).initialized).toBe(true)

      // Verify a completely new GPUDevice instance was acquired
      const newDevice = env.webgpu.getDevice() as MockGPUDevice
      expect(newDevice).toBeInstanceOf(MockGPUDevice)
      expect(newDevice).not.toBe(oldDevice)

      adapter.dispose()
    })

    it("guarantees zero dead GPU resource handles (GPUBuffer, GPUTexture) from old device are used on new device", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const oldDevice = env.webgpu.getDevice() as MockGPUDevice
      expect(oldDevice).not.toBeNull()

      // Capture all resources allocated on old device
      const oldBuffers = new Set<MockGPUBuffer>(oldDevice.createdBuffers)
      const oldTextures = new Set<MockGPUTexture>(oldDevice.createdTextures)
      expect(oldBuffers.size).toBeGreaterThan(0)
      expect(oldTextures.size).toBeGreaterThan(0)

      const oldUniformBuffer = (adapter as any).uniformBuffer
      const oldDepthTexture = (adapter as any).depthTexture
      const oldDefaultTexture = (adapter as any).defaultTexture
      const oldVertexBuffers = Array.from(((adapter as any).vertexBuffers as Map<string, MockGPUBuffer>).values())

      expect(oldBuffers.has(oldUniformBuffer)).toBe(true)
      expect(oldTextures.has(oldDepthTexture)).toBe(true)
      expect(oldTextures.has(oldDefaultTexture)).toBe(true)

      // Simulate crash
      oldDevice.simulateDeviceLost("TDR hardware hang", "unknown")
      expect(oldDevice.isDestroyed).toBe(true)

      // Wait for recovery to complete
      await new Promise((r) => setTimeout(r, 45))

      const newDevice = env.webgpu.getDevice() as MockGPUDevice
      expect(newDevice).not.toBe(oldDevice)

      // Verify current handles on adapter
      const currentDevice = (adapter as any).device
      const currentUniformBuffer = (adapter as any).uniformBuffer
      const currentDepthTexture = (adapter as any).depthTexture
      const currentDefaultTexture = (adapter as any).defaultTexture
      const currentVertexBuffers = Array.from(((adapter as any).vertexBuffers as Map<string, MockGPUBuffer>).values())

      // 1. Current device MUST be the new device
      expect(currentDevice).toBe(newDevice)
      expect(currentDevice).not.toBe(oldDevice)

      // 2. Uniform buffer MUST belong to new device, NEVER old device
      expect(oldBuffers.has(currentUniformBuffer)).toBe(false)
      expect(newDevice.createdBuffers.includes(currentUniformBuffer)).toBe(true)

      // 3. Textures MUST belong to new device, NEVER old device
      expect(oldTextures.has(currentDepthTexture)).toBe(false)
      expect(newDevice.createdTextures.includes(currentDepthTexture)).toBe(true)
      expect(oldTextures.has(currentDefaultTexture)).toBe(false)
      expect(newDevice.createdTextures.includes(currentDefaultTexture)).toBe(true)

      // 4. Vertex buffers MUST belong to new device, NEVER old device
      for (const vb of currentVertexBuffers) {
        expect(oldBuffers.has(vb)).toBe(false)
        expect(newDevice.createdBuffers.includes(vb)).toBe(true)
      }

      // 5. Check old handles: they were created on the dead device
      expect(oldUniformBuffer).not.toBe(currentUniformBuffer)
      expect(oldDepthTexture).not.toBe(currentDepthTexture)
      expect(oldDefaultTexture).not.toBe(currentDefaultTexture)

      adapter.dispose()
    })

    it("restores user shader source and render queue configuration after context re-acquisition", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Configure non-default shader and render queue in store
      const customWgsl = `@vertex fn vertex_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f { return vec4f(0.0); }
@fragment fn fragment_main() -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }`

      useProjectStore.getState().setShaderSource(customWgsl)
      useProjectStore.getState().setRenderQueue([
        { type: "mesh", geometry: "sphere" },
      ])

      const oldDevice = env.webgpu.getDevice() as MockGPUDevice
      oldDevice.simulateDeviceLost("TDR GPU timeout", "unknown")

      // Wait for recovery
      await new Promise((r) => setTimeout(r, 45))

      // Check restored state
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect((adapter as any).currentGeometry).toBe("sphere")
      expect((adapter as any).initialized).toBe(true)

      adapter.dispose()
    })
  })

  // ==========================================================================
  // Section 2: Phase 2 Automatic Fallback to WebGL2 on Hardware Exhaustion
  // ==========================================================================
  describe("Phase 2: Bounded Retries & Automatic WebGL2 Fallback", () => {
    it("exhausts bounded recovery attempts (2) and automatically switches to webgl2 when hardware requestAdapter fails", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 10
      adapter.maxRecoveryAttempts = 2
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(useProjectStore.getState().activeBackend).toBe("webgpu")

      // Simulate hardware exhaustion: adapter request fails permanently
      env.webgpu.gpu.shouldFailAdapter = true

      const oldDevice = env.webgpu.getDevice() as MockGPUDevice
      oldDevice.simulateDeviceLost("Permanent GPU ASIC fault", "unknown")

      // Allow recovery cycles (10ms backoff each + microtasks)
      await vi.waitFor(() => {
        expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      }, { timeout: 1000, interval: 10 })

      const store = useProjectStore.getState()
      // Store state must be switched to webgl2, deviceLost cleared, errors cleared
      expect(store.activeBackend).toBe("webgl2")
      expect(store.deviceLost).toBe(false)
      expect(store.lastCompileError).toBeNull()

      // Adapter must be cleanly reset without leaking timers or holding dead devices
      expect((adapter as any).isRecovering).toBe(false)
      expect((adapter as any).recoveryAttempts).toBe(0)
      expect((adapter as any).recoveryTimer).toBeNull()
      expect((adapter as any).device).toBeNull()
      expect((adapter as any).context).toBeNull()
      expect((adapter as any).vertexBuffers.size).toBe(0)

      adapter.dispose()
    })

    it("executes automatic fallback in-memory without requiring full window or page reload", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 10
      adapter.maxRecoveryAttempts = 2
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Set user project state that must NOT be lost during fallback
      useProjectStore.getState().setUniformValue("u_customVal", { type: "float", value: 42.5 })
      const preservedSource = "/* user code preserved */"
      useProjectStore.getState().setShaderSource(preservedSource)

      // Force failure and trigger crash
      env.webgpu.gpu.shouldFailAdapter = true
      const oldDevice = env.webgpu.getDevice() as MockGPUDevice
      oldDevice.simulateDeviceLost("Critical hardware exhaustion", "unknown")

      await vi.waitFor(() => {
        expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      }, { timeout: 1000, interval: 10 })

      const store = useProjectStore.getState()
      expect(store.activeBackend).toBe("webgl2")
      // User data preserved
      expect(store.shaderSource).toBe(preservedSource)
      expect(store.uniformValues.u_customVal.value).toBe(42.5)

      adapter.dispose()
    })
  })

  // ==========================================================================
  // Section 3: Adversarial Edge Cases & Concurrency Stress
  // ==========================================================================
  describe("Adversarial Edge Cases & Concurrency Guards", () => {
    it("handles rapid consecutive simulateDeviceLost calls without runaway concurrent recovery loops", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 20
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice() as MockGPUDevice

      // Rapidly fire multiple device loss signals in the same tick
      device.simulateDeviceLost("Crash 1", "unknown")
      device.simulateDeviceLost("Crash 2", "unknown")
      device.simulateDeviceLost("Crash 3", "unknown")

      await new Promise((r) => setTimeout(r, 8))

      // Exactly one recovery timer should be active, isRecovering = true
      expect((adapter as any).isRecovering).toBe(true)
      expect(useProjectStore.getState().deviceLost).toBe(true)

      // Wait for backoff + remount
      await new Promise((r) => setTimeout(r, 50))

      // Should recover cleanly to a single new device
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect((adapter as any).isRecovering).toBe(false)
      expect((adapter as any).recoveryAttempts).toBe(0)

      adapter.dispose()
    })

    it("cancels recovery timer immediately if dispose() is called during active backoff interval", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 50
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice() as MockGPUDevice
      device.simulateDeviceLost("Crash before unmount", "unknown")

      // Microtask to enter recovery
      await new Promise((r) => setTimeout(r, 5))
      expect((adapter as any).recoveryTimer).not.toBeNull()
      expect((adapter as any).isRecovering).toBe(true)

      // User unmounts component / disposes adapter while recovery timer is ticking
      adapter.dispose()

      expect((adapter as any).recoveryTimer).toBeNull()
      expect((adapter as any).isDisposed).toBe(true)
      expect((adapter as any).isRecovering).toBe(false)

      // Wait past the original 50ms backoff deadline
      await new Promise((r) => setTimeout(r, 70))

      // Verify adapter remained disposed and did NOT resurrect
      expect((adapter as any).device).toBeNull()
      expect((adapter as any).initialized).toBe(false)
    })

    it("ignores intentional device destruction (reason === 'destroyed') and keeps deviceLost === false", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setDeviceLost(false)

      const device = env.webgpu.getDevice() as MockGPUDevice
      // Simulate intentional teardown with "destroyed" reason
      device.simulateDeviceLost("Component unmounted normally", "destroyed")

      await new Promise((r) => setTimeout(r, 10))

      // deviceLost must NOT be flipped to true
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect((adapter as any).isRecovering).toBe(false)
      expect((adapter as any).recoveryTimer).toBeNull()

      adapter.dispose()
    })

    it("correctly treats 'GPU out of memory' errors with default reason 'destroyed' as an unexpected crash", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice() as MockGPUDevice
      // Test mock that emits "GPU out of memory" with reason "destroyed"
      device.simulateDeviceLost("GPU out of memory during buffer allocation", "destroyed")

      await new Promise((r) => setTimeout(r, 5))

      // Must NOT be ignored as intentional — it's an OOM crash!
      expect(useProjectStore.getState().deviceLost).toBe(true)
      expect(useProjectStore.getState().lastCompileError).toContain("GPU out of memory")
      expect((adapter as any).isRecovering).toBe(true)

      // Wait for recovery to complete
      await new Promise((r) => setTimeout(r, 45))
      expect(useProjectStore.getState().deviceLost).toBe(false)

      adapter.dispose()
    })

    it("survives repeated multi-cycle crash/recovery sequences before final fallback", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      adapter.maxRecoveryAttempts = 2
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Cycle 1: Crash & Recover
      let dev = env.webgpu.getDevice() as MockGPUDevice
      dev.simulateDeviceLost("Crash cycle 1", "unknown")
      await new Promise((r) => setTimeout(r, 45))
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect(useProjectStore.getState().activeBackend).toBe("webgpu")

      // Cycle 2: Crash & Recover again
      dev = env.webgpu.getDevice() as MockGPUDevice
      dev.simulateDeviceLost("Crash cycle 2", "unknown")
      await new Promise((r) => setTimeout(r, 45))
      expect(useProjectStore.getState().deviceLost).toBe(false)
      expect(useProjectStore.getState().activeBackend).toBe("webgpu")

      // Cycle 3: Hardware fails -> Fallback to WebGL2
      env.webgpu.gpu.shouldFailAdapter = true
      dev = env.webgpu.getDevice() as MockGPUDevice
      dev.simulateDeviceLost("Terminal crash", "unknown")
      await new Promise((r) => setTimeout(r, 120))

      expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      expect(useProjectStore.getState().deviceLost).toBe(false)

      adapter.dispose()
    })

    it("calling dispose() on already-crashed adapter does not throw when destroying invalid handles", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice() as MockGPUDevice
      device.simulateDeviceLost("TDR crash", "unknown")

      await new Promise((r) => setTimeout(r, 5))

      // Immediate dispose should be completely safe and not throw
      expect(() => adapter.dispose()).not.toThrow()
      expect((adapter as any).isDisposed).toBe(true)
    })
  })
})
