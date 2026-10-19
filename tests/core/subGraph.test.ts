import { describe, it, expect, beforeEach } from "vitest"
import {
  SubGraphLibrary,
  subGraphLibrary,
  collapseNodesToSubGraph,
  BUILTIN_FRESNEL_RIM,
  BUILTIN_NOISE_GEN,
  BUILTIN_UV_DISTORTION,
  type SubGraphDefinition,
  type SubGraphNodeData,
} from "@/core/subGraphLibrary"
import {
  flattenGraph,
  compileGraph,
  MAX_SUBGRAPH_DEPTH,
  type GraphNodeData,
} from "@/core/graphCompiler"
import type { Node, Edge } from "@xyflow/react"

describe("R1a: Sub-graph / Group Nodes & Library", () => {
  let customLib: SubGraphLibrary

  beforeEach(() => {
    customLib = new SubGraphLibrary()
  })

  describe("SubGraphLibrary Registry & Built-ins", () => {
    it("initializes with 3 built-in sub-graphs", () => {
      expect(subGraphLibrary.has("builtin-fresnel-rim")).toBe(true)
      expect(subGraphLibrary.has("builtin-noise-gen")).toBe(true)
      expect(subGraphLibrary.has("builtin-uv-distortion")).toBe(true)

      const fresnel = subGraphLibrary.get("builtin-fresnel-rim")
      expect(fresnel?.name).toBe("Fresnel Rim Lighting")
      expect(fresnel?.category).toBe("Lighting")
      expect(fresnel?.isBuiltin).toBe(true)
      expect(fresnel?.inputs.length).toBeGreaterThan(0)
      expect(fresnel?.outputs.length).toBeGreaterThan(0)

      const noise = subGraphLibrary.get("builtin-noise-gen")
      expect(noise?.name).toBe("Noise Generator")
      expect(noise?.category).toBe("Procedural")
      expect(noise?.isBuiltin).toBe(true)

      const distortion = subGraphLibrary.get("builtin-uv-distortion")
      expect(distortion?.name).toBe("UV Distortion")
      expect(distortion?.category).toBe("Distortion")
      expect(distortion?.isBuiltin).toBe(true)
    })

    it("registers, updates, retrieves, and unregisters custom sub-graphs", () => {
      const def: SubGraphDefinition = {
        id: "test-subgraph-1",
        name: "Test Subgraph",
        description: "A test subgraph",
        category: "Utility",
        isBuiltin: false,
        inputs: [{ id: "in_val", name: "In", type: "float", direction: "input", internalNodeId: "node_1" }],
        outputs: [{ id: "out_val", name: "Out", type: "float", direction: "output", internalNodeId: "node_2" }],
        nodes: [],
        edges: [],
      }

      customLib.register(def)
      expect(customLib.has("test-subgraph-1")).toBe(true)
      expect(customLib.get("test-subgraph-1")?.name).toBe("Test Subgraph")

      // Update definition
      customLib.register({ ...def, name: "Updated Test Subgraph" })
      expect(customLib.get("test-subgraph-1")?.name).toBe("Updated Test Subgraph")

      // Unregister
      expect(customLib.unregister("test-subgraph-1")).toBe(true)
      expect(customLib.has("test-subgraph-1")).toBe(false)
    })

    it("prevents unregistering built-in sub-graphs", () => {
      const removed = subGraphLibrary.unregister("builtin-fresnel-rim")
      expect(removed).toBe(false)
      expect(subGraphLibrary.has("builtin-fresnel-rim")).toBe(true)
    })

    it("lists all definitions and filters by category", () => {
      const all = subGraphLibrary.getAll()
      expect(all.length).toBeGreaterThanOrEqual(3)

      const lighting = subGraphLibrary.getByCategory("Lighting")
      expect(lighting.some((d) => d.id === "builtin-fresnel-rim")).toBe(true)

      const procedural = subGraphLibrary.getByCategory("Procedural")
      expect(procedural.some((d) => d.id === "builtin-noise-gen")).toBe(true)
    })
  })

  describe("collapseNodesToSubGraph Helper", () => {
    it("packages selected nodes and edges into a reusable SubGraphDefinition", () => {
      const selectedNodes: Node<GraphNodeData>[] = [
        { id: "u_scale", position: { x: 0, y: 0 }, data: { type: "uniform", name: "scale", uniformType: "float", defaultValue: 2.0, uniformId: "u_scale" } },
        { id: "mat_test", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.frag" } },
      ]
      const internalEdges: Edge[] = [
        { id: "e_internal", source: "u_scale", target: "mat_test", targetHandle: "scale" },
      ]
      const allEdges: Edge[] = [
        ...internalEdges,
        { id: "e_in", source: "mesh_external", target: "mat_test", targetHandle: "mesh" },
        { id: "e_out", source: "mat_test", target: "out_external", sourceHandle: "color" },
      ]

      const collapsed = collapseNodesToSubGraph(
        selectedNodes,
        allEdges,
        {
          name: "Custom Collapse",
          category: "Procedural",
        }
      )

      expect(collapsed.definition.name).toBe("Custom Collapse")
      expect(collapsed.definition.category).toBe("Procedural")
      expect(collapsed.definition.nodes.length).toBe(2)
      expect(collapsed.definition.edges.length).toBe(1)
      expect(collapsed.subGraphNode.position).toEqual({ x: 0, y: 0 })
      expect((collapsed.subGraphNode.data as SubGraphNodeData).type).toBe("subgraph")
      expect((collapsed.subGraphNode.data as SubGraphNodeData).subGraphId).toBe(collapsed.definition.id)

      // External inputs and outputs mapped to ports
      expect(collapsed.definition.inputs.length).toBe(1)
      expect(collapsed.definition.inputs[0].internalNodeId).toBe("mat_test")
      expect(collapsed.definition.outputs.length).toBe(1)
      expect(collapsed.definition.outputs[0].internalNodeId).toBe("mat_test")
    })
  })

  describe("Graph Compiler Sub-Graph Flattening (flattenGraph)", () => {
    it("flattens a 1-level sub-graph and namespaces inner uniforms", () => {
      const subDef: SubGraphDefinition = {
        id: "sub-1",
        name: "Inner Sub",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [{ id: "mesh_in", name: "Mesh", type: "mesh", direction: "input", internalNodeId: "inner_mat", internalHandleId: "mesh" }],
        outputs: [{ id: "mat_out", name: "Output", type: "any", direction: "output", internalNodeId: "inner_mat" }],
        nodes: [
          { id: "inner_mat", position: { x: 0, y: 0 }, data: { type: "material", shaderPath: "inner.frag" } },
          { id: "inner_u", position: { x: -50, y: 0 }, data: { type: "uniform", name: "intensity", uniformType: "float", defaultValue: 1.5, uniformId: "u_intensity" } },
        ],
        edges: [
          { id: "inner_e", source: "inner_u", target: "inner_mat", targetHandle: "intensity" },
        ],
      }
      customLib.register(subDef)

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        {
          id: "sub_node_1",
          position: { x: 100, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "sub-1",
            name: "Inner Sub Instance",
            uniformValues: { intensity: 4.2 },
          } as SubGraphNodeData,
        },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]

      const rootEdges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "sub_node_1", targetHandle: "mesh_in" },
        { id: "e2", source: "sub_node_1", sourceHandle: "mat_out", target: "out-1" },
      ]

      const result = flattenGraph(rootNodes, rootEdges, customLib)
      expect(result.error).toBeNull()
      expect(result.nodes.length).toBe(4) // mesh-1, out-1, sub_node_1__inner_mat, sub_node_1__inner_u

      // Check uniform namespacing and value override
      const namespacedUniform = result.nodes.find((n) => n.id === "sub_node_1__inner_u")
      expect(namespacedUniform).toBeDefined()
      expect(namespacedUniform?.data.type).toBe("uniform")
      if (namespacedUniform && namespacedUniform.data.type === "uniform") {
        expect(namespacedUniform.data.name).toBe("u_sub_node_1_intensity")
        expect(namespacedUniform.data.defaultValue).toBe(4.2)
      }

      // Check edge rerouting
      const meshToMatEdge = result.edges.find((e) => e.source === "mesh-1")
      expect(meshToMatEdge?.target).toBe("sub_node_1__inner_mat")
      expect(meshToMatEdge?.targetHandle).toBe("mesh")

      const matToOutEdge = result.edges.find((e) => e.target === "out-1")
      expect(matToOutEdge?.source).toBe("sub_node_1__inner_mat")
    })

    it("supports deep multi-level sub-graph nesting up to 8 levels", () => {
      // Create a chain of subgraphs: sub-8 -> sub-7 -> ... -> sub-1
      let currentSubNodes: Node<GraphNodeData>[] = [
        { id: "leaf_mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
      ]
      let currentSubEdges: Edge[] = []
      let lastOutputNodeId = "leaf_mesh"

      for (let level = 1; level <= 8; level++) {
        const levelId = `level-${level}`
        const def: SubGraphDefinition = {
          id: levelId,
          name: `Level ${level}`,
          description: "",
          category: "Utility",
          isBuiltin: false,
          inputs: [],
          outputs: [{ id: "out", name: "Out", type: "mesh", direction: "output", internalNodeId: lastOutputNodeId }],
          nodes: currentSubNodes,
          edges: currentSubEdges,
        }
        customLib.register(def)

        // Next level wraps the previous subgraph
        const subInstanceId = `sub_inst_${level}`
        currentSubNodes = [
          {
            id: subInstanceId,
            position: { x: 0, y: 0 },
            data: { type: "subgraph", subGraphId: levelId, name: `Level ${level} Node` } as SubGraphNodeData,
          },
        ]
        currentSubEdges = []
        lastOutputNodeId = subInstanceId
      }

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "root_sub",
          position: { x: 0, y: 0 },
          data: { type: "subgraph", subGraphId: "level-8", name: "Top Sub" } as SubGraphNodeData,
        },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const rootEdges: Edge[] = [
        { id: "e_out", source: "root_sub", sourceHandle: "out", target: "out-1" },
      ]

      const result = flattenGraph(rootNodes, rootEdges, customLib)
      expect(result.error).toBeNull()
      // Should find the deeply nested leaf_mesh node
      const leafMesh = result.nodes.find((n) => n.data.type === "mesh")
      expect(leafMesh).toBeDefined()
    })

    it("detects and rejects nesting depths exceeding maximum of 8 levels", () => {
      // Create a 9-level deep hierarchy
      for (let level = 1; level <= 9; level++) {
        const levelId = `overflow-${level}`
        const childId = level > 1 ? `overflow-${level - 1}` : null
        const nodes: Node<GraphNodeData>[] = childId
          ? [{ id: `sub_${level}`, position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: childId, name: childId } as SubGraphNodeData }]
          : [{ id: "base", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } }]
        customLib.register({
          id: levelId,
          name: levelId,
          description: "",
          category: "Utility",
          isBuiltin: false,
          inputs: [],
          outputs: [],
          nodes,
          edges: [],
        })
      }

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "root", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "overflow-9", name: "overflow" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain(`exceeds maximum allowed limit of ${MAX_SUBGRAPH_DEPTH} levels`)
    })

    it("detects cycles in sub-graph definitions and reports descriptive cycle path", () => {
      // Sub A contains Sub B, Sub B contains Sub A
      customLib.register({
        id: "sub-cycle-a",
        name: "Cycle A",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          { id: "b_node", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-cycle-b", name: "To B" } as SubGraphNodeData },
        ],
        edges: [],
      })

      customLib.register({
        id: "sub-cycle-b",
        name: "Cycle B",
        description: "",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [],
        nodes: [
          { id: "a_node", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-cycle-a", name: "To A" } as SubGraphNodeData },
        ],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        { id: "entry", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sub-cycle-a", name: "Entry" } as SubGraphNodeData },
      ]

      const result = flattenGraph(rootNodes, [], customLib)
      expect(result.error).not.toBeNull()
      expect(result.error).toContain("Cycle detected in sub-graph expansion")
      expect(result.error).toContain("sub-cycle-a -> sub-cycle-b -> sub-cycle-a")
    })

    it("compiles pipeline utilizing built-in Fresnel Rim Lighting sub-graph", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "rim-sub",
          position: { x: 100, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Rim Light",
            uniformValues: { power: 4.5 },
          } as SubGraphNodeData,
        },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "rim-sub", sourceHandle: "rimOutput", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBeGreaterThanOrEqual(2)
      expect(result.queue[0].type).toBe("mesh")
      expect(result.queue[1].type).toBe("material")
    })

    it("sanitizes hyphens to underscores in sub-graph uniform namespacing", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "subgraph-1729285000000",
          position: { x: 100, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "builtin-fresnel-rim",
            name: "Fresnel Subgraph",
            uniformValues: { power: 3.5 },
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(nodes, [], subGraphLibrary)
      expect(result.error).toBeNull()

      const powerUniform = result.nodes.find(
        (n) => n.data.type === "uniform" && (n.data as any).name?.includes("power")
      )
      expect(powerUniform).toBeDefined()
      // Verifies hyphens were replaced with underscores for valid shader identifier syntax
      expect((powerUniform?.data as any).name).toBe("u_subgraph_1729285000000_power")
      expect((powerUniform?.data as any).defaultValue).toBe(3.5)
    })
  })
})
