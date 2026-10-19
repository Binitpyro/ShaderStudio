/**
 * Tier 3: Cross-Feature Combinations — ShaderStudio Feature Overhaul (R1–R5)
 *
 * Pairwise and multi-feature interaction tests covering complex intersecting workflows:
 * - Combo 1: Sub-Graph Nesting + Inline Math Expression Node
 * - Combo 2: Custom Node SDK Plugin + Inspector Per-Node Live Preview
 * - Combo 3: Deferred GBuffer MRT + Directional PCF Shadows + SSR + SSAO
 * - Combo 4: Sub-Graph Flattening + UE5 HLSL / Blender OSL Engine Export
 * - Combo 5: GPU Profiler Telemetry + Memory Budget + Mesh LOD Decimation
 * - Combo 6: Tauri Native Project Persistence + In-App MCP Server Bridge
 * - Combo 7: Atmospheric Sky Time-of-Day + Shadow Mapping + IBL Reflection Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  createNextGenWorkstationHarness,
  type NextGenWorkstationHarness,
} from "./nextGenHarness"

describe("Tier 3: Cross-Feature Combinations — ShaderStudio Feature Overhaul (R1–R5)", () => {
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

  it("Combo 1: Sub-Graph Nesting + Inline Math Expression Node — Compiles math expressions within nested sub-graphs", () => {
    // 1. Author a math expression node
    const mathExpr = "sin(uv.x * 6.28) * 0.5 + 0.5"
    const validation = ws.mathExpr.validate(mathExpr)
    expect(validation.valid).toBe(true)
    const glslSnippet = ws.mathExpr.generateGLSL(mathExpr, "float")

    // 2. Wrap this math node inside a sub-graph
    ws.subgraphs.register({
      id: "sg_math_wave",
      name: "Math Sine Wave",
      inputs: [{ id: "in_uv", name: "uv", type: "vec2", direction: "input" }],
      outputs: [{ id: "out_wave", name: "wave", type: "float", direction: "output" }],
      nodes: [
        {
          id: "m_expr_1",
          type: "mathExpression",
          position: { x: 50, y: 50 },
          data: { expression: mathExpr, outputType: "float" },
        },
      ],
      edges: [],
      uniforms: [{ name: "u_frequency", type: "float", defaultValue: 6.28 }],
    })

    // 3. Instantiate sub-graph in main graph and flatten
    const mainNodes = [
      {
        id: "sg_inst_wave",
        type: "subgraph",
        position: { x: 0, y: 0 },
        data: { subGraphId: "sg_math_wave", uniformOverrides: { u_frequency: 12.56 } },
      },
    ]
    const flattened = ws.subgraphs.flattenGraph(mainNodes, [])

    expect(flattened.nodes).toHaveLength(1)
    expect(flattened.nodes[0].id).toBe("sg_inst_wave_m_expr_1")
    expect(flattened.uniforms["sg_sg_inst_wave_u_frequency"]).toBe(12.56)
  })

  it("Combo 2: Custom Node SDK Plugin + Inspector Per-Node Live Preview — Isolates custom plugin node in preview", () => {
    // 1. Register custom plugin node
    const pluginManifest = {
      type: "custom_halftone",
      title: "Halftone Screen",
      category: "filter",
      inputs: [{ name: "color", type: "vec4" }],
      outputs: [{ name: "result", type: "vec4" }],
      parameters: [{ name: "dotSize", type: "float", default: 4.0 }],
      glsl: "vec4 custom_halftone(vec4 c, float s) { return c; }",
    }
    ws.customNodes.registerCustomNode(pluginManifest as any)
    expect(ws.customNodes.get("custom_halftone")).toBeDefined()

    // 2. Select custom node in canvas
    const nodeInstance = {
      id: "node_custom_1",
      type: "custom_halftone",
      position: { x: 100, y: 100 },
      data: { dotSize: 8.0 },
    }
    ws.livePreview.selectNode("node_custom_1")
    expect(ws.livePreview.getSelectedNode()).toBe("node_custom_1")

    // 3. Generate isolated preview pipeline
    const isolatedShader = ws.livePreview.generateIsolatedShader("node_custom_1", nodeInstance)
    expect(isolatedShader).toContain("Isolated Mini-Viewport Pipeline for Node: node_custom_1")
    expect(isolatedShader).toContain("custom_halftone")
  })

  it("Combo 3: Deferred GBuffer MRT + Directional PCF Shadows + SSR + SSAO — Full deferred fidelity suite", () => {
    const adapter = ws.rendering.webgpu

    // 1. Activate deferred pipeline
    adapter.setRenderingPipelineMode("deferred")
    const gbuffer = adapter.getGBufferTextures()
    expect(gbuffer).not.toBeNull()
    expect(gbuffer?.normal).toBeDefined()
    expect(gbuffer?.depth).toBeDefined()

    // 2. Configure 2048 PCF shadow mapping
    adapter.setShadowConfig({ resolution: 2048, filtering: "pcf", bias: 0.001 })
    expect(adapter.state.shadowConfig.resolution).toBe(2048)
    expect(adapter.state.shadowConfig.filtering).toBe("pcf")

    // 3. Enable Screen-Space Reflections (SSR)
    adapter.setPostProcessEnabled("ssr", true, { maxSteps: 64, thickness: 0.03, iblBlend: 0.6 })
    expect(adapter.state.postProcessState.ssr.enabled).toBe(true)

    // 4. Enable Screen-Space Ambient Occlusion (SSAO)
    adapter.setPostProcessEnabled("ssao", true, { radius: 0.8, intensity: 1.8, sampleCount: 24 })
    expect(adapter.state.postProcessState.ssao.enabled).toBe(true)
    expect(adapter.state.postProcessState.ssao.sampleCount).toBe(24)
  })

  it("Combo 4: Sub-Graph Flattening + Unreal Engine 5 HLSL Export — Transpiles flattened sub-graphs to UE5", () => {
    // 1. Flatten Fresnel Rim lighting sub-graph
    const mainNodes = [
      {
        id: "sg_rim",
        type: "subgraph",
        position: { x: 0, y: 0 },
        data: { subGraphId: "builtin-fresnel-rim" },
      },
    ]
    const flattened = ws.subgraphs.flattenGraph(mainNodes, [])
    expect(flattened.nodes.length).toBeGreaterThan(0)

    // 2. Transpile uniforms to UE5
    const uniforms = Object.entries(flattened.uniforms).map(([name, val]) => ({
      name,
      type: Array.isArray(val) ? "vec3" : "float",
      defaultValue: val,
    }))
    const ue5 = ws.transpiler.transpileToUE5("// Flattened Fresnel Logic", uniforms as any)

    expect(ue5.customExpressionHLSL).toContain("sg_sg_rim_u_rimPower")
    expect(ue5.customExpressionHLSL).toContain("sg_sg_rim_u_rimColor")
    expect(ue5.parameters.some((p) => p.name === "sg_sg_rim_u_rimColor" && p.ue5Type === "VectorParameter")).toBe(true)
  })

  it("Combo 5: GPU Profiler Telemetry + Memory Budget + Mesh LOD Decimation — Telemetry updates as LOD shifts", () => {
    // 1. Set budget
    ws.perf.setMemoryBudget({
      geometryBudgetMB: 50,
      textureBudgetMB: 200,
      totalVramBudgetMB: 300,
      warnThresholdRatio: 0.8,
    })

    // 2. High-poly mesh (100k vertices ~ 60MB geometry VRAM -> Exceeds 80% of 50MB)
    const initialCheck = ws.perf.checkMemoryThreshold({ geometryMB: 45, textureMB: 50, totalVramMB: 120 })
    expect(initialCheck.geometryWarning).toBe(true)

    // 3. Decimate mesh to LOD1 (50% vertices)
    const lods = ws.perf.generateMeshLods(100000)
    expect(lods.lod1).toBe(50000)

    // Geometry memory halved: 45MB -> 22.5MB (< 40MB threshold)
    const decimatedCheck = ws.perf.checkMemoryThreshold({ geometryMB: 22.5, textureMB: 50, totalVramMB: 97.5 })
    expect(decimatedCheck.geometryWarning).toBe(false)
    expect(decimatedCheck.hasAnyWarning).toBe(false)

    // 4. Record frame performance
    ws.perf.recordFrameTime(14.2)
    expect(ws.perf.getTimeline()).toContain(14.2)
  })

  it("Combo 6: Tauri Native Project Persistence + In-App MCP Server Bridge — Saves project while bridge runs", async () => {
    // 1. Start in-app MCP bridge
    await ws.desktop.start_mcp_bridge(3800)
    expect(await ws.desktop.get_mcp_bridge_status()).toBe(true)

    // 2. Save active project containing sub-graph configs
    const projectState = {
      name: "CinematicDeferredStudio",
      pipelineMode: "deferred",
      shadowMap: { resolution: 2048, filtering: "pcf" },
      mcpBridgePort: 3800,
    }
    const path = await ws.desktop.save_project_native(
      "C:/projects/cinematic.shaderstudio",
      JSON.stringify(projectState)
    )
    expect(path).toBe("C:/projects/cinematic.shaderstudio")

    // 3. Verify project can be loaded while MCP bridge remains operational
    const [loadedPath, loadedJson] = await ws.desktop.load_project_native(path)
    expect(loadedPath).toBe(path)
    expect(JSON.parse(loadedJson).pipelineMode).toBe("deferred")
    expect(await ws.desktop.get_mcp_bridge_status()).toBe(true)

    ws.desktop.stop_mcp_bridge()
  })

  it("Combo 7: Atmospheric Sky Time-of-Day + Shadow Mapping + IBL Reflection Integration", () => {
    const adapter = ws.rendering.webgl2

    // 1. Sunset transition: 18:00h
    adapter.setAtmosphereParams({ timeOfDay: 18.0, turbidity: 4.0 })
    expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)

    // 2. Calculate Rayleigh & Mie scattering for sunset
    const scattering = adapter.calculateRayleighMieScattering()
    expect(scattering.mie).toBeCloseTo(0.008, 3)

    // 3. Directional shadows and SSR blend with sunset IBL
    adapter.setShadowConfig({ resolution: 2048, bias: 0.004 })
    adapter.setPostProcessEnabled("ssr", true, { iblBlend: 0.85 })
    expect(adapter.state.postProcessState.ssr.iblBlend).toBe(0.85)
  })
})
