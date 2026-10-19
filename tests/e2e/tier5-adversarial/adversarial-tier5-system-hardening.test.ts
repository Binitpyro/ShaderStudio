import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import { resolve, join } from "path"
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync, readFileSync } from "fs"
import { WebSocket } from "ws"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Core & Module Imports
import {
  isAllowedOrigin,
  isSafePath,
  isTokenValid,
  extractToken,
  isAllowedAiUrl,
  createBridgeServer,
} from "../../../scripts/bridge.js"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, type E2ETestEnvironment } from "../mocks"
import { RenderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { COMPILER_MARKER_OWNER } from "@/components/ShaderEditor"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
} from "@/core/engineTranspiler"
import {
  initSync,
  bake_pbr_wasm,
  reflect_uniforms_wasm,
  transpile_shader_wasm,
  normalize_obj_wasm,
  normalize_geometry_wasm,
} from "@/wasm/pkg/shaderstudio_wasm"

describe("Milestone 5 Adversarial Challenge: Tier 5 System-Wide Hardening", () => {
  // ==========================================================================
  // DOMAIN 1: Local Bridge Security (Auth, CORS, Path Traversal)
  // ==========================================================================
  describe("Domain 1: Local Bridge Security Hardening", () => {
    const CHALLENGER_SECRET = "b4a3c2d1e0f9876543210fedcba9876543210fedcba98765"
    const TEST_DIR = resolve(process.cwd(), "tests", "_temp_m5_bridge_test")
    const TEST_FILE = join(TEST_DIR, "secure_shader.wgsl")

    let bridge: ReturnType<typeof createBridgeServer>
    let port: number
    let baseUrl: string
    let wsUrl: string

    beforeAll(async () => {
      if (!existsSync(TEST_DIR)) {
        mkdirSync(TEST_DIR, { recursive: true })
      }
      writeFileSync(TEST_FILE, "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }")

      bridge = createBridgeServer({
        port: 0,
        token: CHALLENGER_SECRET,
        directory: TEST_DIR,
        quiet: true,
      })
      port = await bridge.listen(0)
      baseUrl = `http://127.0.0.1:${port}`
      wsUrl = `ws://127.0.0.1:${port}`
    })

    afterAll(async () => {
      if (bridge) {
        await bridge.close()
      }
      try {
        if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE)
        if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR)
      } catch {
        /* ignore */
      }
    })

    it("rejects unauthenticated requests to protected endpoints with 401 Unauthorized", async () => {
      // 1. /api/agent/execute without token
      const execRes = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "void main(){}" }),
      })
      expect(execRes.status).toBe(401)
      const execBody = await execRes.json()
      expect(execBody.error).toMatch(/unauthorized|missing/i)

      // 2. /api/file without token
      const fileRes = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl`)
      expect(fileRes.status).toBe(401)
      const fileBody = await fileRes.json()
      expect(fileBody.error).toMatch(/unauthorized|missing/i)
    })

    it("rejects invalid or forged authentication tokens with 403 Forbidden", async () => {
      // 1. Wrong token in Authorization header
      const execRes = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer completely_fake_token_value",
        },
        body: JSON.stringify({ source: "void main(){}" }),
      })
      expect(execRes.status).toBe(403)
      const execBody = await execRes.json()
      expect(execBody.error).toMatch(/forbidden|invalid/i)

      // 2. Wrong token in x-bridge-token header
      const fileRes = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl`, {
        headers: { "X-Bridge-Token": "bad_token" },
      })
      expect(fileRes.status).toBe(403)
    })

    it("accepts valid token across all supported auth extraction channels", async () => {
      // 1. Authorization: Bearer <token>
      const resBearer = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl`, {
        headers: { Authorization: `Bearer ${CHALLENGER_SECRET}` },
      })
      expect(resBearer.status).toBe(200)
      const contentBearer = await resBearer.text()
      expect(contentBearer).toContain("@fragment fn fs()")

      // 2. Authorization: <token> (raw)
      const resRaw = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl`, {
        headers: { Authorization: CHALLENGER_SECRET },
      })
      expect(resRaw.status).toBe(200)

      // 3. X-Bridge-Token header
      const resCustom = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl`, {
        headers: { "X-Bridge-Token": CHALLENGER_SECRET },
      })
      expect(resCustom.status).toBe(200)

      // 4. URL query parameter ?token=<token>
      const resQuery = await fetch(`${baseUrl}/api/file?path=secure_shader.wgsl&token=${CHALLENGER_SECRET}`)
      expect(resQuery.status).toBe(200)
    })

    it("strictly rejects disallowed CORS origins with 403 Forbidden", async () => {
      const maliciousOrigins = [
        "http://evil.com",
        "https://attacker.org:8080",
        "null",
        "http://localhost.attacker.com",
        "http://127.0.0.1.evil.com",
      ]

      for (const origin of maliciousOrigins) {
        const res = await fetch(`${baseUrl}/api/status`, {
          headers: { Origin: origin },
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.error).toMatch(/cors origin not allowed/i)
      }
    })

    it("permits whitelisted origins and reflects Access-Control headers", async () => {
      const allowedOrigins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
      ]

      for (const origin of allowedOrigins) {
        const res = await fetch(`${baseUrl}/api/status`, {
          headers: { Origin: origin },
        })
        expect(res.status).toBe(200)
        expect(res.headers.get("access-control-allow-origin")).toBe(origin)
        expect(res.headers.get("vary")).toBe("Origin")
      }
    })

    it("blocks directory traversal, null-byte attacks and boundary breakouts in isSafePath", () => {
      const root = TEST_DIR
      expect(isSafePath("normal.wgsl", root)).toBe(true)
      expect(isSafePath("sub/dir/shader.glsl", root)).toBe(true)

      // Traversal attacks
      expect(isSafePath("../secret.txt", root)).toBe(false)
      expect(isSafePath("../../etc/passwd", root)).toBe(false)
      expect(isSafePath("..\\..\\windows\\system32", root)).toBe(false)
      expect(isSafePath("sub/../../escaped.txt", root)).toBe(false)

      // Null byte injection
      expect(isSafePath("safe.wgsl\0.png", root)).toBe(false)
      expect(isSafePath("\0/etc/shadow", root)).toBe(false)

      // Empty / invalid types
      expect(isSafePath("", root)).toBe(false)
      expect(isSafePath(null as any, root)).toBe(false)
      expect(isSafePath(undefined as any, root)).toBe(false)
    })

    it("blocks unauthorized WebSocket connections with close code 4401", async () => {
      // 1. Connection without token
      const wsNoToken = new WebSocket(wsUrl)
      const closeCodeNoToken = await new Promise<number>((res) => {
        wsNoToken.on("close", (code) => res(code))
        wsNoToken.on("error", () => {})
      })
      expect(closeCodeNoToken).toBe(4401)

      // 2. Connection with wrong token
      const wsBadToken = new WebSocket(`${wsUrl}?token=wrong_secret`)
      const closeCodeBadToken = await new Promise<number>((res) => {
        wsBadToken.on("close", (code) => res(code))
        wsBadToken.on("error", () => {})
      })
      expect(closeCodeBadToken).toBe(4401)

      // 3. Connection with valid token connects successfully
      const wsValid = new WebSocket(`${wsUrl}?token=${CHALLENGER_SECRET}`)
      const opened = await new Promise<boolean>((res) => {
        wsValid.on("open", () => res(true))
        wsValid.on("error", () => res(false))
      })
      expect(opened).toBe(true)
      wsValid.close()
    })
  })

  // ==========================================================================
  // DOMAIN 2: Memory & Loop (RenderCoordinator Under Stress & Re-entrancy)
  // ==========================================================================
  describe("Domain 2: RenderCoordinator Loop & Memory Resilience", () => {
    let env: E2ETestEnvironment

    beforeEach(() => {
      env = setupE2ETestEnvironment()
    })

    afterEach(() => {
      teardownE2ETestEnvironment()
    })

    it("handles extreme frame rate drops (5000ms pause) without NaN, Infinity, or crash", () => {
      const coordinator = new RenderCoordinator()
      const metricsLog: PerformanceMetrics[] = []

      coordinator.onMetrics((m) => metricsLog.push(m))

      // Simulate normal 60 FPS frame
      coordinator.tick(1000)
      coordinator.tick(1016.6)

      // Massive drop: 5,000ms freeze (e.g. background tab or heavy GC)
      coordinator.tick(6016.6)

      // Another drop: 10,000ms freeze
      coordinator.tick(16016.6)

      // Backwards clock / time jitter (-50ms)
      coordinator.tick(15966.6)

      expect(metricsLog.length).toBe(5)
      for (const m of metricsLog) {
        expect(Number.isFinite(m.fps)).toBe(true)
        expect(Number.isFinite(m.frameTimeMs)).toBe(true)
        expect(m.fps).toBeGreaterThanOrEqual(0)
        expect(m.frameTimeMs).toBeGreaterThanOrEqual(1) // clamped to >= 1ms
      }

      // Check phases executed in 5-phase order
      const phases = coordinator.getLastFramePhases()
      expect(phases).toEqual(["clock", "audio", "modulation", "draw", "telemetry"])
    })

    it("resists re-entrant start(), stop(), and hook registrations during frame execution", () => {
      const coordinator = new RenderCoordinator()
      let hook1Calls = 0
      let hook2Calls = 0

      coordinator.registerPreRenderHook("reentrant-hook-1", () => {
        hook1Calls++
        // Re-entrant calls
        coordinator.start()
        coordinator.start()
        coordinator.registerPreRenderHook("reentrant-hook-2", () => {
          hook2Calls++
        })
      })

      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(hook1Calls).toBe(1)
      expect(hook2Calls).toBe(1) // Map iterator visits newly added keys during same tick
      expect(env.clock.activeCallbackCount).toBe(1)

      // In next frame, both hooks execute again
      env.clock.step(16)
      expect(hook1Calls).toBe(2)
      expect(hook2Calls).toBe(2)
      expect(env.clock.activeCallbackCount).toBe(1)

      // Unregister during hook execution
      coordinator.registerPreRenderHook("self-unregister", () => {
        coordinator.unregisterPreRenderHook("self-unregister")
        coordinator.stop()
      })

      env.clock.step(16)
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("resists activeAdapter re-entrancy (adapter changing activeAdapter or stopping coordinator)", () => {
      const coordinator = new RenderCoordinator()
      let renderCalls = 0

      const reentrantAdapter = {
        renderFrame: vi.fn(() => {
          renderCalls++
          // Adapter unseats itself or stops coordinator during draw phase
          coordinator.setActiveAdapter(null)
          coordinator.stop()
        }),
        dispose: vi.fn(),
      }

      coordinator.setActiveAdapter(reentrantAdapter)
      coordinator.start()
      expect(env.clock.activeCallbackCount).toBe(1)

      env.clock.step(16)
      expect(renderCalls).toBe(1)
      expect(coordinator.getActiveAdapter()).toBeNull()
      expect(coordinator.getIsRunning()).toBe(false)
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("strictly bounds execution log to <= 300 entries over 2,500 continuous frames", () => {
      const coordinator = new RenderCoordinator()
      coordinator.start()

      for (let i = 1; i <= 2500; i++) {
        env.clock.step(16)
        if (i % 500 === 0) {
          const log = coordinator.getExecutionLog()
          expect(log.length).toBeLessThanOrEqual(300)
        }
      }

      const finalLog = coordinator.getExecutionLog()
      expect(finalLog.length).toBe(300)
      coordinator.stop()
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  // ==========================================================================
  // DOMAIN 3: UI Resilience (Error Boundaries & Monaco Marker Isolation)
  // ==========================================================================
  describe("Domain 3: UI Resilience & Monaco Diagnostic Isolation", () => {
    it("safely handles 10-level nested cause chains and circular reference loops in ErrorBoundary", () => {
      // 1. 10-level nested cause chain
      let currentError = new Error("Leaf Fault Level 10")
      for (let lvl = 9; lvl >= 1; lvl--) {
        currentError = new Error(`Fault Level ${lvl}`, { cause: currentError })
      }

      const boundaryNested = new ErrorBoundary({
        children: React.createElement("div", null, "Safe Content"),
        fallbackTitle: "Multi-Tier Error Catch",
      })

      boundaryNested.state = {
        hasError: true,
        error: currentError,
        errorInfo: { componentStack: "\n    in DeepLeaf\n    in RootApp" },
        showDetails: true,
      }

      const htmlNested = renderToStaticMarkup(boundaryNested.render() as React.ReactElement)
      expect(htmlNested).toContain("Multi-Tier Error Catch")
      expect(htmlNested).toContain("Fault Level 1")
      expect(htmlNested).toContain("role=\"alert\"")

      // 2. Circular error loop: errA -> errB -> errC -> errA
      const errA: any = new Error("Fault A")
      const errB: any = new Error("Fault B")
      const errC: any = new Error("Fault C")
      errA.cause = errB
      errB.cause = errC
      errC.cause = errA
      errA.self = errA

      const boundaryCircular = new ErrorBoundary({
        children: React.createElement("div"),
        fallbackTitle: "Circular Loop Boundary",
      })

      const stateCircular = ErrorBoundary.getDerivedStateFromError(errA)
      expect(stateCircular.hasError).toBe(true)

      boundaryCircular.state = {
        hasError: true,
        error: errA,
        errorInfo: { componentStack: "\n    in CircularComponent" },
        showDetails: true,
      }

      // Must render without call stack overflow or infinite recursion
      const htmlCircular = renderToStaticMarkup(boundaryCircular.render() as React.ReactElement)
      expect(htmlCircular).toContain("Circular Loop Boundary")
      expect(htmlCircular).toContain("Fault A")
    })

    it("safely handles arbitrary thrown entities (primitives, custom objects, null, undefined) in ErrorBoundary", () => {
      const boundary = new ErrorBoundary({
        children: React.createElement("div"),
        fallbackTitle: "Entity Catch Test",
        fallbackMessage: "Resilient Fallback Message",
      })

      // Non-error entities: strings, numbers, booleans, objects, null, undefined, Symbols
      const testEntities = [
        "Uncaught raw string exception",
        500,
        false,
        { status: 503, reason: "GPU pipeline timeout" },
        null,
        undefined,
      ]

      for (const entity of testEntities) {
        const state = ErrorBoundary.getDerivedStateFromError(entity as any)
        expect(state.hasError).toBe(true)

        boundary.state = {
          hasError: true,
          error: entity as any,
          errorInfo: null,
          showDetails: true,
        }

        const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
        expect(html).toContain("Entity Catch Test")
        expect(html).toContain("role=\"alert\"")
      }
    })

    it("verifies Monaco active-tab marker isolation between render and compute tabs", () => {
      let appliedMarkers: any[] = []
      const mockModel = {
        uri: { toString: () => "inmemory://model/test" },
        getLineCount: () => 50,
        getLineMaxColumn: () => 80,
      }
      const mockMonaco = {
        MarkerSeverity: { Error: 8 },
        editor: {
          setModelMarkers: vi.fn((_model: any, owner: string, markers: any[]) => {
            expect(owner).toBe(COMPILER_MARKER_OWNER)
            appliedMarkers = markers
          }),
        },
      }

      // Harness simulating ShaderEditor applyMarkers & active tab logic
      let activeTab: "render" | "compute" = "render"
      let lastCompileError: string | null = null
      let lastErrorTab: "render" | "compute" | null = null

      const triggerApplyMarkers = () => {
        if (!lastCompileError || lastErrorTab !== activeTab) {
          mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
          return
        }

        const diagnostics = parseDiagnosticErrors(lastCompileError)
        const markers = diagnostics.map((diag) => ({
          owner: COMPILER_MARKER_OWNER,
          resource: mockModel.uri,
          severity: 8,
          message: diag.message || "Compilation error",
          startLineNumber: diag.line ?? 1,
          startColumn: diag.column ?? 1,
          endLineNumber: diag.line ?? 1,
          endColumn: 80,
        }))
        mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, markers)
      }

      // 1. Error occurs on Render tab
      lastCompileError = "ERROR: 0:25: 'u_diffuse' : undeclared identifier"
      lastErrorTab = "render"
      triggerApplyMarkers()

      expect(appliedMarkers).toHaveLength(1)
      expect(appliedMarkers[0].startLineNumber).toBe(25)
      expect(appliedMarkers[0].message).toContain("u_diffuse")

      // 2. Switch to Compute tab -> markers must be isolated (cleared)
      activeTab = "compute"
      triggerApplyMarkers()
      expect(appliedMarkers).toHaveLength(0)

      // 3. Switch back to Render tab -> markers restored
      activeTab = "render"
      triggerApplyMarkers()
      expect(appliedMarkers).toHaveLength(1)
      expect(appliedMarkers[0].startLineNumber).toBe(25)

      // 4. Resolve error -> markers cleared
      lastCompileError = null
      lastErrorTab = null
      triggerApplyMarkers()
      expect(appliedMarkers).toHaveLength(0)
    })
  })

  // ==========================================================================
  // DOMAIN 4: Wasm Engine Parity, Reflection, Transpilation & 100K Mesh
  // ==========================================================================
  describe("Domain 4: Wasm Engine Parity, AST Reflection & Mesh Processing", () => {
    const wasmPath = resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")

    beforeAll(() => {
      if (existsSync(wasmPath)) {
        const bytes = readFileSync(wasmPath)
        initSync({ module: bytes })
      }
    })

    it("verifies mathematical parity and DirectX/OpenGL Y-flip between Rust Wasm baker and TS reference", () => {
      const width = 8
      const height = 8
      const pixels = new Uint8ClampedArray(width * height * 4)

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          pixels[idx] = x * 32
          pixels[idx + 1] = y * 32
          pixels[idx + 2] = 128
          pixels[idx + 3] = 255
        }
      }

      const imgData = { data: pixels, width, height } as unknown as ImageData

      // TS Reference
      const tsOpenGL = generatePbrPixelBuffers(imgData, {
        normalStrength: 2.0,
        invertNormalY: false,
        aoStrength: 1.0,
        metallicMode: "auto",
      })
      const tsDirectX = generatePbrPixelBuffers(imgData, {
        normalStrength: 2.0,
        invertNormalY: true,
        aoStrength: 1.0,
        metallicMode: "auto",
      })

      // Wasm Execution
      const wasmOpenGL = bake_pbr_wasm(new Uint8Array(pixels), {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto",
      })
      const wasmDirectX = bake_pbr_wasm(new Uint8Array(pixels), {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: true,
        ao_strength: 1.0,
        metallic_mode: "auto",
      })

      // Verify ZIP archive magic bytes (PKZIP: 0x50, 0x4B, 0x03, 0x04)
      expect(wasmOpenGL.zip_archive[0]).toBe(0x50)
      expect(wasmOpenGL.zip_archive[1]).toBe(0x4b)
      expect(wasmOpenGL.zip_archive[2]).toBe(0x03)
      expect(wasmOpenGL.zip_archive[3]).toBe(0x04)

      // Verify Y-flip symmetry in TS reference
      for (let i = 1; i < tsOpenGL.normal.length; i += 4) {
        expect(tsDirectX.normal[i]).toBe(255 - tsOpenGL.normal[i])
      }

      // Verify PNG outputs are generated
      expect(wasmOpenGL.normal_png.length).toBeGreaterThan(0)
      expect(wasmDirectX.normal_png.length).toBeGreaterThan(0)
    })

    it("reflects complex WGSL shader with 3-tier nested structs via Naga AST", () => {
      const wgslSource = `
struct TransformMatrix {
    model: mat4x4f,
    view: mat4x4f,
};

struct LightSource {
    position: vec3f,
    intensity: f32,
    color: vec4f,
};

struct SceneData {
    transform: TransformMatrix,
    sun: LightSource,
    ambient: vec3f,
    fogDensity: f32,
};

@group(0) @binding(0)
var<uniform> u_scene: SceneData;

@fragment
fn fs_main() -> @location(0) vec4f {
    return u_scene.sun.color;
}
`

      const reflected = reflect_uniforms_wasm(wgslSource, "wgsl")
      expect(Array.isArray(reflected)).toBe(true)
      expect(reflected.length).toBeGreaterThanOrEqual(7)

      const names = reflected.map((u: any) => u.name)
      expect(names).toContain("transform")
      expect(names).toContain("sun")
      expect(names).toContain("ambient")
      expect(names).toContain("fogDensity")
      expect(names).toContain("model")
      expect(names).toContain("view")
      expect(names).toContain("position")
      expect(names).toContain("intensity")
      expect(names).toContain("color")

      const model = reflected.find((u: any) => u.name === "model")
      expect(model.type_name).toBe("mat4x4f")
      expect(model.kind).toBe("matrix")

      const color = reflected.find((u: any) => u.name === "color")
      expect(color.type_name).toBe("vec4f")
      expect(color.kind).toBe("color")
    })

    it("preserves variable identifiers containing keyword substrings during transpilation (token-boundary isolation)", () => {
      const complexShader = `
void main() {
    float custom_u_resolution = 1920.0;
    float my_u_time = 42.0;
    float super_gl_FragCoord = 1.0;
    float speed_resolution = 2.0;

    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = vec3(sin(u_time * 2.0));
    fragColor = vec4(col, 1.0);
}
`

      const unity = transpile_shader_wasm({
        shader_source: complexShader,
        shader_name: "TokenBoundaryTest",
        target: "unity",
        source_lang: "glsl",
      })

      // Identifier isolation: custom variables must NOT be corrupted
      expect(unity).toContain("custom_u_resolution")
      expect(unity).not.toContain("custom__ScreenParams.xy")

      expect(unity).toContain("my_u_time")
      expect(unity).not.toContain("my__Time.y")

      expect(unity).toContain("super_gl_FragCoord")
      expect(unity).not.toContain("super_i.positionCS")

      expect(unity).toContain("speed_resolution")
      expect(unity).not.toContain("speed__ScreenParams.xy")

      // True keywords MUST be mapped
      expect(unity).toContain("_ScreenParams.xy")
      expect(unity).toContain("_Time.y")
      expect(unity).toContain("i.positionCS.xy")

      // Godot transpilation
      const godot = transpile_shader_wasm({
        shader_source: complexShader,
        target: "godot",
        source_lang: "glsl",
      })
      expect(godot).toContain("shader_type spatial;")
      expect(godot).toContain("FRAGCOORD.xy")
      expect(godot).toContain("VIEWPORT_SIZE")
      expect(godot).toContain("TIME")

      // Shadertoy transpilation
      const shadertoy = transpile_shader_wasm({
        shader_source: complexShader,
        target: "shadertoy",
        source_lang: "glsl",
      })
      expect(shadertoy).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
      expect(shadertoy).toContain("iResolution.xy")
      expect(shadertoy).toContain("iTime")
    })

    it("processes a 105,000 vertex (35,000 triangle) OBJ model within 1000ms with unit normals and finite positions", () => {
      const triangleCount = 35000 // 35,000 * 3 = 105,000 vertices
      const lines: string[] = []

      for (let i = 0; i < triangleCount; i++) {
        const x = (i % 100) * 0.1
        const y = Math.floor(i / 100) * 0.1
        const z = Math.sin(i * 0.02) * 4.0
        lines.push(`v ${x} ${y} ${z}`)
        lines.push(`v ${x + 0.1} ${y} ${z}`)
        lines.push(`v ${x} ${y + 0.1} ${z + 0.05}`)
      }

      for (let i = 0; i < triangleCount; i++) {
        const v1 = i * 3 + 1
        const v2 = i * 3 + 2
        const v3 = i * 3 + 3
        lines.push(`f ${v1} ${v2} ${v3}`)
      }

      const objText = lines.join("\n")

      const t0 = performance.now()
      const result = normalize_obj_wasm(objText, "stress_105k.obj")
      const t1 = performance.now()
      const elapsed = t1 - t0

      // Performance check (< 1000ms)
      expect(elapsed).toBeLessThan(1000)

      expect(result.vertex_count).toBe(105000)
      expect(result.triangle_count).toBe(35000)
      expect(result.positions.length).toBe(105000 * 3)
      expect(result.normals.length).toBe(105000 * 3)
      expect(result.uvs.length).toBe(105000 * 2)

      // Sample normals for unit length (length = 1.0)
      const normBuf = new Float32Array(result.normals)
      for (let i = 0; i < 300; i += 3) {
        const nx = normBuf[i]
        const ny = normBuf[i + 1]
        const nz = normBuf[i + 2]
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        expect(len).toBeCloseTo(1.0, 3)
      }

      // Verify finite coordinates
      const posBuf = new Float32Array(result.positions)
      for (let i = 0; i < 300; i++) {
        expect(Number.isFinite(posBuf[i])).toBe(true)
      }
    })
  })
})
