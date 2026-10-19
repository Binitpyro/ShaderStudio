import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  saveProjectNative,
  loadProjectNative,
  getDefaultProjectPath,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  startMcpBridge,
  stopMcpBridge,
  getMcpBridgeStatus,
  pickOpenProjectPath,
  pickSaveProjectPath,
} from "../src/desktop/tauriBridge"

describe("Adversarial Challenger Gate 3: Tauri Bridge Parity & Invocation Edge Cases", () => {
  const originalWindow = (globalThis as any).window

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    vi.restoreAllMocks()
  })

  describe("Probe 1: saveProjectNative with Edge-Case Paths", () => {
    it("rejects explicit empty string path '' with exact extension error", async () => {
      ;(globalThis as any).window = undefined
      await expect(saveProjectNative("", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("succeeds with undefined (omitted path) and resolves to default .shaderstudio path", async () => {
      ;(globalThis as any).window = undefined
      const defaultPath = getDefaultProjectPath()
      expect(defaultPath.endsWith(".shaderstudio")).toBe(true)

      const result1 = await saveProjectNative(undefined, '{"foo":"bar"}')
      expect(result1).toBe(defaultPath)

      const result2 = await saveProjectNative()
      expect(result2).toBe(defaultPath)
    })

    it("rejects whitespace-only paths ('   ', '\\t', '\\n', ' \\t ')", async () => {
      ;(globalThis as any).window = undefined
      const whitespaceVariants = ["   ", "\t", "\n", " \t \r\n "]
      for (const p of whitespaceVariants) {
        await expect(saveProjectNative(p, "{}")).rejects.toThrow(
          "File extension must be .shaderstudio"
        )
      }
    })

    it("rejects extension variations (.shaderstudio.bak, .shaderstudioo, .shaderstudio/)", async () => {
      ;(globalThis as any).window = undefined
      const extensionVariations = [
        "project.shaderstudio.bak",
        "project.shaderstudioo",
        "project.shaderstudio/",
        "project.shaderstudio\\",
        "project.shaderstudio.tmp",
        "project.shaderstudio.old",
        "project.shaderstudio.json",
        "project.shaderstudio_extra",
        "project.SHADERSTUDIO", // case sensitive
        "project.ShaderStudio",
      ]

      for (const p of extensionVariations) {
        await expect(saveProjectNative(p, "{}")).rejects.toThrow(
          "File extension must be .shaderstudio"
        )
      }
    })

    it("accepts valid .shaderstudio paths and persists correctly in fallback inMemoryFs", async () => {
      ;(globalThis as any).window = undefined
      const validPath = "C:/my_projects/test_shader.shaderstudio"
      const content = '{"nodes":[{"id":"node1"}]}'
      const saved = await saveProjectNative(validPath, content)
      expect(saved).toBe(validPath)

      const [loadedPath, loadedContent] = await loadProjectNative(validPath)
      expect(loadedPath).toBe(validPath)
      expect(loadedContent).toBe(content)
    })

    it("in Tauri mode, saveProjectNative with undefined forwards default path to invokeTauri", async () => {
      const mockInvoke = vi.fn().mockImplementation(async (cmd, args) => {
        if (cmd === "save_project_native") return args.path
        return undefined
      })
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      const defaultPath = getDefaultProjectPath()
      const res = await saveProjectNative(undefined, '{"data":1}')
      expect(res).toBe(defaultPath)
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenCalledWith("save_project_native", {
        path: defaultPath,
        project_json: '{"data":1}',
      })
    })

    it("in Tauri mode, rejects invalid extensions before dispatching to IPC", async () => {
      const mockInvoke = vi.fn()
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(saveProjectNative("malicious.shaderstudio.bak", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      expect(mockInvoke).not.toHaveBeenCalled()

      await expect(saveProjectNative("", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe("Probe 2: invokeTauri Single-Arg vs Multi-Arg Inspection", () => {
    it("verifies window.__TAURI_INTERNALS__.invoke receives exactly 1 argument for 1-arg calls", async () => {
      const recordedCalls: { cmd: string; argCount: number; secondArg: unknown }[] = []
      const mockInvoke = vi.fn((...args: any[]) => {
        recordedCalls.push({
          cmd: args[0],
          argCount: args.length,
          secondArg: args[1],
        })
        return Promise.resolve(args[0] === "get_mcp_bridge_status" ? false : undefined)
      })

      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      // Test 1-argument commands
      minimizeWindow()
      maximizeWindow()
      closeWindow()
      await getMcpBridgeStatus()
      stopMcpBridge()

      // Allow any microtasks to resolve
      await new Promise((r) => setTimeout(r, 10))

      expect(recordedCalls.length).toBe(5)
      for (const call of recordedCalls) {
        expect(call.argCount).toBe(1)
        expect(call.secondArg).toBeUndefined()
      }

      expect(recordedCalls.map((c) => c.cmd)).toEqual([
        "plugin:window|minimize",
        "plugin:window|toggle_maximize",
        "plugin:window|close",
        "get_mcp_bridge_status",
        "stop_mcp_bridge",
      ])
    })

    it("verifies window.__TAURI__.core.invoke receives exactly 1 argument for 1-arg calls", async () => {
      const recordedCalls: { cmd: string; argCount: number; secondArg: unknown }[] = []
      const mockInvoke = vi.fn((...args: any[]) => {
        recordedCalls.push({
          cmd: args[0],
          argCount: args.length,
          secondArg: args[1],
        })
        return Promise.resolve(args[0] === "get_mcp_bridge_status" ? true : undefined)
      })

      ;(globalThis as any).window = {
        __TAURI__: {
          core: { invoke: mockInvoke },
        },
      }

      minimizeWindow()
      maximizeWindow()
      closeWindow()
      const status = await getMcpBridgeStatus()
      expect(status).toBe(true)
      stopMcpBridge()

      await new Promise((r) => setTimeout(r, 10))

      expect(recordedCalls.length).toBe(5)
      for (const call of recordedCalls) {
        expect(call.argCount).toBe(1)
      }
    })

    it("verifies multi-argument calls pass the args object intact with exactly 2 parameters", async () => {
      const recordedCalls: { cmd: string; argCount: number; argsObj: unknown }[] = []
      const mockInvoke = vi.fn((cmd: string, ...rest: any[]) => {
        recordedCalls.push({
          cmd,
          argCount: rest.length + 1,
          argsObj: rest[0],
        })
        if (cmd === "save_project_native") return Promise.resolve(rest[0].path)
        if (cmd === "load_project_native") return Promise.resolve([rest[0].path, '{"test":true}'])
        if (cmd === "start_mcp_bridge") return Promise.resolve(rest[0].port)
        if (cmd === "plugin:dialog|open") return Promise.resolve("/picked/open.shaderstudio")
        if (cmd === "plugin:dialog|save") return Promise.resolve("/picked/saved.shaderstudio")
        return Promise.resolve(undefined)
      })

      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      // 1. startMcpBridge(8765)
      const port = await startMcpBridge(8765)
      expect(port).toBe(8765)

      // 2. saveProjectNative
      const savedPath = await saveProjectNative("foo.shaderstudio", '{"data":123}')
      expect(savedPath).toBe("foo.shaderstudio")

      // 3. loadProjectNative
      const [loadedPath, loadedData] = await loadProjectNative("foo.shaderstudio")
      expect(loadedPath).toBe("foo.shaderstudio")
      expect(loadedData).toBe('{"test":true}')

      // 4. pickOpenProjectPath
      const pickedOpen = await pickOpenProjectPath()
      expect(pickedOpen).toBe("/picked/open.shaderstudio")

      // 5. pickSaveProjectPath
      const pickedSave = await pickSaveProjectPath("default.shaderstudio")
      expect(pickedSave).toBe("/picked/saved.shaderstudio")

      expect(recordedCalls.length).toBe(5)
      for (const call of recordedCalls) {
        expect(call.argCount).toBe(2)
        expect(call.argsObj).toBeTypeOf("object")
        expect(call.argsObj).not.toBeNull()
      }

      expect(recordedCalls[0]).toEqual({
        cmd: "start_mcp_bridge",
        argCount: 2,
        argsObj: { port: 8765 },
      })
      expect(recordedCalls[1]).toEqual({
        cmd: "save_project_native",
        argCount: 2,
        argsObj: { path: "foo.shaderstudio", project_json: '{"data":123}' },
      })
      expect(recordedCalls[2]).toEqual({
        cmd: "load_project_native",
        argCount: 2,
        argsObj: { path: "foo.shaderstudio" },
      })
      expect(recordedCalls[3].cmd).toBe("plugin:dialog|open")
      expect(recordedCalls[3].argCount).toBe(2)
      expect(recordedCalls[4]).toEqual({
        cmd: "plugin:dialog|save",
        argCount: 2,
        argsObj: {
          filters: [{ name: "ShaderStudio Project", extensions: ["shaderstudio"] }],
          defaultPath: "default.shaderstudio",
        },
      })
    })
  })
})
