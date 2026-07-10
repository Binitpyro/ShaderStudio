import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"

interface PerfMetrics { fps: number; frameTime: number; timestamp: number }

export function PerfOverlay({ className }: { className?: string }) {
  const [metrics, setMetrics] = useState<PerfMetrics>({ fps: 0, frameTime: 0, timestamp: 0 })
  const [visible, setVisible] = useState(true)
  const frameTimesRef = useRef<number[]>([])

  useEffect(() => {
    let rafId: number
    let lastTime = performance.now()
    const measure = (time: number) => {
      const delta = time - lastTime
      lastTime = time
      frameTimesRef.current.push(delta)
      if (frameTimesRef.current.length > 60) frameTimesRef.current.shift()
      const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length
      const fps = 1000 / avgFrameTime
      setMetrics({ fps: Math.round(fps), frameTime: Math.round(avgFrameTime * 100) / 100, timestamp: time })
      rafId = requestAnimationFrame(measure)
    }
    rafId = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(rafId)
  }, [])

  if (!visible) {
    return (
      <button onClick={() => setVisible(true)} className={cn("absolute top-2 right-2 bg-card/80 backdrop-blur px-2 py-1 rounded text-xs", className)}>
        Show FPS
      </button>
    )
  }

  return (
    <div className={cn("absolute top-2 right-2 bg-card/80 backdrop-blur rounded p-2", className)}>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-medium text-foreground">Perf</span>
        <button onClick={() => setVisible(false)} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Hide</button>
      </div>
      <div className="flex gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">FPS:</span>
          <span className={cn("text-sm font-mono font-semibold", metrics.fps >= 55 ? "text-green-500" : metrics.fps >= 30 ? "text-yellow-500" : "text-red-500")}>{metrics.fps}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Frame:</span>
          <span className="text-sm font-mono">{metrics.frameTime.toFixed(1)}ms</span>
        </div>
      </div>
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
