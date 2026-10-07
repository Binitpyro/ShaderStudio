import { describe, it, expect } from "vitest"
import { compileGraph, type GraphNodeData } from "../graphCompiler"
import type { Node, Edge } from "reactflow"

describe("graphCompiler", () => {
  it("fails when no output node is present", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
    ]
    const edges: Edge[] = []
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("No output node found")
    expect(result.queue).toHaveLength(0)
  })

  it("fails when multiple output nodes are present", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "out-1", position: { x: 0, y: 0 }, data: { type: "output" } },
      { id: "out-2", position: { x: 0, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = []
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("Multiple output nodes found")
  })

  it("fails when a material node has no mesh input", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mat-1", position: { x: 0, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
      { id: "out-1", position: { x: 0, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mat-1", target: "out-1" },
    ]
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain('is missing a mesh input')
  })

  it("successfully compiles a valid Mesh -> Material -> Output graph", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
      { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "custom.wgsl" } },
      { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
      { id: "e2", source: "mat-1", target: "out-1" },
    ]
    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    expect(result.queue).toHaveLength(2)
    expect(result.queue[0]).toEqual({ type: "mesh", geometry: "sphere" })
    expect(result.queue[1]).toEqual({ type: "material", shaderPath: "custom.wgsl", textureBindings: {} })
  })

  it("compiles graph with post-processing pass", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
      { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "default.wgsl" } },
      { id: "pp-1", position: { x: 200, y: 0 }, data: { type: "postprocess" } },
      { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
      { id: "e2", source: "mat-1", target: "pp-1" },
      { id: "e3", source: "pp-1", target: "out-1" },
    ]
    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    expect(result.queue).toHaveLength(3)
    expect(result.queue[0].type).toBe("mesh")
    expect(result.queue[1].type).toBe("material")
    expect(result.queue[2].type).toBe("postprocess")
  })

  it("fails when graph contains a dependency cycle", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
      { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "a.wgsl" } },
      { id: "mat-2", position: { x: 200, y: 0 }, data: { type: "material", shaderPath: "b.wgsl" } },
      { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
      { id: "e1b", source: "mesh-1", target: "mat-2", targetHandle: "mesh" },
      { id: "e2", source: "mat-1", target: "mat-2" },
      { id: "e3", source: "mat-2", target: "mat-1" }, // cycle!
      { id: "e4", source: "mat-2", target: "out-1" },
    ]
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("Cycle detected in node graph")
    expect(result.queue).toHaveLength(0)
  })

  it("ignores disconnected orphan material node when valid pipeline exists", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
      { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "default.wgsl" } },
      { id: "mat-orphan", position: { x: 100, y: 200 }, data: { type: "material", shaderPath: "scratch.wgsl" } },
      { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
      { id: "e2", source: "mat-1", target: "out-1" },
    ]
    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    expect(result.queue).toHaveLength(2)
  })
})
