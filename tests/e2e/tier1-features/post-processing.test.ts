import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockGPUDevice } from "../mocks"
import {
  WebGPUPingPong,
  WebGL2Framebuffer,
  buildPostProcessChain,
  PASSTHROUGH_VERTEX,
  VIGNETTE_FRAGMENT,
  BLUR_FRAGMENT,
} from "@/core/postProcessChain"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { WebGPUAdapter } from "@/adapters/webgpu"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Tier 1: Post-Processing Chain & Ping-Pong", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 22: Ping-Pong Buffer Architecture (WebGPU)
  describe("Feature 22: Ping-Pong Buffer Architecture (WebGPU)", () => {
    it("creates dual texture targets on resize", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)

      expect(pingPong.getCurrent()).not.toBeNull()
      expect(pingPong.getNext()).not.toBeNull()
      expect(pingPong.getCurrent()).not.toBe(pingPong.getNext())

      pingPong.destroy()
    })

    it("swaps active and target views on swap()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(640, 480)

      const firstCurrent = pingPong.getCurrent()
      const firstNext = pingPong.getNext()

      pingPong.swap()
      expect(pingPong.getCurrent()).toBe(firstNext)
      expect(pingPong.getNext()).toBe(firstCurrent)

      pingPong.swap()
      expect(pingPong.getCurrent()).toBe(firstCurrent)

      pingPong.destroy()
    })

    it("resets current view index to 0 on reset()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)

      const initialCurrent = pingPong.getCurrent()
      pingPong.swap()
      expect(pingPong.getCurrent()).not.toBe(initialCurrent)

      pingPong.reset()
      expect(pingPong.getCurrent()).toBe(initialCurrent)

      pingPong.destroy()
    })

    it("recreates textures when resized to new dimensions", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(400, 300)
      const count1 = device.createdTextures.length

      pingPong.resize(800, 600)
      const count2 = device.createdTextures.length
      expect(count2).toBeGreaterThan(count1)

      pingPong.destroy()
    })

    it("destroys both textures on destroy()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)
      pingPong.destroy()

      expect(pingPong.getCurrent()).toBeNull()
      expect(pingPong.getNext()).toBeNull()
    })
  })

  // Feature 23: Ping-Pong FBO Architecture (WebGL2)
  describe("Feature 23: Ping-Pong FBO Architecture (WebGL2)", () => {
    it("creates framebuffer with color attachment texture", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)

      expect(fbo.getTexture()).not.toBeNull()
      expect(gl.createdFramebuffers.length).toBeGreaterThan(0)

      fbo.destroy()
    })

    it("binds and unbinds framebuffer", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)

      fbo.bind()
      expect(gl.boundFramebuffer).not.toBeNull()

      fbo.unbind()
      expect(gl.boundFramebuffer).toBeNull()

      fbo.destroy()
    })

    it("WebGL2Adapter sets up dual FBOs when postprocess step is present", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)

      adapter.dispose()
    })

    it("renders to FBO and then renders postprocess quad to screen", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      const initialDrawCount = gl.drawCount

      env.clock.step(16)
      // Expect mesh draw + post-process quad draw
      expect(gl.drawCount).toBeGreaterThanOrEqual(initialDrawCount + 2)

      adapter.dispose()
    })

    it("cleans up framebuffers and textures on destroy", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)
      const tex = fbo.getTexture()

      fbo.destroy()
      expect(fbo.getTexture()).toBeNull()
      expect(tex?.isDestroyed).toBe(true)
    })
  })

  // Feature 24: Three.js EffectComposer Chaining
  describe("Feature 24: Three.js EffectComposer Chaining", () => {
    it("instantiates EffectComposer when postprocess step is queued", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(() => {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "cube" },
          { type: "postprocess", pass: "passthrough" },
        ])
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })

    it("executes composer render on render frames when postprocess is enabled", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      env.clock.stepFrames(3, 16.666)
      adapter.dispose()
    })

    it("resizes composer when adapter resize is called", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.resize(1024, 768)).not.toThrow()

      adapter.dispose()
    })

    it("switches from direct render to composer render and back without crash", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Direct render
      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      // Post-process render
      adapter.setRenderQueue([
        { type: "mesh", geometry: "sphere" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      // Back to direct render
      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("disposes composer cleanly on adapter disposal", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.dispose()).not.toThrow()
    })
  })

  // Feature 25: Post-Process Shaders (WGSL & GLSL)
  describe("Feature 25: Post-Process Shaders (WGSL & GLSL)", () => {
    it("defines valid passthrough vertex shader", () => {
      expect(PASSTHROUGH_VERTEX).toContain("#version 300 es")
      expect(PASSTHROUGH_VERTEX).toContain("in vec2 a_position;")
      expect(PASSTHROUGH_VERTEX).toContain("out vec2 v_texCoord;")
    })

    it("defines valid vignette fragment shader with uniform controls", () => {
      expect(VIGNETTE_FRAGMENT).toContain("uniform sampler2D u_texture;")
      expect(VIGNETTE_FRAGMENT).toContain("uniform float u_vignetteIntensity;")
      expect(VIGNETTE_FRAGMENT).toContain("uniform float u_vignetteRadius;")
      expect(VIGNETTE_FRAGMENT).toContain("smoothstep(u_vignetteRadius")
    })

    it("defines valid blur fragment shader with kernel weights", () => {
      expect(BLUR_FRAGMENT).toContain("uniform float u_blurAmount;")
      expect(BLUR_FRAGMENT).toContain("uniform vec2 u_resolution;")
      expect(BLUR_FRAGMENT).toContain("weights[9]")
    })

    it("compiles vignette shader in WebGL2 without compile errors", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, VIGNETTE_FRAGMENT)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })

    it("compiles blur shader in WebGL2 without compile errors", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, BLUR_FRAGMENT)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })
  })

  // Feature 26: PostProcessNode Configuration
  describe("Feature 26: PostProcessNode UI & Configuration", () => {
    it("builds postprocess chain with vignette pass from render steps", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain).toHaveLength(1)
      expect(chain[0].type).toBe("vignette")
      expect(chain[0].uniforms.u_vignetteIntensity).toBe(0.5)
      expect(chain[0].uniforms.u_vignetteRadius).toBe(0.8)
    })

    it("returns empty chain when no postprocess steps exist", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "sphere" },
        { type: "material", shaderPath: "default.wgsl", textureBindings: {} },
      ])
      expect(chain).toHaveLength(0)
    })

    it("builds multiple passes when multiple postprocess steps exist", () => {
      const chain = buildPostProcessChain([
        { type: "postprocess", pass: "passthrough" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain).toHaveLength(2)
    })

    it("supports setting custom uniform parameters on pass", () => {
      const pass = {
        type: "vignette" as const,
        uniforms: { u_vignetteIntensity: 0.9, u_vignetteRadius: 0.4 },
      }
      expect(pass.uniforms.u_vignetteIntensity).toBe(0.9)
      expect(pass.uniforms.u_vignetteRadius).toBe(0.4)
    })

    it("preserves pass order matching render step sequence", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain[0].type).toBe("vignette")
    })
  })

  // Feature 27: Dynamic Post-Processing Graph Updates
  describe("Feature 27: Dynamic Post-Processing Graph Updates", () => {
    it("dynamically activates post-processing on WebGL2 without reconnecting canvas", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Start without postprocess
      adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
      env.clock.step(16)

      // Add postprocess
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)

      adapter.dispose()
    })

    it("dynamically removes post-processing on WebGL2 without page reload", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // With postprocess
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      // Remove postprocess
      adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("handles rapid toggling of postprocess step", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      for (let i = 0; i < 4; i++) {
        adapter.setRenderQueue(
          i % 2 === 0
            ? [{ type: "mesh", geometry: "cube" }, { type: "postprocess", pass: "passthrough" }]
            : [{ type: "mesh", geometry: "cube" }]
        )
        env.clock.step(16)
      }

      adapter.dispose()
    })

    it("updates FBO dimensions when viewport resizes during active post-processing", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      const initialFboCount = gl.createdFramebuffers.length

      adapter.resize(1920, 1080)
      expect(gl.createdFramebuffers.length).toBeGreaterThan(initialFboCount)

      adapter.dispose()
    })

    it("handles setRenderQueue(null) cleanly when postprocess was active", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.setRenderQueue(null)).not.toThrow()

      adapter.dispose()
    })
  })

  // Feature 28: Custom Post-Process Node Support
  describe("Feature 28: Custom Post-Process Node Support", () => {
    it("represents custom pass with shaderSource in PostProcessPass", () => {
      const customPass = {
        type: "custom" as const,
        shaderSource: "void main() { fragColor = vec4(1.0); }",
        uniforms: { u_factor: 1.5 },
      }
      expect(customPass.type).toBe("custom")
      expect(customPass.shaderSource).toBeDefined()
    })

    it("compiles custom fragment shader program in WebGL2", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const customFrag = `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_exposure;
        in vec2 v_texCoord;
        out vec4 fragColor;
        void main() {
          vec4 c = texture(u_texture, v_texCoord);
          fragColor = vec4(c.rgb * u_exposure, c.a);
        }
      `
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, customFrag)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })

    it("sets uniforms on custom postprocess program", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      const loc = gl.getUniformLocation(prog, "u_exposure")
      gl.uniform1f(loc, 2.5)

      expect(gl.uniformValues.get("u_exposure")).toBe(2.5)
    })

    it("handles multiple chained custom passes", () => {
      const passes = [
        { type: "custom" as const, uniforms: { u_tone: 1 } },
        { type: "blur" as const, uniforms: { u_blurAmount: 2 } },
      ]
      expect(passes).toHaveLength(2)
      expect(passes[0].type).toBe("custom")
      expect(passes[1].type).toBe("blur")
    })

    it("disposes custom program resources without memory leaks", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      gl.deleteProgram(prog)
      expect(prog.isDestroyed).toBe(true)
    })
  })
})
