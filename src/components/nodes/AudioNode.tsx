import { memo, useRef, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { AudioNodeData } from "@/core/graphCompiler"
import { audioEngine, type AudioSourceType } from "@/audio/audioEngine"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"

function AudioNodeComponent({ id, data, selected }: FlowNodeProps<AudioNodeData>) {
  const isAudioPlaying = useProjectStore((s) => s.isAudioPlaying)
  const setIsAudioPlaying = useProjectStore((s) => s.setIsAudioPlaying)
  const audioGain = useProjectStore((s) => s.audioGain)
  const setAudioGain = useProjectStore((s) => s.setAudioGain)
  const audioSmoothing = useProjectStore((s) => s.audioSmoothing)
  const setAudioSmoothing = useProjectStore((s) => s.setAudioSmoothing)

  const [sourceType, setSourceType] = useState<AudioSourceType>(data.sourceType || "builtin")
  const [volume, setVolume] = useState<number>(data.volume ?? 0.8)
  const [gauges, setGauges] = useState({ bass: 0, mid: 0, treble: 0, beat: 0, level: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selected) return
    let animId: number
    const tick = () => {
      const u = audioEngine.uniforms
      setGauges({
        bass: Math.min(100, Math.round(u.bass * 100)),
        mid: Math.min(100, Math.round(u.mid * 100)),
        treble: Math.min(100, Math.round(u.treble * 100)),
        beat: Math.min(100, Math.round(u.beat * 100)),
        level: Math.min(100, Math.round(u.level * 100)),
      })
      animId = requestAnimationFrame(tick)
    }
    animId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animId)
  }, [selected])

  // Synchronize playing state
  const handleTogglePlay = useCallback(async () => {
    const isPlaying = audioEngine.togglePlay()
    setIsAudioPlaying(isPlaying)
  }, [setIsAudioPlaying])

  const handleSourceChange = async (newSource: AudioSourceType) => {
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
      const ok = await audioEngine.loadCustomAudioFile(file)
      if (ok) {
        setSourceType("file")
        setIsAudioPlaying(audioEngine.getIsPlaying())
      }
    }
  }

  const handleVolumeChange = (vol: number) => {
    setVolume(vol)
    audioEngine.setVolume(vol)
    useProjectStore.getState().setAudioVolume(vol)
  }

  // Mini VU meter visualizer loop on the node canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animId: number
    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Background subtle grid
      ctx.fillStyle = "rgba(10, 15, 25, 0.95)"
      ctx.fillRect(0, 0, w, h)

      const numBars = 24
      const barWidth = (w - (numBars - 1) * 2) / numBars
      const uniforms = audioEngine.uniforms

      // Draw frequency spectrum bars
      for (let i = 0; i < numBars; i++) {
        // Sample bins across the 512-bin spectrum
        const binIdx = Math.floor(Math.pow(i / numBars, 1.5) * 240)
        const val = audioEngine.textureBuffer[binIdx] / 255
        const barHeight = Math.max(2, val * (h - 4))

        // Heatmap color: Cyan -> Magenta -> Yellow on kick beat
        const r = Math.floor(uniforms.beat * 255 * (i / numBars))
        const g = Math.floor(val * 220 + uniforms.mid * 35)
        const b = Math.floor((1 - val) * 240 + uniforms.bass * 15)

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(i * (barWidth + 2), h - barHeight - 2, barWidth, barHeight)
      }

      // Draw beat pulse glow bar on bottom
      if (uniforms.beat > 0.1) {
        ctx.fillStyle = `rgba(255, 255, 255, ${uniforms.beat * 0.8})`
        ctx.fillRect(0, h - 2, w, 2)
      }

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [])

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
                <span className="font-bold text-amber-400">{gauges.bass}%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all duration-75" style={{ width: `${gauges.bass}%` }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">MID</span>
                <span className="font-bold text-cyan-400">{gauges.mid}%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-cyan-400 transition-all duration-75" style={{ width: `${gauges.mid}%` }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">TREBLE</span>
                <span className="font-bold text-pink-400">{gauges.treble}%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-pink-400 transition-all duration-75" style={{ width: `${gauges.treble}%` }} />
                </div>
              </div>
              <div className="bg-background/80 p-1 rounded border border-border/50 text-center">
                <span className="text-[8px] text-muted-foreground block">BEAT</span>
                <span className="font-bold text-purple-400">{gauges.beat}%</span>
                <div className="h-1 w-full bg-muted rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-purple-400 transition-all duration-75" style={{ width: `${gauges.beat}%` }} />
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
                    audioEngine.setGainMultiplier(g)
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
                    audioEngine.setSmoothing(s)
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
