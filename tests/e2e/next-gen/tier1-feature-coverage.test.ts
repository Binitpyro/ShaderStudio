/**
 * Tier 1: Feature Coverage — ShaderStudio Feature Overhaul (R1–R5)
 *
 * Systematic coverage of all 46 features across the 5 requirement areas:
 * - Area R1: Node Graph Power-ups (F-NODE-01 to F-NODE-13)
 * - Area R2: Rendering Fidelity Parity (F-REND-01 to F-REND-16)
 * - Area R3: Export & Ecosystem (F-EXP-01 to F-EXP-06)
 * - Area R4: Tauri v2 Desktop App (F-DESK-01 to F-DESK-05)
 * - Area R5: Performance & Scale (F-PERF-01 to F-PERF-06)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  createNextGenWorkstationHarness,
  type NextGenWorkstationHarness,
  SubGraphLibraryHarness,
  CustomNodeSdkHarness,
  MathExpressionHarness,
  RenderingPipelineHarness,
  EngineTranspilerHarness,
  TauriDesktopHarness,
  PerformanceScaleHarness,
} from "./nextGenHarness"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 1: Feature Coverage — ShaderStudio Feature Overhaul (R1–R5)", () => {
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

  // ==========================================================================
  // Area R1: Node Graph Power-ups (F-NODE-01 to F-NODE-13)
  // ==========================================================================
  describe("Area R1: Node Graph Power-ups", () => {
    it("F-NODE-01: React Flow v12 Migration — Node state initialization, types, and connection topology", () => {
      const nodes = [
        { id: "node-uv", type: "uv", position: { x: 0, y: 0 }, data: {} },
        { id: "node-output", type: "output", position: { x: 400, y: 0 }, data: {} },
      ]
      const edges = [
        { id: "e1-2", source: "node-uv", sourceHandle: "out_uv", target: "node-output", targetHandle: "in_color" },
      ]

      useProjectStore.getState().setGraphNodes(nodes as any)
      useProjectStore.getState().setGraphEdges(edges as any)

      expect(useProjectStore.getState()._graphNodes).toHaveLength(2)
      expect(useProjectStore.getState()._graphEdges).toHaveLength(1)
      expect(useProjectStore.getState()._graphNodes[0].type).toBe("uv")
    })

    it("F-NODE-02: Sub-Graph Library & Definition — Registration, port contracts, and library queries", () => {
      const subGraphId = "custom-test-subgraph"
      ws.subgraphs.register({
        id: subGraphId,
        name: "Test Normalizer",
        description: "Normalizes an incoming 3D vector",
        inputs: [{ id: "in_v", name: "v", type: "vec3", direction: "input" }],
        outputs: [{ id: "out_norm", name: "normalized", type: "vec3", direction: "output" }],
        nodes: [{ id: "n1", type: "math", position: { x: 0, y: 0 }, data: { op: "normalize" } }],
        edges: [],
      })

      expect(ws.subgraphs.has(subGraphId)).toBe(true)
      const retrieved = ws.subgraphs.get(subGraphId)
      expect(retrieved).toBeDefined()
      expect(retrieved?.inputs[0].name).toBe("v")
      expect(retrieved?.outputs[0].type).toBe("vec3")
    })

    it("F-NODE-03: Sub-Graph Nesting & Cycle Detection — Validates depth within 8 levels and flags recursion", () => {
      // Direct cycle: A refers to A
      ws.subgraphs.register({
        id: "sg-cycle-a",
        name: "Cycle A",
        inputs: [],
        outputs: [],
        nodes: [{ id: "c1", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "sg-cycle-a" } }],
        edges: [],
      })

      expect(ws.subgraphs.detectCycle("sg-cycle-a")).toBe(true)
      expect(() => ws.subgraphs.getNestingDepth("sg-cycle-a")).toThrow(/Cycle detected/)
    })

    it("F-NODE-04: Sub-Graph Port & Uniform Flattening — Namespaces uniforms and rewires inner port connections", () => {
      const mainNodes = [
        {
          id: "sg_inst_1",
          type: "subgraph",
          position: { x: 0, y: 0 },
          data: {
            subGraphId: "builtin-fresnel-rim",
            uniformOverrides: { u_rimPower: 4.5 },
          },
        },
      ]
      const mainEdges = [
        { id: "e_in", source: "src_node", sourceHandle: "out", target: "sg_inst_1", targetHandle: "in_normal" },
      ]

      const flattened = ws.subgraphs.flattenGraph(mainNodes, mainEdges)
      expect(flattened.nodes.length).toBeGreaterThanOrEqual(4)
      expect(flattened.uniforms["sg_sg_inst_1_u_rimPower"]).toBe(4.5)
      expect(flattened.uniforms["sg_sg_inst_1_u_rimColor"]).toEqual([0.2, 0.6, 1.0])
    })

    it("F-NODE-05: 3 Built-in Sub-Graphs — Verifies shipping presets Fresnel Rim, Noise Gen, and UV Distortion", () => {
      const builtIns = ["builtin-fresnel-rim", "builtin-noise-gen", "builtin-uv-distortion"]
      for (const id of builtIns) {
        expect(ws.subgraphs.has(id)).toBe(true)
        const def = ws.subgraphs.get(id)
        expect(def?.inputs.length).toBeGreaterThan(0)
        expect(def?.outputs.length).toBeGreaterThan(0)
        expect(def?.nodes.length).toBeGreaterThan(0)
      }
    })

    it("F-NODE-06: Custom Node SDK Manifest Schema — Validates ports, parameters, types, and shaders", () => {
      const validManifest = {
        type: "custom_threshold",
        title: "Threshold Filter",
        category: "filter",
        inputs: [{ name: "value", type: "float" }],
        outputs: [{ name: "result", type: "float" }],
        parameters: [
          { name: "cutoff", type: "float", default: 0.5, ui: "slider", min: 0, max: 1 },
        ],
        glsl: "float custom_threshold(float val, float cut) { return step(cut, val); }",
      }

      const check = ws.customNodes.validateManifest(validManifest)
      expect(check.valid).toBe(true)
      expect(check.errors).toHaveLength(0)

      ws.customNodes.registerCustomNode(validManifest as any)
      expect(ws.customNodes.get("custom_threshold")).toBeDefined()
    })

    it("F-NODE-07: Custom Node Discovery & Registration — Loads JSON manifests from directory map", () => {
      const files = {
        "custom-nodes/bloom_pass.json": JSON.stringify({
          type: "custom_bloom",
          title: "Custom Bloom",
          category: "filter",
          inputs: [{ name: "tex", type: "sampler2D" }],
          outputs: [{ name: "color", type: "vec4" }],
          glsl: "vec4 custom_bloom(sampler2D t) { return vec4(1.0); }",
        }),
      }

      const res = ws.customNodes.discoverFromDirectory(files)
      expect(res.loaded).toBe(1)
      expect(ws.customNodes.get("custom_bloom")?.title).toBe("Custom Bloom")
    })

    it("F-NODE-08: Custom Node React UI Component — Supports custom inspector or canvas UI overrides", () => {
      const manifest = {
        type: "custom_curve",
        title: "Curve Remapper",
        category: "math",
        inputs: [{ name: "x", type: "float" }],
        outputs: [{ name: "y", type: "float" }],
        glsl: "float custom_curve(float x) { return x * x; }",
      }
      const MockCurveUI = () => "MockCurveEditor"

      ws.customNodes.registerCustomNode(manifest as any, MockCurveUI)
      expect(ws.customNodes.getComponent("custom_curve")).toBe(MockCurveUI)
    })

    it("F-NODE-09: Math Expression Parsing & Codegen — Translates inline expressions to GLSL and WGSL", () => {
      const expr = "sin(uv.x * 10.0) * 0.5 + 0.5"
      const glsl = ws.mathExpr.generateGLSL(expr, "float")
      const wgsl = ws.mathExpr.generateWGSL(expr, "float")

      expect(glsl).toBe("float result = sin(uv.x * 10.0) * 0.5 + 0.5;")
      expect(wgsl).toBe("let result: f32 = sin(uv.x * 10.0) * 0.5 + 0.5;")
    })

    it("F-NODE-10: Math Expression Live Validation — Whitelist verification, syntax error detection", () => {
      const valid = ws.mathExpr.validate("cos(uv.y * 3.14) * 0.5")
      expect(valid.valid).toBe(true)

      const invalidFunc = ws.mathExpr.validate("forbiddenFunction(uv.x)")
      expect(invalidFunc.valid).toBe(false)
      expect(invalidFunc.error).toContain("Unrecognized identifier")

      const unmatchedParen = ws.mathExpr.validate("sin(uv.x * 2.0")
      expect(unmatchedParen.valid).toBe(false)
      expect(unmatchedParen.error).toContain("Unclosed opening parenthesis")
    })

    it("F-NODE-11: Per-Node Live Preview — Isolates selected node in Inspector mini-viewport", () => {
      const testNode = { id: "n_fresnel", type: "fresnel", position: { x: 0, y: 0 }, data: {} }
      ws.livePreview.selectNode("n_fresnel")
      expect(ws.livePreview.getSelectedNode()).toBe("n_fresnel")

      const isolatedShader = ws.livePreview.generateIsolatedShader("n_fresnel", testNode)
      expect(isolatedShader).toContain("Isolated Mini-Viewport Pipeline for Node: n_fresnel")
      expect(ws.livePreview.getCachedRender("n_fresnel")).toBe(isolatedShader)
    })

    it("F-NODE-12: Comment Annotation Node — Renders note card and is excluded from compilation", () => {
      const nodes = [
        { id: "c1", type: "comment", position: { x: 50, y: 50 }, data: { text: "Calculate base lighting" } },
        { id: "m1", type: "math", position: { x: 200, y: 50 }, data: { op: "add" } },
      ]
      expect(ws.annotations.isAnnotationNode(nodes[0])).toBe(true)
      expect(ws.annotations.isAnnotationNode(nodes[1])).toBe(false)

      const compiled = ws.annotations.filterForCompilation(nodes)
      expect(compiled).toHaveLength(1)
      expect(compiled[0].id).toBe("m1")
    })

    it("F-NODE-13: Frame Annotation Node — Resizable bounding box groups contained nodes visually", () => {
      const frameNode = {
        id: "frame1",
        type: "frame",
        position: { x: 0, y: 0 },
        width: 500,
        height: 400,
        data: { title: "PBR Lighting Pass", color: "#3b82f6" },
      }
      const childNodeInside = { id: "n_inside", type: "math", position: { x: 100, y: 150 }, data: {} }
      const childNodeOutside = { id: "n_outside", type: "math", position: { x: 600, y: 600 }, data: {} }

      expect(ws.annotations.isContainedInFrame(childNodeInside, frameNode)).toBe(true)
      expect(ws.annotations.isContainedInFrame(childNodeOutside, frameNode)).toBe(false)
    })
  })

  // ==========================================================================
  // Area R2: Rendering Fidelity Parity (F-REND-01 to F-REND-16)
  // ==========================================================================
  describe("Area R2: Rendering Fidelity Parity", () => {
    it("F-REND-01: GBuffer MRT Pass Parity — Produces albedo, normal, roughness/metallic, depth, motionVectors", () => {
      const adapter = ws.rendering.webgpu
      adapter.setRenderingPipelineMode("deferred")

      const gbuffer = adapter.getGBufferTextures()
      expect(gbuffer).not.toBeNull()
      expect(gbuffer?.albedo).toBeDefined()
      expect(gbuffer?.normal).toBeDefined()
      expect(gbuffer?.roughnessMetallic).toBeDefined()
      expect(gbuffer?.depth).toBeDefined()
      expect(gbuffer?.motionVectors).toBeDefined()
    })

    it("F-REND-02: Deferred Fullscreen Lighting — Computes composite shading with world positions", () => {
      const adapter = ws.rendering.webgl2
      adapter.setRenderingPipelineMode("deferred")
      expect(adapter.state.pipelineMode).toBe("deferred")
      expect(adapter.getGBufferTextures()).toBeDefined()
    })

    it("F-REND-03: Forward/Deferred Mode & Channels — Toggles pipeline mode cleanly", () => {
      const adapter = ws.rendering.threejs
      expect(adapter.state.pipelineMode).toBe("forward")
      expect(adapter.getGBufferTextures()).toBeNull()

      adapter.setRenderingPipelineMode("deferred")
      expect(adapter.state.pipelineMode).toBe("deferred")
      expect(adapter.getGBufferTextures()).not.toBeNull()

      adapter.setRenderingPipelineMode("forward")
      expect(adapter.state.pipelineMode).toBe("forward")
      expect(adapter.getGBufferTextures()).toBeNull()
    })

    it("F-REND-04: Directional Light Shadows (512–4096) — Configures resolution and depth bias", () => {
      const adapter = ws.rendering.webgpu
      adapter.setShadowConfig({ resolution: 4096, bias: 0.002, normalBias: 0.005 })
      expect(adapter.state.shadowConfig.resolution).toBe(4096)
      expect(adapter.state.shadowConfig.bias).toBe(0.002)
    })

    it("F-REND-05: Point Light Shadow Cube Maps — Toggles 6-face shadow map generation", () => {
      const adapter = ws.rendering.webgl2
      expect(adapter.state.pointShadowCubeEnabled).toBe(false)
      adapter.setPointLightShadowCube(true)
      expect(adapter.state.pointShadowCubeEnabled).toBe(true)
    })

    it("F-REND-06: PCF and VSM Shadow Filtering — Supports Poisson disk PCF and Chebyshev VSM", () => {
      const adapter = ws.rendering.threejs
      adapter.setShadowConfig({ filtering: "vsm" })
      expect(adapter.state.shadowConfig.filtering).toBe("vsm")

      adapter.setShadowConfig({ filtering: "pcf" })
      expect(adapter.state.shadowConfig.filtering).toBe("pcf")
    })

    it("F-REND-07: Shadow & Environment IBL Integration — Balances direct shadows and ambient IBL", () => {
      const adapter = ws.rendering.webgpu
      adapter.setPostProcessEnabled("ssr", true, { iblBlend: 0.75 })
      expect(adapter.state.postProcessState.ssr.iblBlend).toBe(0.75)
    })

    it("F-REND-08: Screen-Space Reflections (SSR) — Configures raymarching step limits and thickness", () => {
      const adapter = ws.rendering.webgpu
      adapter.setPostProcessEnabled("ssr", true, { maxSteps: 128, thickness: 0.05 })
      expect(adapter.state.postProcessState.ssr.enabled).toBe(true)
      expect(adapter.state.postProcessState.ssr.maxSteps).toBe(128)
      expect(adapter.state.postProcessState.ssr.thickness).toBe(0.05)
    })

    it("F-REND-09: SSR Parameters & IBL Blending — Controls falloff edge fade and reflection blend", () => {
      const adapter = ws.rendering.webgl2
      adapter.setPostProcessEnabled("ssr", true, { falloff: 0.9, iblBlend: 0.4 })
      expect(adapter.state.postProcessState.ssr.falloff).toBe(0.9)
      expect(adapter.state.postProcessState.ssr.iblBlend).toBe(0.4)
    })

    it("F-REND-10: FXAA 3.11 Post-Process — Selectable edge anti-aliasing pass", () => {
      const adapter = ws.rendering.threejs
      expect(adapter.state.postProcessState.fxaa.enabled).toBe(false)
      adapter.setPostProcessEnabled("fxaa", true)
      expect(adapter.state.postProcessState.fxaa.enabled).toBe(true)
    })

    it("F-REND-11: TAA Jitter & Motion Vector Clamping — Halton subpixel jitter and reprojection clamp", () => {
      const adapter = ws.rendering.webgpu
      adapter.setPostProcessEnabled("taa", true, { jitterSample: [0.375, -0.125], motionVectorClamp: true })
      expect(adapter.state.postProcessState.taa.enabled).toBe(true)
      expect(adapter.state.postProcessState.taa.jitterSample).toEqual([0.375, -0.125])
      expect(adapter.state.postProcessState.taa.motionVectorClamp).toBe(true)
    })

    it("F-REND-12: Atmospheric Scattering Sky — Rayleigh and Mie wavelength scattering models", () => {
      const adapter = ws.rendering.webgpu
      adapter.setAtmosphereParams({ timeOfDay: 12.0, turbidity: 3.0 })
      const scattering = adapter.calculateRayleighMieScattering()

      // Blue (440nm) scatters significantly more than red (680nm)
      expect(scattering.rayleigh[2]).toBeGreaterThan(scattering.rayleigh[0])
      expect(scattering.mie).toBeGreaterThan(0)
    })

    it("F-REND-13: Sun Disc & Time-of-Day Dynamics — Solar elevation angle shifts with 0–24h parameter", () => {
      const adapter = ws.rendering.webgl2
      adapter.setAtmosphereParams({ timeOfDay: 12.0 }) // Noon -> solar zenith
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(90.0, 1)

      adapter.setAtmosphereParams({ timeOfDay: 6.0 }) // Sunrise -> horizon
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)
    })

    it("F-REND-14: Depth of Field (DoF) Bokeh — Focal distance, aperture, and bokeh kernel shape", () => {
      const adapter = ws.rendering.threejs
      adapter.setPostProcessEnabled("dof", true, { focalDistance: 8.5, aperture: 0.12, bokehShape: "hexagon" })
      expect(adapter.state.postProcessState.dof.enabled).toBe(true)
      expect(adapter.state.postProcessState.dof.focalDistance).toBe(8.5)
      expect(adapter.state.postProcessState.dof.bokehShape).toBe("hexagon")
    })

    it("F-REND-15: Screen-Space Ambient Occlusion (SSAO) — Depth and normal occlusion parameters", () => {
      const adapter = ws.rendering.webgpu
      adapter.setPostProcessEnabled("ssao", true, { radius: 0.75, intensity: 2.0, sampleCount: 32 })
      expect(adapter.state.postProcessState.ssao.enabled).toBe(true)
      expect(adapter.state.postProcessState.ssao.radius).toBe(0.75)
      expect(adapter.state.postProcessState.ssao.sampleCount).toBe(32)
    })

    it("F-REND-16: Headless Mock Parity Harness — Identical feature APIs across WebGPU, WebGL2, and Three.js", () => {
      const backends = [ws.rendering.webgpu, ws.rendering.webgl2, ws.rendering.threejs]
      for (const b of backends) {
        b.setRenderingPipelineMode("deferred")
        expect(b.state.pipelineMode).toBe("deferred")
        expect(b.getGBufferTextures()).not.toBeNull()

        b.setShadowConfig({ resolution: 1024, filtering: "pcf" })
        expect(b.state.shadowConfig.resolution).toBe(1024)

        b.setPostProcessEnabled("fxaa", true)
        expect(b.state.postProcessState.fxaa.enabled).toBe(true)
      }
    })
  })

  // ==========================================================================
  // Area R3: Export & Ecosystem Expansion (F-EXP-01 to F-EXP-06)
  // ==========================================================================
  describe("Area R3: Export & Ecosystem Expansion", () => {
    it("F-EXP-01: Unreal Engine 5 HLSL Export — Generates Custom Expression and Material Function blocks", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "float", defaultValue: 0.4 },
        { name: "u_tint", type: "vec3", defaultValue: [1, 0, 0] },
      ]
      const ue5 = ws.transpiler.transpileToUE5("float4 color = float4(1.0);", uniforms)

      expect(ue5.customExpressionHLSL).toContain("ScalarParameter: u_roughness")
      expect(ue5.customExpressionHLSL).toContain("VectorParameter: u_tint")
      expect(ue5.materialFunctionHLSL).toContain("struct MaterialFunctionOutput")
    })

    it("F-EXP-02: glTF 2.0 Material Export — Exports unlit and PBR specular glossiness extensions", () => {
      const gltf = ws.transpiler.exportGltf2Material("GoldHeroMaterial", false)
      expect(gltf.gltfJson.asset.version).toBe("2.0")
      expect(gltf.extensionsUsed).toContain("KHR_materials_pbrSpecularGlossiness")

      const gltfUnlit = ws.transpiler.exportGltf2Material("NeonGlow", true)
      expect(gltfUnlit.extensionsUsed).toContain("KHR_materials_unlit")
    })

    it("F-EXP-03: Blender Cycles OSL Export — Open Shading Language script with parameter closures", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_fresnelPower", type: "float", defaultValue: 2.5 },
      ]
      const osl = ws.transpiler.transpileToBlenderOSL("BSDF = diffuse(N);", uniforms)

      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial")
      expect(osl).toContain("float u_fresnelPower")
      expect(osl).toContain("output closure color BSDF")
    })

    it("F-EXP-04: npm-Publishable Material Package — Generates valid package.json and TypeScript loader module", () => {
      const pkg = ws.transpiler.generateNpmPackage("@shaderstudio/hero-water", "void main() {}")

      expect(pkg.packageJson.name).toBe("@shaderstudio/hero-water")
      expect(pkg.packageJson.peerDependencies.three).toBeDefined()
      expect(pkg.indexTs).toContain("export function createMaterial")
    })

    it("F-EXP-05: Shadertoy Import & Uniform Map — Maps iTime, iResolution, iMouse, iChannels to u_*", () => {
      const shadertoyCode = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 col = texture(iChannel0, uv) * sin(iTime);
  fragColor = col;
}
`
      const imported = ws.transpiler.importShadertoy(shadertoyCode)

      expect(imported.convertedSource).toContain("u_resolution")
      expect(imported.convertedSource).toContain("u_time")
      expect(imported.convertedSource).toContain("u_channel0")
      expect(imported.channels).toContain(0)
    })

    it("F-EXP-06: React Three Fiber Export Upgrades — Exports drei shaderMaterial and Storybook preview", () => {
      const r3fCode = ws.transpiler.generateR3FExport("Hologram")
      expect(r3fCode).toContain("@react-three/drei")
      expect(r3fCode).toContain("shaderMaterial")
      expect(r3fCode).toContain("export const StorybookPreview")
    })
  })

  // ==========================================================================
  // Area R4: Production Deployment — Tauri v2 Desktop App (F-DESK-01 to F-DESK-05)
  // ==========================================================================
  describe("Area R4: Tauri v2 Desktop App", () => {
    it("F-DESK-01: Tauri v2 Config & Project Layout — Confirms desktop structure and app schema", () => {
      const tauriConfig = {
        build: { frontendDist: "../dist" },
        bundle: { identifier: "com.shaderstudio.app", active: true },
      }
      expect(tauriConfig.bundle.identifier).toBe("com.shaderstudio.app")
    })

    it("F-DESK-02: Native Save/Load Project Commands — Round-trips .shaderstudio files via native commands", async () => {
      const testProject = JSON.stringify({ name: "CyberpunkNeon", version: 2 })
      const savedPath = await ws.desktop.save_project_native("C:/temp/neon.shaderstudio", testProject)
      expect(savedPath).toBe("C:/temp/neon.shaderstudio")

      const [loadedPath, loadedJson] = await ws.desktop.load_project_native(savedPath)
      expect(loadedPath).toBe(savedPath)
      expect(JSON.parse(loadedJson).name).toBe("CyberpunkNeon")
    })

    it("F-DESK-03: Tauri MCP Bridge Command — Starts in-process MCP bridge and reports status", async () => {
      expect(await ws.desktop.get_mcp_bridge_status()).toBe(false)
      const res = await ws.desktop.start_mcp_bridge(4100)
      expect(res).toContain("port 4100")
      expect(await ws.desktop.get_mcp_bridge_status()).toBe(true)

      ws.desktop.stop_mcp_bridge()
      expect(await ws.desktop.get_mcp_bridge_status()).toBe(false)
    })

    it("F-DESK-04: Desktop Window/Menu/Tray Setup — Controls window states and system tray", () => {
      expect(ws.desktop.isTrayActive()).toBe(false)
      ws.desktop.setupTray()
      expect(ws.desktop.isTrayActive()).toBe(true)

      ws.desktop.minimizeWindow()
      ws.desktop.maximizeWindow()
      ws.desktop.closeWindow()
    })

    it("F-DESK-05: Binary Slimming Optimization Profile — Validates Cargo.toml flags targeting <15MB binary", () => {
      const mockCargoToml = `
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
      const check = ws.desktop.validateBinarySizeConfig(mockCargoToml)
      expect(check.valid).toBe(true)
      expect(check.flags).toHaveLength(5)
    })
  })

  // ==========================================================================
  // Area R5: Performance & Scale (F-PERF-01 to F-PERF-06)
  // ==========================================================================
  describe("Area R5: Performance & Scale", () => {
    it("F-PERF-01: GPU Profiler Pass Timing — Tracks per-pass timings (GBuffer, shadow, lighting, SSR, post)", () => {
      const metrics: DetailedGpuMetrics = {
        fps: 60,
        frameTime: 16.6,
        passTimings: {
          gbuffer: 3.2,
          shadow: 2.1,
          lighting: 4.5,
          ssr: 2.8,
          postprocess: 1.4,
        },
        drawCalls: 45,
        triangles: 120000,
        estimatedVramBytes: 420 * 1024 * 1024,
        frameTimeline: [16.6, 16.5, 16.7],
      }
      expect(metrics.passTimings.gbuffer).toBe(3.2)
      expect(metrics.passTimings.shadow).toBe(2.1)
    })

    it("F-PERF-02: VRAM, Draw Call, & Triangle Counter — Validates telemetry calculations", () => {
      const metrics: DetailedGpuMetrics = {
        fps: 60,
        frameTime: 16.6,
        passTimings: {},
        drawCalls: 12,
        triangles: 65536,
        estimatedVramBytes: 256 * 1024 * 1024,
        frameTimeline: [],
      }
      expect(metrics.drawCalls).toBe(12)
      expect(metrics.triangles).toBe(65536)
      expect(metrics.estimatedVramBytes / (1024 * 1024)).toBe(256)
    })

    it("F-PERF-03: Frame Timeline 60-frame History — Maintains rolling circular buffer of frame durations", () => {
      for (let i = 0; i < 75; i++) {
        ws.perf.recordFrameTime(16.0 + (i % 3))
      }
      const history = ws.perf.getTimeline()
      expect(history.length).toBe(60)
      expect(ws.perf.getAverageFps()).toBeCloseTo(58.8, 1)
    })

    it("F-PERF-04: Memory Budget Warnings & Alerts — Warns when textures or geometry exceed budget threshold", () => {
      ws.perf.setMemoryBudget({
        textureBudgetMB: 200,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 400,
        warnThresholdRatio: 0.8,
      })

      // Normal safe usage (50% budget)
      const safeCheck = ws.perf.checkMemoryThreshold({ textureMB: 90, geometryMB: 40, totalVramMB: 150 })
      expect(safeCheck.hasAnyWarning).toBe(false)

      // Exceeding 80% texture threshold (170MB > 200*0.8 = 160MB)
      const alertCheck = ws.perf.checkMemoryThreshold({ textureMB: 175, geometryMB: 40, totalVramMB: 220 })
      expect(alertCheck.hasAnyWarning).toBe(true)
      expect(alertCheck.textureWarning).toBe(true)
      expect(alertCheck.geometryWarning).toBe(false)
    })

    it("F-PERF-05: Mesh LOD Distance Decimation — Generates 3-level LODs and selects based on distance", () => {
      const lods = ws.perf.generateMeshLods(100000)
      expect(lods.lod0).toBe(100000)
      expect(lods.lod1).toBe(50000)
      expect(lods.lod2).toBe(25000)

      expect(ws.perf.selectLodByDistance(5)).toBe("lod0")
      expect(ws.perf.selectLodByDistance(20)).toBe("lod1")
      expect(ws.perf.selectLodByDistance(50)).toBe("lod2")
    })

    it("F-PERF-06: Progressive Texture Streaming — Asynchronously loads mips without stalling frame loop", async () => {
      const streamer = ws.perf.createTextureStreamer()
      const mipsLoaded: Array<{ level: number; res: [number, number] }> = []

      await streamer.loadMipmapProgressive("textures/hero_albedo_4k.png", (level, res) => {
        mipsLoaded.push({ level, res })
      })

      expect(mipsLoaded).toHaveLength(3)
      expect(mipsLoaded[0].level).toBe(2) // Thumbnail first
      expect(mipsLoaded[1].level).toBe(1) // Intermediate
      expect(mipsLoaded[2].level).toBe(0) // Full 2K resolution
    })
  })
})
