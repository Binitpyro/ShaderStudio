/**
 * Milestone 6 Adversarial Challenge: Tier 5 Cross-Module Integration & Adversarial Stress Hardening
 *
 * Rigorously stress-tests cross-module integration across R1–R5 under pathological,
 * high-concurrency, deep-nesting, and resource-constrained workloads:
 * - Domain 1: R1 ↔ R3 Cross-Module Transpilation (Sub-graphs + Custom Nodes + Math -> UE5/glTF/OSL/R3F)
 * - Domain 2: R2 ↔ R5 Rendering Fidelity & Telemetry (Deferred MRT + Shadows + SSR + SSAO under Budget)
 * - Domain 3: R5 Progressive Texture Streaming & LRU Thrashing Under Concurrency
 * - Domain 4: R4 ↔ R1/R3/R5 Tauri Native Persistence & MCP Server Bridge Concurrency
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import {
  createNextGenWorkstationHarness,
  type NextGenWorkstationHarness,
} from "./e2e/next-gen/nextGenHarness"

// Core Module Imports
import {
  flattenGraph,
  compileGraph,
  MAX_SUBGRAPH_DEPTH,
  type GraphNodeData,
  type SubGraphNodeData,
  type MathExpressionNodeData,
} from "@/core/graphCompiler"
import {
  SubGraphLibrary,
  subGraphLibrary,
  type SubGraphDefinition,
} from "@/core/subGraphLibrary"
import {
  CustomNodeRegistry,
  customNodeRegistry,
  type CustomNodeManifest,
} from "@/core/customNodeSdk"
import {
  validateMathExpression,
  compileMathExpressionToGlsl,
  compileMathExpressionToWgsl,
} from "@/core/mathExpressionValidator"
import {
  transpileToUE5,
  exportGltf2Material,
  transpileToBlenderOSL,
  generateR3FExport,
  generateNpmPackage,
  importShadertoy,
  packOrmTexture,
} from "@/core/engineTranspiler"
import {
  PerformanceTelemetry,
} from "@/core/performanceTelemetry"
import {
  MemoryBudgetManager,
  checkMemoryThreshold,
  createDefaultMemoryBudget,
  type MemoryUsage,
} from "@/core/memoryBudget"
import {
  generateMeshLods,
  selectLodByDistance,
  decimateGeometryBuffer,
  decimateIndices,
} from "@/core/meshLod"
import {
  TextureStreamer,
} from "@/core/textureStreamer"
import {
  saveProjectNative,
  loadProjectNative,
  startMcpBridge,
  stopMcpBridge,
  getMcpBridgeStatus,
  getMcpBridgePort,
  resetDesktopFallbackState,
  validateBinarySizeConfig,
} from "@/desktop/tauriBridge"
import {
  useProjectStore,
  type ParsedUniform,
} from "@/stores/projectStore"

describe("Milestone 6 Adversarial Challenge: Tier 5 Cross-Module Integration & Adversarial Stress Hardening", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let ws: NextGenWorkstationHarness

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    ws = createNextGenWorkstationHarness()
    resetDesktopFallbackState()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // DOMAIN 1: R1 ↔ R3 Cross-Module Transpilation Under Deep Nesting & Pathological Graphs
  // ==========================================================================
  describe("Domain 1: R1 ↔ R3 Cross-Module Transpilation Under Pathological Graphs", () => {
    it("1.1 Flattens an exact 8-level maximum-depth sub-graph tree and transpiles cleanly to UE5, glTF, OSL, and R3F", () => {
      const customLib = new Map<string, SubGraphDefinition>()

      // Construct 8 sub-graphs: level_8 -> level_7 -> ... -> level_1
      // Level 8 (deepest leaf)
      customLib.set("sg_level_8", {
        id: "sg_level_8",
        name: "Deep Leaf Stage 8",
        inputs: [{ id: "in_val", name: "val", type: "float", direction: "input", internalNodeId: "u_leaf_val" }],
        outputs: [{ id: "out_val", name: "val", type: "float", direction: "output", internalNodeId: "u_leaf_val" }],
        nodes: [
          {
            id: "u_leaf_val",
            type: "uniform",
            position: { x: 0, y: 0 },
            data: { type: "uniform", uniformId: "u_depth_8_param", name: "depth8Weight", uniformType: "float", defaultValue: 8.88 },
          },
        ],
        edges: [],
      })

      // Levels 7 down to 1
      for (let lvl = 7; lvl >= 1; lvl--) {
        const nextSubGraphId = `sg_level_${lvl + 1}`
        customLib.set(`sg_level_${lvl}`, {
          id: `sg_level_${lvl}`,
          name: `Nested SubGraph Level ${lvl}`,
          inputs: [{ id: "in_flow", name: "flow", type: "float", direction: "input", internalNodeId: `inner_sg_${lvl + 1}` }],
          outputs: [{ id: "out_flow", name: "flow", type: "float", direction: "output", internalNodeId: `inner_sg_${lvl + 1}` }],
          nodes: [
            {
              id: `inner_sg_${lvl + 1}`,
              type: "subgraph",
              position: { x: 100, y: 100 },
              data: {
                type: "subgraph",
                subGraphId: nextSubGraphId,
                subGraphName: `SubGraph Level ${lvl + 1}`,
                uniformValues: {
                  [`depth${lvl + 1}Weight`]: (lvl + 1) * 1.1,
                },
              },
            },
            {
              id: `u_tier_${lvl}`,
              type: "uniform",
              position: { x: 0, y: 50 },
              data: { type: "uniform", uniformId: `u_tier_${lvl}_param`, name: `tier${lvl}Factor`, uniformType: "float", defaultValue: lvl * 0.5 },
            },
          ],
          edges: [],
        })
      }

      // Root graph instantiates Level 1
      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "root_subgraph_node",
          type: "subgraph",
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "sg_level_1",
            subGraphName: "SubGraph Level 1",
            uniformValues: {
              tier1Factor: 1.25,
            },
          },
        },
      ]

      const flattenResult = flattenGraph(rootNodes, [], customLib)
      expect(flattenResult.error).toBeNull()
      expect(flattenResult.nodes.length).toBeGreaterThanOrEqual(8)

      // Verify that all 8 uniform tiers exist with namespaced names
      const uniformNodes = flattenResult.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes.length).toBe(8)

      // Map uniforms for transpilation
      const activeUniforms: ParsedUniform[] = uniformNodes.map((n) => ({
        name: (n.data as any).name,
        type: "f32",
        kind: "scalar",
      }))

      const combinedGlsl = `
precision highp float;
${activeUniforms.map((u) => `uniform float ${u.name};`).join("\n")}
varying vec2 vUv;
void main() {
  float acc = 0.0;
${activeUniforms.map((u) => `  acc += ${u.name};`).join("\n")}
  gl_FragColor = vec4(vec3(fract(acc)), 1.0);
}
`

      // 1. UE5 HLSL Transpile
      const ue5 = transpileToUE5(combinedGlsl, activeUniforms)
      expect(ue5.customExpressionHLSL).toContain("ScalarParameter:")
      expect(ue5.materialFunctionHLSL).toContain("MaterialFunctionOutput")
      expect(ue5.parameters.length).toBe(8)

      // 2. glTF 2.0 Material Export
      const gltf = exportGltf2Material("Deep8TierMaterial", false)
      expect(gltf.gltfJson.asset.version).toBe("2.0")
      expect(gltf.gltfJson.materials[0].name).toBe("Deep8TierMaterial")

      // 3. Blender Cycles OSL Export
      const osl = transpileToBlenderOSL(combinedGlsl, activeUniforms)
      expect(osl).toContain("shader ShaderStudioMaterial")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("BSDF =")

      // 4. React Three Fiber Export
      const r3f = generateR3FExport("Deep8TierMaterial", combinedGlsl, "varying vec2 vUv; void main() { vUv = uv; }", activeUniforms)
      expect(r3f).toContain("@react-three/drei")
      expect(r3f).toContain("shaderMaterial")
      expect(r3f).toContain("export const StorybookPreview")
    })

    it("1.2 Resists cycle explosions, direct mutual recursion, and depth-limit breaches (>8 levels)", () => {
      const cyclicLib = new Map<string, SubGraphDefinition>()

      // 1. Self-cycle: Node A -> Node A
      cyclicLib.set("sg_self", {
        id: "sg_self",
        name: "Self Looping SubGraph",
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "self_inst",
            type: "subgraph",
            position: { x: 0, y: 0 },
            data: { type: "subgraph", subGraphId: "sg_self", subGraphName: "Self" },
          },
        ],
        edges: [],
      })

      const selfCycleRes = flattenGraph(
        [{ id: "root_self", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_self" } }],
        [],
        cyclicLib
      )
      expect(selfCycleRes.error).toMatch(/Cycle detected/i)
      expect(selfCycleRes.nodes).toHaveLength(0)

      // 2. Mutual recursion: A -> B -> C -> A
      cyclicLib.set("sg_A", {
        id: "sg_A",
        name: "Node A",
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_B", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_B" } }],
        edges: [],
      })
      cyclicLib.set("sg_B", {
        id: "sg_B",
        name: "Node B",
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_C", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_C" } }],
        edges: [],
      })
      cyclicLib.set("sg_C", {
        id: "sg_C",
        name: "Node C",
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_A", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_A" } }],
        edges: [],
      })

      const mutualCycleRes = flattenGraph(
        [{ id: "root_mut", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_A" } }],
        [],
        cyclicLib
      )
      expect(mutualCycleRes.error).toMatch(/Cycle detected/i)
      expect(mutualCycleRes.error).toContain("sg_A -> sg_B -> sg_C -> sg_A")

      // 3. 9-level depth limit breach (exceeds MAX_SUBGRAPH_DEPTH = 8)
      const deepLib = new Map<string, SubGraphDefinition>()
      for (let i = 1; i <= 10; i++) {
        deepLib.set(`sg_depth_${i}`, {
          id: `sg_depth_${i}`,
          name: `Depth ${i}`,
          inputs: [],
          outputs: [],
          nodes: i < 10
            ? [{ id: `child_${i + 1}`, type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: `sg_depth_${i + 1}` } }]
            : [{ id: "leaf", type: "time", position: { x: 0, y: 0 }, data: { type: "time" } }],
          edges: [],
        })
      }

      const depthBreachRes = flattenGraph(
        [{ id: "root_deep", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_depth_1" } }],
        [],
        deepLib
      )
      expect(depthBreachRes.error).toMatch(/exceeds maximum allowed limit of 8 levels/i)
      expect(depthBreachRes.nodes).toHaveLength(0)
    })

    it("1.3 Integrates Custom Node Manifests and Math Expression Inlining into UE5 and glTF transpilers", () => {
      // 1. Author and validate a pathological complex math expression
      const complexExpr = "clamp(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 - floor(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453), 0.0, 1.0)"
      const val = validateMathExpression(complexExpr, ["uv"])
      expect(val.isValid).toBe(true)
      expect(val.referencedInputs).toContain("uv")

      const glslMathSnippet = compileMathExpressionToGlsl(complexExpr, "hashNoise", "float")
      const wgslMathSnippet = compileMathExpressionToWgsl(complexExpr, "hashNoise", "float")
      expect(glslMathSnippet).toContain("float hashNoise = clamp(")
      expect(wgslMathSnippet).toContain("let hashNoise: f32 = clamp(")

      // 2. Author a Custom Node manifest embedding this math calculation
      const customManifest: CustomNodeManifest = {
        type: "procedural_hash_noise",
        title: "Procedural Hash Noise Generator",
        category: "generator",
        inputs: [{ name: "uv", type: "vec2" }],
        outputs: [{ name: "noiseVal", type: "float" }],
        parameters: [
          { name: "seed", type: "float", default: 1.0, min: 0.1, max: 100.0 },
          { name: "tint", type: "vec3", default: [0.9, 0.4, 0.2] },
        ],
        glsl: `float procedural_hash_noise(vec2 uv, float seed) {
  ${glslMathSnippet}
  return hashNoise * seed;
}`,
      }

      const registry = new CustomNodeRegistry()
      const regSuccess = registry.register(customManifest)
      expect(regSuccess).toBe(true)
      expect(registry.has("procedural_hash_noise")).toBe(true)

      // 3. Assemble and transpile full shader with the custom node and math expression
      const fullShader = `
precision highp float;
uniform float u_seed;
uniform vec3 u_tint;
varying vec2 vUv;

${customManifest.glsl}

void main() {
  float n = procedural_hash_noise(vUv, u_seed);
  gl_FragColor = vec4(u_tint * n, 1.0);
}
`
      const uniforms: ParsedUniform[] = [
        { name: "u_seed", type: "f32", kind: "scalar" },
        { name: "u_tint", type: "vec3f", kind: "color" },
      ]

      // Transpile to UE5
      const ue5 = transpileToUE5(fullShader, uniforms)
      expect(ue5.customExpressionHLSL).toContain("procedural_hash_noise")
      expect(ue5.customExpressionHLSL).toContain("ScalarParameter: u_seed")
      expect(ue5.customExpressionHLSL).toContain("VectorParameter: u_tint")

      // Pack ORM textures for glTF PBR material
      const occl = new Uint8Array([255, 255, 255, 255])
      const rough = new Uint8Array([128, 128, 128, 128])
      const metal = new Uint8Array([0, 0, 0, 0])
      const orm = packOrmTexture(occl, rough, metal, 2, 2)
      expect(orm).toHaveLength(16) // 2x2 RGBA
      expect(orm[0]).toBe(255) // R: Occlusion
      expect(orm[1]).toBe(128) // G: Roughness
      expect(orm[2]).toBe(0)   // B: Metallic
      expect(orm[3]).toBe(255) // A: 255
    })

    it("1.4 Strips 100% of annotation nodes (comments & frames) during graph compilation without altering render steps", () => {
      const renderNodes: Node<GraphNodeData>[] = [
        { id: "mesh_1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "torus_knot" } },
        { id: "mat_1", type: "material", position: { x: 200, y: 0 }, data: { type: "material", shaderPath: "hero.wgsl" } },
        { id: "out_1", type: "output", position: { x: 400, y: 0 }, data: { type: "output" } },
      ]

      // 40 comment nodes and 10 frame grouping rectangles
      const annotationNodes: Node<GraphNodeData>[] = []
      for (let i = 0; i < 40; i++) {
        annotationNodes.push({
          id: `comment_${i}`,
          type: "comment",
          position: { x: i * 20, y: -100 },
          data: { type: "comment", text: `Detailed Engineering Note #${i}` },
        })
      }
      for (let j = 0; j < 10; j++) {
        annotationNodes.push({
          id: `frame_${j}`,
          type: "frame",
          position: { x: j * 100, y: -200 },
          width: 300,
          height: 400,
          data: { type: "frame", label: `Render Cluster Group ${j}` },
        })
      }

      const allNodes = [...renderNodes, ...annotationNodes]
      const edges: Edge[] = [
        { id: "e1", source: "mesh_1", target: "mat_1", targetHandle: "mesh" },
        { id: "e2", source: "mat_1", target: "out_1" },
      ]

      const compileRes = compileGraph(allNodes, edges)
      expect(compileRes.error).toBeNull()
      expect(compileRes.queue).toHaveLength(2) // MeshStep + MaterialStep
      expect(compileRes.queue.map((s) => s.type)).toEqual(["mesh", "material"])
    })
  })

  // ==========================================================================
  // DOMAIN 2: R2 ↔ R5 Rendering Fidelity & Telemetry Under Memory Stress
  // ==========================================================================
  describe("Domain 2: R2 ↔ R5 Rendering Fidelity & Telemetry Under Memory Stress", () => {
    it("2.1 Executes full deferred rendering pipeline state with telemetry and 1,000 rapid frame execution ticks", () => {
      const adapter = ws.rendering.webgpu

      // 1. Enable full deferred rendering stack
      adapter.setRenderingPipelineMode("deferred")
      expect(adapter.getGBufferTextures()).toBeDefined()

      adapter.setShadowConfig({ resolution: 4096, filtering: "pcf", bias: 0.001 })
      adapter.setPointLightShadowCube(true)
      adapter.setPostProcessEnabled("ssr", true, { maxSteps: 128, thickness: 0.02, iblBlend: 0.5 })
      adapter.setPostProcessEnabled("ssao", true, { radius: 0.8, sampleCount: 32, intensity: 1.5 })
      adapter.setPostProcessEnabled("dof", true, { focalDistance: 5.0, aperture: 0.05, bokehShape: "hexagon" })
      adapter.setPostProcessEnabled("taa", true, { motionVectorClamp: true })
      adapter.setAtmosphereParams({ timeOfDay: 18.0, sunIntensity: 1.5, turbidity: 3.0 })

      // 2. Telemetry stress test: 1,000 rapid frame ticks
      const telemetry = new PerformanceTelemetry()

      telemetry.setPassTiming("gbuffer", 2.1)
      telemetry.setPassTiming("shadow", 3.4)
      telemetry.setPassTiming("deferred_lighting", 4.2)
      telemetry.setPassTiming("ssr", 3.8)
      telemetry.setPassTiming("ssao", 1.9)
      telemetry.setPassTiming("dof", 1.5)
      telemetry.setPassTiming("postprocess", 1.1)
      telemetry.setPassTiming("taa", 0.9)
      telemetry.setDrawCalls(145)
      telemetry.setTriangles(480000)

      for (let i = 0; i < 1000; i++) {
        // Vary frame times with noisy realistic data and occasional spikes
        const frameMs = i % 50 === 0 ? 33.3 : (14.0 + (i % 5))
        telemetry.recordFrameTime(frameMs)
      }

      // Ring buffer must hold exactly 60 entries max
      expect(telemetry.getTimeline().length).toBe(60)
      const avgFps = telemetry.getAverageFps()
      expect(avgFps).toBeGreaterThan(25.0)
      expect(avgFps).toBeLessThan(75.0)
      expect(Number.isFinite(avgFps)).toBe(true)
      expect(telemetry.getDrawCalls()).toBe(145)
      expect(telemetry.getTriangles()).toBe(480000)

      const timings = telemetry.getPassTimings()
      expect(timings.gbuffer).toBe(2.1)
      expect(timings.ssr).toBe(3.8)
    })

    it("2.2 Stress-tests Memory Budget Manager threshold detection, boundary conditions, and eviction listener callbacks", () => {
      const budgetManager = new MemoryBudgetManager({
        textureBudgetMB: 128,
        geometryBudgetMB: 64,
        totalVramBudgetMB: 256,
        warnThresholdRatio: 0.8, // Texture warning limit: 102.4 MB, Geometry: 51.2 MB, Total: 204.8 MB
      })

      const warningsReceived: any[] = []
      const evictionsReceived: any[] = []

      budgetManager.onWarning((res, usage, budget) => {
        warningsReceived.push({ res, usage, budget })
      })
      budgetManager.onEvictionRequired((type, excess) => {
        evictionsReceived.push({ type, excess })
      })

      // Boundary Test 1: Exactly at threshold (102.4 MB) -> No warning (strictly > required)
      const exactBoundary: MemoryUsage = { textureMB: 102.4, geometryMB: 50.0, totalVramMB: 160.0 }
      const res1 = budgetManager.evaluateUsage(exactBoundary)
      expect(res1.textureWarning).toBe(false)
      expect(res1.hasAnyWarning).toBe(false)
      expect(warningsReceived.length).toBe(0)

      // Boundary Test 2: 102.41 MB -> Warning trips
      const overBoundary: MemoryUsage = { textureMB: 102.41, geometryMB: 50.0, totalVramMB: 160.0 }
      const res2 = budgetManager.evaluateUsage(overBoundary)
      expect(res2.textureWarning).toBe(true)
      expect(res2.hasAnyWarning).toBe(true)
      expect(warningsReceived.length).toBe(1)
      expect(evictionsReceived.length).toBe(1)
      expect(evictionsReceived[0].type).toBe("texture")
      expect(evictionsReceived[0].excess).toBeCloseTo(0.01, 2)

      // Multiple simultaneous budget breaches
      const massiveOverload: MemoryUsage = { textureMB: 150.0, geometryMB: 70.0, totalVramMB: 300.0 }
      const res3 = budgetManager.evaluateUsage(massiveOverload)
      expect(res3.textureWarning).toBe(true)
      expect(res3.geometryWarning).toBe(true)
      expect(res3.totalVramWarning).toBe(true)
      expect(evictionsReceived.length).toBe(4) // 1 previous + 3 new (texture, geometry, total)
    })

    it("2.3 Decimates massive 500,000 vertex mesh buffers across 3 LOD tiers with geometry and index buffer integrity", () => {
      const vertexCount = 500000
      const lodCounts = generateMeshLods(vertexCount)
      expect(lodCounts.lod0).toBe(500000)
      expect(lodCounts.lod1).toBe(250000)
      expect(lodCounts.lod2).toBe(125000)

      // Camera distance selection checks
      expect(selectLodByDistance(5.0)).toBe("lod0")
      expect(selectLodByDistance(10.0)).toBe("lod0") // Boundary
      expect(selectLodByDistance(10.1)).toBe("lod1")
      expect(selectLodByDistance(30.0)).toBe("lod1") // Boundary
      expect(selectLodByDistance(30.1)).toBe("lod2")
      expect(selectLodByDistance(Infinity)).toBe("lod2")

      // Decimate Float32Array positions buffer (3 components per vertex: 1.5M floats)
      const positions = new Float32Array(vertexCount * 3)
      for (let i = 0; i < positions.length; i++) {
        positions[i] = (i % 1000) * 0.1
      }

      // LOD1 Decimation (50% vertices -> 250,000 * 3 = 750,000 floats)
      const lod1Buffer = decimateGeometryBuffer(positions, "lod1", 3)
      expect(lod1Buffer.length).toBe(750000)
      expect(lod1Buffer[0]).toBe(positions[0])
      expect(lod1Buffer[1]).toBe(positions[1])
      expect(lod1Buffer[2]).toBe(positions[2])
      // Stride check: vertex index 1 in decimated corresponds to index 2 in original
      expect(lod1Buffer[3]).toBe(positions[6])
      expect(lod1Buffer[4]).toBe(positions[7])
      expect(lod1Buffer[5]).toBe(positions[8])

      // LOD2 Decimation (25% vertices -> 125,000 * 3 = 375,000 floats)
      const lod2Buffer = decimateGeometryBuffer(positions, "lod2", 3)
      expect(lod2Buffer.length).toBe(375000)

      // Decimate index buffer (250,000 triangles = 750,000 indices)
      const indices = new Uint32Array(750000)
      for (let t = 0; t < 250000; t++) {
        indices[t * 3] = t
        indices[t * 3 + 1] = t + 1
        indices[t * 3 + 2] = t + 2
      }

      const decimatedIndices = decimateIndices(indices, "lod1")
      expect(decimatedIndices.length).toBe(375000) // 50% triangles = 125,000 * 3

      // Pathological corner cases: 0 vertices, negative vertices, non-finite
      expect(generateMeshLods(0)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(-100)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(NaN)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      const smallQuad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
      expect(decimateGeometryBuffer(smallQuad, "lod1", 3).length).toBe(smallQuad.length) // Protected <=4 vertices
    })
  })

  // ==========================================================================
  // DOMAIN 3: R5 Progressive Texture Streaming & LRU Thrashing Under Concurrency
  // ==========================================================================
  describe("Domain 3: R5 Progressive Texture Streaming & LRU Thrashing Under Concurrency", () => {
    it("3.1 Executes 20 concurrent progressive mipmap texture streams with non-blocking frame ticks", async () => {
      const streamer = new TextureStreamer({ memoryLimitMB: 512 })
      const streamCount = 20
      const completedStreams: number[] = []

      const loadTasks = Array.from({ length: streamCount }, async (_, idx) => {
        const url = `assets/textures/tex_pbr_4k_${idx}.png`
        const progression: number[] = []

        await streamer.loadMipmapProgressive(url, (mipLevel, [w, h]) => {
          progression.push(mipLevel)
          expect(w).toBeGreaterThan(0)
          expect(h).toBeGreaterThan(0)
        })

        expect(progression).toEqual([2, 1, 0]) // mip 2 (thumbnail) -> mip 1 -> mip 0 (full)
        completedStreams.push(idx)
      })

      await Promise.all(loadTasks)
      expect(completedStreams.length).toBe(20)
      expect(streamer.getResidentTextureCount()).toBe(20)
      expect(streamer.getResidentMemoryMB()).toBeGreaterThan(0)
    })

    it("3.2 Enforces strict LRU eviction and memory bounds under high cache thrashing", async () => {
      // Configure tight 32 MB limit
      const streamer = new TextureStreamer({ memoryLimitMB: 32 })
      const evictedUrls: string[] = []

      streamer.onEvict((url, bytes) => {
        evictedUrls.push(url)
        expect(bytes).toBeGreaterThan(0)
      })

      // Load 15 textures (each 4K texture is ~64MB uncompressed, but our streamer simulates progressive mip allocations)
      for (let i = 0; i < 15; i++) {
        const url = `assets/textures/ground_${i}.png`
        await streamer.loadMipmapProgressive(url, () => {})
      }

      // Assert that cache eviction occurred and resident memory remains within budget
      expect(evictedUrls.length).toBeGreaterThan(0)
      expect(streamer.getResidentMemoryMB()).toBeLessThanOrEqual(32)

      // Test active touch() keeps hot texture resident
      const hotUrl = "assets/textures/ground_hero_hot.png"
      await streamer.loadMipmapProgressive(hotUrl, () => {})
      expect(streamer.isCached(hotUrl)).toBe(true)

      // Repeatedly touch the hot texture while streaming other textures
      for (let j = 20; j < 35; j++) {
        streamer.touch(hotUrl)
        await streamer.loadMipmapProgressive(`assets/textures/ambient_${j}.png`, () => {})
      }

      // Hot texture must NOT be evicted because its access timestamp was continuously refreshed
      expect(streamer.isCached(hotUrl)).toBe(true)
    })

    it("3.3 Handles pathological streamer boundary conditions gracefully", () => {
      const streamer = new TextureStreamer()

      // 1. evictLru on empty cache
      expect(streamer.evictLru()).toBeNull()

      // 2. Negative memory limit clamp (clamped to minimum 1 MB)
      streamer.setMemoryLimitMB(-50)
      expect(streamer.getMemoryLimitMB()).toBe(1)

      // 3. touch on non-existent texture should not throw
      expect(() => streamer.touch("non_existent.png")).not.toThrow()
    })
  })

  // ==========================================================================
  // DOMAIN 4: R4 ↔ R1/R3/R5 Tauri Native Persistence & MCP Server Bridge Concurrency
  // ==========================================================================
  describe("Domain 4: R4 ↔ R1/R3/R5 Tauri Native Persistence & MCP Server Bridge Concurrency", () => {
    it("4.1 Saves and reloads deep multi-tier workstation projects with 100% round-trip fidelity", async () => {
      const complexProject = {
        name: "HyperWorkstationProject",
        version: "2.0.0",
        backend: "webgpu" as const,
        graphNodes: [
          {
            id: "sg_fresnel_node",
            type: "subgraph",
            position: { x: 50, y: 50 },
            data: {
              type: "subgraph",
              subGraphId: "builtin-fresnel-rim",
              uniformValues: { u_rimPower: 4.5, u_rimColor: [0.1, 0.7, 1.0] },
            },
          },
          {
            id: "math_expr_1",
            type: "math_expression",
            position: { x: 300, y: 50 },
            data: {
              type: "math_expression",
              expression: "sin(uv.x * 12.0) * cos(uv.y * 12.0)",
              outputType: "float",
            },
          },
          {
            id: "comment_note",
            type: "comment",
            position: { x: 50, y: 0 },
            data: { type: "comment", text: "Studio Grade Production PBR Graph" },
          },
        ],
        graphEdges: [
          { id: "e1", source: "sg_fresnel_node", target: "math_expr_1" },
        ],
        uniformValues: {
          u_time: { type: "float" as const, value: 42.5 },
          u_tint: { type: "color" as const, value: [1.0, 0.5, 0.2] },
        },
        graphUniforms: [],
        shaderSources: {
          wgsl: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }",
          compute: "@compute @workgroup_size(64) fn cs() {}",
        },
        audioSettings: {
          sourceType: "builtin" as const,
          volume: 0.9,
          gain: 1.5,
          smoothing: 0.85,
        },
        audioBindings: {
          u_bassKick: { track: "low" as const, multiplier: 2.0 },
        },
        variations: [
          { id: "var_1", name: "Sunset Gold", uniformValues: { u_time: { type: "float" as const, value: 18.0 } }, createdAt: 123456 },
        ],
        environmentSettings: {
          preset: "sunset_warm" as any,
          exposure: 1.25,
          rotation: 45.0,
          backgroundBlur: 0.1,
          showSkybox: true,
        },
        memoryBudget: {
          textureBudgetMB: 1024,
          geometryBudgetMB: 512,
          totalVramBudgetMB: 2048,
          warnThresholdRatio: 0.85,
        },
      }

      const projectJson = JSON.stringify(complexProject)
      const targetPath = "C:/Users/binit/Documents/ShaderStudio/studio_hyper.shaderstudio"

      // 1. Save Native
      const savedPath = await saveProjectNative(targetPath, projectJson)
      expect(savedPath).toBe(targetPath)

      // 2. Load Native
      const [loadedPath, loadedJson] = await loadProjectNative(targetPath)
      expect(loadedPath).toBe(targetPath)

      // 3. Verify 100% round-trip JSON equality
      const rehydrated = JSON.parse(loadedJson)
      expect(rehydrated).toEqual(complexProject)

      // 4. Ingest into Zustand project store
      const store = useProjectStore.getState()
      store.loadProjectData(rehydrated)

      const storeState = useProjectStore.getState()
      expect(storeState.currentProjectName).toBe("HyperWorkstationProject")
      expect(storeState.activeBackend).toBe("webgpu")
      expect(storeState.memoryBudget.totalVramBudgetMB).toBe(2048)
      expect(storeState.variations).toHaveLength(1)
      expect(storeState.variations[0].name).toBe("Sunset Gold")
    })

    it("4.2 Strictly rejects non-.shaderstudio file extensions and non-existent paths", async () => {
      const invalidPaths = [
        "C:/project.json",
        "C:/project.txt",
        "C:/project.shaderstudio.bak",
        "C:/project",
        "project.png",
      ]

      for (const p of invalidPaths) {
        await expect(saveProjectNative(p, "{}")).rejects.toThrow("File extension must be .shaderstudio")
      }

      await expect(loadProjectNative("C:/does_not_exist.shaderstudio")).rejects.toThrow("File not found")
    })

    it("4.3 Gracefully handles corrupted, truncated, and malformed project payloads in the project store", () => {
      const store = useProjectStore.getState()

      // 1. Missing optional properties
      const sparseData: any = {
        name: "SparseProject",
        backend: "webgl2",
        shaderSources: { glsl: "void main(){}" },
      }
      expect(() => store.loadProjectData(sparseData)).not.toThrow()
      expect(useProjectStore.getState().currentProjectName).toBe("SparseProject")
      expect(useProjectStore.getState().memoryBudget.textureBudgetMB).toBe(512) // Default applied

      // 2. Corrupted data types (non-array nodes, null environment)
      const malformedData: any = {
        name: "MalformedProject",
        backend: "threejs",
        graphNodes: null,
        graphEdges: null,
        environmentSettings: null,
        memoryBudget: null,
        shaderSources: {},
      }
      expect(() => store.loadProjectData(malformedData)).not.toThrow()
      expect(useProjectStore.getState().currentProjectName).toBe("MalformedProject")
      expect(useProjectStore.getState().environmentSettings.preset).toBe("studio_warm")
    })

    it("4.4 Stress-tests In-Process Warp MCP Server Bridge port validation and rapid concurrency", async () => {
      // 1. Port boundary validation
      const invalidPorts = [0, 80, 443, 1024, 65536, -5, 70000]
      for (const port of invalidPorts) {
        await expect(startMcpBridge(port)).rejects.toThrow(/Must be between 1025 and 65535/)
      }

      // 2. Valid port
      const msg = await startMcpBridge(4500)
      expect(msg).toContain("4500")
      expect(await getMcpBridgeStatus()).toBe(true)
      expect(getMcpBridgePort()).toBe(4500)

      // 3. Stop bridge
      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
      expect(getMcpBridgePort()).toBe(0)

      // 4. Concurrency stress: 20 rapid start/stop calls
      const concurrentCalls = Array.from({ length: 20 }, async (_, idx) => {
        if (idx % 2 === 0) {
          return await startMcpBridge(5000 + idx)
        } else {
          stopMcpBridge()
          return "stopped"
        }
      })

      await expect(Promise.all(concurrentCalls)).resolves.toBeDefined()

      // Reset to known clean state
      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
    })

    it("4.5 Validates Tauri Cargo.toml binary size optimization profile (< 15 MB) flags", () => {
      const validCargoToml = `
[package]
name = "shaderstudio-desktop"
version = "0.1.0"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`
      const checkValid = validateBinarySizeConfig(validCargoToml)
      expect(checkValid.valid).toBe(true)
      expect(checkValid.flags).toHaveLength(5)

      // Missing 'strip = true' and 'lto = true'
      const invalidCargoToml = `
[profile.release]
opt-level = "z"
codegen-units = 1
panic = "abort"
`
      const checkInvalid = validateBinarySizeConfig(invalidCargoToml)
      expect(checkInvalid.valid).toBe(false)
    })
  })
})
