import { useEffect, useRef, useState, useCallback } from "react"
import type { Node } from "@xyflow/react"
import type { GraphNodeData } from "@/core/graphCompiler"
import type { NodePreviewResult, PreviewUniform, compileNodePreview as CompileNodePreview } from "@/core/nodePreviewCompiler"
import { useProjectStore, type UniformValue } from "@/stores/projectStore"
import { getActiveAdapter } from "@/adapters/activeAdapter"
import type { RenderToTargetRequest } from "@/adapters/types"
import { TEXTURE_LOADING } from "@/adapters/types"
import { renderCoordinator } from "@/core/renderCoordinator"
import { cn } from "@/lib/utils"
import { Play, Pause, Eye, X } from "lucide-react"

export type PreviewChannel = "rgba" | "rgb" | "r" | "g" | "b" | "a"

/** CSS-pixel edge of the preview; the GPU target is this times devicePixelRatio (capped at 2x). */
export const PREVIEW_SIZE = 160
/** Refresh ceiling while playing. */
export const PREVIEW_MAX_HZ = 14
const MIN_INTERVAL_MS = 1000 / PREVIEW_MAX_HZ
const RETRY_MS = 400
const MAX_RETRIES = 10
const TEXTURE_RETRY_MS = 250
const MAX_TEXTURE_RETRIES = 60 // ~15 s of "Loading texture…" before giving up

type Status = "idle" | "ok" | "none" | "error" | "unavailable" | "loading"

interface NodePreviewViewportProps {
  node: Node<GraphNodeData>
  onClose?: () => void
  className?: string
}

function previewPixels(): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  return Math.round(PREVIEW_SIZE * Math.min(2, Math.max(1, dpr)))
}

const docHidden = () => typeof document !== "undefined" && document.hidden

/** Store values (or the node's default) for every uniform the preview shader declares, plus time. */
function buildUniforms(specs: PreviewUniform[], store: Record<string, UniformValue>, time: number): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = { time: { type: "float", value: time }, u_time: { type: "float", value: time } }
  for (const u of specs) {
    const v = store[u.sourceName]
    if (u.bool) out[u.field] = { type: "float", value: (v ? Boolean(v.value) : Boolean(u.defaultValue)) ? 1 : 0 }
    else out[u.field] = v && v.type !== "texture" ? v : { type: u.type, value: u.defaultValue }
  }
  return out
}

/** Draws a render result into `canvas`, applying the channel filter on a copy (the cached result stays untouched). */
function drawResult(canvas: HTMLCanvasElement, img: ImageBitmap | ImageData, channel: PreviewChannel) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width
    canvas.height = img.height
  }
  const isData = "data" in img
  if (channel === "rgba") {
    if (isData) ctx.putImageData(img, 0, 0)
    else ctx.drawImage(img, 0, 0)
    return
  }
  let src: ImageData
  if (isData) src = img
  else {
    ctx.drawImage(img, 0, 0)
    src = ctx.getImageData(0, 0, img.width, img.height)
  }
  const out = ctx.createImageData(src.width, src.height)
  const s = src.data
  const d = out.data
  const pick = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : channel === "a" ? 3 : -1
  for (let i = 0; i < s.length; i += 4) {
    if (pick < 0) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2] } // "rgb": drop alpha
    else { d[i] = d[i + 1] = d[i + 2] = s[i + pick] }
    d[i + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
}

export function NodePreviewViewport({ node, onClose, className }: NodePreviewViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [channel, setChannel] = useState<PreviewChannel>("rgba")
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")
  const [size] = useState(previewPixels)

  const nodeType = node.data.type
  const isAnnotation = nodeType === "comment" || nodeType === "frame"

  const nodeRef = useRef(node)
  nodeRef.current = node
  const channelRef = useRef(channel)
  channelRef.current = channel
  const mounted = useRef(false)
  const visibleRef = useRef(true)
  const inFlight = useRef(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const lastSig = useRef("")
  const lastImage = useRef<ImageBitmap | ImageData | null>(null)
  const retries = useRef(0)
  const texRetries = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Loaded lazily: the partial-graph compiler (SDF + math codegen) stays out of the entry chunk.
  const compiler = useRef<typeof CompileNodePreview | null>(null)
  const compiled = useRef<{ deps: unknown[]; result: NodePreviewResult } | null>(null)

  const compile = useCallback((): NodePreviewResult | null => {
    if (!compiler.current) return null
    const st = useProjectStore.getState()
    const n = nodeRef.current
    const deps = [n, st._graphNodes, st._graphEdges, st.wgslSource, st.glslSource, st.textureResources]
    const hit = compiled.current
    if (hit && hit.deps.every((d, i) => d === deps[i])) return hit.result
    const nodes = st._graphNodes.some((x) => x.id === n.id) ? st._graphNodes.map((x) => (x.id === n.id ? n : x)) : [...st._graphNodes, n]
    const result = compiler.current(n.id, nodes, st._graphEdges, { material: { wgsl: st.wgslSource, glsl: st.glslSource }, textureSrc: (id) => st.textureResources.find((r) => r.id === id)?.src })
    compiled.current = { deps, result }
    return result
  }, [])

  /**
   * One preview request: at most one in flight (a "change" arriving meanwhile is coalesced into one follow-up, ticks are
   * dropped), never while hidden, and skipped when a "change" would render exactly what is already on screen.
   */
  const run = useCallback((reason: "change" | "tick") => {
    if (!mounted.current || !visibleRef.current || docHidden()) return
    if (inFlight.current) {
      if (reason === "change") pending.current = true
      return
    }
    const result = compile()
    if (!result) return
    if (result.status === "none") { setStatus("none"); return }
    if (result.status === "error") { setStatus("error"); setMessage(result.error); return }
    const adapter = getActiveAdapter()
    if (!adapter?.renderToTarget) {
      setStatus("unavailable")
      if (retries.current < MAX_RETRIES) {
        retries.current++
        clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => run("change"), RETRY_MS)
      }
      return
    }
    const st = useProjectStore.getState()
    const uniforms = buildUniforms(result.uniforms, st.uniformValues, renderCoordinator.getPlaybackTime())
    const source: RenderToTargetRequest["source"] = adapter.backendType === "threejs"
      ? { glsl: result.source.glslThree || undefined }
      : { wgsl: result.source.wgsl || undefined, glsl: result.source.glsl || undefined }
    const { time: _t, u_time: _ut, ...stable } = uniforms
    const textures = result.textures
    const sig = JSON.stringify([adapter.backendType, source, stable, textures])
    if (reason === "change" && sig === lastSig.current && lastImage.current) return

    inFlight.current = true
    const gen = generation.current
    const request: RenderToTargetRequest = { nodeId: nodeRef.current.id, source, width: size, height: size, uniforms, ...(textures ? { textures } : {}) }
    void (async () => {
      let img: ImageBitmap | ImageData | null = null
      let failure = ""
      try { img = await adapter.renderToTarget!(request) } catch (err) { failure = err instanceof Error ? err.message : String(err) }
      inFlight.current = false
      if (mounted.current && gen === generation.current) {
        if (!img && failure === TEXTURE_LOADING) {
          // Not an error: the adapter is still fetching/uploading the image. Retry shortly.
          lastSig.current = ""
          if (texRetries.current++ < MAX_TEXTURE_RETRIES) {
            setStatus("loading")
            clearTimeout(retryTimer.current)
            retryTimer.current = setTimeout(() => run("change"), TEXTURE_RETRY_MS)
          } else {
            setStatus("error")
            setMessage("The texture failed to load.")
          }
        } else if (img) {
          retries.current = 0
          texRetries.current = 0
          lastSig.current = sig
          lastImage.current = img
          const canvas = canvasRef.current
          if (canvas) drawResult(canvas, img, channelRef.current)
          setStatus("ok")
        } else {
          lastSig.current = ""
          setStatus("error")
          setMessage(failure || "The shader failed to compile on this backend.")
        }
      }
      if (pending.current) {
        pending.current = false
        run("change")
      }
    })()
  }, [compile, size])

  useEffect(() => {
    let alive = true
    void import("@/core/nodePreviewCompiler").then((m) => {
      if (!alive) return
      compiler.current = m.compileNodePreview
      run("change")
    })
    return () => { alive = false }
  }, [run])

  // Selection: drop everything belonging to the previous node.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      clearTimeout(retryTimer.current)
    }
  }, [])
  useEffect(() => {
    generation.current++
    lastSig.current = ""
    lastImage.current = null
    retries.current = 0
    texRetries.current = 0
    setStatus("idle")
  }, [node.id])

  // Once on selection and whenever this node's data changes (also covers channel-independent re-renders).
  useEffect(() => {
    if (!isAnnotation) run("change")
  }, [node.id, node.data, isAnnotation, run])

  // Upstream graph, shader source, uniform value or backend changes: one debounced refresh, even while paused.
  useEffect(() => {
    if (isAnnotation) return
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = useProjectStore.subscribe((s, p) => {
      if (s._graphNodes === p._graphNodes && s._graphEdges === p._graphEdges && s.wgslSource === p.wgslSource && s.glslSource === p.glslSource && s.uniformValues === p.uniformValues && s.activeBackend === p.activeBackend) return
      clearTimeout(t)
      t = setTimeout(() => run("change"), 120)
    })
    return () => { clearTimeout(t); unsub() }
  }, [isAnnotation, run])

  // Playing: the coordinator frame hook drives refreshes at <= PREVIEW_MAX_HZ (no own rAF, nothing registered while paused).
  useEffect(() => {
    if (isAnnotation || !isPlaying) return
    const id = `node-preview:${node.id}`
    let last = 0
    renderCoordinator.registerPreRenderHook(id, () => {
      if (!renderCoordinator.getIsPlaying() || !visibleRef.current || docHidden()) return
      const now = performance.now()
      if (now - last < MIN_INTERVAL_MS) return
      last = now
      run("tick")
    })
    return () => renderCoordinator.unregisterPreRenderHook(id)
  }, [isAnnotation, isPlaying, node.id, run])

  // Visibility: refresh once when scrolled/shown back into view.
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1]?.isIntersecting ?? true
      const was = visibleRef.current
      visibleRef.current = visible
      if (visible && !was) run("change")
    })
    io.observe(el)
    return () => io.disconnect()
  }, [isAnnotation, run])

  // Channel switch re-filters the last result; no GPU request.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && lastImage.current) drawResult(canvas, lastImage.current, channel)
  }, [channel])

  const overlay = status === "loading" ? "Loading texture…" : status === "none" ? "No preview" : status === "unavailable" ? "Preview unavailable" : status === "error" ? "Preview failed" : null

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/95 shadow-md overflow-hidden flex flex-col font-sans",
        className
      )}
    >
      {/* Viewport Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-1.5 min-w-0">
          <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {node.data.type.toUpperCase()}: <span className="font-mono text-muted-foreground">{node.id}</span>
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isAnnotation && (
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={isPlaying ? "Pause preview" : "Play preview"}
            >
              {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Close live preview"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Viewport Canvas or Annotation Notice */}
      {isAnnotation ? (
        <div className="p-6 text-center text-xs text-muted-foreground italic bg-muted/10">
          Annotation node — no isolated shader output.
        </div>
      ) : (
        <div data-testid="node-preview" data-preview-status={status} className="relative h-40 w-full bg-canvas overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className={cn("h-full w-full object-contain", overlay && "opacity-0")}
          />

          {overlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-3 text-center text-xs text-muted-foreground" title={status === "error" ? message : undefined}>
              <span>{overlay}</span>
              {status === "error" && message ? <span className="max-w-full truncate text-2xs text-destructive/80">{message}</span> : null}
            </div>
          )}

          {/* Bottom Channel Selector Overlay */}
          <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-overlay/80 backdrop-blur-xs px-1.5 py-0.5 rounded border border-line text-2xs font-mono">
            {(["rgba", "rgb", "r", "g", "b", "a"] as PreviewChannel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={cn(
                  "px-1 rounded uppercase transition-colors",
                  channel === ch
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Resolution Badge */}
          <div className="absolute top-1.5 right-2 bg-overlay/70 px-1 py-0.5 rounded text-2xs font-mono text-muted-foreground">
            {size}×{size}
          </div>
        </div>
      )}
    </div>
  )
}
