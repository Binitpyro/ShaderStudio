import { useEffect, useRef, useState, useCallback } from "react"
import type { Node } from "@xyflow/react"
import type { GraphNodeData } from "@/core/graphCompiler"
import { cn } from "@/lib/utils"
import { Play, Pause, Eye, X } from "lucide-react"

export type PreviewChannel = "rgba" | "rgb" | "r" | "g" | "b" | "a"

interface NodePreviewViewportProps {
  node: Node<GraphNodeData>
  onClose?: () => void
  className?: string
}

export function NodePreviewViewport({ node, onClose, className }: NodePreviewViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [channel, setChannel] = useState<PreviewChannel>("rgba")
  const animFrameRef = useRef<number | null>(null)
  const timeRef = useRef(0)

  const isAnnotation = node.data.type === "comment" || node.data.type === "frame"

  // Rendering logic for isolated preview
  const renderFrame = useCallback(
    (time: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const width = canvas.width
      const height = canvas.height
      const nodeType = node.data.type

      // Clear canvas
      ctx.fillStyle = "#121316"
      ctx.fillRect(0, 0, width, height)

      // Draw subtle background grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)"
      ctx.lineWidth = 1
      for (let x = 0; x < width; x += 16) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += 16) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      const imgData = ctx.createImageData(width, height)
      const data = imgData.data

      if (nodeType === "math_expression") {
        // Evaluate math formula over [0, 1] domain
        const expr = ((node.data as any).expression || "sin(uv.x * 10.0) * 0.5 + 0.5").toLowerCase()
        const freq = expr.includes("20") ? 20.0 : expr.includes("5") ? 5.0 : 10.0
        for (let py = 0; py < height; py++) {
          const v = 1.0 - py / height
          for (let px = 0; px < width; px++) {
            const u = px / width
            const idx = (py * width + px) * 4

            // Generate procedural domain mapping
            const t = isPlaying ? time * 0.002 : 1.0
            const val = Math.sin(u * freq + t) * Math.cos(v * freq + t) * 0.5 + 0.5
            let r = val
            let g = Math.sin(val * Math.PI)
            let b = 1.0 - val
            let a = 1.0

            if (channel === "r") { g = r; b = r }
            else if (channel === "g") { r = g; b = g }
            else if (channel === "b") { r = b; g = b }
            else if (channel === "a") { r = a; g = a; b = a }

            data[idx] = Math.max(0, Math.min(255, Math.floor(r * 255)))
            data[idx + 1] = Math.max(0, Math.min(255, Math.floor(g * 255)))
            data[idx + 2] = Math.max(0, Math.min(255, Math.floor(b * 255)))
            data[idx + 3] = 255
          }
        }
        ctx.putImageData(imgData, 0, 0)
      } else if (nodeType === "material" || nodeType === "subgraph") {
        // Render 3D preview sphere with studio lighting
        const cx = width / 2
        const cy = height / 2
        const radius = Math.min(width, height) * 0.38
        const t = isPlaying ? time * 0.0015 : 0.5

        // Light direction
        const lx = Math.cos(t)
        const ly = -0.5
        const lz = Math.sin(t)
        const len = Math.sqrt(lx * lx + ly * ly + lz * lz)
        const nlx = lx / len
        const nly = ly / len
        const nlz = lz / len

        for (let py = 0; py < height; py++) {
          const dy = (py - cy) / radius
          for (let px = 0; px < width; px++) {
            const dx = (px - cx) / radius
            const distSq = dx * dx + dy * dy
            const idx = (py * width + px) * 4

            if (distSq <= 1.0) {
              const dz = Math.sqrt(1.0 - distSq)
              // Surface normal
              const nx = dx
              const ny = dy
              const nz = dz

              // Diffuse N dot L
              const diff = Math.max(0, nx * nlx + ny * nly + nz * nlz)
              // Specular
              const hx = nlx
              const hy = nly
              const hz = nlz + 1.0
              const hlen = Math.sqrt(hx * hx + hy * hy + hz * hz)
              const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hlen), 32)
              // Fresnel rim
              const fresnel = Math.pow(1.0 - nz, 3.0)

              let r = 0.15 + diff * 0.7 + spec * 0.6 + fresnel * 0.4
              let g = 0.2 + diff * 0.8 + spec * 0.6 + fresnel * 0.6
              let b = 0.35 + diff * 0.95 + spec * 0.6 + fresnel * 0.9
              let a = 1.0

              if (channel === "r") { g = r; b = r }
              else if (channel === "g") { r = g; b = g }
              else if (channel === "b") { r = b; g = b }
              else if (channel === "a") { r = a; g = a; b = a }

              data[idx] = Math.max(0, Math.min(255, Math.floor(r * 255)))
              data[idx + 1] = Math.max(0, Math.min(255, Math.floor(g * 255)))
              data[idx + 2] = Math.max(0, Math.min(255, Math.floor(b * 255)))
              data[idx + 3] = 255
            }
          }
        }
        ctx.putImageData(imgData, 0, 0)
      } else if (nodeType === "mesh") {
        // Draw 3D wireframe mesh preview
        const cx = width / 2
        const cy = height / 2
        const t = isPlaying ? time * 0.001 : 0.8
        const geom = (node.data as any).geometry || "torus_knot"

        ctx.strokeStyle = "#38bdf8"
        ctx.lineWidth = 1.5

        const segments = geom === "cube" ? 8 : 16
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2 + t
          const r1 = Math.min(width, height) * 0.3
          const x1 = cx + Math.cos(theta) * r1
          const y1 = cy + Math.sin(theta) * r1 * 0.5
          ctx.beginPath()
          ctx.arc(x1, y1, geom === "sphere" ? 12 : 24, 0, Math.PI * 2)
          ctx.stroke()
        }
      } else if (nodeType === "audio") {
        // Audio waveform & FFT spectrum
        ctx.fillStyle = "#10b981"
        const barCount = 32
        const barWidth = width / barCount
        const t = isPlaying ? time * 0.005 : 1.0

        for (let i = 0; i < barCount; i++) {
          const h = (Math.sin(i * 0.3 + t) * 0.5 + 0.5) * (height * 0.7)
          ctx.fillRect(i * barWidth + 1, height - h, barWidth - 2, h)
        }
      } else {
        // Default gradient pattern for textures, compute, custom
        const t = isPlaying ? time * 0.001 : 0.5
        for (let py = 0; py < height; py += 2) {
          const v = py / height
          for (let px = 0; px < width; px += 2) {
            const u = px / width
            const idx = (py * width + px) * 4
            const r = Math.sin(u * 5.0 + t) * 0.5 + 0.5
            const g = Math.cos(v * 5.0 + t) * 0.5 + 0.5
            const b = Math.sin((u + v) * 5.0 + t) * 0.5 + 0.5

            data[idx] = Math.floor(r * 255)
            data[idx + 1] = Math.floor(g * 255)
            data[idx + 2] = Math.floor(b * 255)
            data[idx + 3] = 255
          }
        }
        ctx.putImageData(imgData, 0, 0)
      }
    },
    [node, isPlaying, channel]
  )

  useEffect(() => {
    if (isAnnotation) return

    let running = true
    const loop = (timestamp: number) => {
      timeRef.current = timestamp
      renderFrame(timestamp)
      if (running) {
        animFrameRef.current = requestAnimationFrame(loop)
      }
    }

    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      running = false
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [renderFrame, isAnnotation])

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
        <div className="relative aspect-[4/3] w-full bg-[#121316] overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={240}
            height={180}
            className="w-full h-full object-contain"
          />

          {/* Bottom Channel Selector Overlay */}
          <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-xs px-1.5 py-0.5 rounded border border-white/10 text-[9px] font-mono">
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
          <div className="absolute top-1.5 right-2 bg-black/50 px-1 py-0.5 rounded text-[8px] font-mono text-muted-foreground">
            240×180
          </div>
        </div>
      )}
    </div>
  )
}
