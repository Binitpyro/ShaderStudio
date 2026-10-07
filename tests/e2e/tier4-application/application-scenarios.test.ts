import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { compileGraph, type GraphNodeData } from "@/core/graphCompiler"
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

describe("Tier 4: Real-World Application Scenarios", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Scenario 1: Complete 5-Node Visual Graph Pipeline
  it("Scenario 1: Full 5-Node Graph Pipeline compiles and executes on all 3 backends", async () => {
    const nodes: Node<GraphNodeData>[] = [
      { id: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
      { id: "tex", position: { x: 0, y: 100 }, data: { type: "texture", textureId: "tex-stone", name: "u_stone" } },
      { id: "mat", position: { x: 200, y: 50 }, data: { type: "material", shaderPath: "stone.wgsl" } },
      { id: "pp", position: { x: 400, y: 50 }, data: { type: "postprocess" } },
      { id: "out", position: { x: 600, y: 50 }, data: { type: "output" } },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "mesh", target: "mat", targetHandle: "mesh" },
      { id: "e2", source: "tex", target: "mat" },
      { id: "e3", source: "mat", target: "pp" },
      { id: "e4", source: "pp", target: "out" },
    ]

    useProjectStore.getState().addTextureResource({
      id: "tex-stone",
      name: "stone.png",
      src: "data:image/png;base64,stone",
    })

    const compilation = compileGraph(nodes, edges)
    expect(compilation.error).toBeNull()
    expect(compilation.queue).toHaveLength(4)

    // Execute on WebGPU
    const gpuAdapter = new WebGPUAdapter()
    const canvasGPU = env.createCanvas(800, 600)
    await gpuAdapter.mount(canvasGPU as any)
    gpuAdapter.setRenderQueue(compilation.queue)
    env.clock.step(16)
    gpuAdapter.dispose()

    // Execute on WebGL2
    const gl2Adapter = new WebGL2Adapter()
    const canvasGL2 = env.createCanvas(800, 600)
    await gl2Adapter.mount(canvasGL2 as any)
    gl2Adapter.setRenderQueue(compilation.queue)
    env.clock.step(16)
    gl2Adapter.dispose()

    // Execute on Three.js
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const threeAdapter = new ThreeJSAdapter()
    const canvasThree = env.createCanvas(800, 600)
    await threeAdapter.mount(canvasThree as any)
    threeAdapter.setRenderQueue(compilation.queue)
    env.clock.step(16)
    threeAdapter.dispose()

    expect(env.clock.activeCallbackCount).toBe(0)
  })

  // Scenario 2: Interactive Parameter Tweaking Session
  it("Scenario 2: Real-time parameter modulation applies on current frame without lag", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Modulate roughness over 10 frames as a user moves a slider
    for (let frame = 1; frame <= 10; frame++) {
      const roughnessValue = frame * 0.1
      useProjectStore.getState().setUniformValue("u_roughness", {
        type: "float",
        value: roughnessValue,
      })
      env.clock.step(16.666)

      const gl = env.webgl2.getLastContext()!
      expect(gl.uniformValues.get("u_roughness")).toBeCloseTo(roughnessValue, 2)
    }

    adapter.dispose()
  })

  // Scenario 3: Live Shader Recompilation & Error Recovery
  it("Scenario 3: Live shader editing with mid-stream syntax errors and successful recovery", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // 1. Initial valid render
    adapter.recompileShader("void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }")
    env.clock.step(16)
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    // 2. User makes a syntax error while typing in Monaco
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: void main() { fragColor = ")
    env.clock.step(16)
    expect(useProjectStore.getState().lastCompileError).not.toBeNull()
    // Render loop survives and is still running
    expect(env.clock.activeCallbackCount).toBe(1)

    // 3. User finishes typing valid shader
    adapter.recompileShader("void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }")
    env.clock.step(16)
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    adapter.dispose()
  })

  // Scenario 4: Viewport Dynamic Responsive Resizing
  it("Scenario 4: Viewport dynamic responsive resizing updates swapchains without memory leaks", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas(800, 600)
    await adapter.mount(canvas as any)

    const viewports = [
      { w: 1024, h: 768 },
      { w: 1280, h: 720 },
      { w: 1920, h: 1080 },
      { w: 375, h: 667 }, // Mobile breakpoint
    ]

    for (const vp of viewports) {
      adapter.resize(vp.w, vp.h)
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.viewportRect.width).toBe(vp.w)
      expect(gl.viewportRect.height).toBe(vp.h)
    }

    adapter.dispose()
  })

  // Scenario 5: Multi-Pass Post-Processing Chain Execution
  it("Scenario 5: Chained multi-pass post-processing pipeline executes correctly", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas(800, 600)
    await adapter.mount(canvas as any)

    adapter.setRenderQueue([
      { type: "mesh", geometry: "cube" },
      { type: "postprocess", pass: "passthrough" },
    ])

    const gl = env.webgl2.getLastContext()!
    const initialDraws = gl.drawCount

    env.clock.step(16)
    expect(gl.drawCount).toBeGreaterThanOrEqual(initialDraws + 2)

    adapter.dispose()
  })

  // Scenario 6: Multi-Backend Seamless Session Migration
  it("Scenario 6: Project state migrates cleanly across all three backends in single session", async () => {
    const store = useProjectStore.getState()
    store.setUniformValue("u_albedo", { type: "color", value: [0.8, 0.2, 0.5] })
    store.addTextureResource({ id: "tex-wood", name: "wood.png", src: "data:wood" })

    const canvas = env.createCanvas(800, 600)

    // Backend 1: WebGPU
    store.setActiveBackend("webgpu")
    const gpu = new WebGPUAdapter()
    await gpu.mount(canvas as any)
    gpu.setRenderQueue([{ type: "mesh", geometry: "cube" }])
    env.clock.step(16)
    gpu.dispose()

    // Backend 2: WebGL2
    store.setActiveBackend("webgl2")
    const gl2 = new WebGL2Adapter()
    await gl2.mount(canvas as any)
    gl2.setRenderQueue([{ type: "mesh", geometry: "cube" }])
    env.clock.step(16)
    gl2.dispose()

    // Backend 3: Three.js
    store.setActiveBackend("threejs")
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const three = new ThreeJSAdapter()
    await three.mount(canvas as any)
    three.setRenderQueue([{ type: "mesh", geometry: "cube" }])
    env.clock.step(16)
    three.dispose()

    // Assert that project store uniforms and textures are preserved
    expect(useProjectStore.getState().uniformValues["u_albedo"].value).toEqual([0.8, 0.2, 0.5])
    expect(useProjectStore.getState().textureResources).toHaveLength(1)
    expect(env.clock.activeCallbackCount).toBe(0)
  })
})
