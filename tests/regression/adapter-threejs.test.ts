import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as THREE from "three"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { ThreeJSAdapter } from "@/adapters/threejs"
import { useProjectStore } from "@/stores/projectStore"
import { performanceTelemetry } from "@/core/performanceTelemetry"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

const queue = (pass: string, intensity = 0.5): any => [
  { type: "mesh", id: "m", geometry: "cube" },
  { type: "postprocess", id: "pp1", pass, uniforms: { intensity } },
]

describe("ThreeJSAdapter (fleet w3)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let adapter: ThreeJSAdapter
  let a: any

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    adapter = new ThreeJSAdapter()
    adapter.setExternalLoopDriven(true)
    await adapter.mount(env.createCanvas() as any)
    a = adapter as any
  })
  afterEach(() => {
    adapter.dispose()
    vi.restoreAllMocks()
    teardownE2ETestEnvironment()
  })

  it("keeps the previous material and reports line-numbered errors when a shader fails to compile", () => {
    const material = a.material as THREE.ShaderMaterial
    const goodFrag = material.fragmentShader
    const r = a.renderer
    r.compile.mockImplementation(() => {
      const gl = {
        getShaderInfoLog: () => "ERROR: 0:105: 'foo' : undeclared identifier",
        getShaderSource: (s: any) => `#define PREFIX\n`.repeat(100) + s.src,
        getProgramInfoLog: () => "",
      }
      r.debug.onShaderError(gl, {}, { src: "" }, { src: "void main() {\n\n\n\n foo; }" })
    })

    adapter.recompileShader("void main() {\n\n\n\n foo; }")

    expect(a.material).toBe(material)
    expect(material.fragmentShader).toBe(goodFrag)
    const err = useProjectStore.getState().lastCompileError!
    expect(err).toContain("Fragment shader error")
    expect(err).toContain("ERROR: 0:5:") // 105 minus the 100 prefix lines
    expect(r.debug.onShaderError).toBeNull() // debug hooks restored

    r.compile.mockImplementation(() => {})
    adapter.recompileShader("void main() { gl_FragColor = vec4(1.0); }")
    expect(material.fragmentShader).toContain("gl_FragColor = vec4(1.0)")
    expect(useProjectStore.getState().lastCompileError).toBeNull()
  })

  it("rebuilds the post chain only when it changes and disposes old pass materials", () => {
    adapter.setRenderQueue(queue("vignette"))
    const composer = a.composer
    const first = [...a.postPasses] as any[]
    expect(first.length).toBe(1)

    adapter.setRenderQueue(queue("vignette"))
    expect(a.composer).toBe(composer)
    expect(a.postPasses[0]).toBe(first[0])

    const disposed = vi.spyOn(first[0].material, "dispose")
    adapter.setRenderQueue(queue("bloom"))
    expect(disposed).toHaveBeenCalled()
    expect(a.composer).not.toBe(composer)
    expect(a.postPasses[0]).not.toBe(first[0])
  })

  it("dispose releases the renderer and the GL context", () => {
    const r = a.renderer
    adapter.dispose()
    expect(r.dispose).toHaveBeenCalled()
    expect(r.forceContextLoss).toHaveBeenCalled()
  })

  it("ignores an environment texture whose load finished after the preset changed, and frees it", () => {
    const callbacks: Array<(t: any) => void> = []
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(((_u: string, onLoad: any) => {
      callbacks.push(onLoad)
      return {} as any
    }) as any)
    const settings: any = { exposure: 1, rotation: 0, showSkybox: true, backgroundBlur: 0, preset: "custom", customTextureSrc: "a.png" }
    adapter.updateEnvironment(settings)
    adapter.updateEnvironment({ ...settings, preset: "custom", customTextureSrc: "b.png" })
    // same preset id => not reloaded; switch preset id to invalidate
    adapter.updateEnvironment({ ...settings, preset: "studio", customTextureSrc: undefined })

    const stale = { dispose: vi.fn() }
    callbacks[0](stale)
    expect(stale.dispose).toHaveBeenCalled()
    expect(a.currentEnvTexture).not.toBe(stale)
    expect(a.scene.environment).not.toBe(stale)
  })

  it("derives mesh rotation from the time passed to renderFrame", () => {
    adapter.renderFrame(1000, 16)
    const at1s = [a.mesh.rotation.x, a.mesh.rotation.y]
    adapter.renderFrame(5000, 16)
    adapter.renderFrame(1000, 0) // seek back
    expect([a.mesh.rotation.x, a.mesh.rotation.y]).toEqual(at1s)
    expect(at1s[0]).toBeGreaterThan(0)
  })

  it("reports renderer.info draw calls and triangles each frame", () => {
    const spy = vi.spyOn(performanceTelemetry, "reportFrameStats")
    a.renderer.info.render.calls = 7
    a.renderer.info.render.triangles = 1234
    adapter.renderFrame(16, 16)
    expect(a.renderer.info.autoReset).toBe(false)
    expect(a.renderer.info.reset).toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith({ drawCalls: 7, triangles: 1234 })
  })
})
