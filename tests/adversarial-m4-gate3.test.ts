/**
 * Empirical Adversarial Challenger Suite: Milestone 4 Gate 3
 * Focus: Live bridge, native FS roundtrips/error bubbling, single-argument IPC dispatch, and non-regression.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  isTauri,
  saveProjectNative,
  loadProjectNative,
  startMcpBridge,
  getMcpBridgeStatus,
  stopMcpBridge,
  getMcpBridgePort,
  getDefaultProjectPath,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  setupTray,
  isTrayActive,
  validateBinarySizeConfig,
  resetDesktopFallbackState,
} from "@/desktop/tauriBridge"

describe("Adversarial Challenger Gate 3: Milestone 4 Remediation Re-Verification", () => {
  let originalWindow: any

  beforeEach(() => {
    resetDesktopFallbackState()
    originalWindow = (globalThis as any).window
    if (typeof (globalThis as any).window !== "undefined") {
      delete (globalThis as any).window.__TAURI_INTERNALS__
      delete (globalThis as any).window.__TAURI__
    }
  })

  afterEach(() => {
    resetDesktopFallbackState()
    ;(globalThis as any).window = originalWindow
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Strict Argument Arity on Window Controls & Parameterless Commands
  // ==========================================================================
  describe("Window Controls and Parameterless Commands IPC Arity", () => {
    it("dispatches window controls with EXACTLY 1 argument via __TAURI_INTERNALS__", () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      minimizeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke.mock.calls[0].length).toBe(1)
      expect(mockInvoke.mock.calls[0][0]).toBe("plugin:window|minimize")

      maximizeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke.mock.calls[1].length).toBe(1)
      expect(mockInvoke.mock.calls[1][0]).toBe("plugin:window|toggle_maximize")

      closeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(3)
      expect(mockInvoke.mock.calls[2].length).toBe(1)
      expect(mockInvoke.mock.calls[2][0]).toBe("plugin:window|close")
    })

    it("dispatches window controls with EXACTLY 1 argument via __TAURI__.core", () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as any).window = {
        __TAURI__: { core: { invoke: mockInvoke } },
      }

      minimizeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke.mock.calls[0].length).toBe(1)
      expect(mockInvoke.mock.calls[0][0]).toBe("plugin:window|minimize")

      maximizeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke.mock.calls[1].length).toBe(1)
      expect(mockInvoke.mock.calls[1][0]).toBe("plugin:window|toggle_maximize")

      closeWindow()
      expect(mockInvoke).toHaveBeenCalledTimes(3)
      expect(mockInvoke.mock.calls[2].length).toBe(1)
      expect(mockInvoke.mock.calls[2][0]).toBe("plugin:window|close")
    })

    it("dispatches window control fallback commands with EXACTLY 1 argument on primary failure", async () => {
      const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith("plugin:window|")) {
          return Promise.reject(new Error("Plugin command failed"))
        }
        return Promise.resolve(undefined)
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      minimizeWindow()
      await new Promise((r) => setTimeout(r, 10))
      expect(mockInvoke.mock.calls[0][0]).toBe("plugin:window|minimize")
      expect(mockInvoke.mock.calls[1][0]).toBe("minimize_window")

      maximizeWindow()
      await new Promise((r) => setTimeout(r, 10))
      expect(mockInvoke.mock.calls[2][0]).toBe("plugin:window|toggle_maximize")
      expect(mockInvoke.mock.calls[3][0]).toBe("maximize_window")

      closeWindow()
      await new Promise((r) => setTimeout(r, 10))
      expect(mockInvoke.mock.calls[4][0]).toBe("plugin:window|close")
      expect(mockInvoke.mock.calls[5][0]).toBe("close_window")

      expect(mockInvoke).toHaveBeenCalledTimes(6)
      for (let i = 0; i < 6; i++) {
        expect(mockInvoke.mock.calls[i].length).toBe(1)
      }
    })

    it("dispatches get_mcp_bridge_status and stop_mcp_bridge with EXACTLY 1 argument in Tauri", async () => {
      const mockInvoke = vi.fn().mockResolvedValue(true)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const status = await getMcpBridgeStatus()
      expect(status).toBe(true)
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke.mock.calls[0].length).toBe(1)
      expect(mockInvoke.mock.calls[0][0]).toBe("get_mcp_bridge_status")

      stopMcpBridge()
      await new Promise((r) => setTimeout(r, 10))
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke.mock.calls[1].length).toBe(1)
      expect(mockInvoke.mock.calls[1][0]).toBe("stop_mcp_bridge")
    })
  })

  // ==========================================================================
  // 2. Native File System Empty Path & Extension Validation Parity
  // ==========================================================================
  describe("Native File System Validation and Parity", () => {
    it("strictly rejects explicit empty string in saveProjectNative without falling back", async () => {
      await expect(saveProjectNative("", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("falls back to default path ONLY when path is undefined", async () => {
      const result = await saveProjectNative(undefined, '{"project":"default"}')
      expect(result).toBe(getDefaultProjectPath())
      expect(result.endsWith(".shaderstudio")).toBe(true)

      const [loadedPath, content] = await loadProjectNative(result)
      expect(loadedPath).toBe(result)
      expect(content).toBe('{"project":"default"}')
    })

    it("rejects path with only whitespace in saveProjectNative", async () => {
      await expect(saveProjectNative("   ", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("bubbles native IPC errors during saveProjectNative without silent fallback", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("Disk quota exceeded (OS error 122)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(
        saveProjectNative("C:/projects/test.shaderstudio", '{"data":1}')
      ).rejects.toThrow("Disk quota exceeded (OS error 122)")

      // Must not have fallen back into inMemoryFs
      delete (globalThis as any).window.__TAURI_INTERNALS__
      await expect(loadProjectNative("C:/projects/test.shaderstudio")).rejects.toThrow(
        "File not found: C:/projects/test.shaderstudio"
      )
    })

    it("bubbles native IPC errors during loadProjectNative without silent fallback", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("File not found: /missing/file.shaderstudio"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(
        loadProjectNative("C:/projects/missing.shaderstudio")
      ).rejects.toThrow("File not found: /missing/file.shaderstudio")
    })
  })

  // ==========================================================================
  // 3. Roundtrip Persistence Fidelity & Memory State Isolation
  // ==========================================================================
  describe("Roundtrip Persistence Fidelity & Memory State Isolation", () => {
    it("saves and loads multi-kilobyte JSON payload faithfully in fallback mode", async () => {
      const complexGraph = {
        version: "2.0.0",
        nodes: Array.from({ length: 50 }, (_, i) => ({
          id: `node-${i}`,
          type: "mathExpression",
          data: { expression: `sin(uv.x * ${i}.0) * cos(uv.y * ${i}.0)` },
          position: { x: i * 20, y: i * 15 },
        })),
        metadata: {
          author: "ShaderStudio Challenger",
          tags: ["mcp", "subgraph", "webgpu", "gl2"],
        },
      }
      const serialized = JSON.stringify(complexGraph)
      const targetPath = "C:/Documents/ShaderStudio/complex_test.shaderstudio"

      const saved = await saveProjectNative(targetPath, serialized)
      expect(saved).toBe(targetPath)

      const [loadedPath, content] = await loadProjectNative(targetPath)
      expect(loadedPath).toBe(targetPath)
      expect(JSON.parse(content)).toEqual(complexGraph)
    })

    it("clears state cleanly with resetDesktopFallbackState", async () => {
      await saveProjectNative("C:/test.shaderstudio", '{"clean":true}')
      await startMcpBridge(39999)
      setupTray()

      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(39999)
      expect(isTrayActive()).toBe(true)

      resetDesktopFallbackState()

      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
      expect(isTrayActive()).toBe(false)
      await expect(loadProjectNative("C:/test.shaderstudio")).rejects.toThrow("File not found")
    })
  })

  // ==========================================================================
  // 4. MCP Bridge Port Boundary Probes
  // ==========================================================================
  describe("MCP Bridge Port Boundary Probes", () => {
    it("rejects boundary ports 0, 1, 1024, 65536, and negative numbers", async () => {
      const invalidPorts = [-1, 0, 1, 80, 443, 1024, 65536, 70000]
      for (const p of invalidPorts) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}`)
      }
    })

    it("accepts boundary ports 1025 and 65535 in fallback mode", async () => {
      expect(await startMcpBridge(1025)).toBe("MCP Bridge active on port 1025")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(1025)
      stopMcpBridge()

      expect(await startMcpBridge(65535)).toBe("MCP Bridge active on port 65535")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(65535)
      stopMcpBridge()
    })
  })

  // ==========================================================================
  // 5. Binary Slimming Profile Validator
  // ==========================================================================
  describe("Binary Size Optimization Profile Validator", () => {
    it("validates all 5 mandatory flags", () => {
      const sample = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
      const res = validateBinarySizeConfig(sample)
      expect(res.valid).toBe(true)
      expect(res.flags.length).toBe(5)
    })

    it("detects missing flags when profile is incomplete", () => {
      const incomplete = `
[profile.release]
opt-level = "z"
`
      const res = validateBinarySizeConfig(incomplete)
      expect(res.valid).toBe(false)
    })
  })
})
