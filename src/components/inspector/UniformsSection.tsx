import { useState, useMemo } from "react"
import {
  useProjectStore,
  getDefaultUniformValue,
  type ParsedUniform,
  type UniformValue,
  type AudioBinding,
  type AudioBand,
  type GraphUniform,
} from "@/stores/projectStore"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Search, X, RotateCcw, Activity } from "lucide-react"

function getAdapter() {
  const backend = useProjectStore.getState().activeBackend
  switch (backend) {
    case "webgpu":
      return webgpuAdapter
    case "webgl2":
      return webgl2Adapter
    case "threejs":
      return threejsAdapter
    default:
      return webgpuAdapter
  }
}

function getDefaultValueFor(
  uniform: ParsedUniform,
  graphUniforms: GraphUniform[]
): UniformValue {
  const gu = graphUniforms.find((g) => g.name === uniform.name)
  if (gu) {
    if (typeof gu.defaultValue === "boolean") {
      return { type: "bool", value: gu.defaultValue }
    }
    if (typeof gu.defaultValue === "number") {
      return { type: "float", value: gu.defaultValue }
    }
    if (Array.isArray(gu.defaultValue)) {
      const len = gu.defaultValue.length
      const type = len === 2 ? "vec2" : len === 3 ? (gu.type === "color" ? "color" : "vec3") : "vec4"
      return { type, value: [...gu.defaultValue] }
    }
  }
  return getDefaultUniformValue(uniform)
}

interface MatrixControlProps {
  uniform: ParsedUniform
  value: UniformValue | undefined
  onChange: (value: UniformValue) => void
  onReset: () => void
}

function MatrixControl({ uniform, value, onChange, onReset }: MatrixControlProps) {
  const dimension =
    uniform.type === "mat2x2f" ? 2 : uniform.type === "mat3x3f" ? 3 : 4
  const count = dimension * dimension
  const defaultValues: Record<number, number[]> = {
    2: [1, 0, 0, 1],
    3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    4: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  }

  const raw = Array.isArray(value?.value)
    ? (value.value as number[])
    : defaultValues[dimension]
  const current = raw.length === count ? raw : defaultValues[dimension]
  const valType = dimension === 4 ? "mat4" : dimension === 3 ? "mat3" : "mat2"

  const applyUpdate = (updated: number[]) => {
    const newValue: UniformValue = { type: valType, value: updated }
    onChange(newValue)
    getAdapter().updateUniform(uniform.name, newValue)
  }

  const updateCell = (index: number, val: number) => {
    const updated = [...current]
    updated[index] = val
    applyUpdate(updated)
  }

  const setPreset = (preset: "identity" | "scale2" | "scaleHalf" | "reset") => {
    if (preset === "reset") {
      onReset()
      return
    }
    let updated: number[]
    switch (preset) {
      case "identity":
        updated = [...defaultValues[dimension]]
        break
      case "scale2":
        updated = [...defaultValues[dimension]]
        for (let i = 0; i < dimension; i++) {
          updated[i * dimension + i] = 2.0
        }
        break
      case "scaleHalf":
        updated = [...defaultValues[dimension]]
        for (let i = 0; i < dimension; i++) {
          updated[i * dimension + i] = 0.5
        }
        break
    }
    applyUpdate(updated)
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">
            ({dimension}x{dimension})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => setPreset("identity")}
          >
            Identity
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => setPreset("scale2")}
          >
            2x
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => setPreset("scaleHalf")}
          >
            0.5x
          </Button>
          <button
            type="button"
            onClick={onReset}
            title="Reset matrix to default"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div
        className="grid gap-1 pt-1"
        style={{ gridTemplateColumns: `repeat(${dimension}, minmax(0, 1fr))` }}
      >
        {current.map((cellVal, idx) => (
          <input
            key={idx}
            type="number"
            step="0.1"
            value={Number(cellVal.toFixed(2))}
            onChange={(e) => updateCell(idx, parseFloat(e.target.value) || 0)}
            className="h-6 rounded border border-border bg-background px-1 text-center font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ))}
      </div>
    </div>
  )
}

interface ParameterControlProps {
  uniform: ParsedUniform
  value: UniformValue | undefined
  onChange: (value: UniformValue) => void
  onReset: () => void
  audioBinding?: AudioBinding
  onAudioBindingChange?: (binding: AudioBinding | null) => void
}

function ScalarControl({
  uniform,
  value,
  onChange,
  onReset,
  audioBinding,
  onAudioBindingChange,
}: ParameterControlProps) {
  const [showAudioMenu, setShowAudioMenu] = useState(false)

  if (uniform.type === "bool") {
    const boolValue = value?.type === "bool" ? (value.value as boolean) : false
    return (
      <div className="flex items-center justify-between p-2 rounded-md bg-muted/10 border border-border/40">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">bool</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={boolValue}
            onCheckedChange={(checked) => {
              const newValue: UniformValue = { type: "bool", value: checked }
              onChange(newValue)
              getAdapter().updateUniform(uniform.name, newValue)
            }}
          />
          <button
            type="button"
            onClick={onReset}
            title="Reset boolean to default"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  const numValue = typeof value?.value === "number" ? value.value : 0
  const isInt = uniform.type === "i32" || uniform.type === "u32"
  const min = uniform.type === "u32" ? 0 : -100
  const max = 100
  const step = isInt ? 1 : 0.01

  const bandStyles: Record<AudioBand, string> = {
    bass: "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs shadow-amber-500/20",
    mid: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs shadow-cyan-500/20",
    treble: "bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-xs shadow-pink-500/20",
    beat: "bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-xs shadow-purple-500/20",
    level: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs shadow-emerald-500/20",
  }

  const handleNumericChange = (v: number) => {
    const finalVal =
      uniform.type === "i32"
        ? Math.round(v)
        : uniform.type === "u32"
        ? Math.max(0, Math.round(v))
        : v
    const newValue: UniformValue = {
      type: uniform.type === "i32" ? "int" : uniform.type === "u32" ? "uint" : "float",
      value: finalVal,
    }
    onChange(newValue)
    getAdapter().updateUniform(uniform.name, newValue)
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">
            {uniform.type}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowAudioMenu(!showAudioMenu)}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium transition-all cursor-pointer border",
              audioBinding
                ? bandStyles[audioBinding.band]
                : "bg-muted/40 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/60"
            )}
            title={
              audioBinding
                ? `Modulated by ${audioBinding.band.toUpperCase()} (${audioBinding.amount}x)`
                : "Bind to audio frequency spectrum"
            }
          >
            <Activity className={cn("h-2.5 w-2.5", audioBinding ? "animate-pulse" : "")} />
            <span>{audioBinding ? audioBinding.band.toUpperCase() : "Audio"}</span>
          </button>
          <input
            type="number"
            step={step}
            value={isInt ? Math.round(numValue) : Number(numValue.toFixed(2))}
            onChange={(e) => handleNumericChange(parseFloat(e.target.value) || 0)}
            className="h-5 w-14 rounded border border-border bg-background px-1 text-right font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={onReset}
            title="Reset to default"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Slider
          value={[numValue]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => handleNumericChange(v)}
          className="flex-1"
        />
      </div>

      {showAudioMenu && (
        <div className="flex flex-col gap-1.5 p-2 rounded bg-muted/40 border border-border/60 text-[10px] font-mono mt-1">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-foreground">Audio Modulation</span>
              {audioBinding ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  CONNECTED ({audioBinding.band.toUpperCase()})
                </span>
              ) : (
                <span className="text-muted-foreground text-[9px]">UNBOUND</span>
              )}
            </div>
            {audioBinding && (
              <button
                type="button"
                onClick={() => onAudioBindingChange?.(null)}
                className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 hover:bg-destructive/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer border border-destructive/30"
                title="Remove audio modulation from this parameter"
              >
                <X className="h-2.5 w-2.5" />
                <span>Unbind</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1 pt-0.5">
            {(["bass", "mid", "treble", "beat", "level"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  onAudioBindingChange?.({
                    band: b,
                    amount: audioBinding?.amount ?? 1.0,
                  })
                }}
                className={cn(
                  "py-1 rounded text-center uppercase text-[9px] font-bold tracking-wider transition-all border cursor-pointer",
                  audioBinding?.band === b
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-background/80 text-muted-foreground border-border hover:text-foreground hover:border-primary/40"
                )}
              >
                {b}
              </button>
            ))}
          </div>
          {audioBinding && (
            <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Modulation Range</span>
                <span className="text-foreground font-semibold">
                  Base {numValue.toFixed(2)} → Peak {(numValue + audioBinding.amount).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-14">Intensity</span>
                <Slider
                  value={[audioBinding.amount]}
                  min={0.1}
                  max={5.0}
                  step={0.1}
                  onValueChange={([val]) => {
                    onAudioBindingChange?.({ band: audioBinding.band, amount: val })
                  }}
                  className="flex-1"
                />
                <span className="w-8 text-right text-muted-foreground font-bold">
                  {audioBinding.amount.toFixed(1)}x
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ColorControl({ uniform, value, onChange, onReset }: ParameterControlProps) {
  const isVec4 = uniform.type === "vec4f"
  const rawArray =
    value?.type === "color" || value?.type === "vec3" || value?.type === "vec4"
      ? Array.isArray(value.value)
        ? (value.value as number[])
        : [0.5, 0.5, 0.5, 1.0]
      : [0.5, 0.5, 0.5, 1.0]

  const r = rawArray[0] ?? 0.5
  const g = rawArray[1] ?? 0.5
  const b = rawArray[2] ?? 0.5
  const a = isVec4 ? (rawArray[3] ?? 1.0) : 1.0

  const hexValue =
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v * 255)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")

  const handleHexChange = (hexStr: string) => {
    let clean = hexStr.replace(/^#/, "")
    if (clean.length === 6) {
      const nr = parseInt(clean.slice(0, 2), 16) / 255
      const ng = parseInt(clean.slice(2, 4), 16) / 255
      const nb = parseInt(clean.slice(4, 6), 16) / 255
      const newValue: UniformValue = {
        type: isVec4 ? "vec4" : "color",
        value: isVec4 ? [nr, ng, nb, a] : [nr, ng, nb],
      }
      onChange(newValue)
      getAdapter().updateUniform(uniform.name, newValue)
    }
  }

  const handleAlphaChange = (newAlpha: number) => {
    const newValue: UniformValue = {
      type: "vec4",
      value: [r, g, b, newAlpha],
    }
    onChange(newValue)
    getAdapter().updateUniform(uniform.name, newValue)
  }

  return (
    <div className="flex flex-col gap-2 p-2 rounded-md bg-muted/10 border border-border/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">
            {uniform.type} (color)
          </span>
        </div>
        <button
          type="button"
          onClick={onReset}
          title="Reset color to default"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative h-7 w-7 rounded overflow-hidden border border-border shrink-0 shadow-xs">
          <input
            type="color"
            value={hexValue}
            onChange={(e) => handleHexChange(e.target.value)}
            className="absolute -top-2 -left-2 h-11 w-11 cursor-pointer border-0 p-0"
          />
        </div>
        <input
          type="text"
          value={hexValue}
          onChange={(e) => handleHexChange(e.target.value)}
          className="h-6 w-20 rounded border border-border bg-background px-1.5 font-mono text-xs uppercase text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div
          className="h-6 flex-1 rounded border border-border/50"
          style={{
            backgroundColor: `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
              b * 255
            )}, ${a})`,
          }}
        />
      </div>

      {isVec4 && (
        <div className="flex items-center gap-2 pt-1">
          <span className="w-10 text-[11px] text-muted-foreground font-mono">Alpha</span>
          <Slider
            value={[a]}
            min={0.0}
            max={1.0}
            step={0.01}
            onValueChange={([val]) => handleAlphaChange(val)}
            className="flex-1"
          />
          <span className="w-10 text-right text-xs font-mono text-muted-foreground">
            {a.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

function VectorControl({ uniform, value, onChange, onReset }: ParameterControlProps) {
  const vecValue =
    value?.type === "vec2" || value?.type === "vec3" || value?.type === "vec4"
      ? Array.isArray(value.value)
        ? (value.value as number[])
        : [0, 0, 0, 0]
      : [0, 0, 0, 0]

  const components =
    uniform.type === "vec2f"
      ? ["x", "y"]
      : uniform.type === "vec3f"
      ? ["x", "y", "z"]
      : ["x", "y", "z", "w"]

  const compStyles: Record<string, string> = {
    x: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    y: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    z: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    w: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  }

  const updateComponent = (index: number, val: number) => {
    const newVec = [...vecValue]
    newVec[index] = val
    const targetType =
      uniform.type === "vec2f" ? "vec2" : uniform.type === "vec3f" ? "vec3" : "vec4"
    const newValue: UniformValue = {
      type: targetType,
      value: newVec.slice(0, components.length),
    }
    onChange(newValue)
    getAdapter().updateUniform(uniform.name, newValue)
  }

  return (
    <div className="flex flex-col gap-2 p-2 rounded-md bg-muted/10 border border-border/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">
            {uniform.type}
          </span>
        </div>
        <button
          type="button"
          onClick={onReset}
          title="Reset vector to default"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        {components.map((comp, i) => (
          <div key={comp} className="flex items-center gap-2">
            <span
              className={cn(
                "h-5 w-5 rounded border text-[11px] font-mono font-bold flex items-center justify-center shrink-0",
                compStyles[comp] || "text-muted-foreground"
              )}
            >
              .{comp}
            </span>
            <Slider
              value={[vecValue[i] ?? 0]}
              min={-10}
              max={10}
              step={0.01}
              onValueChange={([v]) => updateComponent(i, v)}
              className="flex-1"
            />
            <input
              type="number"
              step="0.01"
              value={Number((vecValue[i] ?? 0).toFixed(2))}
              onChange={(e) => updateComponent(i, parseFloat(e.target.value) || 0)}
              className="h-5 w-14 rounded border border-border bg-background px-1 text-right font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function TextureControl({ uniform }: { uniform: ParsedUniform }) {
  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/10 border border-border/40">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-mono font-medium">{uniform.name}</Label>
        <span className="text-[10px] text-muted-foreground font-mono">sampler2D / texture</span>
      </div>
      <div className="flex h-12 items-center justify-center rounded border border-dashed border-border/70 text-xs text-muted-foreground bg-muted/20">
        Texture bound via Node Graph
      </div>
    </div>
  )
}

export function UniformsSection() {
  const parsedUniforms = useProjectStore((state) => state.parsedUniforms)
  const graphUniforms = useProjectStore((state) => state.graphUniforms)
  const uniformValues = useProjectStore((state) => state.uniformValues)
  const setUniformValue = useProjectStore((state) => state.setUniformValue)
  const audioBindings = useProjectStore((state) => state.audioBindings)
  const setAudioBinding = useProjectStore((state) => state.setAudioBinding)

  const [searchQuery, setSearchQuery] = useState("")

  const allUniforms: ParsedUniform[] =
    parsedUniforms.length > 0
      ? parsedUniforms
      : [{ name: "u_color", type: "vec3f", kind: "color" }]

  const fromGraph: ParsedUniform[] = graphUniforms.map((u) => ({
    name: u.name,
    type:
      u.type === "float"
        ? "f32"
        : u.type === "vec2"
        ? "vec2f"
        : u.type === "vec3"
        ? "vec3f"
        : u.type === "vec4"
        ? "vec4f"
        : "f32",
    kind: u.type === "color" ? "color" : "scalar",
  }))

  const combined = useMemo(() => {
    const list = [...allUniforms]
    for (const g of fromGraph) {
      if (!list.some((u) => u.name === g.name)) {
        list.push(g)
      }
    }
    return list
  }, [allUniforms, fromGraph])

  const filteredUniforms = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase()
    if (!trimmed) return combined
    return combined.filter((u) => u.name.toLowerCase().includes(trimmed))
  }, [combined, searchQuery])

  const handleResetUniform = (uniform: ParsedUniform) => {
    const def = getDefaultValueFor(uniform, graphUniforms)
    setUniformValue(uniform.name, def)
    getAdapter().updateUniform(uniform.name, def)
  }

  const handleResetAll = () => {
    for (const u of combined) {
      const def = getDefaultValueFor(u, graphUniforms)
      setUniformValue(u.name, def)
      getAdapter().updateUniform(u.name, def)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search Bar + Controls */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search uniforms..."
            className="h-7.5 w-full rounded border border-border bg-background pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetAll}
          className="h-7.5 px-2 text-[11px] font-mono gap-1 text-muted-foreground hover:text-foreground shrink-0"
          title="Reset all uniforms to default parsed values"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset All</span>
        </Button>
      </div>

      {/* Match count badge */}
      {searchQuery && (
        <div className="text-[11px] text-muted-foreground font-mono px-0.5">
          Found {filteredUniforms.length} matching {filteredUniforms.length === 1 ? "uniform" : "uniforms"}
        </div>
      )}

      {/* Uniform Controls List */}
      {filteredUniforms.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground bg-muted/10 rounded-md border border-dashed border-border">
          No uniforms matching &quot;{searchQuery}&quot;
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredUniforms.map((uniform) => {
            const val = uniformValues[uniform.name]
            const reset = () => handleResetUniform(uniform)

            if (uniform.kind === "texture") {
              return <TextureControl key={uniform.name} uniform={uniform} />
            }

            if (uniform.kind === "matrix" || uniform.type.startsWith("mat")) {
              return (
                <MatrixControl
                  key={uniform.name}
                  uniform={uniform}
                  value={val}
                  onChange={(v) => setUniformValue(uniform.name, v)}
                  onReset={reset}
                />
              )
            }

            if (uniform.kind === "color") {
              return (
                <ColorControl
                  key={uniform.name}
                  uniform={uniform}
                  value={val}
                  onChange={(v) => setUniformValue(uniform.name, v)}
                  onReset={reset}
                />
              )
            }

            if (uniform.kind === "vector") {
              return (
                <VectorControl
                  key={uniform.name}
                  uniform={uniform}
                  value={val}
                  onChange={(v) => setUniformValue(uniform.name, v)}
                  onReset={reset}
                />
              )
            }

            return (
              <ScalarControl
                key={uniform.name}
                uniform={uniform}
                value={val}
                onChange={(v) => setUniformValue(uniform.name, v)}
                onReset={reset}
                audioBinding={audioBindings[uniform.name]}
                onAudioBindingChange={(binding) => setAudioBinding(uniform.name, binding)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
