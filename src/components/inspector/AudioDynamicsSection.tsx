import { useEffect, useRef, type ChangeEvent } from "react"
import { useProjectStore, type AudioSourceType } from "@/stores/projectStore"
import { getAudioEngine, loadAudioEngine, withAudioEngine } from "@/audio/audioRegistry"
import { useAudioGauges } from "@/components/nodes/useAudioFrame"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Play, Pause, X, Music, Upload, Mic } from "lucide-react"

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
  useEffect(() => { void loadAudioEngine() }, [])
  const gauge = useAudioGauges("audio-dynamics-gauges", isAudioPlaying)

  const handleTogglePlay = async () => {
    const audioEngine = getAudioEngine() ?? (await loadAudioEngine())
    const isPlaying = audioEngine.togglePlay()
    setIsAudioPlaying(isPlaying)
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

  const handleGainChange = (g: number) => {
    setAudioGain(g)
    withAudioEngine((e) => e.setGainMultiplier(g))
  }

  const handleSmoothingChange = (s: number) => {
    setAudioSmoothing(s)
    withAudioEngine((e) => e.setSmoothing(s))
  }

  const bindingEntries = Object.entries(audioBindings)

  return (
    <div className="flex flex-col gap-3">
      {/* Playback Controls & Status */}
      <div className="flex items-center justify-between p-2 rounded-md bg-muted/10 border border-border/40">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full transition-colors",
              isAudioPlaying ? "bg-emerald-400 animate-pulse shadow-xs shadow-emerald-400/50" : "bg-muted-foreground/50"
            )}
          />
          <span className="text-xs font-semibold text-foreground">
            {isAudioPlaying ? "Audio Engine Active" : "Audio Suspended"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTogglePlay}
          className="h-7 px-2.5 text-xs font-mono gap-1.5"
        >
          {isAudioPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>{isAudioPlaying ? "Pause Audio" : "Play Audio"}</span>
        </Button>
      </div>

      {/* Audio Source Selector */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-medium">Input Source</Label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleSourceChange("builtin")}
            className={cn(
              "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border cursor-pointer",
              audioSourceType === "builtin"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-muted/30 text-muted-foreground border-border hover:text-foreground hover:bg-muted/60"
            )}
          >
            <Music className="h-3 w-3" />
            <span>Built-in</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (audioSourceType === "file") {
                fileInputRef.current?.click()
              } else {
                handleSourceChange("file")
              }
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border cursor-pointer",
              audioSourceType === "file"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-muted/30 text-muted-foreground border-border hover:text-foreground hover:bg-muted/60"
            )}
          >
            <Upload className="h-3 w-3" />
            <span>File</span>
          </button>
          <button
            type="button"
            onClick={handleStartMic}
            className={cn(
              "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border cursor-pointer",
              audioSourceType === "mic"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-muted/30 text-muted-foreground border-border hover:text-foreground hover:bg-muted/60"
            )}
          >
            <Mic className="h-3 w-3" />
            <span>Mic</span>
          </button>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          accept="audio/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {/* Live VU Meter Gauges with Animated Level Bars */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-medium">Real-Time VU Spectrum</Label>
        <div className="grid grid-cols-5 gap-1.5 text-center font-mono">
          {/* BASS */}
          <div className="bg-muted/20 rounded p-1.5 border border-border/50 flex flex-col justify-between">
            <div>
              <span className="text-[9px] text-muted-foreground font-semibold block">BASS</span>
              <span ref={gauge.text("bass")} className="text-xs font-bold text-amber-400">0%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
              <div
                ref={gauge.bar("bass")}
                className="h-full bg-amber-400 rounded-full"
                style={{ width: "0%" }}
              />
            </div>
          </div>

          {/* MID */}
          <div className="bg-muted/20 rounded p-1.5 border border-border/50 flex flex-col justify-between">
            <div>
              <span className="text-[9px] text-muted-foreground font-semibold block">MID</span>
              <span ref={gauge.text("mid")} className="text-xs font-bold text-cyan-400">0%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
              <div
                ref={gauge.bar("mid")}
                className="h-full bg-cyan-400 rounded-full"
                style={{ width: "0%" }}
              />
            </div>
          </div>

          {/* TREBLE */}
          <div className="bg-muted/20 rounded p-1.5 border border-border/50 flex flex-col justify-between">
            <div>
              <span className="text-[9px] text-muted-foreground font-semibold block">TREBLE</span>
              <span ref={gauge.text("treble")} className="text-xs font-bold text-pink-400">0%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
              <div
                ref={gauge.bar("treble")}
                className="h-full bg-pink-400 rounded-full"
                style={{ width: "0%" }}
              />
            </div>
          </div>

          {/* BEAT */}
          <div className="bg-muted/20 rounded p-1.5 border border-border/50 flex flex-col justify-between">
            <div>
              <span className="text-[9px] text-muted-foreground font-semibold block">BEAT</span>
              <span ref={gauge.text("beat")} className="text-xs font-bold text-purple-400">0%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
              <div
                ref={gauge.bar("beat")}
                className="h-full bg-purple-400 rounded-full"
                style={{ width: "0%" }}
              />
            </div>
          </div>

          {/* LEVEL */}
          <div className="bg-muted/20 rounded p-1.5 border border-border/50 flex flex-col justify-between">
            <div>
              <span className="text-[9px] text-muted-foreground font-semibold block">LEVEL</span>
              <span ref={gauge.text("level")} className="text-xs font-bold text-emerald-400">0%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
              <div
                ref={gauge.bar("level")}
                className="h-full bg-emerald-400 rounded-full"
                style={{ width: "0%" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sensitivity & Smoothing Sliders */}
      <div className="flex flex-col gap-2.5 pt-1">
        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Gain / Sensitivity</Label>
            <span className="text-muted-foreground">{audioGain.toFixed(2)}x</span>
          </div>
          <Slider
            value={[audioGain]}
            min={0.1}
            max={5.0}
            step={0.05}
            onValueChange={([v]) => handleGainChange(v)}
          />
        </div>

        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">FFT Smoothing</Label>
            <span className="text-muted-foreground">{audioSmoothing.toFixed(2)}</span>
          </div>
          <Slider
            value={[audioSmoothing]}
            min={0.0}
            max={0.95}
            step={0.05}
            onValueChange={([v]) => handleSmoothingChange(v)}
          />
        </div>
      </div>

      {/* Reactive Uniform Bindings List */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground font-medium">
            Active Audio Bindings ({bindingEntries.length})
          </Label>
        </div>

        {bindingEntries.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground rounded-md bg-muted/10 border border-dashed border-border/60">
            No uniforms bound to audio. Click the &quot;Audio&quot; badge on any scalar uniform above to modulate.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {bindingEntries.map(([name, binding]) => (
              <div
                key={name}
                className="flex items-center justify-between p-2 rounded-md bg-muted/20 border border-border/50 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/20 text-primary border border-primary/30">
                    {binding.band}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {binding.amount.toFixed(1)}x
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAudioBinding(name, null)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors cursor-pointer"
                  title="Disconnect audio binding"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
