import type { ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import { useProjectStore } from "@/stores/projectStore"
import { useRenderSettingsStore } from "@/stores/renderSettingsStore"
import { getActiveAdapter } from "@/adapters/activeAdapter"
import type { BokehShape, GBufferDebugView, RenderSettings } from "@/adapters/types"
import { Button } from "@/components/ui/button"
import { NumericField } from "@/components/ui/numeric-field"
import { Section, Field } from "@/components/ui/panel"
import { Segmented } from "@/components/ui/segmented"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip } from "@/components/ui/tooltip"
import { RotateCcw } from "lucide-react"

const BACKEND_NAME = { webgpu: "WebGPU", webgl2: "WebGL2", threejs: "Three.js" } as const
const GBUFFER_VIEWS: GBufferDebugView[] = ["none", "albedo", "normal", "roughness", "metallic", "depth", "motion"]
const BOKEH_SHAPES: BokehShape[] = ["circle", "hexagon", "octagon"]
const RESOLUTIONS = [512, 1024, 2048, 4096] as const

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Wraps a control with a tooltip explaining why it is disabled. Renders children untouched when supported. */
function WithReason({ reason, children }: { reason?: string; children: ReactNode }) {
  if (!reason) return <>{children}</>
  return (
    <Tooltip label={reason}>
      <span className="inline-flex" aria-disabled>
        {children}
      </span>
    </Tooltip>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg-subtle">{children}</p>
}

/** Advanced controls live in a closed Section; -mx-3 cancels the accordion padding so the Section lines up. */
function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="-mx-3 border-t border-line">
      <Section title={title} defaultOpen={false} className="border-b-0">
        {children}
      </Section>
    </div>
  )
}

export function RenderSection() {
  const settings = useRenderSettingsStore((s) => s.settings)
  const setRenderMode = useRenderSettingsStore((s) => s.setRenderMode)
  const setAntiAliasing = useRenderSettingsStore((s) => s.setAntiAliasing)
  const setGBufferDebugView = useRenderSettingsStore((s) => s.setGBufferDebugView)
  const updateSection = useRenderSettingsStore((s) => s.updateSection)
  const reset = useRenderSettingsStore((s) => s.reset)

  const backend = useProjectStore((s) => s.activeBackend) as keyof typeof BACKEND_NAME
  const sky = useProjectStore(useShallow((s) => ({ preset: s.environmentSettings?.preset, showSkybox: s.environmentSettings?.showSkybox })))
  const setEnvironmentSettings = useProjectStore((s) => s.setEnvironmentSettings)
  const setEnvironmentSkybox = useProjectStore((s) => s.setEnvironmentSkybox)

  const caps = getActiveAdapter()?.getFidelityCapabilities?.()
  const backendName = BACKEND_NAME[backend] ?? backend
  const reasonFor = (path: string) => (caps?.unsupported.includes(path) ? `Not supported on ${backendName}` : undefined)
  const vsmFallback = settings.shadows.filterMode === "vsm" && caps?.effectiveShadowFilter === "pcf"

  const { shadows, ssao, ssr, dof } = settings
  const skyOn = sky.preset === "atmosphere" && !!sky.showSkybox
  const deferred = settings.renderMode === "deferred"

  const num = <K extends "shadows" | "ssao" | "ssr" | "dof" | "atmosphere">(section: K, key: keyof RenderSettings[K] & string, label: string, opts: { min?: number; max?: number; step: number; unit?: string }, path = `${section}.${key}`) => {
    const value = (settings[section] as unknown as Record<string, number>)[key]
    const reason = reasonFor(path)
    return (
      <Field label={label}>
        <WithReason reason={reason}>
          <NumericField
            aria-label={label}
            value={value}
            disabled={!!reason}
            {...opts}
            className="w-28"
            onChange={(v) => updateSection(section, { [key]: v } as Partial<RenderSettings[K]>)}
          />
        </WithReason>
      </Field>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Render mode">
        <Segmented
          aria-label="Render mode"
          value={settings.renderMode}
          onValueChange={setRenderMode}
          options={[
            { value: "forward", label: "Forward" },
            { value: "deferred", label: "Deferred" },
          ]}
        />
      </Field>
      {deferred && backend === "webgpu" ? <Hint>Deferred shading uses the material&apos;s base colour; custom shader effects show in Forward.</Hint> : null}

      <Field label="Anti-aliasing">
        <Segmented
          aria-label="Anti-aliasing"
          value={settings.antiAliasing}
          onValueChange={setAntiAliasing}
          options={[
            { value: "none", label: "None" },
            { value: "fxaa", label: "FXAA" },
            { value: "taa", label: "TAA" },
          ]}
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Field label="Sky">
          <Switch
            aria-label="Sky"
            checked={skyOn}
            onCheckedChange={(on) => (on ? setEnvironmentSettings({ preset: "atmosphere", showSkybox: true }) : setEnvironmentSkybox(false))}
          />
        </Field>
        {backend === "threejs" ? <Hint>Three.js shows its sky once the sky settings differ from the defaults.</Hint> : null}
        <Advanced title="Sky settings">
          {num("atmosphere", "timeOfDay", "Time of day", { min: 0, max: 24, step: 0.25, unit: "h" })}
          {num("atmosphere", "sunIntensity", "Sun intensity", { min: 0, max: 10, step: 0.1 })}
          {num("atmosphere", "turbidity", "Turbidity", { min: 1, max: 10, step: 0.1 })}
          {num("atmosphere", "solarElevationDeg", "Sun elevation", { min: 0, max: 90, step: 1, unit: "°" })}
        </Advanced>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Shadows">
          <Switch aria-label="Shadows" checked={shadows.enabled} onCheckedChange={(enabled) => updateSection("shadows", { enabled })} />
        </Field>
        {backend === "threejs" && shadows.enabled ? <Hint>Custom shaders don&apos;t receive shadows here; they show on the ground plane.</Hint> : null}
        <Advanced title="Shadow settings">
          <Field label="Resolution">
            <Select aria-label="Shadow resolution" className="w-28" value={String(shadows.resolution)} onChange={(e) => updateSection("shadows", { resolution: Number(e.target.value) as (typeof RESOLUTIONS)[number] })}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Filter">
            <Select aria-label="Shadow filter" className="w-28" value={shadows.filterMode} onChange={(e) => updateSection("shadows", { filterMode: e.target.value as "pcf" | "vsm" })}>
              <option value="pcf">PCF</option>
              <option value="vsm">VSM</option>
            </Select>
          </Field>
          {vsmFallback ? <Hint>VSM unavailable on this GPU, using PCF.</Hint> : null}
          {num("shadows", "bias", "Bias", { min: 0, max: 0.1, step: 0.001 })}
          {num("shadows", "normalBias", "Normal bias", { min: 0, max: 0.2, step: 0.001 })}
          <Field label="Point-light shadows">
            <Switch aria-label="Point-light shadows" checked={shadows.pointShadows} onCheckedChange={(pointShadows) => updateSection("shadows", { pointShadows })} />
          </Field>
        </Advanced>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Ambient occlusion">
          <Switch aria-label="SSAO" checked={ssao.enabled} onCheckedChange={(enabled) => updateSection("ssao", { enabled })} />
        </Field>
        <Advanced title="SSAO settings">
          {num("ssao", "radius", "Radius", { min: 0.05, max: 4, step: 0.05 })}
          {num("ssao", "intensity", "Intensity", { min: 0, max: 4, step: 0.05 })}
          {num("ssao", "sampleCount", "Samples", { min: 4, max: 64, step: 1 })}
          {num("ssao", "bias", "AO bias", { min: 0, max: 0.2, step: 0.005 })}
        </Advanced>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Reflections (SSR)">
          <Switch aria-label="SSR" checked={ssr.enabled} onCheckedChange={(enabled) => updateSection("ssr", { enabled })} />
        </Field>
        <Advanced title="SSR settings">
          {num("ssr", "maxSteps", "Max steps", { min: 8, max: 256, step: 1 })}
          {num("ssr", "thickness", "Thickness", { min: 0.001, max: 0.5, step: 0.005 })}
          {num("ssr", "falloff", "Falloff", { min: 0, max: 1, step: 0.05 })}
          {num("ssr", "iblBlend", "IBL blend", { min: 0, max: 1, step: 0.05 })}
        </Advanced>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Depth of field">
          <Switch aria-label="DoF" checked={dof.enabled} onCheckedChange={(enabled) => updateSection("dof", { enabled })} />
        </Field>
        <Advanced title="Depth of field settings">
          {num("dof", "focalDistance", "Focal distance", { min: 0.1, max: 100, step: 0.1 })}
          {num("dof", "aperture", "Aperture", { min: 0, max: 1, step: 0.01 })}
          {num("dof", "maxBlur", "Max blur", { min: 0, max: 32, step: 0.5 })}
          <Field label="Bokeh shape">
            <WithReason reason={reasonFor("dof.bokehShape")}>
              <Select
                aria-label="Bokeh shape"
                className="w-28"
                disabled={!!reasonFor("dof.bokehShape")}
                value={BOKEH_SHAPES.find((s) => dof.bokehShape.startsWith(s.slice(0, 5))) ?? "circle"}
                onChange={(e) => updateSection("dof", { bokehShape: e.target.value as BokehShape })}
              >
                {BOKEH_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {sentence(s)}
                  </option>
                ))}
              </Select>
            </WithReason>
          </Field>
        </Advanced>
      </div>

      <Field label="G-buffer view">
        <WithReason reason={deferred ? undefined : "Switch to Deferred to inspect the G-buffer"}>
          <Select aria-label="G-buffer debug view" className="w-28" disabled={!deferred} value={settings.gbufferDebugView} onChange={(e) => setGBufferDebugView(e.target.value as GBufferDebugView)}>
            {GBUFFER_VIEWS.map((v) => (
              <option key={v} value={v}>
                {sentence(v)}
              </option>
            ))}
          </Select>
        </WithReason>
      </Field>

      <Button variant="ghost" size="sm" className="self-start" onClick={reset}>
        <RotateCcw />
        Reset render settings
      </Button>
    </div>
  )
}
