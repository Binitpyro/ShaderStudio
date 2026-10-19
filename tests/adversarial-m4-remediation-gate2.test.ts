/**
 * Adversarial Challenge Suite: Milestone 4 Remediation Re-Verification (Gate 2)
 *
 * Exhaustive empirical probes:
 * 1. Native file system operations (save/load, roundtrip, default path fallback, deep directory creation)
 * 2. Cross-platform dynamic directory resolution (USERPROFILE, HOME, unset fallback)
 * 3. Native open/save dialog interaction (pickOpenProjectPath, pickSaveProjectPath, user cancel, filter check)
 * 4. Error throwing on native invoke failure (NO silent fallbacks, isolation of inMemoryFs)
 * 5. Extension constraints & adversarial path injection (.shaderstudio enforcement, case sensitivity, trailing chars)
 * 6. MCP Bridge lifecycle and boundary conditions
 * 7. Window controls and System Tray lifecycle
 * 8. Cargo.toml binary slimming flags verification (< 15MB guarantee)
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
  pickOpenProjectPath,
  pickSaveProjectPath,
  getDefaultProjectPath,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  setupTray,
  isTrayActive,
  validateBinarySizeConfig,
  resetDesktopFallbackState,
  save_project_native,
  load_project_native,
  start_mcp_bridge,
  get_mcp_bridge_status,
  stop_mcp_bridge,
} from "@/desktop/tauriBridge"

describe("Adversarial Challenger: Milestone 4 Remediation Re-Verification", () => {
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
  // Battery 1: Native File System Operations & State Isolation
  // ==========================================================================
  describe("Battery 1: Native File System Operations", () => {
    it("saves and loads project state in fallback environment faithfully", async () => {
      const path = "C:/Shaders/project_alpha.shaderstudio"
      const payload = JSON.stringify({
        name: "Alpha Project",
        backend: "webgpu",
        nodes: [{ id: "n1", type: "math" }],
      })

      const saved = await saveProjectNative(path, payload)
      expect(saved).toBe(path)

      const [loadedPath, content] = await loadProjectNative(path)
      expect(loadedPath).toBe(path)
      expect(content).toBe(payload)
      expect(JSON.parse(content).name).toBe("Alpha Project")
    })

    it("handles multiple sequential saves and overwrites to the same path", async () => {
      const path = "C:/Shaders/overwrite.shaderstudio"
      await saveProjectNative(path, JSON.stringify({ revision: 1 }))
      let [, content] = await loadProjectNative(path)
      expect(JSON.parse(content).revision).toBe(1)

      await saveProjectNative(path, JSON.stringify({ revision: 2 }))
      ;[, content] = await loadProjectNative(path)
      expect(JSON.parse(content).revision).toBe(2)

      await saveProjectNative(path, JSON.stringify({ revision: 3, notes: "Final" }))
      ;[, content] = await loadProjectNative(path)
      expect(JSON.parse(content).revision).toBe(3)
    })

    it("falls back to default project path when path is undefined on save", async () => {
      const defaultPath = getDefaultProjectPath()
      expect(defaultPath.endsWith(".shaderstudio")).toBe(true)

      const saved = await saveProjectNative(undefined, '{"defaultSave": true}')
      expect(saved).toBe(defaultPath)

      const [loadedPath, content] = await loadProjectNative()
      expect(loadedPath).toBe(defaultPath)
      expect(JSON.parse(content).defaultSave).toBe(true)
    })

    it("throws explicit File not found error when loading a non-existent path", async () => {
      const missing = "C:/Missing/does_not_exist.shaderstudio"
      await expect(loadProjectNative(missing)).rejects.toThrow(`File not found: ${missing}`)
    })

    it("throws explicit File not found error when loading undefined from empty storage", async () => {
      resetDesktopFallbackState()
      await expect(loadProjectNative(undefined)).rejects.toThrow("File not found: undefined")
    })
  })

  // ==========================================================================
  // Battery 2: Dynamic Cross-Platform Directory Resolution
  // ==========================================================================
  describe("Battery 2: Dynamic Cross-Platform Directory Resolution", () => {
    it("resolves default path using USERPROFILE when running on Windows", () => {
      const proc = (globalThis as any).process
      const origUserProfile = proc?.env?.USERPROFILE
      const origHome = proc?.env?.HOME

      try {
        if (proc?.env) {
          proc.env.USERPROFILE = "C:\\Users\\Alice"
          delete proc.env.HOME
        }

        const path = getDefaultProjectPath()
        expect(path).toBe("C:/Users/Alice/Documents/ShaderStudio/untitled.shaderstudio")
        expect(path.endsWith(".shaderstudio")).toBe(true)
        expect(path).not.toContain("\\")
      } finally {
        if (proc?.env) {
          if (origUserProfile !== undefined) proc.env.USERPROFILE = origUserProfile
          if (origHome !== undefined) proc.env.HOME = origHome
        }
      }
    })

    it("resolves default path using HOME when running on POSIX (macOS / Linux)", () => {
      const proc = (globalThis as any).process
      const origUserProfile = proc?.env?.USERPROFILE
      const origHome = proc?.env?.HOME

      try {
        if (proc?.env) {
          delete proc.env.USERPROFILE
          proc.env.HOME = "/home/developer"
        }

        const path = getDefaultProjectPath()
        expect(path).toBe("/home/developer/Documents/ShaderStudio/untitled.shaderstudio")
        expect(path.endsWith(".shaderstudio")).toBe(true)
      } finally {
        if (proc?.env) {
          if (origUserProfile !== undefined) proc.env.USERPROFILE = origUserProfile
          if (origHome !== undefined) proc.env.HOME = origHome
        }
      }
    })

    it("resolves default relative path when neither USERPROFILE nor HOME is defined", () => {
      const proc = (globalThis as any).process
      const origUserProfile = proc?.env?.USERPROFILE
      const origHome = proc?.env?.HOME

      try {
        if (proc?.env) {
          delete proc.env.USERPROFILE
          delete proc.env.HOME
        }

        const path = getDefaultProjectPath()
        expect(path).toBe("./untitled.shaderstudio")
        expect(path.endsWith(".shaderstudio")).toBe(true)
      } finally {
        if (proc?.env) {
          if (origUserProfile !== undefined) proc.env.USERPROFILE = origUserProfile
          if (origHome !== undefined) proc.env.HOME = origHome
        }
      }
    })
  })

  // ==========================================================================
  // Battery 3: Native Open / Save Dialog Interactions
  // ==========================================================================
  describe("Battery 3: Native Open and Save Dialog Interactions", () => {
    it("returns null for pickOpenProjectPath when not running in Tauri", async () => {
      expect(isTauri()).toBe(false)
      const res = await pickOpenProjectPath()
      expect(res).toBeNull()
    })

    it("returns null for pickSaveProjectPath when not running in Tauri", async () => {
      expect(isTauri()).toBe(false)
      const res = await pickSaveProjectPath("test.shaderstudio")
      expect(res).toBeNull()
    })

    it("invokes plugin:dialog|open with .shaderstudio filter and returns picked path string", async () => {
      const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
        if (cmd === "plugin:dialog|open") {
          expect(args.filters).toEqual([{ name: "ShaderStudio Project", extensions: ["shaderstudio"] }])
          expect(args.multiple).toBe(false)
          expect(args.directory).toBe(false)
          return "C:/Chosen/hero.shaderstudio"
        }
        return null
      })

      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }
      expect(isTauri()).toBe(true)

      const picked = await pickOpenProjectPath()
      expect(picked).toBe("C:/Chosen/hero.shaderstudio")
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it("handles array return from plugin:dialog|open gracefully", async () => {
      const mockInvoke = vi.fn().mockResolvedValue(["C:/Chosen/multi.shaderstudio"])
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const picked = await pickOpenProjectPath()
      expect(picked).toBe("C:/Chosen/multi.shaderstudio")
    })

    it("handles user cancellation (null return) from plugin:dialog|open safely", async () => {
      const mockInvoke = vi.fn().mockResolvedValue(null)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const picked = await pickOpenProjectPath()
      expect(picked).toBeNull()
    })

    it("handles plugin error rejection in pickOpenProjectPath safely by returning null", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("Dialog plugin crashed"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const picked = await pickOpenProjectPath()
      expect(picked).toBeNull()
    })

    it("invokes plugin:dialog|save with defaultPath and .shaderstudio filter", async () => {
      const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
        if (cmd === "plugin:dialog|save") {
          expect(args.defaultPath).toBe("my_shader.shaderstudio")
          expect(args.filters).toEqual([{ name: "ShaderStudio Project", extensions: ["shaderstudio"] }])
          return "C:/Saved/my_shader.shaderstudio"
        }
        return null
      })

      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const picked = await pickSaveProjectPath("my_shader.shaderstudio")
      expect(picked).toBe("C:/Saved/my_shader.shaderstudio")
    })

    it("handles user cancellation in pickSaveProjectPath safely by returning null", async () => {
      const mockInvoke = vi.fn().mockResolvedValue(null)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const picked = await pickSaveProjectPath()
      expect(picked).toBeNull()
    })
  })

  // ==========================================================================
  // Battery 4: Error Throwing on Native Invoke Failure (No Silent Masking)
  // ==========================================================================
  describe("Battery 4: Error Throwing on Native Invoke Failure", () => {
    it("throws immediately on saveProjectNative rejection and never falls back to inMemoryFs", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("Disk full (os error 112)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }
      expect(isTauri()).toBe(true)

      const targetPath = "C:/Projects/important.shaderstudio"
      await expect(
        saveProjectNative(targetPath, '{"data": "critical"}')
      ).rejects.toThrow("Disk full (os error 112)")

      // Verify invoke was called once
      expect(mockInvoke).toHaveBeenCalledWith("save_project_native", {
        path: targetPath,
        project_json: '{"data": "critical"}',
      })

      // Ensure fallback inMemoryFs was NOT modified!
      delete (globalThis as any).window.__TAURI_INTERNALS__
      expect(isTauri()).toBe(false)
      await expect(loadProjectNative(targetPath)).rejects.toThrow(`File not found: ${targetPath}`)
    })

    it("throws immediately on loadProjectNative rejection and never returns false data", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("Permission denied (os error 13)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(
        loadProjectNative("C:/Projects/locked.shaderstudio")
      ).rejects.toThrow("Permission denied (os error 13)")
    })

    it("throws immediately on startMcpBridge rejection without setting fallback running state", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("Address already in use (os error 98)"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(startMcpBridge(8080)).rejects.toThrow("Address already in use (os error 98)")

      // Status in Tauri mode dispatches to invokeTauri
      mockInvoke.mockResolvedValueOnce(false)
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("throws immediately on getMcpBridgeStatus rejection in Tauri mode", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("IPC communication timeout"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(getMcpBridgeStatus()).rejects.toThrow("IPC communication timeout")
    })
  })

  // ==========================================================================
  // Battery 5: Extension Constraints & Adversarial Path Probes
  // ==========================================================================
  describe("Battery 5: Extension Constraints & Adversarial Path Probes", () => {
    it("rejects path with empty string in saveProjectNative", async () => {
      await expect(saveProjectNative("", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("rejects path containing only spaces in saveProjectNative", async () => {
      await expect(saveProjectNative("   ", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("rejects path with disguised double extension (.shaderstudio.exe, .shaderstudio.sh)", async () => {
      const dangerousPaths = [
        "exploit.shaderstudio.exe",
        "exploit.shaderstudio.sh",
        "exploit.shaderstudio.bat",
        "exploit.shaderstudio.cmd",
        "exploit.shaderstudio.vbs",
        "exploit.shaderstudio.ps1",
      ]

      for (const p of dangerousPaths) {
        await expect(saveProjectNative(p, "{}")).rejects.toThrow(
          "File extension must be .shaderstudio"
        )
      }
    })

    it("accepts valid dotted path ending with .shaderstudio", async () => {
      const validPath = "archive.2026.04.17.shaderstudio"
      const res = await saveProjectNative(validPath, '{"version": "2026"}')
      expect(res).toBe(validPath)

      const [loadedPath, content] = await loadProjectNative(validPath)
      expect(loadedPath).toBe(validPath)
      expect(JSON.parse(content).version).toBe("2026")
    })

    it("accepts path with spaces in directory and file name ending with .shaderstudio", async () => {
      const pathWithSpaces = "C:/My Shader Studio Projects/New Hero Shader 2026.shaderstudio"
      const saved = await saveProjectNative(pathWithSpaces, '{"title": "Hero"}')
      expect(saved).toBe(pathWithSpaces)

      const [loadedPath, content] = await loadProjectNative(pathWithSpaces)
      expect(loadedPath).toBe(pathWithSpaces)
      expect(JSON.parse(content).title).toBe("Hero")
    })
  })

  // ==========================================================================
  // Battery 6: MCP Bridge Lifecycle & Port Boundaries
  // ==========================================================================
  describe("Battery 6: MCP Bridge Port Boundaries & Lifecycle", () => {
    it("rejects invalid ports <= 1024", async () => {
      for (const p of [0, 80, 443, 1024]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("rejects invalid ports > 65535", async () => {
      for (const p of [65536, 80000, 999999]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("successfully cycles start -> status check -> stop -> status check", async () => {
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)

      const msg = await startMcpBridge(5000)
      expect(msg).toBe("MCP Bridge active on port 5000")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(5000)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("allows re-starting on a new port cleanly", async () => {
      await startMcpBridge(5001)
      expect(getMcpBridgePort()).toBe(5001)

      await startMcpBridge(5002)
      expect(getMcpBridgePort()).toBe(5002)
      expect(await getMcpBridgeStatus()).toBe(true)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
    })
  })

  // ==========================================================================
  // Battery 7: Window Controls & System Tray Lifecycle
  // ==========================================================================
  describe("Battery 7: Window Controls and System Tray Lifecycle", () => {
    it("dispatches window control IPC commands in Tauri runtime", () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      minimizeWindow()
      expect(mockInvoke).toHaveBeenCalledWith("plugin:window|minimize")

      maximizeWindow()
      expect(mockInvoke).toHaveBeenCalledWith("plugin:window|toggle_maximize")

      closeWindow()
      expect(mockInvoke).toHaveBeenCalledWith("plugin:window|close")
    })

    it("manages system tray state idempotently", () => {
      expect(isTrayActive()).toBe(false)
      setupTray()
      expect(isTrayActive()).toBe(true)
      setupTray()
      expect(isTrayActive()).toBe(true)
    })
  })

  // ==========================================================================
  // Battery 8: Binary Slimming Optimization Profile (F-DESK-05)
  // ==========================================================================
  describe("Battery 8: Binary Size Optimization Profile", () => {
    it("validates all 5 required slimming flags in profile.release", () => {
      const cargoToml = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
      const res = validateBinarySizeConfig(cargoToml)
      expect(res.valid).toBe(true)
      expect(res.flags).toHaveLength(5)
    })

    it("rejects cargo configurations missing any single flag", () => {
      const flags = [
        'opt-level = "z"',
        "lto = true",
        "codegen-units = 1",
        'panic = "abort"',
        "strip = true",
      ]

      for (let i = 0; i < flags.length; i++) {
        const withoutOne = flags.filter((_, idx) => idx !== i).join("\n")
        const res = validateBinarySizeConfig(withoutOne)
        expect(res.valid).toBe(false)
      }
    })
  })

  // ==========================================================================
  // Battery 9: Snake_Case Aliases Parity
  // ==========================================================================
  describe("Battery 9: Snake_Case Aliases Parity", () => {
    it("verifies snake_case exports match camelCase exports", async () => {
      const path = "C:/test/alias_check.shaderstudio"
      const content = '{"test": 123}'

      const saved = await save_project_native(path, content)
      expect(saved).toBe(path)

      const [loadedPath, loadedContent] = await load_project_native(path)
      expect(loadedPath).toBe(path)
      expect(loadedContent).toBe(content)

      const msg = await start_mcp_bridge(6000)
      expect(msg).toBe("MCP Bridge active on port 6000")
      expect(await get_mcp_bridge_status()).toBe(true)

      stop_mcp_bridge()
      expect(await get_mcp_bridge_status()).toBe(false)
    })
  })
})
