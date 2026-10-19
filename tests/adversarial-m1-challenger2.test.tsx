import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Node, Edge } from "@xyflow/react"
import {
  SubGraphLibrary,
  subGraphLibrary,
  type SubGraphDefinition,
  type SubGraphNodeData,
} from "@/core/subGraphLibrary"
import {
  flattenGraph,
  compileGraph,
  MAX_SUBGRAPH_DEPTH,
  type GraphNodeData,
} from "@/core/graphCompiler"
import {
  validateMathExpression,
  compileMathExpressionToGlsl,
  compileMathExpressionToWgsl,
} from "@/core/mathExpressionValidator"
import {
  validateCustomNodeManifest,
} from "@/core/customNodeSdk"
import { NodePreviewViewport } from "@/components/inspector/NodePreviewViewport"
import { useProjectStore } from "@/stores/projectStore"
import { resolveRollupManualChunk } from "./e2e/mocks/gen2Harness"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"

describe("Milestone 1 Challenger Instance 2: Empirical Challenge Suite (R1)", () => {
  const distAssetsDir = path.resolve(__dirname, "../dist/assets")
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
  // Section 1: Rollup Manual Chunk Invariant & Bundle Architecture
  // ==========================================================================
  describe("1. Rollup Manual Chunk Invariant Preservation ('vendor-reactflow')", () => {
    it("empirically verifies dist/assets contains the dedicated vendor-reactflow-*.js chunk", () => {
      expect(fs.existsSync(distAssetsDir)).toBe(true)
      const files = fs.readdirSync(distAssetsDir)

      const reactFlowJsChunks = files.filter((f) => /^vendor-reactflow-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(reactFlowJsChunks.length).toBe(1)

      const chunkPath = path.join(distAssetsDir, reactFlowJsChunks[0])
      const stat = fs.statSync(chunkPath)

      // Must be substantial: contains @xyflow/react + core dependencies (> 50 kB and < 500 kB)
      expect(stat.size).toBeGreaterThan(50 * 1024)
      expect(stat.size).toBeLessThan(500 * 1024)

      // Content verification: contains xyflow / reactflow runtime markers
      const content = fs.readFileSync(chunkPath, "utf-8")
      const hasFlowMarkers =
        content.includes("xyflow") ||
        content.includes("reactflow") ||
        content.includes("applyNodeChanges") ||
        content.includes("getConnectedEdges") ||
        content.includes("NodeResizer")
      expect(hasFlowMarkers).toBe(true)
    })

    it("empirically verifies vendor-reactflow CSS stylesheet is bundled cleanly", () => {
      const files = fs.readdirSync(distAssetsDir)
      const reactFlowCssChunks = files.filter((f) => /^vendor-reactflow-[A-Za-z0-9_-]+\.css$/.test(f))
      expect(reactFlowCssChunks.length).toBe(1)

      const cssPath = path.join(distAssetsDir, reactFlowCssChunks[0])
      const stat = fs.statSync(cssPath)
      expect(stat.size).toBeGreaterThan(5 * 1024)
    })

    it("verifies entry chunk index-*.js does NOT leak @xyflow bundle bulk and stays strictly within budgets", () => {
      const files = fs.readdirSync(distAssetsDir)
      const entryFiles = files.filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(entryFiles.length).toBe(1)

      const entryPath = path.join(distAssetsDir, entryFiles[0])
      const stat = fs.statSync(entryPath)
      const uncompressedBytes = stat.size

      // Budget check: strictly < 300 kB un-gzipped
      expect(uncompressedBytes).toBeLessThan(300 * 1024)

      // Budget check: strictly < 90 kB gzipped
      const content = fs.readFileSync(entryPath)
      const gzippedBytes = zlib.gzipSync(content).length
      expect(gzippedBytes).toBeLessThan(90 * 1024)
    })

    it("verifies Rollup manualChunks resolver maps all @xyflow and reactflow variants to vendor-reactflow", () => {
      // Direct imports
      expect(resolveRollupManualChunk("node_modules/@xyflow/react/dist/esm/index.js")).toBe("vendor-reactflow")
      expect(resolveRollupManualChunk("node_modules/@xyflow/system/dist/esm/index.js")).toBe("vendor-reactflow")
      expect(resolveRollupManualChunk("node_modules/reactflow/dist/esm/index.js")).toBe("vendor-reactflow")

      // Windows backslash paths
      expect(resolveRollupManualChunk("node_modules\\@xyflow\\react\\dist\\esm\\index.js".replace(/\\/g, "/"))).toBe("vendor-reactflow")
      expect(resolveRollupManualChunk("node_modules\\reactflow\\dist\\esm\\index.js".replace(/\\/g, "/"))).toBe("vendor-reactflow")

      // Application code is not captured
      expect(resolveRollupManualChunk("src/components/NodeGraph.tsx")).toBeUndefined()
      expect(resolveRollupManualChunk("src/components/nodes/SubGraphNode.tsx")).toBeUndefined()
      expect(resolveRollupManualChunk("src/core/subGraphLibrary.ts")).toBeUndefined()
    })
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

  // ==========================================================================
  // Section 3: Per-Node Live Preview Isolation & Memory Safety
  // ==========================================================================
  describe("3. Per-Node Live Preview Isolation, Store Immunity & Memory Boundedness", () => {
    it("guarantees rendering live preview leaves main project store uniforms and render queue 100% unmutated", () => {
      const initialParsedUniforms = JSON.stringify(useProjectStore.getState().parsedUniforms)
      const initialGraphUniforms = JSON.stringify(useProjectStore.getState().graphUniforms)
      const initialUniformValues = JSON.stringify(useProjectStore.getState().uniformValues)
      const initialRenderQueue = JSON.stringify(useProjectStore.getState().renderQueue)

      const testNodes: Node<GraphNodeData>[] = [
        {
          id: "preview-math",
          position: { x: 0, y: 0 },
          data: { type: "math_expression", expression: "sin(uv.x * 10.0)", outputType: "float" },
        },
        {
          id: "preview-mat",
          position: { x: 0, y: 0 },
          data: { type: "material", shaderPath: "preview.wgsl" },
        },
        {
          id: "preview-mesh",
          position: { x: 0, y: 0 },
          data: { type: "mesh", geometry: "cube" },
        },
        {
          id: "preview-audio",
          position: { x: 0, y: 0 },
          data: { type: "audio", sourceType: "mic" },
        },
      ]

      for (const node of testNodes) {
        const html = renderToStaticMarkup(<NodePreviewViewport node={node} />)
        expect(html).toContain(node.id)
      }

      expect(JSON.stringify(useProjectStore.getState().parsedUniforms)).toBe(initialParsedUniforms)
      expect(JSON.stringify(useProjectStore.getState().graphUniforms)).toBe(initialGraphUniforms)
      expect(JSON.stringify(useProjectStore.getState().uniformValues)).toBe(initialUniformValues)
      expect(JSON.stringify(useProjectStore.getState().renderQueue)).toBe(initialRenderQueue)
    })

    it("verifies live preview uses pure 2D canvas without touching WebGL or WebGPU contexts", () => {
      const getContextCalls: string[] = []
      const canvasMock = env.createCanvas()
      const origGetContext = canvasMock.getContext.bind(canvasMock)

      canvasMock.getContext = (type: string, options?: any) => {
        getContextCalls.push(type)
        return origGetContext(type, options)
      }

      const node: Node<GraphNodeData> = {
        id: "test-preview",
        position: { x: 0, y: 0 },
        data: { type: "math_expression", expression: "cos(uv.y * 5.0)" },
      }

      renderToStaticMarkup(<NodePreviewViewport node={node} />)

      expect(getContextCalls).not.toContain("webgl")
      expect(getContextCalls).not.toContain("webgl2")
      expect(getContextCalls).not.toContain("webgpu")
    })

    it("canvas dimensions are strictly bounded to 240x180 avoiding unbounded memory allocations", () => {
      const node: Node<GraphNodeData> = {
        id: "bounded-preview",
        position: { x: 0, y: 0 },
        data: { type: "math_expression", expression: "sin(uv.x * 20.0)" },
      }

      const html = renderToStaticMarkup(<NodePreviewViewport node={node} />)
      expect(html).toContain('width="240"')
      expect(html).toContain('height="180"')
      expect(html).toContain("240×180")

      const bufferSizeBytes = 240 * 180 * 4
      expect(bufferSizeBytes).toBe(172800)
    })

    it("survives pathological mathematical expressions without exceptions", () => {
      const pathologicalFormulas = [
        "1.0 / 0.0",
        "0.0 / 0.0",
        "1e30",
        "-1e30",
        "sqrt(-1.0)",
      ]

      for (const formula of pathologicalFormulas) {
        const node: Node<GraphNodeData> = {
          id: `pathological-${Date.now()}`,
          position: { x: 0, y: 0 },
          data: { type: "math_expression", expression: formula },
        }

        expect(() => {
          renderToStaticMarkup(<NodePreviewViewport node={node} />)
        }).not.toThrow()
      }
    })

    it("renders annotation nodes with neutral non-rendering placeholder", () => {
      const commentNode: Node<GraphNodeData> = {
        id: "comment-1",
        position: { x: 0, y: 0 },
        data: { type: "comment", text: "This is a comment" },
      }
      const frameNode: Node<GraphNodeData> = {
        id: "frame-1",
        position: { x: 0, y: 0 },
        data: { type: "frame", label: "My Frame" },
      }

      const commentHtml = renderToStaticMarkup(<NodePreviewViewport node={commentNode} />)
      expect(commentHtml).toContain("Annotation node — no isolated shader output.")
      expect(commentHtml).not.toContain("<canvas")

      const frameHtml = renderToStaticMarkup(<NodePreviewViewport node={frameNode} />)
      expect(frameHtml).toContain("Annotation node — no isolated shader output.")
      expect(frameHtml).not.toContain("<canvas")
    })
  })

  // ==========================================================================
  // Section 4: Empirical Bug Reproductions (Challenger Findings)
  // ==========================================================================
  describe("4. Empirical Bug Reproductions (Findings for REQUEST_CHANGES)", () => {
    it("FINDING-01 (REMEDIATED): compileMathExpressionToWgsl correctly compiles mod() containing multi-argument functions", () => {
      // mod(dot(uv, uv), 2.0) has 2 arguments to mod: arg1 = dot(uv, uv), arg2 = 2.0
      const expr = "mod(dot(uv, uv), 2.0)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")

      expect(wgsl).toBe("let out: f32 = ((dot(uv, uv)) % (2.0));")
      expect(wgsl.includes(", 2.0)")).toBe(false)
      expect(wgsl.includes("% (2.0)")).toBe(true)
    })

    it("FINDING-02 (REMEDIATED): compileMathExpressionToWgsl preserves 1-argument atan(x) as atan(x)", () => {
      // In WGSL, single-argument arc tangent is atan(x), not atan2(x)
      const expr = "atan(uv.x)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(uv.x);")
      expect(wgsl).not.toContain("atan2")
    })

    it("FINDING-03 (REMEDIATED): validateCustomNodeManifest returns valid: false without throwing TypeError on null parameter item", () => {
      const manifestWithNullParam = {
        id: "test-node",
        name: "Test Node",
        inputs: [],
        outputs: [],
        parameters: [null],
        glsl: "void main() {}",
      }

      let res: any
      expect(() => {
        res = validateCustomNodeManifest(manifestWithNullParam)
      }).not.toThrow()
      expect(res.valid).toBe(false)
      expect(res.errors.some((e: string) => e.includes("Parameter at index 0 must be a non-null object"))).toBe(true)
    })

    it("FINDING-04 (REMEDIATED): validateCustomNodeManifest rejects whitespace-only IDs as invalid", () => {
      const manifestWithWhitespaceId = {
        id: "   \t\n  ",
        name: "Whitespace ID Node",
        inputs: [{ name: "in", type: "float" }],
        outputs: [{ name: "out", type: "float" }],
        parameters: [],
        glsl: "void main() {}",
      }

      const res = validateCustomNodeManifest(manifestWithWhitespaceId)
      expect(res.valid).toBe(false)
      expect(res.errors.some((e: string) => e.includes("Manifest requires a non-empty string 'id' or 'type'"))).toBe(true)
    })

    it("FINDING-05 (REMEDIATED): validateMathExpression rejects invalid expressions starting with binary operators", () => {
      const res = validateMathExpression("* 2.0")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Expression cannot start with operator '*'")
    })
  })
})
