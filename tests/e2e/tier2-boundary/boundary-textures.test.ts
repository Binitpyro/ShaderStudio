import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 2: Boundary & Corner Cases — Textures", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("handles empty texture ID without crashing adapter", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    expect(() => {
      adapter.setRenderQueue([{ type: "texture", id: "", src: "", binding: 0 }])
    }).not.toThrow()

    adapter.dispose()
  })

  it("handles failed network fetch for texture image gracefully", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network 404: Image not found")
    }

    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    useProjectStore.getState().addTextureResource({
      id: "tex-404",
      name: "missing.png",
      src: "https://example.com/missing.png",
    })

    expect(() => {
      adapter.setRenderQueue([{ type: "texture", id: "tex-404", src: "", binding: 0 }])
    }).not.toThrow()

    await new Promise((r) => setTimeout(r, 10))
    adapter.dispose()
  })

  it("handles unbinding a texture unit that was never bound", () => {
    const gl = (env.createCanvas() as any).getContext("webgl2")
    gl.activeTexture(gl.TEXTURE0)
    expect(() => gl.bindTexture(gl.TEXTURE_2D, null)).not.toThrow()
    expect(gl.boundTextures.has(gl.TEXTURE0)).toBe(false)
  })

  it("handles 16 simultaneous texture units (standard GPU limit)", () => {
    const gl = (env.createCanvas() as any).getContext("webgl2")
    for (let i = 0; i < 16; i++) {
      const tex = gl.createTexture()
      gl.activeTexture(0x84c0 + i) // gl.TEXTURE0 + i
      gl.bindTexture(gl.TEXTURE_2D, tex)
    }
    expect(gl.boundTextures.size).toBe(16)
  })

  it("handles rebinding a new texture to the same unit multiple times", () => {
    const gl = (env.createCanvas() as any).getContext("webgl2")
    gl.activeTexture(gl.TEXTURE0)

    for (let i = 0; i < 10; i++) {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      expect(gl.boundTextures.get(gl.TEXTURE0)).toBe(tex)
    }
  })
})
