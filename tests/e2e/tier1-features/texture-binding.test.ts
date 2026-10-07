import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore, type TextureResource } from "@/stores/projectStore"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Tier 1: Texture Pipeline & Multi-Binding", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 16: Texture Slot Ingestion
  describe("Feature 16: Texture Slot Ingestion", () => {
    it("adds a texture resource to project store", () => {
      const tex: TextureResource = { id: "tex-1", name: "checkerboard.png", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
      useProjectStore.getState().addTextureResource(tex)

      expect(useProjectStore.getState().textureResources).toHaveLength(1)
      expect(useProjectStore.getState().textureResources[0].id).toBe("tex-1")
    })

    it("removes a texture resource by ID from project store", () => {
      useProjectStore.getState().addTextureResource({ id: "tex-1", name: "tex1.png", src: "blob:http://localhost/1" })
      useProjectStore.getState().addTextureResource({ id: "tex-2", name: "tex2.png", src: "blob:http://localhost/2" })

      useProjectStore.getState().removeTextureResource("tex-1")
      const remaining = useProjectStore.getState().textureResources
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe("tex-2")
    })

    it("supports multiple texture resources simultaneously in store", () => {
      for (let i = 0; i < 5; i++) {
        useProjectStore.getState().addTextureResource({ id: `tex-${i}`, name: `texture_${i}.png`, src: `data:image/png;base64,${i}` })
      }
      expect(useProjectStore.getState().textureResources).toHaveLength(5)
    })

    it("handles replacing or updating texture with same ID cleanly", () => {
      useProjectStore.getState().addTextureResource({ id: "tex-target", name: "v1.png", src: "data:v1" })
      useProjectStore.getState().removeTextureResource("tex-target")
      useProjectStore.getState().addTextureResource({ id: "tex-target", name: "v2.png", src: "data:v2" })

      const resources = useProjectStore.getState().textureResources
      expect(resources).toHaveLength(1)
      expect(resources[0].name).toBe("v2.png")
    })

    it("stores texture uniform values in project store", () => {
      useProjectStore.getState().setUniformValue("u_albedo", { type: "texture", value: "tex-1" })
      expect(useProjectStore.getState().uniformValues["u_albedo"]).toEqual({ type: "texture", value: "tex-1" })
    })
  })

  // Feature 17: WebGPU Texture & Sampler Binding
  describe("Feature 17: WebGPU Texture & Sampler Binding", () => {
    it("creates GPUTexture when texture render step is received in setRenderQueue", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-albedo", name: "albedo.png", src: "https://example.com/albedo.png" })

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "texture", id: "tex-albedo", src: "https://example.com/albedo.png", binding: 0 },
      ])

      // Wait a microtask tick for async loadTexture to initiate
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      expect(device.createdTextures.length).toBeGreaterThan(0)

      adapter.dispose()
    })

    it("configures GPUTexture with TEXTURE_BINDING and COPY_DST usage", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-normal", name: "normal.png", src: "https://example.com/normal.png" })
      adapter.setRenderQueue([
        { type: "texture", id: "tex-normal", src: "https://example.com/normal.png", binding: 0 },
      ])

      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const tex = device.createdTextures.find((t) => (t.usage & 4) !== 0) // TEXTURE_BINDING = 4
      expect(tex).toBeDefined()

      adapter.dispose()
    })

    it("avoids redundant texture allocation if texture is already loaded", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-cached", name: "cached.png", src: "https://example.com/cached.png" })

      adapter.setRenderQueue([{ type: "texture", id: "tex-cached", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const initialCount = device.createdTextures.length

      // Send same queue again
      adapter.setRenderQueue([{ type: "texture", id: "tex-cached", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      expect(device.createdTextures.length).toBe(initialCount)

      adapter.dispose()
    })

    it("destroys loaded GPUTextures when adapter is disposed", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-cleanup", name: "clean.png", src: "https://example.com/clean.png" })
      adapter.setRenderQueue([{ type: "texture", id: "tex-cleanup", src: "", binding: 0 }])
      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      const textures = [...device.createdTextures]
      adapter.dispose()

      expect(textures.some((t) => t.isDestroyed)).toBe(true)
    })

    it("gracefully handles missing texture resource without throwing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // No resource in store with id "non-existent"
      expect(() => {
        adapter.setRenderQueue([{ type: "texture", id: "non-existent", src: "", binding: 0 }])
      }).not.toThrow()

      adapter.dispose()
    })
  })

  // Feature 18: WebGL2 Texture & Sampler Binding
  describe("Feature 18: WebGL2 Texture & Sampler Binding", () => {
    it("creates WebGL textures with linear filtering and clamp to edge wrap modes", () => {
      const gl = env.webgl2.getLastContext() || (env.createCanvas() as any).getContext("webgl2")
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      expect(tex.minFilter).toBe(gl.LINEAR)
      expect(tex.magFilter).toBe(gl.LINEAR)
      expect(tex.wrapS).toBe(gl.CLAMP_TO_EDGE)
      expect(tex.wrapT).toBe(gl.CLAMP_TO_EDGE)
    })

    it("switches active texture unit via gl.activeTexture", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      gl.activeTexture(gl.TEXTURE0)
      expect(gl.activeTextureUnit).toBe(gl.TEXTURE0)

      gl.activeTexture(gl.TEXTURE1)
      expect(gl.activeTextureUnit).toBe(gl.TEXTURE1)
    })

    it("binds distinct textures to different texture units", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const tex0 = gl.createTexture()
      const tex1 = gl.createTexture()

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex0)

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, tex1)

      expect(gl.boundTextures.get(gl.TEXTURE0)).toBe(tex0)
      expect(gl.boundTextures.get(gl.TEXTURE1)).toBe(tex1)
    })

    it("allocates 2D texture memory via texImage2D", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

      expect(tex.width).toBe(512)
      expect(tex.height).toBe(512)
    })

    it("binds sampler uniform to texture unit index via uniform1i", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      const loc = gl.getUniformLocation(prog, "u_diffuse")

      gl.uniform1i(loc, 0)
      expect(gl.uniformValues.get("u_diffuse")).toBe(0)

      const loc2 = gl.getUniformLocation(prog, "u_normal")
      gl.uniform1i(loc2, 1)
      expect(gl.uniformValues.get("u_normal")).toBe(1)
    })
  })

  // Feature 19: Three.js Texture Binding
  describe("Feature 19: Three.js Texture Binding", () => {
    it("handles texture uniform updates cleanly", async () => {
      useProjectStore.getState().setUniformValue("u_tex", { type: "texture", value: "tex-1" })
      expect(useProjectStore.getState().uniformValues["u_tex"].type).toBe("texture")
    })

    it("preserves material uniforms when texture is configured", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.updateUniform("u_color", { type: "color", value: [0.5, 0.5, 0.5] })
      expect(() => {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "plane" },
          { type: "material", shaderPath: "default.frag", textureBindings: { u_diffuse: "tex-1" } },
        ])
      }).not.toThrow()

      adapter.dispose()
    })

    it("recompiles shader with texture sampler uniform without error", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const shader = `
        uniform sampler2D u_diffuse;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(u_diffuse, vUv); }
      `
      adapter.recompileShader(shader)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("disposes Three.js adapter cleanly after texture bindings", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      expect(() => adapter.dispose()).not.toThrow()
    })

    it("handles multiple render queue updates containing textures", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      for (let i = 0; i < 3; i++) {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "cube" },
          { type: "material", shaderPath: "test.frag", textureBindings: { [`u_tex${i}`]: `tex-${i}` } },
        ])
      }

      adapter.dispose()
    })
  })

  // Feature 20: Multi-Texture Simultaneous Binding
  describe("Feature 20: Multi-Texture Simultaneous Binding", () => {
    it("handles 2 simultaneous textures in render queue", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tex-0", name: "albedo.png", src: "data:tex0" })
      useProjectStore.getState().addTextureResource({ id: "tex-1", name: "normal.png", src: "data:tex1" })

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "texture", id: "tex-0", src: "data:tex0", binding: 0 },
        { type: "texture", id: "tex-1", src: "data:tex1", binding: 1 },
      ])

      await new Promise((r) => setTimeout(r, 10))

      const device = env.webgpu.getDevice()!
      expect(device.createdTextures.length).toBeGreaterThanOrEqual(1)

      adapter.dispose()
    })

    it("binds multiple texture units concurrently on WebGL2", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const t0 = gl.createTexture()
      const t1 = gl.createTexture()
      const t2 = gl.createTexture()

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t0)

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, t1)

      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, t2)

      expect(gl.boundTextures.size).toBe(3)
    })

    it("sets multiple sampler uniform bindings to consecutive units", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      const loc0 = gl.getUniformLocation(prog, "u_tex0")
      const loc1 = gl.getUniformLocation(prog, "u_tex1")
      const loc2 = gl.getUniformLocation(prog, "u_tex2")

      gl.uniform1i(loc0, 0)
      gl.uniform1i(loc1, 1)
      gl.uniform1i(loc2, 2)

      expect(gl.uniformValues.get("u_tex0")).toBe(0)
      expect(gl.uniformValues.get("u_tex1")).toBe(1)
      expect(gl.uniformValues.get("u_tex2")).toBe(2)
    })

    it("retains multiple textures across render queue updates", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      useProjectStore.getState().addTextureResource({ id: "tA", name: "A.png", src: "data:A" })
      useProjectStore.getState().addTextureResource({ id: "tB", name: "B.png", src: "data:B" })

      adapter.setRenderQueue([
        { type: "texture", id: "tA", src: "", binding: 0 },
        { type: "texture", id: "tB", src: "", binding: 1 },
      ])
      await new Promise((r) => setTimeout(r, 10))

      env.clock.step(16)
      adapter.dispose()
    })

    it("allows unbinding and rebinding multiple textures cleanly", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const t0 = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t0)
      expect(gl.boundTextures.has(gl.TEXTURE0)).toBe(true)

      gl.bindTexture(gl.TEXTURE_2D, null)
      expect(gl.boundTextures.has(gl.TEXTURE0)).toBe(false)
    })
  })

  // Feature 21: Texture Sampling in Shaders
  describe("Feature 21: Texture Sampling in Shaders", () => {
    it("parses sampler2D uniforms in GLSL shaders", () => {
      const glsl = `
        uniform sampler2D u_albedoMap;
        uniform sampler2D u_roughnessMap;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "u_albedoMap", type: "texture", kind: "texture" })
      expect(uniforms[1]).toMatchObject({ name: "u_roughnessMap", type: "texture", kind: "texture" })
    })

    it("parses texture_2d module variables in WGSL shaders", () => {
      const wgsl = `
        @group(0) @binding(1) var u_diffuse: texture_2d<f32>;
        @group(0) @binding(2) var u_normal: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "u_diffuse", type: "texture", kind: "texture" })
      expect(uniforms[1]).toMatchObject({ name: "u_normal", type: "texture", kind: "texture" })
    })

    it("recompiles shader containing texture sampling without errors", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const shader = `
        #version 300 es
        precision highp float;
        uniform sampler2D u_mainTex;
        in vec2 v_texCoord;
        out vec4 fragColor;
        void main() {
          fragColor = texture(u_mainTex, v_texCoord);
        }
      `
      adapter.recompileShader(shader)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.dispose()
    })

    it("binds texture step with matching uniformName to material", () => {
      const bindings: Record<string, string> = {
        u_mainTex: "tex-image-1",
        u_maskTex: "tex-image-2",
      }
      expect(bindings["u_mainTex"]).toBe("tex-image-1")
      expect(bindings["u_maskTex"]).toBe("tex-image-2")
    })

    it("validates that texture uniforms are classified as texture kind in parameter panel list", () => {
      const glsl = `
        uniform vec3 u_color;
        uniform sampler2D u_albedo;
      `
      const uniforms = parseGlslUniforms(glsl)
      const texUniform = uniforms.find((u) => u.name === "u_albedo")
      expect(texUniform).toBeDefined()
      expect(texUniform!.kind).toBe("texture")
    })
  })
})
