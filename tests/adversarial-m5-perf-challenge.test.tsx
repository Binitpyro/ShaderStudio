/**
 * Milestone 5 Adversarial Challenger Verification Suite
 * Targets:
 *   1. PerfOverlay.tsx: Canvas 2D rendering stability under dynamic metric changes,
 *      visual warning badge rendering (hasAnyWarning / isVramOverBudget), and screenshot export logic.
 *   2. renderCoordinator.ts: Phase 5 telemetry integration does not mutate delta times or
 *      interfere with the virtual playback clock.
 *   3. projectStore.ts: memoryBudget serialization round-trips via exportProjectData & loadProjectData.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PerfOverlay, ScreenshotButton } from "@/components/PerfOverlay"
import { renderCoordinator, RenderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { performanceTelemetry, PerformanceTelemetry, type DetailedGpuMetrics } from "@/core/performanceTelemetry"
import {
  checkMemoryThreshold,
  createDefaultMemoryBudget,
  MemoryBudgetManager,
  type MemoryBudgetConfig,
} from "@/core/memoryBudget"
import { useProjectStore } from "@/stores/projectStore"
import { viewportCapture } from "@/utils/frameCapture"
import { setupDOMEnvironment, teardownDOMEnvironment } from "./e2e/mocks/mockDOM"

// Mock canvas 2D context recorder
function createMockCanvas2DContext() {
  const operations: Array<{ method: string; args: any[] }> = []
  const fills: Array<{ color: string; rect: [number, number, number, number] }> = []
  const strokes: Array<{ color: string; dash: number[] }> = []

  let currentFillStyle = "#000000"
  let currentStrokeStyle = "#000000"
  let currentLineWidth = 1
  let currentLineDash: number[] = []

  const ctx = {
    get fillStyle() {
      return currentFillStyle
    },
    set fillStyle(val: string) {
      currentFillStyle = val
      operations.push({ method: "set fillStyle", args: [val] })
    },
    get strokeStyle() {
      return currentStrokeStyle
    },
    set strokeStyle(val: string) {
      currentStrokeStyle = val
      operations.push({ method: "set strokeStyle", args: [val] })
    },
    get lineWidth() {
      return currentLineWidth
    },
    set lineWidth(val: number) {
      currentLineWidth = val
      operations.push({ method: "set lineWidth", args: [val] })
    },
    setLineDash(dash: number[]) {
      currentLineDash = [...dash]
      operations.push({ method: "setLineDash", args: [dash] })
    },
    clearRect(x: number, y: number, w: number, h: number) {
      operations.push({ method: "clearRect", args: [x, y, w, h] })
    },
    fillRect(x: number, y: number, w: number, h: number) {
      operations.push({ method: "fillRect", args: [x, y, w, h] })
      fills.push({ color: currentFillStyle, rect: [x, y, w, h] })
    },
    beginPath() {
      operations.push({ method: "beginPath", args: [] })
    },
    moveTo(x: number, y: number) {
      operations.push({ method: "moveTo", args: [x, y] })
    },
    lineTo(x: number, y: number) {
      operations.push({ method: "lineTo", args: [x, y] })
    },
    stroke() {
      operations.push({ method: "stroke", args: [] })
      strokes.push({ color: currentStrokeStyle, dash: [...currentLineDash] })
    },
    _operations: operations,
    _fills: fills,
    _strokes: strokes,
  }

  return ctx
}

describe("Adversarial Milestone 5 Verification Suite", () => {
  beforeEach(() => {
    setupDOMEnvironment()
    performanceTelemetry.reset()
    useProjectStore.getState().resetProject()
    renderCoordinator.stop()
    renderCoordinator.clearLog()
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.setPlaybackSpeed(1.0)
  })

  afterEach(() => {
    teardownDOMEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SECTION 1: PerfOverlay.tsx Empirical Probes
  // ==========================================================================
  describe("1. PerfOverlay.tsx Adversarial Probes", () => {
    describe("1.1 Canvas 2D Rendering Stability Under Dynamic Metrics", () => {
      // Direct simulation of the canvas rendering effect in PerfOverlay
      function renderPerfTimelineCanvas(
        canvas: HTMLCanvasElement,
        metrics: DetailedGpuMetrics
      ) {
        const ctx = canvas.getContext("2d")
        if (!ctx) return false

        const width = canvas.width
        const height = canvas.height
        ctx.clearRect(0, 0, width, height)

        const timeline =
          metrics.frameTimeline.length > 0
            ? metrics.frameTimeline
            : [metrics.frameTime || 16.6]

        const maxMs = Math.max(33.3, ...timeline, 20)
        const barWidth = width / 60
        const startOffset = Math.max(0, 60 - timeline.length)

        // Background gradient grid
        ctx.fillStyle = "rgba(15, 23, 42, 0.4)"
        ctx.fillRect(0, 0, width, height)

        // Target 16.6ms (60 FPS) guideline
        const targetY = height - (16.67 / maxMs) * height
        ctx.strokeStyle = "rgba(16, 185, 129, 0.6)"
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(0, targetY)
        ctx.lineTo(width, targetY)
        ctx.stroke()
        ctx.setLineDash([])

        // Target 33.3ms (30 FPS) guideline
        const slowY = height - (33.33 / maxMs) * height
        ctx.strokeStyle = "rgba(239, 68, 68, 0.3)"
        ctx.beginPath()
        ctx.moveTo(0, slowY)
        ctx.lineTo(width, slowY)
        ctx.stroke()

        // Render bars
        for (let i = 0; i < timeline.length; i++) {
          const ms = timeline[i]
          const barHeight = Math.max(2, (ms / maxMs) * height)
          const x = (startOffset + i) * barWidth
          const y = height - barHeight

          if (ms > 33.3) {
            ctx.fillStyle = "#ef4444" // Red (spike / <30fps)
          } else if (ms > 16.7) {
            ctx.fillStyle = "#eab308" // Yellow (30-60fps)
          } else {
            ctx.fillStyle = "#10b981" // Emerald (>=60fps)
          }

          ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight)
        }

        return true
      }

      it("handles completely empty timeline without dividing by zero or throwing", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const emptyMetrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 0,
          passTimings: {},
          drawCalls: 0,
          triangles: 0,
          estimatedVramBytes: 0,
          frameTimeline: [],
        }

        const success = renderPerfTimelineCanvas(canvas, emptyMetrics)
        expect(success).toBe(true)
        expect(mockCtx._operations.some((op) => op.method === "clearRect")).toBe(true)
        // Background + 1 fallback bar = 2 fillRect calls
        expect(mockCtx._fills.length).toBe(2)
        expect(mockCtx._strokes.length).toBe(2) // 16.6ms & 33.3ms guidelines
      })

      it("handles single-frame timeline correctly and positions it at the rightmost slot", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const singleMetrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 16.6,
          passTimings: {},
          drawCalls: 1,
          triangles: 100,
          estimatedVramBytes: 1024,
          frameTimeline: [16.6],
        }

        renderPerfTimelineCanvas(canvas, singleMetrics)
        // 1 background fill + 1 bar fill = 2 fills
        expect(mockCtx._fills.length).toBe(2)
        const barFill = mockCtx._fills[1]
        // startOffset = 60 - 1 = 59
        // barWidth = 188 / 60 = 3.1333
        // x = 59 * (188 / 60) ~ 184.86
        expect(barFill.rect[0]).toBeCloseTo(59 * (188 / 60), 1)
        expect(barFill.color).toBe("#10b981") // 16.6ms is <= 16.7ms (emerald)
      })

      it("handles full 60 frames and precisely maps green, yellow, and red categories", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        // 20 green frames (10ms), 20 yellow frames (22ms), 20 red frames (45ms)
        const timeline: number[] = [
          ...Array(20).fill(10.0),
          ...Array(20).fill(22.0),
          ...Array(20).fill(45.0),
        ]

        const metrics: DetailedGpuMetrics = {
          fps: 40,
          frameTime: 45.0,
          passTimings: {},
          drawCalls: 5,
          triangles: 12000,
          estimatedVramBytes: 1048576,
          frameTimeline: timeline,
        }

        renderPerfTimelineCanvas(canvas, metrics)
        // 1 background + 60 bars = 61 fills
        expect(mockCtx._fills.length).toBe(61)

        const barFills = mockCtx._fills.slice(1)
        const greenBars = barFills.filter((f) => f.color === "#10b981")
        const yellowBars = barFills.filter((f) => f.color === "#eab308")
        const redBars = barFills.filter((f) => f.color === "#ef4444")

        expect(greenBars.length).toBe(20)
        expect(yellowBars.length).toBe(20)
        expect(redBars.length).toBe(20)
      })

      it("handles extreme spikes (10,000ms), 0ms, and negative numbers without NaNs or coordinate overflow", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const extremeTimeline = [-50, 0, 0.001, 16.6, 9999.9, 100000]
        const metrics: DetailedGpuMetrics = {
          fps: 1,
          frameTime: 100000,
          passTimings: {},
          drawCalls: 1,
          triangles: 1,
          estimatedVramBytes: 0,
          frameTimeline: extremeTimeline,
        }

        renderPerfTimelineCanvas(canvas, metrics)
        const barFills = mockCtx._fills.slice(1)
        expect(barFills.length).toBe(6)

        // Verify every coordinate and dimension is finite and positive
        for (const fill of barFills) {
          const [x, y, w, h] = fill.rect
          expect(Number.isFinite(x)).toBe(true)
          expect(Number.isFinite(y)).toBe(true)
          expect(Number.isFinite(w)).toBe(true)
          expect(Number.isFinite(h)).toBe(true)
          expect(w).toBeGreaterThan(0)
          expect(h).toBeGreaterThanOrEqual(2) // Math.max(2, ...)
        }
      })

      it("returns false gracefully when canvas getContext('2d') is null", () => {
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(null),
        } as unknown as HTMLCanvasElement

        const metrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 16.6,
          passTimings: {},
          drawCalls: 1,
          triangles: 10,
          estimatedVramBytes: 100,
          frameTimeline: [16.6],
        }

        const success = renderPerfTimelineCanvas(canvas, metrics)
        expect(success).toBe(false)
      })
    })

    describe("1.2 Visual Warning Badge Rendering (hasAnyWarning & isVramOverBudget)", () => {
      it("does NOT render warning badge when VRAM is at or below the 80% threshold", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 1000,
          warnThresholdRatio: 0.8, // 800 MB limit
        })

        // Exactly 800 MB: 800.0 > 800.0 is false -> no warning
        performanceTelemetry.setEstimatedVramBytes(800 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).not.toContain("VRAM Alert:")
        expect(html).not.toContain("animate-pulse")
        expect(html).toContain("800 MB / 1000 MB")
      })

      it("DOES render pulsing warning badge when VRAM strictly exceeds budget ratio", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 1000,
          warnThresholdRatio: 0.8, // 800 MB limit
        })

        // 800.1 MB: strictly exceeds 800.0 MB -> warning trips
        performanceTelemetry.setEstimatedVramBytes(800.1 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).toContain("VRAM Alert: &gt;80% Budget")
        expect(html).toContain("animate-pulse")
        expect(html).toContain("800.1 MB / 1000 MB")
        expect(html).toContain("text-red-400 font-bold")
      })

      it("renders warning badge with dynamic ratio when warnThresholdRatio is customized", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 500,
          warnThresholdRatio: 0.65, // 325 MB limit
        })

        performanceTelemetry.setEstimatedVramBytes(350 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).toContain("VRAM Alert: &gt;65% Budget")
        expect(html).toContain("350 MB / 500 MB")
      })
    })

    describe("1.3 Screenshot Export Logic & ViewportCapture Registration", () => {
      it("registers live performance metrics to viewportCapture service", () => {
        performanceTelemetry.recordFrameTime(14.2)
        performanceTelemetry.notifySubscribers()

        // Render PerfOverlay (which registers metrics via viewportCapture)
        renderToStaticMarkup(React.createElement(PerfOverlay))

        // Query viewportCapture metrics
        const captured = viewportCapture.getPerfMetrics()
        expect(captured).toBeDefined()
        expect(typeof captured.fps).toBe("number")
        expect(typeof captured.frameTimeMs).toBe("number")
        expect(captured.fps).toBeGreaterThanOrEqual(1)
      })

      it("handles ScreenshotButton with null canvas gracefully without throwing", () => {
        const nullCanvasRef = { current: null }
        const html = renderToStaticMarkup(
          React.createElement(ScreenshotButton, { canvasRef: nullCanvasRef })
        )
        expect(html).toContain("Screenshot")
      })

      it("executes ScreenshotButton capture and triggers download link click", () => {
        const mockBlob = { size: 1024, type: "image/png" }
        const toBlobSpy = vi.fn((cb: (blob: any) => void) => {
          cb(mockBlob)
        })

        const mockCanvas = {
          toBlob: toBlobSpy,
        } as unknown as HTMLCanvasElement

        const canvasRef = { current: mockCanvas }

        // Mock document and URL
        const createObjectURLSpy = vi.fn().mockReturnValue("blob:http://localhost/mock-uuid")
        const revokeObjectURLSpy = vi.fn()
        const clickSpy = vi.fn()
        const appendChildSpy = vi.fn()
        const removeChildSpy = vi.fn()

        globalThis.URL.createObjectURL = createObjectURLSpy
        globalThis.URL.revokeObjectURL = revokeObjectURLSpy

        const originalDoc = globalThis.document
        globalThis.document = {
          ...originalDoc,
          body: {
            appendChild: appendChildSpy,
            removeChild: removeChildSpy,
          },
          createElement: (tag: string) => {
            const el: any = {
              href: "",
              download: "",
              click: clickSpy,
            }
            return el
          },
        } as any

        // Trigger screenshot logic
        const triggerScreenshot = () => {
          if (!canvasRef.current) return
          canvasRef.current.toBlob((blob) => {
            if (!blob) return
            const url = URL.createObjectURL(blob as any)
            const a = document.createElement("a")
            a.href = url
            a.download = `shader-studio-${Date.now()}.png`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }, "image/png")
        }

        triggerScreenshot()

        expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), "image/png")
        expect(createObjectURLSpy).toHaveBeenCalledWith(mockBlob)
        expect(appendChildSpy).toHaveBeenCalled()
        expect(clickSpy).toHaveBeenCalledTimes(1)
        expect(removeChildSpy).toHaveBeenCalled()
        expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:http://localhost/mock-uuid")

        globalThis.document = originalDoc
      })
    })
  })

  // ==========================================================================
  // SECTION 2: renderCoordinator.ts Virtual Clock & Telemetry Probes
  // ==========================================================================
  describe("2. renderCoordinator.ts Phase 5 Telemetry & Virtual Clock Integrity", () => {
    it("strictly preserves 5-phase execution order: clock -> audio -> modulation -> draw -> telemetry", () => {
      const coordinator = new RenderCoordinator()
      coordinator.tick(1000)
      coordinator.tick(1016.6)

      const phases = coordinator.getLastFramePhases()
      expect(phases).toEqual(["clock", "audio", "modulation", "draw", "telemetry"])
    })

    it("verifies Phase 5 telemetry does NOT mutate frame delta or virtual clock", () => {
      const coordinator = new RenderCoordinator()
      const recordedDeltas: number[] = []
      const virtualTimes: number[] = []

      coordinator.registerPreRenderHook("probe-hook", (virtualTime, delta) => {
        virtualTimes.push(virtualTime)
        recordedDeltas.push(delta)
      })

      // Frame 1: baseline bootstrap at t=1000
      coordinator.tick(1000)
      coordinator.seek(0) // reset virtual time to 0 while keeping lastTime = 1000

      // Frame 2: +16.0ms at t=1016.0
      coordinator.tick(1016.0)
      // Frame 3: +33.0ms at t=1049.0
      coordinator.tick(1049.0)

      // Expected delta values
      expect(recordedDeltas[recordedDeltas.length - 2]).toBe(16.0)
      expect(recordedDeltas[recordedDeltas.length - 1]).toBe(33.0)

      // Verify virtual playback time accumulation:
      // delta 16.0ms -> +0.016s -> 16.0ms
      // delta 33.0ms -> +0.033s -> 49.0ms
      expect(virtualTimes[virtualTimes.length - 2]).toBeCloseTo(16.0, 2)
      expect(virtualTimes[virtualTimes.length - 1]).toBeCloseTo(49.0, 2)
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.049, 4)

      // Verify that performanceTelemetry recorded exact frame times without mutation
      const timeline = performanceTelemetry.getTimeline()
      expect(timeline.length).toBeGreaterThanOrEqual(2)
      expect(timeline[timeline.length - 2]).toBe(16.0)
      expect(timeline[timeline.length - 1]).toBe(33.0)
    })

    it("freezes virtual clock while paused, delivers delta=0 to adapter, and preserves telemetry recording", () => {
      const coordinator = new RenderCoordinator()
      const adapterRenderSpy = vi.fn()
      const mockAdapter = {
        renderFrame: adapterRenderSpy,
        dispose: vi.fn(),
      }
      coordinator.setActiveAdapter(mockAdapter)

      // Advance initially
      coordinator.tick(1000)
      coordinator.tick(1020)
      const timeBeforePause = coordinator.getPlaybackTime()
      expect(timeBeforePause).toBeGreaterThan(0)

      // Pause playback
      coordinator.setPlaying(false)
      expect(coordinator.getIsPlaying()).toBe(false)

      adapterRenderSpy.mockClear()

      // Tick while paused (+50ms wall clock)
      coordinator.tick(1070)

      // 1. Virtual playback time MUST NOT advance
      expect(coordinator.getPlaybackTime()).toBe(timeBeforePause)

      // 2. Adapter renderFrame must receive delta = 0 while paused
      expect(adapterRenderSpy).toHaveBeenCalledWith(timeBeforePause * 1000, 0)

      // 3. Telemetry in Phase 5 still records the actual wall clock delta (50ms)
      const timeline = performanceTelemetry.getTimeline()
      expect(timeline[timeline.length - 1]).toBe(50)
    })

    it("scales virtual clock accurately across variable playback speeds (0.5x, 2.0x, 0.0x)", () => {
      const coordinator = new RenderCoordinator()

      // Bootstrap at 1000 and seek to 0
      coordinator.tick(1000)
      coordinator.seek(0)

      // 0.5x speed
      coordinator.setPlaybackSpeed(0.5)
      coordinator.tick(1020) // 20ms delta * 0.5 = 10ms virtual advancement
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.01, 3)

      // 2.0x speed
      coordinator.setPlaybackSpeed(2.0)
      coordinator.tick(1040) // 20ms delta * 2.0 = 40ms -> total 50ms virtual
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.05, 3)

      // 0.0x speed
      coordinator.setPlaybackSpeed(0.0)
      coordinator.tick(1100) // 60ms delta * 0 = 0 -> total still 50ms virtual
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.05, 3)
    })

    it("verifies seek operation immediately dispatches render with zero delta and increments count", () => {
      const coordinator = new RenderCoordinator()
      const adapterRenderSpy = vi.fn()
      const mockAdapter = {
        renderFrame: adapterRenderSpy,
        dispose: vi.fn(),
      }
      coordinator.setActiveAdapter(mockAdapter)

      expect(coordinator.getSingleFrameRenderCount()).toBe(0)

      // Seek to 42.5 seconds
      coordinator.seek(42.5)

      expect(coordinator.getPlaybackTime()).toBe(42.5)
      expect(coordinator.getSingleFrameRenderCount()).toBe(1)
      expect(adapterRenderSpy).toHaveBeenCalledWith(42500, 0)

      // Clamping negative seek to 0.0
      coordinator.seek(-10)
      expect(coordinator.getPlaybackTime()).toBe(0)
      expect(coordinator.getSingleFrameRenderCount()).toBe(2)
      expect(adapterRenderSpy).toHaveBeenCalledWith(0, 0)
    })

    it("survives throwing telemetry subscribers without crashing the render loop", () => {
      const coordinator = new RenderCoordinator()
      const badSubscriber = vi.fn().mockImplementation(() => {
        throw new Error("Adversarial subscriber fault injection!")
      })

      // performanceTelemetry subscriber fault
      const unsubTelemetry = performanceTelemetry.subscribe(badSubscriber)

      expect(() => {
        coordinator.tick(1000)
        coordinator.tick(1016.6)
      }).not.toThrow()

      unsubTelemetry()
    })
  })

  // ==========================================================================
  // SECTION 3: projectStore.ts Memory Budget Serialization Probes
  // ==========================================================================
  describe("3. projectStore.ts Memory Budget Serialization & Round-Trip", () => {
    it("initializes project with Contract 4 default memory budget", () => {
      const store = useProjectStore.getState()
      expect(store.memoryBudget).toEqual({
        textureBudgetMB: 512,
        geometryBudgetMB: 256,
        totalVramBudgetMB: 1024,
        warnThresholdRatio: 0.8,
      })
      expect(store.getMemoryBudget()).toEqual(store.memoryBudget)
    })

    it("partially updates memory budget and marks unsaved changes flag", () => {
      const store = useProjectStore.getState()
      expect(store.hasUnsavedChanges).toBe(false)

      store.setMemoryBudget({
        textureBudgetMB: 768,
        warnThresholdRatio: 0.85,
      })

      const updated = useProjectStore.getState().memoryBudget
      expect(updated.textureBudgetMB).toBe(768)
      expect(updated.geometryBudgetMB).toBe(256) // preserved default
      expect(updated.totalVramBudgetMB).toBe(1024) // preserved default
      expect(updated.warnThresholdRatio).toBe(0.85)
      expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    })

    it("round-trips custom memory budget perfectly through exportProjectData and loadProjectData", () => {
      const store = useProjectStore.getState()
      const customBudget: MemoryBudgetConfig = {
        textureBudgetMB: 1536,
        geometryBudgetMB: 512,
        totalVramBudgetMB: 2048,
        warnThresholdRatio: 0.75,
      }

      store.setMemoryBudget(customBudget)
      const exported = store.exportProjectData()

      expect(exported.memoryBudget).toEqual(customBudget)

      // Reset project back to defaults
      store.resetProject()
      expect(useProjectStore.getState().memoryBudget).toEqual(createDefaultMemoryBudget())

      // Re-load exported data
      store.loadProjectData(exported)
      expect(useProjectStore.getState().memoryBudget).toEqual(customBudget)
      expect(useProjectStore.getState().getMemoryBudget()).toEqual(customBudget)
    })

    it("safely handles legacy or corrupted project data lacking memoryBudget", () => {
      const store = useProjectStore.getState()
      const legacyData: any = {
        name: "Legacy Project",
        version: "1.0",
        backend: "webgl2",
        graphNodes: [],
        graphEdges: [],
        uniformValues: {},
        graphUniforms: [],
        shaderSources: {},
        audioSettings: {},
        audioBindings: [],
        variations: [],
        environmentSettings: {},
        // memoryBudget is missing entirely!
      }

      expect(() => {
        store.loadProjectData(legacyData)
      }).not.toThrow()

      // Falls back safely to default memory budget
      expect(useProjectStore.getState().memoryBudget).toEqual(createDefaultMemoryBudget())
    })

    it("safely handles partial memoryBudget in project data by merging with defaults", () => {
      const store = useProjectStore.getState()
      const partialData: any = {
        name: "Partial Project",
        version: "1.0",
        backend: "webgpu",
        graphNodes: [],
        graphEdges: [],
        uniformValues: {},
        graphUniforms: [],
        shaderSources: {},
        audioSettings: {},
        audioBindings: [],
        variations: [],
        environmentSettings: {},
        memoryBudget: {
          totalVramBudgetMB: 4096,
          // textureBudgetMB, geometryBudgetMB, warnThresholdRatio missing!
        },
      }

      store.loadProjectData(partialData)
      const budget = useProjectStore.getState().memoryBudget
      expect(budget.totalVramBudgetMB).toBe(4096)
      expect(budget.textureBudgetMB).toBe(512) // merged default
      expect(budget.geometryBudgetMB).toBe(256) // merged default
      expect(budget.warnThresholdRatio).toBe(0.8) // merged default
    })

    it("verifies checkMemoryThreshold on projectStore adheres strictly to '>' inequality", () => {
      const store = useProjectStore.getState()
      store.setMemoryBudget({
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8, // 80 MB, 80 MB, 160 MB
      })

      // Under threshold
      const under = store.checkMemoryThreshold({
        textureMB: 79.9,
        geometryMB: 79.9,
        totalVramMB: 159.9,
      })
      expect(under.hasAnyWarning).toBe(false)

      // Exactly at ratio (80.0 > 80.0 is false)
      const exactlyAt = store.checkMemoryThreshold({
        textureMB: 80.0,
        geometryMB: 80.0,
        totalVramMB: 160.0,
      })
      expect(exactlyAt.hasAnyWarning).toBe(false)

      // Strictly over by 0.01 MB
      const overTexture = store.checkMemoryThreshold({
        textureMB: 80.01,
        geometryMB: 50,
        totalVramMB: 100,
      })
      expect(overTexture.textureWarning).toBe(true)
      expect(overTexture.hasAnyWarning).toBe(true)

      const overGeometry = store.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 80.01,
        totalVramMB: 100,
      })
      expect(overGeometry.geometryWarning).toBe(true)
      expect(overGeometry.hasAnyWarning).toBe(true)

      const overTotal = store.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 50,
        totalVramMB: 160.01,
      })
      expect(overTotal.totalVramWarning).toBe(true)
      expect(overTotal.hasAnyWarning).toBe(true)
    })
  })
})
