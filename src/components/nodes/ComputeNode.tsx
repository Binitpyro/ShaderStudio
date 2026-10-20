import { memo, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
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
    <div
      className={cn(
        "bg-card border rounded-md p-3 min-w-[190px] max-w-[220px] shadow-sm select-none text-foreground",
        selected ? "border-primary" : "border-border"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs font-semibold">Compute Sim</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {(particleCount / 1000).toFixed(0)}k pts
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Preset</label>
          <select
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value as ComputePreset)}
            className="w-full bg-background text-xs border border-border rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-ring nodrag"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Particles</label>
          <div className="grid grid-cols-4 gap-1">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleCountChange(c)}
                className={cn(
                  "text-[10px] py-0.5 rounded border text-center transition-colors font-mono",
                  particleCount === c
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {c >= 1000 ? `${c / 1000}k` : c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="flex-1 h-6 text-[10px] px-2 font-mono"
            title="Re-seed particle positions"
          >
            Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleEditShader}
            className="flex-1 h-6 text-[10px] px-2 font-mono"
          >
            Edit WGSL
          </Button>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="geometry"
        className="w-3 h-3 bg-cyan-400 border-2 border-background"
      />
    </div>
  )
}

export const ComputeNode = memo(ComputeNodeComponent)
