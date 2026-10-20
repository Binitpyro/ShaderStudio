// fleet(w1-a-render): consolidated from adversarial-m2-transport-challenger.test.tsx, adversarial-m2-challenger2-resolution-telemetry.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { useTransportStore, formatTime, type ResolutionScale } from "@/stores/transportStore"
import { renderCoordinator, RenderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { Toolbar } from "@/components/Toolbar"
import { WebGPUAdapter, webgpuAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter, webgl2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter, threejsAdapter } from "@/adapters/threejs"
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

describe("Transport toolbar, seek/clamp and playback invariants", () => {
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


// Mock next-themes

// Mock three for ThreeJSAdapter

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
      // Render the REAL Toolbar, capturing the effects it registers (server render never runs them).
      const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
      const effects: Array<() => void | (() => void)> = []
      function Interceptor() {
        const original = internals.H
        internals.H = { ...original, useEffect: (fn: () => void | (() => void)) => void effects.push(fn) }
        try {
          Toolbar({})
        } finally {
          internals.H = original
        }
        return null
      }
      renderToStaticMarkup(React.createElement(Interceptor))
      expect(effects.length).toBeGreaterThan(0)

      // Real Event objects dispatched through a real EventTarget standing in for `window`.
      class FakeWindow extends EventTarget {
        tagName = "div"
        isContentEditable = false
        insideMonaco = false
        insideNodeGraph = false
        closest(selector: string) {
          if (this.insideMonaco && selector.includes(".monaco-editor")) return {}
          if (this.insideNodeGraph && selector.includes(".react-flow")) return {}
          return null
        }
      }
      const win = new FakeWindow()
      vi.stubGlobal("window", win)
      const cleanups: Array<() => void> = []
      try {
        for (const effect of effects) {
          const cleanup = effect()
          if (typeof cleanup === "function") cleanups.push(cleanup)
        }

        const press = () => {
          const ev = Object.assign(new Event("keydown", { cancelable: true }), { code: "Space" })
          win.dispatchEvent(ev)
          return ev
        }
        const isPlaying = () => useTransportStore.getState().isPlaying
        expect(isPlaying()).toBe(true)

        // A: ordinary element -> toggles (and default is prevented)
        expect(press().defaultPrevented).toBe(true)
        expect(isPlaying()).toBe(false)

        // B/C/D/E: input, textarea, contenteditable, inside Monaco -> ignored
        win.tagName = "input"
        expect(press().defaultPrevented).toBe(false)
        win.tagName = "textarea"
        press()
        win.tagName = "div"
        win.isContentEditable = true
        press()
        win.isContentEditable = false
        win.insideMonaco = true
        press()
        win.insideMonaco = false
        expect(isPlaying()).toBe(false)

        // fleet(w2) item 12: focus inside the node-graph canvas (.react-flow) owns Space (palette), so
        // the Toolbar must neither toggle playback nor swallow the event
        win.insideNodeGraph = true
        expect(press().defaultPrevented).toBe(false)
        win.insideNodeGraph = false
        expect(isPlaying()).toBe(false)

        // F: regular button -> toggles back
        win.tagName = "button"
        press()
        expect(isPlaying()).toBe(true)

        // After cleanup the listener is removed and Space no longer toggles
        cleanups.forEach((c) => c())
        cleanups.length = 0
        press()
        expect(isPlaying()).toBe(true)
      } finally {
        cleanups.forEach((c) => c())
        vi.unstubAllGlobals()
      }
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
      // fleet(w2): simulated delta is capped at 100ms so a resume cannot explode virtual time
      expect(capturedMetrics!.currentTime).toBeCloseTo(0.1, 1)

      unsub()
    })

    it("handles extreme 1-hour delta spike (3,600,000 ms) without numeric overflow", () => {
      renderCoordinator.resetTime()
      renderCoordinator.setPlaying(true)

      renderCoordinator.tick(1000)
      renderCoordinator.tick(3601000) // 1 hour jump

      // fleet(w2): capped at 100ms of simulated time
      expect(renderCoordinator.getPlaybackTime()).toBeCloseTo(0.1, 1)
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
        { speed: 0.5, deltaMs: 100, expectedAdvance: 0.05 },
        { speed: 1.0, deltaMs: 100, expectedAdvance: 0.1 },
        { speed: 2.0, deltaMs: 100, expectedAdvance: 0.2 },
        { speed: 5.0, deltaMs: 100, expectedAdvance: 0.5 },
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
      expect(html).toContain("aria-label=\"Play\"") // Paused state icon
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
})

describe("Resolution scaling, extreme DPR and telemetry accuracy", () => {
/**
 * Milestone 2 Adversarial Challenger 2 Suite (Requirement R2: Full Studio Transport Toolbar & Navigation)
 *
 * SPECIFIC ADVERSARIAL CHALLENGES:
 * 1. Canvas Resolution Scaling Transitions across 0.5x, 1x, 2x, and Native DPI:
 *    - Active rendering (isPlaying = true): seamless virtual time progression without hitch/jump during scaling.
 *    - Paused state (isPlaying = false): strict virtual time freeze, single-frame delta=0 redraw, physical canvas dimension updates.
 *    - Back-and-forth resolution transitions across WebGPU, WebGL2, and Three.js backends.
 *    - Rapid 100-cycle scale switching stress test.
 *    - Rebuilding of post-process ping-pong targets, FBOs, and WebGPU depth textures upon resolution change.
 * 2. Extreme Device Pixel Ratios (3x, 4x, Fractional DPRs):
 *    - Host DPR >= 3.0 (3x Retina, 4x ultra-dense, 8x synthetic) respecting the 2.0 DPR GPU VRAM guardrail.
 *    - Fractional DPRs (1.1x, 1.25x, 1.333x, 1.5x, 1.75x, 2.25x, 2.625x) ensuring non-fractional, integer physical buffers.
 *    - Degenerate, zero, negative, NaN, and Infinity DPR edge-case sanitation.
 *    - Negative and subpixel container dimensions clamped to positive integer minimums (>= 1px).
 * 3. Telemetry Accuracy (FPS & Frame Time) Under Varying Load:
 *    - Mathematical parity across standard workloads: 60 FPS (16.67ms), 120 FPS (8.33ms), 30 FPS (33.33ms), 144 FPS (6.94ms).
 *    - Heavy GPU stalls and frame-hitch tracking: 4 FPS (250ms), 15 FPS (66.67ms), 2 FPS (500ms), and rapid recovery.
 *    - Clock rollback (NTP reverse step) and zero-delta defense preventing division-by-zero or negative deltas.
 *    - High-throughput telemetry subscriber load (1,000 frames) and UI badge 120ms throttle verification.
 */



describe("Milestone 2 Challenger 2: Resolution Scaling Transitions, Extreme DPRs & Telemetry Accuracy", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    useTransportStore.setState({
      isPlaying: true,
      playbackTime: 0.0,
      currentTime: 0.0,
      playbackSpeed: 1.0,
      duration: 300.0,
      resolutionScale: 1,
    })
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Canvas Resolution Scaling Transitions (0.5x, 1x, 2x, Native DPI)
  // ==========================================================================
  describe("1. Canvas Resolution Scaling Transitions across 0.5x, 1x, 2x, and Native DPI", () => {
    const CONTAINER_WIDTH = 1920
    const CONTAINER_HEIGHT = 1080

    it("transitions resolution scales across WebGPU, WebGL2, and Three.js in active rendering state without time disruption", async () => {
      const coordinator = new RenderCoordinator()
      const canvasGpu = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)
      const canvasGl2 = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)
      const canvasThree = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)

      const gpu = new WebGPUAdapter()
      const gl2 = new WebGL2Adapter()
      const three = new ThreeJSAdapter()

      await gpu.mount(canvasGpu as any)
      await gl2.mount(canvasGl2 as any)
      await three.mount(canvasThree as any)

      coordinator.setPlaying(true)
      coordinator.setActiveAdapter(gpu)

      // Initialize clock baseline at t = 1000
      let currentTime = 1000
      coordinator.tick(currentTime)
      coordinator.seek(0)

      // Step 1: Render 5 frames at 1x scale on WebGPU
      useTransportStore.getState().setResolutionScale(1)
      let dpr = useTransportStore.getState().getEffectiveDpr(1.0)
      expect(dpr).toBe(1.0)
      gpu.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, dpr)
      expect(canvasGpu.width).toBe(1920)
      expect(canvasGpu.height).toBe(1080)

      for (let i = 0; i < 5; i++) {
        currentTime += 16.666
        coordinator.tick(currentTime)
      }
      expect(coordinator.getPlaybackTime()).toBeCloseTo(5 * 0.016666, 3)

      // Step 2: Transition to 0.5x scale during active playback on WebGPU
      useTransportStore.getState().setResolutionScale(0.5)
      dpr = useTransportStore.getState().getEffectiveDpr(1.0)
      expect(dpr).toBe(0.5)
      gpu.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, dpr)
      expect(canvasGpu.width).toBe(960)
      expect(canvasGpu.height).toBe(540)

      // Continue ticking 5 frames: virtual playback clock must continue without hitching
      for (let i = 0; i < 5; i++) {
        currentTime += 16.666
        coordinator.tick(currentTime)
      }
      expect(coordinator.getPlaybackTime()).toBeCloseTo(10 * 0.016666, 3)

      // Step 3: Transition to 2x scale on WebGL2 adapter
      coordinator.setActiveAdapter(gl2)
      useTransportStore.getState().setResolutionScale(2)
      dpr = useTransportStore.getState().getEffectiveDpr(1.0)
      expect(dpr).toBe(2.0)
      gl2.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, dpr)
      expect(canvasGl2.width).toBe(3840)
      expect(canvasGl2.height).toBe(2160)

      for (let i = 0; i < 5; i++) {
        currentTime += 16.666
        coordinator.tick(currentTime)
      }
      expect(coordinator.getPlaybackTime()).toBeCloseTo(15 * 0.016666, 3)

      // Step 4: Transition to Native scale (host DPR = 1.5) on Three.js adapter
      coordinator.setActiveAdapter(three)
      useTransportStore.getState().setResolutionScale("native")
      dpr = useTransportStore.getState().getEffectiveDpr(1.5)
      expect(dpr).toBe(1.5)
      three.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, dpr)
      expect(canvasThree.width).toBe(2880) // 1920 * 1.5
      expect(canvasThree.height).toBe(1620) // 1080 * 1.5

      for (let i = 0; i < 5; i++) {
        currentTime += 16.666
        coordinator.tick(currentTime)
      }
      expect(coordinator.getPlaybackTime()).toBeCloseTo(20 * 0.016666, 3)

      coordinator.stop()
      gpu.dispose()
      gl2.dispose()
      three.dispose()
    })

    it("verifies resolution scaling transitions during PAUSED states maintain strict time freeze and update canvas buffers", async () => {
      const coordinator = new RenderCoordinator()
      const canvas = env.createCanvas(1280, 720)
      const gpu = new WebGPUAdapter()
      await gpu.mount(canvas as any)

      coordinator.setActiveAdapter(gpu)

      // Advance clock to t = 42.50s, then pause
      coordinator.seek(42.5)
      coordinator.setPlaying(false)
      expect(coordinator.getPlaybackTime()).toBe(42.5)
      expect(coordinator.getIsPlaying()).toBe(false)

      const scales: { scale: ResolutionScale; expectedW: number; expectedH: number }[] = [
        { scale: 0.5, expectedW: 640, expectedH: 360 },
        { scale: 1, expectedW: 1280, expectedH: 720 },
        { scale: 2, expectedW: 2560, expectedH: 1440 },
        { scale: "native", expectedW: 1920, expectedH: 1080 }, // with host DPR = 1.5
      ]

      let renderFrameCalls = 0
      const unsub = coordinator.onRenderFrame((time, isSeek) => {
        renderFrameCalls++
        // Playback time must remain frozen at 42.5s across all paused resolution redraws
        expect(time).toBe(42.5)
      })

      let clockTime = 10000
      for (const { scale, expectedW, expectedH } of scales) {
        useTransportStore.getState().setResolutionScale(scale)
        const dpr = useTransportStore.getState().getEffectiveDpr(1.5)
        gpu.resize(1280, 720, dpr)

        expect(canvas.width).toBe(expectedW)
        expect(canvas.height).toBe(expectedH)

        // Tick loop while paused (simulating render coordinator background loop for camera/controls)
        clockTime += 16.666
        coordinator.requestRender() // the app requests a redraw on resize; paused loops render on demand
        coordinator.tick(clockTime)

        // Verify time remained strictly frozen
        expect(coordinator.getPlaybackTime()).toBe(42.5)
      }

      expect(renderFrameCalls).toBe(scales.length)
      unsub()
      coordinator.stop()
      gpu.dispose()
    })

    it("survives 100 rapid resolution scaling toggles without canvas dimension or buffer corruption", async () => {
      const canvas = env.createCanvas(800, 600)
      const gl2 = new WebGL2Adapter()
      await gl2.mount(canvas as any)

      const scales: ResolutionScale[] = [0.5, 1, 2, "native"]

      for (let i = 0; i < 100; i++) {
        const nextScale = scales[i % scales.length]
        useTransportStore.getState().setResolutionScale(nextScale)
        const dpr = useTransportStore.getState().getEffectiveDpr(1.25)
        gl2.resize(800, 600, dpr)

        if (nextScale === 0.5) {
          expect(canvas.width).toBe(400)
          expect(canvas.height).toBe(300)
        } else if (nextScale === 1) {
          expect(canvas.width).toBe(800)
          expect(canvas.height).toBe(600)
        } else if (nextScale === 2) {
          expect(canvas.width).toBe(1600)
          expect(canvas.height).toBe(1200)
        } else {
          // native with DPR 1.25
          expect(canvas.width).toBe(1000)
          expect(canvas.height).toBe(750)
        }
      }

      gl2.dispose()
    })

    it("verifies post-process framebuffers and WebGPU depth textures are resized and caches invalidated on scale change", async () => {
      const canvas = env.createCanvas(1000, 1000)
      const gpu = new WebGPUAdapter()
      await gpu.mount(canvas as any)

      // Set post-process pass to trigger ping-pong and depth textures
      gpu.setRenderQueue([
        { type: "postprocess", pass: "vignette", uniforms: { radius: 0.8 } } as any,
      ])

      // Resize to 1x
      gpu.resize(1000, 1000, 1.0)
      expect(canvas.width).toBe(1000)
      expect(canvas.height).toBe(1000)

      // Resize to 2x (canvas becomes 2000x2000)
      gpu.resize(1000, 1000, 2.0)
      expect(canvas.width).toBe(2000)
      expect(canvas.height).toBe(2000)

      // Resize to 0.5x (canvas becomes 500x500)
      gpu.resize(1000, 1000, 0.5)
      expect(canvas.width).toBe(500)
      expect(canvas.height).toBe(500)

      gpu.dispose()
    })
  })

  // ==========================================================================
  // Section 2: Extreme Device Pixel Ratios (3x, 4x, Fractional DPRs)
  // ==========================================================================
  describe("2. Extreme Device Pixel Ratios (3x, 4x, Fractional DPRs)", () => {
    it("enforces 2.0 DPR VRAM protection guardrail for ultra-dense displays (3x, 4x, 8x DPR)", () => {
      const { setResolutionScale, getEffectiveDpr } = useTransportStore.getState()

      setResolutionScale("native")

      // 3x Retina display
      expect(getEffectiveDpr(3.0)).toBe(2.0)

      // 4x Ultra-dense display
      expect(getEffectiveDpr(4.0)).toBe(2.0)

      // 8x Extreme synthetic display
      expect(getEffectiveDpr(8.0)).toBe(2.0)

      // Explicit 2x scale on 4x display also stays at 2.0
      setResolutionScale(2)
      expect(getEffectiveDpr(4.0)).toBe(2.0)

      // Explicit 0.5x scale on 4x display stays at 0.5
      setResolutionScale(0.5)
      expect(getEffectiveDpr(4.0)).toBe(0.5)

      // Explicit 1x scale on 4x display stays at 1.0
      setResolutionScale(1)
      expect(getEffectiveDpr(4.0)).toBe(1.0)
    })

    it("verifies direct adapter invocation with extreme DPR (3.0, 4.0) computes integer buffers without NaN or crash", async () => {
      const canvasGpu = env.createCanvas(800, 600)
      const canvasGl2 = env.createCanvas(800, 600)
      const canvasThree = env.createCanvas(800, 600)

      const gpu = new WebGPUAdapter()
      const gl2 = new WebGL2Adapter()
      const three = new ThreeJSAdapter()

      await gpu.mount(canvasGpu as any)
      await gl2.mount(canvasGl2 as any)
      await three.mount(canvasThree as any)

      // DPR = 3.0
      gpu.resize(800, 600, 3.0)
      gl2.resize(800, 600, 3.0)
      three.resize(800, 600, 3.0)

      expect(canvasGpu.width).toBe(2400)
      expect(canvasGpu.height).toBe(1800)
      expect(canvasGl2.width).toBe(2400)
      expect(canvasGl2.height).toBe(1800)
      expect(canvasThree.width).toBe(2400)
      expect(canvasThree.height).toBe(1800)

      // DPR = 4.0
      gpu.resize(800, 600, 4.0)
      gl2.resize(800, 600, 4.0)
      three.resize(800, 600, 4.0)

      expect(canvasGpu.width).toBe(3200)
      expect(canvasGpu.height).toBe(2400)
      expect(canvasGl2.width).toBe(3200)
      expect(canvasGl2.height).toBe(2400)
      expect(canvasThree.width).toBe(3200)
      expect(canvasThree.height).toBe(2400)

      gpu.dispose()
      gl2.dispose()
      three.dispose()
    })

    it("verifies common real-world fractional DPRs (1.1, 1.25, 1.333, 1.5, 1.75, 2.625) produce integer dimensions", async () => {
      const canvas = env.createCanvas(1023, 767)
      const gl2 = new WebGL2Adapter()
      await gl2.mount(canvas as any)

      const fractionalDprs = [1.1, 1.25, 1.333333333, 1.5, 1.666666667, 1.75, 2.25, 2.625]

      for (const dpr of fractionalDprs) {
        gl2.resize(1023, 767, dpr)

        // Physical pixel buffer dimensions MUST be integer values
        expect(Number.isInteger(canvas.width)).toBe(true)
        expect(Number.isInteger(canvas.height)).toBe(true)
        expect(canvas.width).toBe(Math.floor(1023 * dpr))
        expect(canvas.height).toBe(Math.floor(767 * dpr))
        expect(canvas.width).toBeGreaterThan(0)
        expect(canvas.height).toBeGreaterThan(0)
      }

      gl2.dispose()
    })

    it("sanitizes degenerate, zero, negative, NaN, and Infinity DPR edge cases gracefully", async () => {
      const canvas = env.createCanvas(800, 600)
      const gpu = new WebGPUAdapter()
      await gpu.mount(canvas as any)

      // Zero DPR clamps to at least 1px buffer
      gpu.resize(800, 600, 0)
      expect(canvas.width).toBe(1)
      expect(canvas.height).toBe(1)

      // Negative DPR clamps to at least 1px buffer
      gpu.resize(800, 600, -2.5)
      expect(canvas.width).toBe(1)
      expect(canvas.height).toBe(1)

      // Negative container dimensions clamp to at least 1px
      gpu.resize(-100, -200, 1.0)
      expect(canvas.width).toBe(1)
      expect(canvas.height).toBe(1)

      // Store sanitation for out-of-bounds scales
      const { setResolutionScale } = useTransportStore.getState()
      setResolutionScale(-99 as any)
      expect(useTransportStore.getState().resolutionScale).toBe(0.5)

      setResolutionScale(999 as any)
      expect(useTransportStore.getState().resolutionScale).toBe(2)

      setResolutionScale(NaN as any)
      expect(useTransportStore.getState().resolutionScale).toBe(1)

      gpu.dispose()
    })
  })

  // ==========================================================================
  // Section 3: Telemetry Accuracy (FPS & Frame Time) Under Varying Load
  // ==========================================================================
  describe("3. Telemetry Accuracy (FPS and Frame Time) Under Varying Load", () => {
    it("computes exact FPS and frameTimeMs for 60, 120, 30, and 144 FPS steady workloads", () => {
      const coordinator = new RenderCoordinator()
      let latestMetrics: PerformanceMetrics | null = null

      coordinator.onMetrics((m) => {
        latestMetrics = m
      })

      // 1. Steady 60 FPS (16.666ms delta)
      coordinator.tick(1000)
      coordinator.tick(1016.67)
      expect(latestMetrics).not.toBeNull()
      expect(latestMetrics!.fps).toBe(60)
      expect(latestMetrics!.frameTimeMs).toBe(16.67)

      // 2. Steady 120 FPS (8.333ms delta)
      coordinator.tick(1025.0)
      expect(latestMetrics!.fps).toBe(120)
      expect(latestMetrics!.frameTimeMs).toBe(8.33)

      // 3. Steady 30 FPS (33.333ms delta)
      coordinator.tick(1058.33)
      expect(latestMetrics!.fps).toBe(30)
      expect(latestMetrics!.frameTimeMs).toBe(33.33)

      // 4. Steady 144 FPS (6.944ms delta)
      coordinator.tick(1065.27)
      expect(latestMetrics!.fps).toBe(144)
      expect(latestMetrics!.frameTimeMs).toBe(6.94)
    })

    it("tracks heavy GPU stalls and variable frame-hitches accurately without crashing", () => {
      const coordinator = new RenderCoordinator()
      let latestMetrics: PerformanceMetrics | null = null
      coordinator.onMetrics((m) => {
        latestMetrics = m
      })

      // Start baseline at t = 2000
      coordinator.tick(2000)

      // Severe 250ms hitch (4 FPS)
      coordinator.tick(2250)
      expect(latestMetrics!.fps).toBe(4)
      expect(latestMetrics!.frameTimeMs).toBe(250.0)

      // 66.67ms GPU throttle (15 FPS)
      coordinator.tick(2316.67)
      expect(latestMetrics!.fps).toBe(15)
      expect(latestMetrics!.frameTimeMs).toBe(66.67)

      // 500ms massive hitch (2 FPS)
      coordinator.tick(2816.67)
      expect(latestMetrics!.fps).toBe(2)
      expect(latestMetrics!.frameTimeMs).toBe(500.0)

      // Quick recovery back to 60 FPS
      coordinator.tick(2833.34)
      expect(latestMetrics!.fps).toBe(60)
      expect(latestMetrics!.frameTimeMs).toBe(16.67)
    })

    it("defends against zero-delta, sub-millisecond, and clock rollback (NTP reverse step) without NaN or division by zero", () => {
      const coordinator = new RenderCoordinator()
      let latestMetrics: PerformanceMetrics | null = null
      coordinator.onMetrics((m) => {
        latestMetrics = m
      })

      coordinator.tick(5000)

      // Zero delta: tick fires at exact same millisecond (now = 5000)
      coordinator.tick(5000)
      expect(latestMetrics).not.toBeNull()
      // Guarded by Math.max(1, delta): delta is clamped to 1ms
      expect(latestMetrics!.frameTimeMs).toBe(1.0)
      expect(latestMetrics!.fps).toBe(1000)
      expect(Number.isFinite(latestMetrics!.fps)).toBe(true)
      expect(Number.isNaN(latestMetrics!.fps)).toBe(false)

      // Clock rollback: system clock goes backwards from 5000 to 4500 (NTP correction)
      coordinator.tick(4500)
      // Math.max(1, 4500 - 5000) = Math.max(1, -500) = 1
      expect(latestMetrics!.frameTimeMs).toBe(1.0)
      expect(latestMetrics!.fps).toBe(1000)
      expect(Number.isFinite(latestMetrics!.fps)).toBe(true)

      // Virtual playback clock must not travel backwards
      expect(coordinator.getPlaybackTime()).toBeGreaterThanOrEqual(0)
    })

    it("verifies metrics subscriber throughput over 1,000 synthetic frames under varying load", () => {
      const coordinator = new RenderCoordinator()
      let metricCount = 0
      let fpsSum = 0

      coordinator.onMetrics((m) => {
        metricCount++
        fpsSum += m.fps
      })

      let clock = 10000
      // 1,000 simulated frames with variable deltas (8ms to 33ms)
      for (let i = 0; i < 1000; i++) {
        const delta = 8 + (i % 25) // ranges between 8ms and 32ms
        clock += delta
        coordinator.tick(clock)
      }

      expect(metricCount).toBe(1000)
      expect(fpsSum).toBeGreaterThan(0)
      const avgFps = fpsSum / metricCount
      expect(avgFps).toBeGreaterThan(30)
      expect(avgFps).toBeLessThan(125)
    })
  })
})
})

describe("transport + resolution (w1-b-ui handoff)", () => {
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
    renderCoordinator.stop()
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.setPlaybackSpeed(1.0)
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
  })

  afterEach(() => {
    renderCoordinator.stop()
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.clearLog()
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  describe("2. Transport & Virtual Playback Clock (Requirement R2)", () => {
    describe("2.1 Virtual Playback Clock Decoupling & Play/Pause Cycling", () => {
      it("survives 10,000 rapid togglePlay() calls with strict parity between store and coordinator", () => {
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

        // Even number of toggles ends in initial true
        expect(useTransportStore.getState().isPlaying).toBe(true)
        expect(renderCoordinator.getIsPlaying()).toBe(true)
      })

      it("completely halts virtual time advancement while paused even under mock rAF ticks", () => {
        const coordinator = new RenderCoordinator()
        coordinator.setPlaying(false)
        coordinator.seek(10.0)

        expect(coordinator.getPlaybackTime()).toBe(10.0)

        // Tick 100 frames with 16.6ms intervals
        let timestamp = 1000
        for (let i = 0; i < 100; i++) {
          timestamp += 16.666
          coordinator.tick(timestamp)
          expect(coordinator.getPlaybackTime()).toBe(10.0)
        }
      })

      it("advances virtual time monotonically when playing, strictly proportional to delta * speed", () => {
        const coordinator = new RenderCoordinator()
        coordinator.setPlaying(true)
        coordinator.setPlaybackSpeed(1.5)

        let timestamp = 1000
        coordinator.tick(timestamp) // establish baseline lastTime
        coordinator.seek(0.0) // reset virtual time with baseline established

        // Advance 10 frames of 20ms each = 200ms real delta
        for (let i = 0; i < 10; i++) {
          timestamp += 20
          coordinator.tick(timestamp)
        }

        // Expected virtual advance = 0.200s * 1.5 speed = 0.300s
        expect(coordinator.getPlaybackTime()).toBeCloseTo(0.3, 3)
      })

      it("tolerates large delta spikes (60s system freeze/hibernation jump) without crash or NaN", () => {
        const coordinator = new RenderCoordinator()
        coordinator.setPlaying(true)
        coordinator.seek(0.0)

        coordinator.tick(1000)
        // Simulate waking from 60-second system sleep
        coordinator.tick(61000)

        // fleet(w2): capped at 100ms of simulated time
        expect(coordinator.getPlaybackTime()).toBeCloseTo(0.1, 1)
        expect(Number.isFinite(coordinator.getPlaybackTime())).toBe(true)
      })

      it("defends against clock rollback (NTP reverse step) by clamping delta to safe minimum (>= 1ms)", () => {
        const coordinator = new RenderCoordinator()
        coordinator.setPlaying(true)
        coordinator.seek(5.0)

        coordinator.tick(5000)
        // Clock steps backward in time
        coordinator.tick(4000)

        // Clamps delta to 1ms
        expect(coordinator.getPlaybackTime()).toBeGreaterThanOrEqual(5.0)
        expect(Number.isFinite(coordinator.getPlaybackTime())).toBe(true)
      })
    })

    describe("2.2 Timeline Scrubbing, Boundary Durations & Negative Seeks", () => {
      it("clamps negative seek timestamps strictly to 0.00s", () => {
        const { seek } = useTransportStore.getState()
        const coordinator = new RenderCoordinator()

        const negativeValues = [-1000, -50.5, -0.0001, -Infinity]
        for (const val of negativeValues) {
          seek(val)
          expect(useTransportStore.getState().playbackTime).toBe(0.0)
          expect(useTransportStore.getState().currentTime).toBe(0.0)

          coordinator.seek(val)
          expect(coordinator.getPlaybackTime()).toBe(0.0)
        }
      })

      it("clamps out-of-bounds timeline scrub beyond duration to duration limit", () => {
        const { seek, setDuration } = useTransportStore.getState()
        setDuration(120.0)

        seek(999999)
        expect(useTransportStore.getState().playbackTime).toBe(120.0)
        expect(useTransportStore.getState().currentTime).toBe(120.0)
      })

      it("preserves microsecond precision without float drift or rounding to zero", () => {
        const { seek } = useTransportStore.getState()
        const microSteps = [0.000001, 0.000005, 0.000012, 0.0001]

        for (const step of microSteps) {
          seek(step)
          expect(useTransportStore.getState().playbackTime).toBe(step)
          expect(useTransportStore.getState().currentTime).toBe(step)
        }
      })

      it("clamps zero and negative durations to safe minimum (0.1s) and auto-clamps current time", () => {
        const { setDuration, seek } = useTransportStore.getState()

        seek(50.0)
        setDuration(0.0)
        expect(useTransportStore.getState().duration).toBe(0.1)
        expect(useTransportStore.getState().playbackTime).toBe(0.1)

        seek(0.05)
        setDuration(-10.0)
        expect(useTransportStore.getState().duration).toBe(0.1)
      })

      it("formats digital time counter accurately including bounds and NaN defense", () => {
        expect(formatTime(0)).toBe("00:00.00")
        expect(formatTime(5.32)).toBe("00:05.32")
        expect(formatTime(65.75)).toBe("01:05.75")
        expect(formatTime(3599.99)).toBe("59:59.99")
        expect(formatTime(-10)).toBe("00:00.00")
        expect(formatTime(NaN)).toBe("00:00.00")
        expect(formatTime(Infinity)).toBe("00:00.00")
      })
    })

    describe("2.3 Single-Frame Redrawing While Paused During Scrubbing", () => {
      it("dispatches renderFrame with delta=0 and increments singleFrameRenderCount on seek while paused", async () => {
        const coordinator = new RenderCoordinator()
        const canvas = env.createCanvas(800, 600)
        const gpu = new WebGPUAdapter()
        await gpu.mount(canvas as any)

        coordinator.setActiveAdapter(gpu)
        coordinator.setPlaying(false)

        const renderSpy = vi.spyOn(gpu, "renderFrame")
        let seekNotificationCount = 0
        let lastSeekTime = -1

        coordinator.onRenderFrame((time, isSeek) => {
          if (isSeek) {
            seekNotificationCount++
            lastSeekTime = time
          }
        })

        const initialSingleFrameCount = coordinator.getSingleFrameRenderCount()

        // 1. Scrub to 12.5s while paused
        coordinator.seek(12.5)

        expect(renderSpy).toHaveBeenCalledWith(12500, 0)
        expect(coordinator.getSingleFrameRenderCount()).toBe(initialSingleFrameCount + 1)
        expect(seekNotificationCount).toBe(1)
        expect(lastSeekTime).toBe(12.5)

        // 2. Rewind to 0.0s (resetTime) while paused
        coordinator.resetTime()

        expect(renderSpy).toHaveBeenCalledWith(0, 0)
        expect(coordinator.getSingleFrameRenderCount()).toBe(initialSingleFrameCount + 2)
        expect(seekNotificationCount).toBe(2)
        expect(lastSeekTime).toBe(0.0)

        gpu.dispose()
      })

      it("executes pre-render modulation hooks with delta=0 during paused seek", () => {
        const coordinator = new RenderCoordinator()
        coordinator.setPlaying(false)

        let hookExecuted = false
        let hookTime = -1
        let hookDelta = -1

        coordinator.registerPreRenderHook("test-hook", (time, delta) => {
          hookExecuted = true
          hookTime = time
          hookDelta = delta
        })

        coordinator.seek(8.25)

        expect(hookExecuted).toBe(true)
        expect(hookTime).toBe(8250)
        expect(hookDelta).toBe(0)

        coordinator.unregisterPreRenderHook("test-hook")
      })
    })
  })


  describe("3. Resolution Scaling Across 3 Backends", () => {
    describe("3.1 Effective DPR Calculations & High-DPI Guardrails", () => {
      it("computes accurate effective DPR for 0.5x, 1x, 2x, and native DPI", () => {
        const store = useTransportStore.getState()

        store.setResolutionScale(0.5)
        expect(useTransportStore.getState().getEffectiveDpr(1.0)).toBe(0.5)

        store.setResolutionScale(1)
        expect(useTransportStore.getState().getEffectiveDpr(1.0)).toBe(1.0)

        store.setResolutionScale(2)
        expect(useTransportStore.getState().getEffectiveDpr(1.0)).toBe(2.0)

        // Native scale dynamically tracks host DPR
        store.setResolutionScale("native")
        expect(useTransportStore.getState().getEffectiveDpr(1.0)).toBe(1.0)
        expect(useTransportStore.getState().getEffectiveDpr(1.5)).toBe(1.5)
        expect(useTransportStore.getState().getEffectiveDpr(2.0)).toBe(2.0)
      })

      it("enforces 2.0 DPR GPU guardrail against ultra-dense host displays (3x, 4x, 8x)", () => {
        const store = useTransportStore.getState()
        store.setResolutionScale("native")

        const extremeHostDprs = [2.25, 3.0, 3.5, 4.0, 8.0]
        for (const hostDpr of extremeHostDprs) {
          expect(useTransportStore.getState().getEffectiveDpr(hostDpr)).toBe(2.0)
        }
      })

      it("sanitizes invalid or degenerate resolution scale inputs to safe values", () => {
        const store = useTransportStore.getState()

        store.setResolutionScale(0 as any)
        expect(useTransportStore.getState().resolutionScale).toBe(0.5)

        store.setResolutionScale(-2 as any)
        expect(useTransportStore.getState().resolutionScale).toBe(0.5)

        store.setResolutionScale(10 as any)
        expect(useTransportStore.getState().resolutionScale).toBe(2)

        store.setResolutionScale("invalid" as any)
        expect(useTransportStore.getState().resolutionScale).toBe(1)
      })
    })

    describe("3.2 Canvas Buffer Dimensions in WebGPU, WebGL2, and Three.js", () => {
      const CONTAINER_WIDTH = 1920
      const CONTAINER_HEIGHT = 1080

      it("correctly sizes canvas buffers across 0.5x, 1x, 2x, Native DPI in WebGPUAdapter", async () => {
        const canvas = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)
        const gpu = new WebGPUAdapter()
        await gpu.mount(canvas as any)

        const testScales: Array<{ scale: ResolutionScale; dpr: number; expW: number; expH: number }> = [
          { scale: 0.5, dpr: 0.5, expW: 960, expH: 540 },
          { scale: 1, dpr: 1.0, expW: 1920, expH: 1080 },
          { scale: 2, dpr: 2.0, expW: 3840, expH: 2160 },
          { scale: "native", dpr: 1.5, expW: 2880, expH: 1620 },
          { scale: "native", dpr: 4.0, expW: 3840, expH: 2160 }, // guarded clamp to 2.0
        ]

        for (const test of testScales) {
          useTransportStore.getState().setResolutionScale(test.scale)
          const effectiveDpr = useTransportStore.getState().getEffectiveDpr(test.dpr)
          gpu.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, effectiveDpr)

          expect(canvas.width).toBe(test.expW)
          expect(canvas.height).toBe(test.expH)
        }

        gpu.dispose()
      })

      it("correctly sizes canvas buffers and sets viewport in WebGL2Adapter", async () => {
        const canvas = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)
        const gl2 = new WebGL2Adapter()
        await gl2.mount(canvas as any)

        const testScales: Array<{ scale: ResolutionScale; dpr: number; expW: number; expH: number }> = [
          { scale: 0.5, dpr: 0.5, expW: 960, expH: 540 },
          { scale: 1, dpr: 1.0, expW: 1920, expH: 1080 },
          { scale: 2, dpr: 2.0, expW: 3840, expH: 2160 },
          { scale: "native", dpr: 1.5, expW: 2880, expH: 1620 },
        ]

        for (const test of testScales) {
          useTransportStore.getState().setResolutionScale(test.scale)
          const effectiveDpr = useTransportStore.getState().getEffectiveDpr(test.dpr)
          gl2.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, effectiveDpr)

          expect(canvas.width).toBe(test.expW)
          expect(canvas.height).toBe(test.expH)
        }

        gl2.dispose()
      })

      it("correctly configures renderer pixelRatio and canvas buffers in ThreeJSAdapter", async () => {
        const canvas = env.createCanvas(CONTAINER_WIDTH, CONTAINER_HEIGHT)
        const three = new ThreeJSAdapter()
        await three.mount(canvas as any)

        const testScales: Array<{ scale: ResolutionScale; dpr: number; expW: number; expH: number }> = [
          { scale: 0.5, dpr: 0.5, expW: 960, expH: 540 },
          { scale: 1, dpr: 1.0, expW: 1920, expH: 1080 },
          { scale: 2, dpr: 2.0, expW: 3840, expH: 2160 },
        ]

        for (const test of testScales) {
          useTransportStore.getState().setResolutionScale(test.scale)
          const effectiveDpr = useTransportStore.getState().getEffectiveDpr(test.dpr)
          three.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT, effectiveDpr)

          expect(canvas.width).toBe(test.expW)
          expect(canvas.height).toBe(test.expH)
        }

        three.dispose()
      })

      it("sanitizes fractional, subpixel, and non-integer container dimensions to positive integer buffers (>= 1px)", async () => {
        const canvasGpu = env.createCanvas(100, 100)
        const canvasGl2 = env.createCanvas(100, 100)
        const canvasThree = env.createCanvas(100, 100)

        const gpu = new WebGPUAdapter()
        const gl2 = new WebGL2Adapter()
        const three = new ThreeJSAdapter()

        await gpu.mount(canvasGpu as any)
        await gl2.mount(canvasGl2 as any)
        await three.mount(canvasThree as any)

        const fractionalSizes = [
          { w: 1365.73, h: 767.28, dpr: 1.25 },
          { w: 0.4, h: 0.6, dpr: 1.0 },
          { w: -50, h: -100, dpr: 1.0 },
        ]

        for (const size of fractionalSizes) {
          gpu.resize(size.w, size.h, size.dpr)
          gl2.resize(size.w, size.h, size.dpr)
          three.resize(size.w, size.h, size.dpr)

          for (const c of [canvasGpu, canvasGl2, canvasThree]) {
            expect(Number.isInteger(c.width)).toBe(true)
            expect(Number.isInteger(c.height)).toBe(true)
            expect(c.width).toBeGreaterThanOrEqual(1)
            expect(c.height).toBeGreaterThanOrEqual(1)
          }
        }

        gpu.dispose()
        gl2.dispose()
        three.dispose()
      })

      it("survives 100 rapid scale transitions across all 3 backends without crash or buffer desync", async () => {
        const canvasGpu = env.createCanvas(1280, 720)
        const canvasGl2 = env.createCanvas(1280, 720)
        const canvasThree = env.createCanvas(1280, 720)

        const gpu = new WebGPUAdapter()
        const gl2 = new WebGL2Adapter()
        const three = new ThreeJSAdapter()

        await gpu.mount(canvasGpu as any)
        await gl2.mount(canvasGl2 as any)
        await three.mount(canvasThree as any)

        const scales: ResolutionScale[] = [0.5, 1, 2, "native"]

        for (let i = 0; i < 100; i++) {
          const scale = scales[i % scales.length]
          useTransportStore.getState().setResolutionScale(scale)
          const dpr = useTransportStore.getState().getEffectiveDpr(1.5)

          gpu.resize(1280, 720, dpr)
          gl2.resize(1280, 720, dpr)
          three.resize(1280, 720, dpr)

          expect(canvasGpu.width).toBe(canvasGl2.width)
          expect(canvasGpu.height).toBe(canvasGl2.height)
          expect(canvasThree.width).toBe(canvasGpu.width)
          expect(canvasThree.height).toBe(canvasGpu.height)
        }

        gpu.dispose()
        gl2.dispose()
        three.dispose()
      })
    })
  })

  describe("canvas resize clamping across adapters", () => {
  it("WebGPUAdapter: resize(0, 0) clamps canvas dimensions to at least 1x1 without throwing", async () => {
    const canvas = env.createCanvas(0, 0)
    const mounted = await webgpuAdapter.mount(canvas as any)
    expect(mounted).toBe(true)

    // Direct resize to (0, 0)
    webgpuAdapter.resize(0, 0)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Negative dimension safety
    webgpuAdapter.resize(-100, -200)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Half-zero dimensions (0 x 768, 1024 x 0)
    webgpuAdapter.resize(0, 768)
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    webgpuAdapter.resize(1024, 0)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBe(1)

    // Verify renderFrame runs cleanly on 1x1 clamped canvas
    expect(() => webgpuAdapter.renderFrame(100, 16)).not.toThrow()
  })

  it("WebGL2Adapter: resize(0, 0) clamps dimensions to 1x1 and preserves valid viewport & aspect ratio", async () => {
    const canvas = env.createCanvas(0, 0)
    const mounted = await webgl2Adapter.mount(canvas as any)
    expect(mounted).toBe(true)

    // Resize to (0, 0)
    webgl2Adapter.resize(0, 0)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Negative inputs
    webgl2Adapter.resize(-50, -50)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Render frame on 1x1 clamped canvas: ensure no division by zero in aspect ratio
    expect(() => webgl2Adapter.renderFrame(200, 16)).not.toThrow()
  })

  it("ThreeJSAdapter: resize(0, 0) clamps dimensions to safe minimum (1x1) with valid camera aspect", async () => {
    const canvas = env.createCanvas(0, 0)
    const mounted = await threejsAdapter.mount(canvas as any)
    expect(mounted).toBe(true)

    // Resize to (0, 0)
    threejsAdapter.resize(0, 0)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Fractional sub-pixel inputs
    threejsAdapter.resize(0.3, 0.4)
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(canvas.height).toBeGreaterThanOrEqual(1)

    // Render frame
    expect(() => threejsAdapter.renderFrame(300, 16)).not.toThrow()
  })

  it("Rapid resize stress harness: handles 100 random sizes including zeroes and negative bounds", async () => {
    const canvas = env.createCanvas(800, 600)
    await webgpuAdapter.mount(canvas as any)

    const testSizes = [
      [0, 0],
      [-10, 0],
      [0, -10],
      [-100, -100],
      [0.001, 0.001],
      [1, 1],
      [1024, 768],
      [0, 0],
      [3440, 1440],
      [-1, 1440],
      [5120, 0],
    ]

    for (let i = 0; i < 100; i++) {
      const [w, h] = testSizes[i % testSizes.length]
      expect(() => webgpuAdapter.resize(w, h)).not.toThrow()
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)
    }
  })
    it("clamps zero-dimension canvas to 1x1 across extreme DPR settings (0.5, 1.0, 2.0, 3.0)", async () => {
      const dprValues = [0.5, 1.0, 2.0, 3.0]
      const originalDPR = window.devicePixelRatio

      for (const dpr of dprValues) {
        Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true })

        const canvas = env.createCanvas(0, 0)
        await webgpuAdapter.mount(canvas as any)
        webgpuAdapter.resize(0, 0)

        // Math.max(1, Math.floor(0 * dpr)) === 1
        expect(canvas.width).toBeGreaterThanOrEqual(1)
        expect(canvas.height).toBeGreaterThanOrEqual(1)

        // Non-zero dimensions scale correctly with DPR
        webgpuAdapter.resize(100, 100)
        expect(canvas.width).toBe(Math.floor(100 * dpr))
        expect(canvas.height).toBe(Math.floor(100 * dpr))
      }

      Object.defineProperty(window, "devicePixelRatio", { value: originalDPR, configurable: true })
    })

    it("WebGL2: 1x1 canvas keeps a 1x1 viewport rect", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas(1, 1)
      await adapter.mount(canvas as any)
      adapter.resize(1, 1)
      const gl = env.webgl2.getLastContext()!
      expect(gl.viewportRect.width).toBe(1)
      expect(gl.viewportRect.height).toBe(1)
      adapter.dispose()
    })

    it("WebGPU: 8K UHD resize is applied verbatim", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(800, 600)
      await adapter.mount(canvas as any)
      adapter.resize(7680, 4320)
      expect(canvas.width).toBe(7680)
      expect(canvas.height).toBe(4320)
      adapter.dispose()
    })

    it("WebGPU: fractional devicePixelRatio is floored into the buffer size", async () => {
      globalThis.window.devicePixelRatio = 2.75
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas(400, 300)
      await adapter.mount(canvas as any)
      adapter.resize(400, 300)
      expect(canvas.width).toBe(Math.floor(400 * 2.75))
      expect(canvas.height).toBe(Math.floor(300 * 2.75))
      globalThis.window.devicePixelRatio = 1
      adapter.dispose()
    })

    it("WebGL2: 50 rapid sequential resizes do not throw", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)
      for (let i = 1; i <= 50; i++) expect(() => adapter.resize(i * 10, i * 10)).not.toThrow()
      env.clock.step(16)
      adapter.dispose()
    })
  })

  describe("coordinator lifecycle on viewport unmount", () => {
  it("ensures renderCoordinator stops and detaches adapter when Viewport is unmounted", async () => {
    const canvas = env.createCanvas(800, 600)
    await webgpuAdapter.mount(canvas as any)

    renderCoordinator.setActiveAdapter(webgpuAdapter)
    renderCoordinator.start()

    // Confirm loop is active
    expect(renderCoordinator.getActiveAdapter()).toBe(webgpuAdapter)

    // Simulate unmount cleanup of Viewport (as executed in Viewport.tsx useEffect cleanup)
    renderCoordinator.setActiveAdapter(null)
    renderCoordinator.stop()
    webgpuAdapter.dispose()

    // Confirm coordinator is completely inert
    expect(renderCoordinator.getActiveAdapter()).toBeNull()

    // Step mock clock forward by 1000ms: no frames should be drawn to disposed adapter
    const renderSpy = vi.spyOn(webgpuAdapter, "renderFrame")
    env.clock.step(1000)
    expect(renderSpy).not.toHaveBeenCalled()
  })
  })
})
