import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { threejsAdapter } from "../src/adapters/threejs"
import { webgpuAdapter } from "../src/adapters/webgpu"
import { webgl2Adapter } from "../src/adapters/webgl2"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Adversarial Milestone 2 Gate 3 Deep Stress Probes", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    threejsAdapter.dispose()
    webgpuAdapter.dispose()
    webgl2Adapter.dispose()
    threejsAdapter.setRenderingPipelineMode("forward")
    webgpuAdapter.setRenderingPipelineMode("forward")
    webgl2Adapter.setRenderingPipelineMode("forward")
  })

  afterEach(() => {
    threejsAdapter.dispose()
    webgpuAdapter.dispose()
    webgl2Adapter.dispose()
    teardownE2ETestEnvironment(env)
  })

  describe("Probe 1: getShadowSettings().resolution synchronization with setShadowConfig()", () => {
    it("synchronizes resolution, filterMode, bias, normalBias across setShadowConfig calls before and after mount", async () => {
      // 1. Pre-mount synchronization
      threejsAdapter.setShadowConfig({ resolution: 512, filtering: "pcf", bias: 0.001, normalBias: 0.02 })
      expect(threejsAdapter.getShadowSettings().resolution).toBe(512)
      expect(threejsAdapter.getShadowSettings().filterMode).toBe("pcf")
      expect(threejsAdapter.getShadowSettings().bias).toBe(0.001)
      expect(threejsAdapter.getShadowSettings().normalBias).toBe(0.02)
      expect(threejsAdapter.state.shadowConfig.resolution).toBe(512)

      // 2. Pre-mount partial update preserves existing fields
      threejsAdapter.setShadowConfig({ filtering: "vsm" })
      expect(threejsAdapter.getShadowSettings().resolution).toBe(512)
      expect(threejsAdapter.getShadowSettings().filterMode).toBe("vsm")
      expect(threejsAdapter.getShadowSettings().bias).toBe(0.001)

      // 3. Mount and verify state persists
      const canvas = document.createElement("canvas")
      await threejsAdapter.mount(canvas)
      expect(threejsAdapter.getShadowSettings().resolution).toBe(512)
      expect(threejsAdapter.getShadowSettings().filterMode).toBe("vsm")

      // 4. Post-mount setShadowConfig updates
      threejsAdapter.setShadowConfig({ resolution: 4096, bias: 0.0001 })
      expect(threejsAdapter.getShadowSettings().resolution).toBe(4096)
      expect(threejsAdapter.getShadowSettings().bias).toBe(0.0001)
      expect(threejsAdapter.getShadowSettings().filterMode).toBe("vsm")
      expect(threejsAdapter.state.shadowConfig.resolution).toBe(4096)

      // 5. Post-mount updateShadowSettings updates
      threejsAdapter.updateShadowSettings({ resolution: 1024, filterMode: "pcf" })
      expect(threejsAdapter.getShadowSettings().resolution).toBe(1024)
      expect(threejsAdapter.getShadowSettings().filterMode).toBe("pcf")
      expect(threejsAdapter.state.shadowConfig.resolution).toBe(1024)
      expect(threejsAdapter.state.shadowConfig.filtering).toBe("pcf")
    })

    it("matches contract parity with WebGPU and WebGL2", () => {
      const adapters = [
        { name: "Three.js", adapter: threejsAdapter },
        { name: "WebGPU", adapter: webgpuAdapter },
        { name: "WebGL2", adapter: webgl2Adapter },
      ]

      for (const { name, adapter } of adapters) {
        adapter.setShadowConfig({ resolution: 1024, filtering: "pcf", bias: 0.005, normalBias: 0.01 })
        const s = adapter.getShadowSettings()
        expect(s.resolution, `${name} resolution`).toBe(1024)
        expect(s.filterMode, `${name} filterMode`).toBe("pcf")
        expect(s.bias, `${name} bias`).toBe(0.005)
        expect(s.normalBias, `${name} normalBias`).toBe(0.01)

        adapter.setShadowConfig({ resolution: 2048 })
        const s2 = adapter.getShadowSettings()
        expect(s2.resolution, `${name} resolution updated`).toBe(2048)
        expect(s2.filterMode, `${name} filterMode preserved`).toBe("pcf")
        expect(s2.bias, `${name} bias preserved`).toBe(0.005)
      }
    })
  })

  describe("Probe 2: pointLight.shadow.mapSize pre-mount synchronization", () => {
    it("synchronizes pointLight shadow mapSize and bias when configured before mount for all supported resolutions", async () => {
      const resolutions = [512, 1024, 2048, 4096] as const

      for (const res of resolutions) {
        threejsAdapter.dispose()
        threejsAdapter.setPointLightShadowCube(true)
        threejsAdapter.setShadowConfig({ resolution: res, bias: 0.00025 * (res / 512) })

        const canvas = document.createElement("canvas")
        await threejsAdapter.mount(canvas)

        const pointLight = (threejsAdapter as any).pointLight
        const directionalLight = (threejsAdapter as any).directionalLight
        expect(pointLight, "pointLight must exist").toBeDefined()
        expect(directionalLight, "directionalLight must exist").toBeDefined()

        expect(directionalLight.shadow.mapSize.width).toBe(res)
        expect(directionalLight.shadow.mapSize.height).toBe(res)
        expect(directionalLight.shadow.bias).toBe(0.00025 * (res / 512))

        expect(pointLight.shadow.mapSize.width).toBe(res)
        expect(pointLight.shadow.mapSize.height).toBe(res)
        expect(pointLight.shadow.bias).toBe(0.00025 * (res / 512))
      }
    })

    it("synchronizes pointLight shadow mapSize when updated via updateShadowSettings before mount", async () => {
      threejsAdapter.dispose()
      threejsAdapter.setPointLightShadowCube(true)
      threejsAdapter.updateShadowSettings({ resolution: 4096, bias: 0.0001 })

      const canvas = document.createElement("canvas")
      await threejsAdapter.mount(canvas)

      const pointLight = (threejsAdapter as any).pointLight
      expect(pointLight.shadow.mapSize.width).toBe(4096)
      expect(pointLight.shadow.mapSize.height).toBe(4096)
      expect(pointLight.shadow.bias).toBe(0.0001)
    })
  })

  describe("Probe 3: resize() scales GBuffer by DPR across fractional & high DPRs", () => {
    it("scales GBuffer target textures exactly to canvas pixel buffer dimensions (Math.floor(safeWidth * dpr))", async () => {
      const canvas = document.createElement("canvas")
      await threejsAdapter.mount(canvas)
      threejsAdapter.setRenderingPipelineMode("deferred")

      const testCases = [
        { w: 800, h: 600, dpr: 1.0, expW: 800, expH: 600 },
        { w: 800, h: 600, dpr: 1.25, expW: 1000, expH: 750 },
        { w: 800, h: 600, dpr: 1.5, expW: 1200, expH: 900 },
        { w: 800, h: 600, dpr: 2.0, expW: 1600, expH: 1200 },
        { w: 1920, h: 1080, dpr: 2.5, expW: 4800, expH: 2700 },
        { w: 3840, h: 2160, dpr: 0.5, expW: 1920, expH: 1080 },
        { w: 100, h: 100, dpr: 3.0, expW: 300, expH: 300 },
      ]

      for (const tc of testCases) {
        threejsAdapter.resize(tc.w, tc.h, tc.dpr)
        const targets = threejsAdapter.getGBufferTextures()
        expect(targets).not.toBeNull()
        expect((targets!.albedo as any).width, `width for DPR ${tc.dpr}`).toBe(tc.expW)
        expect((targets!.albedo as any).height, `height for DPR ${tc.dpr}`).toBe(tc.expH)
        expect((targets!.normal as any).width).toBe(tc.expW)
        expect((targets!.roughnessMetallic as any).width).toBe(tc.expW)
        expect((targets!.depth as any).width).toBe(tc.expW)
        expect((targets!.motionVectors as any).width).toBe(tc.expW)
      }
    })
  })

  describe("Probe 4: Mode switching reads canvas buffer width/height", () => {
    it("allocates GBuffer matching canvas buffer dimensions when toggled after resizing in forward mode", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)

      // Start in forward mode
      expect(threejsAdapter.getPipelineMode()).toBe("forward")
      expect(threejsAdapter.getGBufferTextures()).toBeNull()

      // Resize while in forward mode with DPR=2
      threejsAdapter.resize(1000, 700, 2)
      expect(canvas.width).toBe(2000)
      expect(canvas.height).toBe(1400)
      expect(threejsAdapter.getGBufferTextures()).toBeNull()

      // Now switch to deferred: must instantiate GBuffer with canvas.width (2000) and canvas.height (1400)
      threejsAdapter.setRenderingPipelineMode("deferred")
      let targets = threejsAdapter.getGBufferTextures()
      expect(targets).not.toBeNull()
      expect((targets!.albedo as any).width).toBe(2000)
      expect((targets!.albedo as any).height).toBe(1400)

      // Rapidly toggle 20 times between forward and deferred
      for (let i = 0; i < 20; i++) {
        threejsAdapter.setRenderingPipelineMode("forward")
        expect(threejsAdapter.getGBufferTextures()).toBeNull()
        threejsAdapter.setRenderingPipelineMode("deferred")
        expect(threejsAdapter.getGBufferTextures()).not.toBeNull()
        expect((threejsAdapter.getGBufferTextures()!.albedo as any).width).toBe(2000)
      }

      // Fallback in renderFrame: nullify render target and check fallback creation uses canvas.width
      const internalAdapter = threejsAdapter as any
      internalAdapter.gBufferRenderTarget.dispose()
      internalAdapter.gBufferRenderTarget = null
      threejsAdapter.renderFrame(100, 16)
      expect(internalAdapter.gBufferRenderTarget).not.toBeNull()
      expect(internalAdapter.gBufferRenderTarget.width).toBe(2000)
      expect(internalAdapter.gBufferRenderTarget.height).toBe(1400)
    })
  })
})
