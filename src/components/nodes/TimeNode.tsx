import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { TimeNodeData } from "@/core/graphCompiler"

function TimeNodeComponent({ selected }: FlowNodeProps<TimeNodeData>) {
  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[100px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-1">Time</div>
      <div className="w-full bg-background text-xs text-muted-foreground rounded px-2 py-1 border border-border">u_time</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-green-500 border-2 border-background" />
    </div>
  )
}
export const TimeNode = memo(TimeNodeComponent)
