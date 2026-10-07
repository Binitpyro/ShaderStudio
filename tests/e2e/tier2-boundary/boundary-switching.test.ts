import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
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

describe("Tier 2: Boundary & Corner Cases — Backend Switching", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("rapidly cycles WebGPU -> WebGL2 -> Three.js -> WebGPU within a single tick", async () => {
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const canvas = env.createCanvas()

    const gpu = new WebGPUAdapter()
    await gpu.mount(canvas as any)
    gpu.dispose()

    const gl2 = new WebGL2Adapter()
    await gl2.mount(canvas as any)
    gl2.dispose()

    const three = new ThreeJSAdapter()
    await three.mount(canvas as any)
    three.dispose()

    const gpu2 = new WebGPUAdapter()
    await gpu2.mount(canvas as any)

    expect(env.clock.activeCallbackCount).toBe(1)
    gpu2.dispose()
    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("switches backends while renderQueue has active post-processing steps", async () => {
    const { ThreeJSAdapter } = await import("@/adapters/threejs")
    const canvas = env.createCanvas()
    const queue = [
      { type: "mesh" as const, geometry: "cube" as const },
      { type: "postprocess" as const, pass: "passthrough" as const },
    ]

    const gl2 = new WebGL2Adapter()
    await gl2.mount(canvas as any)
    gl2.setRenderQueue(queue)
    env.clock.step(16)
    gl2.dispose()

    const three = new ThreeJSAdapter()
    await three.mount(canvas as any)
    three.setRenderQueue(queue)
    env.clock.step(16)
    three.dispose()

    expect(env.clock.activeCallbackCount).toBe(0)
  })

  it("preserves uniform values in store across 10 rapid backend toggles", () => {
    const store = useProjectStore.getState()
    store.setUniformValue("u_critical", { type: "float", value: 3.14159 })

    const backends = ["webgpu", "webgl2", "threejs"] as const
    for (let i = 0; i < 10; i++) {
      store.setActiveBackend(backends[i % 3])
      expect(useProjectStore.getState().uniformValues["u_critical"].value).toBe(3.14159)
    }
  })

  it("switches backends while shader recompilation error is present in store", async () => {
    const canvas = env.createCanvas()
    useProjectStore.getState().setLastCompileError("Shader error in backend 1")

    const adapter = new WebGL2Adapter()
    await adapter.mount(canvas as any)

    // Recompilation with valid shader should clear error
    adapter.recompileShader("void main() { fragColor = vec4(1.0); }")
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    adapter.dispose()
  })

  it("ensures zero orphaned animation frames remain after 20 mount/dispose cycles", async () => {
    const canvas = env.createCanvas()
    for (let i = 0; i < 20; i++) {
      const adapter = i % 2 === 0 ? new WebGL2Adapter() : new WebGPUAdapter()
      await adapter.mount(canvas as any)
      adapter.dispose()
    }
    expect(env.clock.activeCallbackCount).toBe(0)
  })
})
