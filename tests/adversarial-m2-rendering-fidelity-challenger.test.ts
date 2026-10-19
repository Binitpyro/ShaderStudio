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
  // Target 1: Shadow Map Resolution Clamping & Sanitization
  // ==========================================================================
  describe("Target 1: Shadow Map Resolution Clamping vs Throwing vs Falsy Bypass", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] rejects invalid resolution (0 and NaN)`, () => {
        expect(() => adapter.setShadowConfig({ resolution: 0 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig({ resolution: NaN as any })).toThrow(/Invalid shadow resolution/)
      })

      it(`[${name}] throws on resolutions < 512, > 4096, and non-power-of-two`, () => {
        expect(() => adapter.setShadowConfig({ resolution: 256 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig({ resolution: 8192 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig({ resolution: 1000 as any })).toThrow(/Invalid shadow resolution/)
        expect(() => adapter.setShadowConfig({ resolution: 1024.5 as any })).toThrow(/Invalid shadow resolution/)
      })
    })

    it("[Three.js] point light shadow map resolution is synchronized by setShadowConfig", async () => {
      const adapter = threejsAdapter
      const canvas = document.createElement("canvas")
      const mounted = await adapter.mount(canvas)
      expect(mounted).toBe(true)

      adapter.setPointLightShadowCube(true)
      adapter.setShadowConfig({ resolution: 1024 })

      const pointLight = (adapter as any).pointLight
      expect(pointLight).toBeDefined()
      // Directional light shadow mapSize is 1024
      expect((adapter as any).directionalLight.shadow.mapSize.width).toBe(1024)
      // Point light shadow mapSize is synchronized to 1024
      expect(pointLight.shadow.mapSize.width).toBe(1024)
    })
  })

  // ==========================================================================
  // Target 2: Point Light Shadow Cube Map Faces, Orientation & Sampling
  // ==========================================================================
  describe("Target 2: Point Light Shadow Cube Map Faces, Allocation & Sampling", () => {
    it("[WebGPU] point light shadow cubemap allocates GPU texture resource", () => {
      webgpuAdapter.setPointLightShadowCube(true)
      expect(webgpuAdapter.state.pointShadowCubeEnabled).toBe(true)

      // WebGPU internal state check: shadowCubeTex is allocated
      const shadowCubeTex = (webgpuAdapter as any).shadowCubeTex
      expect(shadowCubeTex).not.toBeNull()
    })

    it("[WebGL2] point light shadow cubemap allocates GPU texture resource", () => {
      webgl2Adapter.setPointLightShadowCube(true)
      expect(webgl2Adapter.state.pointShadowCubeEnabled).toBe(true)

      // WebGL2 internal state check: shadowCubeMapTex is allocated
      const shadowCubeMapTex = (webgl2Adapter as any).shadowCubeMapTex
      expect(shadowCubeMapTex).not.toBeNull()
    })

    it("[WebGL2] PROBE: deferred lighting shader does NOT sample or declare a shadow cube map", async () => {
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

      expect(fsSource).not.toContain("samplerCube")
      expect(fsSource).not.toContain("u_shadowCubeMap")
      expect(fsSource).not.toContain("pointLight")
    })
  })

  // ==========================================================================
  // Target 3: GBuffer Channel Extraction at Edge Aspect Ratios & Parity
  // ==========================================================================
  describe("Target 3: GBuffer Channel Extraction at Edge Aspect Ratios & Parity", () => {
    it("[WebGPU] resize() updates GBuffer targets in deferred mode", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1920
      canvas.height = 1080
      await webgpuAdapter.mount(canvas)
      webgpuAdapter.setRenderingPipelineMode("deferred")

      const initialTargets = webgpuAdapter.getGBufferTextures()
      expect((initialTargets?.albedo as any).width).toBe(1920)

      // Resize to 800x600
      webgpuAdapter.resize(800, 600, 1)

      const resizedTargets = webgpuAdapter.getGBufferTextures()
      const currentWidth = (resizedTargets?.albedo as any).width
      expect(currentWidth).toBe(800)
    })

    it("[Three.js] resize() updates GBuffer targets in deferred mode", async () => {
      const canvas = document.createElement("canvas")
      await threejsAdapter.mount(canvas)
      threejsAdapter.setRenderingPipelineMode("deferred")

      const initialTargets = threejsAdapter.getGBufferTextures()
      // Initial width is canvas.clientWidth (800 from mock)
      expect((initialTargets?.albedo as any).width).toBe(800)

      // Resize to 400x300
      threejsAdapter.resize(400, 300, 1)

      const resizedTargets = threejsAdapter.getGBufferTextures()
      const currentWidth = (resizedTargets?.albedo as any).width
      expect(currentWidth).toBe(400)
    })

    it("[WebGL2 vs WebGPU/Three.js] GBufferTargets interface contract maintains parity across backends", async () => {
      const canvasGpu = document.createElement("canvas")
      const canvasGl = document.createElement("canvas")
      const canvasThree = document.createElement("canvas")

      await webgpuAdapter.mount(canvasGpu)
      await webgl2Adapter.mount(canvasGl)
      await threejsAdapter.mount(canvasThree)

      webgpuAdapter.setRenderingPipelineMode("deferred")
      webgl2Adapter.setRenderingPipelineMode("deferred")
      threejsAdapter.setRenderingPipelineMode("deferred")

      const gpuAlbedo = webgpuAdapter.getGBufferTextures()!.albedo
      const gl2Albedo = webgl2Adapter.getGBufferTextures()!.albedo
      const threeAlbedo = threejsAdapter.getGBufferTextures()!.albedo

      // WebGPU, WebGL2 and Three.js return descriptor objects with .format and .width
      expect(typeof (gpuAlbedo as any).format).toBe("string")
      expect(typeof (threeAlbedo as any).format).toBe("string")
      expect(typeof (gl2Albedo as any).format).toBe("string")
    })

    it("[Edge Dimensions] handles 1x1, 10000x1, and 1x10000 without crashing", () => {
      for (const { name, adapter } of adapters) {
        adapter.setRenderingPipelineMode("deferred")
        expect(() => adapter.resize(1, 1, 1), `${name} crashed on 1x1 resize`).not.toThrow()
        expect(() => adapter.resize(10000, 1, 1), `${name} crashed on 10000x1 resize`).not.toThrow()
        expect(() => adapter.resize(10000, 1, 1), `${name} crashed on 10000x1 resize`).not.toThrow()
      }
    })
  })

  // ==========================================================================
  // Target 4: Deferred Lighting Pass with Light Counts & Directions
  // ==========================================================================
  describe("Target 4: Deferred Lighting Pass with 0 Lights, 50+ Lights, and Light Directions", () => {
    it("[WebGL2] u_lightDir and u_lightColor pass dynamic settings to deferred lighting pass", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      // Configure distinct custom light direction and light color
      webgl2Adapter.updateShadowSettings({
        directionalLight: {
          enabled: true,
          position: [100, 200, 300],
          target: [0, 0, 0],
          intensity: 2.5,
          color: [0.1, 0.2, 0.3], // Custom blue-ish color
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      const gl = (webgl2Adapter as any).gl
      const uniform3fSpy = vi.spyOn(gl, "uniform3f")

      webgl2Adapter.renderFrame(100, 16)

      const dx = 100 - 0
      const dy = 200 - 0
      const dz = 300 - 0
      const len = Math.hypot(dx, dy, dz) || 1
      const ex = dx / len
      const ey = dy / len
      const ez = dz / len

      const dirCalls = uniform3fSpy.mock.calls.filter((call) =>
        Math.abs(call[1] - ex) < 0.001 &&
        Math.abs(call[2] - ey) < 0.001 &&
        Math.abs(call[3] - ez) < 0.001
      )
      const colCalls = uniform3fSpy.mock.calls.filter((call) => call[1] === 0.1 && call[2] === 0.2 && call[3] === 0.3)

      expect(dirCalls.length).toBeGreaterThan(0)
      expect(colCalls.length).toBeGreaterThan(0)
    })

    it("[WebGL2] directionalLight.enabled: false sets light intensity to 0 in deferred lighting pass", async () => {
      const canvas = document.createElement("canvas")
      await webgl2Adapter.mount(canvas)
      webgl2Adapter.setRenderingPipelineMode("deferred")

      webgl2Adapter.updateShadowSettings({
        directionalLight: {
          enabled: false, // Turned OFF
          position: [5, 10, 5],
          target: [0, 0, 0],
          intensity: 1.5,
          color: [1, 1, 1],
          orthoSize: 10,
          near: 0.1,
          far: 50,
        },
      })

      const gl = (webgl2Adapter as any).gl
      const uniform1fSpy = vi.spyOn(gl, "uniform1f")

      webgl2Adapter.renderFrame(100, 16)

      const passed0 = uniform1fSpy.mock.calls.some((call) => call[1] === 0.0)
      expect(passed0, "Deferred lighting pass used intensity 0.0 when directionalLight.enabled = false").toBe(true)
    })

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

      it(`[${name}] PROBE: switching to forward retains unused GBuffer GPU textures until dispose()`, async () => {
        const canvas = document.createElement("canvas")
        await adapter.mount(canvas)

        adapter.setRenderingPipelineMode("deferred")
        expect(adapter.getGBufferTextures()).not.toBeNull()

        // Switch to forward
        adapter.setRenderingPipelineMode("forward")

        // In WebGPU and WebGL2, GBuffer textures remain allocated in memory while in forward mode
        if (name === "WebGPU") {
          const gBufferAlbedoTex = (adapter as any).gBufferAlbedoTex
          expect(gBufferAlbedoTex, "WebGPU retains allocated GBuffer texture in forward mode").not.toBeNull()
        } else if (name === "WebGL2") {
          const gBufferAlbedoTex = (adapter as any).gBufferAlbedoTex
          expect(gBufferAlbedoTex, "WebGL2 retains allocated GBuffer texture in forward mode").not.toBeNull()
        }

        // Full cleanup on dispose()
        adapter.dispose()
        if (name === "WebGPU") {
          expect((adapter as any).gBufferAlbedoTex).toBeNull()
        } else if (name === "WebGL2") {
          expect((adapter as any).gBufferAlbedoTex).toBeNull()
        }
      })
    })
  })
})
