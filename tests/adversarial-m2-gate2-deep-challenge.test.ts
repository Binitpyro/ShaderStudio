import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { webgpuAdapter, WebGPUAdapter } from "@/adapters/webgpu"
import { webgl2Adapter, WebGL2Adapter } from "@/adapters/webgl2"
import { threejsAdapter, ThreeJSAdapter } from "@/adapters/threejs"
import type { GBufferDebugView, ShadowFilterMode } from "@/adapters/types"
import * as THREE from "three"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Milestone 2 Gate 2 Deep Adversarial Challenge: Rendering Fidelity & Parity", () => {
  const adapters = [
    { name: "WebGPU", adapter: webgpuAdapter, AdapterClass: WebGPUAdapter },
    { name: "WebGL2", adapter: webgl2Adapter, AdapterClass: WebGL2Adapter },
    { name: "Three.js", adapter: threejsAdapter, AdapterClass: ThreeJSAdapter },
  ]

  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    for (const { adapter } of adapters) {
      adapter.state.shadowConfig.resolution = 2048
      if (adapter.updateShadowSettings) {
        adapter.updateShadowSettings({ resolution: 2048 })
      }
      adapter.setRenderingPipelineMode?.("forward")
    }
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Area 1: Comprehensive Shadow Resolution Sanitization & Fuzzing
  // ==========================================================================
  describe("Area 1: Strict Shadow Resolution Sanitization across Backends", () => {
    const invalidResolutions = [
      0,
      NaN,
      -1,
      100,
      5000,
      "2048",
      "1024",
      "invalid",
      "",
      1000,
      1024.5,
      2047,
      2049,
      3000,
      513,
      4095,
      4097,
      Infinity,
      -Infinity,
      null,
      false,
      true,
      {},
      [],
      [2048],
      -512,
      -1024,
      256,
      128,
      64,
      8192,
      16384,
    ]

    adapters.forEach(({ name, adapter }) => {
      describe(`[${name}] setShadowConfig resolution rejection`, () => {
        invalidResolutions.forEach((invalidVal) => {
          it(`rejects invalid resolution: ${JSON.stringify(invalidVal)} (${typeof invalidVal})`, () => {
            expect(
              () => adapter.setShadowConfig({ resolution: invalidVal as any }),
              `Expected setShadowConfig to throw for ${String(invalidVal)}`
            ).toThrow(/Invalid shadow resolution/)
          })
        })
      })

      describe(`[${name}] updateShadowSettings resolution rejection`, () => {
        invalidResolutions.forEach((invalidVal) => {
          it(`rejects invalid resolution in updateShadowSettings: ${JSON.stringify(invalidVal)}`, () => {
            expect(
              () => adapter.updateShadowSettings({ resolution: invalidVal as any }),
              `Expected updateShadowSettings to throw for ${String(invalidVal)}`
            ).toThrow(/Invalid shadow resolution/)
          })
        })
      })

      describe(`[${name}] valid power-of-two resolutions acceptance`, () => {
        const validResolutions = [512, 1024, 2048, 4096] as const
        validResolutions.forEach((res) => {
          it(`accepts valid resolution ${res}`, () => {
            expect(() => adapter.setShadowConfig({ resolution: res })).not.toThrow()
            expect(adapter.state.shadowConfig.resolution).toBe(res)
            expect(adapter.getShadowSettings?.().resolution).toBe(res)

            expect(() => adapter.updateShadowSettings({ resolution: res })).not.toThrow()
            expect(adapter.state.shadowConfig.resolution).toBe(res)
            expect(adapter.getShadowSettings?.().resolution).toBe(res)
          })
        })
      })

      it(`[${name}] partial config without resolution preserves existing resolution`, () => {
        adapter.setShadowConfig({ resolution: 1024 })
        expect(adapter.state.shadowConfig.resolution).toBe(1024)

        // Update bias and filtering without resolution
        adapter.setShadowConfig({ bias: 0.005, filtering: "vsm" })
        expect(adapter.state.shadowConfig.resolution).toBe(1024)
        expect(adapter.state.shadowConfig.bias).toBe(0.005)
        expect(adapter.state.shadowConfig.filtering).toBe("vsm")

        adapter.updateShadowSettings({ normalBias: 0.02 })
        expect(adapter.state.shadowConfig.resolution).toBe(1024)
        expect(adapter.state.shadowConfig.normalBias).toBe(0.02)
      })
    })
  })

  // ==========================================================================
  // Area 2: Point Light Shadow Cubemap Allocation & Synchronization
  // ==========================================================================
  describe("Area 2: Point Light Cubemap Allocation & Synchronization", () => {
    it("[Three.js] point light mapSize syncs with setShadowConfig when mounted", async () => {
      const adapter = threejsAdapter
      const canvas = document.createElement("canvas")
      await adapter.mount(canvas)

      adapter.setPointLightShadowCube(true)
      adapter.setShadowConfig({ resolution: 1024, bias: 0.002 })

      const pointLight = (adapter as any).pointLight
      const directionalLight = (adapter as any).directionalLight
      expect(pointLight).toBeDefined()
      expect(directionalLight).toBeDefined()

      expect(pointLight.shadow.mapSize.width).toBe(1024)
      expect(pointLight.shadow.mapSize.height).toBe(1024)
      expect(pointLight.shadow.bias).toBe(0.002)
      expect(directionalLight.shadow.mapSize.width).toBe(1024)
      expect(directionalLight.shadow.bias).toBe(0.002)

      // Update via updateShadowSettings
      adapter.updateShadowSettings({ resolution: 4096, bias: 0.0005 })
      expect(pointLight.shadow.mapSize.width).toBe(4096)
      expect(pointLight.shadow.mapSize.height).toBe(4096)
      expect(pointLight.shadow.bias).toBe(0.0005)
    })

    it("[Three.js] point light mapSize syncs with setShadowConfig when called BEFORE mount", async () => {
      const adapter = threejsAdapter
      adapter.dispose()
      adapter.setPointLightShadowCube(true)
      adapter.setShadowConfig({ resolution: 1024, bias: 0.003 })

      const canvas = document.createElement("canvas")
      await adapter.mount(canvas)

      const pointLight = (adapter as any).pointLight
      const directionalLight = (adapter as any).directionalLight
      expect(pointLight).toBeDefined()
      expect(directionalLight).toBeDefined()

      expect(directionalLight.shadow.mapSize.width).toBe(1024)
      expect(pointLight.shadow.mapSize.width, "pointLight.shadow.mapSize should be 1024 after mount").toBe(1024)
    })

    it("[Three.js] point light shadow cube enable/disable toggles castShadow", async () => {
      const adapter = threejsAdapter
      const canvas = document.createElement("canvas")
      await adapter.mount(canvas)

      adapter.setPointLightShadowCube(true)
      expect(adapter.state.pointShadowCubeEnabled).toBe(true)
      expect((adapter as any).pointLight.castShadow).toBe(true)

      adapter.setPointLightShadowCube(false)
      expect(adapter.state.pointShadowCubeEnabled).toBe(false)
      expect((adapter as any).pointLight.castShadow).toBe(false)
    })

    it("[WebGPU] shadow cube texture allocated on enable, destroyed on disable", () => {
      webgpuAdapter.setPointLightShadowCube(true)
      expect(webgpuAdapter.state.pointShadowCubeEnabled).toBe(true)
      const tex = (webgpuAdapter as any).shadowCubeTex
      expect(tex).not.toBeNull()

      webgpuAdapter.setPointLightShadowCube(false)
      expect(webgpuAdapter.state.pointShadowCubeEnabled).toBe(false)
      expect((webgpuAdapter as any).shadowCubeTex).toBeNull()
    })

    it("[WebGPU] toggling cubemap 30 times does not leak or throw", () => {
      for (let i = 0; i < 30; i++) {
        webgpuAdapter.setPointLightShadowCube(true)
        expect((webgpuAdapter as any).shadowCubeTex).not.toBeNull()
        webgpuAdapter.setPointLightShadowCube(false)
        expect((webgpuAdapter as any).shadowCubeTex).toBeNull()
      }
    })

    it("[WebGL2] shadow cube map texture allocated on enable, deleted on disable", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)

      webgl2Adapter.setPointLightShadowCube(true)
      expect(webgl2Adapter.state.pointShadowCubeEnabled).toBe(true)
      expect((webgl2Adapter as any).shadowCubeMapTex).not.toBeNull()

      webgl2Adapter.setPointLightShadowCube(false)
      expect(webgl2Adapter.state.pointShadowCubeEnabled).toBe(false)
      expect((webgl2Adapter as any).shadowCubeMapTex).toBeNull()
    })

    it("[WebGL2] toggling cubemap 30 times does not leak or throw", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)

      for (let i = 0; i < 30; i++) {
        webgl2Adapter.setPointLightShadowCube(true)
        expect((webgl2Adapter as any).shadowCubeMapTex).not.toBeNull()
        webgl2Adapter.setPointLightShadowCube(false)
        expect((webgl2Adapter as any).shadowCubeMapTex).toBeNull()
      }
    })
  })

  // ==========================================================================
  // Area 3: Deferred Lighting Parameters Dynamic Bindings
  // ==========================================================================
  describe("Area 3: Deferred Lighting Parameters Dynamic Uniforms", () => {
    it("[WebGL2] dynamic directional light direction, color, and intensity are uploaded", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      webgl2Adapter.updateShadowSettings({
        directionalLight: {
          enabled: true,
          position: [0, 10, 0],
          target: [0, 0, 0],
          intensity: 3.5,
          color: [0.8, 0.4, 0.2],
          orthoSize: 15,
          near: 0.5,
          far: 100,
        },
      })

      const gl = (webgl2Adapter as any).gl
      const uniform3fSpy = vi.spyOn(gl, "uniform3f")
      const uniform1fSpy = vi.spyOn(gl, "uniform1f")

      webgl2Adapter.renderFrame(100, 16)

      // Direction should be normalized (0, 1, 0)
      const dirCalls = uniform3fSpy.mock.calls.filter(
        (call) => Math.abs(call[1] - 0) < 0.001 && Math.abs(call[2] - 1) < 0.001 && Math.abs(call[3] - 0) < 0.001
      )
      // Color should be (0.8, 0.4, 0.2)
      const colCalls = uniform3fSpy.mock.calls.filter(
        (call) => Math.abs(call[1] - 0.8) < 0.001 && Math.abs(call[2] - 0.4) < 0.001 && Math.abs(call[3] - 0.2) < 0.001
      )
      // Intensity should be 3.5
      const intCalls = uniform1fSpy.mock.calls.filter((call) => Math.abs(call[1] - 3.5) < 0.001)

      expect(dirCalls.length).toBeGreaterThan(0)
      expect(colCalls.length).toBeGreaterThan(0)
      expect(intCalls.length).toBeGreaterThan(0)
    })

    it("[WebGL2] directionalLight.enabled: false forces light intensity to 0.0, re-enabling restores it", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      // Disabled light
      webgl2Adapter.updateShadowSettings({
        directionalLight: {
          enabled: false,
          position: [5, 5, 5],
          target: [0, 0, 0],
          intensity: 2.0,
          color: [1, 1, 1],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      const gl = (webgl2Adapter as any).gl
      let uniform1fSpy = vi.spyOn(gl, "uniform1f")
      webgl2Adapter.renderFrame(100, 16)

      expect(uniform1fSpy.mock.calls.some((call) => call[1] === 0.0)).toBe(true)

      // Re-enable light
      uniform1fSpy.mockClear()
      webgl2Adapter.updateShadowSettings({
        directionalLight: {
          enabled: true,
          position: [5, 5, 5],
          target: [0, 0, 0],
          intensity: 2.0,
          color: [1, 1, 1],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      webgl2Adapter.renderFrame(116, 16)
      expect(uniform1fSpy.mock.calls.some((call) => call[1] === 2.0)).toBe(true)
    })

    it("[Three.js] dynamic directional light direction, color, and intensity update deferred quad material", async () => {
      const canvas = document.createElement("canvas")
      await threejsAdapter.mount(canvas)
      threejsAdapter.setRenderingPipelineMode("deferred")

      threejsAdapter.updateShadowSettings({
        directionalLight: {
          enabled: true,
          position: [0, 50, 0],
          target: [0, 0, 0],
          intensity: 4.2,
          color: [0.3, 0.6, 0.9],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      threejsAdapter.renderFrame(100, 16)

      const mat = (threejsAdapter as any).deferredLightingMaterial
      expect(mat).toBeDefined()
      expect(mat.uniforms["u_lightIntensity"].value).toBe(4.2)
      expect(mat.uniforms["u_lightDir"].value.y).toBeCloseTo(1.0, 3)
      expect(mat.uniforms["u_lightColor"].value.r).toBeCloseTo(0.3, 3)
      expect(mat.uniforms["u_lightColor"].value.g).toBeCloseTo(0.6, 3)
      expect(mat.uniforms["u_lightColor"].value.b).toBeCloseTo(0.9, 3)

      // Turn OFF directional light
      threejsAdapter.updateShadowSettings({
        directionalLight: {
          enabled: false,
          position: [0, 50, 0],
          target: [0, 0, 0],
          intensity: 4.2,
          color: [0.3, 0.6, 0.9],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      threejsAdapter.renderFrame(116, 16)
      expect(mat.uniforms["u_lightIntensity"].value).toBe(0.0)
    })

    it("[WebGPU] deferred lighting buffer updates with directionalLight parameters and handles disabled flag", async () => {
      const canvas = document.createElement("canvas")
      await webgpuAdapter.mount(canvas)
      webgpuAdapter.setRenderingPipelineMode("deferred")

      webgpuAdapter.updateShadowSettings({
        directionalLight: {
          enabled: true,
          position: [10, 0, 0],
          target: [0, 0, 0],
          intensity: 1.8,
          color: [0.5, 0.7, 0.9],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      const device = (webgpuAdapter as any).device
      const writeBufferSpy = vi.spyOn(device.queue, "writeBuffer")

      webgpuAdapter.renderFrame(100, 16)

      expect(writeBufferSpy).toHaveBeenCalled()
      const lastCall = writeBufferSpy.mock.calls[writeBufferSpy.mock.calls.length - 1]
      const floatData = lastCall[2] as Float32Array
      // index 0: lDirX (should be 1.0)
      expect(floatData[0]).toBeCloseTo(1.0, 3)
      // index 3: lInt (should be 1.8)
      expect(floatData[3]).toBeCloseTo(1.8, 3)
      // index 4,5,6: lCol (0.5, 0.7, 0.9)
      expect(floatData[4]).toBeCloseTo(0.5, 3)
      expect(floatData[5]).toBeCloseTo(0.7, 3)
      expect(floatData[6]).toBeCloseTo(0.9, 3)

      // Disable light
      webgpuAdapter.updateShadowSettings({
        directionalLight: {
          enabled: false,
          position: [10, 0, 0],
          target: [0, 0, 0],
          intensity: 1.8,
          color: [0.5, 0.7, 0.9],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      webgpuAdapter.renderFrame(116, 16)
      const disabledCall = writeBufferSpy.mock.calls[writeBufferSpy.mock.calls.length - 1]
      const disabledData = disabledCall[2] as Float32Array
      expect(disabledData[3]).toBe(0.0)
    })
  })

  // ==========================================================================
  // Area 4: GBuffer Resizing on Canvas Resize Across All Three Backends
  // ==========================================================================
  describe("Area 4: GBuffer Resizing across All Three Backends", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] resize() updates all 5 GBuffer channels in deferred mode`, async () => {
        const canvas = document.createElement("canvas")
        canvas.width = 1000
        canvas.height = 800
        await adapter.mount(canvas)
        adapter.setRenderingPipelineMode("deferred")

        // First check initial targets
        let targets = adapter.getGBufferTextures()
        expect(targets).not.toBeNull()
        expect(targets?.albedo).toBeDefined()
        expect(targets?.normal).toBeDefined()
        expect(targets?.roughnessMetallic).toBeDefined()
        expect(targets?.depth).toBeDefined()
        expect(targets?.motionVectors).toBeDefined()

        // Sequence of resizes
        const sizes = [
          { w: 1920, h: 1080 },
          { w: 400, h: 300 },
          { w: 2560, h: 1440 },
          { w: 64, h: 64 },
        ]

        for (const { w, h } of sizes) {
          adapter.resize(w, h, 1)
          targets = adapter.getGBufferTextures()
          expect(targets, `${name} targets should not be null after resize to ${w}x${h}`).not.toBeNull()

          for (const channel of ["albedo", "normal", "roughnessMetallic", "depth", "motionVectors"] as const) {
            const tex = targets![channel] as any
            expect(tex.width, `${name} ${channel}.width should be ${w}`).toBe(w)
            expect(tex.height, `${name} ${channel}.height should be ${h}`).toBe(h)
          }
        }
      })

      it(`[${name}] resize() with DPR=2 scales GBuffer dimensions consistently to canvas pixel buffer`, async () => {
        const canvas = document.createElement("canvas")
        await adapter.mount(canvas)
        adapter.setRenderingPipelineMode("deferred")

        adapter.resize(800, 600, 2)
        const targets = adapter.getGBufferTextures()
        expect(targets).not.toBeNull()

        // Canvas pixel buffer dimensions are 800 * 2 = 1600, 600 * 2 = 1200
        expect((targets!.albedo as any).width, `${name} GBuffer albedo width should match pixel buffer (1600)`).toBe(1600)
        expect((targets!.albedo as any).height, `${name} GBuffer albedo height should match pixel buffer (1200)`).toBe(1200)
      })

      it(`[${name}] handles extreme aspect ratios and zero/negative dimensions safely`, async () => {
        const canvas = document.createElement("canvas")
        await adapter.mount(canvas)
        adapter.setRenderingPipelineMode("deferred")

        // 1x10000
        expect(() => adapter.resize(1, 10000, 1)).not.toThrow()
        let t = adapter.getGBufferTextures()!
        expect((t.albedo as any).width).toBe(1)
        expect((t.albedo as any).height).toBe(10000)

        // 10000x1
        expect(() => adapter.resize(10000, 1, 1)).not.toThrow()
        t = adapter.getGBufferTextures()!
        expect((t.albedo as any).width).toBe(10000)
        expect((t.albedo as any).height).toBe(1)

        // 0x0 clamped to min 1
        expect(() => adapter.resize(0, 0, 1)).not.toThrow()
        t = adapter.getGBufferTextures()!
        expect((t.albedo as any).width).toBeGreaterThanOrEqual(1)
        expect((t.albedo as any).height).toBeGreaterThanOrEqual(1)

        // -100 x -100 clamped to min 1
        expect(() => adapter.resize(-100, -100, 1)).not.toThrow()
        t = adapter.getGBufferTextures()!
        expect((t.albedo as any).width).toBeGreaterThanOrEqual(1)
        expect((t.albedo as any).height).toBeGreaterThanOrEqual(1)
      })

      it(`[${name}] pipeline mode toggling interleaved with resize does not desynchronize`, async () => {
        const canvas = document.createElement("canvas")
        canvas.width = 800
        canvas.height = 600
        await adapter.mount(canvas)

        // In forward mode, targets are null
        expect(adapter.getGBufferTextures()).toBeNull()

        // Resize in forward
        adapter.resize(1200, 900, 1)
        expect(adapter.getGBufferTextures()).toBeNull()

        // Switch to deferred: must create targets at current canvas size (1200x900)
        adapter.setRenderingPipelineMode("deferred")
        let t = adapter.getGBufferTextures()
        expect(t).not.toBeNull()
        expect((t!.albedo as any).width).toBe(1200)
        expect((t!.albedo as any).height).toBe(900)

        // Resize in deferred
        adapter.resize(500, 400, 1)
        t = adapter.getGBufferTextures()
        expect((t!.albedo as any).width).toBe(500)
        expect((t!.albedo as any).height).toBe(400)

        // Switch to forward: targets become null
        adapter.setRenderingPipelineMode("forward")
        expect(adapter.getGBufferTextures()).toBeNull()

        // Switch back to deferred: targets re-instantiated
        adapter.setRenderingPipelineMode("deferred")
        t = adapter.getGBufferTextures()
        expect(t).not.toBeNull()
        expect((t!.albedo as any).width).toBe(500)
        expect((t!.albedo as any).height).toBe(400)
      })
    })
  })

  // ==========================================================================
  // Area 5: Multi-Backend Contract Parity in getGBufferTextures()
  // ==========================================================================
  describe("Area 5: Multi-Backend Contract Parity in getGBufferTextures()", () => {
    it("all three backends provide identical GBuffer descriptor fields in deferred mode", async () => {
      const cGpu = document.createElement("canvas")
      const cGl = document.createElement("canvas")
      const cThree = document.createElement("canvas")

      await webgpuAdapter.mount(cGpu)
      await webgl2Adapter.mount(cGl)
      await threejsAdapter.mount(cThree)

      webgpuAdapter.setRenderingPipelineMode("deferred")
      webgl2Adapter.setRenderingPipelineMode("deferred")
      threejsAdapter.setRenderingPipelineMode("deferred")

      const gTargets = webgpuAdapter.getGBufferTextures()!
      const lTargets = webgl2Adapter.getGBufferTextures()!
      const tTargets = threejsAdapter.getGBufferTextures()!

      expect(gTargets).not.toBeNull()
      expect(lTargets).not.toBeNull()
      expect(tTargets).not.toBeNull()

      const channels = ["albedo", "normal", "roughnessMetallic", "depth", "motionVectors"] as const

      for (const ch of channels) {
        const gTex = gTargets[ch] as any
        const lTex = lTargets[ch] as any
        const tTex = tTargets[ch] as any

        expect(gTex, `WebGPU missing ${ch}`).toBeDefined()
        expect(lTex, `WebGL2 missing ${ch}`).toBeDefined()
        expect(tTex, `Three.js missing ${ch}`).toBeDefined()

        // Verify format is a non-empty string on all 3
        expect(typeof gTex.format, `WebGPU ${ch}.format`).toBe("string")
        expect(typeof lTex.format, `WebGL2 ${ch}.format`).toBe("string")
        expect(typeof tTex.format, `Three.js ${ch}.format`).toBe("string")

        // Verify width is a positive number on all 3
        expect(typeof gTex.width, `WebGPU ${ch}.width`).toBe("number")
        expect(typeof lTex.width, `WebGL2 ${ch}.width`).toBe("number")
        expect(typeof tTex.width, `Three.js ${ch}.width`).toBe("number")
        expect(gTex.width).toBeGreaterThan(0)
        expect(lTex.width).toBeGreaterThan(0)
        expect(tTex.width).toBeGreaterThan(0)

        // Verify height is a positive number on all 3
        expect(typeof gTex.height, `WebGPU ${ch}.height`).toBe("number")
        expect(typeof lTex.height, `WebGL2 ${ch}.height`).toBe("number")
        expect(typeof tTex.height, `Three.js ${ch}.height`).toBe("number")
        expect(gTex.height).toBeGreaterThan(0)
        expect(lTex.height).toBeGreaterThan(0)
        expect(tTex.height).toBeGreaterThan(0)
      }
    })

    it("all three backends return null in forward mode", async () => {
      const cGpu = document.createElement("canvas")
      const cGl = document.createElement("canvas")
      const cThree = document.createElement("canvas")

      await webgpuAdapter.mount(cGpu)
      await webgl2Adapter.mount(cGl)
      await threejsAdapter.mount(cThree)

      webgpuAdapter.setRenderingPipelineMode("forward")
      webgl2Adapter.setRenderingPipelineMode("forward")
      threejsAdapter.setRenderingPipelineMode("forward")

      expect(webgpuAdapter.getGBufferTextures()).toBeNull()
      expect(webgl2Adapter.getGBufferTextures()).toBeNull()
      expect(threejsAdapter.getGBufferTextures()).toBeNull()
    })

    it("debug views (albedo, normal, roughness, metallic, depth, motion) can be set and read across all backends", () => {
      const views: GBufferDebugView[] = ["none", "albedo", "normal", "roughness", "metallic", "depth", "motion"]

      for (const { name, adapter } of adapters) {
        for (const v of views) {
          adapter.setGBufferDebugView?.(v)
          expect(adapter.getGBufferDebugView?.(), `${name} debug view ${v}`).toBe(v)
        }
      }
    })
  })
})
