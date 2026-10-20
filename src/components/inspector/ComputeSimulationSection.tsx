import { useState } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { getLoadedWebgpuAdapter } from "@/adapters/activeAdapter"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/panel"
import { NumericField } from "@/components/ui/numeric-field"
import { RotateCcw } from "lucide-react"

export function ComputeSimulationSection() {
  const activeBackend = useProjectStore((s) => s.activeBackend)
  const setActiveBackend = useProjectStore((s) => s.setActiveBackend)

  const [params, setParams] = useState({ speed: 1.0, damping: 0.98, strength: 1.0, noiseScale: 1.0, pointSize: 4.0, blendMode: 1.0 })

  const updateParam = (name: string, val: number) => {
    setParams((prev) => ({ ...prev, [name]: val }))
    getLoadedWebgpuAdapter()?.updateComputeUniform?.(name, val)
  }

  const handleReseed = () => {
    getLoadedWebgpuAdapter()?.reseedSimulation?.()
    useProjectStore.getState().triggerSimulationReset()
  }

  const isWebGPU = activeBackend === "webgpu"

  return (
    <div className="flex flex-col gap-4">
      {!isWebGPU ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-warning-soft px-2.5 py-2">
          <span className="text-xs text-warning">Active on WebGPU backend</span>
          <Button variant="outline" size="sm" onClick={() => setActiveBackend("webgpu")}>
            Switch to WebGPU
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-muted">WebGPU Compute Pipeline</span>
          <Button variant="secondary" size="sm" onClick={handleReseed}>
            <RotateCcw />
            Re-seed
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Field label="Simulation Speed">
          <NumericField aria-label="Simulation Speed" value={params.speed} min={0.1} max={3} step={0.05} unit="x" className="w-28" onChange={(v) => updateParam("speed", v)} />
        </Field>
        <Field label="Damping">
          <NumericField aria-label="Damping" value={params.damping} min={0.9} max={0.999} step={0.001} className="w-28" onChange={(v) => updateParam("damping", v)} />
        </Field>
        <Field label="Gravity / Force">
          <NumericField aria-label="Gravity / Force" value={params.strength} min={0.1} max={4} step={0.05} className="w-28" onChange={(v) => updateParam("strength", v)} />
        </Field>
        <Field label="Particle Size">
          <NumericField aria-label="Particle Size" value={params.pointSize} min={1} max={12} step={0.5} unit="px" className="w-28" onChange={(v) => updateParam("pointSize", v)} />
        </Field>
        <Field label="Additive blend">
          <Switch aria-label="Additive blend" checked={params.blendMode > 0.5} onCheckedChange={(checked) => updateParam("blendMode", checked ? 1.0 : 0.0)} />
        </Field>
      </div>
    </div>
  )
}
