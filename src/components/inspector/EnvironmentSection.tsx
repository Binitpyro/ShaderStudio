import { useState, useRef } from "react"
import { useProjectStore } from "@/stores/projectStore"
import type { EnvironmentPreset } from "@/core/environmentGenerator"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Upload, Image as ImageIcon } from "lucide-react"

const ENVIRONMENT_PRESETS: Array<{ id: EnvironmentPreset; label: string; desc: string }> = [
  { id: "daylight", label: "Daylight", desc: "Atmospheric daylight sky with 35° sun & horizon" },
  { id: "sunset", label: "Sunset", desc: "Golden hour gradient & amber horizon" },
  { id: "studio_warm", label: "Studio Warm", desc: "Key + warm rim softboxes" },
  { id: "nebula", label: "Nebula", desc: "Deep space Milky Way & starfield" },
  { id: "cyberpunk_neon", label: "Cyberpunk", desc: "Neon skyline & wet ground reflections" },
  { id: "clean_neutral", label: "Neutral", desc: "Balanced daylight softbox" },
  { id: "custom", label: "Custom", desc: "Upload or enter equirectangular panoramic skymap" },
]

export function EnvironmentSection() {
  const env = useProjectStore((s) => s.environmentSettings) || {
    preset: "studio_warm",
    exposure: 1.0,
    rotation: 0,
    backgroundBlur: 0.0,
    showSkybox: false,
  }

  const setEnvironmentPreset = useProjectStore((s) => s.setEnvironmentPreset)
  const setEnvironmentExposure = useProjectStore((s) => s.setEnvironmentExposure)
  const setEnvironmentRotation = useProjectStore((s) => s.setEnvironmentRotation)
  const setEnvironmentSkybox = useProjectStore((s) => s.setEnvironmentSkybox)
  const setEnvironmentSettings = useProjectStore((s) => s.setEnvironmentSettings)

  const [customUrlInput, setCustomUrlInput] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      if (typeof evt.target?.result === "string") {
        setEnvironmentSettings({
          preset: "custom",
          customTextureSrc: evt.target.result,
        })
      }
    }
    reader.readAsDataURL(file)
  }

  const handleApplyUrl = () => {
    const trimmed = customUrlInput.trim()
    if (!trimmed) return
    setEnvironmentSettings({
      preset: "custom",
      customTextureSrc: trimmed,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Preset Pills */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-medium">Lighting Preset</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {ENVIRONMENT_PRESETS.map((p) => {
            const isSelected = env.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setEnvironmentPreset(p.id)}
                title={p.desc}
                className={cn(
                  "px-2 py-1.5 rounded-md text-center text-[11px] font-medium transition-all border cursor-pointer truncate",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-muted/30 text-muted-foreground border-border hover:text-foreground hover:bg-muted/60 hover:border-primary/40"
                )}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom Panoramic Skymap Loader */}
      {env.preset === "custom" && (
        <div className="flex flex-col gap-2 p-2.5 rounded-md bg-muted/20 border border-border/60 text-xs">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-primary" />
              Standard Panoramic Skymap
            </Label>
            {env.customTextureSrc && (
              <span className="text-[10px] text-emerald-400 font-mono">Loaded</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-[11px] font-medium cursor-pointer transition-colors"
            >
              <Upload className="w-3 h-3" />
              Upload Image (.jpg, .png)
            </button>
          </div>

          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="https://.../panorama.jpg"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApplyUrl()
              }}
              className="flex-1 bg-background/60 border border-border/60 rounded px-2 py-1 text-[11px] font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleApplyUrl}
              className="px-2 py-1 rounded bg-secondary hover:bg-secondary/80 text-secondary-foreground text-[11px] font-medium cursor-pointer border border-border/40"
            >
              Load
            </button>
          </div>

          {/* Quick Standard Skymap Presets */}
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="text-[10px] text-muted-foreground w-full">Quick standard skymaps:</span>
            {[
              { name: "Daylight", src: "/environments/daylight.jpg" },
              { name: "Sunset", src: "/environments/sunset.jpg" },
              { name: "Night", src: "/environments/night.jpg" },
              { name: "Studio", src: "/environments/studio.jpg" },
              { name: "Cyberpunk", src: "/environments/cyberpunk.jpg" },
            ].map((quick) => (
              <button
                key={quick.name}
                type="button"
                onClick={() => setEnvironmentSettings({ preset: "custom", customTextureSrc: quick.src })}
                className="px-1.5 py-0.5 rounded bg-muted/40 hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground border border-border/40 cursor-pointer"
              >
                {quick.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sliders & Controls */}
      <div className="flex flex-col gap-3 pt-1">
        {/* Exposure */}
        <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Exposure</Label>
            <span className="text-muted-foreground">{env.exposure.toFixed(2)}x</span>
          </div>
          <Slider
            value={[env.exposure]}
            min={0.1}
            max={4.0}
            step={0.05}
            onValueChange={([v]) => setEnvironmentExposure(v)}
          />
        </div>

        {/* Rotation */}
        <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Rotation</Label>
            <span className="text-muted-foreground">{Math.round(env.rotation)}°</span>
          </div>
          <Slider
            value={[env.rotation]}
            min={0}
            max={360}
            step={1}
            onValueChange={([v]) => setEnvironmentRotation(v)}
          />
        </div>

        {/* Background Blur */}
        <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Background Blur</Label>
            <span className="text-muted-foreground">{env.backgroundBlur.toFixed(2)}</span>
          </div>
          <Slider
            value={[env.backgroundBlur]}
            min={0.0}
            max={1.0}
            step={0.05}
            onValueChange={([v]) => setEnvironmentSettings({ backgroundBlur: v })}
          />
        </div>

        {/* Skybox Switch */}
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex flex-col">
            <Label className="text-xs font-medium">Show Skybox</Label>
            <span className="text-[10px] text-muted-foreground">
              Render 360° environment in background
            </span>
          </div>
          <Switch
            checked={env.showSkybox}
            onCheckedChange={(checked) => setEnvironmentSkybox(checked)}
          />
        </div>
      </div>
    </div>
  )
}
