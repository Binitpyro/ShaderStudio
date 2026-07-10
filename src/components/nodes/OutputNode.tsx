import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import type { OutputNodeData } from "@/core/graphCompiler"

function OutputNodeComponent({ selected }: NodeProps<OutputNodeData>) {
  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[100px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-1">Output</div>
      <div className="w-full bg-primary text-primary-foreground text-xs rounded px-2 py-1 text-center">Screen</div>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const OutputNode = memo(OutputNodeComponent)
