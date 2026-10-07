import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { compileGraph, type GraphNodeData } from "@/core/graphCompiler"
import type { Node, Edge } from "reactflow"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 2: Boundary & Corner Cases — Error Handling & Recovery", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles malformed WGSL shader syntax by setting lastCompileError and keeping loop alive", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: invalid wgsl code @@@")
    expect(useProjectStore.getState().lastCompileError).toContain("Invalid syntax")
    expect(env.clock.activeCallbackCount).toBe(1)

    adapter.dispose()
  })

  it("handles malformed GLSL shader syntax by setting lastCompileError and keeping loop alive", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: invalid glsl ;;;")
    expect(useProjectStore.getState().lastCompileError).toContain("Fragment shader error")
    expect(env.clock.activeCallbackCount).toBe(1)

    adapter.dispose()
  })

  it("recovers cleanly when fixed shader is recompiled after error", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Trigger error
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: broken")
    expect(useProjectStore.getState().lastCompileError).not.toBeNull()

    // Fix error
    adapter.recompileShader("void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }")
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    adapter.dispose()
  })

  it("fails compilation when graph has missing output node", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
    ]
    const edges: Edge[] = []
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("No output node found")
    expect(result.queue).toHaveLength(0)
  })

  it("fails compilation when graph has multiple output nodes", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "out-1", position: { x: 0, y: 0 }, data: { type: "output" } },
      { id: "out-2", position: { x: 100, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = []
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("Multiple output nodes found")
    expect(result.queue).toHaveLength(0)
  })

  it("fails compilation when material node is disconnected from mesh node", () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mat-1", position: { x: 0, y: 0 }, data: { type: "material", shaderPath: "shader.wgsl" } },
      { id: "out-1", position: { x: 100, y: 0 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [{ id: "e1", source: "mat-1", target: "out-1" }]
    const result = compileGraph(nodes, edges)
    expect(result.error).toContain("is missing a mesh input")
  })
})
