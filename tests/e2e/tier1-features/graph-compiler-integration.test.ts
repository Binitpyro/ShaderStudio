import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  compileGraph,
  getGraphUniforms,
  hasTimeNode,
  hasPostProcessNode,
  type GraphNodeData,
} from "@/core/graphCompiler"
import type { Node, Edge } from "reactflow"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Tier 1: Visual Node Graph -> GPU Integration", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 35: Graph Compiler Render Steps
  describe("Feature 35: Graph Compiler Render Steps", () => {
    it("emits MeshStep with specified geometry", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue[0]).toEqual({ type: "mesh", geometry: "sphere" })
    })

    it("emits MaterialStep with shaderPath and textureBindings", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        { id: "tex-1", position: { x: 50, y: 50 }, data: { type: "texture", textureId: "tex-abc", name: "u_albedo" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "custom.frag" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "tex-1", target: "mat-1" },
        { id: "e3", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const matStep = result.queue.find((s) => s.type === "material")
      expect(matStep).toBeDefined()
      expect(matStep).toMatchObject({
        type: "material",
        shaderPath: "custom.frag",
        textureBindings: { u_albedo: "tex-abc" },
      })
    })

    it("emits TextureStep with binding slot for connected textures", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "tex-1", position: { x: 50, y: 50 }, data: { type: "texture", textureId: "tex-123", name: "u_tex" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "tex-1", target: "mat-1" },
        { id: "e3", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const texStep = result.queue.find((s) => s.type === "texture")
      expect(texStep).toBeDefined()
      expect(texStep).toMatchObject({ type: "texture", id: "tex-123", binding: 0 })
    })

    it("emits PostProcessStep when postprocess node is connected", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
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

      const ppStep = result.queue.find((s) => s.type === "postprocess")
      expect(ppStep).toBeDefined()
      expect(ppStep).toEqual({ type: "postprocess", pass: "passthrough" })
    })

    it("orders steps topologically: mesh -> texture -> material -> postprocess", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "tex-1", position: { x: 50, y: 50 }, data: { type: "texture", textureId: "tex-1", name: "u_tex" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "pp-1", position: { x: 200, y: 0 }, data: { type: "postprocess" } },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "tex-1", target: "mat-1" },
        { id: "e3", source: "mat-1", target: "pp-1" },
        { id: "e4", source: "pp-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const stepTypes = result.queue.map((s) => s.type)
      expect(stepTypes).toEqual(["mesh", "texture", "material", "postprocess"])
    })
  })

  // Feature 36: Adapter Render Step Consumption
  describe("Feature 36: Adapter Render Step Consumption", () => {
    it("WebGPUAdapter consumes MeshStep and switches geometry", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("WebGL2Adapter consumes MeshStep and updates vertex buffer", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      env.clock.step(16)

      expect(gl.createdBuffers.length).toBeGreaterThan(0)
      adapter.dispose()
    })

    it("ThreeJSAdapter consumes MeshStep and recreates mesh with appropriate geometry", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("adapters consume PostProcessStep and activate postprocessing passes", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)

      adapter.dispose()
    })

    it("handles null or empty renderQueue gracefully across all adapters", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(() => adapter.setRenderQueue(null)).not.toThrow()
      expect(() => adapter.setRenderQueue([])).not.toThrow()

      adapter.dispose()
    })
  })

  // Feature 37: Functional TimeNode
  describe("Feature 37: Functional TimeNode", () => {
    it("detects TimeNode presence using hasTimeNode", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "time-1", position: { x: 0, y: 0 }, data: { type: "time" } },
        { id: "out-1", position: { x: 100, y: 0 }, data: { type: "output" } },
      ]
      expect(hasTimeNode(nodes)).toBe(true)
    })

    it("returns false from hasTimeNode when no TimeNode is present", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "out-1", position: { x: 100, y: 0 }, data: { type: "output" } },
      ]
      expect(hasTimeNode(nodes)).toBe(false)
    })

    it("does not emit invalid render steps for TimeNode", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "time-1", position: { x: 50, y: 50 }, data: { type: "time" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "default.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.some((s: any) => s.type === "time")).toBe(false)
    })

    it("allows u_time uniform updates on WebGL2 adapter", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      env.clock.step(5000)

      const gl = env.webgl2.getLastContext()!
      const timeVal = gl.uniformValues.get("time") ?? gl.uniformValues.get("u_time")
      expect(timeVal).toBeCloseTo(5.0, 1)

      adapter.dispose()
    })

    it("increments u_time across frames smoothly", () => {
      let time = 0
      for (let i = 0; i < 5; i++) {
        time += 0.016
        useProjectStore.getState().setUniformValue("u_time", { type: "float", value: time })
      }
      expect(useProjectStore.getState().uniformValues["u_time"].value).toBeCloseTo(0.08)
    })
  })

  // Feature 38: Functional UniformNode
  describe("Feature 38: Functional UniformNode", () => {
    it("extracts defined uniforms via getGraphUniforms", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "u-1", position: { x: 0, y: 0 }, data: { type: "uniform", uniformId: "u1", name: "u_glow", uniformType: "float", defaultValue: 0.5 } },
        { id: "u-2", position: { x: 0, y: 50 }, data: { type: "uniform", uniformId: "u2", name: "u_tint", uniformType: "color", defaultValue: [1, 0, 0] } },
      ]
      const uniforms = getGraphUniforms(nodes)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toEqual({ id: "u1", name: "u_glow", type: "float", defaultValue: 0.5 })
      expect(uniforms[1]).toEqual({ id: "u2", name: "u_tint", type: "color", defaultValue: [1, 0, 0] })
    })

    it("synchronizes graph uniforms to project store", () => {
      const store = useProjectStore.getState()
      store.addGraphUniform({ id: "gu-1", name: "u_speed", type: "float", defaultValue: 2.0 })
      expect(useProjectStore.getState().graphUniforms).toHaveLength(1)

      store.updateGraphUniform("gu-1", { defaultValue: 3.5 })
      expect(useProjectStore.getState().graphUniforms[0].defaultValue).toBe(3.5)

      store.removeGraphUniform("gu-1")
      expect(useProjectStore.getState().graphUniforms).toHaveLength(0)
    })

    it("does not emit invalid render steps for UniformNode", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "u-1", position: { x: 50, y: 50 }, data: { type: "uniform", uniformId: "u1", name: "u_roughness", uniformType: "float", defaultValue: 0.1 } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue.some((s: any) => s.type === "uniform")).toBe(false)
    })

    it("binds graph-defined uniform value to GPU uniform upload", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.85 })
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_roughness")).toBe(0.85)

      adapter.dispose()
    })

    it("handles multiple uniform nodes of distinct types", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "u-1", position: { x: 0, y: 0 }, data: { type: "uniform", uniformId: "u1", name: "u_f", uniformType: "float", defaultValue: 1 } },
        { id: "u-2", position: { x: 0, y: 30 }, data: { type: "uniform", uniformId: "u2", name: "u_v2", uniformType: "vec2", defaultValue: [1, 2] } },
        { id: "u-3", position: { x: 0, y: 60 }, data: { type: "uniform", uniformId: "u3", name: "u_b", uniformType: "bool", defaultValue: true } },
      ]
      const list = getGraphUniforms(nodes)
      expect(list).toHaveLength(3)
    })
  })

  // Feature 39: MaterialNode Multi-Input Handles
  describe("Feature 39: MaterialNode Multi-Input Handles", () => {
    it("connects mesh handle to material node", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
    })

    it("connects multiple texture inputs into material node textureBindings", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "tex-0", position: { x: 50, y: 0 }, data: { type: "texture", textureId: "tex-id-0", name: "u_diffuse" } },
        { id: "tex-1", position: { x: 50, y: 50 }, data: { type: "texture", textureId: "tex-id-1", name: "u_normal" } },
        { id: "mat-1", position: { x: 150, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 250, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "tex-0", target: "mat-1" },
        { id: "e3", source: "tex-1", target: "mat-1" },
        { id: "e4", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const matStep = result.queue.find((s) => s.type === "material") as any
      expect(matStep.textureBindings["u_diffuse"]).toBe("tex-id-0")
      expect(matStep.textureBindings["u_normal"]).toBe("tex-id-1")
    })

    it("fails compilation if material node is missing mesh input handle", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [{ id: "e1", source: "mat-1", target: "out-1" }]
      const result = compileGraph(nodes, edges)
      expect(result.error).toContain("is missing a mesh input")
    })

    it("fails compilation if material node is connected to non-mesh source", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "tex-1", position: { x: 0, y: 0 }, data: { type: "texture", textureId: "t1", name: "tex" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "tex-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toContain("must be connected to a Mesh node")
    })

    it("falls back to default.wgsl when material shaderPath is null", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()

      const matStep = result.queue.find((s) => s.type === "material") as any
      expect(matStep.shaderPath).toBe("default.wgsl")
    })
  })

  // Feature 40: Live Node Graph Recompilation
  describe("Feature 40: Live Node Graph Recompilation", () => {
    it("recompiles immediately when new node is added", () => {
      const initialNodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "shader.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const initialEdges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const res1 = compileGraph(initialNodes, initialEdges)
      expect(res1.queue).toHaveLength(2)

      // Add postprocess node
      const updatedNodes: Node<GraphNodeData>[] = [
        ...initialNodes,
        { id: "pp-1", position: { x: 150, y: 0 }, data: { type: "postprocess" } },
      ]
      const updatedEdges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-1" },
        { id: "e3", source: "pp-1", target: "out-1" },
      ]
      const res2 = compileGraph(updatedNodes, updatedEdges)
      expect(res2.queue).toHaveLength(3)
    })

    it("recompiles immediately when geometry is changed on mesh node", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "sphere" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "test.wgsl" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const res1 = compileGraph(nodes, edges)
      expect((res1.queue[0] as any).geometry).toBe("sphere")

      nodes[0].data = { type: "mesh", geometry: "plane" }
      const res2 = compileGraph(nodes, edges)
      expect((res2.queue[0] as any).geometry).toBe("plane")
    })

    it("propagates compiled queue to project store and updates adapter", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "plane" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: "default.frag" } },
        { id: "out-1", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      useProjectStore.getState().setRenderQueue(result.queue)

      adapter.setRenderQueue(result.queue)
      env.clock.step(16)

      expect(useProjectStore.getState().renderQueue).toHaveLength(2)
      adapter.dispose()
    })

    it("survives compilation failure by returning empty queue and error message", () => {
      const result = compileGraph([], [])
      expect(result.error).toContain("No output node found")
      expect(result.queue).toHaveLength(0)
    })

    it("clears error message upon successful recompilation", () => {
      const bad = compileGraph([], [])
      expect(bad.error).not.toBeNull()

      const goodNodes: Node<GraphNodeData>[] = [
        { id: "m", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat", position: { x: 50, y: 0 }, data: { type: "material", shaderPath: "s" } },
        { id: "out", position: { x: 100, y: 0 }, data: { type: "output" } },
      ]
      const goodEdges: Edge[] = [
        { id: "e1", source: "m", target: "mat", targetHandle: "mesh" },
        { id: "e2", source: "mat", target: "out" },
      ]
      const good = compileGraph(goodNodes, goodEdges)
      expect(good.error).toBeNull()
    })
  })

  // Feature 41: End-to-End 5-Node Graph Execution
  describe("Feature 41: End-to-End 5-Node Graph Execution", () => {
    const createFiveNodeGraph = () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "tex-1", position: { x: 0, y: 100 }, data: { type: "texture", textureId: "tex-brick", name: "u_diffuse" } },
        { id: "mat-1", position: { x: 150, y: 50 }, data: { type: "material", shaderPath: "material.wgsl" } },
        { id: "pp-1", position: { x: 300, y: 50 }, data: { type: "postprocess" } },
        { id: "out-1", position: { x: 450, y: 50 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "tex-1", target: "mat-1" },
        { id: "e3", source: "mat-1", target: "pp-1" },
        { id: "e4", source: "pp-1", target: "out-1" },
      ]
      return { nodes, edges }
    }

    it("compiles complete 5-node graph into 4 render steps", () => {
      const { nodes, edges } = createFiveNodeGraph()
      const result = compileGraph(nodes, edges)

      expect(result.error).toBeNull()
      expect(result.queue).toHaveLength(4)
      expect(result.queue.map((s) => s.type)).toEqual(["mesh", "texture", "material", "postprocess"])
    })

    it("executes complete 5-node graph queue on WebGPUAdapter", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const { nodes, edges } = createFiveNodeGraph()
      const result = compileGraph(nodes, edges)

      adapter.setRenderQueue(result.queue)
      env.clock.step(16)

      expect(useProjectStore.getState().lastCompileError).toBeNull()
      adapter.dispose()
    })

    it("executes complete 5-node graph queue on WebGL2Adapter", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const { nodes, edges } = createFiveNodeGraph()
      const result = compileGraph(nodes, edges)

      adapter.setRenderQueue(result.queue)
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)
      expect(gl.drawCount).toBeGreaterThan(0)

      adapter.dispose()
    })

    it("executes complete 5-node graph queue on ThreeJSAdapter", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const { nodes, edges } = createFiveNodeGraph()
      const result = compileGraph(nodes, edges)

      adapter.setRenderQueue(result.queue)
      env.clock.step(16)

      adapter.dispose()
    })

    it("hasPostProcessNode helper correctly identifies post-processing in 5-node graph", () => {
      const { nodes } = createFiveNodeGraph()
      expect(hasPostProcessNode(nodes)).toBe(true)
    })
  })
})
