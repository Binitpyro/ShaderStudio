import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { DEFAULT_RENDER_SETTINGS } from "@/stores/renderSettingsStore"
import { useProjectStore } from "@/stores/projectStore"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import type { RenderSettings } from "@/adapters/types"

/** W4 fidelity layer on the WebGL2 backend (mock GL: asserts resources, bindings and pass order). */
describe("WebGL2 fidelity layer (fleet w4)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let adapter: WebGL2Adapter
  let gl: any
  const a = () => adapter as any
  const settings = (patch: Partial<RenderSettings> = {}): RenderSettings => ({
    ...DEFAULT_RENDER_SETTINGS,
    shadows: { ...DEFAULT_RENDER_SETTINGS.shadows },
    ssao: { ...DEFAULT_RENDER_SETTINGS.ssao },
    ssr: { ...DEFAULT_RENDER_SETTINGS.ssr },
    dof: { ...DEFAULT_RENDER_SETTINGS.dof },
    atmosphere: { ...DEFAULT_RENDER_SETTINGS.atmosphere },
    ...patch,
  })
  /** Order in which fidelity programs were activated during one frame. */
  const programOrder = (frame: () => void): string[] => {
    const byProgram = new Map<unknown, string>()
    for (const [key, fx] of a().fxPrograms as Map<string, any>) if (fx) byProgram.set(fx.program, key)
    const seq: string[] = []
    const orig = gl.useProgram.bind(gl)
    const spy = vi.spyOn(gl, "useProgram").mockImplementation((p: any) => {
      const k = byProgram.get(p) ?? [...(a().fxPrograms as Map<string, any>)].find(([, fx]) => fx?.program === p)?.[0]
      if (k && seq[seq.length - 1] !== k) seq.push(k)
      orig(p)
    })
    frame()
    spy.mockRestore()
    return seq
  }

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    adapter = new WebGL2Adapter()
    adapter.setExternalLoopDriven(true)
    await adapter.mount(env.createCanvas() as any)
    gl = env.webgl2.getLastContext()!
  })
  afterEach(() => {
    adapter.dispose()
    vi.unstubAllGlobals()
    teardownE2ETestEnvironment()
  })

  it("forward shadows: the depth pass renders into a depth texture that forward lighting samples", () => {
    adapter.applyRenderSettings(settings({ shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true } }))
    adapter.renderFrame(0, 16)

    const depth = a().shadowFBO.attachments.get(gl.DEPTH_ATTACHMENT)
    expect(depth).toBe(a().shadowMapTex)
    expect(depth.width).toBe(2048)
    const lit = a().fxPrograms.get("forwardLit")
    expect(lit).toBeTruthy()
    const fs = lit.program.shaders.find((s: any) => s.type === gl.FRAGMENT_SHADER).source as string
    expect(fs).toContain("u_shadowMap")
    expect(fs).toContain("dirShadow(")
    expect(gl.boundTextures.get(gl.TEXTURE0 + 10)).toBe(a().shadowMapTex)
    expect(gl.uniformValues.get("u_shadowEnabled")).toBe(1)
  })

  it("no shadow pass and no lit program while shadows are disabled", () => {
    adapter.renderFrame(0, 16)
    expect(a().shadowFBO).toBeNull()
    expect(a().fxPrograms.has("forwardLit")).toBe(false)
  })

  it("deferred writes a 4-target G-buffer with drawBuffers and releases every target when back in forward", () => {
    adapter.setRenderingPipelineMode("deferred")
    adapter.renderFrame(0, 16)
    expect(gl.drawBuffersList).toEqual([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3])
    const fbo = a().gBufferFBO
    expect([...fbo.attachments.keys()].sort()).toEqual([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3, gl.DEPTH_ATTACHMENT].sort())
    const textures = [a().gBufferAlbedoTex, a().gBufferNormalTex, a().gBufferRoughnessTex, a().gBufferMotionTex, a().gBufferDepthTex]
    expect(textures.every(Boolean)).toBe(true)

    adapter.setRenderingPipelineMode("forward")
    expect(a().gBufferFBO).toBeNull()
    expect(a().gBufferAlbedoTex).toBeNull()
    expect(fbo.isDestroyed).toBe(true)
    expect(textures.every((t) => t.isDestroyed)).toBe(true)
    expect(adapter.getGBufferTextures()).toBeNull()
  })

  it("deferred lighting declares and binds the point-light shadow cube", () => {
    adapter.applyRenderSettings(settings({
      renderMode: "deferred",
      shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, pointShadows: true },
    }))
    const faces = vi.spyOn(gl, "framebufferTexture2D")
    adapter.renderFrame(0, 16)

    const fs = a().deferredLightingProgram.shaders.find((s: any) => s.type === gl.FRAGMENT_SHADER).source as string
    expect(fs).toContain("samplerCube")
    expect(fs).toContain("u_shadowCubeMap")
    expect(gl.uniformValues.get("u_shadowCubeMap")).toBe(12)
    expect(gl.boundTextures.get(gl.TEXTURE0 + 12)).toBe(a().shadowCubeMapTex)
    const cubeFaces = faces.mock.calls.filter((c: any[]) => c[1] === gl.DEPTH_ATTACHMENT && c[2] >= gl.TEXTURE_CUBE_MAP_POSITIVE_X).map((c: any[]) => c[2] - gl.TEXTURE_CUBE_MAP_POSITIVE_X)
    expect(cubeFaces).toEqual([0, 1, 2, 3, 4, 5])
    expect(gl.uniformValues.get("u_pointParams")).toEqual([0.1, 1])
  })

  it("shadow filter modes reach the shader as a mode flag; VSM allocates a moments target", () => {
    adapter.applyRenderSettings(settings({ shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, filterMode: "vsm" } }))
    adapter.renderFrame(0, 16)
    expect(a().vsmTex).toBeTruthy()
    expect(gl.uniformValues.get("u_shadowParams")[3]).toBe(2)
    adapter.applyRenderSettings(settings({ shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, filterMode: "pcf" } }))
    expect(a().vsmTex).toBeNull()
  })

  it("post passes run only when enabled, in the documented order", () => {
    const off = programOrder(() => adapter.renderFrame(0, 16))
    expect(off).toEqual([])
    for (const k of ["ssao", "ssr", "dof", "fxaa", "taa", "composite"]) expect(a().fxPrograms.has(k)).toBe(false)

    adapter.applyRenderSettings(settings({
      antiAliasing: "fxaa",
      ssao: { ...DEFAULT_RENDER_SETTINGS.ssao, enabled: true },
      ssr: { ...DEFAULT_RENDER_SETTINGS.ssr, enabled: true },
      dof: { ...DEFAULT_RENDER_SETTINGS.dof, enabled: true },
    }))
    adapter.renderFrame(16, 16) // compile pass
    const forward = programOrder(() => adapter.renderFrame(32, 16))
    expect(forward).toEqual(["gbuffer", "ssao", "composite", "ssr", "dof", "fxaa"])

    adapter.applyRenderSettings(settings({
      renderMode: "deferred",
      ssao: { ...DEFAULT_RENDER_SETTINGS.ssao, enabled: true },
      ssr: { ...DEFAULT_RENDER_SETTINGS.ssr, enabled: true },
      dof: { ...DEFAULT_RENDER_SETTINGS.dof, enabled: true },
    }))
    const deferred = programOrder(() => adapter.renderFrame(48, 16))
    expect(deferred).toEqual(["gbuffer", "ssao", "lighting", "ssr", "dof"])
  })

  it("TAA jitters the rasterised matrix, then restores the projection", () => {
    adapter.applyRenderSettings(settings({ antiAliasing: "taa" }))
    adapter.renderFrame(0, 16)
    const j0 = [...a().state.postProcessState.taa.jitterSample]
    expect(a().projMatrix[8]).toBe(0)
    expect(a().projMatrix[9]).toBe(0)
    expect(Array.from(a().mvpMatrix)).not.toEqual(Array.from(a().mvpUnjit)) // rasterised with jitter
    adapter.renderFrame(0, 16)
    expect([...a().state.postProcessState.taa.jitterSample]).not.toEqual(j0) // Halton sequence advances
    expect(a().projMatrix[8]).toBe(0)
    expect(gl.uniformValues.get("u_historyValid")).toBe(1)
    adapter.applyRenderSettings(settings({ antiAliasing: "none" }))
    expect(a().taaHist).toHaveLength(0)
  })

  it("TAA shader rejects non-finite history and clamps to the neighbourhood", () => {
    const src = (a().fxPrograms.get("taa") ?? (adapter.applyRenderSettings(settings({ antiAliasing: "taa" })), adapter.renderFrame(0, 16), a().fxPrograms.get("taa")))
      .program.shaders.find((s: any) => s.type === gl.FRAGMENT_SHADER).source as string
    expect(src).toContain("isnan")
    expect(src).toContain("isinf")
    expect(src).toContain("clamp(toYCoCg(hist), lo, hi)")
  })

  it("atmosphere settings drive the sky pass", () => {
    useProjectStore.getState().setEnvironmentSettings?.({ preset: "atmosphere", showSkybox: true } as any)
    adapter.updateEnvironment({ ...useProjectStore.getState().environmentSettings, preset: "atmosphere", showSkybox: true } as any)
    adapter.applyRenderSettings(settings({ atmosphere: { timeOfDay: 18, sunIntensity: 2, turbidity: 4, solarElevationDeg: 30 } }))
    adapter.renderFrame(0, 16)
    expect(a().fxPrograms.get("sky")).toBeTruthy()
    expect(gl.uniformValues.get("u_skyParams")).toEqual([2, 4, 0])
    const sun = gl.uniformValues.get("u_sunDir") as number[]
    expect(sun[1]).toBeCloseTo(Math.sin((30 * Math.PI) / 180), 5)
  })

  it("G-buffer debug view reaches the lighting pass", () => {
    adapter.applyRenderSettings(settings({ renderMode: "deferred", gbufferDebugView: "normal" }))
    adapter.renderFrame(0, 16)
    expect(gl.uniformValues.get("u_debugView")).toBe(2)
    expect(adapter.getGBufferDebugView()).toBe("normal")
  })

  it("applying unchanged settings rebuilds nothing", () => {
    const s = settings({ renderMode: "deferred", antiAliasing: "taa", ssao: { ...DEFAULT_RENDER_SETTINGS.ssao, enabled: true }, shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, pointShadows: true } })
    adapter.applyRenderSettings(s)
    adapter.renderFrame(0, 16)
    const counts = () => [gl.createdTextures.length, gl.createdFramebuffers.length, gl.createdPrograms.length, gl.createdVAOs.length]
    const before = counts()
    const spies = ["createTexture", "createFramebuffer", "createProgram"].map((m) => vi.spyOn(gl, m))
    adapter.applyRenderSettings(JSON.parse(JSON.stringify(s)))
    adapter.renderFrame(16, 16)
    expect(spies.every((sp) => sp.mock.calls.length === 0)).toBe(true)
    expect(counts()).toEqual(before)
    // a single changed section only touches its own resources
    adapter.applyRenderSettings({ ...s, ssr: { ...s.ssr, maxSteps: 32 } })
    expect(gl.createdFramebuffers.length).toBe(before[1])
  })

  it("steady-state fidelity frames never query uniform locations or allocate new GL objects", () => {
    adapter.applyRenderSettings(settings({
      renderMode: "deferred", antiAliasing: "taa",
      ssao: { ...DEFAULT_RENDER_SETTINGS.ssao, enabled: true }, ssr: { ...DEFAULT_RENDER_SETTINGS.ssr, enabled: true }, dof: { ...DEFAULT_RENDER_SETTINGS.dof, enabled: true },
      shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, pointShadows: true },
    }))
    adapter.renderFrame(0, 16); adapter.renderFrame(16, 16)
    const loc = vi.spyOn(gl, "getUniformLocation")
    const tex = vi.spyOn(gl, "createTexture")
    for (let i = 2; i < 8; i++) adapter.renderFrame(i * 16, 16)
    expect(loc).not.toHaveBeenCalled()
    expect(tex).not.toHaveBeenCalled()
  })

  it("reports draw calls and triangles for every pass", () => {
    const report = vi.spyOn(performanceTelemetry, "reportFrameStats")
    adapter.applyRenderSettings(settings({ renderMode: "deferred", shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true } }))
    adapter.renderFrame(0, 16)
    // shadow (12) + G-buffer mesh (12) + G-buffer ground (2) + lighting quad (2)
    expect(report).toHaveBeenLastCalledWith({ drawCalls: 4, triangles: 28 })
  })

  describe("renderToTarget", () => {
    const FRAG = "#version 300 es\nprecision highp float;\nin vec2 v_uv;\nout vec4 o;\nvoid main(){ o = vec4(v_uv, 0.0, 1.0); }"

    it("renders offscreen at the requested size and restores framebuffer, viewport and program", async () => {
      adapter.renderFrame(0, 16)
      const fbBefore = gl.boundFramebuffer
      const vpBefore = { ...gl.viewportRect }
      const progBefore = gl.activeProgram
      const img = await adapter.renderToTarget!({ nodeId: "n1", source: { glsl: FRAG }, width: 64, height: 32 })
      expect(img).not.toBeNull()
      expect((img as ImageData).width).toBe(64)
      expect((img as ImageData).height).toBe(32)
      expect((img as ImageData).data.length).toBe(64 * 32 * 4)
      expect(gl.readPixelsCalls.at(-1)).toMatchObject({ width: 64, height: 32 })
      expect(gl.readPixelsCalls.at(-1).framebuffer).not.toBe(fbBefore) // read from the offscreen target
      expect(gl.boundFramebuffer).toBe(fbBefore)
      expect(gl.viewportRect).toEqual(vpBefore)
      expect(gl.activeProgram).toBe(progBefore)
    })

    it("applies the supplied uniform values and time to the preview program", async () => {
      const src = "#version 300 es\nprecision highp float;\nuniform float u_time;\nuniform float pu_amount;\nuniform vec3 pu_tint;\nout vec4 o;\nvoid main(){ o = vec4(pu_tint * pu_amount, 1.0); }"
      await adapter.renderToTarget!({
        nodeId: "u", source: { glsl: src }, width: 8, height: 8,
        uniforms: { pu_amount: { type: "float", value: 0.75 }, pu_tint: { type: "vec3", value: [1, 0.5, 0.25] }, time: { type: "float", value: 2.5 } },
      })
      expect(gl.uniformValues.get("pu_amount")).toBe(0.75)
      expect(gl.uniformValues.get("pu_tint")).toEqual([1, 0.5, 0.25])
      expect(gl.uniformValues.get("u_time")).toBe(2.5)
    })

    it("also restores clear colour, blend, scissor and the active-unit TEXTURE_2D binding", async () => {
      adapter.renderFrame(0, 16)
      const tex = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 ?? 0x84c0 + 3)
      const unit = gl.activeTextureUnit
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.clearColor(0.1, 0.2, 0.3, 0.4)
      gl.enable(gl.BLEND); gl.blendFuncSeparate(0x302, 0x303, 1, 0)
      gl.enable(gl.SCISSOR_TEST); gl.scissor(1, 2, 3, 4)
      const img = await adapter.renderToTarget!({ nodeId: "state", source: { glsl: FRAG }, width: 8, height: 8 })
      expect(img).not.toBeNull()
      expect(gl.clearColorValues).toEqual([0.1, 0.2, 0.3, 0.4])
      expect(gl.isEnabled(gl.BLEND)).toBe(true)
      expect(gl.blendFn).toEqual([0x302, 0x303, 1, 0])
      expect(gl.isEnabled(gl.SCISSOR_TEST)).toBe(true)
      expect(gl.scissorBox).toEqual([1, 2, 3, 4])
      expect(gl.activeTextureUnit).toBe(unit)
      expect(gl.boundTextures.get(unit)).toBe(tex)
    })

    it("logs once and resolves null when a render throws", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      vi.spyOn(gl, "drawArrays").mockImplementation(() => { throw new Error("gl boom") })
      const req = { nodeId: "t", source: { glsl: FRAG }, width: 8, height: 8 }
      expect(await adapter.renderToTarget!(req)).toBeNull()
      expect(await adapter.renderToTarget!(req)).toBeNull()
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("renderToTarget failed"))).toHaveLength(1)
      warn.mockRestore()
    })

    it("caches programs by source and serialises concurrent requests", async () => {
      const before = gl.createdPrograms.length
      const [x, y] = await Promise.all([
        adapter.renderToTarget!({ nodeId: "a", source: { glsl: FRAG }, width: 8, height: 8 }),
        adapter.renderToTarget!({ nodeId: "b", source: { glsl: FRAG }, width: 16, height: 4 }),
      ])
      expect((x as ImageData).width).toBe(8)
      expect((y as ImageData).height).toBe(4)
      expect(gl.createdPrograms.length - before).toBe(1)
    })

    it("resolves null for missing or invalid source without touching the editor's compile error", async () => {
      expect(await adapter.renderToTarget!({ nodeId: "x", source: {}, width: 8, height: 8 })).toBeNull()
      expect(await adapter.renderToTarget!({ nodeId: "x", source: { glsl: "SYNTAX_ERROR_TRIGGER" }, width: 8, height: 8 })).toBeNull()
      expect(useProjectStore.getState().lastCompileError).toBeNull()
    })

    it("never renders inside renderFrame", async () => {
      a().inFrame = true
      expect(await adapter.renderToTarget!({ nodeId: "x", source: { glsl: FRAG }, width: 8, height: 8 })).toBeNull()
    })
  })

  describe("fidelity capabilities", () => {
    it("falls back to PCF explicitly when VSM lacks float render targets", () => {
      const vsm = settings({ shadows: { ...DEFAULT_RENDER_SETTINGS.shadows, enabled: true, filterMode: "vsm" } })
      adapter.applyRenderSettings(vsm)
      expect(adapter.getFidelityCapabilities().effectiveShadowFilter).toBe("vsm")
      a().floatTargets = false
      adapter.applyRenderSettings({ ...vsm, shadows: { ...vsm.shadows, bias: 0.01 } })
      expect(adapter.getEffectiveShadowFilter()).toBe("pcf")
      expect(adapter.getFidelityCapabilities()).toEqual({ effectiveShadowFilter: "pcf", unsupported: [] })
      expect(a().vsmTex).toBeNull()
    })
  })
})
