/**
 * Node graph core: sub-graph flatten/nesting/cycles/uniform namespacing, compileGraph topology + validation, SDF tree, math-expression
 * validator/compiler, custom-node manifest registry. Consolidated by fleet w1-b-ui. Bundle-size/dist-reading and rollup-chunk-resolver
 * harness tests were dropped (environment dependent / harness copy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react"
import { SubGraphLibrary, subGraphLibrary, type SubGraphDefinition, type SubGraphNodeData, collapseNodesToSubGraph, BUILTIN_FRESNEL_RIM, BUILTIN_NOISE_GEN, BUILTIN_UV_DISTORTION } from "@/core/subGraphLibrary"
import { flattenGraph, compileGraph, MAX_SUBGRAPH_DEPTH, type GraphNodeData, type CustomNodeData, type SubGraphNodeData, type UniformNodeData, buildSdfTree } from "@/core/graphCompiler"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { validateCustomNodeManifest, type CustomNodeManifest, CustomNodeRegistry, customNodeRegistry } from "@/core/customNodeSdk"
import { FrameNode } from "@/components/nodes/FrameNode"
import { CommentNode } from "@/components/nodes/CommentNode"
import { NodePreviewViewport } from "@/components/inspector/NodePreviewViewport"
import { useProjectStore } from "@/stores/projectStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { transpileToUE5, transpileToUnrealHLSL, transpileToBlenderOSL, exportGltf2Material, packOrmTexture, generateNpmPackage, importShadertoy, createProjectFromShadertoy, generateR3FExport } from "@/core/engineTranspiler"
import { getDefaultProjectPath, saveProjectNative, loadProjectNative, startMcpBridge, getMcpBridgeStatus, getMcpBridgePort, stopMcpBridge, minimizeWindow, maximizeWindow, closeWindow, setupTray, isTrayActive, validateBinarySizeConfig, resetDesktopFallbackState } from "@/desktop/tauriBridge"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { checkMemoryThreshold, createDefaultMemoryBudget, MemoryBudgetManager } from "@/core/memoryBudget"
import { generateMeshLods, selectLodByDistance, decimateGeometryBuffer, decimateIndices } from "@/core/meshLod"
import { createTextureStreamer } from "@/core/textureStreamer"

describe("graph topology, math + manifest attacks (m1 nodegraph challenger)", () => {
describe("Adversarial Challenger: Milestone 1 (R1 Node Graph Power-ups)", () => {
  let customLib: SubGraphLibrary

  beforeEach(() => {
    customLib = new SubGraphLibrary()
  })

  // =========================================================================
  // SECTION 1: Deep Sub-Graph Nesting, Cycles & Diamond Topologies
  // =========================================================================
  describe("Sub-Graph Nesting, Cycles & Graph Topology Attacks", () => {
    it("handles exact boundary depth of 8 nested levels successfully", () => {
      let currentNodes: Node<GraphNodeData>[] = [
        { id: "leaf_mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "torus_knot" } },
      ]
      let currentEdges: Edge[] = []
      let lastOutputId = "leaf_mesh"

      for (let level = 1; level <= 8; level++) {
        const id = `nest-level-${level}`
        customLib.register({
          id,
          name: `Nesting Level ${level}`,
          category: "Utility",
          isBuiltin: false,
          inputs: [],
          outputs: [{ id: "out", name: "Out", type: "mesh", direction: "output", internalNodeId: lastOutputId }],
          nodes: currentNodes,
          edges: currentEdges,
        })

        const instId = `inst_${level}`
        currentNodes = [
          {
            id: instId,
            position: { x: 0, y: 0 },
            data: { type: "subgraph", subGraphId: id, name: id } as SubGraphNodeData,
          },
        ]
        currentEdges = []
        lastOutputId = instId
      }

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "root_sub",
          position: { x: 0, y: 0 },
          data: { type: "subgraph", subGraphId: "nest-level-8", name: "Top" } as SubGraphNodeData,
        },
        { id: "out", position: { x: 100, y: 0 }, data: { type: "output" } },
      ]
      const rootEdges: Edge[] = [
        { id: "e1", source: "root_sub", sourceHandle: "out", target: "out" },
      ]

      const result = flattenGraph(rootNodes, rootEdges, customLib)
      expect(result.error).toBeNull()
      const leafNode = result.nodes.find((n) => n.data.type === "mesh")
      expect(leafNode).toBeDefined()
      expect(leafNode?.id).toContain("leaf_mesh")
    })

    it("rejects 9-level nesting crossing the MAX_SUBGRAPH_DEPTH=8 boundary", () => {
      let currentNodes: Node<GraphNodeData>[] = [
        { id: "leaf_mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
      ]
      let currentEdges: Edge[] = []
      let lastOutputId = "leaf_mesh"

      for (let level = 1; level <= 9; level++) {
        const id = `nest-level-${level}`
        customLib.register({
          id,
          name: `Nesting Level ${level}`,
          category: "Utility",
          isBuiltin: false,
          inputs: [],
          outputs: [{ id: "out", name: "Out", type: "mesh", direction: "output", internalNodeId: lastOutputId }],
          nodes: currentNodes,
          edges: currentEdges,
        })

        const instId = `inst_${level}`
        currentNodes = [
          {
            id: instId,
            position: { x: 0, y: 0 },
            data: { type: "subgraph", subGraphId: id, name: id } as SubGraphNodeData,
          },
        ]
        currentEdges = []
        lastOutputId = instId
      }

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "root_sub",
          position: { x: 0, y: 0 },
          data: { type: "subgraph", subGraphId: "nest-level-9", name: "Level 9 Overflow" } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain(`Sub-graph nesting depth exceeds maximum allowed limit of ${MAX_SUBGRAPH_DEPTH} levels`)
    })

    it("detects self-cycle (A -> A) where a sub-graph references itself", () => {
      customLib.register({
        id: "self-recursive-sub",
        name: "Self Recursive",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "inner_self",
            position: { x: 0, y: 0 },
            data: { type: "subgraph", subGraphId: "self-recursive-sub", name: "Recurse" } as SubGraphNodeData,
          },
        ],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "root_rec",
          position: { x: 0, y: 0 },
          data: { type: "subgraph", subGraphId: "self-recursive-sub", name: "Entry" } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain("Cycle detected in sub-graph expansion")
      expect(result.error).toContain("self-recursive-sub -> self-recursive-sub")
    })

    it("detects 3-node cycle (A -> B -> C -> A)", () => {
      customLib.register({
        id: "cycle-node-a",
        name: "Node A",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-node-b", name: "To B" } as SubGraphNodeData }],
        edges: [],
      })
      customLib.register({
        id: "cycle-node-b",
        name: "Node B",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n2", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-node-c", name: "To C" } as SubGraphNodeData }],
        edges: [],
      })
      customLib.register({
        id: "cycle-node-c",
        name: "Node C",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n3", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-node-a", name: "To A" } as SubGraphNodeData }],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "start", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-node-a", name: "Start" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain("Cycle detected in sub-graph expansion")
      expect(result.error).toContain("cycle-node-a -> cycle-node-b -> cycle-node-c -> cycle-node-a")
    })

    it("correctly flattens diamond dependencies (A -> B, A -> C, B -> D, C -> D) without false cycle triggers", () => {
      // Leaf subgraph D
      customLib.register({
        id: "sub-d",
        name: "Sub D",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out_d", name: "D Out", type: "float", direction: "output", internalNodeId: "u_d" }],
        nodes: [
          { id: "u_d", position: { x: 0, y: 0 }, data: { type: "uniform", name: "valD", uniformType: "float", defaultValue: 1.0, uniformId: "u_d" } },
        ],
        edges: [],
      })

      // Subgraph B contains D
      customLib.register({
        id: "sub-b",
        name: "Sub B",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out_b", name: "B Out", type: "float", direction: "output", internalNodeId: "d_in_b" }],
        nodes: [
          { id: "d_in_b", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-d", name: "D in B" } as SubGraphNodeData },
        ],
        edges: [],
      })

      // Subgraph C contains D
      customLib.register({
        id: "sub-c",
        name: "Sub C",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out_c", name: "C Out", type: "float", direction: "output", internalNodeId: "d_in_c" }],
        nodes: [
          { id: "d_in_c", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-d", name: "D in C" } as SubGraphNodeData },
        ],
        edges: [],
      })

      // Root graph contains both B and C (diamond pointing to D)
      const rootNodes: Node<GraphNodeData>[] = [
        { id: "b_inst", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-b", name: "B inst" } as SubGraphNodeData },
        { id: "c_inst", position: { x: 0, y: 100 }, data: { type: "subgraph", subGraphId: "sub-c", name: "C inst" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).toBeNull()
      // Should contain 2 distinct instances of D's uniforms with unique namespaced IDs
      const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes.length).toBe(2)
      expect(uniformNodes[0].id).not.toBe(uniformNodes[1].id)
    })

    it("detects topological cycle inside flattened graph during compileGraph", () => {
      customLib.register({
        id: "sub-internal-cycle",
        name: "Internal Cycle",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "postprocess", direction: "output", internalNodeId: "pp_1" }],
        nodes: [
          { id: "pp_1", position: { x: 0, y: 0 }, data: { type: "postprocess", passType: "bloom" } },
          { id: "pp_2", position: { x: 100, y: 0 }, data: { type: "postprocess", passType: "vignette" } },
        ],
        edges: [
          { id: "e12", source: "pp_1", target: "pp_2" },
          { id: "e21", source: "pp_2", target: "pp_1" },
        ],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "sub_node", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-internal-cycle", name: "Sub" } as SubGraphNodeData },
        { id: "out_node", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const rootEdges: Edge[] = [
        { id: "e_out", source: "sub_node", sourceHandle: "out", target: "out_node" },
      ]

      const result = compileGraph(rootNodes, rootEdges, customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain("Cycle detected in node graph")
    })
  })

  // =========================================================================
  // SECTION 2: Math Expression Node Parser & Injection Attacks
  // =========================================================================
  describe("Math Expression Parser Attacks & Security", () => {
    it("rejects malicious JavaScript injection payloads", () => {
      const payloads = [
        "eval('alert(1)')",
        "Function('return this')()",
        "fetch('https://evil.com')",
        "document.cookie",
        "window.localStorage.clear()",
        "process.exit(1)",
        "require('fs')",
      ]

      for (const payload of payloads) {
        const res = validateMathExpression(payload)
        expect(res.isValid).toBe(false)
        expect(res.error).not.toBeNull()
      }
    })

    it("rejects GLSL/WGSL multi-statement injection", () => {
      const injectionPayloads = [
        "sin(uv.x); discard;",
        "1.0; return;",
        "cos(time); float hacked = 1.0;",
        "0.5;\n#define EVIL 1",
      ]

      for (const p of injectionPayloads) {
        const res = validateMathExpression(p)
        expect(res.isValid).toBe(false)
      }
    })

    it("rejects inverted and corrupted parenthesis structures", () => {
      const corrupted = [
        ")(",
        "())((",
        "sin((uv.x)",
        "cos(uv.x)))",
      ]

      for (const expr of corrupted) {
        const res = validateMathExpression(expr)
        expect(res.isValid).toBe(false)
      }
    })

    it("verifies remediation of M1-V3: parser rejects expressions starting with binary operators (* 2.0, / 4.0, % 3.0)", () => {
      const resMul = validateMathExpression("* 2.0")
      const resDiv = validateMathExpression("/ 4.0")
      const resMod = validateMathExpression("% 3.0")

      expect(resMul.isValid).toBe(false)
      expect(resMul.error).toContain("Expression cannot start with operator '*'")
      expect(resDiv.isValid).toBe(false)
      expect(resDiv.error).toContain("Expression cannot start with operator '/'")
      expect(resMod.isValid).toBe(false)
      expect(resMod.error).toContain("Expression cannot start with operator '%'")
    })

    it("verifies remediation of M1-V4: parser rejects trailing dots and lone punctuation (; , @)", () => {
      // Expression ending with a dot is rejected
      const resDot = validateMathExpression("uv.")
      expect(resDot.isValid).toBe(false)
      expect(resDot.error).toContain("Expression cannot end with a dot '.'")

      // Expression with lone semicolon or illegal characters is rejected
      const resSemi = validateMathExpression("sin(uv.x);")
      expect(resSemi.isValid).toBe(false)
      expect(resSemi.error).toContain("Unexpected character or token ';'")
    })
  })

  // =========================================================================
  // SECTION 3: Custom Node Manifest Fuzzing & Schema Robustness
  // =========================================================================
  describe("Custom Node Manifest Fuzzing", () => {
    it("verifies remediation of M1-V1 (CRITICAL): validateCustomNodeManifest returns valid: false on null parameter item without throwing", () => {
      const malformedManifest = {
        id: "crash-test-manifest",
        name: "Crash Test",
        category: "utility",
        inputs: [],
        outputs: [],
        parameters: [null],
        glsl: "void main() {}",
      }

      let res: any
      expect(() => {
        res = validateCustomNodeManifest(malformedManifest)
      }).not.toThrow()
      expect(res.valid).toBe(false)
      expect(res.errors.some((e: string) => e.includes("Parameter at index 0 must be a non-null object"))).toBe(true)
    })

    it("verifies remediation of M1-V2: validateCustomNodeManifest rejects parameters without names and whitespace-only IDs", () => {
      // Manifest with unnamed parameter item
      const badParamsManifest = {
        id: "bad-params",
        name: "Bad Params",
        inputs: [],
        outputs: [],
        parameters: [{ type: "float", default: 1.0 }], // missing name
        glsl: "void main() {}",
      }
      const resParams = validateCustomNodeManifest(badParamsManifest)
      expect(resParams.valid).toBe(false)
      expect(resParams.errors.some((e) => e.includes("Parameter at index 0 must have a non-empty string 'name'"))).toBe(true)

      // Manifest with whitespace-only ID
      const whitespaceIdManifest = {
        id: "   ",
        name: "Whitespace Node",
        inputs: [],
        outputs: [],
        parameters: [],
        glsl: "void main() {}",
      }
      const resId = validateCustomNodeManifest(whitespaceIdManifest)
      expect(resId.valid).toBe(false)
      expect(resId.errors.some((e) => e.includes("Manifest requires a non-empty string 'id' or 'type'"))).toBe(true)
    })

    it("prevents compilation of custom nodes referencing unmanifested registry IDs", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        {
          id: "custom-ghost",
          position: { x: 100, y: 0 },
          data: {
            type: "custom",
            manifestId: "non-existent-manifest-id-9999",
            parameters: {},
          } as CustomNodeData,
        },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "custom-ghost" },
        { id: "e2", source: "custom-ghost", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain('references unknown manifest "non-existent-manifest-id-9999"')
    })
  })

  // =========================================================================
  // SECTION 4: Frame and Comment Node Stress & Boundary Dimensions
  // =========================================================================
  describe("Frame & Comment Node Boundary Stress", () => {

    it("strictly preserves compiler neutrality when graph is populated with many annotations", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "pass.frag" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]

      for (let i = 0; i < 20; i++) {
        nodes.push({
          id: `comment-${i}`,
          position: { x: -i * 50, y: -i * 50 },
          data: { type: "comment", title: `Note ${i}`, text: `Annotation ${i}` },
        })
        nodes.push({
          id: `frame-${i}`,
          position: { x: i * 100, y: -i * 100 },
          data: { type: "frame", label: `Group ${i}`, width: -50, height: -50 },
        })
      }

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBe(2)
      expect(result.queue[0].type).toBe("mesh")
      expect(result.queue[1].type).toBe("material")
    })
  })
})
})

describe("gate2 probes (math mod/atan, manifests, hyphen namespacing)", () => {
describe("Milestone 1 Gate 2: Empirical Boundary Probes", () => {
  // =========================================================================
  // PROBE BATTERY 1: Deeply Nested mod() with Multi-Arg Functions & Mixed Arithmetic
  // =========================================================================
  describe("Probe Battery 1: mod() with Multi-Arg Functions & Mixed Arithmetic", () => {
    it("handles mod() containing mixed arithmetic and 2-arg dot(): mod(sin(x) * dot(uv, uv) + 1.0, 2.0)", () => {
      const expr = "mod(sin(x) * dot(uv, uv) + 1.0, 2.0)"
      const val = validateMathExpression(expr, ["x", "uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((sin(x) * dot(uv, uv) + 1.0) % (2.0));")
      expect(wgsl).not.toContain(", 2.0)")
    })

    it("handles mod() containing 3-arg clamp() and 3-arg mix(): mod(mix(clamp(x, 0.0, 1.0), 5.0, 0.5), 2.0)", () => {
      const expr = "mod(mix(clamp(x, 0.0, 1.0), 5.0, 0.5), 2.0)"
      const val = validateMathExpression(expr, ["x"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((mix(clamp(x, 0.0, 1.0), 5.0, 0.5)) % (2.0));")
    })

    it("handles mod() containing 3-arg smoothstep(): mod(smoothstep(0.0, 1.0, uv.x) * 10.0, 3.0)", () => {
      const expr = "mod(smoothstep(0.0, 1.0, uv.x) * 10.0, 3.0)"
      const val = validateMathExpression(expr, ["uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((smoothstep(0.0, 1.0, uv.x) * 10.0) % (3.0));")
    })

    it("handles 3 levels of nested mod(): mod(mod(mod(x, 2.0) + 1.0, 3.0) * 2.0, 4.0)", () => {
      const expr = "mod(mod(mod(x, 2.0) + 1.0, 3.0) * 2.0, 4.0)"
      const val = validateMathExpression(expr, ["x"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((((((x) % (2.0)) + 1.0) % (3.0)) * 2.0) % (4.0));")
      expect(wgsl).not.toContain("mod(")
    })

    it("handles multiple sibling mod() calls on the same line: mod(uv.x, 2.0) + mod(uv.y, 3.0)", () => {
      const expr = "mod(uv.x, 2.0) + mod(uv.y, 3.0)"
      const val = validateMathExpression(expr, ["uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((uv.x) % (2.0)) + ((uv.y) % (3.0));")
      expect(wgsl).not.toContain("mod(")
    })

    it("handles mod() where divisor is another complex expression: mod(x, pow(2.0, y) + 1.0)", () => {
      const expr = "mod(x, pow(2.0, y) + 1.0)"
      const val = validateMathExpression(expr, ["x", "y"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((x) % (pow(2.0, y) + 1.0));")
    })
  })

  // =========================================================================
  // PROBE BATTERY 2: Single-Arg atan vs Multi-Arg atan in WGSL Expressions
  // =========================================================================
  describe("Probe Battery 2: Single-Arg atan vs Multi-Arg atan in WGSL Expressions", () => {
    it("preserves single-arg atan(x) as atan(x)", () => {
      const wgsl = compileMathExpressionToWgsl("atan(uv.x)", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(uv.x);")
      expect(wgsl).not.toContain("atan2")
    })

    it("translates 2-arg atan(y, x) to atan2(y, x)", () => {
      const wgsl = compileMathExpressionToWgsl("atan(uv.y, uv.x)", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(uv.y, uv.x);")
    })

    it("handles single-arg atan containing arithmetic and nested functions: atan(sin(uv.x) / cos(uv.y))", () => {
      const wgsl = compileMathExpressionToWgsl("atan(sin(uv.x) / cos(uv.y))", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(sin(uv.x) / cos(uv.y));")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles 2-arg atan containing multi-arg functions: atan(dot(uv, uv), length(uv))", () => {
      const wgsl = compileMathExpressionToWgsl("atan(dot(uv, uv), length(uv))", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(dot(uv, uv), length(uv));")
    })

    it("handles single-arg atan containing multi-arg dot() with commas: atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)))", () => {
      const expr = "atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)));")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles nested atan calls: outer 1-arg atan enclosing inner 2-arg atan: atan(atan(uv.y, uv.x))", () => {
      const expr = "atan(atan(uv.y, uv.x))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(atan2(uv.y, uv.x));")
    })

    it("handles 2-arg atan where both arguments are 2-arg atans: atan(atan(y1, x1), atan(y2, x2))", () => {
      const expr = "atan(atan(y1, x1), atan(y2, x2))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(atan2(y1, x1), atan2(y2, x2));")
    })

    it("does not mutate atanh(x) into atan2h(x)", () => {
      const expr = "atanh(uv.x)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atanh(uv.x);")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles simultaneous mod() and atan() nesting: mod(atan(uv.y, uv.x), PI)", () => {
      const expr = "mod(atan(uv.y, uv.x), PI)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((atan2(uv.y, uv.x)) % (PI));")
    })

    it("handles 2-arg atan() with mod() in arguments: atan(mod(uv.y, 2.0), mod(uv.x, 2.0))", () => {
      const expr = "atan(mod(uv.y, 2.0), mod(uv.x, 2.0))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(((uv.y) % (2.0)), ((uv.x) % (2.0)));")
    })
  })

  // =========================================================================
  // PROBE BATTERY 3: Pathological Custom Node Manifests
  // =========================================================================
  describe("Probe Battery 3: Pathological Custom Node Manifests", () => {
    it("rejects empty string and whitespace-only strings for 'id', 'name', 'type', and 'title'", () => {
      const manifests = [
        { id: "", name: "Valid Name", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "  \t  ", name: "Valid Name", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", name: "", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", name: "   ", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", title: "   ", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.length).toBeGreaterThan(0)
      }
    })

    it("rejects non-array inputs, outputs, and parameters without throwing exceptions", () => {
      const manifests = [
        { id: "test", name: "Test", inputs: "not-an-array", outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: [], outputs: 12345, parameters: [], glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: [], outputs: [], parameters: { a: 1 }, glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: null, outputs: null, parameters: null, glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        expect(() => {
          const res = validateCustomNodeManifest(m)
          expect(res.valid).toBe(false)
        }).not.toThrow()
      }
    })

    it("rejects inputs array containing null, undefined, primitive, or malformed entries", () => {
      const manifests = [
        { id: "t1", name: "T1", inputs: [null], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t2", name: "T2", inputs: [undefined], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t3", name: "T3", inputs: ["string_port"], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t4", name: "T4", inputs: [{ name: "in" }], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t5", name: "T5", inputs: [{ type: "float" }], outputs: [], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.some((e) => e.includes("Input port at index 0"))).toBe(true)
      }
    })

    it("rejects outputs array containing null, undefined, primitive, or malformed entries", () => {
      const manifests = [
        { id: "t1", name: "T1", inputs: [], outputs: [null], parameters: [], glsl: "void main() {}" },
        { id: "t2", name: "T2", inputs: [], outputs: [undefined], parameters: [], glsl: "void main() {}" },
        { id: "t3", name: "T3", inputs: [], outputs: [42], parameters: [], glsl: "void main() {}" },
        { id: "t4", name: "T4", inputs: [], outputs: [{ name: "out" }], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.some((e) => e.includes("Output port at index 0"))).toBe(true)
      }
    })

    it("rejects parameters array containing null, undefined, arrays, or objects with empty name/type", () => {
      const manifests = [
        { id: "p1", name: "P1", inputs: [], outputs: [], parameters: [null], glsl: "void main() {}" },
        { id: "p2", name: "P2", inputs: [], outputs: [], parameters: [undefined], glsl: "void main() {}" },
        { id: "p3", name: "P3", inputs: [], outputs: [], parameters: [[]], glsl: "void main() {}" },
        { id: "p4", name: "P4", inputs: [], outputs: [], parameters: [123], glsl: "void main() {}" },
        { id: "p5", name: "P5", inputs: [], outputs: [], parameters: [{ name: "", type: "float" }], glsl: "void main() {}" },
        { id: "p6", name: "P6", inputs: [], outputs: [], parameters: [{ name: "   ", type: "float" }], glsl: "void main() {}" },
        { id: "p7", name: "P7", inputs: [], outputs: [], parameters: [{ name: "speed", type: "" }], glsl: "void main() {}" },
        { id: "p8", name: "P8", inputs: [], outputs: [], parameters: [{ name: "speed", type: "   " }], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.length).toBeGreaterThan(0)
      }
    })

    it("survives circular parameter reference objects without infinite recursion or stack overflow", () => {
      const circularParam: any = {
        name: "recursive_param",
        type: "float",
        default: 1.0,
      }
      circularParam.self = circularParam
      circularParam.options = [{ label: "Self", value: circularParam }]

      const circularManifest: any = {
        id: "circular-param-manifest",
        name: "Circular Param Manifest",
        inputs: [{ name: "in", type: "float" }],
        outputs: [{ name: "out", type: "float" }],
        parameters: [circularParam],
        glsl: "float run(float x) { return x; }",
      }
      circularManifest.self = circularManifest

      expect(() => {
        const res = validateCustomNodeManifest(circularManifest)
        expect(res.valid).toBe(true)
        expect(res.manifest).toBeDefined()
        expect(res.manifest?.parameters[0].name).toBe("recursive_param")
      }).not.toThrow()
    })

    it("CustomNodeRegistry successfully registers valid manifest and rejects malformed manifest without crashing", () => {
      const registry = new CustomNodeRegistry()

      const validManifest: CustomNodeManifest = {
        id: "my-custom-filter",
        name: "My Custom Filter",
        category: "filter",
        inputs: [{ name: "color", type: "vec4" }],
        outputs: [{ name: "result", type: "vec4" }],
        parameters: [{ name: "intensity", type: "float", default: 0.5 }],
        wgsl: "fn run(c: vec4<f32>) -> vec4<f32> { return c; }",
      }

      const registered = registry.register(validManifest)
      expect(registered).toBe(true)
      expect(registry.has("my-custom-filter")).toBe(true)

      const badManifest: any = {
        id: "   ",
        name: "Bad",
        inputs: [],
        outputs: [],
        parameters: [],
      }
      const registeredBad = registry.register(badManifest)
      expect(registeredBad).toBe(false)
      expect(registry.has("   ")).toBe(false)
    })
  })

  // =========================================================================
  // PROBE BATTERY 4: Sub-Graph Uniform Namespacing Hyphen and Punctuation Stress
  // =========================================================================
  describe("Probe Battery 4: Sub-Graph Uniform Namespacing Hyphens and Syntax Safety", () => {
    it("replaces hyphens in node IDs to produce syntactically valid GLSL/WGSL uniform identifiers", () => {
      const lib = new SubGraphLibrary()
      lib.register({
        id: "hyphen-sub",
        name: "Hyphen Sub",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "float", direction: "output", internalNodeId: "u_val" }],
        nodes: [
          {
            id: "u_val",
            position: { x: 0, y: 0 },
            data: { type: "uniform", name: "speed", uniformId: "u_speed", uniformType: "float", defaultValue: 1.0 },
          },
        ],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "subgraph-node-999-alpha-beta",
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "hyphen-sub",
            name: "Hyphen Test",
            uniformValues: { speed: 42.0 },
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], lib)
      expect(result.error).toBeNull()

      const uniformNode = result.nodes.find((n) => n.data.type === "uniform")
      expect(uniformNode).toBeDefined()
      if (uniformNode && uniformNode.data.type === "uniform") {
        expect(uniformNode.data.name).not.toContain("-")
        expect(uniformNode.data.name).toBe("u_subgraph_node_999_alpha_beta_speed")
        expect(uniformNode.data.defaultValue).toBe(42.0)
      }
    })
  })
})
})

describe("port connections + sub-graph collisions (m1 challenger2)", () => {
describe("Milestone 1 Challenger Instance 2: Empirical Challenge Suite (R1)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    subGraphLibrary.reset()
    useProjectStore.setState({
      activeBackend: "webgpu",
      shaderSource: "",
      activeShaderPath: null,
      parsedUniforms: [
        { name: "u_time", type: "float", defaultValue: 0.0 },
        { name: "u_resolution", type: "vec2", defaultValue: [1920, 1080] },
      ],
      uniformValues: { u_time: 1.5, u_resolution: [1920, 1080] },
      lastCompileError: null,
      deviceLost: false,
      autoCompile: true,
      recompileTrigger: 0,
      graphUniforms: [
        {
          uniformId: "u_color",
          name: "u_color",
          uniformType: "vec4",
          defaultValue: [0.2, 0.4, 0.8, 1.0],
        },
      ],
      textureResources: [],
      renderQueue: [{ type: "mesh", geometry: "torus_knot" }],
      _graphNodes: [],
      _graphEdges: [],
      currentProjectName: "AdversarialChallengeProject",
      hasUnsavedChanges: false,
    })
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 2: Dynamic Port Connection & Node Graph State Resilience
  // ==========================================================================
  describe("2. Dynamic Port Connection & Sub-Graph Uniform Collision Stress", () => {
    it("sub-graph uniform namespacing prevents collision across 10 concurrent instances of the same sub-graph", () => {
      const INSTANCE_COUNT = 10
      const rootNodes: Node<GraphNodeData>[] = [
        { id: "mesh-main", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "out-main", position: { x: 500, y: 0 }, data: { type: "output" } },
      ]
      const rootEdges: Edge[] = []

      for (let i = 0; i < INSTANCE_COUNT; i++) {
        const instId = `fresnel_inst_${i}`
        const powerValue = 1.0 + i * 0.5
        rootNodes.push({
          id: instId,
          position: { x: 100 + i * 30, y: i * 40 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: `Fresnel Instance ${i}`,
            uniformValues: { power: powerValue },
          } as SubGraphNodeData,
        })

        if (i === 0) {
          rootEdges.push({
            id: `edge_in_${i}`,
            source: "mesh-main",
            target: instId,
            targetHandle: "normal",
          })
        }
        if (i === INSTANCE_COUNT - 1) {
          rootEdges.push({
            id: `edge_out_${i}`,
            source: instId,
            sourceHandle: "rimOutput",
            target: "out-main",
          })
        }
      }

      const result = flattenGraph(rootNodes, rootEdges, subGraphLibrary)
      expect(result.error).toBeNull()

      expect(result.nodes.length).toBe(42)

      const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes.length).toBe(INSTANCE_COUNT * 2)

      const uniformIds = new Set<string>()
      const uniformNames = new Set<string>()

      for (let i = 0; i < INSTANCE_COUNT; i++) {
        const expectedPowerId = `fresnel_inst_${i}__u_power`
        const expectedPowerName = `u_fresnel_inst_${i}_power`
        const expectedColorId = `fresnel_inst_${i}__u_color`
        const expectedColorName = `u_fresnel_inst_${i}_rimColor`

        const powerNode = uniformNodes.find((n) => n.id === expectedPowerId)
        expect(powerNode).toBeDefined()
        if (powerNode && powerNode.data.type === "uniform") {
          expect(powerNode.data.name).toBe(expectedPowerName)
          expect(powerNode.data.defaultValue).toBeCloseTo(1.0 + i * 0.5)
        }

        const colorNode = uniformNodes.find((n) => n.id === expectedColorId)
        expect(colorNode).toBeDefined()
        if (colorNode && colorNode.data.type === "uniform") {
          expect(colorNode.data.name).toBe(expectedColorName)
        }

        expect(uniformIds.has(expectedPowerId)).toBe(false)
        expect(uniformIds.has(expectedColorId)).toBe(false)
        expect(uniformNames.has(expectedPowerName)).toBe(false)
        expect(uniformNames.has(expectedColorName)).toBe(false)

        uniformIds.add(expectedPowerId)
        uniformIds.add(expectedColorId)
        uniformNames.add(expectedPowerName)
        uniformNames.add(expectedColorName)
      }
    })

    it("hierarchical sub-graph nesting (3 levels) properly namespaces nested uniform IDs and names", () => {
      const customLib = new SubGraphLibrary()

      const subC: SubGraphDefinition = {
        id: "sub-c",
        name: "Sub C",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "float", direction: "output", internalNodeId: "u_factor", internalHandleId: "value" }],
        nodes: [
          { id: "u_factor", position: { x: 0, y: 0 }, data: { type: "uniform", uniformId: "factor", name: "factor", uniformType: "float", defaultValue: 3.14 } },
        ],
        edges: [],
      }
      customLib.register(subC)

      const subB: SubGraphDefinition = {
        id: "sub-b",
        name: "Sub B",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "float", direction: "output", internalNodeId: "c1", internalHandleId: "out" }],
        nodes: [
          { id: "c1", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-c", name: "Child 1", uniformValues: { factor: 10.0 } } as SubGraphNodeData },
          { id: "c2", position: { x: 50, y: 0 }, data: { type: "subgraph", subGraphId: "sub-c", name: "Child 2", uniformValues: { factor: 20.0 } } as SubGraphNodeData },
        ],
        edges: [],
      }
      customLib.register(subB)

      const subA: SubGraphDefinition = {
        id: "sub-a",
        name: "Sub A",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "float", direction: "output", internalNodeId: "b_inst", internalHandleId: "out" }],
        nodes: [
          { id: "b_inst", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-b", name: "B Instance" } as SubGraphNodeData },
        ],
        edges: [],
      }
      customLib.register(subA)

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "a1", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-a", name: "A 1" } as SubGraphNodeData },
        { id: "a2", position: { x: 100, y: 0 }, data: { type: "subgraph", subGraphId: "sub-a", name: "A 2" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).toBeNull()

      const factorNodes = result.nodes.filter((n) => n.data.type === "uniform")
      expect(factorNodes.length).toBe(4)

      const expectedIds = [
        "a1__b_inst__c1__u_factor",
        "a1__b_inst__c2__u_factor",
        "a2__b_inst__c1__u_factor",
        "a2__b_inst__c2__u_factor",
      ]
      for (const expectedId of expectedIds) {
        const found = factorNodes.find((n) => n.id === expectedId)
        expect(found).toBeDefined()
      }
    })

    it("resiliently handles edge connections when targetHandle or sourceHandle is missing or malformed", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        {
          id: "sub-rim",
          position: { x: 100, y: 0 },
          data: { type: "subgraph", subGraphId: "builtin-fresnel-rim", name: "Rim" } as SubGraphNodeData,
        },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "sub-rim", targetHandle: "nonexistent_handle" },
        { id: "e2", source: "sub-rim", sourceHandle: undefined, target: "out-1" },
      ]

      const result = flattenGraph(nodes, edges, subGraphLibrary)
      expect(result.error).toBeNull()

      const reroutedE1 = result.edges.find((e) => e.source === "mesh-1")
      expect(reroutedE1).toBeDefined()
      expect(reroutedE1?.target).toBe("sub-rim__mat_rim")

      const reroutedE2 = result.edges.find((e) => e.target === "out-1")
      expect(reroutedE2).toBeDefined()
      expect(reroutedE2?.source).toBe("sub-rim__mat_rim")
    })

    it("detects multi-node circular recursion in sub-graphs (A -> B -> C -> A)", () => {
      const customLib = new SubGraphLibrary()
      customLib.register({
        id: "cycle-a",
        name: "Cycle A",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_b", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-b", name: "To B" } as SubGraphNodeData }],
        edges: [],
      })
      customLib.register({
        id: "cycle-b",
        name: "Cycle B",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_c", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-c", name: "To C" } as SubGraphNodeData }],
        edges: [],
      })
      customLib.register({
        id: "cycle-c",
        name: "Cycle C",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [{ id: "n_a", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-a", name: "Back To A" } as SubGraphNodeData }],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "root", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "cycle-a", name: "Start" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain("Cycle detected in sub-graph expansion")
      expect(result.error).toContain("cycle-a -> cycle-b -> cycle-c -> cycle-a")
    })

    it("stress tests dynamic port additions and deletions on math expression validator", () => {
      let res = validateMathExpression("sin(uv.x * 10.0) * 0.5 + 0.5", ["uv"])
      expect(res.isValid).toBe(true)

      res = validateMathExpression("sin(uv.x * freq) * 0.5 + 0.5", ["uv"])
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unknown identifier 'freq'")

      res = validateMathExpression("sin(uv.x * freq) * 0.5 + 0.5", ["uv", "freq"])
      expect(res.isValid).toBe(true)
      expect(res.referencedInputs).toContain("freq")

      res = validateMathExpression("(pos.xyz + normal.xyz * displacement) * tint.rgb", ["pos", "normal", "displacement", "tint"])
      expect(res.isValid).toBe(true)
      expect(res.outputType).toBe("vec3")
      expect(res.referencedInputs).toEqual(["pos", "normal", "displacement", "tint"])

      res = validateMathExpression("(pos.xyz + normal.xyz * displacement) * tint.rgb", ["pos", "displacement", "tint"])
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unknown identifier 'normal'")
    })

    it("strictly blocks JavaScript and GLSL injection in math expression node", () => {
      const maliciousPayloads = [
        "1.0; discard;",
        "1.0; return vec4(0.0);",
        "#define INJECT 1",
        "/* comment */ 1.0",
        "system('calc')",
        "eval('2+2')",
        "__proto__",
        "constructor",
        "window.alert(1)",
        "fetch('https://evil.com')",
      ]

      for (const payload of maliciousPayloads) {
        const res = validateMathExpression(payload, ["uv"])
        expect(res.isValid).toBe(false)
        expect(res.error).not.toBeNull()
      }
    })
  })
})
})

describe("UUID sanitisation + registry stress (stress probe)", () => {
describe("Stress Probes: Milestone 1 Gate 2 Empirical Challenge", () => {

  // ==========================================================================
  // STRESS PROBE 2: Uniform Sanitization with Multi-Hyphen UUIDs
  // ==========================================================================
  describe("Stress Probe 2: Node Graph Uniform Sanitization with UUIDs (u_uuid_with_hyphens_uniform)", () => {
    it("sanitizes multi-hyphen UUID v4 in sub-graph node ID into valid GLSL/WGSL identifier", () => {
      const uuidNodeId = "subgraph-f47ac10b-58cc-4372-a567-0e02b2c3d479"
      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: uuidNodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "UUID Fresnel Instance",
            uniformValues: { power: 4.5 },
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], subGraphLibrary)
      expect(result.error).toBeNull()

      const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes.length).toBe(2)

      for (const uNode of uniformNodes) {
        const uData = uNode.data as UniformNodeData
        // Identifier legality check for GLSL/WGSL: [a-zA-Z_][a-zA-Z0-9_]*
        expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
        // Must NOT contain any hyphens
        expect(uData.name.includes("-")).toBe(false)
        // Must contain sanitized UUID with underscores
        expect(uData.name).toContain("f47ac10b_58cc_4372_a567_0e02b2c3d479")
      }

      const powerNode = uniformNodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect(powerNode).toBeDefined()
      if (powerNode && powerNode.data.type === "uniform") {
        expect(powerNode.data.name).toBe("u_subgraph_f47ac10b_58cc_4372_a567_0e02b2c3d479_power")
        expect(powerNode.data.defaultValue).toBe(4.5)
      }
    })

    it("sanitizes numeric-leading UUIDs and heavily hyphenated extreme IDs", () => {
      const extremeIds = [
        "12345678-1234-1234-1234-123456789abc",
        "---triple-leading-and-trailing---",
        "a-b-c-d-e-f-0-1-2-3-4-5",
        "uuid-with-lots-of-hyphens-every-word-separated",
      ]

      for (const id of extremeIds) {
        const rootNodes: Node<GraphNodeData>[] = [
          {
            id,
            position: { x: 0, y: 0 },
            data: {
              type: "subgraph",
              subGraphId: "builtin-fresnel-rim",
              name: `Test ${id}`,
            } as SubGraphNodeData,
          },
        ]

        const result = flattenGraph(rootNodes, [], subGraphLibrary)
        expect(result.error).toBeNull()

        const uniformNodes = result.nodes.filter((n) => n.data.type === "uniform")
        for (const uNode of uniformNodes) {
          const uData = uNode.data as UniformNodeData
          // In GLSL/WGSL, identifier must not have hyphens
          expect(uData.name.includes("-")).toBe(false)
          // Starts with u_
          expect(uData.name.startsWith("u_")).toBe(true)
          // Must match legal identifier
          expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
        }
      }
    })

    it("properly resolves uniformValues overrides when target is keyed with sanitized or unsanitized names", () => {
      const nodeId = "sub-uuid-1111-2222-3333"
      const unsanitizedKey = `u_${nodeId}_power` // u_sub-uuid-1111-2222-3333_power
      const sanitizedKey = `u_sub_uuid_1111_2222_3333_power`

      // 1. Unsanitized key override
      let rootNodes: Node<GraphNodeData>[] = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { [unsanitizedKey]: 9.25 },
          } as SubGraphNodeData,
        },
      ]
      let res = flattenGraph(rootNodes, [], subGraphLibrary)
      let powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(9.25)

      // 2. Sanitized key override
      rootNodes = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { [sanitizedKey]: 7.5 },
          } as SubGraphNodeData,
        },
      ]
      res = flattenGraph(rootNodes, [], subGraphLibrary)
      powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(7.5)

      // 3. Short original name override
      rootNodes = [
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Test",
            uniformValues: { power: 3.33 },
          } as SubGraphNodeData,
        },
      ]
      res = flattenGraph(rootNodes, [], subGraphLibrary)
      powerNode = res.nodes.find((n) => n.data.type === "uniform" && n.data.name.includes("power"))
      expect((powerNode?.data as UniformNodeData).defaultValue).toBe(3.33)
    })

    it("verifies multi-level sub-graph nesting preserves hyphen sanitization at all depths", () => {
      const customLib = new SubGraphLibrary()

      // Leaf definition with uniform
      customLib.register({
        id: "leaf-sub-graph",
        name: "Leaf",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "u_leaf_param",
            position: { x: 0, y: 0 },
            data: {
              type: "uniform",
              uniformId: "param",
              name: "leaf_param",
              uniformType: "float",
              defaultValue: 1.0,
            },
          },
        ],
        edges: [],
      })

      // Intermediate definition
      customLib.register({
        id: "mid-sub-graph",
        name: "Mid",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          {
            id: "inner-uuid-leaf-aaaa-bbbb",
            position: { x: 0, y: 0 },
            data: {
              type: "subgraph",
              subGraphId: "leaf-sub-graph",
              name: "Leaf Sub",
            } as SubGraphNodeData,
          },
        ],
        edges: [],
      })

      // Root graph with outer UUID
      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "outer-uuid-mid-cccc-dddd",
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "mid-sub-graph",
            name: "Mid Sub",
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).toBeNull()

      const uniformNode = result.nodes.find((n) => n.data.type === "uniform")
      expect(uniformNode).toBeDefined()
      const uData = uniformNode!.data as UniformNodeData

      // Must be completely free of hyphens in its GLSL identifier name
      expect(uData.name.includes("-")).toBe(false)
      expect(uData.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      expect(uData.name).toContain("outer_uuid_mid_cccc_dddd")
      expect(uData.name).toContain("inner_uuid_leaf_aaaa_bbbb")
    })
  })

  // ==========================================================================
  // STRESS PROBE 3: Custom Node Registry Memory & Rapid Operations Stability
  // ==========================================================================
  describe("Stress Probe 3: Custom Node Registry Rapid Operations & Memory Stability", () => {
    let registry: CustomNodeRegistry

    beforeEach(() => {
      registry = new CustomNodeRegistry()
      registry.clear()
    })

    afterEach(() => {
      registry.clear()
    })

    it("survives 10,000 rapid sequential registrations and unregistrations with zero leak", () => {
      const COUNT = 10000

      // Rapid register
      for (let i = 0; i < COUNT; i++) {
        const manifest: CustomNodeManifest = {
          id: `custom-node-${i}`,
          name: `Custom Node ${i}`,
          category: "math",
          inputs: [{ name: "inVal", type: "float" }],
          outputs: [{ name: "outVal", type: "float" }],
          parameters: [{ name: "gain", type: "float", default: 1.0 }],
          glsl: `float node_${i}(float x) { return x * 2.0; }`,
        }
        const ok = registry.register(manifest)
        expect(ok).toBe(true)
      }

      expect(registry.getAll().length).toBe(COUNT)

      // Rapid unregister
      for (let i = 0; i < COUNT; i++) {
        const ok = registry.unregister(`custom-node-${i}`)
        expect(ok).toBe(true)
      }

      expect(registry.getAll().length).toBe(0)
    })

    it("handles 5,000 interleaved register / unregister / palette queries without state corruption", () => {
      const BATCH = 5000

      for (let i = 0; i < BATCH; i++) {
        registry.register({
          id: `node-${i}`,
          name: `Node ${i}`,
          category: "filter",
          inputs: [{ name: "in", type: "vec3" }],
          outputs: [{ name: "out", type: "vec3" }],
          parameters: [],
          wgsl: `fn run_${i}(v: vec3f) -> vec3f { return v; }`,
        })

        if (i % 2 === 1) {
          // Unregister previous odd
          registry.unregister(`node-${i - 1}`)
        }

        if (i % 1000 === 0) {
          const items = registry.getPaletteItems()
          expect(Array.isArray(items)).toBe(true)
        }
      }

      // After 5000 items (0..4999), all even i where i-1 was unregistered were removed when i was odd
      // Total remaining must be exactly 2500
      expect(registry.getAll().length).toBe(2500)
    })

    it("handles 1,000 rapid updates to the same manifest ID without duplicate entries", () => {
      const nodeId = "hot-reloaded-node"

      for (let i = 0; i < 1000; i++) {
        const manifest: CustomNodeManifest = {
          id: nodeId,
          name: `Version ${i}`,
          category: "generator",
          inputs: [{ name: "uv", type: "vec2" }],
          outputs: [{ name: "col", type: "vec4" }],
          parameters: [{ name: "iteration", type: "float", default: i }],
          glsl: `vec4 gen_${i}() { return vec4(${i}.0); }`,
        }
        registry.register(manifest)
      }

      expect(registry.getAll().length).toBe(1)
      const finalManifest = registry.get(nodeId)
      expect(finalManifest?.name).toBe("Version 999")
      expect(finalManifest?.parameters[0].default).toBe(999)
    })

    it("robustly rejects 1,000 malformed / adversarial manifests without crashing", () => {
      const garbagePayloads = [
        null,
        undefined,
        {},
        { id: "" },
        { id: "   " },
        { id: "valid-id", name: "" },
        { id: "valid-id", name: "   " },
        { id: "valid-id", name: "Valid", inputs: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: "not-an-array" },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [null] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "" }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "p1", type: "" }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [{ name: "p1", type: "   " }] },
        { id: "valid-id", name: "Valid", inputs: [], outputs: [], parameters: [] }, // missing shader
      ]

      for (let cycle = 0; cycle < 50; cycle++) {
        for (const bad of garbagePayloads) {
          expect(() => {
            const res = validateCustomNodeManifest(bad)
            expect(res.valid).toBe(false)
            const registered = registry.register(bad as any)
            expect(registered).toBe(false)
          }).not.toThrow()
        }
      }

      expect(registry.getAll().length).toBe(0)
    })

    it("verifies component registration and memory release upon registry.clear()", () => {
      const DummyComponent: React.FC = () => React.createElement("div", null, "Custom UI")

      for (let i = 0; i < 500; i++) {
        registry.registerComponent(`comp_${i}`, DummyComponent)
      }

      expect(registry.getComponent("comp_0")).toBe(DummyComponent)
      expect(registry.getComponent("comp_499")).toBe(DummyComponent)

      registry.clear()

      expect(registry.getComponent("comp_0")).toBeUndefined()
      expect(registry.getComponent("comp_499")).toBeUndefined()
    })
  })
})
})

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
})

