import { useEffect, useRef, useCallback, useState } from "react"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import type { RenderAdapter } from "@/adapters/types"
import { useProjectStore, type AudioBand, type AudioBinding, type UniformValue } from "@/stores/projectStore"
import { useRenderSettingsStore } from "@/stores/renderSettingsStore"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { throttle } from "@/utils/throttle"
import { cn } from "@/lib/utils"
import { PerfOverlay, ScreenshotButton } from "./PerfOverlay"
import { audioEngine } from "@/audio/audioEngine"
import { viewportCapture } from "@/utils/frameCapture"
import { VideoLoopRecorderModal } from "./VideoLoopRecorderModal"
import { renderCoordinator } from "@/core/renderCoordinator"
import { useTransportStore, type ResolutionScale } from "@/stores/transportStore"

interface ViewportProps { className?: string }

/** Adapter mutators that must wake an idle (paused) render loop. */
const REDRAW_METHODS = [
  "updateUniform", "updatePostProcessUniform", "updateComputeUniform", "recompileShader", "recompileComputeShader",
  "reseedSimulation", "updateEnvironment", "setRenderQueue", "resize", "setResolutionScale",
  "setRenderingPipelineMode", "setPipelineMode", "setGBufferDebugView", "setShadowConfig", "updateShadowSettings",
  "setPointLightShadowCube", "setPostProcessEnabled", "updateSSRSettings", "updateDoFSettings", "updateSSAOSettings",
  "setAntiAliasingMode", "setAtmosphereParams", "applyRenderSettings",
] as const

/**
 * Wraps the adapter's mutating methods so any state change requests a redraw (render-on-demand while
 * paused). Components call adapters directly, so this is the one choke point. Returns an unwrap fn.
 */
function wrapAdapterForRedraw(adapter: RenderAdapter): () => void {
  const target = adapter as unknown as Record<string, unknown>
  // Remember whether each method was an own property so restore is exact (own value back, or delete to re-expose the prototype's).
  const wrapped: Array<{ name: string; wasOwn: boolean; original: unknown }> = []
  for (const name of REDRAW_METHODS) {
    const original = target[name]
    if (typeof original !== "function") continue
    wrapped.push({ name, wasOwn: Object.prototype.hasOwnProperty.call(target, name), original })
    target[name] = function (...args: unknown[]) {
      const result = (original as (...a: unknown[]) => unknown).apply(adapter, args)
      renderCoordinator.requestRender()
      return result
    }
  }
  return () => {
    for (const { name, wasOwn, original } of wrapped) {
      if (wasOwn) target[name] = original
      else delete target[name]
    }
  }
}

function effectiveDprFor(scale: ResolutionScale): number {
  const hostDpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
  return scale === "native" ? Math.min(hostDpr, 2.0) : Math.min(Number(scale) || 1.0, 2.0)
}

export function Viewport({ className }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<RenderAdapter | null>(null)
  const deviceLost = useProjectStore((state) => state.deviceLost)
  const recompileTrigger = useProjectStore((state) => state.recompileTrigger)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const renderQueue = useProjectStore((state) => state.renderQueue)
  const environmentSettings = useProjectStore((state) => state.environmentSettings)
  const resolutionScale = useTransportStore((state) => state.resolutionScale)
  const renderSettings = useRenderSettingsStore((state) => state.settings)
  const prevRecompileRef = useRef(recompileTrigger)
  const resolutionScaleRef = useRef(resolutionScale)
  resolutionScaleRef.current = resolutionScale
  const autoFallbackRef = useRef<string | null>(null)
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)

  // Fallback banner: only for real device loss/exhaustion or a failed mount, never for a manual backend switch.
  useEffect(() => {
    let sawDeviceLoss = useProjectStore.getState().deviceLost
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = useProjectStore.subscribe((state, prev) => {
      if (state.deviceLost) sawDeviceLoss = true
      if (prev.activeBackend === "webgpu" && state.activeBackend === "webgl2") {
        const reason = autoFallbackRef.current ?? (sawDeviceLoss ? "GPU hardware exhausted: automatically switched to WebGL2 fallback." : null)
        autoFallbackRef.current = null
        sawDeviceLoss = false
        if (reason) {
          setFallbackNotice(reason)
          clearTimeout(timer)
          timer = setTimeout(() => setFallbackNotice(null), 6000)
        }
      }
    })
    return () => { unsub(); clearTimeout(timer) }
  }, [])

  const getAdapter = useCallback((backend: string): RenderAdapter => {
    switch (backend) {
      case "webgpu": return webgpuAdapter
      case "webgl2": return webgl2Adapter
      case "threejs": return threejsAdapter
      default: return webgpuAdapter
    }
  }, [])

  // Mount and switch adapter whenever activeBackend changes. resolutionScale is deliberately NOT a
  // dependency (the resize effect handles it), so DPR changes never recreate the adapter/GPU device.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    viewportCapture.registerCanvas(canvas)
    let isCancelled = false
    let unwrap: (() => void) | null = null
    const adapter = getAdapter(activeBackend)

    const session = renderCoordinator.mountAdapter(adapter, canvas, (mounted) => {
      const project = useProjectStore.getState()
      mounted.setRenderQueue(project.renderQueue)
      if (project.shaderSource) {
        performanceTelemetry.recordRecompile()
        mounted.recompileShader(project.shaderSource)
      }
      if (project.environmentSettings && mounted.updateEnvironment) {
        mounted.updateEnvironment(project.environmentSettings)
      }
      mounted.applyRenderSettings?.(useRenderSettingsStore.getState().settings)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0) {
        mounted.resize(rect.width, rect.height, effectiveDprFor(resolutionScaleRef.current))
      }
      unwrap = wrapAdapterForRedraw(mounted)
      adapterRef.current = mounted
    })

    void session.done.then((ok) => {
      if (ok || isCancelled) return
      if (activeBackend === "webgpu") {
        console.warn("[Viewport] WebGPU is not supported or failed to mount, falling back to WebGL2.")
        autoFallbackRef.current = "WebGPU failed to initialise: switched to WebGL2."
        useProjectStore.getState().setActiveBackend("webgl2")
      } else if (activeBackend === "webgl2") {
        console.warn("[Viewport] WebGL2 failed to mount, falling back to Three.js.")
        useProjectStore.getState().setActiveBackend("threejs")
      } else {
        console.error("[Viewport] Failed to mount adapter for", activeBackend)
      }
    })

    return () => {
      isCancelled = true
      viewportCapture.unregisterCanvas()
      unwrap?.()
      adapterRef.current = null
      session.cancel()
    }
  }, [activeBackend, getAdapter])

  // Handle recompile
  useEffect(() => {
    if (recompileTrigger === prevRecompileRef.current) return
    prevRecompileRef.current = recompileTrigger
    const shaderSource = useProjectStore.getState().shaderSource
    if (shaderSource && adapterRef.current) {
      performanceTelemetry.recordRecompile()
      adapterRef.current.recompileShader(shaderSource)
    }
  }, [recompileTrigger])

  // Sync render queue
  useEffect(() => {
    adapterRef.current?.setRenderQueue(renderQueue)
    renderCoordinator.requestRender()
  }, [renderQueue])

  // Sync environment settings (IBL / Studio Lighting)
  useEffect(() => {
    if (adapterRef.current?.updateEnvironment && environmentSettings) {
      adapterRef.current.updateEnvironment(environmentSettings)
    }
    renderCoordinator.requestRender()
  }, [environmentSettings])

  // Fidelity settings (renderSettingsStore) -> adapter
  useEffect(() => {
    adapterRef.current?.applyRenderSettings?.(renderSettings)
    renderCoordinator.requestRender()
  }, [renderSettings])

  // Paused redraw triggers that never touch an adapter method: uniform edits in the store and camera/mouse input.
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state, prev) => {
      if (state.uniformValues !== prev.uniformValues) renderCoordinator.requestRender()
    })
    const container = containerRef.current
    const wake = () => renderCoordinator.requestRender()
    const onMove = (e: PointerEvent) => { if (e.buttons) wake() }
    container?.addEventListener("pointerdown", wake)
    container?.addEventListener("pointermove", onMove)
    container?.addEventListener("wheel", wake, { passive: true })
    return () => {
      unsub()
      container?.removeEventListener("pointerdown", wake)
      container?.removeEventListener("pointermove", onMove)
      container?.removeEventListener("wheel", wake)
    }
  }, [])

  // Resize handling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const effectiveDpr = effectiveDprFor(resolutionScale)

    const handleResize = throttle(() => {
      const rect = container.getBoundingClientRect()
      adapterRef.current?.resize(rect.width, rect.height, effectiveDpr)
    }, 50)

    const observer = new ResizeObserver(() => handleResize())
    observer.observe(container)

    const rect = container.getBoundingClientRect()
    adapterRef.current?.resize(rect.width, rect.height, effectiveDpr)
    renderCoordinator.requestRender()

    return () => { observer.disconnect() }
  }, [resolutionScale])

  // Audio-modulation pre-render hook. The binding list is rebuilt only when bindings change; the
  // per-frame path does lookups and one updateUniform per binding without allocating.
  useEffect(() => {
    interface Binding { name: string; keys: [string, string, string]; band: AudioBand; amount: number; payload: UniformValue }
    let bindings: Binding[] = []
    const rebuild = (audioBindings: Record<string, AudioBinding | undefined>) => {
      const next: Binding[] = []
      for (const name of Object.keys(audioBindings)) {
        const b = audioBindings[name]
        if (!b) continue
        next.push({
          name,
          keys: [name, `u_${name}`, name.replace(/^u_/, "")],
          band: b.band,
          amount: b.amount,
          payload: { type: "float", value: 0 },
        })
      }
      bindings = next
    }
    rebuild(useProjectStore.getState().audioBindings)
    const unsubBindings = useProjectStore.subscribe((state, prev) => {
      if (state.audioBindings !== prev.audioBindings) rebuild(state.audioBindings)
    })

    renderCoordinator.registerPreRenderHook("viewport-audio-modulation", () => {
      const adapter = adapterRef.current
      if (!adapter || bindings.length === 0) return
      const uniformValues = useProjectStore.getState().uniformValues
      const signals = audioEngine.uniforms
      for (let i = 0; i < bindings.length; i++) {
        const bd = bindings[i]
        const base = uniformValues[bd.keys[0]] ?? uniformValues[bd.keys[1]] ?? uniformValues[bd.keys[2]]
        if (!base || typeof base.value !== "number") continue
        bd.payload.type = base.type
        bd.payload.value = base.value + (signals[bd.band] ?? 0) * bd.amount
        adapter.updateUniform(bd.name, bd.payload) // adapters resolve the u_/bare alias themselves
      }
    })

    // Live audio keeps modulating while paused; poll the engine state at 4Hz (it has no event).
    const poll = setInterval(() => {
      renderCoordinator.setContinuousRender("audio-modulation", bindings.length > 0 && audioEngine.getIsPlaying())
    }, 250)

    return () => {
      clearInterval(poll)
      unsubBindings()
      renderCoordinator.setContinuousRender("audio-modulation", false)
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
