import { describe, it, expect, beforeEach } from "vitest"
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
  save_project_native,
  load_project_native,
  start_mcp_bridge,
  get_mcp_bridge_status,
  stop_mcp_bridge,
} from "@/desktop/tauriBridge"

describe("Milestone 4: Tauri v2 Desktop App (R4)", () => {
  beforeEach(() => {
    resetDesktopFallbackState()
  })

  // ==========================================================================
  // Real Workspace Files Verification
  // ==========================================================================
  describe("src-tauri Workspace Structure & Real File Integrity", () => {
    const srcTauriDir = path.resolve(__dirname, "../src-tauri")

    it("verifies src-tauri/Cargo.toml exists and contains valid package, lib, dependencies, and release profile", () => {
      const cargoTomlPath = path.join(srcTauriDir, "Cargo.toml")
      expect(fs.existsSync(cargoTomlPath)).toBe(true)
      const cargoToml = fs.readFileSync(cargoTomlPath, "utf-8")

      expect(cargoToml).toContain('name = "shaderstudio-desktop"')
      expect(cargoToml).toContain('name = "shaderstudio_desktop_lib"')
      expect(cargoToml).toContain('edition = "2021"')
      expect(cargoToml).toContain('tauri = { version = "2.2"')
      expect(cargoToml).toContain('tauri-plugin-dialog = "2.2"')
      expect(cargoToml).toContain('tauri-plugin-fs = "2.2"')
      expect(cargoToml).toContain('tauri-plugin-shell = "2.2"')
      expect(cargoToml).toContain("serde")
      expect(cargoToml).toContain("tokio")
      expect(cargoToml).toContain("warp")
      expect(cargoToml).toContain("futures-util")
      expect(cargoToml).toContain("tauri-build")

      // Check all 5 binary slimming flags
      const validation = validateBinarySizeConfig(cargoToml)
      expect(validation.valid).toBe(true)
      expect(validation.flags).toHaveLength(5)
    })

    it("verifies src-tauri/tauri.conf.json exists, is valid JSON, and adheres to F-DESK-01 schema", () => {
      const confPath = path.join(srcTauriDir, "tauri.conf.json")
      expect(fs.existsSync(confPath)).toBe(true)
      const confRaw = fs.readFileSync(confPath, "utf-8")
      const conf = JSON.parse(confRaw)

      expect(conf.identifier).toBe("com.shaderstudio.app")
      expect(conf.productName).toBe("ShaderStudio")
      expect(conf.build.frontendDist).toBe("../dist")
      expect(conf.build.devUrl).toBe("http://localhost:5173")
      expect(conf.app.windows).toBeInstanceOf(Array)
      expect(conf.app.windows[0].width).toBe(1440)
      expect(conf.app.windows[0].height).toBe(900)
      expect(conf.app.windows[0].minWidth).toBe(1024)
      expect(conf.app.windows[0].minHeight).toBe(700)
      expect(conf.app.trayIcon.iconPath).toBe("icons/icon.png")
      expect(conf.bundle.active).toBe(true)
      expect(conf.bundle.targets).toBe("all")
      expect(conf.bundle.icon).toEqual(
        expect.arrayContaining([
          "icons/32x32.png",
          "icons/128x128.png",
          "icons/icon.ico",
          "icons/icon.png",
        ])
      )
    })

    it("verifies src-tauri/capabilities/default.json exists and configures required desktop permissions", () => {
      const capPath = path.join(srcTauriDir, "capabilities/default.json")
      expect(fs.existsSync(capPath)).toBe(true)
      const cap = JSON.parse(fs.readFileSync(capPath, "utf-8"))

      expect(cap.identifier).toBe("default")
      expect(cap.windows).toContain("main")
      expect(cap.permissions).toContain("core:default")
      expect(cap.permissions).toContain("dialog:default")
      expect(cap.permissions).toContain("dialog:allow-open")
      expect(cap.permissions).toContain("dialog:allow-save")
      expect(cap.permissions).toContain("fs:default")
      expect(cap.permissions).toContain("fs:allow-read-text-file")
      expect(cap.permissions).toContain("fs:allow-write-text-file")
      expect(cap.permissions).toContain("fs:allow-read-file")
      expect(cap.permissions).toContain("fs:allow-write-file")
      expect(cap.permissions).toContain("shell:allow-open")
    })

    it("verifies src-tauri/build.rs exists and invokes tauri_build::build()", () => {
      const buildRsPath = path.join(srcTauriDir, "build.rs")
      expect(fs.existsSync(buildRsPath)).toBe(true)
      const content = fs.readFileSync(buildRsPath, "utf-8")
      expect(content).toContain("tauri_build::build()")
    })

    it("verifies src-tauri/icons/ contains genuine, valid PNG and ICO assets", () => {
      const iconsDir = path.join(srcTauriDir, "icons")
      const icon32 = path.join(iconsDir, "32x32.png")
      const icon128 = path.join(iconsDir, "128x128.png")
      const icon512 = path.join(iconsDir, "icon.png")
      const iconIco = path.join(iconsDir, "icon.ico")

      expect(fs.existsSync(icon32)).toBe(true)
      expect(fs.existsSync(icon128)).toBe(true)
      expect(fs.existsSync(icon512)).toBe(true)
      expect(fs.existsSync(iconIco)).toBe(true)

      // PNG magic number check: 0x89 0x50 0x4E 0x47 (0x89 'P' 'N' 'G')
      const buf32 = fs.readFileSync(icon32)
      expect(buf32.readUInt8(0)).toBe(0x89)
      expect(buf32.readUInt8(1)).toBe(0x50)
      expect(buf32.readUInt8(2)).toBe(0x4e)
      expect(buf32.readUInt8(3)).toBe(0x47)

      const bufIco = fs.readFileSync(iconIco)
      // ICO header check: reserved = 0, type = 1
      expect(bufIco.readUInt16LE(0)).toBe(0)
      expect(bufIco.readUInt16LE(2)).toBe(1)
    })

    it("verifies src-tauri/src/ contains all genuine Rust modules and command implementations", () => {
      const srcDir = path.join(srcTauriDir, "src")
      const mainRs = path.join(srcDir, "main.rs")
      const libRs = path.join(srcDir, "lib.rs")
      const trayRs = path.join(srcDir, "tray.rs")
      const modRs = path.join(srcDir, "commands/mod.rs")
      const fsDialogRs = path.join(srcDir, "commands/fs_dialog.rs")
      const mcpBridgeRs = path.join(srcDir, "commands/mcp_bridge.rs")

      expect(fs.existsSync(mainRs)).toBe(true)
      expect(fs.existsSync(libRs)).toBe(true)
      expect(fs.existsSync(trayRs)).toBe(true)
      expect(fs.existsSync(modRs)).toBe(true)
      expect(fs.existsSync(fsDialogRs)).toBe(true)
      expect(fs.existsSync(mcpBridgeRs)).toBe(true)

      const fsDialog = fs.readFileSync(fsDialogRs, "utf-8")
      expect(fsDialog).toContain("pub async fn save_project_native")
      expect(fsDialog).toContain("pub async fn load_project_native")
      expect(fsDialog).toContain('File extension must be .shaderstudio')
      expect(fsDialog).toContain('File not found:')

      const mcpBridge = fs.readFileSync(mcpBridgeRs, "utf-8")
      expect(mcpBridge).toContain("pub async fn start_mcp_bridge")
      expect(mcpBridge).toContain("pub async fn get_mcp_bridge_status")
      expect(mcpBridge).toContain("pub async fn stop_mcp_bridge")
      expect(mcpBridge).toContain('Invalid port:')
    })
  })

  // ==========================================================================
  // F-DESK-01: Tauri Environment Detection & Bridge
  // ==========================================================================
  describe("F-DESK-01: Tauri Runtime Detection", () => {
    it("reports false when window.__TAURI_INTERNALS__ is undefined in standard test environment", () => {
      expect(isTauri()).toBe(false)
    })

    it("reports true when window.__TAURI_INTERNALS__ is provided", () => {
      const original = (globalThis as any).window
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: async () => {} },
      }
      expect(isTauri()).toBe(true)
      ;(globalThis as any).window = original
    })
  })

  // ==========================================================================
  // F-DESK-02 & B-DESK-01 & B-DESK-02: Native Save / Load
  // ==========================================================================
  describe("F-DESK-02: Native Save/Load Project Commands", () => {
    it("saves and loads project file round-trip successfully", async () => {
      const projectData = JSON.stringify({
        name: "TestProject",
        version: 1,
        graph: { nodes: [], edges: [] },
      })
      const targetPath = "C:/ShaderProjects/hero.shaderstudio"

      const savedPath = await saveProjectNative(targetPath, projectData)
      expect(savedPath).toBe(targetPath)

      const [loadedPath, loadedContent] = await loadProjectNative(targetPath)
      expect(loadedPath).toBe(targetPath)
      expect(loadedContent).toBe(projectData)
      expect(JSON.parse(loadedContent).name).toBe("TestProject")
    })

    it("uses default path ending in .shaderstudio when path is omitted", async () => {
      const data = JSON.stringify({ name: "DefaultSave" })
      const savedPath = await saveProjectNative(undefined, data)
      expect(savedPath.endsWith(".shaderstudio")).toBe(true)

      const [loadedPath, loadedContent] = await loadProjectNative()
      expect(loadedPath).toBe(savedPath)
      expect(JSON.parse(loadedContent).name).toBe("DefaultSave")
    })

    it("B-DESK-01: Rejects paths without .shaderstudio extension", async () => {
      await expect(
        saveProjectNative("C:/temp/test.json", "{}")
      ).rejects.toThrow("File extension must be .shaderstudio")

      await expect(
        saveProjectNative("C:/temp/test.txt", "{}")
      ).rejects.toThrow("File extension must be .shaderstudio")

      await expect(
        saveProjectNative("C:/temp/test", "{}")
      ).rejects.toThrow("File extension must be .shaderstudio")

      await expect(
        saveProjectNative("C:/temp/test.shader", "{}")
      ).rejects.toThrow("File extension must be .shaderstudio")
    })

    it("B-DESK-02: Rejects non-existent project file with not found error", async () => {
      await expect(
        loadProjectNative("C:/temp/missing_file.shaderstudio")
      ).rejects.toThrow(/File not found: C:\/temp\/missing_file\.shaderstudio/)
    })

    it("B-DESK-02: Rejects load when no project has been saved and path is undefined", async () => {
      await expect(loadProjectNative(undefined)).rejects.toThrow(/File not found/)
    })
  })

  // ==========================================================================
  // F-DESK-03 & B-DESK-03: Native MCP Bridge
  // ==========================================================================
  describe("F-DESK-03: In-Process MCP Server Bridge Command", () => {
    it("reports false initial status and correctly transitions to active and stopped", async () => {
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)

      const msg = await startMcpBridge(4200)
      expect(msg).toBe("MCP Bridge active on port 4200")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(4200)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("B-DESK-03: Rejects ports <= 1024", async () => {
      await expect(startMcpBridge(80)).rejects.toThrow("Invalid port: 80. Must be between 1025 and 65535")
      await expect(startMcpBridge(1024)).rejects.toThrow("Invalid port: 1024. Must be between 1025 and 65535")
      await expect(startMcpBridge(0)).rejects.toThrow("Invalid port: 0. Must be between 1025 and 65535")
      await expect(startMcpBridge(-1)).rejects.toThrow("Invalid port: -1. Must be between 1025 and 65535")
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("B-DESK-03: Rejects ports > 65535", async () => {
      await expect(startMcpBridge(65536)).rejects.toThrow("Invalid port: 65536. Must be between 1025 and 65535")
      await expect(startMcpBridge(70000)).rejects.toThrow("Invalid port: 70000. Must be between 1025 and 65535")
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("accepts boundary ports 1025 and 65535", async () => {
      const msgMin = await startMcpBridge(1025)
      expect(msgMin).toContain("port 1025")
      stopMcpBridge()

      const msgMax = await startMcpBridge(65535)
      expect(msgMax).toContain("port 65535")
      stopMcpBridge()
    })
  })

  // ==========================================================================
  // F-DESK-04: System Tray & Window Controls
  // ==========================================================================
  describe("F-DESK-04: System Tray & Window Controls", () => {
    it("manages system tray lifecycle", () => {
      expect(isTrayActive()).toBe(false)
      setupTray()
      expect(isTrayActive()).toBe(true)
    })

    it("executes window control actions without throwing", () => {
      expect(() => minimizeWindow()).not.toThrow()
      expect(() => maximizeWindow()).not.toThrow()
      expect(() => maximizeWindow()).not.toThrow()
      expect(() => closeWindow()).not.toThrow()
    })
  })

  // ==========================================================================
  // F-DESK-05: Binary Slimming Optimization Profile
  // ==========================================================================
  describe("F-DESK-05: Binary Size Optimization Profile", () => {
    it("validates release profile containing all 5 required slimming flags", () => {
      const completeProfile = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
      const result = validateBinarySizeConfig(completeProfile)
      expect(result.valid).toBe(true)
      expect(result.flags).toEqual([
        'opt-level = "z"',
        "lto = true",
        "codegen-units = 1",
        'panic = "abort"',
        "strip = true",
      ])
    })

    it("detects missing flags individually", () => {
      const missingStrip = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
`
      expect(validateBinarySizeConfig(missingStrip).valid).toBe(false)

      const missingLto = `
[profile.release]
opt-level = "z"
codegen-units = 1
panic = "abort"
strip = true
`
      expect(validateBinarySizeConfig(missingLto).valid).toBe(false)
    })
  })

  // ==========================================================================
  // Snake_case Tauri Aliases Compatibility
  // ==========================================================================
  describe("Snake_case Command Aliases Compatibility", () => {
    it("supports snake_case function exports matching Tauri command identifiers", async () => {
      const path = "C:/test/alias.shaderstudio"
      const content = JSON.stringify({ alias: true })

      const saved = await save_project_native(path, content)
      expect(saved).toBe(path)

      const [loadedPath, loadedContent] = await load_project_native(path)
      expect(loadedPath).toBe(path)
      expect(JSON.parse(loadedContent).alias).toBe(true)

      expect(await get_mcp_bridge_status()).toBe(false)
      const bridgeMsg = await start_mcp_bridge(3950)
      expect(bridgeMsg).toContain("port 3950")
      expect(await get_mcp_bridge_status()).toBe(true)

      stop_mcp_bridge()
      expect(await get_mcp_bridge_status()).toBe(false)
    })
  })
})
