import { useEffect, useRef, type ChangeEvent } from "react"
import { useProjectStore, type AudioSourceType } from "@/stores/projectStore"
import { getAudioEngine, loadAudioEngine, withAudioEngine } from "@/audio/audioRegistry"
import { useAudioGauges, type GaugeKey } from "@/components/nodes/useAudioFrame"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Field } from "@/components/ui/panel"
import { Play, Pause, X, Music, Upload, Mic } from "lucide-react"

// Gauge tint per band (semantic data colours, not brand).
const GAUGES: Array<{ key: GaugeKey; label: string; tone: string; bar: string }> = [
  { key: "bass", label: "BASS", tone: "text-warning", bar: "bg-warning" },
  { key: "mid", label: "MID", tone: "text-info", bar: "bg-info" },
  { key: "treble", label: "TREBLE", tone: "text-danger", bar: "bg-danger" },
  { key: "beat", label: "BEAT", tone: "text-brand-text", bar: "bg-brand" },
  { key: "level", label: "LEVEL", tone: "text-success", bar: "bg-success" },
]

const SOURCES: Array<{ type: AudioSourceType; label: string; icon: typeof Music }> = [
  { type: "builtin", label: "Built-in", icon: Music },
  { type: "file", label: "File", icon: Upload },
  { type: "mic", label: "Mic", icon: Mic },
]

export function AudioDynamicsSection() {
  const isAudioPlaying = useProjectStore((s) => s.isAudioPlaying)
  const setIsAudioPlaying = useProjectStore((s) => s.setIsAudioPlaying)
  const audioGain = useProjectStore((s) => s.audioGain)
  const setAudioGain = useProjectStore((s) => s.setAudioGain)
  const audioSmoothing = useProjectStore((s) => s.audioSmoothing)
  const setAudioSmoothing = useProjectStore((s) => s.setAudioSmoothing)
  const audioSourceType = useProjectStore((s) => s.audioSourceType)
  const setAudioSourceType = useProjectStore((s) => s.setAudioSourceType)
  const audioBindings = useProjectStore((s) => s.audioBindings)
  const setAudioBinding = useProjectStore((s) => s.setAudioBinding)

  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void loadAudioEngine()
  }, [])
  // Gauges are written straight to the DOM at <=15Hz (see useAudioGauges): no React state per frame.
  const gauge = useAudioGauges("audio-dynamics-gauges", isAudioPlaying)

  const handleTogglePlay = async () => {
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    setIsAudioPlaying(audioEngine.togglePlay())
  }

  const handleSourceChange = async (type: AudioSourceType) => {
    setAudioSourceType(type)
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    await audioEngine.setSourceType(type)
    setIsAudioPlaying(audioEngine.getIsPlaying())
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
      await audioEngine.loadCustomAudioFile(file)
      setAudioSourceType("file")
      setIsAudioPlaying(audioEngine.getIsPlaying())
    }
  }

  const handleStartMic = async () => {
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    await audioEngine.startMicrophone()
    setAudioSourceType("mic")
    setIsAudioPlaying(audioEngine.getIsPlaying())
  }

  const handleSourceClick = (type: AudioSourceType) => {
    if (type === "mic") void handleStartMic()
    else if (type === "file" && audioSourceType === "file") fileInputRef.current?.click()
    else void handleSourceChange(type)
  }

  const bindingEntries = Object.entries(audioBindings)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", isAudioPlaying ? "animate-pulse bg-success" : "bg-fg-disabled")} />
          <span className="text-xs text-fg-muted">{isAudioPlaying ? "Audio Engine Active" : "Audio Suspended"}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={handleTogglePlay}>
          {isAudioPlaying ? <Pause /> : <Play />}
          {isAudioPlaying ? "Pause Audio" : "Play Audio"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">Input source</span>
        <div role="group" aria-label="Input source" className="grid grid-cols-3 gap-1.5">
          {SOURCES.map(({ type, label, icon: Icon }) => (
            <Button key={type} size="sm" variant={audioSourceType === type ? "primary" : "secondary"} aria-pressed={audioSourceType === type} onClick={() => handleSourceClick(type)}>
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
        <input type="file" ref={fileInputRef} accept="audio/*" aria-label="Upload audio file" className="hidden" onChange={handleFileUpload} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">Real-Time VU Spectrum</span>
        <div className="grid grid-cols-5 gap-1.5 text-center">
          {GAUGES.map((g) => (
            <div key={g.key} className="flex flex-col gap-1 rounded-md border border-line bg-raised/50 p-1.5">
              <span className="text-2xs text-fg-subtle">{g.label}</span>
              <span ref={gauge.text(g.key)} className={cn("num text-xs", g.tone)}>
                0%
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-active">
                <div ref={gauge.bar(g.key)} className={cn("h-full rounded-full", g.bar)} style={{ width: "0%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Field label="Gain">
          <div className="flex w-44 items-center gap-2">
            <Slider
              aria-label="Gain"
              value={[audioGain]}
              min={0.1}
              max={5}
              step={0.05}
              onValueChange={([v]) => {
                setAudioGain(v)
                withAudioEngine((e) => e.setGainMultiplier(v))
              }}
            />
            <span className="num w-10 text-right text-xs text-fg-muted">{audioGain.toFixed(2)}x</span>
          </div>
        </Field>
        <Field label="Smoothing">
          <div className="flex w-44 items-center gap-2">
            <Slider
              aria-label="Smoothing"
              value={[audioSmoothing]}
              min={0}
              max={0.95}
              step={0.05}
              onValueChange={([v]) => {
                setAudioSmoothing(v)
                withAudioEngine((e) => e.setSmoothing(v))
              }}
            />
            <span className="num w-10 text-right text-xs text-fg-muted">{audioSmoothing.toFixed(2)}</span>
          </div>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">Active Audio Bindings ({bindingEntries.length})</span>
        {bindingEntries.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-3 text-center text-xs text-fg-subtle">No uniforms bound to audio. Use the audio button on a scalar uniform to modulate it.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {bindingEntries.map(([name, binding]) => (
              <div key={name} className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised/50 py-0.5 pl-2.5 pr-0.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-mono text-xs text-fg">{name}</span>
                  <span className="text-xs text-brand-text">{binding.band}</span>
                  <span className="num text-xs text-fg-subtle">{binding.amount.toFixed(1)}x</span>
                </div>
                <IconButton label={`Disconnect ${name}`} className="size-7" onClick={() => setAudioBinding(name, null)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
