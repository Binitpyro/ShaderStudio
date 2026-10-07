import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Tier 2: Boundary & Corner Cases — Viewport & Resizing", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles 0x0 viewport dimensions safely without division-by-zero or crash", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas(0, 0)
    await adapter.mount(canvas as any)

    expect(() => adapter.resize(0, 0)).not.toThrow()
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    adapter.dispose()
  })

  it("handles 1x1 minimal single-pixel canvas", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas(1, 1)
    await adapter.mount(canvas as any)

    adapter.resize(1, 1)
    const gl = env.webgl2.getLastContext()!
    expect(gl.viewportRect.width).toBe(1)
    expect(gl.viewportRect.height).toBe(1)

    adapter.dispose()
  })

  it("handles extreme 8K UHD viewport dimensions (7680x4320)", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas(800, 600)
    await adapter.mount(canvas as any)

    adapter.resize(7680, 4320)
    expect(canvas.width).toBe(7680)
    expect(canvas.height).toBe(4320)

    adapter.dispose()
  })

  it("handles fractional devicePixelRatio values (e.g. 1.25, 2.75)", async () => {
    globalThis.window.devicePixelRatio = 2.75
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas(400, 300)
    await adapter.mount(canvas as any)

    adapter.resize(400, 300)
    expect(canvas.width).toBe(Math.floor(400 * 2.75))
    expect(canvas.height).toBe(Math.floor(300 * 2.75))

    globalThis.window.devicePixelRatio = 1
    adapter.dispose()
  })

  it("handles negative dimensions gracefully by clamping to minimum of 1", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    expect(() => adapter.resize(-100, -200)).not.toThrow()
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    adapter.dispose()
  })

  it("handles 50 rapid sequential resize calls in a single frame", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    for (let i = 1; i <= 50; i++) {
      adapter.resize(i * 10, i * 10)
    }

    env.clock.step(16)
    adapter.dispose()
  })
})
