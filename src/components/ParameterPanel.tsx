import { useProjectStore, type ParsedUniform, type UniformValue } from "@/stores/projectStore"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useProjectStore as store } from "@/stores/projectStore"

interface ParameterControlProps { uniform: ParsedUniform; value: UniformValue | undefined; onChange: (value: UniformValue) => void }

function getAdapter() {
  const backend = store.getState().activeBackend
  switch (backend) {
    case "webgpu": return webgpuAdapter
    case "webgl2": return webgl2Adapter
    case "threejs": return threejsAdapter
    default: return webgpuAdapter
  }
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
              const newValue: UniformValue = { type: uniform.type === "vec4f" ? "vec4" : "vec3", value: uniform.type === "vec4f" ? [r, g, b, 1] : [r, g, b] }
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
              <Slider value={[vecValue[i] ?? 0]} min={-1} max={1} step={0.01} onValueChange={([v]) => { const newVec = [...vecValue]; newVec[i] = v; const newValue: UniformValue = { type: value?.type || "vec3", value: newVec.slice(0, components.length) }; onChange(newValue); getAdapter().updateUniform(uniform.name, newValue) }} className="flex-1" />
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
    const numValue = value?.type === "float" ? (typeof value.value === "number" ? value.value : 0) : 0
    const min = uniform.type === "u32" ? 0 : -100
    const max = 100
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-mono">{uniform.name}</Label>
          <span className="text-xs text-muted-foreground font-mono">{numValue.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider value={[numValue]} min={min} max={max} step={0.01} onValueChange={([v]) => { const newValue: UniformValue = { type: "float", value: uniform.type === "i32" ? Math.round(v) : uniform.type === "u32" ? Math.max(0, Math.round(v)) : v }; onChange(newValue); getAdapter().updateUniform(uniform.name, newValue) }} className="flex-1" />
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
