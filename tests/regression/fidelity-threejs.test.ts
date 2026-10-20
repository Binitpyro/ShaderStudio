import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as THREE from "three"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { ThreeJSAdapter, FX_LOADERS } from "@/adapters/threejs"
import { DEFAULT_RENDER_SETTINGS } from "@/stores/renderSettingsStore"
import { useProjectStore } from "@/stores/projectStore"
import type { RenderSettings } from "@/adapters/types"

const h = vi.hoisted(() => ({ loads: [] as string[], targets: [] as Array<[number, number]>, depths: [] as Array<[number, number]> }))

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  // record every render target / depth texture the adapter constructs or resizes
  class RT extends actual.WebGLRenderTarget {
    constructor(w?: number, hh?: number, o?: any) { super(w, hh, o); h.targets.push([w ?? 0, hh ?? 0]) }
    setSize(w: number, hh: number, d?: number) { h.targets.push([w, hh]); super.setSize(w, hh, d) }
  }
  class DT extends actual.DepthTexture {
    constructor(...a: ConstructorParameters<typeof actual.DepthTexture>) { super(...a); h.depths.push([this.format, this.type]) }
  }
  return { ...actual, WebGLRenderer: MockThreeRenderer, WebGLRenderTarget: RT, DepthTexture: DT }
})

// jsm effect modules are mocked: the factories only run when the adapter dynamically imports them.
function fakePass(name: string) {
  const C = class {
    enabled = true
    needsSwap = true
    renderToScreen = false
    args: unknown[]
    dispose = vi.fn()
    setSize = vi.fn()
    render = vi.fn()
    constructor(...args: unknown[]) { this.args = args }
  }
  Object.defineProperty(C, "name", { value: name })
  return C
}
vi.mock("three/examples/jsm/postprocessing/SSAOPass.js", () => { h.loads.push("ssao"); return { SSAOPass: fakePass("SSAOPass") } })
vi.mock("three/examples/jsm/postprocessing/SSRPass.js", () => { h.loads.push("ssr"); return { SSRPass: fakePass("SSRPass") } })
vi.mock("three/examples/jsm/postprocessing/BokehPass.js", () => { h.loads.push("dof"); return { BokehPass: fakePass("BokehPass") } })
vi.mock("three/examples/jsm/postprocessing/TAARenderPass.js", () => { h.loads.push("taa"); return { TAARenderPass: fakePass("TAARenderPass") } })
vi.mock("three/examples/jsm/shaders/FXAAShader.js", () => {
  h.loads.push("fxaa")
  return { FXAAShader: { uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() } }, vertexShader: "void main(){gl_Position=vec4(0.);}", fragmentShader: "void main(){gl_FragColor=vec4(1.);}" } }
})
vi.mock("three/examples/jsm/objects/Sky.js", async () => {
  h.loads.push("sky")
  const T = await import("three")
  class Sky extends T.Mesh {
    constructor() {
      super(new T.BoxGeometry(1, 1, 1), new T.ShaderMaterial({ uniforms: { turbidity: { value: 0 }, rayleigh: { value: 0 }, sunPosition: { value: new T.Vector3() } } }))
    }
  }
  return { Sky }
})

const withSettings = (patch: Partial<RenderSettings>): RenderSettings => ({ ...DEFAULT_RENDER_SETTINGS, ...patch })
const on = <T extends { enabled: boolean }>(s: T): T => ({ ...s, enabled: true })
const names = (a: any) => a.composer.passes.map((p: any) => p.constructor.name)

describe("ThreeJSAdapter fidelity layer (fleet w4)", () => {
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

  it("imports jsm effect modules lazily, only for the effects that get enabled", async () => {
    expect(h.loads).toEqual([]) // nothing at module load or mount
    adapter.applyRenderSettings(withSettings({ ssao: on(DEFAULT_RENDER_SETTINGS.ssao) }))
    await adapter.whenFidelityReady()
    expect(h.loads).toEqual(["ssao"])
  })

  it("builds SSAO -> SSR -> DoF -> FXAA in order and disposes passes when disabled", async () => {
    const all = withSettings({ ssao: on(DEFAULT_RENDER_SETTINGS.ssao), ssr: on(DEFAULT_RENDER_SETTINGS.ssr), dof: on(DEFAULT_RENDER_SETTINGS.dof), antiAliasing: "fxaa" })
    adapter.applyRenderSettings(all)
    await adapter.whenFidelityReady()
    expect(names(a)).toEqual(["RenderPass", "SSAOPass", "SSRPass", "BokehPass", "ShaderPass"])
    expect(a.composer.passes.at(-1).renderToScreen).toBe(true)

    const ssao = a.composer.passes[1]
    adapter.applyRenderSettings({ ...all, ssao: DEFAULT_RENDER_SETTINGS.ssao })
    expect(ssao.dispose).toHaveBeenCalled()
    expect(names(a)).toEqual(["RenderPass", "SSRPass", "BokehPass", "ShaderPass"])

    const composer = a.composer
    const rest = [...composer.passes]
    adapter.applyRenderSettings(DEFAULT_RENDER_SETTINGS)
    expect(a.composer).toBeNull()
    for (const p of rest.filter((x: any) => vi.isMockFunction(x.dispose))) expect(p.dispose).toHaveBeenCalled()
  })

  it("TAA replaces the scene pass with TAARenderPass and stops the manual jitter", async () => {
    adapter.applyRenderSettings(withSettings({ antiAliasing: "taa" }))
    await adapter.whenFidelityReady()
    expect(names(a)).toEqual(["TAARenderPass"])
    adapter.renderFrame(16, 16)
    expect(adapter.state.postProcessState.taa.jitterSample).toEqual([0, 0])
  })

  it("configures renderer.shadowMap and both light shadows from settings", () => {
    const shadows = { enabled: true, resolution: 1024 as const, filterMode: "vsm" as const, bias: 0.002, normalBias: 0.03, pointShadows: true }
    adapter.applyRenderSettings(withSettings({ shadows }))
    expect(a.renderer.shadowMap.enabled).toBe(true)
    expect(a.renderer.shadowMap.type).toBe(THREE.VSMShadowMap)
    for (const light of [a.directionalLight, a.pointLight]) {
      expect(light.castShadow).toBe(true)
      expect(light.shadow.mapSize.x).toBe(1024)
      expect(light.shadow.bias).toBe(0.002)
      expect(light.shadow.normalBias).toBe(0.03)
    }
    expect(a.shadowCatcher.visible).toBe(true)
    expect(a.mesh.castShadow).toBe(true)

    adapter.applyRenderSettings(withSettings({ shadows: { ...shadows, filterMode: "pcf", pointShadows: false } }))
    expect(a.renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap)
    expect(a.pointLight.castShadow).toBe(false)

    adapter.applyRenderSettings(DEFAULT_RENDER_SETTINGS)
    expect(a.renderer.shadowMap.enabled).toBe(false)
    expect(a.directionalLight.castShadow).toBe(false)
    expect(a.shadowCatcher.visible).toBe(false)
  })

  it("deferred creates an MRT G-buffer and forward releases it", () => {
    adapter.applyRenderSettings(withSettings({ renderMode: "deferred", gbufferDebugView: "normal" }))
    const mrt = a.gBufferRenderTarget as THREE.WebGLRenderTarget
    expect(mrt).toBeInstanceOf(THREE.WebGLRenderTarget)
    expect(mrt.textures.length).toBeGreaterThan(1)
    expect(adapter.getGBufferTextures()).not.toBeNull()
    expect(a.deferredLightingMaterial.uniforms.u_debugView.value).toBe(0) // applied on the next frame
    adapter.renderFrame(16, 16)
    expect(a.deferredLightingMaterial.uniforms.u_debugView.value).toBe(2)
    expect(a.scene.overrideMaterial).toBeNull() // override restored after the G-buffer pass

    const mrtDispose = vi.spyOn(mrt, "dispose")
    const albedoDispose = vi.spyOn(a.albedoTarget, "dispose")
    adapter.applyRenderSettings(withSettings({ renderMode: "forward" }))
    expect(mrtDispose).toHaveBeenCalled()
    expect(albedoDispose).toHaveBeenCalled()
    expect(a.gBufferRenderTarget).toBeNull()
    expect(adapter.getGBufferTextures()).toBeNull()
  })

  it("G-buffer keeps real numeric texture formats and a valid depth format/type pair (WebGL needs both)", () => {
    adapter.applyRenderSettings(withSettings({ renderMode: "deferred" }))
    adapter.renderFrame(16, 16)
    const mrt = a.gBufferRenderTarget as THREE.WebGLRenderTarget
    const depth = mrt.depthTexture!
    expect([THREE.DepthFormat, THREE.DepthStencilFormat]).toContain(depth.format)
    expect([THREE.UnsignedIntType, THREE.UnsignedShortType, THREE.FloatType, THREE.UnsignedInt248Type]).toContain(depth.type)
    expect(h.depths.length).toBeGreaterThan(0)
    for (const [format, type] of h.depths) {
      expect([THREE.DepthFormat, THREE.DepthStencilFormat]).toContain(format)
      expect(typeof type).toBe("number")
    }
    for (const t of [...mrt.textures, a.albedoTarget.texture, depth]) expect(typeof t.format).toBe("number")
    // parity descriptors wrap the textures instead of overwriting them
    const targets = adapter.getGBufferTextures() as any
    expect(targets.depth.format).toBe("depth24plus-stencil8")
    expect(targets.depth.texture).toBe(depth)
    expect(targets.albedo.width).toBeGreaterThan(0)
  })

  it("never constructs or resizes a render target with a zero dimension", async () => {
    h.targets.length = 0
    const canvas = env.createCanvas() as any
    canvas.width = 0
    canvas.height = 0
    const b = new ThreeJSAdapter()
    b.setExternalLoopDriven(true)
    await b.mount(canvas)
    b.resize(0, 0)
    b.applyRenderSettings(withSettings({ renderMode: "deferred", ssao: on(DEFAULT_RENDER_SETTINGS.ssao), antiAliasing: "fxaa" }))
    await b.whenFidelityReady()
    b.resize(0, 0)
    b.renderFrame(16, 16)
    b.resize(320, 200)
    b.dispose()
    expect(h.targets.length).toBeGreaterThan(0)
    for (const [w, hh] of h.targets) { expect(w).toBeGreaterThan(0); expect(hh).toBeGreaterThan(0) }
  })

  it("deferred mode runs fidelity passes on top of the lighting quad", async () => {
    adapter.applyRenderSettings(withSettings({ renderMode: "deferred", ssao: on(DEFAULT_RENDER_SETTINGS.ssao) }))
    await adapter.whenFidelityReady()
    expect(names(a)).toEqual(["RenderPass", "SSAOPass"])
    expect(a.composer.passes[0].scene).toBe(a.deferredLightingScene)
  })

  it("drives the Sky and sun light from non-default atmosphere settings", async () => {
    adapter.applyRenderSettings(withSettings({ atmosphere: { timeOfDay: 9, sunIntensity: 2, turbidity: 6, solarElevationDeg: 30 } }))
    await adapter.whenFidelityReady()
    expect(a.sky).toBeTruthy()
    expect(a.sky.material.uniforms.turbidity.value).toBe(6)
    expect(a.directionalLight.intensity).toBeCloseTo(1.6)
    adapter.renderFrame(16, 16)
    expect(a.sky.visible).toBe(true)
  })

  it("a rejecting sky loader surfaces an error and does not poison later fidelity loads", async () => {
    const orig = FX_LOADERS.sky
    FX_LOADERS.sky = () => Promise.reject(new Error("boom"))
    try {
      useProjectStore.getState().setLastCompileError(null as any)
      adapter.applyRenderSettings(withSettings({ atmosphere: { timeOfDay: 9, sunIntensity: 2, turbidity: 6, solarElevationDeg: 30 } }))
      await expect(adapter.whenFidelityReady()).resolves.toBeUndefined()
      expect(String(useProjectStore.getState().lastCompileError)).toContain("sky load failed")
    } finally {
      FX_LOADERS.sky = orig
    }
    adapter.applyRenderSettings(withSettings({ ssao: on(DEFAULT_RENDER_SETTINGS.ssao) }))
    await expect(adapter.whenFidelityReady()).resolves.toBeUndefined()
    expect(names(a)).toContain("SSAOPass")
  })

  it("rebuilds nothing when the settings are unchanged", async () => {
    const s = withSettings({ ssao: on(DEFAULT_RENDER_SETTINGS.ssao), shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true } })
    adapter.applyRenderSettings(s)
    await adapter.whenFidelityReady()
    const composer = a.composer
    const setup = vi.spyOn(a, "setupPostProcess")
    const shadows = vi.spyOn(a, "applyShadows")
    const mode = vi.spyOn(a, "setRenderingPipelineMode")
    adapter.applyRenderSettings(structuredClone(s))
    expect(setup).not.toHaveBeenCalled()
    expect(shadows).not.toHaveBeenCalled()
    expect(mode).not.toHaveBeenCalled()
    expect(a.composer).toBe(composer)
  })

  it("renderToTarget returns the requested size, caches by source hash and restores renderer state", async () => {
    const r = a.renderer
    r.readRenderTargetPixels = vi.fn((_t: unknown, _x: number, _y: number, _w: number, _h: number, buf: Uint8Array) => buf.fill(200))
    const frag = "void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }"
    r.autoClear = false
    r.setRenderTarget.mockClear()
    r.setClearColor.mockClear()

    const img = await adapter.renderToTarget({ nodeId: "n", source: { glsl: frag }, width: 64, height: 32 })
    expect(img).not.toBeNull()
    expect(img!.width).toBe(64)
    expect(img!.height).toBe(32)
    expect(img!.data.length).toBe(64 * 32 * 4)
    expect(r.setRenderTarget.mock.calls.at(-1)![0]).toBeNull() // previous target restored
    expect(r.setClearColor.mock.calls.at(-1)![1]).toBe(1) // previous alpha restored
    expect(r.autoClear).toBe(false)

    await adapter.renderToTarget({ nodeId: "n", source: { glsl: frag }, width: 64, height: 32 })
    expect(a.previewMaterials.size).toBe(1)
    await adapter.renderToTarget({ nodeId: "n", source: { glsl: frag.replace("1.0, 0.0", "0.0, 1.0") }, width: 16, height: 16 })
    expect(a.previewMaterials.size).toBe(2)

    const reads = r.readRenderTargetPixels.mock.calls.length
    adapter.renderFrame(16, 16)
    expect(r.readRenderTargetPixels.mock.calls.length).toBe(reads) // never inside renderFrame
    expect(await adapter.renderToTarget({ nodeId: "n", source: { wgsl: "x" }, width: 4, height: 4 })).toBeNull()
  })

  it("reports unsupported settings and the effective shadow filter via getFidelityCapabilities", () => {
    expect(adapter.getFidelityCapabilities()).toEqual({ effectiveShadowFilter: "pcf", unsupported: ["ssao.intensity", "dof.bokehShape", "ssr.iblBlend"] })
  })
})
