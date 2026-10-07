import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockGPUDevice } from "../mocks"
import { compileGraph } from "@/core/graphCompiler"
import {
  buildPostProcessChain,
  PASSTHROUGH_FRAGMENT,
  CHROMATIC_ABERRATION_FRAGMENT,
  BLOOM_FRAGMENT,
  CUSTOM_WGSL_TEMPLATE,
  CUSTOM_GLSL_TEMPLATE,
  type PostProcessPassType,
} from "@/core/postProcessChain"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import type { Node, Edge } from "reactflow"
import type { GraphNodeData } from "@/core/graphCompiler"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Post-Processing Suite: Multi-Backend & Multi-Pass", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  describe("Graph Compiler PostProcess Node Integration", () => {
    it("emits exact legacy passthrough step when node is unconfigured", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
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
      expect(ppStep).toEqual({ type: "postprocess", pass: "passthrough" })
    })

    it("emits rich postprocess step with id, passType, and params when configured", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        {
          id: "pp-chroma",
          position: { x: 200, y: 0 },
          data: {
            type: "postprocess",
            passType: "chromatic_aberration",
            params: { aberrationOffset: 0.015 },
          },
        },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-chroma" },
        { id: "e3", source: "pp-chroma", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      const ppStep = result.queue.find((s) => s.type === "postprocess")
      expect(ppStep).toEqual({
        type: "postprocess",
        id: "pp-chroma",
        pass: "chromatic_aberration",
        customSource: undefined,
        uniforms: { aberrationOffset: 0.015 },
      })
    })

    it("orders chained multiple post-processing passes sequentially", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        {
          id: "pp-1",
          position: { x: 200, y: 0 },
          data: { type: "postprocess", passType: "vignette", params: { intensity: 0.6 } },
        },
        {
          id: "pp-2",
          position: { x: 300, y: 0 },
          data: { type: "postprocess", passType: "bloom", params: { bloomIntensity: 0.8 } },
        },
        {
          id: "pp-3",
          position: { x: 400, y: 0 },
          data: { type: "postprocess", passType: "blur", params: { blurAmount: 3.0 } },
        },
        { id: "out-1", position: { x: 500, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-1" },
        { id: "e3", source: "pp-1", target: "pp-2" },
        { id: "e4", source: "pp-2", target: "pp-3" },
        { id: "e5", source: "pp-3", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      const ppSteps = result.queue.filter((s) => s.type === "postprocess")
      expect(ppSteps).toHaveLength(3)
      expect(ppSteps[0].pass).toBe("vignette")
      expect(ppSteps[1].pass).toBe("bloom")
      expect(ppSteps[2].pass).toBe("blur")
    })
  })

  describe("Post-Process Chain Core Utilities & Shaders", () => {
    it("contains valid shader templates and GLSL source fragments", () => {
      expect(PASSTHROUGH_FRAGMENT).toContain("out vec4 fragColor;")
      expect(CHROMATIC_ABERRATION_FRAGMENT).toContain("u_aberrationOffset")
      expect(BLOOM_FRAGMENT).toContain("u_bloomThreshold")
      expect(BLOOM_FRAGMENT).toContain("u_bloomIntensity")
      expect(CUSTOM_WGSL_TEMPLATE).toContain("fn fragment_main")
      expect(CUSTOM_GLSL_TEMPLATE).toContain("void main()")
    })

    it("builds correct chain passes for all 5 pass types", () => {
      const passTypes: PostProcessPassType[] = [
        "vignette",
        "blur",
        "chromatic_aberration",
        "bloom",
        "custom",
      ]
      const steps = passTypes.map((pass, i) => ({
        type: "postprocess" as const,
        id: `pp-${i}`,
        pass,
        customSource: pass === "custom" ? "void main() { fragColor = vec4(1.0); }" : undefined,
        uniforms: { testVal: 1.0 },
      }))

      const chain = buildPostProcessChain(steps)
      expect(chain).toHaveLength(5)
      expect(chain.map((p) => p.type)).toEqual(passTypes)
      expect(chain[4].shaderSource).toBe("void main() { fragColor = vec4(1.0); }")
    })
  })

  describe("WebGPUAdapter Post-Processing Architecture", () => {
    it("compiles pipelines for all pass types without crashing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "pp-vig", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
        { type: "postprocess", id: "pp-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.01 } },
        { type: "postprocess", id: "pp-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "pp-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "pp-cust", pass: "custom", customSource: CUSTOM_WGSL_TEMPLATE, uniforms: {} },
      ])

      // Step frames through render loop
      expect(() => env.clock.stepFrames(3, 16.666)).not.toThrow()
      adapter.dispose()
    })

    it("updates uniforms in real-time via updatePostProcessUniform", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "pp-vig-1", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
        { type: "postprocess", id: "pp-vig-2", pass: "vignette", uniforms: { intensity: 0.2, radius: 0.4 } },
      ])
      env.clock.step(16)

      // Test updating uniform on specific node ID
      expect(() => {
        adapter.updatePostProcessUniform("pp-vig-1", "intensity", 0.95)
        adapter.updatePostProcessUniform("pp-vig-2", "radius", 0.1)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })

    it("executes multi-pass ping-pong rendering correctly", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p1", pass: "vignette" },
        { type: "postprocess", id: "p2", pass: "bloom" },
      ])

      // Render 2 frames
      env.clock.stepFrames(2, 16.666)
      const dev = env.webgpu.getDevice()!
      expect(dev.queue.submittedCommands.length).toBeGreaterThan(0)
      adapter.dispose()
    })
  })

  describe("WebGL2Adapter Post-Processing Architecture", () => {
    it("sets up dual FBOs and renders passes for all effect types", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5 } },
        { type: "postprocess", id: "p-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.008 } },
        { type: "postprocess", id: "p-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "p-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "p-custom", pass: "custom", customSource: CUSTOM_GLSL_TEMPLATE },
      ])

      env.clock.step(16)
      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)
      adapter.dispose()
    })

    it("updates WebGL2 uniforms via updatePostProcessUniform at 60 FPS", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
      ])
      env.clock.step(16)

      expect(() => {
        adapter.updatePostProcessUniform("p-vig", "intensity", 0.85)
        adapter.updatePostProcessUniform("p-vig", "radius", 0.45)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })
  })

  describe("ThreeJSAdapter Post-Processing Architecture", () => {
    it("instantiates EffectComposer and sequential ShaderPasses for passes", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5 } },
        { type: "postprocess", id: "p-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.01 } },
        { type: "postprocess", id: "p-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "p-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "p-custom", pass: "custom", customSource: CUSTOM_GLSL_TEMPLATE },
      ])

      expect(() => env.clock.stepFrames(3, 16.666)).not.toThrow()

      // Test uniform update on Three.js adapter
      expect(() => {
        adapter.updatePostProcessUniform("p-vig", "intensity", 0.9)
        adapter.updatePostProcessUniform("p-chroma", "aberrationOffset", 0.02)
        adapter.updatePostProcessUniform("p-bloom", "bloomIntensity", 1.2)
        adapter.updatePostProcessUniform("p-blur", "blurAmount", 4.0)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })
  })
})
