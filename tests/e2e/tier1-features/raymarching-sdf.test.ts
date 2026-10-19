import { describe, it, expect } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import {
  compileGraph,
  buildSdfTree,
  hasRaymarchNode,
  type GraphNodeData,
} from "@/core/graphCompiler"
import { SHADER_TEMPLATES } from "@/core/templates"
import { DEFAULT_PRIMITIVE_PARAMS } from "@/core/sdf/sdfPrimitives"
import { DEFAULT_OPERATOR_PARAMS } from "@/core/sdf/sdfOperators"

describe("Tier 1: Visual Raymarching & SDF Procedural Geometry", () => {
  it("compiles a single SDF primitive into raymarching render step with plane mesh", () => {
    const nodes: Node<GraphNodeData>[] = [
      {
        id: "prim-1",
        type: "sdf_primitive",
        position: { x: 0, y: 0 },
        data: {
          type: "sdf_primitive",
          primitiveType: "sphere",
          params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, radius: 1.25 },
        },
      },
      {
        id: "raymarch-1",
        type: "raymarch",
        position: { x: 200, y: 0 },
        data: {
          type: "raymarch",
          maxSteps: 96,
          maxDistance: 35.0,
          enableShadows: true,
          enableAo: true,
        },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 400, y: 0 },
        data: { type: "output" },
      },
    ]

    const edges: Edge[] = [
      { id: "e1", source: "prim-1", target: "raymarch-1", sourceHandle: "sdf", targetHandle: "scene" },
      { id: "e2", source: "raymarch-1", target: "output-1", sourceHandle: "output", targetHandle: null },
    ]

    expect(hasRaymarchNode(nodes)).toBe(true)

    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    expect(result.queue.length).toBeGreaterThanOrEqual(2)

    // First step is full-screen quad mesh
    const meshStep = result.queue.find((s) => s.type === "mesh")
    expect(meshStep).toBeDefined()
    expect((meshStep as any).geometry).toBe("plane")

    // Second step is raymarch with generated shaders
    const raymarchStep = result.queue.find((s) => s.type === "raymarch")
    expect(raymarchStep).toBeDefined()
    if (raymarchStep && raymarchStep.type === "raymarch") {
      expect(raymarchStep.glslSource).toContain("#version 300 es")
      expect(raymarchStep.glslSource).toContain("sdSphere")
      expect(raymarchStep.glslSource).toContain("1.2500")
      expect(raymarchStep.wgslSource).toContain("@fragment")
      expect(raymarchStep.wgslSource).toContain("sdSphere")
    }
  })

  it("compiles composite boolean SDF tree (Metaball fusion: Sphere A + Sphere B -> Smooth Union)", () => {
    const nodes: Node<GraphNodeData>[] = [
      {
        id: "sphere-a",
        type: "sdf_primitive",
        position: { x: 0, y: 0 },
        data: {
          type: "sdf_primitive",
          primitiveType: "sphere",
          params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, offset: [-0.75, 0, 0], radius: 0.9 },
        },
      },
      {
        id: "sphere-b",
        type: "sdf_primitive",
        position: { x: 0, y: 150 },
        data: {
          type: "sdf_primitive",
          primitiveType: "sphere",
          params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, offset: [0.75, 0, 0], radius: 0.9 },
        },
      },
      {
        id: "op-smooth",
        type: "sdf_operator",
        position: { x: 250, y: 75 },
        data: {
          type: "sdf_operator",
          operatorType: "smooth_union",
          params: { ...DEFAULT_OPERATOR_PARAMS.smooth_union, smoothness: 0.3 },
        },
      },
      {
        id: "raymarch-1",
        type: "raymarch",
        position: { x: 450, y: 75 },
        data: { type: "raymarch" },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 650, y: 75 },
        data: { type: "output" },
      },
    ]

    const edges: Edge[] = [
      { id: "e1", source: "sphere-a", target: "op-smooth", sourceHandle: "sdf", targetHandle: "a" },
      { id: "e2", source: "sphere-b", target: "op-smooth", sourceHandle: "sdf", targetHandle: "b" },
      { id: "e3", source: "op-smooth", target: "raymarch-1", sourceHandle: "sdf", targetHandle: "scene" },
      { id: "e4", source: "raymarch-1", target: "output-1", sourceHandle: "output", targetHandle: null },
    ]

    // Verify SDF AST construction
    const tree = buildSdfTree("op-smooth", nodes, edges)
    expect(tree.kind).toBe("operator")
    if (tree.kind === "operator") {
      expect(tree.type).toBe("smooth_union")
      expect(tree.children.length).toBe(2)
      expect(tree.children[0].kind).toBe("primitive")
      expect(tree.children[1].kind).toBe("primitive")
    }

    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    const raymarchStep = result.queue.find((s) => s.type === "raymarch")
    expect(raymarchStep).toBeDefined()
    if (raymarchStep && raymarchStep.type === "raymarch") {
      expect(raymarchStep.glslSource).toContain("opSmoothUnion")
      expect(raymarchStep.wgslSource).toContain("opSmoothUnion")
    }
  })

  it("supports connecting Raymarch engine into Material node pipeline", () => {
    const nodes: Node<GraphNodeData>[] = [
      {
        id: "raymarch-1",
        type: "raymarch",
        position: { x: 100, y: 100 },
        data: { type: "raymarch" },
      },
      {
        id: "mat-1",
        type: "material",
        position: { x: 300, y: 100 },
        data: { type: "material", shaderPath: null },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 500, y: 100 },
        data: { type: "output" },
      },
    ]

    const edges: Edge[] = [
      { id: "e1", source: "raymarch-1", target: "mat-1", sourceHandle: "output", targetHandle: "mesh" },
      { id: "e2", source: "mat-1", target: "output-1", sourceHandle: null, targetHandle: null },
    ]

    const result = compileGraph(nodes, edges)
    expect(result.error).toBeNull()
    const matStep = result.queue.find((s) => s.type === "material")
    expect(matStep).toBeDefined()
  })

  it("detects cycle in SDF operator node graphs gracefully", () => {
    const nodes: Node<GraphNodeData>[] = [
      {
        id: "op-1",
        type: "sdf_operator",
        position: { x: 0, y: 0 },
        data: { type: "sdf_operator", operatorType: "union", params: { type: "union" } },
      },
      {
        id: "op-2",
        type: "sdf_operator",
        position: { x: 200, y: 0 },
        data: { type: "sdf_operator", operatorType: "union", params: { type: "union" } },
      },
      {
        id: "raymarch-1",
        type: "raymarch",
        position: { x: 400, y: 0 },
        data: { type: "raymarch" },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 600, y: 0 },
        data: { type: "output" },
      },
    ]

    // Create cycle: op-1 -> op-2 -> op-1
    const edges: Edge[] = [
      { id: "e1", source: "op-1", target: "op-2", sourceHandle: "sdf", targetHandle: "a" },
      { id: "e2", source: "op-2", target: "op-1", sourceHandle: "sdf", targetHandle: "a" },
      { id: "e3", source: "op-2", target: "raymarch-1", sourceHandle: "sdf", targetHandle: "scene" },
      { id: "e4", source: "raymarch-1", target: "output-1", sourceHandle: "output", targetHandle: null },
    ]

    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("Cycle detected")
    expect(result.queue).toHaveLength(0)
  })

  it("verifies built-in SDF raymarching shader templates in SHADER_TEMPLATES", () => {
    const sdfTemplates = SHADER_TEMPLATES.filter((t) => t.category === "Raymarching & SDF")
    expect(sdfTemplates.length).toBe(3)

    const ids = sdfTemplates.map((t) => t.id)
    expect(ids).toContain("sdf-metaball-fusion")
    expect(ids).toContain("sdf-twisted-torus")
    expect(ids).toContain("sdf-infinite-columns")

    for (const tmpl of sdfTemplates) {
      expect(tmpl.shaderSource.length).toBeGreaterThan(100)
      expect(tmpl.shaderSource).toContain("float map(vec3 p)")
      expect(tmpl.shaderSource).toContain("calcNormal")
      expect(tmpl.shaderSource).toContain("fragColor =")
      expect(tmpl.geometry).toBe("plane")
    }
  })
})
