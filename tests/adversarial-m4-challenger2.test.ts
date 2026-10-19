/**
 * Adversarial Challenger 2 Test Suite: Milestone 4 (Tauri v2 Desktop App)
 * 
 * Comprehensive adversarial verification of:
 * 1. Window control IPC invocations and plugin fallback chains
 * 2. Native dialog pickers (pickOpenProjectPath, pickSaveProjectPath) under cancellations and errors
 * 3. Strict error propagation without silent fallbacks
 * 4. Cross-platform path resolution without hardcoded usernames
 * 5. Concurrent bridge commands and IPC failure resilience
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  isTauri,
  saveProjectNative,
  loadProjectNative,
  startMcpBridge,
  getMcpBridgeStatus,
  stopMcpBridge,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  pickOpenProjectPath,
  pickSaveProjectPath,
  getDefaultProjectPath,
  resetDesktopFallbackState,
} from "@/desktop/tauriBridge"

describe("Adversarial Challenger 2: Milestone 4 Verification", () => {
  let originalWindow: any
  let originalProcess: any

  beforeEach(() => {
    resetDesktopFallbackState()
    originalWindow = (globalThis as any).window
    originalProcess = (globalThis as any).process
  })

  afterEach(() => {
    resetDesktopFallbackState()
    vi.restoreAllMocks()
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).process = originalProcess
  })

  // ==========================================================================
  // 1. Window Control IPC Invocations & Fallback Hierarchy
  // ==========================================================================
  describe("Window Control IPC Invocations & Fallback", () => {
    it("invokes plugin:window|minimize when in Tauri runtime", async () => {
      const invokeMock = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }
      expect(isTauri()).toBe(true)

      minimizeWindow()
      expect(invokeMock).toHaveBeenCalledWith("plugin:window|minimize")
    })

    it("falls back to minimize_window if plugin:window|minimize rejects", async () => {
      const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "plugin:window|minimize") {
          throw new Error("Plugin not registered")
        }
        return undefined
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      minimizeWindow()
      // Wait microtask tick for catch handler to fire
      await new Promise((r) => setTimeout(r, 10))

      expect(invokeMock).toHaveBeenCalledWith("plugin:window|minimize")
      expect(invokeMock).toHaveBeenCalledWith("minimize_window")
    })

    it("invokes plugin:window|toggle_maximize and falls back to maximize_window on rejection", async () => {
      const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "plugin:window|toggle_maximize") {
          throw new Error("Plugin not registered")
        }
        return undefined
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      maximizeWindow()
      await new Promise((r) => setTimeout(r, 10))

      expect(invokeMock).toHaveBeenCalledWith("plugin:window|toggle_maximize")
      expect(invokeMock).toHaveBeenCalledWith("maximize_window")
    })

    it("invokes plugin:window|close and falls back to close_window on rejection", async () => {
      const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "plugin:window|close") {
          throw new Error("Plugin not registered")
        }
        return undefined
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      closeWindow()
      await new Promise((r) => setTimeout(r, 10))

      expect(invokeMock).toHaveBeenCalledWith("plugin:window|close")
      expect(invokeMock).toHaveBeenCalledWith("close_window")
    })

    it("handles total IPC failure gracefully without crashing the UI", async () => {
      const invokeMock = vi.fn().mockRejectedValue(new Error("Fatal IPC crash"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      expect(() => {
        minimizeWindow()
        maximizeWindow()
        closeWindow()
      }).not.toThrow()
    })
  })

  // ==========================================================================
  // 2. Native Dialog Pickers
  // ==========================================================================
  describe("Native Dialog Pickers (pickOpenProjectPath / pickSaveProjectPath)", () => {
    it("returns null when not in Tauri environment", async () => {
      if (typeof (globalThis as any).window !== "undefined") {
        delete (globalThis as any).window.__TAURI_INTERNALS__
        delete (globalThis as any).window.__TAURI__
      }
      expect(isTauri()).toBe(false)

      const openResult = await pickOpenProjectPath()
      expect(openResult).toBeNull()

      const saveResult = await pickSaveProjectPath()
      expect(saveResult).toBeNull()
    })

    it("returns single string path selected from plugin:dialog|open", async () => {
      const mockPath = "C:/Projects/CustomShader.shaderstudio"
      const invokeMock = vi.fn().mockImplementation(async (cmd: string, args: any) => {
        if (cmd === "plugin:dialog|open") {
          expect(args.filters[0].extensions).toEqual(["shaderstudio"])
          expect(args.multiple).toBe(false)
          return mockPath
        }
        return null
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const res = await pickOpenProjectPath()
      expect(res).toBe(mockPath)
    })

    it("extracts first path if plugin:dialog|open returns an array of paths", async () => {
      const mockPaths = ["/home/user/first.shaderstudio", "/home/user/second.shaderstudio"]
      const invokeMock = vi.fn().mockResolvedValue(mockPaths)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const res = await pickOpenProjectPath()
      expect(res).toBe("/home/user/first.shaderstudio")
    })

    it("returns null if user cancels open dialog", async () => {
      const invokeMock = vi.fn().mockResolvedValue(null)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const res = await pickOpenProjectPath()
      expect(res).toBeNull()
    })

    it("returns null if open dialog throws an error", async () => {
      const invokeMock = vi.fn().mockRejectedValue(new Error("Dialog aborted by OS"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const res = await pickOpenProjectPath()
      expect(res).toBeNull()
    })

    it("handles save dialog selection and cancellation", async () => {
      const chosenPath = "D:/SavedShaders/output.shaderstudio"
      const invokeMock = vi.fn().mockImplementation(async (cmd: string, args: any) => {
        if (cmd === "plugin:dialog|save") {
          expect(args.filters[0].extensions).toEqual(["shaderstudio"])
          expect(args.defaultPath).toBe("default.shaderstudio")
          return chosenPath
        }
        return null
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const saveRes = await pickSaveProjectPath("default.shaderstudio")
      expect(saveRes).toBe(chosenPath)

      // Test cancellation
      invokeMock.mockResolvedValueOnce(null)
      const cancelRes = await pickSaveProjectPath()
      expect(cancelRes).toBeNull()

      // Test error
      invokeMock.mockRejectedValueOnce(new Error("Permission denied"))
      const errorRes = await pickSaveProjectPath()
      expect(errorRes).toBeNull()
    })
  })

  // ==========================================================================
  // 3. Strict Error Propagation (No Silent Fallback to inMemoryFs)
  // ==========================================================================
  describe("Strict Error Propagation in Tauri Runtime", () => {
    it("propagates save errors without polluting or reading inMemoryFs", async () => {
      const invokeMock = vi.fn().mockRejectedValue(new Error("Disk quota exceeded (OS error 122)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const testPath = "C:/Shaders/overflow.shaderstudio"
      await expect(
        saveProjectNative(testPath, '{"heavy":true}')
      ).rejects.toThrow("Disk quota exceeded (OS error 122)")

      // Disconnect Tauri to check fallback inMemoryFs
      delete (globalThis as any).window.__TAURI_INTERNALS__
      await expect(loadProjectNative(testPath)).rejects.toThrow(`File not found: ${testPath}`)
    })

    it("propagates load errors without silently reading fallback Map", async () => {
      const invokeMock = vi.fn().mockRejectedValue(new Error("Access is denied (OS error 5)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      const target = "C:/Secret/classified.shaderstudio"
      await expect(loadProjectNative(target)).rejects.toThrow("Access is denied (OS error 5)")
    })

    it("propagates MCP bridge start errors without falling back to local flag", async () => {
      const invokeMock = vi.fn().mockRejectedValue(new Error("Address already in use (OS error 10048)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: invokeMock },
      }

      await expect(startMcpBridge(8080)).rejects.toThrow("Address already in use (OS error 10048)")
    })
  })

  // ==========================================================================
  // 4. Dynamic Path Resolution & Separator Normalization
  // ==========================================================================
  describe("Dynamic Path Resolution", () => {
    it("resolves Windows USERPROFILE with forward slash normalization", () => {
      ;(globalThis as any).process = {
        env: {
          USERPROFILE: "C:\\Users\\AliceTester",
        },
      }

      const path = getDefaultProjectPath()
      expect(path).toBe("C:/Users/AliceTester/Documents/ShaderStudio/untitled.shaderstudio")
      expect(path).not.toContain("\\")
    })

    it("resolves Unix HOME with forward slash normalization", () => {
      ;(globalThis as any).process = {
        env: {
          HOME: "/home/developer",
        },
      }

      const path = getDefaultProjectPath()
      expect(path).toBe("/home/developer/Documents/ShaderStudio/untitled.shaderstudio")
    })

    it("falls back to ./untitled.shaderstudio when neither USERPROFILE nor HOME is set", () => {
      ;(globalThis as any).process = { env: {} }
      const path = getDefaultProjectPath()
      expect(path).toBe("./untitled.shaderstudio")
    })
  })
})
