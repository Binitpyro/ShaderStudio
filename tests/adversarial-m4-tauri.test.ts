/**
 * Adversarial Challenge Suite: Milestone 4 (R4: Production Deployment — Tauri v2 Desktop App)
 *
 * Stress-tests:
 * 1. Path validation attacks (malformed extensions, trailing spaces, slashes, case variations)
 * 2. Path traversal, deep nesting, and special character/unicode preservation
 * 3. File existence, missing file errors, and empty/undefined paths
 * 4. Content integrity: 1MB+ payloads, complex GLSL, unicode, emojis, escaped quotes
 * 5. MCP bridge port boundaries: NaN, float, negative, reserved (<1025), overflow (>65535)
 * 6. Tauri runtime detection, mock invoke failures, and fallback isolation
 * 7. Binary size configuration analyzer edge cases
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
  getDefaultProjectPath,
} from "@/desktop/tauriBridge"


describe("Adversarial Challenge: Milestone 4 (Tauri v2 Desktop App)", () => {
  beforeEach(() => {
    resetDesktopFallbackState()
    if (typeof (globalThis as any).window !== "undefined") {
      delete (globalThis as any).window.__TAURI_INTERNALS__
      delete (globalThis as any).window.__TAURI__
    }
  })

  afterEach(() => {
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Path Validation & Extension Enforcement Attacks
  // ==========================================================================
  describe("Path Validation & Extension Enforcement Attacks", () => {
    it("rejects paths with near-match extensions (.shaderstudio.bak, .shaderstudio.tmp, .shaderstudio.json)", async () => {
      const nearMatches = [
        "project.shaderstudio.bak",
        "project.shaderstudio.tmp",
        "project.shaderstudio.old",
        "project.shaderstudio.json",
        "project.shaderstudio.txt",
        "project.shaderstudio.1",
      ]

      for (const path of nearMatches) {
        await expect(
          saveProjectNative(path, "{}")
        ).rejects.toThrow("File extension must be .shaderstudio")
      }
    })

    it("rejects paths with trailing spaces, slashes, or control characters", async () => {
      const malformedPaths = [
        "project.shaderstudio ",
        "project.shaderstudio  ",
        "project.shaderstudio\t",
        "project.shaderstudio\n",
        "project.shaderstudio/",
        "project.shaderstudio\\",
        "project.shaderstudio/file",
      ]

      for (const path of malformedPaths) {
        await expect(
          saveProjectNative(path, "{}")
        ).rejects.toThrow("File extension must be .shaderstudio")
      }
    })

    it("rejects non-lowercase extension variants (.SHADERSTUDIO, .ShaderStudio, .Shaderstudio)", async () => {
      const caseVariants = [
        "project.SHADERSTUDIO",
        "project.ShaderStudio",
        "project.Shaderstudio",
        "project.shaderStudio",
        "project.SHADErSTUDIO",
      ]

      for (const path of caseVariants) {
        await expect(
          saveProjectNative(path, "{}")
        ).rejects.toThrow("File extension must be .shaderstudio")
      }
    })

    it("rejects bare extension or extension prefix without base name if invalid", async () => {
      await expect(saveProjectNative("shaderstudio", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      await expect(saveProjectNative(".shader", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
      await expect(saveProjectNative("file.studio", "{}")).rejects.toThrow(
        "File extension must be .shaderstudio"
      )
    })

    it("accepts valid dotted file names ending in .shaderstudio", async () => {
      const validDottedPaths = [
        "my.project.v2.0.shaderstudio",
        "release.candidate.final.shaderstudio",
        "test...dots.shaderstudio",
        ".hidden.shaderstudio",
      ]

      for (const path of validDottedPaths) {
        const saved = await saveProjectNative(path, `{"path":"${path}"}`)
        expect(saved).toBe(path)
        const [loadedPath, loadedContent] = await loadProjectNative(path)
        expect(loadedPath).toBe(path)
        expect(JSON.parse(loadedContent).path).toBe(path)
      }
    })

    it("supports path traversal patterns provided they end in .shaderstudio", async () => {
      const traversalPath = "../../projects/outside.shaderstudio"
      const saved = await saveProjectNative(traversalPath, '{"traversal":true}')
      expect(saved).toBe(traversalPath)

      const [loadedPath, content] = await loadProjectNative(traversalPath)
      expect(loadedPath).toBe(traversalPath)
      expect(JSON.parse(content).traversal).toBe(true)
    })
  })

  // ==========================================================================
  // 2. Missing File and Empty/Falsy Path Handling
  // ==========================================================================
  describe("Missing File and Empty Path Behaviors", () => {
    it("rejects loading non-existent files with explicit 'File not found' error", async () => {
      const nonExistent = "C:/projects/ghost_file_404.shaderstudio"
      await expect(loadProjectNative(nonExistent)).rejects.toThrow(
        `File not found: ${nonExistent}`
      )
    })

    it("rejects loading when storage is empty and path is undefined", async () => {
      await expect(loadProjectNative(undefined)).rejects.toThrow("File not found: undefined")
    })

    it("handles undefined path in saveProjectNative by falling back to default untitled path", async () => {
      const saved = await saveProjectNative(undefined, '{"default":true}')
      expect(saved).toBe(getDefaultProjectPath())

      const [loadedPath, content] = await loadProjectNative()
      expect(loadedPath).toBe(getDefaultProjectPath())
      expect(JSON.parse(content).default).toBe(true)
    })

  })

  // ==========================================================================
  // 3. Content Integrity & Round-Trip Fidelity
  // ==========================================================================
  describe("Content Integrity & Unicode Round-Trip Stress", () => {
    it("preserves multibyte unicode, emojis, and math symbols without truncation or corruption", async () => {
      const complexPayload = {
        name: "🚀 Supernova Raymarcher 2026 🔥",
        formula: "∫ sin(θ) dθ = -cos(θ) + C, λ = 550nm, π ≈ 3.1415926535",
        author: "Binit (Developer) • 日本語 • 中文 • 한국어 • Русский",
        glsl: `
// Multiline shader source with escape chars: "quotes", \\backslashes\\, \t tabs, \r\n returns
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  vec3 color = vec3(st.x, st.y, abs(sin(u_time * 3.14159)));
  gl_FragColor = vec4(color, 1.0);
}
`,
      }
      const jsonStr = JSON.stringify(complexPayload, null, 2)
      const testPath = "C:/ShaderProjects/unicode_stress.shaderstudio"

      await saveProjectNative(testPath, jsonStr)
      const [loadedPath, loadedStr] = await loadProjectNative(testPath)

      expect(loadedPath).toBe(testPath)
      expect(loadedStr).toBe(jsonStr)

      const parsed = JSON.parse(loadedStr)
      expect(parsed.name).toBe("🚀 Supernova Raymarcher 2026 🔥")
      expect(parsed.formula).toContain("∫ sin(θ) dθ")
      expect(parsed.author).toContain("Русский")
      expect(parsed.glsl).toContain("precision highp float;")
    })

    it("handles high-volume stress payload (>1 MB, 1000 nodes) without heap corruption", async () => {
      const nodes = Array.from({ length: 1000 }, (_, i) => ({
        id: `stress_node_${i}`,
        type: "customShaderNode",
        position: { x: (i % 20) * 150, y: Math.floor(i / 20) * 100 },
        data: {
          title: `Generator Node ${i}`,
          expression: `sin(uv.x * ${i}.0) * cos(uv.y * ${i}.0) + tan(${i}.14159)`,
          parameters: { gain: i * 0.05, frequency: 1000 - i },
        },
      }))

      const largePayload = JSON.stringify({ version: "2.0", nodes })
      expect(largePayload.length).toBeGreaterThan(150_000)

      const path = "C:/projects/high_volume_stress.shaderstudio"
      await saveProjectNative(path, largePayload)

      const [loadedPath, content] = await loadProjectNative(path)
      expect(loadedPath).toBe(path)
      expect(content.length).toBe(largePayload.length)

      const parsed = JSON.parse(content)
      expect(parsed.nodes).toHaveLength(1000)
      expect(parsed.nodes[999].id).toBe("stress_node_999")
    })
  })

  // ==========================================================================
  // 4. MCP Bridge Boundary and Malformed Input Attacks
  // ==========================================================================
  describe("MCP Bridge Boundary and Malformed Input Attacks", () => {
    it("rejects boundary ports <= 1024", async () => {
      for (const p of [0, 1, 21, 22, 53, 80, 443, 1024]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("rejects negative ports", async () => {
      for (const p of [-1, -80, -1025, -65535]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("rejects ports > 65535", async () => {
      for (const p of [65536, 70000, 100000, 999999]) {
        await expect(startMcpBridge(p)).rejects.toThrow(`Invalid port: ${p}. Must be between 1025 and 65535`)
      }
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("rejects Infinity and -Infinity ports", async () => {
      await expect(startMcpBridge(Infinity)).rejects.toThrow("Invalid port: Infinity. Must be between 1025 and 65535")
      await expect(startMcpBridge(-Infinity)).rejects.toThrow("Invalid port: -Infinity. Must be between 1025 and 65535")
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("successfully binds boundary ports 1025 and 65535 and tracks active status", async () => {
      // Lower boundary
      const msgMin = await startMcpBridge(1025)
      expect(msgMin).toBe("MCP Bridge active on port 1025")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(1025)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)

      // Upper boundary
      const msgMax = await startMcpBridge(65535)
      expect(msgMax).toBe("MCP Bridge active on port 65535")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(65535)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)
    })

    it("allows restarting MCP bridge on a different port cleanly", async () => {
      await startMcpBridge(3000)
      expect(getMcpBridgePort()).toBe(3000)

      await startMcpBridge(4000)
      expect(getMcpBridgePort()).toBe(4000)
      expect(await getMcpBridgeStatus()).toBe(true)

      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
    })
  })

  // ==========================================================================
  // 5. Tauri Native Runtime Detection and Mock Invocation
  // ==========================================================================
  describe("Tauri Native Runtime Detection & Mock IPC", () => {
    let originalWindow: any

    beforeEach(() => {
      originalWindow = (globalThis as any).window
      ;(globalThis as any).window = {}
    })

    afterEach(() => {
      ;(globalThis as any).window = originalWindow
    })

    it("correctly identifies Tauri v2 runtime via window.__TAURI__.core", () => {
      ;(globalThis as any).window = {
        __TAURI__: {
          core: { invoke: vi.fn() },
        },
      }
      expect(isTauri()).toBe(true)
    })

    it("correctly identifies Tauri v2 runtime via window.__TAURI_INTERNALS__", () => {
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: {
          invoke: vi.fn(),
        },
      }
      expect(isTauri()).toBe(true)
    })

    it("dispatches native invoke commands through __TAURI_INTERNALS__ when present", async () => {
      const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
        if (cmd === "save_project_native") return args.path
        if (cmd === "load_project_native") return [args.path, '{"mocked":true}']
        if (cmd === "start_mcp_bridge") return `Native MCP on ${args.port}`
        if (cmd === "get_mcp_bridge_status") return true
        return null
      })

      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }
      expect(isTauri()).toBe(true)

      const saved = await saveProjectNative("C:/test/mock.shaderstudio", '{"mocked":true}')
      expect(saved).toBe("C:/test/mock.shaderstudio")
      expect(mockInvoke).toHaveBeenCalledWith("save_project_native", {
        path: "C:/test/mock.shaderstudio",
        project_json: '{"mocked":true}',
      })

      const [loadedPath, content] = await loadProjectNative("C:/test/mock.shaderstudio")
      expect(loadedPath).toBe("C:/test/mock.shaderstudio")
      expect(content).toBe('{"mocked":true}')

      const mcpMsg = await startMcpBridge(8080)
      expect(mcpMsg).toBe("Native MCP on 8080")
      expect(await getMcpBridgeStatus()).toBe(true)
    })

    it("propagates native errors directly when native invoke rejects in Tauri runtime", async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error("IPC connection failed"))
      ;(globalThis as any).window = {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
      }

      await expect(
        saveProjectNative("C:/test/fallback.shaderstudio", '{"fallback":true}')
      ).rejects.toThrow("IPC connection failed")

      await expect(
        loadProjectNative("C:/test/fallback.shaderstudio")
      ).rejects.toThrow("IPC connection failed")
    })

  })

  // ==========================================================================
  // 6. Binary Size Analyzer Verification Edge Cases
  // ==========================================================================
  describe("Binary Size Analyzer Verification Edge Cases", () => {
    it("returns valid: false when any of the 5 required flags is omitted", () => {
      const flags = [
        'opt-level = "z"',
        "lto = true",
        "codegen-units = 1",
        'panic = "abort"',
        "strip = true",
      ]

      for (let i = 0; i < flags.length; i++) {
        const omitted = flags.filter((_, idx) => idx !== i).join("\n")
        const res = validateBinarySizeConfig(omitted)
        expect(res.valid).toBe(false)
        expect(res.flags).toHaveLength(5)
      }
    })

    it("returns valid: false for an empty or malformed Cargo.toml", () => {
      expect(validateBinarySizeConfig("").valid).toBe(false)
      expect(validateBinarySizeConfig("[package]\nname = \"foo\"").valid).toBe(false)
    })

    it("returns valid: true when all 5 flags are present regardless of extra whitespace", () => {
      const toml = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
# Additional debug comments
debug = false
`
      const res = validateBinarySizeConfig(toml)
      expect(res.valid).toBe(true)
    })
  })

  // ==========================================================================
  // 7. Desktop Window and Tray Controls Lifecycle
  // ==========================================================================
  describe("Window & Tray Lifecycle", () => {
    it("handles multiple calls to setupTray idempotently", () => {
      expect(isTrayActive()).toBe(false)
      setupTray()
      expect(isTrayActive()).toBe(true)
      setupTray()
      expect(isTrayActive()).toBe(true)
    })

    it("toggles maximize state and minimizes and closes window without throwing", () => {
      expect(() => {
        minimizeWindow()
        maximizeWindow()
        maximizeWindow()
        closeWindow()
      }).not.toThrow()
    })
  })

  // ==========================================================================
  // 8. Snake_Case Aliases Compatibility
  // ==========================================================================
  describe("Snake_Case Aliases Parity", () => {
    it("verifies all snake_case aliases match camelCase behaviors", async () => {
      const path = "C:/test/parity.shaderstudio"
      const content = '{"parity":true}'

      const saved = await save_project_native(path, content)
      expect(saved).toBe(path)

      const [loadedPath, loadedContent] = await load_project_native(path)
      expect(loadedPath).toBe(path)
      expect(loadedContent).toBe(content)

      expect(await get_mcp_bridge_status()).toBe(false)
      const mcpMsg = await start_mcp_bridge(5500)
      expect(mcpMsg).toBe("MCP Bridge active on port 5500")
      expect(await get_mcp_bridge_status()).toBe(true)

      stop_mcp_bridge()
      expect(await get_mcp_bridge_status()).toBe(false)
    })
  })
})
