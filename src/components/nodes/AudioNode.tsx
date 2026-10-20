import { memo, useRef, useState, useCallback, useEffect } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { AudioNodeData } from "@/core/graphCompiler"
import type { AudioSourceType } from "@/audio/audioEngine"
import { getAudioEngine, loadAudioEngine, withAudioEngine } from "@/audio/audioRegistry"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"
import { useAudioGauges, useThrottledAudioFrame, CANVAS_HZ } from "./useAudioFrame"

const NUM_BARS = 24
// Fixed per-bar bin index and beat-glow colour table: no per-frame string building.
const BIN_IDX = Array.from({ length: NUM_BARS }, (_, i) => Math.floor(Math.pow(i / NUM_BARS, 1.5) * 240))
const BEAT_STYLE = Array.from({ length: 11 }, (_, i) => `rgba(255, 255, 255, ${(i / 10) * 0.8})`)
const gradients = new WeakMap<CanvasRenderingContext2D, { h: number; grad: CanvasGradient }>()

function drawSpectrum(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, playing: boolean) {
  const w = canvas.width
  const h = canvas.height
  ctx.fillStyle = "rgba(10, 15, 25, 0.95)"
  ctx.fillRect(0, 0, w, h)
  if (!playing) return
  let cached = gradients.get(ctx)
  if (!cached || cached.h !== h) { // gradient geometry is height-bound: rebuild on canvas resize
    const g = ctx.createLinearGradient(0, h, 0, 0)
    g.addColorStop(0, "rgb(0, 200, 240)")
    g.addColorStop(1, "rgb(220, 60, 200)")
    cached = { h, grad: g }
    gradients.set(ctx, cached)
  }
  const grad = cached.grad
  const barWidth = (w - (NUM_BARS - 1) * 2) / NUM_BARS
  const audioEngine = getAudioEngine()
  if (!audioEngine) return
  const buf = audioEngine.textureBuffer
  ctx.fillStyle = grad
  for (let i = 0; i < NUM_BARS; i++) {
    const barHeight = Math.max(2, (buf[BIN_IDX[i]] / 255) * (h - 4))
    ctx.fillRect(i * (barWidth + 2), h - barHeight - 2, barWidth, barHeight)
  }
  const beat = audioEngine.uniforms.beat
  if (beat > 0.1) {
    ctx.fillStyle = BEAT_STYLE[Math.min(10, Math.round(beat * 10))]
    ctx.fillRect(0, h - 2, w, 2)
  }
}

function AudioNodeComponent({ id, data, selected }: FlowNodeProps<AudioNodeData>) {
  const isAudioPlaying = useProjectStore((s) => s.isAudioPlaying)
  const setIsAudioPlaying = useProjectStore((s) => s.setIsAudioPlaying)
  const audioGain = useProjectStore((s) => s.audioGain)
  const setAudioGain = useProjectStore((s) => s.setAudioGain)
  const audioSmoothing = useProjectStore((s) => s.audioSmoothing)
  const setAudioSmoothing = useProjectStore((s) => s.setAudioSmoothing)

  const [sourceType, setSourceType] = useState<AudioSourceType>(data.sourceType || "builtin")
  const [volume, setVolume] = useState<number>(data.volume ?? 0.8)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadAudioEngine().catch((err) => console.error("[AudioNode] audio engine chunk failed to load", err)) }, [])

  const gauge = useAudioGauges(`audio-gauges:${id}`, isAudioPlaying && !!selected)

  // Synchronize playing state
  const handleTogglePlay = useCallback(async () => {
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    const isPlaying = audioEngine.togglePlay()
    setIsAudioPlaying(isPlaying)
  }, [setIsAudioPlaying])

  const handleSourceChange = async (newSource: AudioSourceType) => {
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    if (newSource === "file" && !audioEngine.getContext()) {
      fileInputRef.current?.click()
    }
    setSourceType(newSource)
    await audioEngine.setSourceType(newSource)
    setIsAudioPlaying(audioEngine.getIsPlaying())

    const event = new CustomEvent("audioSourceChange", {
      detail: { nodeId: id, sourceType: newSource },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
      const ok = await audioEngine.loadCustomAudioFile(file)
      if (ok) {
        setSourceType("file")
        setIsAudioPlaying(audioEngine.getIsPlaying())
      }
    }
  }

  const handleVolumeChange = (vol: number) => {
    setVolume(vol)
    withAudioEngine((e) => e.setVolume(vol))
    useProjectStore.getState().setAudioVolume(vol)
  }

  // Spectrum canvas: drawn from the render coordinator at <=30Hz, only while audio plays (+ one idle frame).
  useThrottledAudioFrame(`audio-spectrum:${id}`, isAudioPlaying, CANVAS_HZ, () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    drawSpectrum(canvas, ctx, isAudioPlaying)
  })

  return (
    <div
      className={cn(
        "bg-card border rounded-md p-3 shadow-sm select-none text-foreground transition-all duration-150",
        selected
          ? "border-primary ring-2 ring-primary/30 min-w-[250px] max-w-[270px] shadow-lg"
          : "border-border min-w-[210px] max-w-[230px]"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isAudioPlaying ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"
            )}
          />
          <span className="text-xs font-semibold">Audio Analyzer</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          512 FFT
        </span>
      </div>

      {/* Mini Visualizer Canvas */}
      <div className="rounded overflow-hidden border border-border/60 mb-2">
        <canvas
          ref={canvasRef}
          width={190}
          height={38}
          className="w-full h-[38px] block"
        />
      </div>

      <div className="flex flex-col gap-2">
        {/* Source Dropdown */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Input Source</label>
          <select
            value={sourceType}
            onChange={(e) => handleSourceChange(e.target.value as AudioSourceType)}
            className="w-full bg-background text-xs border border-border rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-ring nodrag"
          >
            <option value="builtin">Built-in Synth Loop</option>
            <option value="file">Local Audio File</option>
            <option value="mic">Live Microphone</option>
          </select>
        </div>

        {sourceType === "file" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full text-[11px] h-7 font-mono nodrag"
          >
            Choose Audio File
          </Button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.aac,.flac"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Play/Pause & Volume */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <Button
            size="sm"
            variant={isAudioPlaying ? "default" : "secondary"}
            onClick={handleTogglePlay}
            className="flex-1 text-[11px] h-7 font-semibold nodrag"
          >
            {isAudioPlaying ? "Pause" : "Play"}
          </Button>

          <div className="flex items-center gap-1 flex-1 nodrag">
            <span className="text-[10px] text-muted-foreground select-none">Vol</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full h-1 bg-muted rounded appearance-none cursor-pointer accent-primary nodrag nopan"
            />
          </div>
        </div>

        {selected && (
          <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-2 font-mono text-[10px]">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-semibold text-foreground text-[11px]">Spectrum Dynamics</span>
              <span className="text-[9px] text-emerald-400 font-bold px-1 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                {isAudioPlaying ? "LIVE SIGNAL" : "STANDBY"}
              </span>
            </div>

            {/* 4 Mini Band Gauges */}
            <div className="grid grid-cols-4 gap-1">
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">BASS</span>
                <span ref={gauge.text("bass")} className="font-bold text-amber-400">0%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div ref={gauge.bar("bass")} className="h-full bg-amber-400" style={{ width: "0%" }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">MID</span>
                <span ref={gauge.text("mid")} className="font-bold text-cyan-400">0%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div ref={gauge.bar("mid")} className="h-full bg-cyan-400" style={{ width: "0%" }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">TREBLE</span>
                <span ref={gauge.text("treble")} className="font-bold text-pink-400">0%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div ref={gauge.bar("treble")} className="h-full bg-pink-400" style={{ width: "0%" }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">BEAT</span>
                <span ref={gauge.text("beat")} className="font-bold text-purple-400">0%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div ref={gauge.bar("beat")} className="h-full bg-purple-400" style={{ width: "0%" }} />
                </div>
              </div>
            </div>

            {/* Gain & Smoothing */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Gain: {audioGain.toFixed(1)}x</span>
                <span className="text-muted-foreground">Smooth: {audioSmoothing.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 nodrag">
                <span className="text-[9px] text-muted-foreground w-8">Gain</span>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.1"
                  value={audioGain}
                  onChange={(e) => {
                    const g = parseFloat(e.target.value)
                    setAudioGain(g)
                    withAudioEngine((e) => e.setGainMultiplier(g))
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full h-1 bg-muted rounded appearance-none cursor-pointer accent-primary nodrag nopan"
                />
              </div>
              <div className="flex items-center gap-1.5 nodrag">
                <span className="text-[9px] text-muted-foreground w-8">Smooth</span>
                <input
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={audioSmoothing}
                  onChange={(e) => {
                    const s = parseFloat(e.target.value)
                    setAudioSmoothing(s)
                    withAudioEngine((e) => e.setSmoothing(s))
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full h-1 bg-muted rounded appearance-none cursor-pointer accent-primary nodrag nopan"
                />
              </div>
            </div>

            <div className="text-[9px] text-muted-foreground text-center pt-0.5 border-t border-border/30">
              512 bins • 44.1 kHz • Hann window
            </div>
          </div>
        )}
      </div>

      {/* Output Audio Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="audio"
        className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-background"
      />
    </div>
  )
}

export const AudioNode = memo(AudioNodeComponent)
