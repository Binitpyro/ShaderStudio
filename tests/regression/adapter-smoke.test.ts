import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter } from "@/adapters/threejs"

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
})
