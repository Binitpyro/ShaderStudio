import { describe, it, expect, beforeEach } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react"

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
  type CustomNodeData,
} from "@/core/graphCompiler"

import {
  validateMathExpression,
  compileMathExpressionToGlsl,
  compileMathExpressionToWgsl,
} from "@/core/mathExpressionValidator"

import {
  validateCustomNodeManifest,
  type CustomNodeManifest,
} from "@/core/customNodeSdk"

import { FrameNode } from "@/components/nodes/FrameNode"
import { CommentNode } from "@/components/nodes/CommentNode"

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

    it("verifies remediation of M1-V5: compileMathExpressionToWgsl preserves single-arg atan(x) as atan(x)", () => {
      const wgsl = compileMathExpressionToWgsl("atan(uv.x)", "out_val", "float")
      expect(wgsl).toBe("let out_val: f32 = atan(uv.x);")
      expect(wgsl).not.toContain("atan2")

      const wgsl2 = compileMathExpressionToWgsl("atan(uv.y, uv.x)", "out_val", "float")
      expect(wgsl2).toBe("let out_val: f32 = atan2(uv.y, uv.x);")
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
    it("renders FrameNode with extreme dimensions and special characters without throwing", () => {
      expect(() => {
        renderToStaticMarkup(
          <ReactFlowProvider>
            <FrameNode
              id="frame-stress"
              data={{
                type: "frame",
                label: "<script>alert('xss')</script> — 🚀 Special # & < > Unicode 123",
                color: "rose",
                width: 999999,
                height: 999999,
              }}
              selected={true}
              zIndex={0}
              isConnectable={false}
              positionAbsoluteX={-10000}
              positionAbsoluteY={-10000}
              dragging={false}
              type="frame"
            />
          </ReactFlowProvider>
        )
      }).not.toThrow()
    })

    it("renders CommentNode with multiline strings, emojis, and unknown color gracefully", () => {
      const html = renderToStaticMarkup(
        <CommentNode
          id="comment-stress"
          data={{
            type: "comment",
            title: "🔥 Heavy Shader Pass\nMulti-line",
            text: "Line 1\nLine 2\nLine 3\n\0 Null byte & <tag>",
            color: "non-existent-color-theme" as any,
          }}
          selected={false}
          zIndex={1}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="comment"
        />
      )

      expect(html).toContain("Heavy Shader Pass")
      expect(html).toContain("bg-amber-950/20")
    })

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
