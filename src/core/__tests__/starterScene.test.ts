import { describe, it, expect, beforeEach } from "vitest"
import {
  STARTER_WGSL,
  STARTER_GLSL,
  STARTER_VERT_GLSL,
  STARTER_NODES,
  STARTER_EDGES,
  STARTER_UNIFORMS,
  STARTER_AUDIO_BINDINGS,
  STARTER_VARIATIONS,
  STARTER_ENVIRONMENT,
  createStarterProjectData,
} from "../defaultStarterScene"
import { compileGraph } from "@/core/graphCompiler"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { useProjectStore } from "@/stores/projectStore"

describe("Default Starter Scene Specification & Integrity", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  describe("Shader Sources & Uniform Reflection", () => {
    it("contains valid WebGPU WGSL shader source with analytical normals and Fresnel", () => {
      expect(STARTER_WGSL).toContain("@vertex")
      expect(STARTER_WGSL).toContain("@fragment")
      expect(STARTER_WGSL).toContain("struct Uniforms")
      expect(STARTER_WGSL).toContain("dpdx")
      expect(STARTER_WGSL).toContain("dpdy")
      expect(STARTER_WGSL).toContain("palette")
      expect(STARTER_WGSL).toContain("u_audio_bass")
      expect(STARTER_WGSL).toContain("u_audio_mid")
      expect(STARTER_WGSL).toContain("u_audio_beat")
    })

    it("parses all required uniforms from starter WGSL shader", () => {
      const parsed = parseWgslUniforms(STARTER_WGSL)
      const uniformNames = parsed.map((u) => u.name)

      expect(uniformNames).toContain("mvp")
      expect(uniformNames).toContain("time")
      expect(uniformNames).toContain("color")
      expect(uniformNames).toContain("fresnelPower")
      expect(uniformNames).toContain("iridescence")
      expect(uniformNames).toContain("roughness")
      expect(uniformNames).toContain("pulseSpeed")
      expect(uniformNames).toContain("u_audio_bass")
      expect(uniformNames).toContain("u_audio_mid")
      expect(uniformNames).toContain("u_audio_treble")
      expect(uniformNames).toContain("u_audio_beat")
    })

    it("contains matching GLSL ES 3.0 fragment and vertex shaders for Three.js/WebGL2 fallbacks", () => {
      expect(STARTER_GLSL).toContain("#version 300 es")
      expect(STARTER_GLSL).toContain("u_fresnelPower")
      expect(STARTER_GLSL).toContain("u_iridescence")
      expect(STARTER_GLSL).toContain("palette")
      expect(STARTER_GLSL).toContain("u_audio_bass")
      expect(STARTER_GLSL).toContain("fragColor")

      expect(STARTER_VERT_GLSL).toContain("#version 300 es")
      expect(STARTER_VERT_GLSL).toContain("u_mvp")
      expect(STARTER_VERT_GLSL).toContain("v_world_pos")
    })

    it("parses GLSL uniforms via parseGlslUniforms", () => {
      const parsed = parseGlslUniforms(STARTER_GLSL)
      const names = parsed.map((u) => u.name)
      expect(names).toContain("u_color")
      expect(names).toContain("u_fresnelPower")
      expect(names).toContain("u_iridescence")
      expect(names).toContain("u_roughness")
      expect(names).toContain("u_pulseSpeed")
      expect(names).toContain("u_audio_bass")
    })
  })

  describe("Node Graph Pipeline", () => {
    it("contains full pipeline nodes: Mesh, Audio, Material, Bloom, Vignette, Output", () => {
      const types = STARTER_NODES.map((n) => n.type)
      expect(types).toContain("mesh")
      expect(types).toContain("audio")
      expect(types).toContain("material")
      expect(types).toContain("postprocess")
      expect(types).toContain("output")

      const meshNode = STARTER_NODES.find((n) => n.type === "mesh")
      expect((meshNode?.data as any).geometry).toBe("torus_knot")

      const postProcessNodes = STARTER_NODES.filter((n) => n.type === "postprocess")
      expect(postProcessNodes).toHaveLength(2)
      expect(postProcessNodes.map((n) => (n.data as any).passType)).toEqual(["bloom", "vignette"])
    })

    it("connects all graph nodes in an unbroken execution chain", () => {
      expect(STARTER_EDGES).toHaveLength(5)
      const targetIds = STARTER_EDGES.map((e) => e.target)
      expect(targetIds).toContain("material-1")
      expect(targetIds).toContain("postprocess-1")
      expect(targetIds).toContain("postprocess-2")
      expect(targetIds).toContain("output-1")
    })

    it("compiles graph into valid RenderQueue without compilation errors", () => {
      const result = compileGraph(STARTER_NODES, STARTER_EDGES)
      expect(result.error).toBeNull()
      expect(result.queue.length).toBeGreaterThanOrEqual(4)

      const meshStep = result.queue.find((s) => s.type === "mesh")
      expect((meshStep as any)?.geometry).toBe("torus_knot")

      const audioStep = result.queue.find((s) => s.type === "audio")
      expect(audioStep).toBeDefined()

      const ppSteps = result.queue.filter((s) => s.type === "postprocess")
      expect(ppSteps).toHaveLength(2)
    })
  })

  describe("Preset Variations & Parameters", () => {
    it("bundles 4 distinct curated preset variations", () => {
      expect(STARTER_VARIATIONS).toHaveLength(4)
      const names = STARTER_VARIATIONS.map((v) => v.name)
      expect(names).toEqual([
        "Liquid Chrome",
        "Cyber Neon",
        "Molten Gold",
        "Bioluminescent",
      ])
    })

    it("each variation configures valid aesthetic uniform values", () => {
      for (const variation of STARTER_VARIATIONS) {
        expect(variation.uniformValues.fresnelPower).toBeDefined()
        expect(variation.uniformValues.iridescence).toBeDefined()
        expect(variation.uniformValues.roughness).toBeDefined()
        expect(variation.uniformValues.pulseSpeed).toBeDefined()
      }
    })

    it("defines calibrated default starter uniforms", () => {
      expect(STARTER_UNIFORMS.color.type).toBe("color")
      expect(STARTER_UNIFORMS.fresnelPower.value).toBe(2.8)
      expect(STARTER_UNIFORMS.iridescence.value).toBe(1.6)
      expect(STARTER_UNIFORMS.roughness.value).toBe(0.2)
      expect(STARTER_UNIFORMS.pulseSpeed.value).toBe(1.5)
    })

    it("maps audio frequency bands to shader parameters", () => {
      expect(STARTER_AUDIO_BINDINGS.u_audio_bass.band).toBe("bass")
      expect(STARTER_AUDIO_BINDINGS.u_audio_mid.band).toBe("mid")
      expect(STARTER_AUDIO_BINDINGS.u_audio_treble.band).toBe("treble")
      expect(STARTER_AUDIO_BINDINGS.u_audio_beat.band).toBe("beat")
    })

    it("configures studio environment lighting settings", () => {
      expect(STARTER_ENVIRONMENT.preset).toBe("studio_warm")
      expect(STARTER_ENVIRONMENT.exposure).toBe(1.2)
      expect(STARTER_ENVIRONMENT.rotation).toBe(45.0)
    })
  })

  describe("Store Operations & Multi-Backend Transition", () => {
    it("loads complete starter scene via loadStarterScene", () => {
      useProjectStore.getState().loadStarterScene()
      const state = useProjectStore.getState()

      expect(state.currentProjectName).toBe("Iridescent Torus Hero")
      expect(state.shaderSource).toBe(STARTER_WGSL)
      expect(state._graphNodes).toHaveLength(6)
      expect(state._graphEdges).toHaveLength(5)
      expect(state.variations).toHaveLength(4)
      expect(state.audioBindings.u_audio_bass.band).toBe("bass")
      expect(state.renderQueue).not.toBeNull()
      expect(state.renderQueue!.some((s) => s.type === "mesh" && s.geometry === "torus_knot")).toBe(true)
      expect(state.renderQueue!.some((s) => s.type === "postprocess" && s.pass === "bloom")).toBe(true)
      expect(state.renderQueue!.some((s) => s.type === "postprocess" && s.pass === "vignette")).toBe(true)
    })

    it("automatically hot-swaps between WGSL and GLSL when switching backend", () => {
      useProjectStore.getState().loadStarterScene()
      expect(useProjectStore.getState().shaderSource).toBe(STARTER_WGSL)

      // Switch to WebGL2
      useProjectStore.getState().setActiveBackend("webgl2")
      expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      expect(useProjectStore.getState().shaderSource).toBe(STARTER_GLSL)

      // Switch to Three.js
      useProjectStore.getState().setActiveBackend("threejs")
      expect(useProjectStore.getState().activeBackend).toBe("threejs")
      expect(useProjectStore.getState().shaderSource).toBe(STARTER_GLSL)

      // Switch back to WebGPU
      useProjectStore.getState().setActiveBackend("webgpu")
      expect(useProjectStore.getState().activeBackend).toBe("webgpu")
      expect(useProjectStore.getState().shaderSource).toBe(STARTER_WGSL)
    })

    it("preserves serialization contract in createStarterProjectData", () => {
      const data = createStarterProjectData()
      expect(data.name).toBe("Iridescent Torus Hero")
      expect(data.version).toBe("1.0")
      expect(data.backend).toBe("webgpu")
      expect(data.shaderSources.wgsl).toBe(STARTER_WGSL)
      expect(data.shaderSources.glsl).toBe(STARTER_GLSL)
      expect(data.graphNodes).toHaveLength(6)
      expect(data.graphEdges).toHaveLength(5)
      expect(data.variations).toHaveLength(4)
    })
  })
})
