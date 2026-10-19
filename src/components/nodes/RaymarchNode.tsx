import { memo, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Eye } from "lucide-react"
import type { RaymarchNodeData } from "@/core/graphCompiler"

function RaymarchNodeComponent({ id, data, selected }: FlowNodeProps<RaymarchNodeData>) {
  const maxSteps = data.maxSteps ?? 128
  const maxDistance = data.maxDistance ?? 40.0
  const enableShadows = data.enableShadows ?? true
  const enableAo = data.enableAo ?? true

  const updateData = useCallback(
    (updates: Partial<RaymarchNodeData>) => {
      Object.assign(data, updates)
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, ...updates } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
  )

  return (
    <div
      className={cn(
        "bg-card/95 backdrop-blur-md border rounded-lg p-3 w-[230px] shadow-md transition-all relative",
        selected ? "border-primary ring-1 ring-primary/40" : "border-border/80"
      )}
    >
      {/* Target input for SDF Scene */}
      <Handle
        type="target"
        position={Position.Left}
        id="scene"
        className="w-3 h-3 bg-purple-400 border-2 border-background shadow-xs hover:scale-125 transition-transform"
      />

      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-semibold tracking-wide">Raymarch Engine</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
          SDF 3D
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <Label className="text-[11px]">Max Steps</Label>
            <span className="text-muted-foreground">{maxSteps}</span>
          </div>
          <Slider
            value={[maxSteps]}
            min={32}
            max={256}
            step={16}
            onValueChange={([v]) => updateData({ maxSteps: v })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <Label className="text-[11px]">Max Distance</Label>
            <span className="text-muted-foreground">{maxDistance.toFixed(0)}m</span>
          </div>
          <Slider
            value={[maxDistance]}
            min={10}
            max={100}
            step={5}
            onValueChange={([v]) => updateData({ maxDistance: v })}
          />
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <span className="text-[11px] font-mono">Soft Shadows</span>
          <Switch
            checked={enableShadows}
            onCheckedChange={(checked) => updateData({ enableShadows: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono">Ambient Occlusion</span>
          <Switch
            checked={enableAo}
            onCheckedChange={(checked) => updateData({ enableAo: checked })}
          />
        </div>
      </div>

      {/* Output handle for material or output */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 bg-primary border-2 border-background shadow-xs hover:scale-125 transition-transform"
      />
    </div>
  )
}

export const RaymarchNode = memo(RaymarchNodeComponent)
