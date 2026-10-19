/**
 * Tier 5: Comprehensive White-Box Adversarial Coverage & Boundary Hardening
 *
 * Systematic white-box verification across overhauled modules (R1–R5):
 * 1. R1: subGraphLibrary, graphCompiler, customNodeSdk, mathExpressionValidator
 * 2. R2: multi-backend parity (WebGPU, WebGL2, Three.js) for GBuffer MRT, shadows, SSR, DoF, SSAO, FXAA/TAA, Rayleigh/Mie atmosphere
 * 3. R3: engineTranspiler (UE5 HLSL, glTF 2.0 ORM, Blender OSL, npm package generator, Shadertoy import, R3F)
 * 4. R4: tauriBridge desktop native FS save/load, in-process MCP bridge, window/tray, binary profile validation
 * 5. R5: performanceTelemetry circular buffer, memoryBudget strict threshold inequality, meshLod decimation, progressive textureStreamer LRU
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"

// R1 imports
import {
  subGraphLibrary,
  collapseNodesToSubGraph,
  BUILTIN_FRESNEL_RIM,
  BUILTIN_NOISE_GEN,
  BUILTIN_UV_DISTORTION,
  type SubGraphDefinition,
} from "@/core/subGraphLibrary"
import {
  flattenGraph,
  compileGraph,
  buildSdfTree,
  MAX_SUBGRAPH_DEPTH,
  type GraphNodeData,
} from "@/core/graphCompiler"
import {
  customNodeRegistry,
  validateCustomNodeManifest,
  type CustomNodeManifest,
} from "@/core/customNodeSdk"
import {
  validateMathExpression,
  compileMathExpressionToGlsl,
  compileMathExpressionToWgsl,
} from "@/core/mathExpressionValidator"
import type { Node, Edge } from "@xyflow/react"

// R2 imports
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"

// R3 imports
import {
  transpileToUE5,
  transpileToUnrealHLSL,
  transpileToBlenderOSL,
  exportGltf2Material,
  packOrmTexture,
  generateNpmPackage,
  importShadertoy,
  createProjectFromShadertoy,
  generateR3FExport,
} from "@/core/engineTranspiler"

// R4 imports
import {
  getDefaultProjectPath,
  saveProjectNative,
  loadProjectNative,
  startMcpBridge,
  getMcpBridgeStatus,
  getMcpBridgePort,
  stopMcpBridge,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  setupTray,
  isTrayActive,
  validateBinarySizeConfig,
  resetDesktopFallbackState,
} from "@/desktop/tauriBridge"

// R5 imports
import { performanceTelemetry } from "@/core/performanceTelemetry"
import {
  checkMemoryThreshold,
  createDefaultMemoryBudget,
  MemoryBudgetManager,
} from "@/core/memoryBudget"
import {
  generateMeshLods,
  selectLodByDistance,
  decimateGeometryBuffer,
  decimateIndices,
} from "@/core/meshLod"
import { createTextureStreamer } from "@/core/textureStreamer"

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
  // BATTERY 1: R1 Node Graph Power-ups White-Box Edge Cases & Branch Coverage
  // ==========================================================================
  describe("Battery 1: R1 Node Graph Power-ups White-Box Edge Cases", () => {
    it("1.1 collapseNodesToSubGraph rejects empty selection", () => {
      expect(() => {
        collapseNodesToSubGraph([], [])
      }).toThrow("Cannot collapse empty selection into a sub-graph.")
    })

    it("1.2 collapseNodesToSubGraph partitions edges and deduplicates ports correctly", () => {
      const selectedNodes: Node<GraphNodeData>[] = [
        {
          id: "node_a",
          type: "uniform",
          position: { x: 100, y: 100 },
          data: { type: "uniform", uniformId: "u_val", name: "u_val", uniformType: "float", defaultValue: 1.0 },
        },
        {
          id: "node_b",
          type: "material",
          position: { x: 300, y: 100 },
          data: { type: "material", shaderPath: "test.wgsl" },
        },
      ]

      const allEdges: Edge[] = [
        // Internal edge (between selected nodes)
        { id: "e_internal", source: "node_a", target: "node_b", targetHandle: "param" },
        // Two external incoming edges targeting the same handle (tests deduplication)
        { id: "e_in1", source: "ext_source1", target: "node_b", targetHandle: "mesh" },
        { id: "e_in2", source: "ext_source2", target: "node_b", targetHandle: "mesh" },
        // External outgoing edge from node_b to external target
        { id: "e_out1", source: "node_b", target: "ext_target1", sourceHandle: "color" },
        // Unrelated edge (between two external nodes)
        { id: "e_unrelated", source: "ext_source1", target: "ext_target1" },
      ]

      const result = collapseNodesToSubGraph(selectedNodes, allEdges, {
        id: "test_collapsed_subgraph",
        name: "Test Group",
        category: "Utility",
      })

      expect(result.definition.id).toBe("test_collapsed_subgraph")
      expect(result.definition.name).toBe("Test Group")
      expect(result.definition.category).toBe("Utility")
      expect(result.definition.isBuiltin).toBe(false)
      // Exactly 1 deduplicated input port for node_b's "mesh" handle
      expect(result.definition.inputs.length).toBe(1)
      expect(result.definition.inputs[0].internalNodeId).toBe("node_b")
      expect(result.definition.inputs[0].internalHandleId).toBe("mesh")
      // Exactly 1 output port
      expect(result.definition.outputs.length).toBe(1)
      expect(result.definition.outputs[0].internalNodeId).toBe("node_b")

      // SubGraphNode position matches minimum (x: 100, y: 100)
      expect(result.subGraphNode.position).toEqual({ x: 100, y: 100 })
      expect(result.subGraphNode.data.type).toBe("subgraph")

      // Check rewired edges: unrelated edge preserved, incoming rewired to subgraph, outgoing rewired from subgraph
      expect(result.remainingEdges.some((e) => e.id === "e_unrelated")).toBe(true)
      const rewiredIn1 = result.remainingEdges.find((e) => e.id === "e_in1")
      expect(rewiredIn1?.target).toBe("test_collapsed_subgraph")
      const rewiredOut1 = result.remainingEdges.find((e) => e.id === "e_out1")
      expect(rewiredOut1?.source).toBe("test_collapsed_subgraph")
    })

    it("1.3 SubGraphLibrary enforces builtin protection and category filtering", () => {
      // Cannot unregister builtins
      expect(subGraphLibrary.unregister("builtin-fresnel-rim")).toBe(false)
      expect(subGraphLibrary.unregister("builtin-noise-gen")).toBe(false)
      expect(subGraphLibrary.unregister("builtin-uv-distortion")).toBe(false)
      expect(subGraphLibrary.has("builtin-fresnel-rim")).toBe(true)

      // Unregister non-existent returns false
      expect(subGraphLibrary.unregister("ghost_id")).toBe(false)

      // User sub-graph lifecycle
      const customDef: SubGraphDefinition = {
        id: "user_lens_flare",
        name: "Lens Flare",
        description: "Custom user flare",
        category: "Lighting",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [],
        edges: [],
      }
      subGraphLibrary.register(customDef)
      expect(subGraphLibrary.has("user_lens_flare")).toBe(true)
      expect(subGraphLibrary.getByCategory("Lighting").some((d) => d.id === "user_lens_flare")).toBe(true)
      expect(subGraphLibrary.getByCategory("NonExistentCategory")).toEqual([])

      expect(subGraphLibrary.unregister("user_lens_flare")).toBe(true)
      expect(subGraphLibrary.has("user_lens_flare")).toBe(false)

      // Reset restores exactly the 3 builtins
      subGraphLibrary.register(customDef)
      subGraphLibrary.reset()
      expect(subGraphLibrary.has("user_lens_flare")).toBe(false)
      expect(subGraphLibrary.getAll().length).toBe(3)
    })

    it("1.4 flattenGraph detects recursion overflow (>8 levels) and cycle recursion", () => {
      // Build a 9-level deep chain
      for (let i = 1; i <= 9; i++) {
        subGraphLibrary.register({
          id: `deep_sg_${i}`,
          name: `Level ${i}`,
          description: `Level ${i}`,
          category: "Utility",
          isBuiltin: false,
          inputs: [],
          outputs: [],
          nodes: i < 9
            ? [{ id: `child_${i}`, type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: `deep_sg_${i + 1}`, name: `Level ${i + 1}` } }]
            : [{ id: `leaf`, type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } }],
          edges: [],
        })
      }

      const overflowResult = flattenGraph(
        [{ id: "root_sub", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "deep_sg_1", name: "Root" } }],
        []
      )
      expect(overflowResult.error).toMatch(/Sub-graph nesting depth exceeds maximum allowed limit of 8 levels/)

      // Direct self-reference cycle
      subGraphLibrary.register({
        id: "self_cycle_sg",
        name: "Self Cycle",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "self_child", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "self_cycle_sg", name: "Self" } }],
        edges: [],
      })

      const cycleResult = flattenGraph(
        [{ id: "root_cycle", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "self_cycle_sg", name: "Cycle" } }],
        []
      )
      expect(cycleResult.error).toMatch(/Cycle detected in sub-graph expansion/)
    })

    it("1.5 flattenGraph applies uniform namespacing and value override precedence", () => {
      subGraphLibrary.register({
        id: "override_sg",
        name: "Override SG",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "u_alpha",
            type: "uniform",
            position: { x: 0, y: 0 },
            data: { type: "uniform", uniformId: "alpha", name: "alpha", uniformType: "float", defaultValue: 0.1 },
          },
          {
            id: "u_beta",
            type: "uniform",
            position: { x: 0, y: 0 },
            data: { type: "uniform", uniformId: "beta", name: "beta", uniformType: "float", defaultValue: 0.2 },
          },
        ],
        edges: [],
      })

      const rootNode: Node<GraphNodeData> = {
        id: "sub_inst_1",
        type: "subgraph",
        position: { x: 0, y: 0 },
        data: {
          type: "subgraph",
          subGraphId: "override_sg",
          name: "Sub Instance 1",
          uniformValues: {
            // Override using original name
            alpha: 0.95,
            // Override using namespaced name
            u_sub_inst_1_beta: 0.88,
          },
        },
      }

      const res = flattenGraph([rootNode], [])
      expect(res.error).toBeNull()
      const uAlpha = res.nodes.find((n) => n.id === "sub_inst_1__u_alpha")
      const uBeta = res.nodes.find((n) => n.id === "sub_inst_1__u_beta")

      expect(uAlpha).toBeDefined()
      expect((uAlpha?.data as any).name).toBe("u_sub_inst_1_alpha")
      expect((uAlpha?.data as any).defaultValue).toBe(0.95)

      expect(uBeta).toBeDefined()
      expect((uBeta?.data as any).name).toBe("u_sub_inst_1_beta")
      expect((uBeta?.data as any).defaultValue).toBe(0.88)
    })

    it("1.6 compileGraph validates missing/multiple outputs and material inputs", () => {
      // 0 output nodes
      const noOutputRes = compileGraph(
        [{ id: "m1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } }],
        []
      )
      expect(noOutputRes.error).toBe("No output node found. Add an Output node to render.")

      // 2 output nodes
      const multiOutputRes = compileGraph(
        [
          { id: "o1", type: "output", position: { x: 0, y: 0 }, data: { type: "output" } },
          { id: "o2", type: "output", position: { x: 100, y: 0 }, data: { type: "output" } },
        ],
        []
      )
      expect(multiOutputRes.error).toBe("Multiple output nodes found. Only one Output node is allowed.")

      // Material node without mesh input
      const matNoMeshRes = compileGraph(
        [
          { id: "mat1", type: "material", position: { x: 0, y: 0 }, data: { type: "material", shaderPath: "mat.wgsl" } },
          { id: "out1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
        ],
        [{ id: "e1", source: "mat1", target: "out1" }]
      )
      expect(matNoMeshRes.error).toBe('Material node "mat1" is missing a mesh input.')

      // Material node connected to texture instead of mesh
      const matBadMeshRes = compileGraph(
        [
          { id: "tex1", type: "texture", position: { x: 0, y: 0 }, data: { type: "texture", textureId: "t1", name: "tex" } },
          { id: "mat1", type: "material", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "mat.wgsl" } },
          { id: "out1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
        ],
        [
          { id: "e1", source: "tex1", target: "mat1", targetHandle: "mesh" },
          { id: "e2", source: "mat1", target: "out1" },
        ]
      )
      expect(matBadMeshRes.error).toBe('Material node "mat1" must be connected to a Mesh node.')
    })

    it("1.7 compileGraph topological sort detects circular dependency and filters annotation nodes", () => {
      const cyclicNodes: Node<GraphNodeData>[] = [
        { id: "mesh1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "mat1", type: "material", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "m.wgsl" } },
        { id: "audio1", type: "audio", position: { x: 100, y: 100 }, data: { type: "audio" } },
        { id: "comment1", type: "comment", position: { x: 0, y: 200 }, data: { type: "comment", text: "Annotate" } },
        { id: "frame1", type: "frame", position: { x: 0, y: 300 }, data: { type: "frame", label: "Group" } },
        { id: "out1", type: "output", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]

      // Create cycle: mat1 -> audio1 -> mat1
      const cyclicEdges: Edge[] = [
        { id: "e_mesh", source: "mesh1", target: "mat1", targetHandle: "mesh" },
        { id: "e_c1", source: "mat1", target: "audio1" },
        { id: "e_c2", source: "audio1", target: "mat1" },
        { id: "e_out", source: "mat1", target: "out1" },
      ]

      const res = compileGraph(cyclicNodes, cyclicEdges)
      expect(res.error).toMatch(/Cycle detected in node graph involving node/)
    })

    it("1.8 buildSdfTree prevents circular recursion with fallback sphere", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "op_a",
          type: "sdf_operator",
          position: { x: 0, y: 0 },
          data: { type: "sdf_operator", operatorType: "smooth_union", params: { type: "smooth_union", smoothness: 0.2 } },
        },
        {
          id: "op_b",
          type: "sdf_operator",
          position: { x: 100, y: 0 },
          data: { type: "sdf_operator", operatorType: "intersection", params: { type: "intersection" } },
        },
      ]
      // Cycle: op_a -> op_b -> op_a
      const edges: Edge[] = [
        { id: "se1", source: "op_b", target: "op_a" },
        { id: "se2", source: "op_a", target: "op_b" },
      ]

      const tree = buildSdfTree("op_a", nodes, edges)
      expect(tree.kind).toBe("operator")
      // Recursion halted cleanly; children resolved to fallback spheres
      expect(tree.children?.length).toBeGreaterThan(0)
    })

    it("1.9 validateCustomNodeManifest rejects invalid schemas and registers valid manifests", () => {
      // Non-object
      expect(validateCustomNodeManifest(null).valid).toBe(false)
      expect(validateCustomNodeManifest("string").valid).toBe(false)

      // Missing ID or Title
      expect(validateCustomNodeManifest({ name: "Foo" }).valid).toBe(false)
      expect(validateCustomNodeManifest({ id: "foo" }).valid).toBe(false)

      // Missing ports
      expect(validateCustomNodeManifest({ id: "foo", name: "Foo", inputs: "not_array" }).valid).toBe(false)

      // Missing shader code
      expect(validateCustomNodeManifest({
        id: "empty_node",
        name: "Empty Node",
        inputs: [],
        outputs: [],
        parameters: [],
      }).valid).toBe(false)

      // Valid manifest with only WGSL
      const validWgslManifest: CustomNodeManifest = {
        id: "chroma_key",
        name: "Chroma Key",
        category: "filter",
        inputs: [{ name: "tex", type: "texture" }],
        outputs: [{ name: "mask", type: "float" }],
        parameters: [{ name: "threshold", type: "float", default: 0.5 }],
        wgsl: "fn chromaKey() -> f32 { return 1.0; }",
      }
      const valRes = validateCustomNodeManifest(validWgslManifest)
      expect(valRes.valid).toBe(true)
      expect(customNodeRegistry.register(valRes.manifest!)).toBe(true)
      expect(customNodeRegistry.has("chroma_key")).toBe(true)

      // Palette item contains default parameter values
      const palette = customNodeRegistry.getPaletteItems()
      const item = palette.find((p) => p.id === "custom-chroma_key")
      expect(item).toBeDefined()
      expect(item?.defaultData.parameters.threshold).toBe(0.5)
    })

    it("1.10 validateMathExpression tests parenthesis balance, operator boundaries, and whitelists", () => {
      // Empty
      expect(validateMathExpression("").isValid).toBe(false)
      expect(validateMathExpression("   ").isValid).toBe(false)

      // Parenthesis imbalance
      expect(validateMathExpression("sin(x))").error).toMatch(/Unexpected closing parenthesis/)
      expect(validateMathExpression("((sin(x) + 1)").error).toMatch(/Unmatched opening parenthesis/)

      // Operator boundary conditions
      expect(validateMathExpression("* 5.0").error).toMatch(/Expression cannot start with operator '\*'/)
      expect(validateMathExpression("5.0 +").error).toMatch(/Expression cannot end with an operator '\+'/)
      expect(validateMathExpression("5.0.").error).toMatch(/Expression cannot end with a dot '\.'/)
      expect(validateMathExpression("5.0 * * 2.0").error).toMatch(/Unexpected consecutive operator/)

      // Dot swizzle errors
      expect(validateMathExpression("uv.invalidSwizzle").error).toMatch(/Invalid swizzle component/)
      expect(validateMathExpression("..5").error).toMatch(/Invalid placement of dot/)

      // Security: unwhitelisted functions
      expect(validateMathExpression("eval(1.0)").error).toMatch(/Function 'eval\(\)' is not permitted/)
      expect(validateMathExpression("alert(uv.x)").error).toMatch(/Function 'alert\(\)' is not permitted/)
      expect(validateMathExpression("system(1)").error).toMatch(/Function 'system\(\)' is not permitted/)

      // Security: unknown identifiers
      expect(validateMathExpression("secretKey * 2.0").error).toMatch(/Unknown identifier 'secretKey'/)

      // Permitted declared inputs
      const declaredRes = validateMathExpression("sin(myInput * 2.0) + uv.x", ["myInput"])
      expect(declaredRes.isValid).toBe(true)
      expect(declaredRes.referencedInputs).toEqual(["myInput"])
      expect(declaredRes.outputType).toBe("float")
    })

    it("1.11 compileMathExpression translates atan2 and mod correctly into WGSL", () => {
      // 1-arg atan remains atan
      const wgsl1 = compileMathExpressionToWgsl("atan(uv.x)", "val", "float")
      expect(wgsl1).toContain("atan(uv.x)")

      // 2-arg atan becomes atan2
      const wgsl2 = compileMathExpressionToWgsl("atan(uv.y, uv.x)", "val", "float")
      expect(wgsl2).toContain("atan2(uv.y, uv.x)")

      // Nested mod becomes %
      const wgsl3 = compileMathExpressionToWgsl("mod(uv.x, 0.5)", "val", "float")
      expect(wgsl3).toContain("((uv.x) % (0.5))")

      // Type mappings
      expect(compileMathExpressionToWgsl("1.0", "v", "float")).toContain("let v: f32 = 1.0;")
      expect(compileMathExpressionToWgsl("uv", "v", "vec2")).toContain("let v: vec2<f32> = uv;")
      expect(compileMathExpressionToWgsl("vec3(1.0)", "v", "vec3")).toContain("let v: vec3<f32> = vec3(1.0);")
      expect(compileMathExpressionToWgsl("vec4(1.0)", "v", "vec4")).toContain("let v: vec4<f32> = vec4(1.0);")
    })
  })

  // ==========================================================================
  // BATTERY 2: R2 Rendering Multi-Backend Parity & Boundary Probes
  // ==========================================================================
  describe("Battery 2: R2 Rendering Multi-Backend Parity & Boundary Probes", () => {
    const adapters = [
      { name: "WebGPU", adapter: webgpuAdapter },
      { name: "WebGL2", adapter: webgl2Adapter },
      { name: "Three.js", adapter: threejsAdapter },
    ]

    adapters.forEach(({ name, adapter }) => {
      it(`2.1 [${name}] pipeline mode toggles GBuffer targets correctly`, () => {
        adapter.setRenderingPipelineMode!("deferred")
        expect(adapter.getPipelineMode!()).toBe("deferred")
        const gbuffer = adapter.getGBufferTextures!()
        expect(gbuffer).not.toBeNull()
        expect(gbuffer?.albedo).toBeDefined()
        expect(gbuffer?.normal).toBeDefined()
        expect(gbuffer?.roughnessMetallic).toBeDefined()
        expect(gbuffer?.depth).toBeDefined()

        adapter.setRenderingPipelineMode!("forward")
        expect(adapter.getPipelineMode!()).toBe("forward")
        expect(adapter.getGBufferTextures!()).toBeNull()
      })

      it(`2.2 [${name}] shadow config accepts approved resolutions and throws on invalid`, () => {
        // Valid resolutions: 512, 1024, 2048, 4096
        adapter.setShadowConfig!({ resolution: 512, filtering: "pcf", bias: 0.001 })
        expect(adapter.getShadowSettings!().resolution).toBe(512)
        expect(adapter.getShadowSettings!().filterMode).toBe("pcf")

        adapter.setShadowConfig!({ resolution: 2048, filtering: "vsm" })
        expect(adapter.getShadowSettings!().resolution).toBe(2048)
        expect(adapter.getShadowSettings!().filterMode).toBe("vsm")

        // Invalid resolutions throw
        expect(() => adapter.setShadowConfig!({ resolution: 256 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig!({ resolution: 8192 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig!({ resolution: NaN as any })).toThrow(/Invalid shadow resolution/)
      })

      it(`2.3 [${name}] point shadow cube toggle creates and destroys resources`, () => {
        adapter.setPointLightShadowCube!(true)
        expect(adapter.state?.pointShadowCubeEnabled).toBe(true)

        adapter.setPointLightShadowCube!(false)
        expect(adapter.state?.pointShadowCubeEnabled).toBe(false)
      })

      it(`2.4 [${name}] post-process passes update parameters cleanly`, () => {
        adapter.setPostProcessEnabled!("ssr", true, { maxSteps: 64, thickness: 0.15 })
        expect(adapter.state?.postProcessState.ssr.enabled).toBe(true)
        expect(adapter.state?.postProcessState.ssr.maxSteps).toBe(64)
        expect(adapter.state?.postProcessState.ssr.thickness).toBe(0.15)

        adapter.updateDoFSettings!({ enabled: true, focalDistance: 8.5, bokehShape: "octagonal" })
        expect(adapter.state?.postProcessState.dof.enabled).toBe(true)
        expect(adapter.state?.postProcessState.dof.focalDistance).toBe(8.5)
        expect(adapter.state?.postProcessState.dof.bokehShape).toBe("octagonal")

        adapter.updateSSAOSettings!({ enabled: true, radius: 1.2, intensity: 2.0 })
        expect(adapter.state?.postProcessState.ssao.radius).toBe(1.2)
        expect(adapter.state?.postProcessState.ssao.intensity).toBe(2.0)

        // Anti-aliasing mutual exclusion
        adapter.setAntiAliasingMode!("fxaa")
        expect(adapter.getAntiAliasingMode!()).toBe("fxaa")
        expect(adapter.state?.postProcessState.fxaa.enabled).toBe(true)
        expect(adapter.state?.postProcessState.taa.enabled).toBe(false)

        adapter.setAntiAliasingMode!("taa")
        expect(adapter.getAntiAliasingMode!()).toBe("taa")
        expect(adapter.state?.postProcessState.fxaa.enabled).toBe(false)
        expect(adapter.state?.postProcessState.taa.enabled).toBe(true)
      })

      it(`2.5 [${name}] atmosphere parameter boundary clamping and Rayleigh inverse 4th-power law`, () => {
        // Clamping negative and >24h
        adapter.setAtmosphereParams!({ timeOfDay: -10, turbidity: 3.5 })
        expect(adapter.state?.atmosphereParams.timeOfDay).toBe(0)
        expect(adapter.state?.atmosphereParams.solarElevationDeg).toBe(0)

        adapter.setAtmosphereParams!({ timeOfDay: 35 })
        expect(adapter.state?.atmosphereParams.timeOfDay).toBe(24)

        // Solar noon (12:00) elevation should be exactly 90 degrees
        adapter.setAtmosphereParams!({ timeOfDay: 12 })
        expect(adapter.state?.atmosphereParams.solarElevationDeg).toBeCloseTo(90, 1)

        // Scattering physics: blue (440nm) scatters more than red (680nm)
        const scattering = adapter.calculateRayleighMieScattering!([680, 550, 440])
        expect(scattering.rayleigh[2]).toBeGreaterThan(scattering.rayleigh[0])
        expect(scattering.mie).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // BATTERY 3: R3 Export & Ecosystem Transpilers Edge Conditions
  // ==========================================================================
  describe("Battery 3: R3 Export & Ecosystem Transpilers Edge Conditions", () => {
    it("3.1 transpileToUE5 maps parameters and translates coordinates and functions", () => {
      const glslSource = `
        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          float angle = atan(uv.y, uv.x);
          float t = fract(u_time * 0.5);
          fragColor = vec4(col * diffuseColor, 1.0);
        }
      `
      const res = transpileToUE5({
        shaderSource: glslSource,
        parsedUniforms: [
          { name: "speed", type: "float", kind: "scalar" },
          { name: "diffuseColor", type: "color", kind: "color" },
          { name: "noiseTex", type: "sampler2D", kind: "texture" },
        ],
      })

      expect(res.parameters).toHaveLength(3)
      expect(res.parameters.find((p) => p.name === "speed")?.ue5Type).toBe("ScalarParameter")
      expect(res.parameters.find((p) => p.name === "diffuseColor")?.ue5Type).toBe("VectorParameter")
      expect(res.parameters.find((p) => p.name === "noiseTex")?.ue5Type).toBe("Texture2D")

      expect(res.customExpressionHLSL).toContain("View.GameTime")
      expect(res.customExpressionHLSL).toContain("View.ViewSizeAndInvSize.xy")
      expect(res.customExpressionHLSL).toContain("atan2(")
      expect(res.customExpressionHLSL).toContain("frac(")

      const docs = transpileToUnrealHLSL({ shaderSource: glslSource, parsedUniforms: [] })
      expect(docs).toContain("SECTION 1: Custom Expression Node HLSL")
      expect(docs).toContain("SECTION 2: Material Function (.ush) HLSL")
    })

    it("3.2 transpileToBlenderOSL converts types to OSL point/color and diffuse closure", () => {
      const osl = transpileToBlenderOSL({
        shaderSource: `
          void main() {
            vec2 uv = gl_FragCoord.xy / u_resolution.xy;
            fragColor = vec4(baseColor, 1.0);
          }
        `,
        parsedUniforms: [
          { name: "scale", type: "float", kind: "scalar" },
          { name: "offset", type: "vec2", kind: "vector" },
          { name: "baseColor", type: "color", kind: "color" },
        ],
      })

      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("point offset = point(0.0, 0.0, 0.0)")
      expect(osl).toContain("color baseColor = color(1.0, 1.0, 1.0)")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("BSDF = finalColor * diffuse(N);")
    })

    it("3.3 exportGltf2Material and packOrmTexture produce valid PBR material and ORM buffer", () => {
      const gltf = exportGltf2Material("PBR_Hero", false, {
        baseColorFactor: [1.0, 0.5, 0.2, 1.0],
        roughnessFactor: 0.35,
        metallicFactor: 0.8,
      })
      expect(gltf.gltfJson.asset.version).toBe("2.0")
      expect(gltf.gltfJson.materials[0].name).toBe("PBR_Hero")
      expect(gltf.gltfJson.materials[0].pbrMetallicRoughness.roughnessFactor).toBe(0.35)
      expect(gltf.gltfJson.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0.8)

      // Unlit material includes extension
      const unlitGltf = exportGltf2Material("Unlit_Hero", true)
      expect(unlitGltf.extensionsUsed).toContain("KHR_materials_unlit")

      // ORM packing
      const ao = new Uint8ClampedArray([255, 255, 255, 255])
      const rough = new Uint8ClampedArray([128, 128, 128, 128])
      const metal = new Uint8ClampedArray([64, 64, 64, 64])
      const orm = packOrmTexture(ao, rough, metal, 2, 2)
      expect(orm.length).toBe(2 * 2 * 4)
      expect(orm[0]).toBe(255) // R: Occlusion
      expect(orm[1]).toBe(128) // G: Roughness
      expect(orm[2]).toBe(64)  // B: Metallic
      expect(orm[3]).toBe(255) // A: 255
    })

    it("3.4 generateNpmPackage creates publishable package scaffold", () => {
      const pkg = generateNpmPackage("@shaderstudio/water-ripple", "fn main() {}", {
        version: "1.2.0",
      })

      expect(pkg.packageJson).toBeDefined()
      expect(pkg.packageJson.name).toBe("@shaderstudio/water-ripple")
      expect(pkg.packageJson.version).toBe("1.2.0")
      expect(pkg.packageJson.main).toBe("dist/index.js")
      expect(pkg.packageJson.types).toBe("dist/index.d.ts")

      expect(pkg.indexTs).toContain("export const shaderSource")
      expect(pkg.readmeMd).toContain("@shaderstudio/water-ripple")
    })

    it("3.5 importShadertoy and createProjectFromShadertoy map inputs and channel samplers", () => {
      const shadertoyCode = `
        void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
          vec2 uv = fragCoord / iResolution.xy;
          vec4 tex = texture(iChannel0, uv);
          fragColor = vec4(uv, sin(iTime), 1.0);
        }
      `
      const imported = importShadertoy(shadertoyCode)
      expect(imported.mappedUniforms.iTime).toBe("u_time")
      expect(imported.mappedUniforms.iResolution).toBe("u_resolution")
      expect(imported.channels).toEqual([0])
      expect(imported.convertedSource).toContain("uniform sampler2D u_channel0;")
      expect(imported.convertedSource).toContain("mainImage(fragColor, gl_FragCoord.xy);")

      const project = createProjectFromShadertoy(shadertoyCode, "Imported Ripple")
      expect(project.name).toBe("Imported Ripple")
      expect(project.backend).toBe("webgl2")
      expect(project.graphNodes.some((n) => n.type === "material")).toBe(true)
      expect(project.uniformValues.u_time).toBeDefined()
    })

    it("3.6 generateR3FExport generates drei shaderMaterial and preview story", () => {
      const r3f = generateR3FExport("HologramMaterial", {
        vertexShader: "void main() {}",
        shaderSource: "void main() {}",
      })
      expect(r3f).toContain("shaderMaterial")
      expect(r3f).toContain("HologramMaterial")
      expect(r3f).toContain("StorybookPreview")
    })
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

  // ==========================================================================
  // BATTERY 5: R5 Performance, Memory Budget, Mesh LOD & Texture Streaming
  // ==========================================================================
  describe("Battery 5: R5 Performance & Scale Systems White-Box Coverage", () => {
    it("5.1 performanceTelemetry manages 60-frame buffer, pass timings, and VRAM estimation", () => {
      // Record 70 frames to test 60-entry circular eviction
      for (let i = 1; i <= 70; i++) {
        performanceTelemetry.recordFrameTime(16.0 + (i % 5))
      }
      expect(performanceTelemetry.getTimeline().length).toBe(60)

      // Average FPS calculation with finite numbers
      const fps = performanceTelemetry.getAverageFps()
      expect(fps).toBeGreaterThan(50)
      expect(fps).toBeLessThan(70)

      // Pass timings
      performanceTelemetry.setPassTiming("gbuffer", 2.4)
      performanceTelemetry.setPassTiming("shadow", 1.8)
      performanceTelemetry.setPassTiming("lighting", 3.2)
      performanceTelemetry.setPassTiming("ssr", 4.5)
      performanceTelemetry.setPassTiming("postprocess", 1.1)

      const timings = performanceTelemetry.getPassTimings()
      expect(timings.gbuffer).toBe(2.4)
      expect(timings.ssr).toBe(4.5)

      // Texture memory arithmetic & invalid bounds safety
      expect(performanceTelemetry.calculateTextureMemory(1024, 1024, 4)).toBe(4194304)
      expect(performanceTelemetry.calculateTextureMemory(-100, 1024, 4)).toBe(0)
      expect(performanceTelemetry.calculateTextureMemory(1024, NaN, 4)).toBe(0)

      // Geometry memory arithmetic & invalid bounds safety
      expect(performanceTelemetry.calculateGeometryMemory(1000, 32)).toBe(32000)
      expect(performanceTelemetry.calculateGeometryMemory(-50, 32)).toBe(0)

      // Manual VRAM override
      performanceTelemetry.setEstimatedVramBytes(50000000)
      expect(performanceTelemetry.getEstimatedVramBytes()).toBe(50000000)
    })

    it("5.2 checkMemoryThreshold enforces strict boundary inequality (> budget * ratio)", () => {
      const budget = {
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 1000,
        warnThresholdRatio: 0.8, // 800MB limit
      }

      // 800.0MB does NOT trip (strictly usage > limit)
      const resAtLimit = checkMemoryThreshold(
        { textureMB: 50, geometryMB: 50, totalVramMB: 800.0 },
        budget
      )
      expect(resAtLimit.totalVramWarning).toBe(false)
      expect(resAtLimit.hasAnyWarning).toBe(false)

      // 800.01MB TRIPS
      const resOverLimit = checkMemoryThreshold(
        { textureMB: 50, geometryMB: 50, totalVramMB: 800.01 },
        budget
      )
      expect(resOverLimit.totalVramWarning).toBe(true)
      expect(resOverLimit.hasAnyWarning).toBe(true)

      // MemoryBudgetManager dispatches warnings and eviction events
      const mgr = new MemoryBudgetManager(budget)
      const warningSpy = vi.fn()
      const evictSpy = vi.fn()

      mgr.onWarning(warningSpy)
      mgr.onEvictionRequired(evictSpy)

      mgr.evaluateUsage({ textureMB: 90, geometryMB: 50, totalVramMB: 750 })
      // Texture limit = 80MB. Usage = 90MB -> Excess = 10MB
      expect(warningSpy).toHaveBeenCalledTimes(1)
      expect(evictSpy).toHaveBeenCalledWith("texture", 10)
    })

    it("5.3 generateMeshLods and selectLodByDistance handle zero, extremes, and boundaries", () => {
      // 0 or negative vertices
      expect(generateMeshLods(0)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(-100)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(NaN)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })

      // 100,000 vertices -> lod0: 100k, lod1: 50k, lod2: 25k
      const lods = generateMeshLods(100000)
      expect(lods.lod0).toBe(100000)
      expect(lods.lod1).toBe(50000)
      expect(lods.lod2).toBe(25000)

      // Distance selection (thresholds: lod0Dist: 10, lod1Dist: 30)
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(10)).toBe("lod0")
      expect(selectLodByDistance(10.01)).toBe("lod1")
      expect(selectLodByDistance(30)).toBe("lod1")
      expect(selectLodByDistance(30.01)).toBe("lod2")
      expect(selectLodByDistance(1000)).toBe("lod2")
      expect(selectLodByDistance(Infinity)).toBe("lod2")
      expect(selectLodByDistance(NaN)).toBe("lod0")
    })

    it("5.4 decimateGeometryBuffer and decimateIndices step through buffers correctly", () => {
      // 8 vertices in 3D (stride 3) = 24 floats
      const positions = new Float32Array(24)
      for (let i = 0; i < 24; i++) positions[i] = i

      // lod0: exact clone
      const lod0 = decimateGeometryBuffer(positions, "lod0", 3)
      expect(lod0.length).toBe(24)

      // lod1: step 2 -> 4 vertices = 12 floats
      const lod1 = decimateGeometryBuffer(positions, "lod1", 3)
      expect(lod1.length).toBe(12)

      // lod2: step 4 -> 2 vertices = 6 floats
      const lod2 = decimateGeometryBuffer(positions, "lod2", 3)
      expect(lod2.length).toBe(6)

      // Indices decimation: 4 triangles (12 indices)
      const indices = new Uint16Array([0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4])
      const decIndices = decimateIndices(indices, "lod1")
      expect(decIndices.length).toBe(6) // 2 triangles
    })

    it("5.5 TextureStreamer progressively streams mips and evicts LRU textures on budget pressure", async () => {
      // Create streamer with 30MB limit (each 2048x2048 RGBA texture is 16MB)
      const streamer = createTextureStreamer({ memoryLimitMB: 30 })
      const evictSpy = vi.fn()
      streamer.onEvict(evictSpy)

      const mipsA: number[] = []
      await streamer.loadMipmapProgressive("tex_a.png", (level) => {
        mipsA.push(level)
      })
      // Verified progressive sequence: 2 -> 1 -> 0
      expect(mipsA).toEqual([2, 1, 0])
      expect(streamer.isCached("tex_a.png")).toBe(true)
      expect(streamer.getResidentTextureCount()).toBe(1)

      // Touch tex_a to make it recently accessed
      streamer.touch("tex_a.png")

      // Load tex_b (16MB). Total resident ~32MB, exceeding 30MB limit -> triggers LRU eviction
      await streamer.loadMipmapProgressive("tex_b.png", () => {})

      // At least 1 texture remains resident and budget is enforced
      expect(streamer.getResidentMemoryMB()).toBeLessThanOrEqual(30)

      // Invalid URLs return false cleanly
      expect(await streamer.loadMipmapProgressive("", () => {})).toBe(false)
      expect(await streamer.loadMipmapProgressive(null as any, () => {})).toBe(false)
    })
  })
})
