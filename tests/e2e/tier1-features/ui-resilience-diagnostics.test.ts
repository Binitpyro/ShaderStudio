import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { MockErrorBoundaryHarness } from "../mocks/gen2Harness"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { useProjectStore } from "@/stores/projectStore"
import { WebGPUAdapter } from "@/adapters/webgpu"

describe("Tier 1: Feature Coverage — UI Resilience, Diagnostics & Auto-Recovery", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. React Error Boundary Isolation & Reset
  // --------------------------------------------------------------------------
  describe("UI Resilience Error Boundary", () => {
    it("captures runtime exception in child component and renders fallback card", () => {
      const boundary = new MockErrorBoundaryHarness({
        fallbackTitle: "Shader Editor Error",
        fallbackMessage: "Monaco Editor encountered a fatal tokenizer exception",
      })

      const normalView = boundary.getRenderedView("<MonacoEditor />")
      expect(normalView.type).toBe("children")
      expect(normalView.content).toBe("<MonacoEditor />")

      // Trigger exception in child
      boundary.catchError(new Error("Tokenizer worker crashed"))
      expect(boundary.hasError).toBe(true)
      expect(boundary.capturedError?.message).toBe("Tokenizer worker crashed")

      const fallbackView = boundary.getRenderedView("<MonacoEditor />")
      expect(fallbackView.type).toBe("fallback")
      expect(fallbackView.content).toContain("Shader Editor Error")
      expect(fallbackView.content).toContain("Tokenizer worker crashed")
    })

    it("resets error boundary state when user clicks Try Again / Reset button", () => {
      const resetSpy = vi.fn()
      const boundary = new MockErrorBoundaryHarness({
        fallbackTitle: "Viewport Error",
        onReset: resetSpy,
      })

      boundary.catchError(new Error("WebGL context lost unexpectedly"))
      expect(boundary.hasError).toBe(true)

      // User clicks Reset
      boundary.reset()
      expect(boundary.hasError).toBe(false)
      expect(boundary.capturedError).toBeNull()
      expect(resetSpy).toHaveBeenCalledTimes(1)

      const restoredView = boundary.getRenderedView("<ViewportCanvas />")
      expect(restoredView.type).toBe("children")
      expect(restoredView.content).toBe("<ViewportCanvas />")
    })

    it("ensures error in one panel boundary does not unmount or crash sibling boundaries", () => {
      const monacoBoundary = new MockErrorBoundaryHarness({ fallbackTitle: "Monaco Error" })
      const viewportBoundary = new MockErrorBoundaryHarness({ fallbackTitle: "Viewport Error" })
      const nodeGraphBoundary = new MockErrorBoundaryHarness({ fallbackTitle: "NodeGraph Error" })

      // Simulate crash in Monaco Editor only
      monacoBoundary.catchError(new Error("DOM layout calculation overflow"))

      expect(monacoBoundary.hasError).toBe(true)
      expect(viewportBoundary.hasError).toBe(false)
      expect(nodeGraphBoundary.hasError).toBe(false)

      expect(viewportBoundary.getRenderedView("<Viewport />").type).toBe("children")
      expect(nodeGraphBoundary.getRenderedView("<NodeGraph />").type).toBe("children")
      expect(monacoBoundary.getRenderedView("<Monaco />").type).toBe("fallback")
    })
  })

  // --------------------------------------------------------------------------
  // 2. Monaco Live Diagnostic Error Markers
  // --------------------------------------------------------------------------
  describe("Monaco Diagnostics Integration", () => {
    it("maps WGSL compilation error with exact line and column to editor markers", () => {
      const wgslRawError = `:18:14 error: expected ';' for statement\n    return col`
      const diagnostics = parseDiagnosticErrors(wgslRawError)

      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      const primary = diagnostics[0]
      expect(primary.line).toBe(18)
      expect(primary.column).toBe(14)
      expect(primary.message).toContain("expected ';'")
    })

    it("maps WebGL / GLSL compilation error with line to editor markers", () => {
      const glslRawError = `ERROR: 0:27: 'u_intensity' : undeclared identifier`
      const diagnostics = parseDiagnosticErrors(glslRawError)

      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      const primary = diagnostics[0]
      expect(primary.line).toBe(27)
      expect(primary.message).toContain("'u_intensity' : undeclared identifier")
    })

    it("maps generic line/column error strings to diagnostic items", () => {
      const genericError = `Error at line 42, col 10: missing closing brace`
      const diagnostics = parseDiagnosticErrors(genericError)

      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(diagnostics[0].line).toBe(42)
      expect(diagnostics[0].column).toBe(10)
      expect(diagnostics[0].message).toContain("missing closing brace")
    })

    it("clears diagnostic markers when compiler error is resolved to null", () => {
      const store = useProjectStore.getState()

      // Set compiler error
      store.setLastCompileError("ERROR: 0:5: syntax error")
      expect(useProjectStore.getState().lastCompileError).toBe("ERROR: 0:5: syntax error")

      const errorDiagnostics = parseDiagnosticErrors(useProjectStore.getState().lastCompileError)
      expect(errorDiagnostics.length).toBe(1)

      // Fix error: clear in store
      store.setLastCompileError(null)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      const clearedDiagnostics = parseDiagnosticErrors(useProjectStore.getState().lastCompileError)
      expect(clearedDiagnostics).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // 3. WebGPU device.lost Auto-Recovery & Fallback
  // --------------------------------------------------------------------------
  describe("WebGPU device.lost Auto-Recovery", () => {
    it("detects GPU device lost and updates store state", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      // Simulate unexpected device loss
      device?.simulateDeviceLost("GPU TDR crash: hardware hung", "unknown")

      // Allow microtasks to execute lost callback
      await new Promise((resolve) => setTimeout(resolve, 10))

      const store = useProjectStore.getState()
      expect(store.deviceLost).toBe(true)
      expect(store.lastCompileError).toContain("Device lost: GPU TDR crash: hardware hung")

      adapter.dispose()
    })

    it("ignores intentional device destruction on normal unmount / teardown", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const store = useProjectStore.getState()
      store.setDeviceLost(false)

      // Disposing adapter marks isDisposed = true
      adapter.dispose()

      const device = env.webgpu.getDevice()
      device?.simulateDeviceLost("Intentional destroy", "destroyed")

      await new Promise((resolve) => setTimeout(resolve, 10))

      // When disposed intentionally, deviceLost remains false
      expect(useProjectStore.getState().deviceLost).toBe(false)
    })

    it("successfully auto-recovers WebGPU context and restores state after recovery backoff", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 15
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      device?.simulateDeviceLost("Driver reset", "unknown")

      // Immediately after crash, deviceLost is true
      await new Promise((r) => setTimeout(r, 5))
      expect(useProjectStore.getState().deviceLost).toBe(true)

      // After backoff timer (15ms) + mount microtasks
      await new Promise((r) => setTimeout(r, 40))

      const store = useProjectStore.getState()
      expect(store.deviceLost).toBe(false)
      expect(store.lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("automatically executes fallback to WebGL2 when recovery attempts are exhausted", async () => {
      const adapter = new WebGPUAdapter()
      adapter.recoveryBackoffMs = 10
      adapter.maxRecoveryAttempts = 2
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Set hardware exhausted so re-acquisition fails
      env.webgpu.gpu.shouldFailAdapter = true

      const device = env.webgpu.getDevice()
      device?.simulateDeviceLost("Permanent GPU fault", "unknown")

      // Wait for 2 recovery attempts to fail and fallback to complete
      for (let i = 0; i < 20; i++) {
        if (useProjectStore.getState().activeBackend === "webgl2") break
        await new Promise((r) => setTimeout(r, 15))
      }

      const store = useProjectStore.getState()
      expect(store.activeBackend).toBe("webgl2")
      expect(store.deviceLost).toBe(false)
      expect(store.lastCompileError).toBeNull()

      adapter.dispose()
    })
  })
})
