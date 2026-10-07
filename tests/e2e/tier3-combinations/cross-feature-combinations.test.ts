import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"
import type { RenderStep } from "@/core/graphCompiler"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Tier 3: Cross-Feature Combinations (Pairwise Coverage)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  const backends = ["webgpu", "webgl2", "threejs"] as const
  const geometries = ["cube", "sphere", "plane"] as const

  // Matrix 1: Backend x Geometry Combinations (3 x 3 = 9 combinations)
  describe("Backend x Geometry Pairwise Tests", () => {
    for (const backend of backends) {
      for (const geometry of geometries) {
        it(`renders geometry '${geometry}' cleanly on backend '${backend}'`, async () => {
          const canvas = env.createCanvas(800, 600)
          let adapter: any

          if (backend === "webgpu") adapter = new WebGPUAdapter()
          else if (backend === "webgl2") adapter = new WebGL2Adapter()
          else {
            const { ThreeJSAdapter } = await import("@/adapters/threejs")
            adapter = new ThreeJSAdapter()
          }

          await adapter.mount(canvas as any)
          adapter.setRenderQueue([{ type: "mesh", geometry }])
          env.clock.step(16)

          expect(useProjectStore.getState().lastCompileError).toBeNull()
          adapter.dispose()
        })
      }
    }
  })

  // Matrix 2: Backend x Texture Count x Dynamic Uniforms
  describe("Backend x Texture Count x Uniforms Combinations", () => {
    const testCases = [
      { backend: "webgpu", textureCount: 0, uniforms: { u_speed: 1.5 } },
      { backend: "webgpu", textureCount: 1, uniforms: { color: [1, 0, 0] } },
      { backend: "webgpu", textureCount: 2, uniforms: { u_mvp: new Float32Array(16) } },
      { backend: "webgl2", textureCount: 0, uniforms: { u_roughness: 0.8 } },
      { backend: "webgl2", textureCount: 1, uniforms: { u_color: [0, 1, 0] } },
      { backend: "webgl2", textureCount: 2, uniforms: { u_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] } },
      { backend: "threejs", textureCount: 0, uniforms: { u_factor: 2.0 } },
      { backend: "threejs", textureCount: 1, uniforms: { color: [0, 0, 1] } },
      { backend: "threejs", textureCount: 2, uniforms: { u_tint: [1, 1, 0] } },
    ] as const

    for (const tc of testCases) {
      it(`runs backend '${tc.backend}' with ${tc.textureCount} textures and uniforms`, async () => {
        const canvas = env.createCanvas(640, 480)
        let adapter: any

        if (tc.backend === "webgpu") adapter = new WebGPUAdapter()
        else if (tc.backend === "webgl2") adapter = new WebGL2Adapter()
        else {
          const { ThreeJSAdapter } = await import("@/adapters/threejs")
          adapter = new ThreeJSAdapter()
        }

        await adapter.mount(canvas as any)

        const queue: RenderStep[] = [{ type: "mesh", geometry: "cube" }]
        for (let i = 0; i < tc.textureCount; i++) {
          const id = `tex-${tc.backend}-${i}`
          useProjectStore.getState().addTextureResource({ id, name: `tex${i}.png`, src: "data:image" })
          queue.push({ type: "texture", id, src: "data:image", binding: i })
        }
        adapter.setRenderQueue(queue)

        // Apply uniforms
        for (const [key, val] of Object.entries(tc.uniforms)) {
          const uniformType = Array.isArray(val) && val.length === 3 ? "color" : typeof val === "number" ? "float" : "mat4"
          useProjectStore.getState().setUniformValue(key, { type: uniformType as any, value: val })
          adapter.updateUniform(key, { type: uniformType as any, value: val })
        }

        env.clock.step(16)
        expect(useProjectStore.getState().lastCompileError).toBeNull()

        adapter.dispose()
      })
    }
  })

  // Matrix 3: Backend x Post-Processing Chains
  describe("Backend x Post-Processing Pass Combinations", () => {
    const postProcessConfigs = [
      { name: "no-postprocess", hasPP: false, passes: [] },
      { name: "single-vignette", hasPP: true, passes: [{ type: "postprocess" as const, pass: "passthrough" as const }] },
      { name: "chained-passes", hasPP: true, passes: [{ type: "postprocess" as const, pass: "passthrough" as const }, { type: "postprocess" as const, pass: "passthrough" as const }] },
    ]

    for (const backend of backends) {
      for (const config of postProcessConfigs) {
        it(`executes ${config.name} pipeline on ${backend}`, async () => {
          const canvas = env.createCanvas()
          let adapter: any

          if (backend === "webgpu") adapter = new WebGPUAdapter()
          else if (backend === "webgl2") adapter = new WebGL2Adapter()
          else {
            const { ThreeJSAdapter } = await import("@/adapters/threejs")
            adapter = new ThreeJSAdapter()
          }

          await adapter.mount(canvas as any)

          const queue: RenderStep[] = [
            { type: "mesh", geometry: "sphere" },
            { type: "material", shaderPath: "default.wgsl", textureBindings: {} },
            ...config.passes,
          ]
          adapter.setRenderQueue(queue)
          env.clock.step(16)

          expect(useProjectStore.getState().lastCompileError).toBeNull()
          adapter.dispose()
        })
      }
    }
  })

  // Matrix 4: Backend x Dynamic Viewport Resizing during Active Render Loop
  describe("Backend x Resize during Active Render Loop", () => {
    for (const backend of backends) {
      it(`handles multiple resizes during active render loop on ${backend}`, async () => {
        const canvas = env.createCanvas(400, 300)
        let adapter: any

        if (backend === "webgpu") adapter = new WebGPUAdapter()
        else if (backend === "webgl2") adapter = new WebGL2Adapter()
        else {
          const { ThreeJSAdapter } = await import("@/adapters/threejs")
          adapter = new ThreeJSAdapter()
        }

        await adapter.mount(canvas as any)
        adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])

        env.clock.step(16)
        adapter.resize(800, 600)
        env.clock.step(16)
        adapter.resize(1280, 720)
        env.clock.step(16)

        expect(useProjectStore.getState().lastCompileError).toBeNull()
        adapter.dispose()
      })
    }
  })
})
