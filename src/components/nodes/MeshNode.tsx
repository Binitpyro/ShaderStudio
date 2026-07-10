import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import type { MeshNodeData } from "@/core/graphCompiler"

function MeshNodeComponent({ data, selected }: NodeProps<MeshNodeData>) {
  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[120px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-2">Mesh</div>
      <select
        value={data.geometry}
        onChange={(e) => { const select = e.target; const event = new CustomEvent("meshGeometryChange", { detail: { geometry: select.value }, bubbles: true }); select.dispatchEvent(event) }}
        className="w-full bg-background text-xs border border-border rounded px-2 py-1"
      >
        <option value="cube">Cube</option>
        <option value="sphere">Sphere</option>
        <option value="plane">Plane</option>
      </select>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const MeshNode = memo(MeshNodeComponent)
