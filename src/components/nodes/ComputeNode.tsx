import { memo, useCallback } from "react"
import { Cpu } from "lucide-react"
import { Select } from "@/components/ui"
import { NodeShell, Port, Position, nodeLabelClass } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { ComputeNodeData, ComputePreset } from "@/core/graphCompiler"
import { getLoadedWebgpuAdapter } from "@/adapters/activeAdapter"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"

const PRESETS: { value: ComputePreset; label: string }[] = [
  { value: "curl_noise", label: "Curl Noise Field" },
  { value: "gravity", label: "Gravity Attractor" },
  { value: "boids", label: "Boids Flocking" },
  { value: "galaxy", label: "Spiral Galaxy" },
  { value: "audio_vortex", label: "Audio Vortex" },
  { value: "custom", label: "Custom Shader" },
]

const COUNTS = [10000, 25000, 50000, 100000]

function ComputeNodeComponent({ id, data, selected }: FlowNodeProps<ComputeNodeData>) {
  const setActiveEditorTab = useProjectStore((s) => s.setActiveEditorTab)
  const preset: ComputePreset = data.preset || "curl_noise"
  const particleCount = data.particleCount || 50000

  const handlePresetChange = (newPreset: ComputePreset) => {
    const event = new CustomEvent("computePresetChange", {
      detail: { nodeId: id, preset: newPreset },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const handleCountChange = (count: number) => {
    const event = new CustomEvent("computeCountChange", {
      detail: { nodeId: id, particleCount: count },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const handleReset = useCallback(() => {
    getLoadedWebgpuAdapter()?.reseedSimulation?.()
    useProjectStore.getState().triggerSimulationReset()
  }, [])

  const handleEditShader = () => {
    setActiveEditorTab("compute")
    const event = new CustomEvent("editComputeShader", {
      detail: { nodeId: id, preset, customSource: data.computeSource },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  return (
    <NodeShell
      title="Compute Sim"
      icon={Cpu}
      selected={selected}
      meta={<span className="num">{(particleCount / 1000).toFixed(0)}k pts</span>}
      ports={<Port type="source" position={Position.Right} id="geometry" portType="geometry" />}
    >
      <div>
        <label htmlFor={`preset-${id}`} className={nodeLabelClass}>Preset</label>
        <Select id={`preset-${id}`} value={preset} onChange={(e) => handlePresetChange(e.target.value as ComputePreset)} className="nodrag">
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </div>

      <div>
        <span className={nodeLabelClass}>Particles</span>
        <div className="grid grid-cols-4 gap-1">
          {COUNTS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleCountChange(c)}
              aria-pressed={particleCount === c}
              className={cn(
                "num h-7 rounded-md text-2xs transition-colors nodrag",
                particleCount === c ? "bg-brand text-brand-fg" : "bg-raised text-fg-muted hover:bg-hover hover:text-fg"
              )}
            >
              {c >= 1000 ? `${c / 1000}k` : c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={handleReset} className="flex-1 nodrag" title="Re-seed particle positions">Reset</Button>
        <Button variant="secondary" size="sm" onClick={handleEditShader} className="flex-1 nodrag">Edit WGSL</Button>
      </div>
    </NodeShell>
  )
}

export const ComputeNode = memo(ComputeNodeComponent)
