import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import {
  isTauri,
  saveProjectNative,
  loadProjectNative,
  startMcpBridge,
  getMcpBridgeStatus,
  stopMcpBridge,
  getMcpBridgePort,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  setupTray,
  isTrayActive,
  validateBinarySizeConfig,
  resetDesktopFallbackState,
  pickOpenProjectPath,
  pickSaveProjectPath,
  getDefaultProjectPath,
  save_project_native,
  load_project_native,
  start_mcp_bridge,
  get_mcp_bridge_status,
  stop_mcp_bridge,
} from "@/desktop/tauriBridge"

import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { subGraphLibrary, collapseNodesToSubGraph, BUILTIN_FRESNEL_RIM, BUILTIN_NOISE_GEN, BUILTIN_UV_DISTORTION, type SubGraphDefinition } from "@/core/subGraphLibrary"
import { flattenGraph, compileGraph, buildSdfTree, MAX_SUBGRAPH_DEPTH, type GraphNodeData } from "@/core/graphCompiler"
import { customNodeRegistry, validateCustomNodeManifest, type CustomNodeManifest } from "@/core/customNodeSdk"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { type Node, type Edge } from "@xyflow/react"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { transpileToUE5, transpileToUnrealHLSL, transpileToBlenderOSL, exportGltf2Material, packOrmTexture, generateNpmPackage, importShadertoy, createProjectFromShadertoy, generateR3FExport } from "@/core/engineTranspiler"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { checkMemoryThreshold, createDefaultMemoryBudget, MemoryBudgetManager } from "@/core/memoryBudget"
import { generateMeshLods, selectLodByDistance, decimateGeometryBuffer, decimateIndices } from "@/core/meshLod"
import { createTextureStreamer } from "@/core/textureStreamer"
const g = globalThis as any
const flush = () => new Promise((r) => setTimeout(r, 10))
const withTauri = (invoke: unknown, key: "__TAURI_INTERNALS__" | "__TAURI__" = "__TAURI_INTERNALS__") => {
  g.window = key === "__TAURI__" ? { __TAURI__: { core: { invoke } } } : { __TAURI_INTERNALS__: { invoke } }
}

describe("desktop/tauriBridge", () => {
  let originalWindow: any

  beforeEach(() => {
    resetDesktopFallbackState()
    originalWindow = g.window
    if (g.window) {
      delete g.window.__TAURI_INTERNALS__
      delete g.window.__TAURI__
    }
  })

  afterEach(() => {
    resetDesktopFallbackState()
    g.window = originalWindow
    vi.restoreAllMocks()
  })

  describe("src-tauri workspace integrity", () => {
    const srcTauri = path.resolve(__dirname, "../../src-tauri")

    it("Cargo.toml declares the desktop package, plugins and all 5 slimming flags", () => {
      const cargo = fs.readFileSync(path.join(srcTauri, "Cargo.toml"), "utf-8")
      for (const s of [
        'name = "shaderstudio-desktop"',
        'name = "shaderstudio_desktop_lib"',
        'edition = "2021"',
        'tauri = { version = "2.2"',
        'tauri-plugin-dialog = "2.2"',
        "serde",
        "tauri-build",
      ]) {
        expect(cargo).toContain(s)
      }
      // the stub MCP server (warp) and unused fs/shell plugins are gone
      for (const s of ["tauri-plugin-fs", "tauri-plugin-shell", "warp", "futures-util"]) {
        expect(cargo).not.toContain(s)
      }
      const v = validateBinarySizeConfig(cargo)
      expect(v.valid).toBe(true)
      expect(v.flags).toHaveLength(5)
    })

    it("tauri.conf.json matches the window, tray and bundle schema", () => {
      const conf = JSON.parse(fs.readFileSync(path.join(srcTauri, "tauri.conf.json"), "utf-8"))
      expect(conf.identifier).toBe("com.shaderstudio.app")
      expect(conf.productName).toBe("ShaderStudio")
      expect(conf.build.frontendDist).toBe("../dist")
      expect(conf.build.devUrl).toBe("http://localhost:5173")
      expect(conf.app.windows[0]).toMatchObject({ width: 1440, height: 900, minWidth: 1024, minHeight: 700 })
      expect(conf.app.trayIcon.iconPath).toBe("icons/icon.png")
      expect(conf.bundle.active).toBe(true)
      expect(conf.bundle.targets).toBe("all")
      expect(conf.bundle.icon).toEqual(
        expect.arrayContaining(["icons/32x32.png", "icons/128x128.png", "icons/icon.ico", "icons/icon.png"])
      )
    })

    it("capabilities/default.json grants only window permissions (dialogs run in Rust commands that record the picked path)", () => {
      const cap = JSON.parse(fs.readFileSync(path.join(srcTauri, "capabilities/default.json"), "utf-8"))
      expect(cap.identifier).toBe("default")
      expect(cap.windows).toEqual(["main"])
      expect([...cap.permissions].sort()).toEqual(
        [
          "core:default",
          "core:window:allow-minimize",
          "core:window:allow-toggle-maximize",
          "core:window:allow-close",
        ].sort()
      )
    })

    it("tauri.conf.json ships a real CSP that still allows WASM, workers, textures and the local bridge", () => {
      const conf = JSON.parse(fs.readFileSync(path.join(srcTauri, "tauri.conf.json"), "utf-8"))
      const csp: string = conf.app.security.csp
      expect(typeof csp).toBe("string")
      const dir = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? ""
      expect(dir("default-src")).toContain("'self'")
      expect(dir("script-src")).toContain("'wasm-unsafe-eval'")
      expect(dir("script-src")).not.toMatch(/'unsafe-eval'|\*/)
      expect(dir("worker-src")).toMatch(/'self'.*blob:/)
      expect(dir("img-src")).toMatch(/blob:.*data:|data:.*blob:/)
      expect(dir("connect-src")).toContain("ws://localhost:*")
      expect(dir("connect-src")).toContain("http://localhost:*")
      expect(dir("object-src")).toContain("'none'")
    })

    it("package.json wires the Tauri CLI to the scripts and the config matches Vite", () => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"))
      expect(pkg.devDependencies["@tauri-apps/cli"]).toMatch(/^\^?2\./)
      expect(pkg.scripts).toMatchObject({ tauri: "tauri", "tauri:dev": "tauri dev", "tauri:build": "tauri build" })
      const conf = JSON.parse(fs.readFileSync(path.join(srcTauri, "tauri.conf.json"), "utf-8"))
      expect(pkg.scripts[conf.build.beforeDevCommand.replace("npm run ", "")]).toBeDefined()
      expect(pkg.scripts[conf.build.beforeBuildCommand.replace("npm run ", "")]).toBeDefined()
    })

    it("build.rs, icons and Rust command modules exist and are genuine", () => {
      expect(fs.readFileSync(path.join(srcTauri, "build.rs"), "utf-8")).toContain("tauri_build::build()")

      const png = fs.readFileSync(path.join(srcTauri, "icons/32x32.png"))
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      const ico = fs.readFileSync(path.join(srcTauri, "icons/icon.ico"))
      expect(ico.readUInt16LE(0)).toBe(0)
      expect(ico.readUInt16LE(2)).toBe(1)
      for (const f of ["icons/128x128.png", "icons/icon.png"]) expect(fs.existsSync(path.join(srcTauri, f))).toBe(true)

      for (const f of ["main.rs", "lib.rs", "tray.rs", "commands/mod.rs"]) {
        expect(fs.existsSync(path.join(srcTauri, "src", f)), f).toBe(true)
      }
      const fsDialog = fs.readFileSync(path.join(srcTauri, "src/commands/fs_dialog.rs"), "utf-8")
      for (const s of ["pub async fn save_project_native", "pub async fn load_project_native", "pub async fn pick_open_project_native", "pub async fn pick_save_project_native", "PickedPaths", "File extension must be .shaderstudio or .json", "File not found:", "validate_project_path"]) {
        expect(fsDialog).toContain(s)
      }
      // stub MCP protocol removed; tray explains how to connect the real stdio server instead
      expect(fs.existsSync(path.join(srcTauri, "src/commands/mcp_bridge.rs"))).toBe(false)
      const tray = fs.readFileSync(path.join(srcTauri, "src/tray.rs"), "utf-8")
      expect(tray).toContain("mcp-server.js")
      expect(tray).not.toContain("tray-start-mcp")
    })
  })

  describe("runtime detection", () => {
    it("is false without Tauri globals and true with __TAURI_INTERNALS__ or __TAURI__.core", () => {
      expect(isTauri()).toBe(false)
      withTauri(vi.fn())
      expect(isTauri()).toBe(true)
      withTauri(vi.fn(), "__TAURI__")
      expect(isTauri()).toBe(true)
    })
  })

  describe("save/load in the browser fallback", () => {
    it("round-trips a project and overwrites on repeat saves", async () => {
      const p = "C:/ShaderProjects/hero.shaderstudio"
      const data = JSON.stringify({ name: "TestProject", version: 1, graph: { nodes: [], edges: [] } })
      expect(await saveProjectNative(p, data)).toBe(p)
      expect(await loadProjectNative(p)).toEqual([p, data])

      for (const revision of [2, 3]) {
        await saveProjectNative(p, JSON.stringify({ revision }))
        expect(JSON.parse((await loadProjectNative(p))[1]).revision).toBe(revision)
      }
    })

    it("uses the default .shaderstudio path only when path is undefined", async () => {
      const def = getDefaultProjectPath()
      expect(def.endsWith(".shaderstudio")).toBe(true)
      expect(await saveProjectNative(undefined, '{"d":1}')).toBe(def)
      expect(await saveProjectNative()).toBe(def)
      expect((await loadProjectNative())[0]).toBe(def)
    })

    it("rejects every path that does not end exactly in lowercase .shaderstudio", async () => {
      for (const p of [
        "",
        "   ",
        "\t",
        " \t \r\n ",
        "C:/temp/test.json",
        "C:/temp/test.txt",
        "C:/temp/test",
        "C:/temp/test.shader",
        "project.shaderstudio.bak",
        "project.shaderstudio.tmp",
        "project.shaderstudio.json",
        "project.shaderstudio.1",
        "project.shaderstudioo",
        "project.shaderstudio_extra",
        "exploit.shaderstudio.exe",
        "exploit.shaderstudio.ps1",
        "project.shaderstudio ",
        "project.shaderstudio\t",
        "project.shaderstudio\n",
        "project.shaderstudio/",
        "project.shaderstudio\\",
        "project.shaderstudio/file",
        "project.SHADERSTUDIO",
        "project.ShaderStudio",
        "project.shaderStudio",
        "shaderstudio",
        ".shader",
        "file.studio",
      ]) {
        await expect(saveProjectNative(p, "{}"), JSON.stringify(p)).rejects.toThrow("File extension must be .shaderstudio")
      }
    })

    it("accepts dotted, spaced, hidden and traversal-looking names that end in .shaderstudio", async () => {
      for (const p of [
        "my.project.v2.0.shaderstudio",
        "test...dots.shaderstudio",
        ".hidden.shaderstudio",
        "archive.2026.04.17.shaderstudio",
        "C:/My Shader Studio Projects/New Hero Shader 2026.shaderstudio",
        "../../projects/outside.shaderstudio",
      ]) {
        expect(await saveProjectNative(p, JSON.stringify({ p }))).toBe(p)
        expect(JSON.parse((await loadProjectNative(p))[1]).p).toBe(p)
      }
    })

    it("throws File not found for unknown paths and for undefined with empty storage", async () => {
      await expect(loadProjectNative("C:/temp/missing_file.shaderstudio")).rejects.toThrow(
        /File not found: C:\/temp\/missing_file\.shaderstudio/
      )
      await expect(loadProjectNative(undefined)).rejects.toThrow("File not found: undefined")
    })

    it("preserves unicode, escapes and large payloads byte-for-byte", async () => {
      const payload = JSON.stringify(
        {
          name: "\u{1F680} Supernova \u{1F525}",
          formula: "\u222B sin(\u03B8) d\u03B8, \u03BB = 550nm",
          author: "\u65E5\u672C\u8A9E \u4E2D\u6587 \uD55C\uAD6D\uC5B4 \u0420\u0443\u0441\u0441\u043A\u0438\u0439",
          glsl: 'void main() { // "quotes", \\back\\, \t tabs, \r\n }',
        },
        null,
        2
      )
      await saveProjectNative("C:/p/unicode.shaderstudio", payload)
      expect((await loadProjectNative("C:/p/unicode.shaderstudio"))[1]).toBe(payload)

      const nodes = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, data: { expr: `sin(uv.x * ${i}.0)` } }))
      const big = JSON.stringify({ nodes })
      await saveProjectNative("C:/p/big.shaderstudio", big)
      const [, back] = await loadProjectNative("C:/p/big.shaderstudio")
      expect(back.length).toBe(big.length)
      expect(JSON.parse(back).nodes[999].id).toBe("n999")
    })

    it("resetDesktopFallbackState clears saved projects, bridge and tray", async () => {
      await saveProjectNative("a.shaderstudio", "{}")
      await startMcpBridge(4300)
      setupTray()
      resetDesktopFallbackState()
      await expect(loadProjectNative("a.shaderstudio")).rejects.toThrow(/File not found/)
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(isTrayActive()).toBe(false)
    })
  })

  describe("default project path resolution", () => {
    const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
      const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
      try {
        for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v)
        fn()
      } finally {
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
      }
    }

    it("prefers USERPROFILE (normalising backslashes), then HOME, then a relative path", () => {
      withEnv({ USERPROFILE: "C:\\Users\\Alice", HOME: undefined }, () => {
        const p = getDefaultProjectPath()
        expect(p).toBe("C:/Users/Alice/Documents/ShaderStudio/untitled.shaderstudio")
        expect(p).not.toContain("\\")
      })
      withEnv({ USERPROFILE: undefined, HOME: "/home/developer" }, () => {
        expect(getDefaultProjectPath()).toBe("/home/developer/Documents/ShaderStudio/untitled.shaderstudio")
      })
      withEnv({ USERPROFILE: undefined, HOME: undefined }, () => {
        expect(getDefaultProjectPath()).toBe("./untitled.shaderstudio")
      })
    })
  })

  describe("native IPC dispatch (Tauri runtime)", () => {
    it("sends save args with camelCase projectJson (Tauri v2 maps snake_case Rust args to camelCase)", async () => {
      const invoke = vi.fn(async (cmd: string, args: any) => (cmd === "save_project_native" ? args.path : null))
      withTauri(invoke)
      expect(await saveProjectNative("C:/test/mock.shaderstudio", '{"mocked":true}')).toBe("C:/test/mock.shaderstudio")
      expect(invoke).toHaveBeenCalledWith("save_project_native", {
        path: "C:/test/mock.shaderstudio",
        projectJson: '{"mocked":true}',
      })
    })

    it("forwards the default path when path is undefined, and rejects bad extensions before IPC", async () => {
      const invoke = vi.fn(async (_cmd: string, args: any) => args.path)
      withTauri(invoke)
      const def = getDefaultProjectPath()
      expect(await saveProjectNative(undefined, '{"data":1}')).toBe(def)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith("save_project_native", { path: def, projectJson: '{"data":1}' })

      invoke.mockClear()
      await expect(saveProjectNative("malicious.shaderstudio.bak", "{}")).rejects.toThrow("File extension must be .shaderstudio")
      await expect(saveProjectNative("", "{}")).rejects.toThrow("File extension must be .shaderstudio")
      expect(invoke).not.toHaveBeenCalled()
    })

    it("dispatches load through __TAURI_INTERNALS__ with the right args; the MCP shim never calls native", async () => {
      const invoke = vi.fn(async (cmd: string, args: any) => {
        if (cmd === "load_project_native") return [args.path, '{"mocked":true}']
        return null
      })
      withTauri(invoke)
      expect(await loadProjectNative("C:/test/mock.shaderstudio")).toEqual(["C:/test/mock.shaderstudio", '{"mocked":true}'])
      expect(invoke).toHaveBeenCalledWith("load_project_native", { path: "C:/test/mock.shaderstudio" })
      invoke.mockClear()
      expect(await startMcpBridge(8080)).toBe("MCP Bridge active on port 8080")
      expect(await getMcpBridgeStatus()).toBe(true)
      stopMcpBridge()
      expect(invoke).not.toHaveBeenCalled()
    })

    it("calls parameterless commands with exactly one argument and args commands with exactly two", async () => {
      for (const key of ["__TAURI_INTERNALS__", "__TAURI__"] as const) {
        const calls: { cmd: string; n: number; args: unknown }[] = []
        const invoke = vi.fn((...a: any[]) => {
          calls.push({ cmd: a[0], n: a.length, args: a[1] })
          if (a[0] === "save_project_native") return Promise.resolve(a[1].path)
          if (a[0] === "load_project_native") return Promise.resolve([a[1].path, "{}"])
          if (a[0] === "pick_open_project_native") return Promise.resolve("/o.shaderstudio")
          if (a[0] === "pick_save_project_native") return Promise.resolve("/s.shaderstudio")
          return Promise.resolve(undefined)
        })
        withTauri(invoke, key)

        minimizeWindow()
        maximizeWindow()
        closeWindow()
        await flush()
        expect(calls.map((c) => c.cmd)).toEqual([
          "plugin:window|minimize",
          "plugin:window|toggle_maximize",
          "plugin:window|close",
        ])
        for (const c of calls) {
          expect(c.n).toBe(1)
          expect(c.args).toBeUndefined()
        }

        calls.length = 0
        await saveProjectNative("foo.shaderstudio", '{"data":123}')
        await loadProjectNative("foo.shaderstudio")
        await pickOpenProjectPath()
        await pickSaveProjectPath("default.shaderstudio")
        expect(calls.filter((c) => c.cmd !== "pick_open_project_native").every((c) => c.n === 2 && typeof c.args === "object" && c.args !== null)).toBe(true)
        expect(calls[2]).toMatchObject({ cmd: "pick_open_project_native", n: 1, args: undefined })
        expect(calls[0]).toMatchObject({ cmd: "save_project_native", args: { path: "foo.shaderstudio", projectJson: '{"data":123}' } })
        expect(calls[1]).toMatchObject({ cmd: "load_project_native", args: { path: "foo.shaderstudio" } })
        expect(calls[3]).toMatchObject({ cmd: "pick_save_project_native", args: { defaultPath: "default.shaderstudio" } })
        // The webview never talks to the dialog plugin directly: only the Rust commands (which record the path) open dialogs.
        expect(calls.some((c) => c.cmd.startsWith("plugin:dialog"))).toBe(false)
      }
    })

    it("propagates native save/load errors and never falls back to the in-memory store", async () => {
      const target = "C:/Projects/important.shaderstudio"
      const invoke = vi.fn().mockRejectedValue(new Error("Disk full (os error 112)"))
      withTauri(invoke)
      await expect(saveProjectNative(target, '{"data":"critical"}')).rejects.toThrow("Disk full (os error 112)")
      await expect(loadProjectNative(target)).rejects.toThrow("Disk full (os error 112)")

      delete g.window.__TAURI_INTERNALS__
      await expect(loadProjectNative(target)).rejects.toThrow(`File not found: ${target}`)
    })
  })

  describe("native dialogs", () => {
    it("return null outside Tauri", async () => {
      expect(await pickOpenProjectPath()).toBeNull()
      expect(await pickSaveProjectPath("x.shaderstudio")).toBeNull()
    })

    it("open: calls the recording Rust command and maps cancel/error to null", async () => {
      const invoke = vi.fn().mockResolvedValue("C:/Chosen/hero.shaderstudio")
      withTauri(invoke)
      expect(await pickOpenProjectPath()).toBe("C:/Chosen/hero.shaderstudio")
      expect(invoke).toHaveBeenCalledWith("pick_open_project_native")
      expect(invoke).not.toHaveBeenCalledWith("plugin:dialog|open", expect.anything())

      invoke.mockResolvedValueOnce(null)
      expect(await pickOpenProjectPath()).toBeNull()
      invoke.mockRejectedValueOnce(new Error("Dialog plugin crashed"))
      expect(await pickOpenProjectPath()).toBeNull()
    })

    it("save: calls the recording Rust command with defaultPath and maps cancel/error to null", async () => {
      const invoke = vi.fn().mockResolvedValue("C:/Saved/my_shader.shaderstudio")
      withTauri(invoke)
      expect(await pickSaveProjectPath("my_shader.shaderstudio")).toBe("C:/Saved/my_shader.shaderstudio")
      expect(invoke).toHaveBeenCalledWith("pick_save_project_native", { defaultPath: "my_shader.shaderstudio" })
      invoke.mockResolvedValueOnce(null)
      expect(await pickSaveProjectPath()).toBeNull()
      invoke.mockRejectedValueOnce(new Error("boom"))
      expect(await pickSaveProjectPath()).toBeNull()
    })
  })

  describe("MCP bridge lifecycle", () => {
    it("starts, reports, restarts on a new port, and stops", async () => {
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
      expect(await startMcpBridge(4200)).toBe("MCP Bridge active on port 4200")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(4200)
      await startMcpBridge(4201)
      expect(getMcpBridgePort()).toBe(4201)
      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("rejects ports outside 1025..65535 (including infinities) and accepts the boundaries", async () => {
      for (const p of [0, 1, 21, 80, 443, 1024, -1, -80, -65535, 65536, 70000, 999999, Infinity, -Infinity]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
      expect(await startMcpBridge(1025)).toContain("port 1025")
      stopMcpBridge()
      expect(await startMcpBridge(65535)).toContain("port 65535")
      stopMcpBridge()
    })

    it("rejects NaN and non-integer ports", async () => {
      await expect(startMcpBridge(NaN)).rejects.toThrow(/Invalid port/)
      await expect(startMcpBridge(1025.5)).rejects.toThrow(/Invalid port/)
    })
  })

  describe("window controls and tray", () => {
    it("update local state in the fallback without throwing, and the tray setup is idempotent", () => {
      expect(() => {
        minimizeWindow()
        maximizeWindow()
        maximizeWindow()
        closeWindow()
      }).not.toThrow()
      expect(isTrayActive()).toBe(false)
      setupTray()
      setupTray()
      expect(isTrayActive()).toBe(true)
    })

    it("dispatch plugin:window commands, falling back to the legacy command on rejection", async () => {
      const invoke = vi.fn().mockResolvedValue(undefined)
      withTauri(invoke)
      minimizeWindow()
      maximizeWindow()
      closeWindow()
      expect(invoke).toHaveBeenCalledWith("plugin:window|minimize")
      expect(invoke).toHaveBeenCalledWith("plugin:window|toggle_maximize")
      expect(invoke).toHaveBeenCalledWith("plugin:window|close")

      const failing = vi.fn((cmd: string) => (cmd.startsWith("plugin:window") ? Promise.reject(new Error("no")) : Promise.resolve()))
      withTauri(failing)
      minimizeWindow()
      maximizeWindow()
      closeWindow()
      await flush()
      for (const c of ["minimize_window", "maximize_window", "close_window"]) expect(failing).toHaveBeenCalledWith(c)
      expect(failing.mock.calls.filter((c) => !c[0].startsWith("plugin:")).every((c) => c.length === 1)).toBe(true)
    })

    it("survive total IPC failure without throwing or unhandled rejections", async () => {
      withTauri(vi.fn().mockRejectedValue(new Error("IPC down")))
      expect(() => {
        minimizeWindow()
        maximizeWindow()
        closeWindow()
        stopMcpBridge()
      }).not.toThrow()
      await flush()
    })
  })

  describe("binary size profile validation", () => {
    const FLAGS = ['opt-level = "z"', "lto = true", "codegen-units = 1", 'panic = "abort"', "strip = true"]

    it("accepts a profile with all 5 flags (extra lines allowed) and returns the flag list", () => {
      const res = validateBinarySizeConfig(`[profile.release]\n${FLAGS.join("\n")}\n# note\ndebug = false\n`)
      expect(res.valid).toBe(true)
      expect(res.flags).toEqual(FLAGS)
    })

    it("rejects an empty config or any single missing flag", () => {
      expect(validateBinarySizeConfig("").valid).toBe(false)
      expect(validateBinarySizeConfig('[package]\nname = "foo"').valid).toBe(false)
      for (let i = 0; i < FLAGS.length; i++) {
        const res = validateBinarySizeConfig(FLAGS.filter((_, j) => j !== i).join("\n"))
        expect(res.valid).toBe(false)
        expect(res.flags).toHaveLength(5)
      }
    })
  })

  describe("snake_case aliases", () => {
    it("are the same functions as the camelCase exports", async () => {
      expect(save_project_native).toBe(saveProjectNative)
      expect(load_project_native).toBe(loadProjectNative)
      expect(start_mcp_bridge).toBe(startMcpBridge)
      expect(get_mcp_bridge_status).toBe(getMcpBridgeStatus)
      expect(stop_mcp_bridge).toBe(stopMcpBridge)

      const p = "C:/test/alias.shaderstudio"
      expect(await save_project_native(p, '{"alias":true}')).toBe(p)
      expect((await load_project_native(p))[1]).toBe('{"alias":true}')
      expect(await start_mcp_bridge(3950)).toContain("port 3950")
      expect(await get_mcp_bridge_status()).toBe(true)
      stop_mcp_bridge()
      expect(await get_mcp_bridge_status()).toBe(false)
    })
  })
})

describe("Tier 5: Comprehensive White-Box Adversarial Coverage & Boundary Hardening", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    subGraphLibrary.reset()
    customNodeRegistry.clear()
    customNodeRegistry.discoverBuiltinNodes()
    resetDesktopFallbackState()
    performanceTelemetry.reset()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BATTERY 4: R4 Desktop Tauri v2 Bridge Boundary & Safety Probes
  // ==========================================================================
  describe("Battery 4: R4 Desktop Tauri v2 Bridge Boundary & Safety Probes", () => {
    it("4.1 getDefaultProjectPath resolves cross-platform file path", () => {
      const path = getDefaultProjectPath()
      expect(path).toMatch(/untitled\.shaderstudio$/)
    })

    it("4.2 saveProjectNative strictly enforces .shaderstudio file extension", async () => {
      await expect(saveProjectNative("my_project.json", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      await expect(saveProjectNative("my_project.txt", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      await expect(saveProjectNative("my_project.shaderstudio.bak", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )

      // Valid path succeeds
      const savedPath = await saveProjectNative("project_1.shaderstudio", '{"name":"P1"}')
      expect(savedPath).toBe("project_1.shaderstudio")

      // Load round-trip
      const [loadedPath, content] = await loadProjectNative("project_1.shaderstudio")
      expect(loadedPath).toBe("project_1.shaderstudio")
      expect(content).toBe('{"name":"P1"}')

      // Non-existent load throws
      await expect(loadProjectNative("non_existent.shaderstudio")).rejects.toThrow(
        "File not found: non_existent.shaderstudio"
      )
    })

    it("4.3 startMcpBridge rejects invalid ports and manages lifecycle", async () => {
      // Privileged / low ports (<= 1024)
      await expect(startMcpBridge(80)).rejects.toThrow(/Invalid port: 80\. Must be between 1025 and 65535/)
      await expect(startMcpBridge(1024)).rejects.toThrow(/Invalid port: 1024\. Must be between 1025 and 65535/)

      // High ports (> 65535)
      await expect(startMcpBridge(65536)).rejects.toThrow(/Invalid port: 65536\. Must be between 1025 and 65535/)
      await expect(startMcpBridge(70000)).rejects.toThrow(/Invalid port: 70000\. Must be between 1025 and 65535/)

      // Valid port succeeds
      const msg = await startMcpBridge(8999)
      expect(msg).toContain("8999")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(8999)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("4.4 window and tray desktop controls execute gracefully", () => {
      expect(() => minimizeWindow()).not.toThrow()
      expect(() => maximizeWindow()).not.toThrow()
      expect(() => closeWindow()).not.toThrow()

      expect(isTrayActive()).toBe(false)
      setupTray()
      expect(isTrayActive()).toBe(true)
    })

    it("4.5 validateBinarySizeConfig checks all 5 release optimization flags", () => {
      const validCargo = `
        [profile.release]
        opt-level = "z"
        lto = true
        codegen-units = 1
        panic = "abort"
        strip = true
      `
      expect(validateBinarySizeConfig(validCargo).valid).toBe(true)

      const incompleteCargo = `
        [profile.release]
        opt-level = "z"
        lto = true
      `
      expect(validateBinarySizeConfig(incompleteCargo).valid).toBe(false)
    })
  })
})
