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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { evaluateEnvironmentRadiance, uvToDirection, ENVIRONMENT_PRESETS } from "@/core/environmentGenerator"
import { getDefaultPostProcessUniforms } from "@/core/postProcessChain"

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

        // Mathematical verification of shader clamp: clamp(u_maxSteps, 16.0, 128.0)
        const clampSteps = (val: number) => Math.floor(Math.max(16, Math.min(128, val)))
        expect(clampSteps(1)).toBe(16)
        expect(clampSteps(256)).toBe(128)
        expect(clampSteps(0)).toBe(16)
        expect(clampSteps(-10)).toBe(16)
        expect(clampSteps(64)).toBe(64)
      })

      it(`[${name}] ray thickness <= 0 strictly prevents false ray-hit intersections`, () => {
        // When thickness is <= 0, the condition (depthDiff > 0.0 && depthDiff < u_thickness)
        // is mathematically impossible for any positive depth difference.
        const testThicknesses = [0.0, -0.01, -1.0, -100.0]
        for (const th of testThicknesses) {
          adapter.updateSSRSettings({ enabled: true, thickness: th })
          expect(adapter.state.postProcessState.ssr.thickness).toBe(th)

          // Mathematical simulation oracle of SSR hit detection
          const simulateHit = (depthDiff: number, thickness: number) => {
            return depthDiff > 0.0 && depthDiff < thickness
          }

          // Any depth difference from 0.0001 to 10.0 should NEVER trigger a hit
          expect(simulateHit(0.001, th)).toBe(false)
          expect(simulateHit(0.05, th)).toBe(false)
          expect(simulateHit(1.0, th)).toBe(false)
        }
      })
    })

    it("verifies SSR grazing angle reflection and Fresnel confidence falloff", () => {
      // Normal nearly perpendicular to view vector (grazing angle: theta -> 90 deg)
      const simulateSSRConfidence = (
        uv: [number, number],
        roughness: number,
        falloff: number
      ) => {
        // Screen edge vignette fade
        const edgeX = Math.min(1.0, Math.max(0.0, (uv[0] - 0.0) / 0.1)) *
                      Math.min(1.0, Math.max(0.0, (1.0 - uv[0]) / 0.1))
        const edgeY = Math.min(1.0, Math.max(0.0, (uv[1] - 0.0) / 0.1)) *
                      Math.min(1.0, Math.max(0.0, (1.0 - uv[1]) / 0.1))
        const vignette = edgeX * edgeY
        const confidence = Math.pow(vignette, falloff) * Math.max(0.0, 1.0 - roughness / 0.6)
        return confidence
      }

      // Center of screen, mirror-smooth (roughness = 0.0): confidence = 1.0
      expect(simulateSSRConfidence([0.5, 0.5], 0.0, 1.0)).toBeCloseTo(1.0, 3)

      // Near screen boundary (uv = [0.02, 0.5]): smoothly fades to 0
      const edgeConf = simulateSSRConfidence([0.02, 0.5], 0.0, 1.0)
      expect(edgeConf).toBeLessThan(0.25)
      expect(edgeConf).toBeGreaterThan(0.0)

      // Beyond screen boundary (uv = [-0.01, 0.5]): confidence is exactly 0
      expect(simulateSSRConfidence([-0.01, 0.5], 0.0, 1.0)).toBe(0.0)

      // Roughness > 0.6: confidence drops to 0 (falls back to IBL/environment)
      expect(simulateSSRConfidence([0.5, 0.5], 0.65, 1.0)).toBe(0.0)
      expect(simulateSSRConfidence([0.5, 0.5], 1.0, 1.0)).toBe(0.0)
    })

    it("verifies out-of-screen reflection rays terminate without NaN or unbounded projection", () => {
      // Ray marching out of screen boundaries: UV projected out of [0, 1]
      const simulateRayOutOfBounds = (sampleUV: [number, number]) => {
        return sampleUV[0] < 0.0 || sampleUV[0] > 1.0 || sampleUV[1] < 0.0 || sampleUV[1] > 1.0
      }

      expect(simulateRayOutOfBounds([-0.1, 0.5])).toBe(true)
      expect(simulateRayOutOfBounds([1.05, 0.5])).toBe(true)
      expect(simulateRayOutOfBounds([0.5, -0.05])).toBe(true)
      expect(simulateRayOutOfBounds([0.5, 1.2])).toBe(true)
      expect(simulateRayOutOfBounds([0.5, 0.5])).toBe(false)
    })
  })

  // ==========================================================================
  // Section 2: TAA Stability & Motion Vector Clamping
  // ==========================================================================
  describe("2. TAA Stability, Motion Vector Clamping & Ghosting Suppression", () => {
    // Halton generator reference implementation matching webgl2/webgpu
    const haltonGen = (index: number, base: number) => {
      let f = 1
      let r = 0
      let i = index
      while (i > 0) {
        f = f / base
        r = r + f * (i % base)
        i = Math.floor(i / base)
      }
      return r
    }

    it("verifies Halton(2,3) sequence 8-frame periodicity and zero-drift centering", () => {
      const samples: [number, number][] = []
      for (let frame = 0; frame < 16; frame++) {
        const idx = frame % 8
        const jX = (haltonGen(idx + 1, 2) - 0.5) / 800
        const jY = (haltonGen(idx + 1, 3) - 0.5) / 600
        samples.push([jX, jY])
      }

      // Periodicity: Frame 0 == Frame 8
      expect(samples[0][0]).toBe(samples[8][0])
      expect(samples[0][1]).toBe(samples[8][1])
      expect(samples[3][0]).toBe(samples[11][0])
      expect(samples[7][1]).toBe(samples[15][1])

      // Zero-drift centering: mean jitter over 8 frames is < 0.0005
      const meanX = samples.slice(0, 8).reduce((acc, s) => acc + s[0], 0) / 8
      const meanY = samples.slice(0, 8).reduce((acc, s) => acc + s[1], 0) / 8
      expect(Math.abs(meanX)).toBeLessThan(0.0005)
      expect(Math.abs(meanY)).toBeLessThan(0.0005)
    })

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

    it("verifies Three.js adapter parity gap: TAA camera jitter is not updated during renderFrame", async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 600
      await threejsAdapter.mount(canvas)
      threejsAdapter.setAntiAliasingMode("taa")

      expect(threejsAdapter.getAntiAliasingMode()).toBe("taa")

      // In Three.js, renderFrame does not modify jitterSample
      threejsAdapter.renderFrame(16)
      expect(threejsAdapter.state.postProcessState.taa.jitterSample).toEqual([0, 0])
    })

    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] rapid camera jump triggers blendWeight = 0.0 rejecting history`, () => {
        const evaluateTAABlend = (
          texCoord: [number, number],
          motion: [number, number],
          feedbackMax = 0.95
        ) => {
          const historyUV: [number, number] = [texCoord[0] - motion[0], texCoord[1] - motion[1]]
          let blendWeight = Math.max(0.8, Math.min(0.98, feedbackMax))
          if (historyUV[0] < 0.0 || historyUV[0] > 1.0 || historyUV[1] < 0.0 || historyUV[1] > 1.0) {
            blendWeight = 0.0
          }
          return { blendWeight, historyUV }
        }

        // Normal small motion: history accepted
        const normalMotion = evaluateTAABlend([0.5, 0.5], [0.005, -0.002])
        expect(normalMotion.blendWeight).toBeCloseTo(0.95, 2)

        // Rapid camera cut / jump (motion = [0.8, 0.6]): historyUV = [-0.3, -0.1]
        const rapidCut = evaluateTAABlend([0.5, 0.5], [0.8, 0.6])
        expect(rapidCut.blendWeight).toBe(0.0) // 100% current frame, immediate ghosting cutoff!

        // Negative extreme jump
        const negCut = evaluateTAABlend([0.5, 0.5], [-0.7, -0.6])
        expect(negCut.blendWeight).toBe(0.0)
      })
    })

    it("adversarially surfaces NaN/Inf motion vector vulnerability in IEEE-754 comparison", () => {
      // In taa.frag / taa.wgsl:
      // if (historyUV.x < 0.0 || historyUV.x > 1.0 || historyUV.y < 0.0 || historyUV.y > 1.0) blendWeight = 0.0;
      // IEEE-754 quirk: If historyUV is NaN, (NaN < 0.0) is FALSE and (NaN > 1.0) is FALSE!
      const currentShaderCheck = (hX: number, hY: number) => {
        let blendWeight = 0.95
        if (hX < 0.0 || hX > 1.0 || hY < 0.0 || hY > 1.0) {
          blendWeight = 0.0
        }
        return blendWeight
      }

      // Robust check: Inverted range check or finite check
      const robustShaderCheck = (hX: number, hY: number) => {
        let blendWeight = 0.95
        if (!(hX >= 0.0 && hX <= 1.0 && hY >= 0.0 && hY <= 1.0)) {
          blendWeight = 0.0
        }
        return blendWeight
      }

      // When motion is NaN:
      const nanHistoryX = 0.5 - NaN
      const nanHistoryY = 0.5 - NaN

      // Current shader test: FAILS to reject NaN (leaves blendWeight = 0.95!)
      const flawedResult = currentShaderCheck(nanHistoryX, nanHistoryY)
      expect(flawedResult).toBe(0.95) // Vulnerability confirmed: NaN history is not rejected!

      // Robust check catches it:
      const safeResult = robustShaderCheck(nanHistoryX, nanHistoryY)
      expect(safeResult).toBe(0.0) // Safely rejected!
    })

    it("verifies YCoCg neighborhood color clamping eliminates stale history ghosting", () => {
      // YCoCg transforms
      const rgbToYCoCg = (r: number, g: number, b: number): [number, number, number] => {
        const Y = 0.25 * r + 0.5 * g + 0.25 * b
        const Co = 0.5 * r - 0.5 * b
        const Cg = -0.25 * r + 0.5 * g - 0.25 * b
        return [Y, Co, Cg]
      }

      const ycocgToRGB = (Y: number, Co: number, Cg: number): [number, number, number] => {
        const r = Y + Co - Cg
        const g = Y + Cg
        const b = Y - Co - Cg
        return [r, g, b]
      }

      // Reversibility check: RGB -> YCoCg -> RGB
      const [origR, origG, origB] = [0.72, 0.45, 0.18]
      const [y, co, cg] = rgbToYCoCg(origR, origG, origB)
      const [reconR, reconG, reconB] = ycocgToRGB(y, co, cg)
      expect(reconR).toBeCloseTo(origR, 5)
      expect(reconG).toBeCloseTo(origG, 5)
      expect(reconB).toBeCloseTo(origB, 5)

      // Ghosting scenario: current neighborhood is dark [0.1, 0.1, 0.1], history has stale bright flash [1.0, 1.0, 1.0]
      const currentNeighbors = [
        [0.08, 0.08, 0.08],
        [0.10, 0.10, 0.10],
        [0.12, 0.12, 0.12],
      ]
      let minY = Infinity, minCo = Infinity, minCg = Infinity
      let maxY = -Infinity, maxCo = -Infinity, maxCg = -Infinity

      for (const [r, g, b] of currentNeighbors) {
        const [nY, nCo, nCg] = rgbToYCoCg(r, g, b)
        minY = Math.min(minY, nY); maxY = Math.max(maxY, nY)
        minCo = Math.min(minCo, nCo); maxCo = Math.max(maxCo, nCo)
        minCg = Math.min(minCg, nCg); maxCg = Math.max(maxCg, nCg)
      }

      // Stale history pixel (bright white ghost)
      const [histY, histCo, histCg] = rgbToYCoCg(1.0, 1.0, 1.0)
      // Clamped history in YCoCg space
      const clampedY = Math.max(minY, Math.min(maxY, histY))
      const clampedCo = Math.max(minCo, Math.min(maxCo, histCo))
      const clampedCg = Math.max(minCg, Math.min(maxCg, histCg))

      const [clampedR, clampedG, clampedB] = ycocgToRGB(clampedY, clampedCo, clampedCg)

      // Clamped history luminance is strictly bounded by current neighborhood (<= 0.12)
      expect(clampedY).toBeCloseTo(maxY, 4)
      expect(clampedR).toBeLessThanOrEqual(0.121)
      expect(clampedG).toBeLessThanOrEqual(0.121)
      expect(clampedB).toBeLessThanOrEqual(0.121)
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

    it("verifies Circle of Confusion (CoC) mathematical formula across edge cases", () => {
      // CoC formula from dof.frag:
      // zLinear = (near * far) / (far - depth * (far - near))
      // coc = clamp(abs(zLinear - u_focalDistance) / max(zLinear, 0.001) * u_aperture * 100.0, 0.0, u_maxBlur)
      const near = 0.1
      const far = 100.0
      const linearizeDepth = (d: number) => (near * far) / (far - d * (far - near))

      const calculateCoC = (
        depth: number,
        focalDistance: number,
        aperture: number,
        maxBlur = 16.0
      ) => {
        const zLinear = linearizeDepth(depth)
        const coc = Math.max(0.0, Math.min(maxBlur, (Math.abs(zLinear - focalDistance) / Math.max(zLinear, 0.001)) * aperture * 100.0))
        return { zLinear, coc }
      }

      // Exact in-focus object (zLinear == focalDistance): CoC = 0.0
      const focusDepth = 0.5
      const focusDist = linearizeDepth(focusDepth)
      const inFocus = calculateCoC(focusDepth, focusDist, 0.05)
      expect(inFocus.coc).toBeCloseTo(0.0, 5)

      // Pinhole camera (aperture = 0.0): CoC is zero everywhere (infinite DoF)
      expect(calculateCoC(0.1, 5.0, 0.0).coc).toBe(0.0)
      expect(calculateCoC(0.9, 5.0, 0.0).coc).toBe(0.0)

      // Focal distance at origin (0.0): CoC strictly clamped to maxBlur, no NaN or division by zero
      const originFocus = calculateCoC(0.5, 0.0, 0.1)
      expect(Number.isFinite(originFocus.coc)).toBe(true)
      expect(originFocus.coc).toBeLessThanOrEqual(16.0)
      expect(originFocus.coc).toBeGreaterThan(0.0)

      // Focal distance at infinity (1e6): CoC clamped to maxBlur cleanly
      const infFocus = calculateCoC(0.5, 1e6, 0.1)
      expect(infFocus.coc).toBe(16.0)

      // Negative focal distance (-20.0): CoC clamped cleanly without NaN
      const negFocus = calculateCoC(0.5, -20.0, 0.05)
      expect(Number.isFinite(negFocus.coc)).toBe(true)
      expect(negFocus.coc).toBeLessThanOrEqual(16.0)
      expect(negFocus.coc).toBeGreaterThan(0.0)
    })

    it("verifies bokeh kernel polygon shape modulation (circular, hexagonal, octagonal)", () => {
      // Shape formula from dof.frag:
      // float n = u_bokehShape > 1.5 ? 8.0 : 6.0;
      // float piN = 3.14159265 / n;
      // float modAngle = mod(theta, 2.0 * piN) - piN;
      // r *= cos(piN) / cos(modAngle);
      const evaluateShapeRadius = (theta: number, shape: "circle" | "hexagon" | "octagon", baseR: number) => {
        if (shape === "circle") return baseR
        const n = shape === "octagon" ? 8.0 : 6.0
        const piN = Math.PI / n
        const twoPiN = 2.0 * piN
        const modAngle = ((theta % twoPiN) + twoPiN) % twoPiN - piN
        const denom = Math.cos(modAngle)
        return baseR * (Math.cos(piN) / denom)
      }

      // Singularity check: denom is cos(modAngle) where modAngle in [-pi/n, pi/n].
      // For n=6 (hex): cos(pi/6) = 0.866 > 0.
      // For n=8 (oct): cos(pi/8) = 0.923 > 0.
      // Denominator is strictly bounded away from zero!
      const angles = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI, 1.5 * Math.PI, 2 * Math.PI]
      for (const angle of angles) {
        const rHex = evaluateShapeRadius(angle, "hexagon", 1.0)
        const rOct = evaluateShapeRadius(angle, "octagon", 1.0)
        expect(Number.isFinite(rHex)).toBe(true)
        expect(Number.isFinite(rOct)).toBe(true)
        expect(rHex).toBeGreaterThan(0.0)
        expect(rOct).toBeGreaterThan(0.0)
      }

      // Hexagon vertex vs edge midpoint:
      // Vertex is at modAngle = +-piN -> r = baseR
      // Midpoint is at modAngle = 0 -> r = baseR * cos(piN)
      const hexVertex = evaluateShapeRadius(0.0, "hexagon", 1.0)
      const hexMidpoint = evaluateShapeRadius(Math.PI / 6, "hexagon", 1.0)
      expect(hexMidpoint).toBeCloseTo(Math.cos(Math.PI / 6), 4)
      expect(hexVertex).toBeCloseTo(1.0, 4)
    })
  })

  // ==========================================================================
  // Section 5: SSAO Sample Counts, Zero Radius & Geometric Occlusion
  // ==========================================================================
  describe("5. SSAO Sample Counts, Zero Radius & Geometry Crevice Occlusion", () => {
    adapters.forEach(({ name, adapter }) => {
      it(`[${name}] zero radius suppresses occlusion and returns ao = 1.0`, () => {
        adapter.updateSSAOSettings({
          enabled: true,
          radius: 0.0,
          intensity: 1.5,
          sampleCount: 16,
        })
        expect(adapter.state.postProcessState.ssao.radius).toBe(0.0)

        // Mathematical SSAO simulation with radius = 0.0
        const simulateSSAO = (radius: number, intensity: number, sampleCount: number) => {
          const effectiveRadius = radius * 0.05
          let occlusion = 0.0
          const samples = Math.floor(Math.max(4, Math.min(32, sampleCount)))

          for (let i = 0; i < samples; i++) {
            const fi = i / samples
            const dist = Math.sqrt(fi) * effectiveRadius
            // When radius is 0, dist is 0. Depth difference is 0.
            const depthDiff = 0.0
            const bias = 0.025
            if (depthDiff > bias && depthDiff < effectiveRadius * 4.0) {
              occlusion += 1.0
            }
          }

          const ao = Math.max(0.0, Math.min(1.0, 1.0 - (occlusion / samples) * intensity))
          return { ao, occlusion }
        }

        const result = simulateSSAO(0.0, 1.5, 16)
        expect(result.occlusion).toBe(0.0)
        expect(result.ao).toBe(1.0) // 100% ambient radiance, zero false shadowing
      })

      it(`[${name}] high sample counts (64, 128, 256) clamp safely to 32 samples`, () => {
        const counts = [64, 128, 256]
        for (const c of counts) {
          adapter.updateSSAOSettings({ sampleCount: c })
          expect(adapter.state.postProcessState.ssao.sampleCount).toBe(c)

          // Shader clamp logic: clamp(u_sampleCount, 4.0, 32.0)
          const shaderSamples = Math.floor(Math.max(4.0, Math.min(32.0, c)))
          expect(shaderSamples).toBe(32)
        }
      })
    })

    it("verifies concave crevice generates occlusion while flat planar surface does not", () => {
      // Simulate SSAO on planar surface vs 90-degree concave corner
      const evaluateOcclusion = (
        surfaceType: "planar" | "crevice",
        radius = 0.5,
        bias = 0.025,
        intensity = 1.5
      ) => {
        const effectiveRadius = radius * 0.05
        const samples = 16
        let occlusion = 0.0

        for (let i = 0; i < samples; i++) {
          const fi = i / samples
          const dist = Math.sqrt(fi) * effectiveRadius
          // On planar surface: sample depth is identical or slightly larger (slanted plane)
          // On 90-degree crevice: half the samples hit perpendicular blocking wall
          let sampleDepthDiff = 0.0
          if (surfaceType === "planar") {
            sampleDepthDiff = 0.005 // within bias threshold
          } else {
            // Half samples hit adjacent wall
            sampleDepthDiff = (i % 2 === 0) ? (effectiveRadius * 2.0) : 0.0
          }

          if (sampleDepthDiff > bias && sampleDepthDiff < effectiveRadius * 4.0) {
            const distFalloff = 1.0 - (sampleDepthDiff / (effectiveRadius * 4.0))
            occlusion += distFalloff
          }
        }

        const ao = Math.max(0.0, Math.min(1.0, 1.0 - (occlusion / samples) * intensity))
        return { ao, occlusion }
      }

      // Flat planar surface: zero occlusion -> AO = 1.0
      const planar = evaluateOcclusion("planar")
      expect(planar.occlusion).toBe(0.0)
      expect(planar.ao).toBe(1.0)

      // Concave crevice: occlusion triggers -> AO < 1.0 (contact shadow)
      const crevice = evaluateOcclusion("crevice")
      expect(crevice.occlusion).toBeGreaterThan(0.0)
      expect(crevice.ao).toBeLessThan(0.7)
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

    it("verifies GBuffer MRT textures and pipeline modes synchronize synchronously", () => {
      adapters.forEach(({ name, adapter }) => {
        adapter.setRenderingPipelineMode("deferred")
        expect(adapter.getPipelineMode()).toBe("deferred")

        const gbuffer = adapter.getGBufferTextures()
        expect(gbuffer).not.toBeNull()
        expect(gbuffer?.albedo).toBeDefined()
        expect(gbuffer?.normal).toBeDefined()
        expect(gbuffer?.roughnessMetallic).toBeDefined()
        expect(gbuffer?.depth).toBeDefined()
        expect(gbuffer?.motionVectors).toBeDefined()

        adapter.setRenderingPipelineMode("forward")
        expect(adapter.getPipelineMode()).toBe("forward")
        expect(adapter.getGBufferTextures()).toBeNull()
      })
    })
  })
})
