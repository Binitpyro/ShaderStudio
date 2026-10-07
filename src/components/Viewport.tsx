import { useEffect, useRef, useCallback } from "react"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import type { RenderAdapter } from "@/adapters/types"
import { useProjectStore } from "@/stores/projectStore"
import { throttle } from "@/utils/throttle"
import { cn } from "@/lib/utils"
import { PerfOverlay, ScreenshotButton } from "./PerfOverlay"

interface ViewportProps { className?: string }

export function Viewport({ className }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<RenderAdapter | null>(null)
  const deviceLost = useProjectStore((state) => state.deviceLost)
  const recompileTrigger = useProjectStore((state) => state.recompileTrigger)
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const renderQueue = useProjectStore((state) => state.renderQueue)
  const prevRecompileRef = useRef(recompileTrigger)

  const getAdapter = useCallback((backend: string): RenderAdapter => {
    switch (backend) {
      case "webgpu": return webgpuAdapter
      case "webgl2": return webgl2Adapter
      case "threejs": return threejsAdapter
      default: return webgpuAdapter
    }
  }, [])

  // Mount and switch adapter whenever activeBackend changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let isCancelled = false

    const mountCurrent = async () => {
      if (adapterRef.current) {
        adapterRef.current.dispose()
      }

      const adapter = getAdapter(activeBackend)
      adapterRef.current = adapter
      await adapter.mount(canvas)
      if (isCancelled) return

      adapter.setRenderQueue(renderQueue)
      if (shaderSource) {
        adapter.recompileShader(shaderSource)
      }
    }

    mountCurrent()

    return () => {
      isCancelled = true
      adapterRef.current?.dispose()
      adapterRef.current = null
    }
  }, [activeBackend, getAdapter])

  // Handle recompile
  useEffect(() => {
    if (recompileTrigger !== prevRecompileRef.current && shaderSource && adapterRef.current) {
      prevRecompileRef.current = recompileTrigger
      adapterRef.current.recompileShader(shaderSource)
    }
  }, [recompileTrigger, shaderSource])

  // Sync render queue
  useEffect(() => {
    if (adapterRef.current) {
      adapterRef.current.setRenderQueue(renderQueue)
    }
  }, [renderQueue])

  // Resize handling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleResize = throttle(() => {
      const rect = container.getBoundingClientRect()
      adapterRef.current?.resize(rect.width, rect.height)
    }, 50)

    const observer = new ResizeObserver(() => handleResize())
    observer.observe(container)

    const rect = container.getBoundingClientRect()
    adapterRef.current?.resize(rect.width, rect.height)

    return () => { observer.disconnect() }
  }, [])

  if (deviceLost) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center", className)}>
        <div className="text-center p-4">
          <p className="text-destructive text-sm font-medium mb-2">GPU Device Lost</p>
          <p className="text-muted-foreground text-xs">The graphics device was lost. Reload to recover.</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn("h-full w-full overflow-hidden relative", className)}>
      <canvas key={activeBackend} ref={canvasRef} className="h-full w-full block" style={{ display: "block" }} />
      <PerfOverlay className="absolute" />
      <ScreenshotButton canvasRef={canvasRef} className="absolute bottom-2 right-2" />
    </div>
  )
}
