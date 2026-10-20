import { memo, useCallback } from "react"
import { Badge, Label, Slider, Switch } from "@/components/ui"
import { NodeShell, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
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
    <NodeShell
      title="Raymarch Engine"
      icon={Eye}
      selected={selected}
      meta={<Badge>SDF 3D</Badge>}
      ports={
        <>
          <Port type="target" position={Position.Left} id="scene" portType="geometry" />
          <Port type="source" position={Position.Right} id="output" portType="surface" />
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Max steps</Label>
          <span className="num text-xs text-fg-muted">{maxSteps}</span>
        </div>
        <Slider value={[maxSteps]} min={32} max={256} step={16} onValueChange={([v]) => updateData({ maxSteps: v })} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Max distance</Label>
          <span className="num text-xs text-fg-muted">{maxDistance.toFixed(0)}m</span>
        </div>
        <Slider value={[maxDistance]} min={10} max={100} step={5} onValueChange={([v]) => updateData({ maxDistance: v })} />
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2">
        <span className="text-xs text-fg-muted">Soft shadows</span>
        <Switch checked={enableShadows} onCheckedChange={(checked) => updateData({ enableShadows: checked })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">Ambient occlusion</span>
        <Switch checked={enableAo} onCheckedChange={(checked) => updateData({ enableAo: checked })} />
      </div>
    </NodeShell>
  )
}

export const RaymarchNode = memo(RaymarchNodeComponent)
