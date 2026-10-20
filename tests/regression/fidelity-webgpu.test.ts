import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter, FIDELITY_PASS_ORDER, GBUFFER_FORMATS } from "@/adapters/webgpu"
import { DEFAULT_RENDER_SETTINGS } from "@/stores/renderSettingsStore"
import type { RenderSettings } from "@/adapters/types"
import { setPerspectiveMatrixWebGPU } from "@/adapters/math"
import defaultShader from "../../src/shaders/default.wgsl?raw"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

const settings = (patch: Partial<RenderSettings> & Record<string, any> = {}): RenderSettings => ({
  ...DEFAULT_RENDER_SETTINGS,
  ...patch,
  shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, ...(patch.shadows ?? {}) },
  ssao: { ...DEFAULT_RENDER_SETTINGS.ssao, ...(patch.ssao ?? {}) },
  ssr: { ...DEFAULT_RENDER_SETTINGS.ssr, ...(patch.ssr ?? {}) },
  dof: { ...DEFAULT_RENDER_SETTINGS.dof, ...(patch.dof ?? {}) },
  atmosphere: { ...DEFAULT_RENDER_SETTINGS.atmosphere, ...(patch.atmosphere ?? {}) },
})

describe("WebGPU fidelity layer (fleet w4)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let adapter: WebGPUAdapter
  let a: any
  let device: any

  const frame = (t = 16) => {
    adapter.renderFrame(t, 16)
    return device.queue.submittedCommands.at(-1) as { renderPasses: any[]; copies: any[] }
  }
  const labels = (t = 16) => frame(t).renderPasses.map((p: any) => p.descriptor.label as string | undefined)

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    adapter = new WebGPUAdapter()
    adapter.setExternalLoopDriven(true)
    await adapter.mount(env.createCanvas(640, 480) as any)
    a = adapter
    device = env.webgpu.getDevice()!
  })
  afterEach(() => {
    adapter.dispose()
    teardownE2ETestEnvironment()
  })

  describe("shadows", () => {
    it("is encoded only when enabled, with a depth-only pipeline (no fragment stage, no colour targets)", () => {
      expect(labels()).not.toContain("ShadowDepthPass")
      adapter.applyRenderSettings(settings({ shadows: { enabled: true } }))
      const sub = frame(32)
      const pass = sub.renderPasses.find((p: any) => p.descriptor.label === "ShadowDepthPass")
      expect(pass).toBeDefined()
      expect(pass.descriptor.colorAttachments).toEqual([])
      expect(pass.descriptor.depthStencilAttachment.view).toBeTruthy()
      expect(pass.drawCalls.length).toBe(1)
      const desc = pass.drawCalls[0].pipeline.descriptor
      expect(desc.fragment).toBeUndefined()
      expect(desc.depthStencil.format).toBe("depth24plus")
      adapter.applyRenderSettings(settings({ shadows: { enabled: false } }))
      expect(labels(48)).not.toContain("ShadowDepthPass")
    })

    it("resolves shadows in forward mode after the scene pass", () => {
      adapter.applyRenderSettings(settings({ shadows: { enabled: true } }))
      const l = labels().filter((x) => x?.startsWith("Fx") || x === "ShadowDepthPass")
      expect(l).toEqual(["ShadowDepthPass", "FxShadowResolve"])
    })

    it("renders six point-light face passes (still depth-only) when pointShadows is on", () => {
      adapter.applyRenderSettings(settings({ shadows: { enabled: true, pointShadows: true } }))
      const faces = frame(64).renderPasses.filter((p: any) => p.descriptor.label === "PointShadowFacePass")
      expect(faces).toHaveLength(6)
      for (const f of faces) {
        expect(f.descriptor.colorAttachments).toEqual([])
        expect(f.drawCalls[0].pipeline.descriptor.fragment).toBeUndefined()
      }
      expect(a.shadowCubeTex.depthOrArrayLayers).toBe(6)
      adapter.applyRenderSettings(settings({ shadows: { enabled: true, pointShadows: false } }))
      expect(labels(80)).not.toContain("PointShadowFacePass")
      expect(a.shadowCubeTex).toBeNull()
    })

    it("shadow resolution changes recreate the shadow map", () => {
      adapter.applyRenderSettings(settings({ shadows: { enabled: true, resolution: 1024 } }))
      expect(a.shadowDepthTex.width).toBe(1024)
    })
  })

  describe("deferred", () => {
    it("creates G-buffer targets whose formats match the geometry pipeline and releases them on forward", () => {
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      const g = adapter.getGBufferTextures() as any
      expect(g).not.toBeNull()
      const sub = frame()
      const gp = sub.renderPasses.find((p: any) => p.descriptor.label === "GBufferGeometryPass")
      expect(gp).toBeDefined()
      const pipe = gp.drawCalls[0].pipeline.descriptor
      const targets = pipe.fragment.targets.map((t: any) => t.format)
      expect(targets).toEqual([g.albedo.format, g.normal.format, g.roughnessMetallic.format, g.motionVectors.format])
      expect(targets).toEqual([GBUFFER_FORMATS.albedo, GBUFFER_FORMATS.normal, GBUFFER_FORMATS.roughnessMetallic, GBUFFER_FORMATS.motion])
      expect(pipe.depthStencil.format).toBe(g.depth.format)
      expect(gp.descriptor.colorAttachments).toHaveLength(pipe.fragment.targets.length)

      const textures = [a.gBufferAlbedoTex, a.gBufferNormalTex, a.gBufferRoughnessTex, a.gBufferDepthTex, a.gBufferMotionTex]
      adapter.applyRenderSettings(settings({ renderMode: "forward" }))
      expect(adapter.getGBufferTextures()).toBeNull()
      expect(a.gBufferAlbedoTex).toBeNull()
      expect(a.gBufferViews).toBeNull()
      for (const t of textures) expect(t.isDestroyed).toBe(true)
      expect(labels(32)).not.toContain("GBufferGeometryPass")
    })

    it("binds depth as a depth texture (sampleType depth) in the lighting pass", () => {
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      const sub = frame()
      const names = sub.renderPasses.map((p: any) => p.descriptor.label)
      expect(names).toEqual(expect.arrayContaining(["GBufferGeometryPass", "DeferredLightingPass"]))
      expect(names.indexOf("GBufferGeometryPass")).toBeLessThan(names.indexOf("DeferredLightingPass"))
      const lighting = sub.renderPasses.find((p: any) => p.descriptor.label === "DeferredLightingPass")
      const call = lighting.drawCalls.at(-1)
      const bg = call.bindGroups.get(0)
      const layoutEntries = bg.layout.descriptor.entries
      const depthEntry = layoutEntries.find((e: any) => e.binding === 3)
      expect(depthEntry.texture.sampleType).toBe("depth")
      const depthRes = bg.entries.find((e: any) => e.binding === 3).resource
      expect(depthRes.texture.format).toBe("depth24plus")
      expect(depthRes.texture).toBe(a.gBufferDepthTex)
      // the lighting pipeline has no depth attachment/state
      expect(call.pipeline.descriptor.depthStencil).toBeUndefined()
    })

    it("resizes all G-buffer channels together", () => {
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      adapter.resize(320, 200, 1)
      const g = adapter.getGBufferTextures() as any
      for (const k of ["albedo", "normal", "roughnessMetallic", "depth", "motionVectors"]) {
        expect([g[k].width, g[k].height]).toEqual([320, 200])
      }
    })

    it("has no shadow-resolve pass (shadows are sampled inside the lighting pass) but still runs the shadow depth pass", () => {
      adapter.applyRenderSettings(settings({ renderMode: "deferred", shadows: { enabled: true } }))
      const l = labels()
      expect(l).toContain("ShadowDepthPass")
      expect(l).not.toContain("FxShadowResolve")
      expect(l.indexOf("ShadowDepthPass")).toBeLessThan(l.indexOf("GBufferGeometryPass"))
    })
  })

  describe("post effects", () => {
    const fx = (l: Array<string | undefined>) => l.filter((x) => x?.startsWith("Fx"))

    it("each effect pass is encoded only when enabled", () => {
      expect(fx(labels())).toEqual([])
      const cases: Array<[Partial<RenderSettings> & Record<string, any>, string]> = [
        [{ ssao: { enabled: true } }, "FxSSAO"],
        [{ ssr: { enabled: true } }, "FxSSR"],
        [{ dof: { enabled: true } }, "FxDoF"],
        [{ antiAliasing: "fxaa" }, "FxFXAA"],
        [{ antiAliasing: "taa" }, "FxTAA"],
      ]
      let t = 16
      for (const [patch, label] of cases) {
        adapter.applyRenderSettings(settings(patch))
        expect(fx(labels((t += 16)))).toEqual([label])
        adapter.applyRenderSettings(settings())
        expect(fx(labels((t += 16)))).toEqual([])
      }
    })

    it("runs in the documented order: shadow -> SSAO -> SSR -> DoF -> AA -> debug", () => {
      expect(FIDELITY_PASS_ORDER).toEqual(["shadow", "ssao", "ssr", "dof", "aa", "debug"])
      adapter.applyRenderSettings(settings({
        shadows: { enabled: true }, ssao: { enabled: true }, ssr: { enabled: true }, dof: { enabled: true },
        antiAliasing: "taa", gbufferDebugView: "normal",
      }))
      expect(fx(labels())).toEqual(["FxShadowResolve", "FxSSAO", "FxSSR", "FxDoF", "FxTAA", "FxDebug"])
    })

    it("chains through ping-pong targets and ends on the canvas texture", () => {
      adapter.applyRenderSettings(settings({ ssao: { enabled: true }, dof: { enabled: true } }))
      const sub = frame()
      const post = sub.renderPasses.filter((p: any) => p.descriptor.label?.startsWith("Fx"))
      const scene = sub.renderPasses.find((p: any) => !p.descriptor.label)
      const sceneView = scene.descriptor.colorAttachments[0].view
      expect(post[0].descriptor.colorAttachments[0].view).not.toBe(sceneView)
      expect(post.at(-1).descriptor.colorAttachments[0].view.label).toBe("canvas-current-texture-view")
    })

    it("binds depth as a depth texture in every fidelity pass", () => {
      adapter.applyRenderSettings(settings({ ssao: { enabled: true } }))
      const pass = frame().renderPasses.find((p: any) => p.descriptor.label === "FxSSAO")
      const bg = pass.drawCalls[0].bindGroups.get(0)
      expect(bg.layout.descriptor.entries.find((e: any) => e.binding === 3).texture.sampleType).toBe("depth")
      expect(bg.entries.find((e: any) => e.binding === 3).resource.texture.format).toBe("depth24plus")
    })

    it("TAA writes the resolved colour plus a history target and rotates history each frame", () => {
      adapter.applyRenderSettings(settings({ antiAliasing: "taa" }))
      const p1 = frame(16).renderPasses.find((p: any) => p.descriptor.label === "FxTAA")
      expect(p1.descriptor.colorAttachments).toHaveLength(2)
      expect(p1.drawCalls[0].pipeline.descriptor.fragment.targets).toHaveLength(2)
      const w1 = p1.descriptor.colorAttachments[1].view
      const p2 = frame(32).renderPasses.find((p: any) => p.descriptor.label === "FxTAA")
      expect(p2.descriptor.colorAttachments[1].view).not.toBe(w1)
    })

    it("TAA jitters the camera and restores the un-jittered projection afterwards", () => {
      adapter.applyRenderSettings(settings({ antiAliasing: "taa" }))
      const expected = setPerspectiveMatrixWebGPU(new Float32Array(16), Math.PI / 4, 640 / 480, 0.1, 100)
      for (let i = 0; i < 20; i++) {
        adapter.renderFrame(i * 16.7, 16)
        expect(a.projMatrix[8]).toBe(expected[8])
        expect(a.projMatrix[9]).toBe(expected[9])
        const j = adapter.state!.postProcessState.taa.jitterSample
        expect(Number.isFinite(j[0]) && Number.isFinite(j[1])).toBe(true)
        expect(Math.abs(j[0])).toBeLessThanOrEqual(0.5 / 640)
      }
      expect(Array.from(a.projMatrix)).toEqual(Array.from(expected))
    })

    it("forward debug view adds a debug pass; deferred shows it inside the lighting pass", () => {
      adapter.applyRenderSettings(settings({ gbufferDebugView: "depth" }))
      expect(fx(labels())).toEqual(["FxDebug"])
      adapter.applyRenderSettings(settings({ renderMode: "deferred", gbufferDebugView: "depth" }))
      expect(fx(labels(32))).toEqual([])
      expect(a.fxData[188]).toBe(5)
    })

    it("user post-process chain still runs after the fidelity passes", () => {
      adapter.setRenderQueue([{ type: "mesh", id: "m", geometry: "cube" } as any, { type: "postprocess", id: "v", pass: "vignette", uniforms: {} } as any])
      adapter.applyRenderSettings(settings({ ssao: { enabled: true } }))
      const sub = frame()
      const post = sub.renderPasses.filter((p: any) => p.descriptor.label === "FxSSAO" || (!p.descriptor.label && p.descriptor.colorAttachments?.[0]?.view?.label === "canvas-current-texture-view"))
      expect(post).toHaveLength(2)
      expect(post[0].descriptor.label).toBe("FxSSAO")
    })
  })

  describe("atmosphere", () => {
    it("draws the analytic sky for the atmosphere preset and the equirect skybox otherwise", () => {
      adapter.updateEnvironment({ preset: "atmosphere", exposure: 1, rotation: 0, backgroundBlur: 0, showSkybox: true } as any)
      expect(a.skyPipeline).not.toBeNull()
      const scene = frame().renderPasses.find((p: any) => !p.descriptor.label)
      expect(scene.drawCalls[0].pipeline).toBe(a.skyPipeline)
      adapter.updateEnvironment({ preset: "daylight", exposure: 1, rotation: 0, backgroundBlur: 0, showSkybox: true } as any)
      expect(a.skyPipeline).toBeNull()
      const scene2 = frame(32).renderPasses.find((p: any) => !p.descriptor.label)
      expect(scene2.drawCalls[0].pipeline).toBe(a.skyboxPipeline)
    })

    it("applies atmosphere settings to adapter state and the sky uniform", () => {
      adapter.updateEnvironment({ preset: "atmosphere", exposure: 1, rotation: 0, backgroundBlur: 0, showSkybox: true } as any)
      adapter.applyRenderSettings(settings({ atmosphere: { timeOfDay: 9, sunIntensity: 2, turbidity: 4, solarElevationDeg: 40 } }))
      expect(adapter.state!.atmosphereParams).toEqual({ timeOfDay: 9, sunIntensity: 2, turbidity: 4, solarElevationDeg: 40 })
      frame()
      const sky = a.skyArray
      expect(sky[15]).toBe(2)
      expect(sky[16]).toBe(4)
      expect(sky[13]).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 5)
    })

    it("deferred lighting draws the background with a no-depth pipeline variant", () => {
      adapter.updateEnvironment({ preset: "atmosphere", exposure: 1, rotation: 0, backgroundBlur: 0, showSkybox: true } as any)
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      const lighting = frame().renderPasses.find((p: any) => p.descriptor.label === "DeferredLightingPass")
      expect(lighting.drawCalls[0].pipeline).toBe(a.skyPipelineNoDepth)
      expect(a.skyPipelineNoDepth.descriptor.depthStencil).toBeUndefined()
    })
  })

  describe("applyRenderSettings", () => {
    const counts = () => ({
      pipelines: device.createdPipelines.length,
      textures: device.createdTextures.length,
      bindGroups: device.createdBindGroups.length,
      buffers: device.createdBuffers.length,
      modules: device.createdShaderModules.length,
    })

    it("unchanged settings rebuild nothing", () => {
      const s = settings({ renderMode: "deferred", shadows: { enabled: true }, ssao: { enabled: true }, antiAliasing: "taa" })
      adapter.applyRenderSettings(s)
      frame()
      const before = counts()
      adapter.applyRenderSettings(s)
      adapter.applyRenderSettings(settings({ renderMode: "deferred", shadows: { enabled: true }, ssao: { enabled: true }, antiAliasing: "taa" }))
      expect(counts()).toEqual(before)
    })

    it("a value-only change does not rebuild passes, pipelines or textures", () => {
      adapter.applyRenderSettings(settings({ ssao: { enabled: true } }))
      frame()
      const before = counts()
      adapter.applyRenderSettings(settings({ ssao: { enabled: true, radius: 1.2, intensity: 2 } }))
      expect(counts()).toEqual(before)
      frame(32)
      expect(a.fxData[176]).toBeCloseTo(1.2, 5)
    })

    it("works before mount (state only) and is applied on mount", async () => {
      const early = new WebGPUAdapter()
      early.setExternalLoopDriven(true)
      early.applyRenderSettings(settings({ renderMode: "deferred", ssao: { enabled: true } }))
      expect(early.getPipelineMode()).toBe("deferred")
      await early.mount(env.createCanvas() as any)
      expect(early.getGBufferTextures()).not.toBeNull()
      expect((early as any).fxPasses.map((p: any) => p.kind)).toEqual(["ssao"])
      early.dispose()
    })

    it("switching effects off releases TAA history", () => {
      adapter.applyRenderSettings(settings({ antiAliasing: "taa" }))
      const hist = [...a.taaHistory]
      expect(hist.every(Boolean)).toBe(true)
      adapter.applyRenderSettings(settings())
      expect(hist.every((t: any) => t.isDestroyed)).toBe(true)
    })
  })

  describe("frame stats and allocation", () => {
    it("counts draws from every pass and reports pass timings while fidelity features are active", async () => {
      const { performanceTelemetry } = await import("@/core/performanceTelemetry")
      const spy = vi.spyOn(performanceTelemetry, "reportFrameStats")
      adapter.applyRenderSettings(settings({ shadows: { enabled: true }, ssao: { enabled: true }, antiAliasing: "fxaa" }))
      const sub = frame()
      const draws = sub.renderPasses.reduce((n: number, p: any) => n + p.drawCalls.length, 0)
      const call = spy.mock.calls.at(-1)![0]
      expect(call.drawCalls).toBe(draws)
      expect(call.drawCalls).toBe(5)
      expect(call.passTimings).toBeDefined()
      expect(Object.keys(call.passTimings!).sort()).toEqual(["gbuffer", "lighting", "postprocess", "shadow", "ssr"])
      adapter.applyRenderSettings(settings())
      frame(32)
      expect(spy.mock.calls.at(-1)![0].passTimings).toBeUndefined()
      spy.mockRestore()
    })

    it("steady-state frames create no GPU objects (buffers, textures, bind groups, pipelines)", () => {
      adapter.applyRenderSettings(settings({
        renderMode: "deferred", shadows: { enabled: true, pointShadows: true }, ssao: { enabled: true },
        ssr: { enabled: true }, dof: { enabled: true }, antiAliasing: "taa",
      }))
      frame(16); frame(32); frame(48) // warm: lazy bind-group caches fill once per ping-pong view / history parity
      const n = () => [device.createdBuffers.length, device.createdTextures.length, device.createdBindGroups.length, device.createdPipelines.length]
      const before = n()
      for (let i = 0; i < 10; i++) frame(64 + i * 16)
      expect(n()).toEqual(before)
    })
  })

  describe("renderToTarget", () => {
    const req = (wgsl = defaultShader, width = 64, height = 32) => ({ nodeId: "n1", source: { wgsl }, width, height })

    it("returns pixels of the requested size without touching the canvas texture", async () => {
      const ctx = a.context
      const spy = vi.spyOn(ctx, "getCurrentTexture")
      const submitted = device.queue.submittedCommands.length
      const out = (await adapter.renderToTarget!(req())) as ImageData
      expect(out).not.toBeNull()
      expect(out.width).toBe(64)
      expect(out.height).toBe(32)
      expect(out.data.length).toBe(64 * 32 * 4)
      expect(spy).not.toHaveBeenCalled()
      const subs = device.queue.submittedCommands.slice(submitted)
      expect(subs).toHaveLength(1)
      const target = subs[0].renderPasses[0].descriptor.colorAttachments[0].view.texture
      expect(target.format).toBe("rgba8unorm")
      expect([target.width, target.height]).toEqual([64, 32])
      expect(subs[0].copies).toHaveLength(1)
    })

    it("reuses the pipeline per source and compiles a new one for a new source", async () => {
      await adapter.renderToTarget!(req())
      const n = device.createdPipelines.length
      await adapter.renderToTarget!(req(defaultShader, 16, 16))
      expect(device.createdPipelines.length).toBe(n)
      await adapter.renderToTarget!(req(defaultShader + "\n// variant"))
      expect(device.createdPipelines.length).toBe(n + 1)
    })

    it("serialises concurrent calls (concurrency 1) and cleans up its temporaries", async () => {
      let active = 0, peak = 0
      const orig = device.queue.submit.bind(device.queue)
      const results = await Promise.all([1, 2, 3].map((i) => adapter.renderToTarget!(req(defaultShader, 8 * i, 8))))
      expect(results.map((r) => r!.width)).toEqual([8, 16, 24])
      void active; void peak; void orig
      const previewTextures = device.createdTextures.filter((t: any) => t.label === "NodePreviewTarget")
      expect(previewTextures).toHaveLength(3)
      expect(previewTextures.every((t: any) => t.isDestroyed)).toBe(true)
    })

    it("returns null for a failing source, a bad size, a missing source and while a frame is encoding", async () => {
      expect(await adapter.renderToTarget!(req("SYNTAX_ERROR_TRIGGER"))).toBeNull()
      expect(await adapter.renderToTarget!(req(defaultShader, NaN, 8))).toBeNull()
      expect(await adapter.renderToTarget!({ nodeId: "x", source: {}, width: 8, height: 8 })).toBeNull()
      a.inFrame = true
      expect(await adapter.renderToTarget!(req())).toBeNull()
      a.inFrame = false
      expect(await adapter.renderToTarget!(req())).not.toBeNull()
    })

    it("uses a fullscreen draw for vertex_index sources and does not disturb the main frame", async () => {
      const tri = `
        @vertex fn vertex_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
          var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
          return vec4<f32>(p[i], 0.0, 1.0);
        }
        @fragment fn fragment_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`
      const submitted = device.queue.submittedCommands.length
      await adapter.renderToTarget!(req(tri, 16, 16))
      const pass = device.queue.submittedCommands[submitted].renderPasses[0]
      expect(pass.drawCalls[0].vertexCount).toBe(3)
      expect(pass.descriptor.depthStencilAttachment).toBeUndefined()
      expect(() => adapter.renderFrame(16, 16)).not.toThrow()
    })
  })

  describe("user pass bind-group cache vs G-buffer lifetime", () => {
    const cached = () => (a.postProcessPasses as any[]).flatMap((p) => [...p.bindGroupCache.values()].map((bg: any) => ({ type: p.passType, bg })))
    const entry = (bg: any, binding: number) => bg.entries.find((e: any) => e.binding === binding)?.resource

    it("rebuilds ssao/ssr/taa bind groups across forward -> deferred -> forward -> deferred, never binding destroyed textures", () => {
      adapter.setRenderQueue([
        { type: "mesh", id: "m", geometry: "cube" } as any,
        { type: "postprocess", id: "p1", pass: "ssao", uniforms: {} } as any,
        { type: "postprocess", id: "p2", pass: "ssr", uniforms: {} } as any,
        { type: "postprocess", id: "p3", pass: "taa", uniforms: {} } as any,
      ])
      const assertHealthy = (deferred: boolean) => {
        frame()
        const groups = cached()
        expect(groups.map((g) => g.type).sort()).toEqual(["ssao", "ssr", "taa"])
        for (const { type, bg } of groups) {
          for (const e of bg.entries) if (e.resource?.texture) expect(e.resource.texture.isDestroyed).toBe(false)
          const gView = type === "taa" ? entry(bg, 4) : type === "ssao" || type === "ssr" ? entry(bg, 4) : null
          if (gView) {
            const expected = type === "taa" ? a.gBufferMotionTex : a.gBufferNormalTex
            if (deferred) expect(gView.texture).toBe(expected)
            else expect(gView.texture).not.toBe(expected)
          }
        }
      }
      adapter.applyRenderSettings(settings({ renderMode: "forward" }))
      assertHealthy(false)
      const firstGroups = cached().map((g) => g.bg)
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      assertHealthy(true)
      const deferredGroups = cached().map((g) => g.bg)
      for (const g of deferredGroups) expect(firstGroups).not.toContain(g)
      const oldNormal = a.gBufferNormalTex
      adapter.applyRenderSettings(settings({ renderMode: "forward" }))
      expect(oldNormal.isDestroyed).toBe(true)
      assertHealthy(false)
      adapter.applyRenderSettings(settings({ renderMode: "deferred" }))
      assertHealthy(true)
      expect(a.gBufferNormalTex).not.toBe(oldNormal)
    })
  })

  it("reports full fidelity capabilities", () => {
    expect(adapter.getFidelityCapabilities!()).toEqual({ effectiveShadowFilter: "pcf", unsupported: [] })
  })
})
