import { memo, useRef, useState, useCallback, useEffect } from "react"
import { Music } from "lucide-react"
import { Badge, Button, Select } from "@/components/ui"
import { NodeShell, Port, Position, nodeLabelClass, nodeRangeClass } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { AudioNodeData } from "@/core/graphCompiler"
import type { AudioSourceType } from "@/audio/audioEngine"
import { getAudioEngine, loadAudioEngine, withAudioEngine } from "@/audio/audioRegistry"
import { useProjectStore } from "@/stores/projectStore"
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

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <NodeShell
      title="Audio Analyzer"
      icon={Music}
      size="lg"
      selected={selected}
      meta={
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", isAudioPlaying ? "animate-pulse bg-success" : "bg-fg-disabled")} />
          <span className="num">512 FFT</span>
        </span>
      }
      ports={<Port type="source" position={Position.Right} id="audio" portType="audio" />}
    >
      <div className="overflow-hidden rounded-md border border-line">
        <canvas ref={canvasRef} width={190} height={38} className="block h-[38px] w-full" />
      </div>

      <div>
        <label htmlFor={`audio-source-${id}`} className={nodeLabelClass}>Input source</label>
        <Select id={`audio-source-${id}`} value={sourceType} onChange={(e) => handleSourceChange(e.target.value as AudioSourceType)} className="nodrag">
          <option value="builtin">Built-in Synth Loop</option>
          <option value="file">Local Audio File</option>
          <option value="mic">Live Microphone</option>
        </Select>
      </div>

      {sourceType === "file" && (
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full nodrag">
          Choose audio file
        </Button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.aac,.flac"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className="flex items-center gap-2 border-t border-line pt-2">
        <Button size="sm" variant={isAudioPlaying ? "primary" : "secondary"} onClick={handleTogglePlay} className="flex-1 nodrag">
          {isAudioPlaying ? "Pause" : "Play"}
        </Button>
        <div className="flex flex-1 items-center gap-1.5 nodrag">
          <span className="select-none text-2xs text-fg-muted">Vol</span>
          <input
            type="range"
            aria-label="Volume"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            onPointerDown={stop}
            onMouseDown={stop}
            className={nodeRangeClass}
          />
        </div>
      </div>

      {selected && (
        <div className="flex flex-col gap-2 border-t border-line pt-2 text-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Spectrum dynamics</span>
            <Badge tone={isAudioPlaying ? "success" : "neutral"}>{isAudioPlaying ? "Live" : "Standby"}</Badge>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {([["bass", "Bass", "bg-warning"], ["mid", "Mid", "bg-info"], ["treble", "Treble", "bg-danger"], ["beat", "Beat", "bg-brand"]] as const).map(([k, label, bar]) => (
              <div key={k} className="rounded-md bg-raised p-1 text-center">
                <span className="block text-fg-muted">{label}</span>
                <span ref={gauge.text(k)} className="num text-fg">0%</span>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-active">
                  <div ref={gauge.bar(k)} className={cn("h-full", bar)} style={{ width: "0%" }} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 nodrag">
            <div className="flex items-center justify-between text-fg-muted">
              <span>Gain <span className="num text-fg">{audioGain.toFixed(1)}x</span></span>
              <span>Smooth <span className="num text-fg">{audioSmoothing.toFixed(2)}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 text-fg-muted">Gain</span>
              <input
                type="range"
                aria-label="Gain"
                min="0.1"
                max="3.0"
                step="0.1"
                value={audioGain}
                onChange={(e) => {
                  const g = parseFloat(e.target.value)
                  setAudioGain(g)
                  withAudioEngine((en) => en.setGainMultiplier(g))
                }}
                onPointerDown={stop}
                onMouseDown={stop}
                className={nodeRangeClass}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 text-fg-muted">Smooth</span>
              <input
                type="range"
                aria-label="Smoothing"
                min="0.1"
                max="0.95"
                step="0.05"
                value={audioSmoothing}
                onChange={(e) => {
                  const s = parseFloat(e.target.value)
                  setAudioSmoothing(s)
                  withAudioEngine((en) => en.setSmoothing(s))
                }}
                onPointerDown={stop}
                onMouseDown={stop}
                className={nodeRangeClass}
              />
            </div>
          </div>

          <div className="border-t border-line pt-1.5 text-center text-fg-subtle">512 bins, 44.1 kHz, Hann window</div>
        </div>
      )}
    </NodeShell>
  )
}

export const AudioNode = memo(AudioNodeComponent)
