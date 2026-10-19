/**
 * Tier 4: Real-World Workload Scenarios — ShaderStudio Feature Overhaul (R1–R5)
 *
 * Full-scale creative workstation and studio production pipelines:
 * - Scenario 1: Production PBR Hero Material Pipeline (Sub-graphs, Custom Node, Math Expr, Preview, Frames)
 * - Scenario 2: High-Fidelity Cinematic Deferred Scene (GBuffer MRT, Directional/Point Shadows, SSR, SSAO, DoF, TAA, Atmosphere)
 * - Scenario 3: Cross-Engine Digital Asset Pipeline (UE5 HLSL, glTF 2.0, Blender OSL, npm Package, Shadertoy Import, R3F)
 * - Scenario 4: Desktop Workstation Studio Workflow (Tauri Native Save/Load, MCP Bridge, Tray, Profiler, Binary Profile)
 * - Scenario 5: Performance & Massive Scale Stress (50k Mesh LOD Decimation, 4K Texture Streaming, Memory Budget Alert, 60fps Timeline)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  createNextGenWorkstationHarness,
  type NextGenWorkstationHarness,
} from "./nextGenHarness"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 4: Real-World Workload Scenarios — ShaderStudio Feature Overhaul (R1–R5)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let ws: NextGenWorkstationHarness

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    ws = createNextGenWorkstationHarness()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  it("Scenario 1: Production PBR Hero Material Pipeline (Nested Sub-graphs, Custom Plugins, Math Expr, Preview & Frames)", () => {
    // 1. Register a custom iridescence plugin node
    ws.customNodes.registerCustomNode({
      type: "pbr_iridescence",
      title: "PBR Iridescence",
      category: "filter",
      inputs: [
        { name: "normal", type: "vec3" },
        { name: "viewDir", type: "vec3" },
      ],
      outputs: [{ name: "iridColor", type: "vec3" }],
      parameters: [{ name: "eta", type: "float", default: 1.33 }],
      glsl: "vec3 pbr_iridescence(vec3 n, vec3 v, float eta) { return vec3(0.8, 0.4, 0.9); }",
    })

    // 2. Author a thin-film interference math expression node
    const thinFilmExpr = "sin(uv.x * 20.0 + u_time) * 0.5 + 0.5"
    expect(ws.mathExpr.validate(thinFilmExpr, ["uv", "u_time"]).valid).toBe(true)
    const glslMath = ws.mathExpr.generateGLSL(thinFilmExpr, "float")
    expect(glslMath).toContain("sin(uv.x * 20.0 + u_time)")

    // 3. Assemble main canvas nodes: Fresnel rim sub-graph, custom iridescence, math expr, frame & comment
    const canvasNodes = [
      {
        id: "sg_rim_inst",
        type: "subgraph",
        position: { x: 50, y: 100 },
        data: { subGraphId: "builtin-fresnel-rim", uniformOverrides: { u_rimPower: 5.0 } },
      },
      {
        id: "irid_node",
        type: "pbr_iridescence",
        position: { x: 300, y: 100 },
        data: { eta: 1.45 },
      },
      {
        id: "math_node",
        type: "mathExpression",
        position: { x: 550, y: 100 },
        data: { expression: thinFilmExpr },
      },
      {
        id: "comment_note",
        type: "comment",
        position: { x: 50, y: 20 },
        data: { text: "Hero Car Paint — Thin Film & Specular Rim Stage" },
      },
      {
        id: "group_frame",
        type: "frame",
        position: { x: 20, y: 0 },
        width: 800,
        height: 350,
        data: { title: "Paint Shading Cluster", color: "#6366f1" },
      },
    ]

    // 4. Test spatial grouping inside the frame
    expect(ws.annotations.isContainedInFrame(canvasNodes[0], canvasNodes[4])).toBe(true)
    expect(ws.annotations.isContainedInFrame(canvasNodes[1], canvasNodes[4])).toBe(true)
    expect(ws.annotations.isContainedInFrame(canvasNodes[2], canvasNodes[4])).toBe(true)

    // 5. Select the iridescence node and verify isolated preview pipeline
    ws.livePreview.selectNode("irid_node")
    expect(ws.livePreview.getSelectedNode()).toBe("irid_node")
    const isolated = ws.livePreview.generateIsolatedShader("irid_node", canvasNodes[1])
    expect(isolated).toContain("pbr_iridescence")

    // 6. Filter annotation nodes and compile flattened graph
    const renderNodes = ws.annotations.filterForCompilation(canvasNodes)
    expect(renderNodes).toHaveLength(3) // comments and frames excluded

    const flattened = ws.subgraphs.flattenGraph(renderNodes, [])
    expect(flattened.uniforms["sg_sg_rim_inst_u_rimPower"]).toBe(5.0)
    expect(flattened.nodes.some((n) => n.id.includes("fn_dot"))).toBe(true)
  })

  it("Scenario 2: High-Fidelity Cinematic Deferred Scene (GBuffer MRT, PCF & Cube Shadows, SSR, SSAO, DoF, TAA, Atmosphere)", () => {
    const adapter = ws.rendering.webgpu

    // Step 1: Switch to Deferred Rendering mode
    adapter.setRenderingPipelineMode("deferred")
    const gbuffer = adapter.getGBufferTextures()
    expect(gbuffer).not.toBeNull()
    expect(gbuffer?.albedo).toBeDefined()
    expect(gbuffer?.normal).toBeDefined()
    expect(gbuffer?.roughnessMetallic).toBeDefined()
    expect(gbuffer?.depth).toBeDefined()
    expect(gbuffer?.motionVectors).toBeDefined()

    // Step 2: Configure 4096 resolution directional light PCF shadow mapping
    adapter.setShadowConfig({
      resolution: 4096,
      filtering: "pcf",
      bias: 0.0015,
      normalBias: 0.003,
    })
    expect(adapter.state.shadowConfig.resolution).toBe(4096)
    expect(adapter.state.shadowConfig.filtering).toBe("pcf")

    // Step 3: Enable point light shadow cube maps for interior fill light
    adapter.setPointLightShadowCube(true)
    expect(adapter.state.pointShadowCubeEnabled).toBe(true)

    // Step 4: Enable SSR with 128 ray steps and IBL blending
    adapter.setPostProcessEnabled("ssr", true, {
      maxSteps: 128,
      thickness: 0.02,
      falloff: 0.85,
      iblBlend: 0.65,
    })
    expect(adapter.state.postProcessState.ssr.enabled).toBe(true)
    expect(adapter.state.postProcessState.ssr.maxSteps).toBe(128)

    // Step 5: Enable SSAO for contact shadows
    adapter.setPostProcessEnabled("ssao", true, {
      radius: 0.6,
      intensity: 1.8,
      sampleCount: 32,
    })
    expect(adapter.state.postProcessState.ssao.enabled).toBe(true)

    // Step 6: Apply Bokeh Depth of Field (focal distance 7.5m, hexagon shape)
    adapter.setPostProcessEnabled("dof", true, {
      focalDistance: 7.5,
      aperture: 0.08,
      bokehShape: "hexagon",
    })
    expect(adapter.state.postProcessState.dof.bokehShape).toBe("hexagon")

    // Step 7: Apply TAA with Halton subpixel jitter
    adapter.setPostProcessEnabled("taa", true, {
      jitterSample: [0.125, -0.375],
      motionVectorClamp: true,
    })
    expect(adapter.state.postProcessState.taa.motionVectorClamp).toBe(true)

    // Step 8: Physically-based procedural atmosphere at golden hour (17:30h)
    adapter.setAtmosphereParams({ timeOfDay: 17.5, sunIntensity: 1.2, turbidity: 3.5 })
    expect(adapter.state.atmosphereParams.timeOfDay).toBe(17.5)
    expect(adapter.state.atmosphereParams.solarElevationDeg).toBeLessThan(30.0) // Low sun angle
    const scattering = adapter.calculateRayleighMieScattering()
    expect(scattering.rayleigh[2]).toBeGreaterThan(scattering.rayleigh[0])

    // Step 9: Verify backend parity across WebGL2 and Three.js
    for (const otherBackend of [ws.rendering.webgl2, ws.rendering.threejs]) {
      otherBackend.setRenderingPipelineMode("deferred")
      otherBackend.setShadowConfig({ resolution: 4096, filtering: "pcf" })
      otherBackend.setPostProcessEnabled("ssr", true)
      otherBackend.setAtmosphereParams({ timeOfDay: 17.5 })
      expect(otherBackend.state.pipelineMode).toBe("deferred")
      expect(otherBackend.state.shadowConfig.resolution).toBe(4096)
      expect(otherBackend.state.postProcessState.ssr.enabled).toBe(true)
    }
  })

  it("Scenario 3: Cross-Engine Digital Asset Pipeline (Shadertoy Import -> UE5 -> glTF 2.0 -> Blender OSL -> npm -> R3F)", () => {
    // Step 1: Import procedural texture from Shadertoy
    const shadertoySource = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  float pulse = sin(iTime * 2.0);
  vec4 tex = texture(iChannel0, uv);
  fragColor = vec4(uv, pulse, 1.0) * tex;
}
`
    const imported = ws.transpiler.importShadertoy(shadertoySource)
    expect(imported.convertedSource).toContain("u_resolution")
    expect(imported.convertedSource).toContain("u_time")
    expect(imported.convertedSource).toContain("u_channel0")
    expect(imported.channels).toContain(0)

    const materialUniforms = [
      { name: "u_time", type: "float", defaultValue: 0 },
      { name: "u_resolution", type: "vec2", defaultValue: [1920, 1080] },
      { name: "u_channel0", type: "sampler2D", defaultValue: "texture_0" },
    ]

    // Step 2: Export to Unreal Engine 5 HLSL
    const ue5 = ws.transpiler.transpileToUE5(imported.convertedSource, materialUniforms as any)
    expect(ue5.customExpressionHLSL).toContain("ScalarParameter: u_time")
    expect(ue5.customExpressionHLSL).toContain("Texture2D: u_channel0")
    expect(ue5.materialFunctionHLSL).toContain("MaterialFunctionOutput")

    // Step 3: Export to glTF 2.0 Material JSON
    const gltf = ws.transpiler.exportGltf2Material("ProceduralPulseMat", false)
    expect(gltf.gltfJson.asset.version).toBe("2.0")
    expect(gltf.extensionsUsed).toContain("KHR_materials_pbrSpecularGlossiness")

    // Step 4: Export to Blender Cycles Open Shading Language (OSL)
    const osl = ws.transpiler.transpileToBlenderOSL(imported.convertedSource, materialUniforms as any)
    expect(osl).toContain("shader ShaderStudioMaterial")
    expect(osl).toContain("BSDF = diffuse(N);")

    // Step 5: Export to npm publishable package bundle
    const npmPkg = ws.transpiler.generateNpmPackage("@shaderstudio/pulse-procedural", imported.convertedSource)
    expect(npmPkg.packageJson.name).toBe("@shaderstudio/pulse-procedural")
    expect(npmPkg.indexTs).toContain("export function createMaterial")

    // Step 6: Export to React Three Fiber (R3F) shaderMaterial with Storybook component
    const r3f = ws.transpiler.generateR3FExport("ProceduralPulse")
    expect(r3f).toContain("@react-three/drei")
    expect(r3f).toContain("shaderMaterial")
    expect(r3f).toContain("export const StorybookPreview")
  })

  it("Scenario 4: Desktop Workstation Studio Workflow (Tauri Save/Load, In-App MCP Bridge, Tray & Optimization Profile)", async () => {
    // 1. Initialize desktop tray & window
    ws.desktop.setupTray()
    expect(ws.desktop.isTrayActive()).toBe(true)

    // 2. Start in-app MCP server bridge on port 4500
    const bridgeMsg = await ws.desktop.start_mcp_bridge(4500)
    expect(bridgeMsg).toContain("port 4500")
    expect(await ws.desktop.get_mcp_bridge_status()).toBe(true)

    // 3. Save workstation project state
    const studioProject = {
      projectTitle: "NextGenHeroStation",
      version: "2.0.0",
      graph: {
        nodes: [
          { id: "sg_1", type: "subgraph", data: { subGraphId: "builtin-fresnel-rim" } },
        ],
      },
      rendering: {
        backend: "webgpu",
        mode: "deferred",
        shadows: { resolution: 2048, filtering: "pcf" },
      },
      perfBudget: {
        textureBudgetMB: 512,
        geometryBudgetMB: 256,
        totalVramBudgetMB: 1024,
      },
    }

    const savedFilePath = await ws.desktop.save_project_native(
      "C:/Users/binit/Documents/ShaderStudio/hero_scene.shaderstudio",
      JSON.stringify(studioProject)
    )
    expect(savedFilePath).toBe("C:/Users/binit/Documents/ShaderStudio/hero_scene.shaderstudio")

    // 4. Reload saved workstation project state
    const [path, loadedJson] = await ws.desktop.load_project_native(savedFilePath)
    expect(path).toBe(savedFilePath)
    const parsed = JSON.parse(loadedJson)
    expect(parsed.projectTitle).toBe("NextGenHeroStation")
    expect(parsed.rendering.mode).toBe("deferred")

    // 5. Verify cargo profile binary slimming settings (< 15MB binary guarantee)
    const cargoToml = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
    const binaryCheck = ws.desktop.validateBinarySizeConfig(cargoToml)
    expect(binaryCheck.valid).toBe(true)

    // 6. Stop MCP bridge before exiting
    ws.desktop.stop_mcp_bridge()
    expect(await ws.desktop.get_mcp_bridge_status()).toBe(false)
  })

  it("Scenario 5: Performance & Massive Scale Stress (50k Mesh LOD Decimation, 4K Progressive Streaming, Budget Alerts)", async () => {
    // 1. Setup 50,000 vertex mesh
    const baseVertexCount = 50000
    const lods = ws.perf.generateMeshLods(baseVertexCount)
    expect(lods.lod0).toBe(50000)
    expect(lods.lod1).toBe(25000)
    expect(lods.lod2).toBe(12500)

    // 2. Camera distance shifts from close-up to far vista
    const closeDistance = 5.0
    const mediumDistance = 18.0
    const farDistance = 45.0

    expect(ws.perf.selectLodByDistance(closeDistance)).toBe("lod0")
    expect(ws.perf.selectLodByDistance(mediumDistance)).toBe("lod1")
    expect(ws.perf.selectLodByDistance(farDistance)).toBe("lod2")

    // 3. Configure memory budget: 256MB texture limit with 0.8 warning ratio (alert at 204.8MB)
    ws.perf.setMemoryBudget({
      textureBudgetMB: 256,
      geometryBudgetMB: 128,
      totalVramBudgetMB: 512,
      warnThresholdRatio: 0.8,
    })

    // 4. Progressive 4K Texture Streaming pipeline without blocking frame render
    const streamer = ws.perf.createTextureStreamer()
    const streamedSteps: number[] = []

    await streamer.loadMipmapProgressive("assets/textures/ground_pbr_4k.png", (level, [w, h]) => {
      streamedSteps.push(level)
      // Simulate frame timeline tick during streaming
      ws.perf.recordFrameTime(16.6)
    })

    expect(streamedSteps).toEqual([2, 1, 0])
    expect(ws.perf.getTimeline().length).toBe(3)

    // 5. Heavy texture allocation exceeds 80% threshold -> Fires alert
    const usageCheck = ws.perf.checkMemoryThreshold({
      textureMB: 215, // > 204.8MB
      geometryMB: 60,
      totalVramMB: 300,
    })
    expect(usageCheck.hasAnyWarning).toBe(true)
    expect(usageCheck.textureWarning).toBe(true)

    // 6. Average FPS remains locked at 60
    expect(ws.perf.getAverageFps()).toBeCloseTo(60.2, 0)
  })
})
