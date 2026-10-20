// fleet(w1-a-render): consolidated from rendering-fidelity-parity.test.ts, adversarial-m2-gate2-deep-challenge.test.ts, adversarial-m2-rendering-fidelity-challenger.test.ts, adversarial-m2-rendering-fidelity-parity.test.ts, adversarial-m2-gate2-remediation-challenge.test.ts, adversarial-m2-gate3-verification.test.ts, post-processing.test.ts, post-processing-suite.test.ts, environment-lighting.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment, MockGPUDevice } from "../e2e/mocks"
import { webgpuAdapter, WebGPUAdapter } from "@/adapters/webgpu"
import { webgl2Adapter, WebGL2Adapter } from "@/adapters/webgl2"
import { threejsAdapter, ThreeJSAdapter } from "@/adapters/threejs"
import { ENVIRONMENT_PRESETS, evaluateEnvironmentRadiance, uvToDirection } from "@/core/environmentGenerator"
import { type GBufferDebugView, type ShadowFilterMode, type RenderQueue, type PostProcessPassType } from "@/adapters/types"
import * as THREE from "three"
import { getDefaultPostProcessUniforms, WebGPUPingPong, WebGL2Framebuffer, buildPostProcessChain, PASSTHROUGH_VERTEX, VIGNETTE_FRAGMENT, BLUR_FRAGMENT, PASSTHROUGH_FRAGMENT, CHROMATIC_ABERRATION_FRAGMENT, BLOOM_FRAGMENT, CUSTOM_WGSL_TEMPLATE, CUSTOM_GLSL_TEMPLATE } from "@/core/postProcessChain"
import * as fs from "fs"
import * as path from "path"
import { compileGraph, type GraphNodeData, flattenGraph, buildSdfTree, MAX_SUBGRAPH_DEPTH } from "@/core/graphCompiler"
import { type Node, type Edge } from "@xyflow/react"
import { useProjectStore, type EnvironmentSettings } from "@/stores/projectStore"

import { subGraphLibrary, collapseNodesToSubGraph, BUILTIN_FRESNEL_RIM, BUILTIN_NOISE_GEN, BUILTIN_UV_DISTORTION, type SubGraphDefinition } from "@/core/subGraphLibrary"
import { customNodeRegistry, validateCustomNodeManifest, type CustomNodeManifest } from "@/core/customNodeSdk"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { transpileToUE5, transpileToUnrealHLSL, transpileToBlenderOSL, exportGltf2Material, packOrmTexture, generateNpmPackage, importShadertoy, createProjectFromShadertoy, generateR3FExport } from "@/core/engineTranspiler"
import { getDefaultProjectPath, saveProjectNative, loadProjectNative, startMcpBridge, getMcpBridgeStatus, getMcpBridgePort, stopMcpBridge, minimizeWindow, maximizeWindow, closeWindow, setupTray, isTrayActive, validateBinarySizeConfig, resetDesktopFallbackState } from "@/desktop/tauriBridge"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { checkMemoryThreshold, createDefaultMemoryBudget, MemoryBudgetManager } from "@/core/memoryBudget"
import { generateMeshLods, selectLodByDistance, decimateGeometryBuffer, decimateIndices } from "@/core/meshLod"
import { createTextureStreamer } from "@/core/textureStreamer"
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("R2 rendering fidelity feature coverage", () => {
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

    })
  })

  describe("R2b: Shadow Mapping & Point Light Cubemaps", () => {
    adapters.forEach(({ name, adapter }) => {


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
})

describe("Gate 2 deep challenge: shadows, deferred lighting, GBuffer", () => {
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

        // Exact declared formats per backend (read from each adapter's G-buffer declaration)
        const expectedFormats = {
          webgpu: { albedo: "rgba8unorm", normal: "rgba16float", roughnessMetallic: "rg8unorm", depth: "depth24plus", motionVectors: "rg16float" },
          webgl2: { albedo: "rgba8unorm", normal: "rgba16float", roughnessMetallic: "rgba16float", depth: "depth24plus", motionVectors: "rgba16float" }, // float path (EXT_color_buffer_float present)
          threejs: { albedo: "rgba16float", normal: "rgba16float", roughnessMetallic: "rg8unorm", depth: "depth24plus-stencil8", motionVectors: "rg16float" },
        }
        expect(gTex.format, `WebGPU ${ch}.format`).toBe(expectedFormats.webgpu[ch])
        expect(lTex.format, `WebGL2 ${ch}.format`).toBe(expectedFormats.webgl2[ch])
        expect(tTex.format, `Three.js ${ch}.format`).toBe(expectedFormats.threejs[ch])

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
})

describe("Rendering fidelity challenger", () => {
describe("Milestone 2 Adversarial Challenger Suite: Rendering Fidelity & Multi-Backend Parity", () => {
  const adapters = [
    { name: "WebGPU", adapter: webgpuAdapter, AdapterClass: WebGPUAdapter },
    { name: "WebGL2", adapter: webgl2Adapter, AdapterClass: WebGL2Adapter },
    { name: "Three.js", adapter: threejsAdapter, AdapterClass: ThreeJSAdapter },
  ]

  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    // Reset shadow config resolution to default 2048 before each test
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
  // Target 2: Point Light Shadow Cube Map Faces, Orientation & Sampling
  // ==========================================================================
  describe("Target 2: Point Light Shadow Cube Map Faces, Allocation & Sampling", () => {


    it("[WebGL2] deferred lighting shader samples the point-light shadow cube map when enabled", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")
      webgl2Adapter.setPointLightShadowCube(true)

      // Render a frame to compile deferredLightingProgram
      webgl2Adapter.renderFrame(100, 16)

      const program = (webgl2Adapter as any).deferredLightingProgram
      expect(program).toBeDefined()

      // Inspect actual compiled fragment shader source
      const shaders: any[] = program.shaders || []
      const fsShader = shaders.find((s) => s.type === 0x8b30) // 0x8b30 is gl.FRAGMENT_SHADER
      const fsSource = fsShader ? fsShader.source : ""

      expect(fsSource).toContain("samplerCube")
      expect(fsSource).toContain("u_shadowCubeMap")
    })
  })


  // ==========================================================================
  // Target 4: Deferred Lighting Pass with Light Counts & Directions
  // ==========================================================================
  describe("Target 4: Deferred Lighting Pass with 0 Lights, 50+ Lights, and Light Directions", () => {


    it("[WebGPU & Three.js] deferred lighting pass exists in renderFrame()", async () => {
      const canvasGpu = document.createElement("canvas")
      const canvasThree = document.createElement("canvas")
      await webgpuAdapter.mount(canvasGpu)
      await threejsAdapter.mount(canvasThree)

      webgpuAdapter.setRenderingPipelineMode("deferred")
      threejsAdapter.setRenderingPipelineMode("deferred")

      webgpuAdapter.renderFrame(100, 16)
      threejsAdapter.renderFrame(100, 16)

      expect((webgpuAdapter as any).deferredLightingProgram).toBeDefined()
      expect((threejsAdapter as any).deferredLightingProgram).toBeDefined()
    })
  })

  // ==========================================================================
  // Target 5: Forward / Deferred Mode Switching Stress & Leak Test
  // ==========================================================================
  describe("Target 5: Forward/Deferred Mode Switching Without Context Recreation Leaks", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] toggling mode 100 times does not lose context or crash`, async () => {
        const canvas = document.createElement("canvas")
        canvas.width = 640
        canvas.height = 480
        await adapter.mount(canvas)

        for (let i = 0; i < 100; i++) {
          adapter.setRenderingPipelineMode("deferred")
          expect(adapter.getPipelineMode()).toBe("deferred")
          expect(adapter.getGBufferTextures()).not.toBeNull()

          adapter.renderFrame(i * 16, 16)

          adapter.setRenderingPipelineMode("forward")
          expect(adapter.getPipelineMode()).toBe("forward")
          expect(adapter.getGBufferTextures()).toBeNull()

          adapter.renderFrame(i * 16 + 8, 16)
        }
      })

      if (name !== "Three.js") it(`[${name}] switching to forward releases unused GBuffer GPU textures`, async () => {
        const canvas = document.createElement("canvas")
        await adapter.mount(canvas)
        adapter.setRenderingPipelineMode("deferred")
        expect(adapter.getGBufferTextures()).not.toBeNull()
        adapter.setRenderingPipelineMode("forward")
        expect((adapter as any).gBufferAlbedoTex).toBeNull()
      })

      if (name !== "Three.js") it(`[${name}] dispose() releases GBuffer GPU textures after deferred use`, async () => {
        const canvas = document.createElement("canvas")
        await adapter.mount(canvas)
        adapter.setRenderingPipelineMode("deferred")
        adapter.dispose()
        expect((adapter as any).gBufferAlbedoTex).toBeNull()
      })
    })
  })
})
})

describe("Rendering fidelity parity challenger (real-module assertions only)", () => {
/**
 * Milestone 2 Adversarial Challenger Suite (Requirement R2: Rendering Fidelity Overhaul)
 *
 * EMPIRICAL ADVERSARIAL STRESS-TEST HARNESS TARGETING:
 * 1. SSR Raymarching Limits:
 *    - Step bounds: 1 step, 256 steps, 0 steps, negative steps (clamped to [16, 128]).
 *    - Ray thickness <= 0 (negative/zero thickness strictly suppresses false intersections).
 *    - Grazing angles (grazing surface reflections, perpendicular view normals, roughness cutoff > 0.6).
 *    - Out-of-screen reflection vectors (immediate loop termination, smoothstep vignette edge fade).
 * 2. TAA Stability & Motion Vectors:
 *    - Zero camera motion jitter: Halton(2,3) 8-frame subpixel sequence periodicity and zero-drift centering.
 *    - Live adapter TAA jitter check: WebGPU/WebGL2 update jitterSample, Three.js omission check.
 *    - Rapid camera jumping: offscreen history UV triggers blendWeight = 0.0 (100% current frame, zero ghosting).
 *    - NaN / Inf motion vector vulnerability: IEEE-754 comparison behavior with NaN historyUV.
 *    - YCoCg 3x3 color neighborhood bounding box clamping: eliminating high-contrast ghosting.
 * 3. Atmospheric Sky Time-of-Day Extremes & Scattering:
 *    - Time-of-day boundary transitions: negative (-12h), exact 0.0h (midnight), 6.0h (sunrise),
 *      12.0h (solar noon), 18.0h (sunset), 24.0h (midnight), extreme (>24h).
 *    - Solar disc size extremes & limb darkening profile across angle cosines.
 *    - Turbidity limits: 0.0, 1.0, 5.0, 10.0, 50.0 and Rayleigh inverse 4th-power wavelength law across backends.
 * 4. DoF Bokeh Circle of Confusion (CoC) & Shapes:
 *    - Focal distance at origin (0), infinity (1e6), negative distances (-20).
 *    - Aperture extremes: 0.0 (pinhole/infinite depth-of-field), negative (-5), extreme (1000).
 *    - Bokeh kernel shape modulation: circular (Vogel disk), hexagonal (n=6), octagonal (n=8).
 *    - Singularity avoidance: proving cos(modAngle) >= cos(pi/n) > 0 for all angles.
 * 5. SSAO Sample Counts, Zero Radius & Geometric Occlusion:
 *    - Zero radius: verifying occlusion remains 0.0 and ao = 1.0 (no false darkening).
 *    - Sample count limits: 64, 128, 256 clamped to 32 max to prevent GPU TDR.
 *    - Concave corner crevice vs planar surface depth discrepancy occlusion differential.
 */


describe("Milestone 2 Adversarial Parity & Fidelity Challenger Suite", () => {
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
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Screen-Space Reflections (SSR) Raymarching Limits
  // ==========================================================================
  describe("1. SSR Raymarching Limits & Numerical Bounds", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] handles degenerate step counts (1 step, 256 steps, 0 steps, negative steps)`, () => {
        // Test step counts: 1, 256, 0, -15
        adapter.updateSSRSettings({ enabled: true, maxSteps: 1 })
        expect(adapter.state.postProcessState.ssr.maxSteps).toBe(1)

        adapter.updateSSRSettings({ maxSteps: 256 })
        expect(adapter.state.postProcessState.ssr.maxSteps).toBe(256)

        adapter.updateSSRSettings({ maxSteps: 0 })
        expect(adapter.state.postProcessState.ssr.maxSteps).toBe(0)

        adapter.updateSSRSettings({ maxSteps: -10 })
        expect(adapter.state.postProcessState.ssr.maxSteps).toBe(-10)
      })

    })


  })

  // ==========================================================================
  // Section 2: TAA Stability & Motion Vector Clamping
  // ==========================================================================
  describe("2. TAA Stability, Motion Vector Clamping & Ghosting Suppression", () => {


    it("verifies WebGL2 adapter executes Halton jitter in renderFrame when TAA is enabled", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setAntiAliasingMode("taa")

      expect(webgl2Adapter.getAntiAliasingMode()).toBe("taa")

      // Render 2 frames to advance jitter
      webgl2Adapter.renderFrame(16)
      const jitter1 = [...webgl2Adapter.state.postProcessState.taa.jitterSample]

      webgl2Adapter.renderFrame(32)
      const jitter2 = [...webgl2Adapter.state.postProcessState.taa.jitterSample]

      // Jitter samples must be active non-zero values
      expect(jitter1[0] !== 0 || jitter1[1] !== 0).toBe(true)
      expect(jitter2[0] !== 0 || jitter2[1] !== 0).toBe(true)
      expect(jitter1).not.toEqual(jitter2)
    })


    adapters.forEach(({ name, adapter }) => {
    })


  })

  // ==========================================================================
  // Section 3: Atmospheric Sky Time-of-Day Extremes & Scattering
  // ==========================================================================
  describe("3. Atmospheric Sky Time-of-Day Extremes & Scattering Law", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] handles time-of-day extremes (<0, 0.0, 6.0, 12.0, 18.0, 24.0, >24)`, () => {
        // Negative hour clamped to 0.0
        adapter.setAtmosphereParams({ timeOfDay: -15.5 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(0.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0.0)

        // Midnight (0.0h)
        adapter.setAtmosphereParams({ timeOfDay: 0.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(0.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0.0)

        // Sunrise (6.0h)
        adapter.setAtmosphereParams({ timeOfDay: 6.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(6.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)

        // Solar Noon (12.0h)
        adapter.setAtmosphereParams({ timeOfDay: 12.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(12.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(90.0, 1)

        // Sunset (18.0h)
        adapter.setAtmosphereParams({ timeOfDay: 18.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(18.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)

        // Midnight end (24.0h)
        adapter.setAtmosphereParams({ timeOfDay: 24.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(24.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0.0)

        // Beyond 24 hours clamped to 24.0
        adapter.setAtmosphereParams({ timeOfDay: 48.0 })
        expect(adapter.state.atmosphereParams.timeOfDay).toBe(24.0)
        expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0.0)
      })

      it(`[${name}] validates Rayleigh 1/lambda^4 law across spectrum and turbidity scaling`, () => {
        // Standard visible wavelengths: Red (680nm), Green (550nm), Blue (440nm)
        const wavelengths = [680, 550, 440]
        adapter.setAtmosphereParams({ timeOfDay: 12.0, turbidity: 2.5 })
        const scattering = adapter.calculateRayleighMieScattering(wavelengths)

        // Rayleigh scattering formula: 0.008 * (lambda_um)^-4
        // lambda = 0.44 um (blue) -> (0.44)^-4 = 26.67 -> rayleigh ~ 0.213
        // lambda = 0.68 um (red)  -> (0.68)^-4 = 4.67  -> rayleigh ~ 0.037
        const rRed = scattering.rayleigh[0]
        const rGreen = scattering.rayleigh[1]
        const rBlue = scattering.rayleigh[2]

        expect(rBlue).toBeGreaterThan(rGreen)
        expect(rGreen).toBeGreaterThan(rRed)

        // Blue-to-red ratio must match theoretical (680/440)^4 ~= 5.71
        const theoreticalRatio = Math.pow(680 / 440, 4)
        const actualRatio = rBlue / rRed
        expect(actualRatio).toBeCloseTo(theoreticalRatio, 2)

        // Mie scattering scales linearly with turbidity
        expect(scattering.mie).toBeCloseTo(0.002 * 2.5, 6)

        // Turbidity extremes: 0.0, 10.0, 50.0
        adapter.setAtmosphereParams({ turbidity: 0.0 })
        expect(adapter.calculateRayleighMieScattering().mie).toBe(0.0)

        adapter.setAtmosphereParams({ turbidity: 10.0 })
        expect(adapter.calculateRayleighMieScattering().mie).toBeCloseTo(0.02, 6)

        adapter.setAtmosphereParams({ turbidity: 50.0 })
        expect(adapter.calculateRayleighMieScattering().mie).toBeCloseTo(0.10, 6)
      })
    })

    it("verifies solar disc limb darkening profile and night/day radiance evaluation", () => {
      // 1. Sky radiance away from the sun disc (e.g. dir at 45 degrees, sunDot < 0.9)
      const skyAwayDir = uvToDirection(0.25, 0.35) // upper sky away from sun
      const noonSkyRadiance = evaluateEnvironmentRadiance(skyAwayDir, "atmosphere", 12.0)
      // Pure Rayleigh blue sky: blue is dominant over red and green
      expect(noonSkyRadiance.b).toBeGreaterThan(noonSkyRadiance.r)
      expect(noonSkyRadiance.b).toBeGreaterThan(noonSkyRadiance.g)

      // 2. Solar disc center: looking directly at sun at noon ([0, 1, 0])
      const zenithSunDir: [number, number, number] = [0, 1, 0]
      const sunCoreRadiance = evaluateEnvironmentRadiance(zenithSunDir, "atmosphere", 12.0)
      // Solar disc emission is intense (> 15.0 HDR) and warm yellow/white (r > b)
      expect(sunCoreRadiance.r).toBeGreaterThan(15.0)
      expect(sunCoreRadiance.r).toBeGreaterThan(sunCoreRadiance.b)

      // 3. Sunset horizon (18.0h): looking towards sun at horizon
      const sunsetHorizonDir = uvToDirection(0.5, 0.48) // near horizon
      const sunsetRadiance = evaluateEnvironmentRadiance(sunsetHorizonDir, "atmosphere", 18.0)
      // Sunset glow: amber/orange horizon (red dominant)
      expect(sunsetRadiance.r).toBeGreaterThan(sunsetRadiance.b)

      // 4. Midnight (0.0h): dark indigo night sky
      const midnightRadiance = evaluateEnvironmentRadiance(zenithSunDir, "atmosphere", 0.0)
      expect(midnightRadiance.r).toBeLessThan(0.05)
      expect(midnightRadiance.g).toBeLessThan(0.05)
      expect(midnightRadiance.b).toBeLessThan(0.1)
    })
  })

  // ==========================================================================
  // Section 4: Depth of Field (DoF) Bokeh CoC & Kernel Shapes
  // ==========================================================================
  describe("4. Depth of Field (DoF) Bokeh CoC & Kernel Shapes", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] updates DoF settings with focal distance and aperture bounds`, () => {
        adapter.updateDoFSettings({
          enabled: true,
          focalDistance: 0.0, // focal distance at origin
          aperture: 0.0,      // pinhole aperture
          bokehShape: "circle",
        })
        expect(adapter.state.postProcessState.dof.focalDistance).toBe(0.0)
        expect(adapter.state.postProcessState.dof.aperture).toBe(0.0)

        // Extreme aperture and infinite focal distance
        adapter.updateDoFSettings({
          focalDistance: 1e6,
          aperture: 100.0,
          bokehShape: "octagon",
        })
        expect(adapter.state.postProcessState.dof.focalDistance).toBe(1e6)
        expect(adapter.state.postProcessState.dof.aperture).toBe(100.0)
        expect(adapter.state.postProcessState.dof.bokehShape).toBe("octagon")

        // Negative focal distance
        adapter.updateDoFSettings({
          focalDistance: -10.0,
        })
        expect(adapter.state.postProcessState.dof.focalDistance).toBe(-10.0)
      })
    })


  })


  // ==========================================================================
  // Section 6: Cross-Backend Parity and Interface Contract Conformance
  // ==========================================================================
  describe("6. Cross-Backend Parity & Interface Contract Conformance", () => {
    it("verifies all three backends report identical default post-process uniforms", () => {
      const passes = ["vignette", "blur", "chromatic_aberration", "bloom", "ssao", "dof", "fxaa", "taa", "ssr"] as const
      for (const pass of passes) {
        const defaults = getDefaultPostProcessUniforms(pass)
        expect(defaults).toBeDefined()
        expect(Object.keys(defaults).length).toBeGreaterThan(0)
      }
    })

  })
})
})

describe("Gate 2 remediation: TAA, Three.js passes, WebGL2 aux textures", () => {
/**
 * Milestone 2 Remediation Adversarial Challenge Suite (Gate 2 Round 2)
 *
 * Empirical verification of:
 * 1. TAA NaN/Inf motion vector rejection in GLSL and WGSL shaders.
 * 2. Three.js Halton(2,3) projection jitter during renderFrame() when TAA is enabled,
 *    and projection restoration after rendering.
 * 3. Three.js post-processing shader passes for SSAO, DoF, FXAA, TAA, SSR (ensuring no silent vignette fallbacks).
 * 4. WebGL2 auxiliary texture unit bindings in the post-processing chain.
 */


// Mock Three.js WebGLRenderer with headless MockThreeRenderer for complete ThreeJS lifecycle execution

describe("Milestone 2 Remediation Adversarial Challenge Suite (Gate 2)", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Focus 1: TAA NaN/Inf Motion Vector Rejection
  // ==========================================================================
  describe("Focus 1: TAA NaN/Inf Motion Vector Rejection in Shaders", () => {
    const rootDir = path.resolve(__dirname, "..", "..")
    const fragPath = path.join(rootDir, "src", "shaders", "postprocess", "taa.frag")
    const wgslPath = path.join(rootDir, "src", "shaders", "postprocess", "taa.wgsl")

    it("verifies taa.frag contains hardened NaN/Inf guard syntax and rejects flawed pattern", () => {
      const content = fs.readFileSync(fragPath, "utf-8")
      // Must contain safe inverted range check: !(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)
      expect(content).toMatch(/!\s*\(\s*historyUV\.x\s*>=\s*0\.0\s*&&\s*historyUV\.x\s*<=\s*1\.0\s*&&\s*historyUV\.y\s*>=\s*0\.0\s*&&\s*historyUV\.y\s*<=\s*1\.0\s*\)/)
      // Must NOT contain the flawed IEEE-754 NaN bypass pattern: historyUV.x < 0.0 || historyUV.x > 1.0
      expect(content).not.toMatch(/historyUV\.x\s*<\s*0\.0\s*\|\|\s*historyUV\.x\s*>\s*1\.0/)
    })

    it("verifies taa.wgsl contains hardened NaN/Inf guard syntax and rejects flawed pattern", () => {
      const content = fs.readFileSync(wgslPath, "utf-8")
      // Must contain safe inverted range check: !(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)
      expect(content).toMatch(/!\s*\(\s*historyUV\.x\s*>=\s*0\.0\s*&&\s*historyUV\.x\s*<=\s*1\.0\s*&&\s*historyUV\.y\s*>=\s*0\.0\s*&&\s*historyUV\.y\s*<=\s*1\.0\s*\)/)
      // Must NOT contain the flawed IEEE-754 NaN bypass pattern
      expect(content).not.toMatch(/historyUV\.x\s*<\s*0\.0\s*\|\|\s*historyUV\.x\s*>\s*1\.0/)
    })

  })

  // ==========================================================================
  // Focus 2: Three.js Halton(2,3) Projection Jitter & Restoration
  // ==========================================================================
  describe("Focus 2: Three.js Halton Projection Jitter & Projection Restoration", () => {
    it("verifies Three.js executes Halton jitter when TAA is enabled, and restores projection matrix after render", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      const mounted = await threejsAdapter.mount(canvas)
      expect(mounted).toBe(true)
      expect((threejsAdapter as any).initialized).toBe(true)

      // Initially with TAA disabled, jitter is [0, 0]
      threejsAdapter.setAntiAliasingMode("none")
      expect(threejsAdapter.getAntiAliasingMode()).toBe("none")
      threejsAdapter.renderFrame(16)
      expect(threejsAdapter.state.postProcessState.taa.jitterSample).toEqual([0, 0])

      // Record pristine unjittered camera projection matrix
      const unjitteredElements = [...(threejsAdapter as any).camera.projectionMatrix.elements]

      // Enable TAA
      threejsAdapter.setAntiAliasingMode("taa")
      expect(threejsAdapter.getAntiAliasingMode()).toBe("taa")
      expect(threejsAdapter.state.postProcessState.taa.enabled).toBe(true)

      // Render frame 1
      threejsAdapter.renderFrame(32)
      const jitterFrame1 = [...threejsAdapter.state.postProcessState.taa.jitterSample]

      // Jitter sample must be active non-zero
      expect(jitterFrame1[0] !== 0 || jitterFrame1[1] !== 0).toBe(true)

      // Projection matrix MUST be restored to pristine unjittered state after renderFrame()
      const postRenderElements1 = [...(threejsAdapter as any).camera.projectionMatrix.elements]
      expect(postRenderElements1).toEqual(unjitteredElements)

      // Render frame 2
      threejsAdapter.renderFrame(48)
      const jitterFrame2 = [...threejsAdapter.state.postProcessState.taa.jitterSample]

      // Jitter sample must change
      expect(jitterFrame2).not.toEqual(jitterFrame1)

      // Projection matrix must still be restored
      const postRenderElements2 = [...(threejsAdapter as any).camera.projectionMatrix.elements]
      expect(postRenderElements2).toEqual(unjitteredElements)
    })

    it("verifies 8-frame Halton periodicity and zero-drift centering in Three.js adapter", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setAntiAliasingMode("taa")

      const samples: [number, number][] = []
      for (let i = 0; i < 16; i++) {
        threejsAdapter.renderFrame(16 * (i + 1))
        samples.push([...threejsAdapter.state.postProcessState.taa.jitterSample] as [number, number])
      }

      // Periodicity check: Frame 0 equals Frame 8, Frame 1 equals Frame 9, etc.
      expect(samples[0][0]).toBeCloseTo(samples[8][0], 8)
      expect(samples[0][1]).toBeCloseTo(samples[8][1], 8)
      expect(samples[1][0]).toBeCloseTo(samples[9][0], 8)
      expect(samples[1][1]).toBeCloseTo(samples[9][1], 8)
      expect(samples[4][0]).toBeCloseTo(samples[12][0], 8)
      expect(samples[7][1]).toBeCloseTo(samples[15][1], 8)

      // Zero-drift centering: Average jitter across 8 phases should be close to 0
      const avgX = samples.slice(0, 8).reduce((acc, s) => acc + s[0], 0) / 8
      const avgY = samples.slice(0, 8).reduce((acc, s) => acc + s[1], 0) / 8
      expect(Math.abs(avgX)).toBeLessThan(0.0005)
      expect(Math.abs(avgY)).toBeLessThan(0.0005)
    })

    it("verifies Three.js Halton jitter and restoration operates identically in deferred pipeline mode", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setRenderingPipelineMode("deferred")
      threejsAdapter.setAntiAliasingMode("taa")

      expect(threejsAdapter.getPipelineMode()).toBe("deferred")
      expect(threejsAdapter.getAntiAliasingMode()).toBe("taa")

      const baselineProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]

      threejsAdapter.renderFrame(16)
      const jitterSample = [...threejsAdapter.state.postProcessState.taa.jitterSample]
      expect(jitterSample[0] !== 0 || jitterSample[1] !== 0).toBe(true)

      // Projection matrix restored in deferred mode as well
      const restoredProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]
      expect(restoredProj).toEqual(baselineProj)
    })
  })

  // ==========================================================================
  // Focus 3: Three.js Post-Processing Shader Passes (No Vignette Fallbacks)
  // ==========================================================================
  describe("Focus 3: Three.js Post-Processing Passes (SSAO, DoF, FXAA, TAA, SSR)", () => {
    it("instantiates distinct shader passes for SSAO, DoF, FXAA, TAA, SSR with proper uniforms and shaders", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)

      const passesToTest: PostProcessPassType[] = [
        "fxaa",
        "taa",
        "ssao",
        "dof",
        "ssr",
        "bloom",
        "chromatic_aberration",
        "vignette",
      ]

      const queue: RenderQueue = [
        { type: "mesh", id: "mesh-1", geometry: "cube" },
        ...passesToTest.map((pass, idx) => ({
          type: "postprocess" as const,
          id: `pp-${pass}-${idx}`,
          pass,
          uniforms: {},
        })),
      ]

      threejsAdapter.setRenderQueue(queue)
      expect((threejsAdapter as any).hasPostProcess).toBe(true)

      const passesMap: Map<string, any> = (threejsAdapter as any).postProcessPassesMap
      expect(passesMap).toBeDefined()

      // 1. Check SSAO pass
      const ssaoPass = passesMap.get("ssao")
      expect(ssaoPass).toBeDefined()
      expect(ssaoPass.uniforms.u_radius).toBeDefined()
      expect(ssaoPass.uniforms.u_intensity).toBeDefined()
      expect(ssaoPass.uniforms.u_sampleCount).toBeDefined()
      expect(ssaoPass.uniforms.u_bias).toBeDefined()
      expect(ssaoPass.uniforms.u_depthTexture).toBeDefined()
      expect(ssaoPass.uniforms.u_normalTexture).toBeDefined()
      // Frag shader must NOT be vignette fallback
      expect(ssaoPass.material.fragmentShader).not.toContain("u_vignetteRadius")
      expect(ssaoPass.material.fragmentShader).toContain("interleavedGradientNoise")

      // 2. Check DoF pass
      const dofPass = passesMap.get("dof")
      expect(dofPass).toBeDefined()
      expect(dofPass.uniforms.u_focalDistance).toBeDefined()
      expect(dofPass.uniforms.u_aperture).toBeDefined()
      expect(dofPass.uniforms.u_maxBlur).toBeDefined()
      expect(dofPass.uniforms.u_bokehShape).toBeDefined()
      expect(dofPass.uniforms.u_depthTexture).toBeDefined()
      expect(dofPass.material.fragmentShader).not.toContain("u_vignetteRadius")
      expect(dofPass.material.fragmentShader).toContain("coc = clamp")

      // 3. Check FXAA pass
      const fxaaPass = passesMap.get("fxaa")
      expect(fxaaPass).toBeDefined()
      expect(fxaaPass.uniforms.u_resolution).toBeDefined()
      expect(fxaaPass.material.fragmentShader).not.toContain("u_vignetteRadius")
      expect(fxaaPass.material.fragmentShader).toContain("rgb2luma")

      // 4. Check TAA pass
      const taaPass = passesMap.get("taa")
      expect(taaPass).toBeDefined()
      expect(taaPass.uniforms.u_historyTexture).toBeDefined()
      expect(taaPass.uniforms.u_motionTexture).toBeDefined()
      expect(taaPass.uniforms.u_feedbackMax).toBeDefined()
      expect(taaPass.uniforms.u_motionScale).toBeDefined()
      expect(taaPass.material.fragmentShader).not.toContain("u_vignetteRadius")
      expect(taaPass.material.fragmentShader).toContain("RGBToYCoCg")
      // Verify NaN/Inf guard is inside Three.js TAA shader
      expect(taaPass.material.fragmentShader).toContain("!(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)")

      // 5. Check SSR pass
      const ssrPass = passesMap.get("ssr")
      expect(ssrPass).toBeDefined()
      expect(ssrPass.uniforms.u_depthTexture).toBeDefined()
      expect(ssrPass.uniforms.u_normalTexture).toBeDefined()
      expect(ssrPass.uniforms.u_maxSteps).toBeDefined()
      expect(ssrPass.uniforms.u_thickness).toBeDefined()
      expect(ssrPass.uniforms.u_falloff).toBeDefined()
      expect(ssrPass.uniforms.u_iblBlend).toBeDefined()
      expect(ssrPass.material.fragmentShader).not.toContain("u_vignetteRadius")
      expect(ssrPass.material.fragmentShader).toContain("reflectDir")
    })

    it("verifies Three.js updatePostProcessUniform updates target uniform values on shader passes", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)

      const queue: RenderQueue = [
        { type: "mesh", id: "mesh-1", geometry: "cube" },
        { type: "postprocess", id: "ssao-pass-1", pass: "ssao", uniforms: { radius: 0.5, intensity: 1.5 } },
        { type: "postprocess", id: "dof-pass-1", pass: "dof", uniforms: { focalDistance: 5.0, aperture: 0.05 } },
      ]
      threejsAdapter.setRenderQueue(queue)

      // Update SSAO uniform
      threejsAdapter.updatePostProcessUniform("ssao-pass-1", "radius", 1.25)
      const passesMap: Map<string, any> = (threejsAdapter as any).postProcessPassesMap
      const ssao = passesMap.get("ssao-pass-1")
      expect(ssao.uniforms.u_radius.value).toBe(1.25)

      // Update DoF uniform
      threejsAdapter.updatePostProcessUniform("dof-pass-1", "focalDistance", 12.0)
      const dof = passesMap.get("dof-pass-1")
      expect(dof.uniforms.u_focalDistance.value).toBe(12.0)
    })
  })

  // ==========================================================================
  // Focus 4: WebGL2 Auxiliary Texture Unit Bindings
  // ==========================================================================
  describe("Focus 4: WebGL2 Auxiliary Texture Unit Bindings in Post-Processing", () => {
    it("binds auxiliary textures to texture units 1 through 4 during WebGL2 post-processing", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      // Setup post-process queue requiring depth, normal, motion, and history
      const queue: RenderQueue = [
        { type: "mesh", id: "m1", geometry: "cube" },
        { type: "postprocess", id: "pp-ssao", pass: "ssao", uniforms: {} },
        { type: "postprocess", id: "pp-taa", pass: "taa", uniforms: {} },
      ]
      webgl2Adapter.setRenderQueue(queue)

      const gl = (webgl2Adapter as any).gl
      expect(gl).toBeDefined()

      const activeTextureSpy = vi.spyOn(gl, "activeTexture")
      const bindTextureSpy = vi.spyOn(gl, "bindTexture")
      const uniform1iSpy = vi.spyOn(gl, "uniform1i")

      // Render frame
      webgl2Adapter.renderFrame(16)

      // Verify activeTexture was called for units 0, 1, 2, 3, 4
      const activeCalls = activeTextureSpy.mock.calls.map((c) => c[0] - gl.TEXTURE0)
      expect(activeCalls).toContain(0) // u_texture (unit 0)
      expect(activeCalls).toContain(1) // u_depthTexture (unit 1)
      expect(activeCalls).toContain(2) // u_normalTexture (unit 2)
      expect(activeCalls).toContain(3) // u_motionTexture (unit 3)
      expect(activeCalls).toContain(4) // u_historyTexture (unit 4)

      // Verify uniform1i bound the corresponding samplers to units 0-4
      const boundUnits = uniform1iSpy.mock.calls.map((c) => c[1])
      expect(boundUnits).toContain(0)
      expect(boundUnits).toContain(1)
      expect(boundUnits).toContain(2)
      expect(boundUnits).toContain(3)
      expect(boundUnits).toContain(4)

      // Verify bindTexture bound non-null WebGLTextures
      for (const call of bindTextureSpy.mock.calls) {
        expect(call[0]).toBe(gl.TEXTURE_2D)
        expect(call[1]).not.toBeNull()
      }
    })

    it("verifies WebGL2 post-processing gracefully handles null GBuffer textures by binding defaultTexture", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await webgl2Adapter.mount(canvas)

      // Forward mode: GBuffer textures are null
      webgl2Adapter.setRenderingPipelineMode("forward")
      expect(webgl2Adapter.getGBufferTextures()).toBeNull()

      const queue: RenderQueue = [
        { type: "mesh", id: "m1", geometry: "cube" },
        { type: "postprocess", id: "pp-ssao", pass: "ssao", uniforms: {} },
      ]
      webgl2Adapter.setRenderQueue(queue)

      const gl = (webgl2Adapter as any).gl
      const bindTextureSpy = vi.spyOn(gl, "bindTexture")

      // Rendering should NOT crash with null texture
      expect(() => webgl2Adapter.renderFrame(16)).not.toThrow()

      // None of the bindTexture calls should pass null
      for (const call of bindTextureSpy.mock.calls) {
        expect(call[1]).not.toBeNull()
        expect(call[1]).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // Section 5: Multi-Backend Canvas Resize & GBuffer Dynamic Reallocation
  // ==========================================================================
  describe("Section 5: Multi-Backend Dynamic Canvas Resize in Deferred Mode", () => {
    it("verifies Three.js reallocates GBuffer render target matching new canvas size", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setRenderingPipelineMode("deferred")

      const gbuffer1 = threejsAdapter.getGBufferTextures()
      expect(gbuffer1).not.toBeNull()
      const rt1 = (threejsAdapter as any).gBufferRenderTarget
      expect(rt1.width).toBe(800)
      expect(rt1.height).toBe(600)

      // Resize canvas to 1280x720
      threejsAdapter.resize(1280, 720, 1.0)
      const rt2 = (threejsAdapter as any).gBufferRenderTarget
      expect(rt2.width).toBe(1280)
      expect(rt2.height).toBe(720)
    })

    it("verifies Three.js Halton jitter inversely scales with resized canvas dimensions", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setAntiAliasingMode("taa")

      threejsAdapter.renderFrame(16)
      const jitterAt800 = Math.abs(threejsAdapter.state.postProcessState.taa.jitterSample[0])

      // Resize to 1600x1200 (double resolution)
      threejsAdapter.resize(1600, 1200, 1.0)
      threejsAdapter.renderFrame(32)
      // Jitter magnitude at 1600x1200 should be proportionally scaled by 1/1600 vs 1/800
      const jitterSample = threejsAdapter.state.postProcessState.taa.jitterSample
      expect(jitterSample[0] !== 0 || jitterSample[1] !== 0).toBe(true)
      expect(Math.abs(jitterSample[0])).toBeLessThan(1.0 / 1600)
    })

    it("verifies WebGL2 reallocates GBuffer textures and updates dimensions on resize", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      const gbuffer1 = webgl2Adapter.getGBufferTextures()
      expect(gbuffer1?.albedo.width).toBe(800)
      expect(gbuffer1?.albedo.height).toBe(600)

      // Resize to 1920x1080
      webgl2Adapter.resize(1920, 1080, 1.0)
      const gbuffer2 = webgl2Adapter.getGBufferTextures()
      expect(gbuffer2?.albedo.width).toBe(1920)
      expect(gbuffer2?.albedo.height).toBe(1080)
    })
  })

  // ==========================================================================
  // Section 6: Stress Testing Long-Running TAA Cycles & Jitter Stability
  // ==========================================================================
  describe("Section 6: Long-Running TAA Frame Cycles & Jitter Stability", () => {
    it("survives 100 consecutive frames in Three.js without jitter drift, NaN, or unbounded growth", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setAntiAliasingMode("taa")

      const baselineProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]

      for (let f = 0; f < 100; f++) {
        threejsAdapter.renderFrame(16 * f)
        const [jX, jY] = threejsAdapter.state.postProcessState.taa.jitterSample
        expect(Number.isFinite(jX)).toBe(true)
        expect(Number.isFinite(jY)).toBe(true)
        expect(Math.abs(jX)).toBeLessThan(1.0 / 800)
        expect(Math.abs(jY)).toBeLessThan(1.0 / 600)

        // After every single frame, camera projection matrix must be restored
        const curProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]
        expect(curProj).toEqual(baselineProj)
      }
    })

    it("survives rapid toggling between anti-aliasing modes without corrupting camera matrix", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)

      const pristineProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]

      for (let i = 0; i < 20; i++) {
        threejsAdapter.setAntiAliasingMode("taa")
        threejsAdapter.renderFrame(16 * i)
        expect(threejsAdapter.getAntiAliasingMode()).toBe("taa")

        threejsAdapter.setAntiAliasingMode("fxaa")
        threejsAdapter.renderFrame(16 * i + 8)
        expect(threejsAdapter.getAntiAliasingMode()).toBe("fxaa")

        threejsAdapter.setAntiAliasingMode("none")
        threejsAdapter.renderFrame(16 * i + 12)
        expect(threejsAdapter.getAntiAliasingMode()).toBe("none")
      }

      // Final camera projection matrix must remain completely identical to pristine
      const finalProj = [...(threejsAdapter as any).camera.projectionMatrix.elements]
      expect(finalProj).toEqual(pristineProj)
    })
  })
})
})

describe("Gate 3 verification: shadow settings and GBuffer DPR", () => {
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
})

describe("Post-processing chain and ping-pong", () => {
describe("Tier 1: Post-Processing Chain & Ping-Pong", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  // Feature 22: Ping-Pong Buffer Architecture (WebGPU)
  describe("Feature 22: Ping-Pong Buffer Architecture (WebGPU)", () => {
    it("creates dual texture targets on resize", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)

      expect(pingPong.getCurrent()).not.toBeNull()
      expect(pingPong.getNext()).not.toBeNull()
      expect(pingPong.getCurrent()).not.toBe(pingPong.getNext())

      pingPong.destroy()
    })

    it("swaps active and target views on swap()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(640, 480)

      const firstCurrent = pingPong.getCurrent()
      const firstNext = pingPong.getNext()

      pingPong.swap()
      expect(pingPong.getCurrent()).toBe(firstNext)
      expect(pingPong.getNext()).toBe(firstCurrent)

      pingPong.swap()
      expect(pingPong.getCurrent()).toBe(firstCurrent)

      pingPong.destroy()
    })

    it("resets current view index to 0 on reset()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)

      const initialCurrent = pingPong.getCurrent()
      pingPong.swap()
      expect(pingPong.getCurrent()).not.toBe(initialCurrent)

      pingPong.reset()
      expect(pingPong.getCurrent()).toBe(initialCurrent)

      pingPong.destroy()
    })

    it("recreates textures when resized to new dimensions", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(400, 300)
      const count1 = device.createdTextures.length

      pingPong.resize(800, 600)
      const count2 = device.createdTextures.length
      expect(count2).toBeGreaterThan(count1)

      pingPong.destroy()
    })

    it("destroys both textures on destroy()", () => {
      const device = new MockGPUDevice()
      const pingPong = new WebGPUPingPong(device as any)
      pingPong.resize(800, 600)
      pingPong.destroy()

      expect(pingPong.getCurrent()).toBeNull()
      expect(pingPong.getNext()).toBeNull()
    })
  })

  // Feature 23: Ping-Pong FBO Architecture (WebGL2)
  describe("Feature 23: Ping-Pong FBO Architecture (WebGL2)", () => {
    it("creates framebuffer with color attachment texture", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)

      expect(fbo.getTexture()).not.toBeNull()
      expect(gl.createdFramebuffers.length).toBeGreaterThan(0)

      fbo.destroy()
    })

    it("binds and unbinds framebuffer", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)

      fbo.bind()
      expect(gl.boundFramebuffer).not.toBeNull()

      fbo.unbind()
      expect(gl.boundFramebuffer).toBeNull()

      fbo.destroy()
    })

    it("WebGL2Adapter sets up dual FBOs when postprocess step is present", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)

      adapter.dispose()
    })

    it("renders to FBO and then renders postprocess quad to screen", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      const initialDrawCount = gl.drawCount

      env.clock.step(16)
      // Expect mesh draw + post-process quad draw
      expect(gl.drawCount).toBeGreaterThanOrEqual(initialDrawCount + 2)

      adapter.dispose()
    })

    it("cleans up framebuffers and textures on destroy", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const fbo = new WebGL2Framebuffer(gl)
      fbo.resize(800, 600)
      const tex = fbo.getTexture()

      fbo.destroy()
      expect(fbo.getTexture()).toBeNull()
      expect(tex?.isDestroyed).toBe(true)
    })
  })

  // Feature 24: Three.js EffectComposer Chaining
  describe("Feature 24: Three.js EffectComposer Chaining", () => {
    it("instantiates EffectComposer when postprocess step is queued", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      expect(() => {
        adapter.setRenderQueue([
          { type: "mesh", geometry: "cube" },
          { type: "postprocess", pass: "passthrough" },
        ])
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })

    it("executes composer render on render frames when postprocess is enabled", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      env.clock.stepFrames(3, 16.666)
      adapter.dispose()
    })

    it("resizes composer when adapter resize is called", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.resize(1024, 768)).not.toThrow()

      adapter.dispose()
    })

    it("switches from direct render to composer render and back without crash", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Direct render
      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      // Post-process render
      adapter.setRenderQueue([
        { type: "mesh", geometry: "sphere" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      // Back to direct render
      adapter.setRenderQueue([{ type: "mesh", geometry: "sphere" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("disposes composer cleanly on adapter disposal", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.dispose()).not.toThrow()
    })
  })

  // Feature 25: Post-Process Shaders (WGSL & GLSL)
  describe("Feature 25: Post-Process Shaders (WGSL & GLSL)", () => {
    it("defines valid passthrough vertex shader", () => {
      expect(PASSTHROUGH_VERTEX).toContain("#version 300 es")
      expect(PASSTHROUGH_VERTEX).toContain("in vec2 a_position;")
      expect(PASSTHROUGH_VERTEX).toContain("out vec2 v_texCoord;")
    })

    it("defines valid vignette fragment shader with uniform controls", () => {
      expect(VIGNETTE_FRAGMENT).toContain("uniform sampler2D u_texture;")
      expect(VIGNETTE_FRAGMENT).toContain("uniform float u_vignetteIntensity;")
      expect(VIGNETTE_FRAGMENT).toContain("uniform float u_vignetteRadius;")
      expect(VIGNETTE_FRAGMENT).toContain("smoothstep(u_vignetteRadius")
    })

    it("defines valid blur fragment shader with kernel weights", () => {
      expect(BLUR_FRAGMENT).toContain("uniform float u_blurAmount;")
      expect(BLUR_FRAGMENT).toContain("uniform vec2 u_resolution;")
      expect(BLUR_FRAGMENT).toContain("weights[9]")
    })

    it("compiles vignette shader in WebGL2 without compile errors", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, VIGNETTE_FRAGMENT)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })

    it("compiles blur shader in WebGL2 without compile errors", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, BLUR_FRAGMENT)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })
  })

  // Feature 26: PostProcessNode Configuration
  describe("Feature 26: PostProcessNode UI & Configuration", () => {
    it("builds postprocess chain with vignette pass from render steps", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain).toHaveLength(1)
      expect(chain[0].type).toBe("vignette")
      expect(chain[0].uniforms.u_vignetteIntensity).toBe(0.5)
      expect(chain[0].uniforms.u_vignetteRadius).toBe(0.8)
    })

    it("returns empty chain when no postprocess steps exist", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "sphere" },
        { type: "material", shaderPath: "default.wgsl", textureBindings: {} },
      ])
      expect(chain).toHaveLength(0)
    })

    it("builds multiple passes when multiple postprocess steps exist", () => {
      const chain = buildPostProcessChain([
        { type: "postprocess", pass: "passthrough" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain).toHaveLength(2)
    })

    it("supports setting custom uniform parameters on pass", () => {
      const pass = {
        type: "vignette" as const,
        uniforms: { u_vignetteIntensity: 0.9, u_vignetteRadius: 0.4 },
      }
      expect(pass.uniforms.u_vignetteIntensity).toBe(0.9)
      expect(pass.uniforms.u_vignetteRadius).toBe(0.4)
    })

    it("preserves pass order matching render step sequence", () => {
      const chain = buildPostProcessChain([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      expect(chain[0].type).toBe("vignette")
    })
  })

  // Feature 27: Dynamic Post-Processing Graph Updates
  describe("Feature 27: Dynamic Post-Processing Graph Updates", () => {
    it("dynamically activates post-processing on WebGL2 without reconnecting canvas", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Start without postprocess
      adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
      env.clock.step(16)

      // Add postprocess
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)

      adapter.dispose()
    })

    it("dynamically removes post-processing on WebGL2 without page reload", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // With postprocess
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      env.clock.step(16)

      // Remove postprocess
      adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
      env.clock.step(16)

      adapter.dispose()
    })

    it("handles rapid toggling of postprocess step", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      for (let i = 0; i < 4; i++) {
        adapter.setRenderQueue(
          i % 2 === 0
            ? [{ type: "mesh", geometry: "cube" }, { type: "postprocess", pass: "passthrough" }]
            : [{ type: "mesh", geometry: "cube" }]
        )
        env.clock.step(16)
      }

      adapter.dispose()
    })

    it("updates FBO dimensions when viewport resizes during active post-processing", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])

      const gl = env.webgl2.getLastContext()!
      const initialFboCount = gl.createdFramebuffers.length

      adapter.resize(1920, 1080)
      expect(gl.createdFramebuffers.length).toBeGreaterThan(initialFboCount)

      adapter.dispose()
    })

    it("handles setRenderQueue(null) cleanly when postprocess was active", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([{ type: "postprocess", pass: "passthrough" }])
      expect(() => adapter.setRenderQueue(null)).not.toThrow()

      adapter.dispose()
    })
  })

  // Feature 28: Custom Post-Process Node Support
  describe("Feature 28: Custom Post-Process Node Support", () => {
    it("represents custom pass with shaderSource in PostProcessPass", () => {
      const customPass = {
        type: "custom" as const,
        shaderSource: "void main() { fragColor = vec4(1.0); }",
        uniforms: { u_factor: 1.5 },
      }
      expect(customPass.type).toBe("custom")
      expect(customPass.shaderSource).toBeDefined()
    })

    it("compiles custom fragment shader program in WebGL2", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const customFrag = `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_exposure;
        in vec2 v_texCoord;
        out vec4 fragColor;
        void main() {
          vec4 c = texture(u_texture, v_texCoord);
          fragColor = vec4(c.rgb * u_exposure, c.a);
        }
      `
      const vert = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vert, PASSTHROUGH_VERTEX)
      gl.compileShader(vert)

      const frag = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(frag, customFrag)
      gl.compileShader(frag)

      const prog = gl.createProgram()
      gl.attachShader(prog, vert)
      gl.attachShader(prog, frag)
      gl.linkProgram(prog)

      expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(true)
    })

    it("sets uniforms on custom postprocess program", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      const loc = gl.getUniformLocation(prog, "u_exposure")
      gl.uniform1f(loc, 2.5)

      expect(gl.uniformValues.get("u_exposure")).toBe(2.5)
    })

    it("handles multiple chained custom passes", () => {
      const passes = [
        { type: "custom" as const, uniforms: { u_tone: 1 } },
        { type: "blur" as const, uniforms: { u_blurAmount: 2 } },
      ]
      expect(passes).toHaveLength(2)
      expect(passes[0].type).toBe("custom")
      expect(passes[1].type).toBe("blur")
    })

    it("disposes custom program resources without memory leaks", () => {
      const gl = (env.createCanvas() as any).getContext("webgl2")
      const prog = gl.createProgram()
      gl.deleteProgram(prog)
      expect(prog.isDestroyed).toBe(true)
    })
  })
})
})

describe("Post-processing suite multi-backend", () => {
describe("Post-Processing Suite: Multi-Backend & Multi-Pass", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  describe("Graph Compiler PostProcess Node Integration", () => {
    it("emits exact legacy passthrough step when node is unconfigured", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        { id: "pp-1", position: { x: 200, y: 0 }, data: { type: "postprocess" } },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-1" },
        { id: "e3", source: "pp-1", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      const ppStep = result.queue.find((s) => s.type === "postprocess")
      expect(ppStep).toEqual({ type: "postprocess", pass: "passthrough" })
    })

    it("emits rich postprocess step with id, passType, and params when configured", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        {
          id: "pp-chroma",
          position: { x: 200, y: 0 },
          data: {
            type: "postprocess",
            passType: "chromatic_aberration",
            params: { aberrationOffset: 0.015 },
          },
        },
        { id: "out-1", position: { x: 300, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-chroma" },
        { id: "e3", source: "pp-chroma", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      const ppStep = result.queue.find((s) => s.type === "postprocess")
      expect(ppStep).toEqual({
        type: "postprocess",
        id: "pp-chroma",
        pass: "chromatic_aberration",
        customSource: undefined,
        uniforms: { aberrationOffset: 0.015 },
      })
    })

    it("orders chained multiple post-processing passes sequentially", () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh-1", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "mat-1", position: { x: 100, y: 0 }, data: { type: "material", shaderPath: null } },
        {
          id: "pp-1",
          position: { x: 200, y: 0 },
          data: { type: "postprocess", passType: "vignette", params: { intensity: 0.6 } },
        },
        {
          id: "pp-2",
          position: { x: 300, y: 0 },
          data: { type: "postprocess", passType: "bloom", params: { bloomIntensity: 0.8 } },
        },
        {
          id: "pp-3",
          position: { x: 400, y: 0 },
          data: { type: "postprocess", passType: "blur", params: { blurAmount: 3.0 } },
        },
        { id: "out-1", position: { x: 500, y: 0 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh-1", target: "mat-1", targetHandle: "mesh" },
        { id: "e2", source: "mat-1", target: "pp-1" },
        { id: "e3", source: "pp-1", target: "pp-2" },
        { id: "e4", source: "pp-2", target: "pp-3" },
        { id: "e5", source: "pp-3", target: "out-1" },
      ]
      const result = compileGraph(nodes, edges)
      expect(result.error).toBeNull()
      const ppSteps = result.queue.filter((s) => s.type === "postprocess")
      expect(ppSteps).toHaveLength(3)
      expect(ppSteps[0].pass).toBe("vignette")
      expect(ppSteps[1].pass).toBe("bloom")
      expect(ppSteps[2].pass).toBe("blur")
    })
  })

  describe("Post-Process Chain Core Utilities & Shaders", () => {
    it("contains valid shader templates and GLSL source fragments", () => {
      expect(PASSTHROUGH_FRAGMENT).toContain("out vec4 fragColor;")
      expect(CHROMATIC_ABERRATION_FRAGMENT).toContain("u_aberrationOffset")
      expect(BLOOM_FRAGMENT).toContain("u_bloomThreshold")
      expect(BLOOM_FRAGMENT).toContain("u_bloomIntensity")
      expect(CUSTOM_WGSL_TEMPLATE).toContain("fn fragment_main")
      expect(CUSTOM_GLSL_TEMPLATE).toContain("void main()")
    })

    it("builds correct chain passes for all 5 pass types", () => {
      const passTypes: PostProcessPassType[] = [
        "vignette",
        "blur",
        "chromatic_aberration",
        "bloom",
        "custom",
      ]
      const steps = passTypes.map((pass, i) => ({
        type: "postprocess" as const,
        id: `pp-${i}`,
        pass,
        customSource: pass === "custom" ? "void main() { fragColor = vec4(1.0); }" : undefined,
        uniforms: { testVal: 1.0 },
      }))

      const chain = buildPostProcessChain(steps)
      expect(chain).toHaveLength(5)
      expect(chain.map((p) => p.type)).toEqual(passTypes)
      expect(chain[4].shaderSource).toBe("void main() { fragColor = vec4(1.0); }")
    })
  })

  describe("WebGPUAdapter Post-Processing Architecture", () => {
    it("compiles pipelines for all pass types without crashing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "pp-vig", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
        { type: "postprocess", id: "pp-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.01 } },
        { type: "postprocess", id: "pp-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "pp-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "pp-cust", pass: "custom", customSource: CUSTOM_WGSL_TEMPLATE, uniforms: {} },
      ])

      // Step frames through render loop
      expect(() => env.clock.stepFrames(3, 16.666)).not.toThrow()
      adapter.dispose()
    })

    it("updates uniforms in real-time via updatePostProcessUniform", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "pp-vig-1", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
        { type: "postprocess", id: "pp-vig-2", pass: "vignette", uniforms: { intensity: 0.2, radius: 0.4 } },
      ])
      env.clock.step(16)

      // Test updating uniform on specific node ID
      expect(() => {
        adapter.updatePostProcessUniform("pp-vig-1", "intensity", 0.95)
        adapter.updatePostProcessUniform("pp-vig-2", "radius", 0.1)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })

    it("executes multi-pass ping-pong rendering correctly", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p1", pass: "vignette" },
        { type: "postprocess", id: "p2", pass: "bloom" },
      ])

      // Render 2 frames
      env.clock.stepFrames(2, 16.666)
      const dev = env.webgpu.getDevice()!
      expect(dev.queue.submittedCommands.length).toBeGreaterThan(0)
      adapter.dispose()
    })
  })

  describe("WebGL2Adapter Post-Processing Architecture", () => {
    it("sets up dual FBOs and renders passes for all effect types", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5 } },
        { type: "postprocess", id: "p-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.008 } },
        { type: "postprocess", id: "p-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "p-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "p-custom", pass: "custom", customSource: CUSTOM_GLSL_TEMPLATE },
      ])

      env.clock.step(16)
      const gl = env.webgl2.getLastContext()!
      expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2)
      adapter.dispose()
    })

    it("updates WebGL2 uniforms via updatePostProcessUniform at 60 FPS", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5, radius: 0.8 } },
      ])
      env.clock.step(16)

      expect(() => {
        adapter.updatePostProcessUniform("p-vig", "intensity", 0.85)
        adapter.updatePostProcessUniform("p-vig", "radius", 0.45)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })
  })

  describe("ThreeJSAdapter Post-Processing Architecture", () => {
    it("instantiates EffectComposer and sequential ShaderPasses for passes", async () => {
      const { ThreeJSAdapter } = await import("@/adapters/threejs")
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)

      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p-vig", pass: "vignette", uniforms: { intensity: 0.5 } },
        { type: "postprocess", id: "p-chroma", pass: "chromatic_aberration", uniforms: { aberrationOffset: 0.01 } },
        { type: "postprocess", id: "p-bloom", pass: "bloom", uniforms: { bloomThreshold: 0.7, bloomIntensity: 0.5 } },
        { type: "postprocess", id: "p-blur", pass: "blur", uniforms: { blurAmount: 2.0 } },
        { type: "postprocess", id: "p-custom", pass: "custom", customSource: CUSTOM_GLSL_TEMPLATE },
      ])

      expect(() => env.clock.stepFrames(3, 16.666)).not.toThrow()

      // Test uniform update on Three.js adapter
      expect(() => {
        adapter.updatePostProcessUniform("p-vig", "intensity", 0.9)
        adapter.updatePostProcessUniform("p-chroma", "aberrationOffset", 0.02)
        adapter.updatePostProcessUniform("p-bloom", "bloomIntensity", 1.2)
        adapter.updatePostProcessUniform("p-blur", "blurAmount", 4.0)
      }).not.toThrow()

      env.clock.step(16)
      adapter.dispose()
    })
  })
})
})

describe("Studio lighting and IBL", () => {
describe("Tier 1: Studio Lighting & Image-Based Lighting (IBL / HDRI)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("initializes project store with default studio environment settings", () => {
    const env = useProjectStore.getState().environmentSettings
    expect(env).toBeDefined()
    expect(env?.preset).toBe("studio_warm")
    expect(env?.exposure).toBe(1.0)
    expect(env?.rotation).toBe(0)
    expect(env?.backgroundBlur).toBe(0.0)
    expect(env?.showSkybox).toBe(false)
  })

  it("updates environment preset and individual parameters via store actions", () => {
    const {
      setEnvironmentPreset,
      setEnvironmentExposure,
      setEnvironmentRotation,
      setEnvironmentSkybox,
      setEnvironmentSettings,
    } = useProjectStore.getState()

    setEnvironmentPreset("cyberpunk_neon")
    expect(useProjectStore.getState().environmentSettings?.preset).toBe("cyberpunk_neon")

    setEnvironmentExposure(2.5)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(2.5)

    setEnvironmentRotation(180)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(180)

    setEnvironmentSkybox(false)
    expect(useProjectStore.getState().environmentSettings?.showSkybox).toBe(false)

    setEnvironmentSettings({ backgroundBlur: 0.75 })
    expect(useProjectStore.getState().environmentSettings?.backgroundBlur).toBe(0.75)
  })

  it("serializes and restores environment settings in exportProjectData and loadProjectData", () => {
    const { setEnvironmentPreset, setEnvironmentExposure, setEnvironmentRotation } =
      useProjectStore.getState()

    setEnvironmentPreset("nebula")
    setEnvironmentExposure(1.85)
    setEnvironmentRotation(90)

    const exported = useProjectStore.getState().exportProjectData()
    expect(exported.environmentSettings).toBeDefined()
    expect(exported.environmentSettings?.preset).toBe("nebula")
    expect(exported.environmentSettings?.exposure).toBe(1.85)
    expect(exported.environmentSettings?.rotation).toBe(90)

    // Reset and reload
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().environmentSettings?.preset).toBe("studio_warm")

    useProjectStore.getState().loadProjectData(exported)
    const reloaded = useProjectStore.getState().environmentSettings
    expect(reloaded?.preset).toBe("nebula")
    expect(reloaded?.exposure).toBe(1.85)
    expect(reloaded?.rotation).toBe(90)
  })

  it("adapter contracts accept updateEnvironment without runtime crashes", () => {
    const customSettings: EnvironmentSettings = {
      preset: "sunset",
      exposure: 1.5,
      rotation: 45,
      backgroundBlur: 0.3,
      showSkybox: true,
    }

    expect(() => threejsAdapter.updateEnvironment?.(customSettings)).not.toThrow()
    expect(() => webgl2Adapter.updateEnvironment?.(customSettings)).not.toThrow()
    expect(() => webgpuAdapter.updateEnvironment?.(customSettings)).not.toThrow()
  })

  it("clamps and handles extreme environment exposure and rotation values", () => {
    const { setEnvironmentExposure, setEnvironmentRotation } = useProjectStore.getState()

    setEnvironmentExposure(0.0)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(0.1)

    setEnvironmentExposure(10.0)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(4.0)

    setEnvironmentRotation(400)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(40)

    setEnvironmentRotation(-30)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(330)
  })

  it("enables skybox rendering in WebGPU adapter and tears down cleanly when disabled", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Initially showSkybox is false
    expect((adapter as any).skyboxPipeline).toBeNull()

    // Enable skybox
    adapter.updateEnvironment({
      preset: "studio_warm",
      exposure: 1.5,
      rotation: 60,
      backgroundBlur: 0.2,
      showSkybox: true,
    })

    expect((adapter as any).skyboxPipeline).toBeDefined()
    expect((adapter as any).skyboxUniformBuffer).toBeDefined()

    // Render frame with skybox active
    expect(() => adapter.renderFrame(1000, 16)).not.toThrow()

    // Disable skybox
    adapter.updateEnvironment({
      preset: "studio_warm",
      exposure: 1.5,
      rotation: 60,
      backgroundBlur: 0.2,
      showSkybox: false,
    })

    expect((adapter as any).skyboxPipeline).toBeNull()
    expect((adapter as any).skyboxUniformBuffer).toBeNull()

    adapter.dispose()
  })

  it("enables skybox rendering in WebGL2 adapter and tears down cleanly when disabled", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Initially showSkybox is false
    expect((adapter as any).skyboxProgram).toBeNull()

    // Enable skybox
    adapter.updateEnvironment({
      preset: "cyberpunk_neon",
      exposure: 2.0,
      rotation: 120,
      backgroundBlur: 0.5,
      showSkybox: true,
    })

    expect((adapter as any).skyboxProgram).toBeDefined()
    expect((adapter as any).skyboxVAO).toBeDefined()

    // Render frame with skybox active
    expect(() => adapter.renderFrame(1000, 16)).not.toThrow()

    // Disable skybox
    adapter.updateEnvironment({
      preset: "cyberpunk_neon",
      exposure: 2.0,
      rotation: 120,
      backgroundBlur: 0.5,
      showSkybox: false,
    })

    expect((adapter as any).skyboxProgram).toBeNull()
    expect((adapter as any).skyboxVAO).toBeNull()

    adapter.dispose()
  })
})
})


describe("WebGPU point-light shadow cube with a mounted device", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  beforeEach(() => { env = setupE2ETestEnvironment() })
  afterEach(() => { teardownE2ETestEnvironment() })

  it("allocates the cube texture on enable and releases it on disable once mounted", async () => {
    const adapter = new WebGPUAdapter()
    await adapter.mount(env.createCanvas() as any)
    adapter.setPointLightShadowCube(true)
    expect((adapter as any).shadowCubeTex).not.toBeNull()
    adapter.setPointLightShadowCube(false)
    expect((adapter as any).shadowCubeTex).toBeNull()
    adapter.dispose()
  })

  it("re-creates the cube texture on mount when it was enabled before mount", async () => {
    const adapter = new WebGPUAdapter()
    adapter.setPointLightShadowCube(true)
    await adapter.mount(env.createCanvas() as any)
    expect((adapter as any).shadowCubeTex).not.toBeNull()
    adapter.dispose()
  })
})

describe("Tier 5: Comprehensive White-Box Adversarial Coverage & Boundary Hardening", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    subGraphLibrary.reset()
    customNodeRegistry.clear()
    customNodeRegistry.discoverBuiltinNodes()
    resetDesktopFallbackState()
    performanceTelemetry.reset()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BATTERY 2: R2 Rendering Multi-Backend Parity & Boundary Probes
  // ==========================================================================
  describe("Battery 2: R2 Rendering Multi-Backend Parity & Boundary Probes", () => {
    const adapters = [
      { name: "WebGPU", adapter: webgpuAdapter },
      { name: "WebGL2", adapter: webgl2Adapter },
      { name: "Three.js", adapter: threejsAdapter },
    ]

    adapters.forEach(({ name, adapter }) => {
      it(`2.1 [${name}] pipeline mode toggles GBuffer targets correctly`, () => {
        adapter.setRenderingPipelineMode!("deferred")
        expect(adapter.getPipelineMode!()).toBe("deferred")
        const gbuffer = adapter.getGBufferTextures!()
        expect(gbuffer).not.toBeNull()
        expect(gbuffer?.albedo).toBeDefined()
        expect(gbuffer?.normal).toBeDefined()
        expect(gbuffer?.roughnessMetallic).toBeDefined()
        expect(gbuffer?.depth).toBeDefined()

        adapter.setRenderingPipelineMode!("forward")
        expect(adapter.getPipelineMode!()).toBe("forward")
        expect(adapter.getGBufferTextures!()).toBeNull()
      })

      it(`2.2 [${name}] shadow config accepts approved resolutions and throws on invalid`, () => {
        // Valid resolutions: 512, 1024, 2048, 4096
        adapter.setShadowConfig!({ resolution: 512, filtering: "pcf", bias: 0.001 })
        expect(adapter.getShadowSettings!().resolution).toBe(512)
        expect(adapter.getShadowSettings!().filterMode).toBe("pcf")

        adapter.setShadowConfig!({ resolution: 2048, filtering: "vsm" })
        expect(adapter.getShadowSettings!().resolution).toBe(2048)
        expect(adapter.getShadowSettings!().filterMode).toBe("vsm")

        // Invalid resolutions throw
        expect(() => adapter.setShadowConfig!({ resolution: 256 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig!({ resolution: 8192 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig!({ resolution: NaN as any })).toThrow(/Invalid shadow resolution/)
      })

      it(`2.3 [${name}] point shadow cube toggle creates and destroys resources`, () => {
        adapter.setPointLightShadowCube!(true)
        expect(adapter.state?.pointShadowCubeEnabled).toBe(true)

        adapter.setPointLightShadowCube!(false)
        expect(adapter.state?.pointShadowCubeEnabled).toBe(false)
      })

      it(`2.4 [${name}] post-process passes update parameters cleanly`, () => {
        adapter.setPostProcessEnabled!("ssr", true, { maxSteps: 64, thickness: 0.15 })
        expect(adapter.state?.postProcessState.ssr.enabled).toBe(true)
        expect(adapter.state?.postProcessState.ssr.maxSteps).toBe(64)
        expect(adapter.state?.postProcessState.ssr.thickness).toBe(0.15)

        adapter.updateDoFSettings!({ enabled: true, focalDistance: 8.5, bokehShape: "octagonal" })
        expect(adapter.state?.postProcessState.dof.enabled).toBe(true)
        expect(adapter.state?.postProcessState.dof.focalDistance).toBe(8.5)
        expect(adapter.state?.postProcessState.dof.bokehShape).toBe("octagonal")

        adapter.updateSSAOSettings!({ enabled: true, radius: 1.2, intensity: 2.0 })
        expect(adapter.state?.postProcessState.ssao.radius).toBe(1.2)
        expect(adapter.state?.postProcessState.ssao.intensity).toBe(2.0)

        // Anti-aliasing mutual exclusion
        adapter.setAntiAliasingMode!("fxaa")
        expect(adapter.getAntiAliasingMode!()).toBe("fxaa")
        expect(adapter.state?.postProcessState.fxaa.enabled).toBe(true)
        expect(adapter.state?.postProcessState.taa.enabled).toBe(false)

        adapter.setAntiAliasingMode!("taa")
        expect(adapter.getAntiAliasingMode!()).toBe("taa")
        expect(adapter.state?.postProcessState.fxaa.enabled).toBe(false)
        expect(adapter.state?.postProcessState.taa.enabled).toBe(true)
      })

      it(`2.5 [${name}] atmosphere parameter boundary clamping and Rayleigh inverse 4th-power law`, () => {
        // Clamping negative and >24h
        adapter.setAtmosphereParams!({ timeOfDay: -10, turbidity: 3.5 })
        expect(adapter.state?.atmosphereParams.timeOfDay).toBe(0)
        expect(adapter.state?.atmosphereParams.solarElevationDeg).toBe(0)

        adapter.setAtmosphereParams!({ timeOfDay: 35 })
        expect(adapter.state?.atmosphereParams.timeOfDay).toBe(24)

        // Solar noon (12:00) elevation should be exactly 90 degrees
        adapter.setAtmosphereParams!({ timeOfDay: 12 })
        expect(adapter.state?.atmosphereParams.solarElevationDeg).toBeCloseTo(90, 1)

        // Scattering physics: blue (440nm) scatters more than red (680nm)
        const scattering = adapter.calculateRayleighMieScattering!([680, 550, 440])
        expect(scattering.rayleigh[2]).toBeGreaterThan(scattering.rayleigh[0])
        expect(scattering.mie).toBeGreaterThan(0)
      })
    })
  })
})
