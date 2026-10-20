import { useState, useMemo, useRef, type ReactNode } from "react"
import {
  useProjectStore,
  getDefaultUniformValue,
  type ParsedUniform,
  type UniformValue,
  type AudioBinding,
  type GraphUniform,
} from "@/stores/projectStore"
import { getActiveAdapter } from "@/adapters/activeAdapter"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { NumericField } from "@/components/ui/numeric-field"
import { ColorField } from "@/components/ui/color-field"
import { Search, X, RotateCcw, Activity, ImagePlus } from "lucide-react"

function getDefaultValueFor(uniform: ParsedUniform, graphUniforms: GraphUniform[]): UniformValue {
  const gu = graphUniforms.find((g) => g.name === uniform.name)
  if (gu) {
    if (typeof gu.defaultValue === "boolean") return { type: "bool", value: gu.defaultValue }
    if (typeof gu.defaultValue === "number") return { type: "float", value: gu.defaultValue }
    if (Array.isArray(gu.defaultValue)) {
      const len = gu.defaultValue.length
      const type = len === 2 ? "vec2" : len === 3 ? (gu.type === "color" ? "color" : "vec3") : "vec4"
      return { type, value: [...gu.defaultValue] }
    }
  }
  return getDefaultUniformValue(uniform)
}

const BANDS = ["bass", "mid", "treble", "beat", "level"] as const

/** Push a value to the store and straight to the active adapter (no recompile). */
function useUniformWriter(name: string, onChange: (v: UniformValue) => void) {
  return (v: UniformValue) => {
    onChange(v)
    getActiveAdapter()?.updateUniform(name, v)
  }
}

interface RowProps {
  uniform: ParsedUniform
  value: UniformValue | undefined
  onChange: (value: UniformValue) => void
  onReset: () => void
}

const REVEAL = "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"

/** Name + type on the left, small actions on the right, control below. */
function Row({ uniform, typeLabel, actions, children }: { uniform: ParsedUniform; typeLabel?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="group/row flex flex-col gap-1.5" data-uniform={uniform.name}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono text-xs text-fg" title={uniform.name}>{uniform.name}</span>
          <span className="num text-2xs text-fg-subtle">{typeLabel ?? uniform.type}</span>
        </div>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>
      {children}
    </div>
  )
}

function ResetButton({ onReset, label }: { onReset: () => void; label: string }) {
  return (
    <IconButton label={label} onClick={onReset} className={cn("size-7", REVEAL)}>
      <RotateCcw className="size-3.5" />
    </IconButton>
  )
}

function MatrixControl({ uniform, value, onChange, onReset }: RowProps) {
  const dimension = uniform.type === "mat2x2f" ? 2 : uniform.type === "mat3x3f" ? 3 : 4
  const count = dimension * dimension
  const identity = Array.from({ length: count }, (_, i) => (i % (dimension + 1) === 0 ? 1 : 0))
  const raw = Array.isArray(value?.value) ? (value.value as number[]) : identity
  const current = raw.length === count ? raw : identity
  const valType = dimension === 4 ? "mat4" : dimension === 3 ? "mat3" : "mat2"
  const write = useUniformWriter(uniform.name, onChange)

  const apply = (updated: number[]) => write({ type: valType, value: updated })
  const scaled = (s: number) => identity.map((v) => (v === 1 ? s : 0))

  return (
    <details className="group/mat rounded-md border border-line bg-raised/50" data-uniform={uniform.name}>
      <summary className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 px-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono text-xs text-fg" title={uniform.name}>{uniform.name}</span>
          <span className="num text-2xs text-fg-subtle">
            {dimension}x{dimension} matrix
          </span>
        </span>
        <span className="text-2xs text-fg-subtle group-open/mat:hidden">Advanced</span>
      </summary>
      <div className="flex flex-col gap-2 px-2 pb-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => apply([...identity])}>Identity</Button>
          <Button variant="outline" size="sm" onClick={() => apply(scaled(2))}>2x</Button>
          <Button variant="outline" size="sm" onClick={() => apply(scaled(0.5))}>0.5x</Button>
          <IconButton label="Reset matrix" onClick={onReset} className="ml-auto size-7">
            <RotateCcw className="size-3.5" />
          </IconButton>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${dimension}, minmax(0, 1fr))` }}>
          {current.map((cell, idx) => (
            <NumericField
              key={idx}
              aria-label={`${uniform.name}[${idx}]`}
              value={cell}
              step={0.1}
              precision={2}
              className="w-full"
              onChange={(v) => {
                const u = [...current]
                u[idx] = v
                apply(u)
              }}
            />
          ))}
        </div>
      </div>
    </details>
  )
}

function BoolControl({ uniform, value, onChange, onReset }: RowProps) {
  const write = useUniformWriter(uniform.name, onChange)
  const on = value?.type === "bool" ? (value.value as boolean) : false
  return (
    <Row uniform={uniform} actions={<ResetButton onReset={onReset} label="Reset to default" />}>
      <Switch aria-label={uniform.name} checked={on} onCheckedChange={(checked) => write({ type: "bool", value: checked })} />
    </Row>
  )
}

function AudioBindPanel({ binding, base, onChange }: { binding?: AudioBinding; base: number; onChange: (b: AudioBinding | null) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-raised/50 p-2" data-testid="audio-bind-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">{binding ? `Modulated by ${binding.band}` : "Not bound to audio"}</span>
        {binding ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="size-3.5" />
            Unbind
          </Button>
        ) : null}
      </div>
      <div role="group" aria-label="Audio band" className="grid grid-cols-5 gap-1">
        {BANDS.map((band) => (
          <Button
            key={band}
            size="sm"
            variant={binding?.band === band ? "primary" : "secondary"}
            aria-pressed={binding?.band === band}
            className="px-1"
            onClick={() => onChange({ band, amount: binding?.amount ?? 1 })}
          >
            {band}
          </Button>
        ))}
      </div>
      {binding ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-14 text-xs text-fg-muted">Intensity</span>
            <Slider aria-label="Audio intensity" value={[binding.amount]} min={0.1} max={5} step={0.1} onValueChange={([amount]) => onChange({ band: binding.band, amount })} className="flex-1" />
            <span className="num w-9 text-right text-xs text-fg-muted">{binding.amount.toFixed(1)}x</span>
          </div>
          <span className="num text-2xs text-fg-subtle">
            Base {base.toFixed(2)} to peak {(base + binding.amount).toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function ScalarControl({ uniform, value, onChange, onReset }: RowProps) {
  const audioBinding = useProjectStore((s) => s.audioBindings[uniform.name])
  const setAudioBinding = useProjectStore((s) => s.setAudioBinding)
  const [showAudio, setShowAudio] = useState(false)
  const write = useUniformWriter(uniform.name, onChange)

  const isInt = uniform.type === "i32" || uniform.type === "u32"
  const num = typeof value?.value === "number" ? value.value : 0
  const commit = (v: number) => {
    const final = uniform.type === "i32" ? Math.round(v) : uniform.type === "u32" ? Math.max(0, Math.round(v)) : v
    write({ type: uniform.type === "i32" ? "int" : uniform.type === "u32" ? "uint" : "float", value: final })
  }

  return (
    <Row
      uniform={uniform}
      actions={
        <>
          <IconButton
            label={audioBinding ? `Audio: ${audioBinding.band} (${audioBinding.amount}x)` : "Bind to audio"}
            aria-pressed={showAudio}
            onClick={() => setShowAudio((s) => !s)}
            className={cn("size-7", audioBinding ? "text-brand-text" : REVEAL)}
          >
            <Activity className="size-3.5" />
          </IconButton>
          <ResetButton onReset={onReset} label="Reset to default" />
        </>
      }
    >
      <NumericField aria-label={uniform.name} value={isInt ? Math.round(num) : num} step={isInt ? 1 : 0.01} min={uniform.type === "u32" ? 0 : undefined} onChange={commit} className="w-full" />
      {showAudio ? <AudioBindPanel binding={audioBinding} base={num} onChange={(b) => setAudioBinding(uniform.name, b)} /> : null}
    </Row>
  )
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0")).join("")

function ColorControl({ uniform, value, onChange, onReset }: RowProps) {
  const write = useUniformWriter(uniform.name, onChange)
  const isVec4 = uniform.type === "vec4f"
  const arr = (value?.type === "color" || value?.type === "vec3" || value?.type === "vec4") && Array.isArray(value.value) ? (value.value as number[]) : [0.5, 0.5, 0.5, 1]
  const [r, g, b] = [arr[0] ?? 0.5, arr[1] ?? 0.5, arr[2] ?? 0.5]
  const a = isVec4 ? (arr[3] ?? 1) : 1

  const onHex = (hex: string) => {
    const clean = hex.replace(/^#/, "")
    if (clean.length !== 6) return
    const c = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    write({ type: isVec4 ? "vec4" : "color", value: isVec4 ? [c[0], c[1], c[2], a] : c })
  }

  return (
    <Row uniform={uniform} typeLabel={`${uniform.type} color`} actions={<ResetButton onReset={onReset} label="Reset to default" />}>
      <div className="flex items-center gap-2">
        <ColorField hexInput aria-label={`${uniform.name} color`} value={toHex(r, g, b)} onChange={onHex} className="min-w-0 flex-1" />
        {isVec4 ? (
          <NumericField label="A" aria-label={`${uniform.name} alpha`} value={a} min={0} max={1} step={0.01} className="w-24" onChange={(alpha) => write({ type: "vec4", value: [r, g, b, alpha] })} />
        ) : null}
      </div>
    </Row>
  )
}

function VectorControl({ uniform, value, onChange, onReset }: RowProps) {
  const write = useUniformWriter(uniform.name, onChange)
  const vec = (value?.type === "vec2" || value?.type === "vec3" || value?.type === "vec4") && Array.isArray(value.value) ? (value.value as number[]) : [0, 0, 0, 0]
  const comps = uniform.type === "vec2f" ? ["x", "y"] : uniform.type === "vec3f" ? ["x", "y", "z"] : ["x", "y", "z", "w"]
  const targetType = uniform.type === "vec2f" ? "vec2" : uniform.type === "vec3f" ? "vec3" : "vec4"

  return (
    <Row uniform={uniform} actions={<ResetButton onReset={onReset} label="Reset to default" />}>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${comps.length}, minmax(0, 1fr))` }}>
        {comps.map((c, i) => (
          <NumericField
            key={c}
            label={c}
            aria-label={`${uniform.name}.${c}`}
            value={vec[i] ?? 0}
            step={0.01}
            className="w-full"
            onChange={(v) => {
              const next = [...vec]
              next[i] = v
              write({ type: targetType, value: next.slice(0, comps.length) })
            }}
          />
        ))}
      </div>
    </Row>
  )
}

function TextureControl({ uniform, value, onChange }: RowProps) {
  const write = useUniformWriter(uniform.name, onChange)
  const input = useRef<HTMLInputElement>(null)
  const src = value?.type === "texture" && typeof value.value === "string" ? value.value : ""
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") write({ type: "texture", value: reader.result })
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }
  return (
    <Row uniform={uniform} typeLabel="texture">
      <div className="flex items-center gap-2">
        <div className="size-12 shrink-0 overflow-hidden rounded-md border border-line bg-raised">
          {src ? <img src={src} alt={`${uniform.name} preview`} className="size-full object-cover" /> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="text-xs text-fg-subtle">{src ? "Custom texture" : "Bound via node graph"}</span>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <ImagePlus />
            {src ? "Replace" : "Choose image"}
          </Button>
        </div>
        <input ref={input} type="file" accept="image/*" aria-label={`Replace ${uniform.name} texture`} className="hidden" onChange={onFile} />
      </div>
    </Row>
  )
}

/** Written by the adapters every frame, so the stored value is meaningless (always 0). */
const AUTO_UNIFORMS = new Set(["time", "u_time", "resolution", "u_resolution"])

function AutoRow({ uniform }: { uniform: ParsedUniform }) {
  return (
    <Row uniform={uniform} actions={<Badge title="Set every frame by the renderer">auto</Badge>}>
      <span className="text-xs text-fg-subtle">Provided by the renderer each frame</span>
    </Row>
  )
}

function UniformRow({ uniform, graphUniforms }: { uniform: ParsedUniform; graphUniforms: GraphUniform[] }) {
  const value = useProjectStore((s) => s.uniformValues[uniform.name])
  const setUniformValue = useProjectStore((s) => s.setUniformValue)
  const onChange = (v: UniformValue) => setUniformValue(uniform.name, v)
  const onReset = () => {
    const def = getDefaultValueFor(uniform, graphUniforms)
    setUniformValue(uniform.name, def)
    getActiveAdapter()?.updateUniform(uniform.name, def)
  }
  const p = { uniform, value, onChange, onReset }
  if (AUTO_UNIFORMS.has(uniform.name)) return <AutoRow uniform={uniform} />
  if (uniform.kind === "texture") return <TextureControl {...p} />
  if (uniform.kind === "matrix" || uniform.type.startsWith("mat")) return <MatrixControl {...p} />
  if (uniform.kind === "color") return <ColorControl {...p} />
  if (uniform.kind === "vector") return <VectorControl {...p} />
  if (uniform.type === "bool") return <BoolControl {...p} />
  return <ScalarControl {...p} />
}

const GRAPH_TYPE: Record<string, ParsedUniform["type"]> = { float: "f32", vec2: "vec2f", vec3: "vec3f", vec4: "vec4f" }

export function UniformsSection() {
  const parsedUniforms = useProjectStore((s) => s.parsedUniforms)
  const graphUniforms = useProjectStore((s) => s.graphUniforms)
  const setUniformValue = useProjectStore((s) => s.setUniformValue)
  const [query, setQuery] = useState("")

  const combined = useMemo(() => {
    const list: ParsedUniform[] = parsedUniforms.length > 0 ? [...parsedUniforms] : [{ name: "u_color", type: "vec3f", kind: "color" }]
    for (const u of graphUniforms) {
      if (list.some((x) => x.name === u.name)) continue
      list.push({ name: u.name, type: GRAPH_TYPE[u.type] ?? "f32", kind: u.type === "color" ? "color" : "scalar" })
    }
    return list
  }, [parsedUniforms, graphUniforms])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? combined.filter((u) => u.name.toLowerCase().includes(q)) : combined
  }, [combined, query])

  const resetAll = () => {
    for (const u of combined) {
      if (AUTO_UNIFORMS.has(u.name)) continue
      const def = getDefaultValueFor(u, graphUniforms)
      setUniformValue(u.name, def)
      getActiveAdapter()?.updateUniform(u.name, def)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input type="text" aria-label="Search uniforms" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search uniforms..." className="pl-8" />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={resetAll} title="Reset all uniforms to their defaults">
          <RotateCcw />
          Reset all
        </Button>
      </div>

      {query ? (
        <div className="num text-xs text-fg-subtle">
          Found {filtered.length} matching {filtered.length === 1 ? "uniform" : "uniforms"}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-line py-6 text-center text-xs text-fg-subtle">No uniforms matching &quot;{query}&quot;</div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((u) => (
            <UniformRow key={u.name} uniform={u} graphUniforms={graphUniforms} />
          ))}
        </div>
      )}
    </div>
  )
}
