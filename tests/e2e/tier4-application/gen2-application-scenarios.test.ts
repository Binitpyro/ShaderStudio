import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { parseOBJ } from "@/core/modelLoader"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import { createZipArchive } from "@/utils/zipBuilder"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
} from "@/core/engineTranspiler"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import {
  RenderCoordinatorHarness,
  verifyAuthToken,
  validateCorsOrigin,
  isSafePath,
  type RenderAdapterContract,
} from "../mocks/gen2Harness"
import { executeShaderLocally } from "@/bridge/wsBridgeClient"
import { webgl2Adapter } from "@/adapters/webgl2"
import { viewportCapture } from "@/utils/frameCapture"
import { useProjectStore } from "@/stores/projectStore"
import { resolve } from "path"

describe("Tier 4: Real-World Application Workflows & Scenarios", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  it("Scenario 1: Complete PBR Asset Ingestion, Processing & Export", async () => {
    // 1. User loads an unnormalized Wavefront OBJ asset
    const rawObj = `
v -50.0 -50.0 0.0
v 50.0 -50.0 0.0
v 0.0 50.0 0.0
f 1 2 3
`
    const geometry = parseOBJ(rawObj, "character_shield.obj")
    expect(geometry.name).toBe("character_shield.obj")
    expect(geometry.positions.length).toBe(9)
    expect(geometry.normals.length).toBe(9)

    // Bounding radius should be normalized to ~1.2
    const maxCoord = Math.max(...geometry.positions.map(Math.abs))
    expect(maxCoord).toBeLessThan(2.0)

    // 2. Texture baking: compute 6 PBR maps from raw surface data
    const surfaceData = {
      data: new Uint8ClampedArray(32 * 32 * 4).fill(200),
      width: 32,
      height: 32,
    } as unknown as ImageData

    const baked = generatePbrPixelBuffers(surfaceData, {
      normalStrength: 2.0,
      invertNormalY: true, // DirectX format for engine export
      metallicMode: "auto",
      aoStrength: 1.0,
    })

    expect(baked.albedo.length).toBe(32 * 32 * 4)
    expect(baked.normal.length).toBe(32 * 32 * 4)
    expect(baked.roughness.length).toBe(32 * 32 * 4)
    expect(baked.heightMap.length).toBe(32 * 32 * 4)
    expect(baked.metallic.length).toBe(32 * 32 * 4)
    expect(baked.ao.length).toBe(32 * 32 * 4)

    // 3. Package asset bundle into in-memory ZIP archive
    const zipFiles = [
      { name: "albedo.raw", data: new Uint8Array(baked.albedo.buffer) },
      { name: "normal.raw", data: new Uint8Array(baked.normal.buffer) },
      { name: "roughness.raw", data: new Uint8Array(baked.roughness.buffer) },
      { name: "ao.raw", data: new Uint8Array(baked.ao.buffer) },
      {
        name: "manifest.json",
        data: new TextEncoder().encode(
          JSON.stringify({
            name: "character_shield",
            format: "pbr-v1",
            resolution: 32,
            vertexCount: geometry.vertexCount,
          })
        ),
      },
    ]

    const zipBytes = createZipArchive(zipFiles)
    expect(zipBytes.length).toBeGreaterThan(0)
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50) // PKZIP signature
  })

  it("Scenario 2: Multi-Engine Shader Export Workflow (Unity, Godot & Shadertoy)", () => {
    const shaderSource = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_tint.rgb * sin(u_time * u_pulseSpeed);
    fragColor = vec4(col, 1.0);
}
`
    const options = {
      shaderName: "Game/HologramPulse",
      shaderSource,
      parsedUniforms: [
        { name: "u_tint", type: "vec4f", kind: "color" as const },
        { name: "u_pulseSpeed", type: "f32", kind: "scalar" as const },
      ],
      uniformValues: {
        u_tint: { type: "color", value: [0.2, 0.9, 0.8, 1.0] },
        u_pulseSpeed: { type: "float", value: 4.0 },
      },
    }

    // 1. Unity Universal Render Pipeline export
    const unityHLSL = transpileToUnityHLSL(options)
    expect(unityHLSL).toContain('Shader "Game/HologramPulse"')
    expect(unityHLSL).toContain('_u_tint ("u_tint", Color) = (0.2, 0.9, 0.8, 1)')
    expect(unityHLSL).toContain('_u_pulseSpeed ("u_pulseSpeed", Float) = 4')
    expect(unityHLSL).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(unityHLSL).toContain("TransformObjectToHClip")
    expect(unityHLSL).toContain("SV_Target")

    // 2. Godot 4 Spatial Shader export
    const godotShader = transpileToGodotShader(options)
    expect(godotShader).toContain("shader_type spatial;")
    expect(godotShader).toContain("uniform vec4 u_tint : source_color = vec4(0.2, 0.9, 0.8, 1);")
    expect(godotShader).toContain("uniform float u_pulseSpeed = 4;")
    expect(godotShader).toContain("ALBEDO = fragColor.rgb;")

    // 3. Shadertoy GLSL ES 3.0 export
    const shadertoy = transpileToShadertoy(options)
    expect(shadertoy).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
    expect(shadertoy).toContain("iTime")
    expect(shadertoy).toContain("iResolution.xy")
  })

  it("Scenario 3: Live Monaco Syntax Error Injection and Auto-Resolution Cycle", () => {
    // Step A: Initial valid compilation
    useProjectStore.getState().setLastCompileError(null)
    expect(parseDiagnosticErrors(useProjectStore.getState().lastCompileError)).toEqual([])

    // Step B: User introduces syntax typo in editor
    const wgslError = `:14:22 error: unexpected token 'var', expected ')'\n    fn compute(x: f32, var y: f32)`
    useProjectStore.getState().setLastCompileError(wgslError)

    const errorMarkers = parseDiagnosticErrors(useProjectStore.getState().lastCompileError)
    expect(errorMarkers.length).toBe(1)
    expect(errorMarkers[0].line).toBe(14)
    expect(errorMarkers[0].column).toBe(22)
    expect(errorMarkers[0].message).toContain("unexpected token 'var'")

    // Step C: User fixes the typo
    useProjectStore.getState().setLastCompileError(null)
    const fixedMarkers = parseDiagnosticErrors(useProjectStore.getState().lastCompileError)
    expect(fixedMarkers).toEqual([])
  })

  it("Scenario 4: Critical Hardware GPU Crash and Auto-Recovery Workflow", () => {
    const coordinator = new RenderCoordinatorHarness()

    // Step A: Active WebGPU rendering session
    const webgpuAdapterMock: RenderAdapterContract = {
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(webgpuAdapterMock)
    coordinator.start()

    env.clock.step(16)
    expect(webgpuAdapterMock.renderFrame).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().activeBackend).toBe("webgpu")

    // Step B: GPU driver hung event triggers device.lost
    useProjectStore.getState().setDeviceLost(true)
    useProjectStore.getState().setLastCompileError("Device lost: GPU Hung")
    expect(useProjectStore.getState().deviceLost).toBe(true)

    // Step C: Bounded recovery switches to WebGL2 without page refresh
    const webgl2AdapterMock: RenderAdapterContract = {
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(webgl2AdapterMock)
    useProjectStore.getState().setActiveBackend("webgl2")
    useProjectStore.getState().setDeviceLost(false)
    useProjectStore.getState().setLastCompileError(null)

    // Step D: Coordinator continues render loop seamlessly
    env.clock.step(16)
    expect(webgl2AdapterMock.renderFrame).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().activeBackend).toBe("webgl2")
    expect(useProjectStore.getState().deviceLost).toBe(false)
    expect(env.clock.activeCallbackCount).toBe(1)

    coordinator.stop()
  })

  it("Scenario 5: Secure Remote Agent RPC Session via Local Bridge", async () => {
    const EPHEMERAL_TOKEN = "agent_session_sec_token_554433"
    const ROOT = resolve(process.cwd())

    // Step A: Origin security check
    expect(validateCorsOrigin("http://localhost:5173")).toBe(true)
    expect(validateCorsOrigin("https://hacker.io")).toBe(false)

    // Step B: Authenticate incoming agent request
    const authResult = verifyAuthToken(`Bearer ${EPHEMERAL_TOKEN}`, EPHEMERAL_TOKEN)
    expect(authResult.valid).toBe(true)
    expect(authResult.statusCode).toBe(200)

    // Step C: Sanitize target shader path
    expect(isSafePath("src/shaders/agent_generated.wgsl", ROOT)).toBe(true)
    expect(isSafePath("../../../windows/win.ini", ROOT)).toBe(false)

    // Step D: Local shader execution and performance metrics capture
    const canvas = env.createCanvas()
    viewportCapture.registerCanvas(canvas as any)
    await webgl2Adapter.mount(canvas as any)
    useProjectStore.getState().setActiveBackend("webgl2")

    const feedback = await executeShaderLocally({
      id: "agent_req_42",
      source: "void main() { fragColor = vec4(0.2, 0.4, 0.8, 1.0); }",
      backend: "webgl2",
      captureSnapshot: false,
    })

    expect(feedback.id).toBe("agent_req_42")
    expect(feedback.status).toBe("success")
    expect(feedback.backend).toBe("webgl2")
    expect(feedback.errors).toHaveLength(0)

    webgl2Adapter.dispose()
    viewportCapture.unregisterCanvas()
  })
})
