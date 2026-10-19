import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { viewportCapture } from "@/utils/frameCapture"
import { renderCoordinator } from "@/core/renderCoordinator"
import { performanceTelemetry, type DetailedGpuMetrics } from "@/core/performanceTelemetry"
import { useProjectStore } from "@/stores/projectStore"
import { Activity, AlertTriangle, ChevronDown, ChevronUp, Cpu, HardDrive } from "lucide-react"

export function PerfOverlay({ className }: { className?: string }) {
  const [metrics, setMetrics] = useState<DetailedGpuMetrics>(() => performanceTelemetry.getMetrics())
  const [visible, setVisible] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const metricsRef = useRef<DetailedGpuMetrics>(metrics)
  metricsRef.current = metrics

  const memoryBudget = useProjectStore((s) => s.memoryBudget)
  const vramMB = Number((metrics.estimatedVramBytes / (1024 * 1024)).toFixed(1))
  const isVramOverBudget = vramMB > (memoryBudget.totalVramBudgetMB * memoryBudget.warnThresholdRatio)

  useEffect(() => {
    viewportCapture.registerPerfMetrics(() => ({
      fps: metricsRef.current.fps,
      frameTimeMs: metricsRef.current.frameTime,
    }))

    // Subscribe to both renderCoordinator and performanceTelemetry
    const unsubCoordinator = renderCoordinator.onMetrics((m) => {
      const telemetryMetrics = performanceTelemetry.getMetrics()
      setMetrics({
        ...telemetryMetrics,
        fps: m.fps || telemetryMetrics.fps,
        frameTime: m.frameTimeMs || telemetryMetrics.frameTime,
      })
    })

    const unsubTelemetry = performanceTelemetry.subscribe((m) => {
      setMetrics(m)
    })

    return () => {
      unsubCoordinator()
      unsubTelemetry()
    }
  }, [])

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
    ctx.fillStyle = "rgba(15, 23, 42, 0.4)"
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
        onClick={() => setVisible(true)}
        className={cn("absolute top-2 right-2 bg-card/90 backdrop-blur px-2.5 py-1 rounded text-xs border border-border shadow flex items-center gap-1.5", className)}
      >
        <Activity className="w-3.5 h-3.5 text-primary" />
        <span>Show Profiler</span>
        {isVramOverBudget && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </button>
    )
  }

  const passTimings = metrics.passTimings || {}

  return (
    <div
      className={cn(
        "absolute top-2 right-2 bg-card/95 backdrop-blur-md rounded-lg p-2.5 border border-border shadow-lg transition-all duration-200 select-none z-30",
        expanded ? "w-[240px]" : "w-[210px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-border/50 mb-2">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground tracking-tight">GPU Profiler</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            title={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded transition-colors"
          >
            Hide
          </button>
        </div>
      </div>

      {/* Memory Budget Alert Badge (R5b) */}
      {isVramOverBudget && (
        <div className="flex items-center gap-1.5 px-2 py-1 mb-2 rounded bg-destructive/15 border border-destructive/40 text-destructive text-[10px] font-medium animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>VRAM Alert: &gt;{(memoryBudget.warnThresholdRatio * 100).toFixed(0)}% Budget</span>
        </div>
      )}

      {/* Primary Metrics (FPS & Frame Time) */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-muted/40 border border-border/50 rounded p-1.5 flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-mono">FPS</span>
          <span className={cn(
            "text-base font-mono font-bold leading-tight",
            metrics.fps >= 55 ? "text-emerald-500" : metrics.fps >= 30 ? "text-yellow-500" : "text-red-500"
          )}>
            {metrics.fps}
          </span>
        </div>
        <div className="bg-muted/40 border border-border/50 rounded p-1.5 flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-mono">Frame</span>
          <span className="text-base font-mono font-bold leading-tight text-foreground">
            {metrics.frameTime.toFixed(1)}<span className="text-[10px] text-muted-foreground font-normal">ms</span>
          </span>
        </div>
      </div>

      {/* Frame Timeline 60-frame Graph (R5a) */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[9px] text-muted-foreground font-mono mb-1">
          <span>60-FRAME TIMELINE</span>
          <span className="text-emerald-400">16.6ms target</span>
        </div>
        <div className="rounded border border-border/60 overflow-hidden bg-background/50">
          <canvas
            ref={canvasRef}
            width={expanded ? 218 : 188}
            height={44}
            className="w-full h-[44px] block"
          />
        </div>
      </div>

      {/* Secondary Metrics Summary */}
      <div className="flex flex-col gap-1 text-[10px] font-mono pt-1 border-t border-border/40">
        <div className="flex justify-between items-center text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-primary/80" />
            <span>Draw Calls / Tris</span>
          </span>
          <span className="text-foreground font-medium">
            {metrics.drawCalls} / {metrics.triangles.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between items-center text-muted-foreground">
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3 text-primary/80" />
            <span>VRAM</span>
          </span>
          <span className={cn("font-medium", isVramOverBudget ? "text-red-400 font-bold" : "text-foreground")}>
            {vramMB} MB / {memoryBudget.totalVramBudgetMB} MB
          </span>
        </div>
      </div>

      {/* Expanded Per-Pass Timings Breakdown (R5a) */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold text-foreground tracking-tight">Pass Timings</span>
          <div className="flex flex-col gap-1 text-[10px] font-mono bg-muted/30 p-1.5 rounded border border-border/40">
            <div className="flex justify-between text-muted-foreground">
              <span>GBuffer</span>
              <span className="text-foreground">{(passTimings.gbuffer ?? 0).toFixed(1)}ms</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shadow</span>
              <span className="text-foreground">{(passTimings.shadow ?? 0).toFixed(1)}ms</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Lighting</span>
              <span className="text-foreground">{(passTimings.lighting ?? 0).toFixed(1)}ms</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>SSR</span>
              <span className="text-foreground">{(passTimings.ssr ?? 0).toFixed(1)}ms</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Postprocess</span>
              <span className="text-foreground">{(passTimings.postprocess ?? 0).toFixed(1)}ms</span>
            </div>
          </div>

          <div className="flex justify-between text-[9px] text-muted-foreground pt-1">
            <span>Budget Ratio</span>
            <span className="font-mono">{(memoryBudget.warnThresholdRatio * 100).toFixed(0)}% warn threshold</span>
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
    <button onClick={handleScreenshot} className={cn("text-xs bg-card/80 backdrop-blur px-2 py-1 rounded hover:bg-accent transition-colors", className)}>
      Screenshot
    </button>
  )
}
