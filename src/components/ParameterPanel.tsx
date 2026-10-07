import { useProjectStore, type ParsedUniform, type UniformValue } from "@/stores/projectStore"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useProjectStore as store } from "@/stores/projectStore"

interface ParameterControlProps {
  uniform: ParsedUniform
  value: UniformValue | undefined
  onChange: (value: UniformValue) => void
}

function getAdapter() {
  const backend = store.getState().activeBackend
  switch (backend) {
    case "webgpu": return webgpuAdapter
    case "webgl2": return webgl2Adapter
    case "threejs": return threejsAdapter
    default: return webgpuAdapter
  }
}

interface MatrixControlProps {
  uniform: ParsedUniform
  value: UniformValue | undefined
  onChange: (value: UniformValue) => void
}

function MatrixControl({ uniform, value, onChange }: MatrixControlProps) {
  const dimension = uniform.type === "mat2x2f" ? 2 :
                    uniform.type === "mat3x3f" ? 3 : 4
  const count = dimension * dimension
  const defaultValues: Record<number, number[]> = {
    2: [1, 0, 0, 1],
    3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    4: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  }

  const raw = Array.isArray(value?.value) ? (value.value as number[]) : defaultValues[dimension]
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
    let updated: number[]
    switch (preset) {
      case "identity":
      case "reset":
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-mono">{uniform.name} ({dimension}x{dimension})</Label>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setPreset("identity")}>
            Identity
          </Button>
          <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setPreset("scale2")}>
            2x
          </Button>
          <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setPreset("scaleHalf")}>
            0.5x
          </Button>
          <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setPreset("reset")}>
            Reset
          </Button>
        </div>
      </div>
      <div
        className="grid gap-1"
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

function ParameterControl({ uniform, value, onChange }: ParameterControlProps) {
  if (uniform.kind === "texture") {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-mono">{uniform.name}</Label>
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">Texture</div>
      </div>
    )
  }

  if (uniform.kind === "matrix" || uniform.type.startsWith("mat")) {
    return <MatrixControl uniform={uniform} value={value} onChange={onChange} />
  }

  if (uniform.kind === "color") {
    const colorValue = value?.type === "color" || value?.type === "vec3" ? (Array.isArray(value.value) ? value.value : [0.5, 0.5, 0.5]) : [0.5, 0.5, 0.5]
    const hexValue = "#" + colorValue.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-mono">{uniform.name}</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={hexValue}
            onChange={(e) => {
              const hex = e.target.value.slice(1)
              const r = parseInt(hex.slice(0, 2), 16) / 255
              const g = parseInt(hex.slice(2, 4), 16) / 255
              const b = parseInt(hex.slice(4, 6), 16) / 255
              const newValue: UniformValue = { type: uniform.type === "vec4f" ? "vec4" : "color", value: uniform.type === "vec4f" ? [r, g, b, 1] : [r, g, b] }
              onChange(newValue)
              getAdapter().updateUniform(uniform.name, newValue)
            }}
            className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent"
          />
          <span className="text-xs text-muted-foreground font-mono">{hexValue}</span>
        </div>
      </div>
    )
  }

  if (uniform.kind === "vector") {
    const vecValue = value?.type === "vec2" || value?.type === "vec3" || value?.type === "vec4" ? (Array.isArray(value.value) ? (value.value as number[]) : [0, 0, 0, 0]) : [0, 0, 0, 0]
    const components = uniform.type === "vec2f" ? ["x", "y"] : uniform.type === "vec3f" ? ["x", "y", "z"] : ["x", "y", "z", "w"]
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-mono">{uniform.name}</Label>
        <div className="flex flex-col gap-2">
          {components.map((comp, i) => (
            <div key={comp} className="flex items-center gap-2">
              <span className="w-3 text-xs text-muted-foreground">.{comp}</span>
              <Slider value={[vecValue[i] ?? 0]} min={-10} max={10} step={0.01} onValueChange={([v]) => { const newVec = [...vecValue]; newVec[i] = v; const newValue: UniformValue = { type: (uniform.type === "vec2f" ? "vec2" : uniform.type === "vec3f" ? "vec3" : "vec4"), value: newVec.slice(0, components.length) }; onChange(newValue); getAdapter().updateUniform(uniform.name, newValue) }} className="flex-1" />
              <span className="w-10 text-xs text-muted-foreground font-mono text-right">{vecValue[i]?.toFixed(2) ?? "0.00"}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (uniform.kind === "scalar") {
    if (uniform.type === "bool") {
      const boolValue = value?.type === "bool" ? (value.value as boolean) : false
      return (
        <div className="flex items-center justify-between">
          <Label className="text-xs font-mono">{uniform.name}</Label>
          <Switch checked={boolValue} onCheckedChange={(checked) => { const newValue: UniformValue = { type: "bool", value: checked }; onChange(newValue); getAdapter().updateUniform(uniform.name, newValue) }} />
        </div>
      )
    }
    const numValue = typeof value?.value === "number" ? value.value : 0
    const isInt = uniform.type === "i32" || uniform.type === "u32"
    const min = uniform.type === "u32" ? 0 : -100
    const max = 100
    const step = isInt ? 1 : 0.01
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-mono">{uniform.name}</Label>
          <span className="text-xs text-muted-foreground font-mono">{isInt ? Math.round(numValue) : numValue.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            value={[numValue]}
            min={min}
            max={max}
            step={step}
            onValueChange={([v]) => {
              const finalVal = uniform.type === "i32" ? Math.round(v) : uniform.type === "u32" ? Math.max(0, Math.round(v)) : v
              const newValue: UniformValue = {
                type: uniform.type === "i32" ? "int" : uniform.type === "u32" ? "uint" : "float",
                value: finalVal
              }
              onChange(newValue)
              getAdapter().updateUniform(uniform.name, newValue)
            }}
            className="flex-1"
          />
        </div>
      </div>
    )
  }
  return null
}

export function ParameterPanel() {
  const parsedUniforms = useProjectStore((state) => state.parsedUniforms)
  const graphUniforms = useProjectStore((state) => state.graphUniforms)
  const uniformValues = useProjectStore((state) => state.uniformValues)
  const setUniformValue = useProjectStore((state) => state.setUniformValue)

  const allUniforms: ParsedUniform[] = parsedUniforms.length > 0 ? parsedUniforms : [{ name: "u_color", type: "vec3f", kind: "color" }]
  const fromGraph: ParsedUniform[] = graphUniforms.map((u) => ({ name: u.name, type: u.type === "float" ? "f32" : u.type === "vec2" ? "vec2f" : u.type === "vec3" ? "vec3f" : u.type === "vec4" ? "vec4f" : "f32", kind: u.type === "color" ? "color" : "scalar" }))
  const combined = [...allUniforms, ...fromGraph]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Parameters</span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="flex flex-col gap-4">{combined.map((uniform) => <ParameterControl key={uniform.name} uniform={uniform} value={uniformValues[uniform.name]} onChange={(value) => setUniformValue(uniform.name, value)} />)}</div>
      </div>
    </div>
  )
}
