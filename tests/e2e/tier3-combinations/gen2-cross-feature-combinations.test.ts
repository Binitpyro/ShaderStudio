import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { parseOBJ } from "@/core/modelLoader"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import { transpileToUnityHLSL, transpileToGodotShader } from "@/core/engineTranspiler"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { resolve } from "path"
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

describe("Tier 3: Combinatorial & Cross-Feature Interactions", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  it("Combo 1: 3D Mesh Normalization + PBR Texture Map Baking + Dynamic Uniform Buffers", () => {
    // 1. Normalize 3D OBJ model
    const rawObj = `
v -2.0 -2.0 0.0
v 2.0 -2.0 0.0
v 0.0 2.0 0.0
f 1 2 3
`
    const geometry = parseOBJ(rawObj, "combo_mesh.obj")
    expect(geometry.vertexCount).toBe(3)
    expect(geometry.positions.length).toBe(9)

    // 2. Generate PBR maps matching the asset
    const sourceData = {
      data: new Uint8ClampedArray(16 * 16 * 4).fill(180),
      width: 16,
      height: 16,
    } as unknown as ImageData

    const pbrMaps = generatePbrPixelBuffers(sourceData, {
      normalStrength: 1.5,
      invertNormalY: false,
      metallicMode: "metal",
    })

    expect(pbrMaps.normal.length).toBe(16 * 16 * 4)
    expect(pbrMaps.metallic[0]).toBe(255) // Metal constraint

    // 3. Bind dynamic parameters and transpile for engine pipeline
    const hlsl = transpileToUnityHLSL({
      shaderName: "Combo/NormalizedAssetShader",
      shaderSource: "void main() { fragColor = u_color; }",
      parsedUniforms: [
        { name: "u_color", type: "vec4f", kind: "color" },
        { name: "u_metallic", type: "f32", kind: "scalar" },
      ],
      uniformValues: {
        u_color: { type: "color", value: [0.9, 0.5, 0.1, 1.0] },
        u_metallic: { type: "float", value: 1.0 },
      },
    })

    expect(hlsl).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(hlsl).toContain("float4 _u_color;")
    expect(hlsl).toContain("float _u_metallic;")
  })

  it("Combo 2: Cross-Engine Transpilation + Compiler Diagnostics + Live Error Parsing", () => {
    const errorShader = `
void main() {
    vec3 col = u_unknown_val * 2.0;
    fragColor = vec4(col, 1.0)
`

    // 1. Attempt cross-compilation
    const godot = transpileToGodotShader({
      shaderSource: errorShader,
      parsedUniforms: [],
    })
    expect(godot).toContain("shader_type spatial;")

    // 2. Simulate compiler driver reporting syntax error
    const rawError = `ERROR: 0:4: 'u_unknown_val' : undeclared identifier\n:5:1 error: expected ';' for statement`
    const diagnostics = parseDiagnosticErrors(rawError)

    expect(diagnostics.length).toBe(2)
    expect(diagnostics[0].line).toBe(4)
    expect(diagnostics[0].message).toContain("undeclared identifier")

    expect(diagnostics[1].line).toBe(5)
    expect(diagnostics[1].column).toBe(1)
    expect(diagnostics[1].message).toContain("expected ';'")
  })

  it("Combo 3: Unified RenderCoordinator + Hardware Device Loss + Seamless WebGL2 Migration", () => {
    const coordinator = new RenderCoordinatorHarness()

    // 1. Initial WebGPU adapter running on coordinator
    const webgpuMock: RenderAdapterContract = {
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(webgpuMock)
    coordinator.start()

    env.clock.step(16)
    expect(webgpuMock.renderFrame).toHaveBeenCalledTimes(1)
    expect(env.clock.activeCallbackCount).toBe(1)

    // 2. Hardware crash event occurs on WebGPU adapter
    useProjectStore.getState().setDeviceLost(true)
    expect(useProjectStore.getState().deviceLost).toBe(true)

    // 3. Fallback recovery: switch to WebGL2 adapter
    const webgl2Mock: RenderAdapterContract = {
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    }
    coordinator.setActiveAdapter(webgl2Mock)
    useProjectStore.getState().setActiveBackend("webgl2")
    useProjectStore.getState().setDeviceLost(false)

    // 4. Coordinator continues uninterrupted
    env.clock.step(16)
    expect(webgl2Mock.renderFrame).toHaveBeenCalledTimes(1)
    expect(env.clock.activeCallbackCount).toBe(1) // Still exactly 1 loop, zero zombie loops

    coordinator.stop()
  })

  it("Combo 4: Local Bridge Security Authentication + Safe Path Traversal + Remote Shader RPC Execution", async () => {
    const TOKEN = "auth_combo_test_token_8899"
    const ROOT = resolve(process.cwd())

    // 1. Verify CORS origin
    const originAllowed = validateCorsOrigin("http://localhost:5173")
    expect(originAllowed).toBe(true)

    // 2. Verify ephemeral token
    const authResult = verifyAuthToken(`Bearer ${TOKEN}`, TOKEN)
    expect(authResult.valid).toBe(true)
    expect(authResult.statusCode).toBe(200)

    // 3. Verify target path is strictly within boundary
    const pathAllowed = isSafePath("src/shaders/combo.wgsl", ROOT)
    expect(pathAllowed).toBe(true)

    // 4. Execute shader RPC locally
    const canvas = env.createCanvas()
    viewportCapture.registerCanvas(canvas as any)
    await webgl2Adapter.mount(canvas as any)
    useProjectStore.getState().setActiveBackend("webgl2")

    const feedback = await executeShaderLocally({
      id: "combo_exec_1",
      source: "void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }",
      backend: "webgl2",
      captureSnapshot: false,
    })

    expect(feedback.id).toBe("combo_exec_1")
    expect(feedback.status).toBe("success")
    expect(feedback.backend).toBe("webgl2")

    webgl2Adapter.dispose()
    viewportCapture.unregisterCanvas()
  })
})
