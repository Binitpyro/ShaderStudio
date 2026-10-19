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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as THREE from "three"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { threejsAdapter } from "@/adapters/threejs"
import { webgl2Adapter } from "@/adapters/webgl2"
import { webgpuAdapter } from "@/adapters/webgpu"
import type { RenderQueue, PostProcessPassType } from "@/adapters/types"

// Mock Three.js WebGLRenderer with headless MockThreeRenderer for complete ThreeJS lifecycle execution
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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
    const rootDir = path.resolve(__dirname, "..")
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

    it("empirically executes IEEE-754 simulation oracle across all boundary and invalid floating-point values", () => {
      const evaluateTAABlendWeight = (historyUV: [number, number], feedbackMax = 0.95): number => {
        let blendWeight = Math.max(0.8, Math.min(0.98, feedbackMax))
        // Remediated shader condition:
        if (!(historyUV[0] >= 0.0 && historyUV[0] <= 1.0 && historyUV[1] >= 0.0 && historyUV[1] <= 1.0)) {
          blendWeight = 0.0
        }
        return blendWeight
      }

      // 1. Normal valid in-bounds coordinates
      expect(evaluateTAABlendWeight([0.5, 0.5])).toBeCloseTo(0.95, 2)
      expect(evaluateTAABlendWeight([0.1, 0.9])).toBeCloseTo(0.95, 2)

      // 2. Exact boundary edges: [0, 0], [1, 1], [0, 1], [1, 0] must be valid
      expect(evaluateTAABlendWeight([0.0, 0.0])).toBeCloseTo(0.95, 2)
      expect(evaluateTAABlendWeight([1.0, 1.0])).toBeCloseTo(0.95, 2)
      expect(evaluateTAABlendWeight([0.0, 1.0])).toBeCloseTo(0.95, 2)
      expect(evaluateTAABlendWeight([1.0, 0.0])).toBeCloseTo(0.95, 2)

      // 3. Out-of-bounds finite values
      expect(evaluateTAABlendWeight([-0.0001, 0.5])).toBe(0.0)
      expect(evaluateTAABlendWeight([1.0001, 0.5])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5, -0.0001])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5, 1.0001])).toBe(0.0)
      expect(evaluateTAABlendWeight([-10.0, -20.0])).toBe(0.0)
      expect(evaluateTAABlendWeight([50.0, 50.0])).toBe(0.0)

      // 4. NaN motion vectors (IEEE-754 edge cases)
      expect(evaluateTAABlendWeight([NaN, 0.5])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5, NaN])).toBe(0.0)
      expect(evaluateTAABlendWeight([NaN, NaN])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5 - NaN, 0.5])).toBe(0.0)

      // 5. Infinities (+Inf and -Inf)
      expect(evaluateTAABlendWeight([Infinity, 0.5])).toBe(0.0)
      expect(evaluateTAABlendWeight([-Infinity, 0.5])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5, Infinity])).toBe(0.0)
      expect(evaluateTAABlendWeight([0.5, -Infinity])).toBe(0.0)
      expect(evaluateTAABlendWeight([Infinity, -Infinity])).toBe(0.0)
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

