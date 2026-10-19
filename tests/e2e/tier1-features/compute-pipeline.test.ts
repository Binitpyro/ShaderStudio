import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import {
  compileGraph,
  hasComputeNode,
  type GraphNodeData,
  type ComputeStep,
} from "@/core/graphCompiler"
import { getComputePresetCode, webgpuAdapter } from "@/adapters/webgpu"
import { useProjectStore } from "@/stores/projectStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, type E2ETestEnvironment } from "../mocks"

describe("WebGPU Compute Pipeline & Simulation Suite", () => {
  let env: E2ETestEnvironment

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().setComputeShaderSource("")
    useProjectStore.getState().setActiveEditorTab("render")
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  describe("Graph Compiler with ComputeNode", () => {
    it("compiles ComputeNode -> MaterialNode -> OutputNode successfully", () => {
      const nodes: Node<GraphNodeData>[] = [
        {
          id: "comp-1",
          type: "compute",
          position: { x: 0, y: 0 },
          data: {
            type: "compute",
            preset: "curl_noise",
            particleCount: 50000,
            params: { speed: 1.5, damping: 0.98 },
          },
        },
        {
          id: "mat-1",
          type: "material",
          position: { x: 200, y: 0 },
          data: { type: "material", shaderPath: "default.wgsl" },
        },
        {
          id: "out-1",
          type: "output",
          position: { x: 400, y: 0 },
          data: { type: "output" },
        },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "comp-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue).toHaveLength(2)

      const computeStep = result.queue[0] as ComputeStep
      expect(computeStep.type).toBe("compute")
      expect(computeStep.preset).toBe("curl_noise")
      expect(computeStep.particleCount).toBe(50000)
      expect(computeStep.params.speed).toBe(1.5)

      expect(result.queue[1].type).toBe("material")
    })

    it("detects ComputeNode presence with hasComputeNode helper", () => {
      const nodesWithCompute: Node<GraphNodeData>[] = [
        { id: "c1", type: "compute", position: { x: 0, y: 0 }, data: { type: "compute", preset: "boids", particleCount: 25000 } },
        { id: "out-1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]
      const nodesWithoutCompute: Node<GraphNodeData>[] = [
        { id: "m1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "out-1", type: "output", position: { x: 200, y: 0 }, data: { type: "output" } },
      ]

      expect(hasComputeNode(nodesWithCompute)).toBe(true)
      expect(hasComputeNode(nodesWithoutCompute)).toBe(false)
    })

    it("topologically orders Compute -> Material -> PostProcess in the queue", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "comp-1", type: "compute", position: { x: 0, y: 0 }, data: { type: "compute", preset: "galaxy", particleCount: 100000 } },
        { id: "mat-1", type: "material", position: { x: 200, y: 0 }, data: { type: "material", shaderPath: "default.wgsl" } },
        { id: "pp-1", type: "postprocess", position: { x: 400, y: 0 }, data: { type: "postprocess", passType: "bloom" } },
        { id: "out-1", type: "output", position: { x: 600, y: 0 }, data: { type: "output" } },
      ]

      const edges: Edge[] = [
        { id: "e1", source: "comp-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-1" },
        { id: "e3", source: "pp-1", target: "out-1" },
      ]

      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      expect(result.queue).toHaveLength(3)
      expect(result.queue[0].type).toBe("compute")
      expect(result.queue[1].type).toBe("material")
      expect(result.queue[2].type).toBe("postprocess")
    })
  })

  describe("Simulation Presets & Code Generation", () => {
    it("returns valid WGSL shader source for all simulation presets", () => {
      const presets = ["curl_noise", "gravity", "boids", "galaxy", "custom"] as const
      for (const p of presets) {
        const code = getComputePresetCode(p)
        expect(code).toBeDefined()
        expect(code).toContain("@compute")
        expect(code).toContain("@workgroup_size")
        expect(code).toContain("struct Particle")
        expect(code).toContain("struct SimParams")
      }
    })

    it("respects custom compute source when preset is custom", () => {
      const customWGSL = "@compute @workgroup_size(64) fn main() { /* custom logic */ }"
      const code = getComputePresetCode("custom", customWGSL)
      expect(code).toBe(customWGSL)
    })
  })

  describe("Project Store Compute Integration & Serialization", () => {
    it("updates and retrieves compute shader source and active editor tabs", () => {
      const store = useProjectStore.getState()
      expect(store.activeEditorTab).toBe("render")

      store.setActiveEditorTab("compute")
      expect(useProjectStore.getState().activeEditorTab).toBe("compute")

      store.setComputeShaderSource("/* compute code */")
      expect(useProjectStore.getState().computeShaderSource).toBe("/* compute code */")
    })

    it("increments simulationResetTrigger on demand", () => {
      const initial = useProjectStore.getState().simulationResetTrigger
      useProjectStore.getState().triggerSimulationReset()
      expect(useProjectStore.getState().simulationResetTrigger).toBe(initial + 1)
    })

    it("serializes and restores compute shader source in project exports", () => {
      const store = useProjectStore.getState()
      store.setComputeShaderSource("@compute fn test() {}")
      store.setCurrentProjectName("ComputeProject")

      const exported = store.exportProjectData()
      expect(exported.shaderSources.compute).toBe("@compute fn test() {}")

      // Clear and reload
      store.setComputeShaderSource("")
      store.loadProjectData(exported)
      expect(useProjectStore.getState().computeShaderSource).toBe("@compute fn test() {}")
    })
  })

  describe("WebGPU Adapter Compute Execution", () => {
    it("mounts adapter and sets up compute queue without error", async () => {
      const canvas = env.createCanvas()
      const mounted = await webgpuAdapter.mount(canvas as any)
      expect(mounted).toBe(true)

      const queue = [
        {
          type: "compute" as const,
          id: "comp-1",
          preset: "curl_noise" as const,
          particleCount: 10000,
          params: { speed: 1.2, damping: 0.95, strength: 2.0, pointSize: 5.0 },
        },
        {
          type: "material" as const,
          shaderPath: "default.wgsl",
          textureBindings: {},
        },
      ]

      expect(() => webgpuAdapter.setRenderQueue(queue)).not.toThrow()
    })

    it("updates compute simulation uniforms and triggers re-seed", async () => {
      const canvas = env.createCanvas()
      await webgpuAdapter.mount(canvas as any)

      expect(() => {
        webgpuAdapter.updateComputeUniform?.("speed", 2.5)
        webgpuAdapter.updateComputeUniform?.("damping", 0.99)
        webgpuAdapter.updateComputeUniform?.("pointSize", 8.0)
        webgpuAdapter.reseedSimulation?.()
      }).not.toThrow()
    })

    it("recompiles custom compute shaders cleanly", async () => {
      const canvas = env.createCanvas()
      await webgpuAdapter.mount(canvas as any)

      const customWGSL = `
        struct Particle { position: vec3<f32>, life: f32, velocity: vec3<f32>, mass: f32 };
        struct SimParams { deltaTime: f32, time: f32, speed: f32, damping: f32, strength: f32, particleCount: f32, noiseScale: f32, reset: f32 };
        @group(0) @binding(0) var<uniform> params: SimParams;
        @group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {}
      `

      expect(() => webgpuAdapter.recompileComputeShader?.(customWGSL)).not.toThrow()
    })
  })
})
