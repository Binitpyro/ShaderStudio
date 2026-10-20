import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { viewportCapture } from "@/utils/frameCapture"
import { performanceTelemetry, type DetailedGpuMetrics } from "@/core/performanceTelemetry"
import { useProjectStore } from "@/stores/projectStore"
import { useTransportStore } from "@/stores/transportStore"
import { Activity, AlertTriangle, ChevronDown, ChevronUp, Cpu, HardDrive } from "lucide-react"

/** UI refresh cadence for the profiler (4Hz). */
export const PERF_OVERLAY_INTERVAL_MS = 250

export function PerfOverlay({ className }: { className?: string }) {
  const [metrics, setMetrics] = useState<DetailedGpuMetrics>(() => performanceTelemetry.getMetrics())
  const [visible, setVisible] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const memoryBudget = useProjectStore((s) => s.memoryBudget)
  const isPlaying = useTransportStore((s) => s.isPlaying)
  const vramMB = Number((metrics.estimatedVramBytes / (1024 * 1024)).toFixed(1))
  const isVramOverBudget = vramMB > (memoryBudget.totalVramBudgetMB * memoryBudget.warnThresholdRatio)

  // Capture reads the cheap telemetry getters directly, so it stays correct even while hidden.
  useEffect(() => {
    viewportCapture.registerPerfMetrics(() => ({
      fps: Math.round(performanceTelemetry.getAverageFps()),
      frameTimeMs: performanceTelemetry.getLastFrameTime(),
    }))
    return () => viewportCapture.unregisterPerfMetrics()
  }, [])

  // One throttled subscription, and none at all while the overlay is hidden.
  useEffect(() => {
    if (!visible) return
    setMetrics(performanceTelemetry.getMetrics())
    return performanceTelemetry.subscribe(setMetrics, PERF_OVERLAY_INTERVAL_MS)
  }, [visible])

  // Draw 60-frame history timeline on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const timeline = metrics.frameTimeline.length > 0
      ? metrics.frameTimeline
      : [metrics.frameTime || 16.6]

    const maxMs = Math.max(33.3, ...timeline, 20)
    const barWidth = width / 60
    const startOffset = Math.max(0, 60 - timeline.length)

    // Background gradient grid
    ctx.fillStyle = "rgba(127, 127, 127, 0.08)"
    ctx.fillRect(0, 0, width, height)

    // Target 16.6ms (60 FPS) guideline
    const targetY = height - (16.67 / maxMs) * height
    ctx.strokeStyle = "rgba(16, 185, 129, 0.6)" // Emerald-500
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0, targetY)
    ctx.lineTo(width, targetY)
    ctx.stroke()
    ctx.setLineDash([])

    // Target 33.3ms (30 FPS) guideline
    const slowY = height - (33.33 / maxMs) * height
    ctx.strokeStyle = "rgba(239, 68, 68, 0.3)" // Red-500
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
  }, [metrics.frameTimeline, metrics.frameTime, expanded])

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className={cn("absolute top-2 right-2 z-30 flex h-7 items-center gap-1.5 rounded-md bg-panel/90 px-2 text-xs text-fg-muted shadow-sm ring-1 ring-line backdrop-blur hover:text-fg", className)}
      >
        <Activity className="size-3.5" />
        <span>Show profiler</span>
        {isVramOverBudget && <span className="size-1.5 rounded-full bg-danger-solid animate-pulse" />}
      </button>
    )
  }

  const passTimings = metrics.passTimings || {}
  const fpsTone = metrics.fps >= 55 ? "text-success" : metrics.fps >= 30 ? "text-warning" : "text-danger"

  return (
    <div
      className={cn(
        "absolute top-2 right-2 z-30 rounded-lg bg-panel/90 p-2 text-xs shadow-md ring-1 ring-line backdrop-blur-md select-none",
        expanded ? "w-60" : "w-52",
        className
      )}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          <Activity className="size-3.5 text-fg-muted" />
          GPU Profiler
        </span>
        <div className="flex items-center">
          <button type="button" aria-label={expanded ? "Collapse details" : "Expand details"} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="rounded-sm p-1 text-fg-muted hover:bg-hover hover:text-fg">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          <button type="button" onClick={() => setVisible(false)} className="rounded-sm px-1.5 py-1 text-fg-muted hover:bg-hover hover:text-fg">
            Hide
          </button>
        </div>
      </div>

      {isVramOverBudget && (
        <div role="alert" className="mb-2 flex items-center gap-1.5 rounded-md bg-danger-soft px-2 py-1 text-2xs font-medium text-danger animate-pulse">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>VRAM Alert: &gt;{(memoryBudget.warnThresholdRatio * 100).toFixed(0)}% Budget</span>
        </div>
      )}

      <div className="mb-2 flex items-baseline gap-4">
        {isPlaying ? (
          <>
            <span className="flex items-baseline gap-1">
              <span className={cn("num text-lg font-medium leading-none", fpsTone)}>{metrics.fps}</span>
              <span className="text-fg-subtle">FPS</span>
            </span>
            <span className="flex items-baseline gap-1">
              <span className="num text-lg font-medium leading-none text-fg">{metrics.frameTime.toFixed(1)}</span>
              <span className="text-fg-subtle">ms Frame</span>
            </span>
          </>
        ) : (
          <span className="text-sm text-fg-muted">Paused</span>
        )}
      </div>

      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-2xs text-fg-subtle">
          <span>60-frame timeline</span>
          <span className="num">16.6ms target</span>
        </div>
        <canvas ref={canvasRef} width={expanded ? 224 : 200} height={40} className="block h-10 w-full rounded-md bg-canvas" />
      </div>

      <dl className="flex flex-col gap-1 text-2xs text-fg-muted">
        <div className="flex items-center justify-between">
          <dt className="flex items-center gap-1">
            <Cpu className="size-3" />
            Draw Calls / Tris
          </dt>
          <dd className="num text-fg">
            {metrics.drawCalls} / {metrics.triangles.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="flex items-center gap-1">
            <HardDrive className="size-3" />
            VRAM
          </dt>
          <dd className={cn("num", isVramOverBudget ? "text-danger font-medium" : "text-fg")}>
            {vramMB} MB / {memoryBudget.totalVramBudgetMB} MB
          </dd>
        </div>
      </dl>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-2xs">
          <span className="font-medium text-fg">Pass timings</span>
          {([["GBuffer", "gbuffer"], ["Shadow", "shadow"], ["Lighting", "lighting"], ["SSR", "ssr"], ["Postprocess", "postprocess"]] as const).map(([label, key]) => (
            <div key={key} className="flex justify-between text-fg-muted">
              <span>{label}</span>
              <span className="num text-fg">{(passTimings[key] ?? 0).toFixed(1)}ms</span>
            </div>
          ))}
          <div className="flex justify-between pt-1 text-fg-subtle">
            <span>Budget ratio</span>
            <span className="num">{(memoryBudget.warnThresholdRatio * 100).toFixed(0)}% warn threshold</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function ScreenshotButton({ canvasRef, className }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; className?: string }) {
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `shader-studio-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, "image/png")
  }, [canvasRef])

  return (
    <button onClick={handleScreenshot} className={cn("h-7 rounded-md bg-panel/90 px-2 text-xs text-fg-muted ring-1 ring-line backdrop-blur hover:text-fg", className)}>
      Screenshot
    </button>
  )
}
