import { useState, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { useProjectStore } from "@/stores/projectStore"
import type { EnvironmentPreset } from "@/core/environmentGenerator"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/panel"
import { NumericField } from "@/components/ui/numeric-field"
import { Upload } from "lucide-react"

export const ENVIRONMENT_PRESET_TILES: Array<{ id: EnvironmentPreset; label: string; desc: string }> = [
  { id: "atmosphere", label: "Atmosphere", desc: "Physically-based sky with time of day (see Render > Sky)" },
  { id: "daylight", label: "Daylight", desc: "Atmospheric daylight sky with 35° sun and horizon" },
  { id: "sunset", label: "Sunset", desc: "Golden hour gradient and amber horizon" },
  { id: "studio_warm", label: "Studio Warm", desc: "Key + warm rim softboxes" },
  { id: "nebula", label: "Nebula", desc: "Deep space Milky Way and starfield" },
  { id: "cyberpunk_neon", label: "Cyberpunk", desc: "Neon skyline and wet ground reflections" },
  { id: "clean_neutral", label: "Neutral", desc: "Balanced daylight softbox" },
  { id: "custom", label: "Custom", desc: "Upload or enter an equirectangular panorama" },
]

const QUICK_SKYMAPS = [
  { name: "Daylight", src: "/environments/daylight.jpg" },
  { name: "Sunset", src: "/environments/sunset.jpg" },
  { name: "Night", src: "/environments/night.jpg" },
  { name: "Studio", src: "/environments/studio.jpg" },
  { name: "Cyberpunk", src: "/environments/cyberpunk.jpg" },
]

const FALLBACK_ENV = { preset: "studio_warm" as EnvironmentPreset, exposure: 1.0, rotation: 0, backgroundBlur: 0.0, showSkybox: false, customTextureSrc: undefined as string | undefined }

export function EnvironmentSection() {
  const env = useProjectStore(
    useShallow((s) => {
      const e = s.environmentSettings ?? FALLBACK_ENV
      return { preset: e.preset, exposure: e.exposure, rotation: e.rotation, backgroundBlur: e.backgroundBlur, showSkybox: e.showSkybox, customTextureSrc: e.customTextureSrc }
    }),
  )
  const setEnvironmentPreset = useProjectStore((s) => s.setEnvironmentPreset)
  const setEnvironmentExposure = useProjectStore((s) => s.setEnvironmentExposure)
  const setEnvironmentRotation = useProjectStore((s) => s.setEnvironmentRotation)
  const setEnvironmentSkybox = useProjectStore((s) => s.setEnvironmentSkybox)
  const setEnvironmentSettings = useProjectStore((s) => s.setEnvironmentSettings)

  const [customUrl, setCustomUrl] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      if (typeof evt.target?.result === "string") setEnvironmentSettings({ preset: "custom", customTextureSrc: evt.target.result })
    }
    reader.readAsDataURL(file)
  }

  const applyUrl = () => {
    const trimmed = customUrl.trim()
    if (trimmed) setEnvironmentSettings({ preset: "custom", customTextureSrc: trimmed })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">Lighting preset</span>
        <div role="group" aria-label="Lighting preset" className="grid grid-cols-2 gap-1.5">
          {ENVIRONMENT_PRESET_TILES.map((p) => {
            const selected = env.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                title={p.desc}
                aria-pressed={selected}
                onClick={() => setEnvironmentPreset(p.id)}
                className={cn(
                  "h-8 truncate rounded-md border px-2 text-xs font-medium transition-colors",
                  selected ? "border-brand bg-brand-soft text-brand-text" : "border-line bg-raised text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {env.preset === "custom" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised/50 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">Panoramic skymap</span>
            {env.customTextureSrc ? <span className="text-xs text-success">Loaded</span> : null}
          </div>
          <input type="file" ref={fileInputRef} accept="image/*" aria-label="Upload skymap" className="hidden" onChange={handleFileUpload} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-3.5" />
            Upload image
          </Button>
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="https://.../panorama.jpg"
              aria-label="Skymap URL"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyUrl()
              }}
              className="flex-1 font-mono text-xs"
            />
            <Button variant="secondary" size="sm" onClick={applyUrl}>Load</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="w-full text-2xs text-fg-subtle">Quick skymaps</span>
            {QUICK_SKYMAPS.map((q) => (
              <Button key={q.name} variant="ghost" size="sm" onClick={() => setEnvironmentSettings({ preset: "custom", customTextureSrc: q.src })}>
                {q.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Field label="Exposure">
          <NumericField aria-label="Exposure" value={env.exposure} min={0.1} max={4} step={0.05} unit="x" onChange={setEnvironmentExposure} className="w-28" />
        </Field>
        <Field label="Rotation">
          <NumericField aria-label="Rotation" value={env.rotation} min={0} max={360} step={1} unit="°" onChange={setEnvironmentRotation} className="w-28" />
        </Field>
        <Field label="Background blur">
          <NumericField aria-label="Background blur" value={env.backgroundBlur} min={0} max={1} step={0.05} onChange={(v) => setEnvironmentSettings({ backgroundBlur: v })} className="w-28" />
        </Field>
        <Field label="Show skybox">
          <Switch aria-label="Show skybox" checked={env.showSkybox} onCheckedChange={setEnvironmentSkybox} />
        </Field>
      </div>
    </div>
  )
}
