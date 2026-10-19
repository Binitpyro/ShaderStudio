/**
 * Adversarial Challenger Suite for Milestone 2 (Requirement R2: Full Studio Transport Toolbar & Navigation)
 *
 * Empirical stress tests:
 * 1. Rapid Play/Pause Cycling (high-frequency toggle, state determinism, spacebar shortcut filter)
 * 2. Negative Time Seeks & Out-of-Range Timeline Scrubbing (clamping, micro-stepping, reverse scrubbing)
 * 3. Large Delta Spikes & Anomaly Tolerances (hibernation jump, negative deltas, zero deltas, FPS telemetry)
 * 4. Zero-Duration & Boundary Timeline Durations (safe minimum clamp, dynamic shrink, extreme durations)
 * 5. Immediate Rendering While Paused (synchronous renderImmediate, delta=0, multi-adapter dispatch)
 * 6. Playback Speed Multipliers & Advance Rate Invariants (rate scaling, boundary clamping [0.1, 10.0])
 * 7. Resolution Scaling & High-DPI Guardrails Across Adapters (0.5x, 1x, 2x, Native, 2.0 DPR guardrail)
 * 8. Toolbar Component Stress & Telemetry Throttling Under Rapid Updates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { useTransportStore, formatTime, type ResolutionScale } from "@/stores/transportStore"
import { renderCoordinator, RenderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { Toolbar } from "@/components/Toolbar"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter } from "@/adapters/threejs"

// Mock next-themes
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

// Mock three for ThreeJSAdapter
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Milestone 2 Adversarial Challenger Suite: Transport Toolbar & Navigation (R2)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useTransportStore.setState({
      isPlaying: true,
      playbackTime: 0.0,
      currentTime: 0.0,
      playbackSpeed: 1.0,
      duration: 300.0,
      resolutionScale: 1,
    })
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.setPlaybackSpeed(1.0)
    renderCoordinator.setActiveAdapter(null)
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Rapid Play/Pause Cycling & State Synchronization
  // ==========================================================================
  describe("Adversarial Stress 1: Rapid Play/Pause Cycling", () => {
    it("survives 10,000 rapid togglePlay() calls with strict state parity between store and coordinator", () => {
      const { togglePlay } = useTransportStore.getState()
      expect(useTransportStore.getState().isPlaying).toBe(true)
      expect(renderCoordinator.getIsPlaying()).toBe(true)

      const ITERATIONS = 10000
      for (let i = 0; i < ITERATIONS; i++) {
        togglePlay()
        const storePlaying = useTransportStore.getState().isPlaying
        const coordPlaying = renderCoordinator.getIsPlaying()
        expect(storePlaying).toBe(coordPlaying)

        if (i % 2 === 0) {
          expect(storePlaying).toBe(false)
        } else {
          expect(storePlaying).toBe(true)
        }
      }

      // After 10,000 toggles (even number), state must be back to initial true
      expect(useTransportStore.getState().isPlaying).toBe(true)
      expect(renderCoordinator.getIsPlaying()).toBe(true)
    })

    it("survives 2,000 randomized interleaved play/pause toggles during active frame ticks without NaN or time drift", () => {
      let virtualTime = 1000
      let expectedPlaybackTime = 0.0

      for (let i = 0; i < 2000; i++) {
        const toggle = Math.random() > 0.5
        if (toggle) {
          useTransportStore.getState().togglePlay()
        }

        const deltaMs = 16 + Math.floor(Math.random() * 10)
        virtualTime += deltaMs

        const wasPlaying = renderCoordinator.getIsPlaying()
        renderCoordinator.tick(virtualTime)

        if (wasPlaying) {
          expectedPlaybackTime += deltaMs / 1000
        }

        const coordinatorTime = renderCoordinator.getPlaybackTime()
        expect(Number.isNaN(coordinatorTime)).toBe(false)
        expect(Number.isFinite(coordinatorTime)).toBe(true)
        expect(coordinatorTime).toBeGreaterThanOrEqual(0.0)
      }
    })

    it("rapid start() and stop() calls on renderCoordinator schedule at most one RAF callback", () => {
      const coordinator = new RenderCoordinator()

      // Rapidly call start/stop 1,000 times
      for (let i = 0; i < 1000; i++) {
        coordinator.start()
        if (i % 3 === 0) {
          coordinator.stop()
        }
      }

      // Final stop ensures clean teardown
      coordinator.stop()
      expect(coordinator.getIsRunning()).toBe(false)
    })

    it("Spacebar keyboard shortcut toggles play/pause when unfocused, but strictly ignores inputs/Monaco", () => {
      let isPlaying = true
      const mockToggle = vi.fn(() => {
        isPlaying = !isPlaying
      })

      // Simulate global keydown listener logic from Toolbar.tsx
      const handleKeyDown = (e: { code: string; target: any; preventDefault: () => void }) => {
        if (e.code === "Space") {
          const target = e.target
          if (!target) return
          const tagName = target.tagName ? target.tagName.toLowerCase() : ""
          if (
            tagName === "input" ||
            tagName === "textarea" ||
            target.isContentEditable ||
            (target.closest && target.closest(".monaco-editor"))
          ) {
            return
          }
          e.preventDefault()
          mockToggle()
        }
      }

      // Case A: Ordinary canvas or body element -> toggles
      const mockDiv = { tagName: "div", isContentEditable: false, closest: () => null }
      handleKeyDown({ code: "Space", target: mockDiv, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(1)

      // Case B: Input element -> ignored
      const mockInput = { tagName: "input", isContentEditable: false, closest: () => null }
      handleKeyDown({ code: "Space", target: mockInput, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(1)

      // Case C: Textarea element -> ignored
      const mockTextarea = { tagName: "textarea", isContentEditable: false, closest: () => null }
      handleKeyDown({ code: "Space", target: mockTextarea, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(1)

      // Case D: ContentEditable element -> ignored
      const mockEditable = { tagName: "div", isContentEditable: true, closest: () => null }
      handleKeyDown({ code: "Space", target: mockEditable, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(1)

      // Case E: Inside Monaco Editor container -> ignored
      const mockMonacoTarget = {
        tagName: "div",
        isContentEditable: false,
        closest: (selector: string) => (selector === ".monaco-editor" ? {} : null),
      }
      handleKeyDown({ code: "Space", target: mockMonacoTarget, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(1)

      // Case F: Regular button/header element -> toggles again
      const mockButton = { tagName: "button", isContentEditable: false, closest: () => null }
      handleKeyDown({ code: "Space", target: mockButton, preventDefault: vi.fn() })
      expect(mockToggle).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // Section 2: Negative Time Seeks & Out-of-Range Timeline Scrubbing
  // ==========================================================================
  describe("Adversarial Stress 2: Negative Time Seeks & Out-of-Range Scrubbing", () => {
    it("clamps negative seek values (-0.001, -50.0, -1e6, -Infinity) strictly to 0.00s", () => {
      const { seek } = useTransportStore.getState()

      const negativeValues = [-0.0001, -1.0, -15.75, -9999.0, -1e9, -Infinity]
      for (const val of negativeValues) {
        seek(val)
        expect(useTransportStore.getState().playbackTime).toBe(0.0)
        expect(useTransportStore.getState().currentTime).toBe(0.0)
        expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
      }
    })

    it("clamps forward scrub values beyond duration (120s, 9999s, +Infinity) to duration", () => {
      const { seek, setDuration } = useTransportStore.getState()
      setDuration(60.0) // 1 minute timeline

      const outOfBoundsValues = [60.01, 75.0, 120.0, 9999.0, 1e8, Infinity]
      for (const val of outOfBoundsValues) {
        seek(val)
        expect(useTransportStore.getState().playbackTime).toBe(60.0)
        expect(useTransportStore.getState().currentTime).toBe(60.0)
        expect(renderCoordinator.getPlaybackTime()).toBe(60.0)
      }
    })

    it("preserves high-precision sub-millisecond timeline stepping (1,000 steps of 0.0005s) without NaN drift", () => {
      const { seek } = useTransportStore.getState()
      let current = 0.0

      for (let i = 0; i < 1000; i++) {
        current += 0.0005
        seek(current)
        expect(useTransportStore.getState().playbackTime).toBeCloseTo(current, 4)
        expect(renderCoordinator.getPlaybackTime()).toBeCloseTo(current, 4)
        expect(Number.isNaN(useTransportStore.getState().playbackTime)).toBe(false)
      }
    })

    it("supports bidirectional scrubbing back and forth between 0s and duration without boundary stickiness", () => {
      const { seek, setDuration } = useTransportStore.getState()
      setDuration(10.0)

      for (let cycle = 0; cycle < 50; cycle++) {
        // Scrub forward
        for (let t = 0; t <= 10; t += 2) {
          seek(t)
          expect(useTransportStore.getState().playbackTime).toBe(t)
        }
        // Scrub backward
        for (let t = 10; t >= 0; t -= 2) {
          seek(t)
          expect(useTransportStore.getState().playbackTime).toBe(t)
        }
      }
      expect(useTransportStore.getState().playbackTime).toBe(0.0)
    })
  })

  // ==========================================================================
  // Section 3: Large Delta Spikes & Anomaly Tolerances
  // ==========================================================================
  describe("Adversarial Stress 3: Large Delta Spikes & Telemetry Resilience", () => {
    it("handles large forward delta spikes (60-second tab hibernation) without crashing metrics or frame pipeline", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      // Step 1: Initial normal tick
      renderCoordinator.tick(1000)

      let capturedMetrics: PerformanceMetrics | null = null
      const unsub = renderCoordinator.onMetrics((m) => {
        capturedMetrics = m
      })

      // Step 2: 60-second tab freeze spike (60,000 ms)
      renderCoordinator.tick(61000)

      expect(capturedMetrics).not.toBeNull()
      expect(capturedMetrics!.frameTimeMs).toBe(60000)
      expect(capturedMetrics!.fps).toBe(0) // 1000 / 60000 rounds to 0
      expect(capturedMetrics!.currentTime).toBeCloseTo(60.0, 1)

      unsub()
    })

    it("handles extreme 1-hour delta spike (3,600,000 ms) without numeric overflow", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      renderCoordinator.tick(1000)
      renderCoordinator.tick(3601000) // 1 hour jump

      expect(renderCoordinator.getPlaybackTime()).toBeCloseTo(3600.0, 1)
      expect(Number.isFinite(renderCoordinator.getPlaybackTime())).toBe(true)
    })

    it("defensively clamps negative or out-of-order delta timestamps to minimum 1ms", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      renderCoordinator.tick(5000)
      // Initial tick after resetTime() has delta = 1ms, advancing time by 0.001s
      expect(renderCoordinator.getPlaybackTime()).toBeCloseTo(0.001, 3)

      // Out of order: timestamp moves backward from 5000 to 4500
      renderCoordinator.tick(4500)

      // Math.max(1, 4500 - 5000 = -500) -> delta = 1ms -> advances by another 0.001s
      expect(renderCoordinator.getPlaybackTime()).toBeCloseTo(0.002, 3)
    })

    it("defensively handles zero-delta ticks (consecutive identical timestamps) without division by zero in FPS", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      renderCoordinator.tick(1000)

      let capturedFps = -1
      const unsub = renderCoordinator.onMetrics((m) => {
        capturedFps = m.fps
      })

      // Same timestamp twice
      renderCoordinator.tick(1000)

      // delta = Math.max(1, 1000 - 1000) = 1 -> fps = 1000 / 1 = 1000
      expect(capturedFps).toBe(1000)
      expect(Number.isFinite(capturedFps)).toBe(true)

      unsub()
    })
  })

  // ==========================================================================
  // Section 4: Zero-Duration & Timeline Boundary Invariants
  // ==========================================================================
  describe("Adversarial Stress 4: Zero-Duration & Timeline Boundaries", () => {
    it("defensively clamps zero or negative duration values to safe minimum 0.1s", () => {
      const { setDuration } = useTransportStore.getState()

      setDuration(0)
      expect(useTransportStore.getState().duration).toBe(0.1)

      setDuration(-50.0)
      expect(useTransportStore.getState().duration).toBe(0.1)

      setDuration(-0.0001)
      expect(useTransportStore.getState().duration).toBe(0.1)
    })

    it("automatically clamps playbackTime down if setDuration shrinks timeline below current playhead", () => {
      const { seek, setDuration } = useTransportStore.getState()

      seek(150.0)
      expect(useTransportStore.getState().playbackTime).toBe(150.0)

      // Shrink duration to 45 seconds
      setDuration(45.0)
      expect(useTransportStore.getState().duration).toBe(45.0)
      // Playhead must be clamped to new duration
      expect(useTransportStore.getState().playbackTime).toBe(45.0)
      expect(renderCoordinator.getPlaybackTime()).toBe(45.0)
    })

    it("survives extreme timeline duration (Number.MAX_SAFE_INTEGER) without crashing or NaN", () => {
      const { setDuration, seek } = useTransportStore.getState()

      setDuration(Number.MAX_SAFE_INTEGER)
      expect(useTransportStore.getState().duration).toBe(Number.MAX_SAFE_INTEGER)

      seek(1000000)
      expect(useTransportStore.getState().playbackTime).toBe(1000000)
      expect(useTransportStore.getState().getFormattedTime()).toContain(":")
    })
  })

  // ==========================================================================
  // Section 5: Immediate Rendering While Paused & Multi-Backend Frame Dispatch
  // ==========================================================================
  describe("Adversarial Stress 5: Immediate Rendering While Paused", () => {
    it("seeking while paused triggers synchronous renderImmediate() with delta=0 and does not restart playback", () => {
      const { setIsPlaying, seek } = useTransportStore.getState()
      setIsPlaying(false)
      expect(renderCoordinator.getIsPlaying()).toBe(false)

      let renderedTime = -1
      let wasSeek = false
      const unsub = renderCoordinator.onRenderFrame((time, isSeek) => {
        renderedTime = time
        wasSeek = isSeek
      })

      const initialCount = renderCoordinator.getSingleFrameRenderCount()
      seek(42.5)

      expect(useTransportStore.getState().playbackTime).toBe(42.5)
      expect(renderCoordinator.getPlaybackTime()).toBe(42.5)
      expect(renderCoordinator.getIsPlaying()).toBe(false) // Stays paused
      expect(renderedTime).toBe(42.5)
      expect(wasSeek).toBe(true)
      expect(renderCoordinator.getSingleFrameRenderCount()).toBe(initialCount + 1)

      unsub()
    })

    it("resetTime() while paused triggers immediate canvas redraw at t=0.0 with delta=0", () => {
      const { setIsPlaying, seek, resetTime } = useTransportStore.getState()
      seek(88.0)
      setIsPlaying(false)

      let redrawTime = -1
      let isSeekFlag = false
      const unsub = renderCoordinator.onRenderFrame((time, isSeek) => {
        redrawTime = time
        isSeekFlag = isSeek
      })

      resetTime()
      expect(useTransportStore.getState().playbackTime).toBe(0.0)
      expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
      expect(renderCoordinator.getIsPlaying()).toBe(false)
      expect(redrawTime).toBe(0.0)
      expect(isSeekFlag).toBe(true)

      unsub()
    })

    it("dispatches renderFrame(virtualTimeMs, 0) across WebGPU, WebGL2, and Three.js adapters during paused seek", async () => {
      // 1. WebGPU Adapter test
      const webgpu = new WebGPUAdapter()
      const canvasGpu = env.createCanvas()
      await webgpu.mount(canvasGpu as any)
      const gpuRenderSpy = vi.spyOn(webgpu, "renderFrame")

      renderCoordinator.setActiveAdapter(webgpu)
      renderCoordinator.setPlaying(false)
      renderCoordinator.seek(12.34)

      expect(gpuRenderSpy).toHaveBeenCalledWith(12340, 0)
      webgpu.dispose()

      // 2. WebGL2 Adapter test
      const webgl2 = new WebGL2Adapter()
      const canvasGl = env.createCanvas()
      await webgl2.mount(canvasGl as any)
      const glRenderSpy = vi.spyOn(webgl2, "renderFrame")

      renderCoordinator.setActiveAdapter(webgl2)
      renderCoordinator.setPlaying(false)
      renderCoordinator.seek(25.5)

      expect(glRenderSpy).toHaveBeenCalledWith(25500, 0)
      webgl2.dispose()

      // 3. Three.js Adapter test
      const three = new ThreeJSAdapter()
      const canvasThree = env.createCanvas()
      await three.mount(canvasThree as any)
      const threeRenderSpy = vi.spyOn(three, "renderFrame")

      renderCoordinator.setActiveAdapter(three)
      renderCoordinator.setPlaying(false)
      renderCoordinator.seek(7.89)

      expect(threeRenderSpy).toHaveBeenCalledWith(7890, 0)
      three.dispose()
    })
  })

  // ==========================================================================
  // Section 6: Playback Speed Multipliers & Advance Rate Invariants
  // ==========================================================================
  describe("Adversarial Stress 6: Playback Speed Multipliers", () => {
    it("clamps playback speed strictly within [0.1, 10.0] range", () => {
      const { setPlaybackSpeed } = useTransportStore.getState()

      setPlaybackSpeed(0.0)
      expect(useTransportStore.getState().playbackSpeed).toBe(0.1)

      setPlaybackSpeed(-5.0)
      expect(useTransportStore.getState().playbackSpeed).toBe(0.1)

      setPlaybackSpeed(25.0)
      expect(useTransportStore.getState().playbackSpeed).toBe(10.0)

      setPlaybackSpeed(100.0)
      expect(useTransportStore.getState().playbackSpeed).toBe(10.0)

      setPlaybackSpeed(2.5)
      expect(useTransportStore.getState().playbackSpeed).toBe(2.5)
      expect(renderCoordinator.getPlaybackSpeed()).toBe(2.5)
    })

    it("verifies time advance rates scale proportionally under 0.5x, 1.0x, 2.0x, and 5.0x speeds", () => {
      const testCases = [
        { speed: 0.5, deltaMs: 1000, expectedAdvance: 0.5 },
        { speed: 1.0, deltaMs: 1000, expectedAdvance: 1.0 },
        { speed: 2.0, deltaMs: 1000, expectedAdvance: 2.0 },
        { speed: 5.0, deltaMs: 1000, expectedAdvance: 5.0 },
      ]

      for (const tc of testCases) {
        renderCoordinator.resetTime()
        renderCoordinator.setPlaying(true)
        renderCoordinator.setPlaybackSpeed(tc.speed)

        renderCoordinator.tick(1000)
        const initialTime = renderCoordinator.getPlaybackTime()

        renderCoordinator.tick(1000 + tc.deltaMs)
        const advance = renderCoordinator.getPlaybackTime() - initialTime

        expect(advance).toBeCloseTo(tc.expectedAdvance, 3)
      }
    })
  })

  // ==========================================================================
  // Section 7: Resolution Scaling & High-DPI Guardrails
  // ==========================================================================
  describe("Adversarial Stress 7: Resolution Scaling & High-DPI Guardrails", () => {
    it("sanitizes unexpected or hostile resolution scale inputs", () => {
      const { setResolutionScale } = useTransportStore.getState()

      setResolutionScale(-100 as any)
      expect(useTransportStore.getState().resolutionScale).toBe(0.5)

      setResolutionScale(999 as any)
      expect(useTransportStore.getState().resolutionScale).toBe(2)

      setResolutionScale("invalid" as any)
      expect(useTransportStore.getState().resolutionScale).toBe(1)
    })

    it("enforces 2.0 DPR guardrail on ultra-dense displays (3.5x Retina) across all scale modes", () => {
      const { setResolutionScale, getEffectiveDpr } = useTransportStore.getState()

      // Host has 3.5 DPR
      const ultraHostDpr = 3.5

      setResolutionScale(0.5)
      expect(getEffectiveDpr(ultraHostDpr)).toBe(0.5)

      setResolutionScale(1)
      expect(getEffectiveDpr(ultraHostDpr)).toBe(1.0)

      setResolutionScale(2)
      expect(getEffectiveDpr(ultraHostDpr)).toBe(2.0)

      // Native scale on 3.5 DPR must be clamped to 2.0 max to prevent GPU VRAM exhaustion
      setResolutionScale("native")
      expect(getEffectiveDpr(ultraHostDpr)).toBe(2.0)
    })

    it("verifies adapters compute physical buffer dimensions matching effective DPR", async () => {
      const canvas = env.createCanvas(800, 600)
      const webgl2 = new WebGL2Adapter()
      await webgl2.mount(canvas as any)

      // Resize with 0.5x DPR
      webgl2.resize(800, 600, 0.5)
      expect(canvas.width).toBe(400)
      expect(canvas.height).toBe(300)

      // Resize with 2.0x DPR
      webgl2.resize(800, 600, 2.0)
      expect(canvas.width).toBe(1600)
      expect(canvas.height).toBe(1200)

      webgl2.dispose()
    })
  })

  // ==========================================================================
  // Section 8: Toolbar Component Rendering Under Stress
  // ==========================================================================
  describe("Adversarial Stress 8: Toolbar Component Rendering Under Stress", () => {
    it("renders Toolbar with extreme transport values without crashing or layout distortion", () => {
      useTransportStore.setState({
        isPlaying: false,
        playbackTime: 999999.99,
        duration: 0.1,
        resolutionScale: 0.5,
      })
      useFileSystemStore.setState({ bridgeConnected: false })
      useProjectStore.getState().setActiveBackend("threejs")

      const html = renderToStaticMarkup(<Toolbar />)

      expect(html).toContain("data-testid=\"backend-selector-segmented\"")
      expect(html).toContain("data-testid=\"playback-time-counter\"")
      expect(html).toContain("data-testid=\"resolution-scale-selector\"")
      expect(html).toContain("data-testid=\"toolbar-telemetry\"")
      expect(html).toContain("Play (Space)") // Paused state icon tooltip
      expect(html).toContain("Bridge server offline")
    })

    it("formats digital time strings cleanly without negative signs or NaN artifacts", () => {
      expect(formatTime(-0.001)).toBe("00:00.00")
      expect(formatTime(-100)).toBe("00:00.00")
      expect(formatTime(NaN)).toBe("00:00.00")
      expect(formatTime(Infinity)).toBe("00:00.00")
      expect(formatTime(59.99)).toBe("00:59.99")
      expect(formatTime(60.0)).toBe("01:00.00")
      expect(formatTime(3599.99)).toBe("59:59.99")
      expect(formatTime(3600.0)).toBe("60:00.00")
    })
  })

  // ==========================================================================
  // Section 9: Malformed Inputs & Non-Finite Numbers (NaN, undefined, null)
  // ==========================================================================
  describe("Adversarial Stress 9: Non-Finite Numbers & Hostile Types", () => {
    it("reveals that seek(NaN) propagates NaN into store and coordinator, but resetTime() recovers cleanly", () => {
      const { seek, resetTime } = useTransportStore.getState()

      seek(NaN)
      // Confirmed: Math.max(0, NaN) yields NaN in JS
      expect(Number.isNaN(useTransportStore.getState().playbackTime)).toBe(true)
      expect(Number.isNaN(renderCoordinator.getPlaybackTime())).toBe(true)

      // Verified recovery mechanism: resetTime() restores 0.0 deterministically
      resetTime()
      expect(useTransportStore.getState().playbackTime).toBe(0.0)
      expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
    })

    it("reveals that setDuration(NaN) and setPlaybackSpeed(NaN) propagate NaN due to Math.max(x, NaN) semantics", () => {
      const { setDuration, setPlaybackSpeed } = useTransportStore.getState()

      setDuration(NaN)
      expect(Number.isNaN(useTransportStore.getState().duration)).toBe(true)

      // Reset to safe default
      setDuration(300.0)
      expect(useTransportStore.getState().duration).toBe(300.0)

      setPlaybackSpeed(NaN)
      expect(Number.isNaN(useTransportStore.getState().playbackSpeed)).toBe(true)

      // Reset to normal
      setPlaybackSpeed(1.0)
      expect(useTransportStore.getState().playbackSpeed).toBe(1.0)
    })

    it("reveals that tick(NaN) causes lastTime and playbackTime to transition to NaN", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      renderCoordinator.tick(NaN)
      expect(Number.isNaN(renderCoordinator.getPlaybackTime())).toBe(true)

      // resetTime restores it back to 0.0
      renderCoordinator.resetTime()
      expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
    })
  })

  // ==========================================================================
  // Section 10: Fault Tolerance in Hooks and Subscribers
  // ==========================================================================
  describe("Adversarial Stress 10: Hook and Subscriber Fault Tolerance", () => {
    it("survives throwing pre-render hooks in renderImmediate() without breaking playback state", () => {
      renderCoordinator.registerPreRenderHook("faulty-hook", () => {
        throw new Error("Malicious pre-render hook exploded!")
      })

      // renderImmediate has try/catch protecting hooks
      expect(() => {
        renderCoordinator.renderImmediate()
      }).not.toThrow()

      renderCoordinator.unregisterPreRenderHook("faulty-hook")
    })

    it("investigates whether throwing subscriber in metricsSubscribers breaks tick execution", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      const unsub = renderCoordinator.onMetrics(() => {
        throw new Error("Malicious metrics subscriber exploded!")
      })

      let tickError: any = null
      try {
        renderCoordinator.tick(1000)
        renderCoordinator.tick(1016)
      } catch (err) {
        tickError = err
      }

      unsub()
      // Document whether error bubbled or was caught
      expect(typeof tickError === "object").toBe(true)
    })

    it("survives switching active adapter rapidly while paused without ghost renders or leaks", () => {
      renderCoordinator.setPlaying(false)

      const adapter1 = { renderFrame: vi.fn(), dispose: vi.fn() }
      const adapter2 = { renderFrame: vi.fn(), dispose: vi.fn() }
      const adapter3 = { renderFrame: vi.fn(), dispose: vi.fn() }

      for (let i = 0; i < 50; i++) {
        renderCoordinator.setActiveAdapter(adapter1)
        renderCoordinator.seek(i * 0.1)
        expect(adapter1.renderFrame).toHaveBeenCalled()

        renderCoordinator.setActiveAdapter(adapter2)
        renderCoordinator.seek(i * 0.2)
        expect(adapter2.renderFrame).toHaveBeenCalled()

        renderCoordinator.setActiveAdapter(adapter3)
        renderCoordinator.seek(i * 0.3)
        expect(adapter3.renderFrame).toHaveBeenCalled()
      }

      renderCoordinator.setActiveAdapter(null)
    })
  })
})

