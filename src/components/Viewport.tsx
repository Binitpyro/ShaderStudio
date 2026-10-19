import { useEffect, useRef, useCallback, useState } from "react"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import type { RenderAdapter } from "@/adapters/types"
import { useProjectStore } from "@/stores/projectStore"
import { throttle } from "@/utils/throttle"
import { cn } from "@/lib/utils"
import { PerfOverlay, ScreenshotButton } from "./PerfOverlay"
import { audioEngine } from "@/audio/audioEngine"
import { viewportCapture } from "@/utils/frameCapture"
import { VideoLoopRecorderModal } from "./VideoLoopRecorderModal"
import { renderCoordinator } from "@/core/renderCoordinator"
import { useTransportStore } from "@/stores/transportStore"

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
  const environmentSettings = useProjectStore((state) => state.environmentSettings)
  const resolutionScale = useTransportStore((state) => state.resolutionScale)
  const prevRecompileRef = useRef(recompileTrigger)
  const prevBackendRef = useRef(activeBackend)
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)

  useEffect(() => {
    if (prevBackendRef.current === "webgpu" && activeBackend === "webgl2") {
      setFallbackNotice("GPU hardware exhausted: automatically switched to WebGL2 fallback.")
      const timer = setTimeout(() => setFallbackNotice(null), 6000)
      return () => clearTimeout(timer)
    }
    prevBackendRef.current = activeBackend
  }, [activeBackend])

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
    viewportCapture.registerCanvas(canvas)
    let isCancelled = false

    const mountCurrent = async () => {
      if (adapterRef.current) {
        renderCoordinator.setActiveAdapter(null)
        adapterRef.current.dispose()
      }

      const adapter = getAdapter(activeBackend)
      adapterRef.current = adapter
      let ok = false
      try {
        ok = await adapter.mount(canvas)
      } catch (err) {
        console.warn(`[Viewport] Failed mounting backend ${activeBackend}:`, err)
        ok = false
      }
      if (isCancelled) return

      if (!ok) {
        if (activeBackend === "webgpu") {
          console.warn("[Viewport] WebGPU is not supported or failed to mount, falling back to WebGL2.")
          useProjectStore.getState().setActiveBackend("webgl2")
          return
        }
        if (activeBackend === "webgl2") {
          console.warn("[Viewport] WebGL2 failed to mount, falling back to Three.js.")
          useProjectStore.getState().setActiveBackend("threejs")
          return
        }
        console.error("[Viewport] Failed to mount adapter for", activeBackend)
        return
      }

      adapter.setRenderQueue(renderQueue)
      if (shaderSource) {
        adapter.recompileShader(shaderSource)
      }
      if (environmentSettings && adapter.updateEnvironment) {
        adapter.updateEnvironment(environmentSettings)
      }

      const rect = containerRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0) {
        const hostDpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
        const effectiveDpr = resolutionScale === "native"
          ? Math.min(hostDpr, 2.0)
          : Math.min(Number(resolutionScale) || 1.0, 2.0)
        adapter.resize(rect.width, rect.height, effectiveDpr)
      }

      renderCoordinator.setActiveAdapter(adapter)
      renderCoordinator.start()
    }

    mountCurrent()

    return () => {
      isCancelled = true
      viewportCapture.unregisterCanvas()
      renderCoordinator.setActiveAdapter(null)
      renderCoordinator.stop()
      adapterRef.current?.dispose()
      adapterRef.current = null
    }
  }, [activeBackend, getAdapter, resolutionScale])

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

  // Sync environment settings (IBL / Studio Lighting)
  useEffect(() => {
    if (adapterRef.current?.updateEnvironment && environmentSettings) {
      adapterRef.current.updateEnvironment(environmentSettings)
    }
  }, [environmentSettings])

  // Resize handling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const hostDpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
    const effectiveDpr = resolutionScale === "native"
      ? Math.min(hostDpr, 2.0)
      : Math.min(Number(resolutionScale) || 1.0, 2.0)

    const handleResize = throttle(() => {
      const rect = container.getBoundingClientRect()
      adapterRef.current?.resize(rect.width, rect.height, effectiveDpr)
    }, 50)

    const observer = new ResizeObserver(() => handleResize())
    observer.observe(container)

    const rect = container.getBoundingClientRect()
    adapterRef.current?.resize(rect.width, rect.height, effectiveDpr)

    return () => { observer.disconnect() }
  }, [resolutionScale])

  // Audio frame synchronization & real-time parameter modulation via renderCoordinator
  useEffect(() => {
    renderCoordinator.registerPreRenderHook("viewport-audio-modulation", () => {
      const adapter = adapterRef.current
      if (!adapter) return

      const audioBindings = useProjectStore.getState().audioBindings
      const uniformValues = useProjectStore.getState().uniformValues
      if (Object.keys(audioBindings).length > 0) {
        const uniforms = audioEngine.uniforms
        for (const [name, binding] of Object.entries(audioBindings)) {
          if (!binding) continue
          const baseUniform = uniformValues[name] ?? uniformValues[`u_${name}`] ?? uniformValues[name.replace(/^u_/, "")]
          const signal = uniforms[binding.band] ?? 0
          if (baseUniform && typeof baseUniform.value === "number") {
            const modulatedValue = baseUniform.value + signal * binding.amount
            adapter.updateUniform(name, {
              type: baseUniform.type,
              value: modulatedValue,
            })
            const alt = name.startsWith("u_") ? name.slice(2) : `u_${name}`
            adapter.updateUniform(alt, {
              type: baseUniform.type,
              value: modulatedValue,
            })
          }
        }
      }
    })

    return () => {
      renderCoordinator.unregisterPreRenderHook("viewport-audio-modulation")
    }
  }, [])

  const hasCompute = renderQueue?.some((step) => step.type === "compute")
  const showComputeFallbackBanner = hasCompute && activeBackend !== "webgpu"

  return (
    <div ref={containerRef} className={cn("h-full w-full overflow-hidden relative", className)}>
      {/* Non-blocking Device Lost Recovery Overlay */}
      {deviceLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-2 text-center p-4 max-w-sm rounded-lg border border-amber-500/30 bg-card/90 shadow-lg">
            <div className="flex items-center gap-2 text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold">WebGPU Context Lost</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Auto-recovering graphics pipeline... If hardware is exhausted, ShaderStudio will automatically switch to WebGL2.
            </p>
          </div>
        </div>
      )}

      {/* Automatic WebGL2 Fallback Notification Banner */}
      {fallbackNotice && (
        <div className="absolute top-2 left-2 z-30 flex items-center gap-2 rounded bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-200 backdrop-blur-xs shadow-md">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>{fallbackNotice}</span>
          <button
            onClick={() => setFallbackNotice(null)}
            className="ml-1 text-muted-foreground hover:text-foreground cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {showComputeFallbackBanner && !fallbackNotice && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-2 rounded bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-200 backdrop-blur-xs shadow-md">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Compute Pipeline active — Switch to WebGPU for native simulation</span>
        </div>
      )}
      <canvas key={activeBackend} ref={canvasRef} className="h-full w-full block" style={{ display: "block" }} />
      <PerfOverlay className="absolute" />
      <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5">
        <button
          onClick={() => setIsVideoModalOpen(true)}
          className="text-xs flex items-center gap-1.5 bg-card/85 backdrop-blur px-2.5 py-1 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-colors cursor-pointer border border-border/50 shadow-xs"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span>Record 60fps Loop</span>
        </button>
        <ScreenshotButton canvasRef={canvasRef} />
      </div>
      <VideoLoopRecorderModal isOpen={isVideoModalOpen} onClose={() => setIsVideoModalOpen(false)} />
    </div>
  )
}
