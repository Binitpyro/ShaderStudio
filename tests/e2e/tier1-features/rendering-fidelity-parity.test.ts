import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { ENVIRONMENT_PRESETS } from "@/core/environmentGenerator"
import type { GBufferDebugView, ShadowFilterMode } from "@/adapters/types"

describe("Tier 1: Feature Coverage — R2 Rendering Fidelity & Multi-Backend Parity", () => {
  const adapters = [
    { name: "WebGPU", adapter: webgpuAdapter },
    { name: "WebGL2", adapter: webgl2Adapter },
    { name: "Three.js", adapter: threejsAdapter },
  ]

  beforeEach(() => {
    setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  describe("R2a: Deferred Rendering Pipeline & GBuffer MRT", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] toggles between forward and deferred pipeline modes`, () => {
        expect(adapter.getPipelineMode()).toBe("forward")
        expect(adapter.getGBufferTextures()).toBeNull()

        adapter.setRenderingPipelineMode("deferred")
        expect(adapter.getPipelineMode()).toBe("deferred")

        const targets = adapter.getGBufferTextures()
        expect(targets).not.toBeNull()
        expect(targets?.albedo).toBeDefined()
        expect(targets?.normal).toBeDefined()
        expect(targets?.roughnessMetallic).toBeDefined()
        expect(targets?.depth).toBeDefined()
        expect(targets?.motionVectors).toBeDefined()

        adapter.setRenderingPipelineMode("forward")
        expect(adapter.getPipelineMode()).toBe("forward")
        expect(adapter.getGBufferTextures()).toBeNull()
      })

      it(`[${name}] supports all GBuffer channel debug visualizer views`, () => {
        const views: GBufferDebugView[] = ["none", "albedo", "normal", "roughness", "metallic", "depth", "motion"]
        for (const view of views) {
          adapter.setGBufferDebugView(view)
          expect(adapter.getGBufferDebugView()).toBe(view)
        }
      })
    })
  })

  describe("R2b: Shadow Mapping & Point Light Cubemaps", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] updates shadow resolution for valid sizes (512, 1024, 2048, 4096)`, () => {
        const validResolutions = [512, 1024, 2048, 4096] as const
        for (const res of validResolutions) {
          adapter.setShadowConfig({ resolution: res })
          expect(adapter.state.shadowConfig.resolution).toBe(res)

          adapter.updateShadowSettings({ resolution: res })
          expect(adapter.getShadowSettings().resolution).toBe(res)
        }
      })

      it(`[${name}] throws on invalid shadow map resolution`, () => {
        expect(() => {
          adapter.setShadowConfig({ resolution: 256 as any })
        }).toThrow(/Invalid shadow resolution/)

        expect(() => {
          adapter.updateShadowSettings({ resolution: 8192 as any })
        }).toThrow(/Invalid shadow resolution/)
      })

      it(`[${name}] configures shadow filter modes and biases`, () => {
        const modes: ShadowFilterMode[] = ["hard", "pcf", "vsm", "pcss"]
        for (const mode of modes) {
          adapter.updateShadowSettings({ filterMode: mode, bias: 0.0025, normalBias: 0.005 })
          expect(adapter.getShadowSettings().filterMode).toBe(mode)
          expect(adapter.state.shadowConfig.filtering).toBe(mode)
          expect(adapter.state.shadowConfig.bias).toBe(0.0025)
          expect(adapter.state.shadowConfig.normalBias).toBe(0.005)
        }
      })

      it(`[${name}] toggles point light shadow cubemap`, () => {
        adapter.setPointLightShadowCube(true)
        expect(adapter.state.pointShadowCubeEnabled).toBe(true)

        adapter.setPointLightShadowCube(false)
        expect(adapter.state.pointShadowCubeEnabled).toBe(false)
      })
    })
  })

  describe("R2c: Screen-Space Reflections (SSR)", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] updates SSR settings and post-process state`, () => {
        adapter.updateSSRSettings({
          enabled: true,
          maxSteps: 128,
          thickness: 0.05,
          falloff: 0.9,
          iblBlend: 0.65,
        })

        const ssr = adapter.state.postProcessState.ssr
        expect(ssr.enabled).toBe(true)
        expect(ssr.maxSteps).toBe(128)
        expect(ssr.thickness).toBe(0.05)
        expect(ssr.falloff).toBe(0.9)
        expect(ssr.iblBlend).toBe(0.65)
      })
    })
  })

  describe("R2d: Anti-Aliasing (FXAA & TAA)", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] toggles FXAA and TAA exclusively`, () => {
        adapter.setAntiAliasingMode("fxaa")
        expect(adapter.getAntiAliasingMode()).toBe("fxaa")
        expect(adapter.state.postProcessState.fxaa.enabled).toBe(true)
        expect(adapter.state.postProcessState.taa.enabled).toBe(false)

        adapter.setAntiAliasingMode("taa")
        expect(adapter.getAntiAliasingMode()).toBe("taa")
        expect(adapter.state.postProcessState.fxaa.enabled).toBe(false)
        expect(adapter.state.postProcessState.taa.enabled).toBe(true)

        adapter.setAntiAliasingMode("none")
        expect(adapter.getAntiAliasingMode()).toBe("none")
        expect(adapter.state.postProcessState.fxaa.enabled).toBe(false)
        expect(adapter.state.postProcessState.taa.enabled).toBe(false)
      })
    })
  })

  describe("R2e: Physically-Based Atmosphere & Sky", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] clamps timeOfDay to [0, 24] and calculates solar elevation`, () => {
        adapter.setAtmosphereParams({ timeOfDay: 12.0, sunIntensity: 1.5, turbidity: 3.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(12.0)
        expect(adapter.state.atmosphereParams.sunIntensity).toBe(1.5)
        expect(adapter.state.atmosphereParams.turbidity).toBe(3.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(90.0, 1)

        // Sunrise (6:00) -> 0 degrees elevation
        adapter.setAtmosphereParams({ timeOfDay: 6.0 })
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)

        // Sunset (18:00) -> 0 degrees elevation
        adapter.setAtmosphereParams({ timeOfDay: 18.0 })
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)

        // Clamping negative and > 24
        adapter.setAtmosphereParams({ timeOfDay: -5.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(0.0)

        adapter.setAtmosphereParams({ timeOfDay: 35.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(24.0)
      })

      it(`[${name}] calculates Rayleigh (inverse lambda^4) and Mie scattering`, () => {
        adapter.setAtmosphereParams({ timeOfDay: 12.0, turbidity: 2.0 })
        const { rayleigh, mie } = adapter.calculateRayleighMieScattering([680, 550, 440])

        expect(rayleigh.length).toBe(3)
        // Shorter wavelengths scatter significantly more (Rayleigh blue > green > red)
        expect(rayleigh[2]).toBeGreaterThan(rayleigh[1])
        expect(rayleigh[1]).toBeGreaterThan(rayleigh[0])

        // Mie scattering proportional to turbidity
        expect(mie).toBeCloseTo(0.002 * 2.0, 5)
      })
    })

    it("includes atmosphere preset in standard ENVIRONMENT_PRESETS", () => {
      const atmospherePreset = ENVIRONMENT_PRESETS.find((p) => p.id === "atmosphere")
      expect(atmospherePreset).toBeDefined()
      expect(atmospherePreset?.name).toBe("Physically-Based Atmosphere")
      expect(atmospherePreset?.keyColor).toBe("#60a5fa")
    })
  })

  describe("R2f: Depth of Field (DoF)", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] updates DoF settings with bokeh shapes`, () => {
        adapter.updateDoFSettings({
          enabled: true,
          focalDistance: 7.5,
          aperture: 0.08,
          bokehShape: "hexagon",
        })

        const dof = adapter.state.postProcessState.dof
        expect(dof.enabled).toBe(true)
        expect(dof.focalDistance).toBe(7.5)
        expect(dof.aperture).toBe(0.08)
        expect(dof.bokehShape).toBe("hexagon")
      })
    })
  })

  describe("R2g: Screen-Space Ambient Occlusion (SSAO)", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] updates SSAO settings`, () => {
        adapter.updateSSAOSettings({
          enabled: true,
          radius: 0.75,
          intensity: 2.0,
          sampleCount: 32,
        })

        const ssao = adapter.state.postProcessState.ssao
        expect(ssao.enabled).toBe(true)
        expect(ssao.radius).toBe(0.75)
        expect(ssao.intensity).toBe(2.0)
        expect(ssao.sampleCount).toBe(32)
      })
    })
  })

  describe("Cross-Backend Parity Consistency", () => {
    it("produces identical Rayleigh and Mie scattering across all 3 backends", () => {
      const wavelengths = [700, 530, 420]
      webgpuAdapter.setAtmosphereParams({ timeOfDay: 14.0, turbidity: 3.5 })
      webgl2Adapter.setAtmosphereParams({ timeOfDay: 14.0, turbidity: 3.5 })
      threejsAdapter.setAtmosphereParams({ timeOfDay: 14.0, turbidity: 3.5 })

      const webgpuScattering = webgpuAdapter.calculateRayleighMieScattering(wavelengths)
      const webgl2Scattering = webgl2Adapter.calculateRayleighMieScattering(wavelengths)
      const threejsScattering = threejsAdapter.calculateRayleighMieScattering(wavelengths)

      expect(webgpuScattering.rayleigh).toEqual(webgl2Scattering.rayleigh)
      expect(webgl2Scattering.rayleigh).toEqual(threejsScattering.rayleigh)
      expect(webgpuScattering.mie).toBe(webgl2Scattering.mie)
      expect(webgl2Scattering.mie).toBe(threejsScattering.mie)
    })
  })
})
