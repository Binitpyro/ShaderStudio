import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter } from "@/adapters/threejs"
import { halton, setTexMeta, setPerspectiveMatrixGL, setPerspectiveMatrixWebGPU, createLookAtMatrix, multiplyMatrices } from "@/adapters/math"
import { WebGL2Framebuffer } from "@/core/postProcessChain"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

// Regression: a refactor dropped the rotation-matrix fill so the MVP was all zeros (blank viewport)
// while every other test stayed green. These assert a frame yields a real transform AND a draw.
const usable = (m: ArrayLike<number>) =>
  m.length === 16 && Array.from(m).every(Number.isFinite) && Array.from(m).some((v) => v !== 0)

describe("adapter smoke", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  beforeEach(() => { env = setupE2ETestEnvironment() })
  afterEach(() => { teardownE2ETestEnvironment() })

  describe("WebGPU", () => {
    it("draws with a finite, non-zero MVP that changes between frames", async () => {
      const adapter = new WebGPUAdapter()
      await adapter.mount(env.createCanvas() as any)
      const a = adapter as any
      const device = env.webgpu.getDevice()!
      const mvp = () => {
        const off = (a.uniformLayout.fields["mvp"] ?? a.uniformLayout.fields["u_mvp"]).offset
        return new Float32Array(a.uniformBuffer.data.slice(off, off + 64).buffer)
      }

      env.clock.step(16)
      const first = Array.from(mvp())
      env.clock.step(16)

      expect(usable(first)).toBe(true)
      expect(usable(mvp())).toBe(true)
      expect(Array.from(mvp())).not.toEqual(first)

      const draws = device.queue.submittedCommands.flatMap((c: any) => c.renderPasses).flatMap((p: any) => p.drawCalls)
      expect(draws.length).toBeGreaterThan(0)
      adapter.dispose()
    })
  })

  describe("WebGL2", () => {
    it("draws with a finite, non-zero MVP that changes between frames", async () => {
      const adapter = new WebGL2Adapter()
      await adapter.mount(env.createCanvas() as any)
      const gl = env.webgl2.getLastContext()!

      env.clock.step(16)
      const mvp = () => (gl as any).uniformValues.get((adapter as any).mvpLocation.name)
      const first = mvp()
      env.clock.step(16)

      expect((gl as any).drawCount).toBeGreaterThan(0)
      expect(usable(first)).toBe(true)
      expect(usable(mvp())).toBe(true)
      expect(mvp()).not.toEqual(first)
      adapter.dispose()
    })
  })

  describe("Three.js", () => {
    it("renders with a finite, non-zero mesh matrix that changes between frames", async () => {
      const adapter = new ThreeJSAdapter()
      await adapter.mount(env.createCanvas() as any)
      const a = adapter as any
      const matrix = () => {
        a.mesh.updateMatrix()
        return Array.from(a.mesh.matrix.elements as number[])
      }

      env.clock.step(16)
      const first = matrix()
      env.clock.step(16)

      expect(a.renderer.render).toHaveBeenCalled()
      expect(usable(first)).toBe(true)
      expect(usable(a.camera.projectionMatrix.elements)).toBe(true)
      expect(matrix()).not.toEqual(first)
      adapter.dispose()
    })
  })

  describe("shared math helpers (extracted for W3)", () => {
    it("halton matches the radical-inverse sequence the adapters use", () => {
      expect([1, 2, 3, 4].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125])
      expect(halton(1, 3)).toBeCloseTo(1 / 3, 10)
      expect(halton(0, 2)).toBe(0)
    })

    it("setTexMeta tags format/width/height and tolerates null and frozen objects", () => {
      const tex: any = {}
      setTexMeta(tex, "rgba16float", 8, 4)
      expect(tex).toMatchObject({ format: "rgba16float", width: 8, height: 4 })
      expect(() => setTexMeta(null, "x", 1, 1)).not.toThrow()
      expect(() => setTexMeta(Object.freeze({}), "x", 1, 1)).not.toThrow()
    })

    it("perspective matrices differ only in clip-space depth mapping (GL [-1,1] vs WebGPU [0,1])", () => {
      const gl = setPerspectiveMatrixGL(new Float32Array(16), Math.PI / 4, 1.5, 0.1, 100)
      const gpu = setPerspectiveMatrixWebGPU(new Float32Array(16), Math.PI / 4, 1.5, 0.1, 100)
      expect(gl[0]).toBeCloseTo(gpu[0]); expect(gl[5]).toBeCloseTo(gpu[5]); expect(gl[11]).toBe(-1); expect(gpu[11]).toBe(-1)
      const ndcDepth = (m: Float32Array, z: number) => (m[10] * z + m[14]) / -z // view-space z is negative
      expect(ndcDepth(gl, -0.1)).toBeCloseTo(-1, 4); expect(ndcDepth(gl, -100)).toBeCloseTo(1, 4)
      expect(ndcDepth(gpu, -0.1)).toBeCloseTo(0, 4); expect(ndcDepth(gpu, -100)).toBeCloseTo(1, 4)
    })

    it("lookAt * identity keeps a usable matrix", () => {
      const view = createLookAtMatrix([0, 0, 5], [0, 0, 0], [0, 1, 0])
      const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      expect(Array.from(multiplyMatrices(view, id), (v) => v + 0)).toEqual(Array.from(view, (v) => v + 0)) // +0 normalises -0
      expect(usable(view)).toBe(true)
    })
  })

  describe("WebGL2 post-process target depth (fleet w2)", () => {
    it("attaches a depth renderbuffer sized to the target, recreates it on resize, and releases it on destroy", () => {
      const gl: any = (env.createCanvas() as any).getContext("webgl2")
      const storage = vi.spyOn(gl, "renderbufferStorage")
      const attach = vi.spyOn(gl, "framebufferRenderbuffer")
      const del = vi.fn()
      gl.deleteRenderbuffer = del

      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(320, 200)
      expect(storage).toHaveBeenLastCalledWith(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 320, 200)
      expect(attach).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, expect.anything())

      fbo.resize(640, 360) // resize replaces the target, including its depth buffer
      expect(del).toHaveBeenCalledTimes(1)
      expect(storage).toHaveBeenLastCalledWith(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 640, 360)

      fbo.destroy()
      expect(del).toHaveBeenCalledTimes(2)
    })
  })
})
