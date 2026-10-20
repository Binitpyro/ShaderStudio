import { memo } from "react"
import { Clock } from "lucide-react"
import type { FlowNodeProps } from "./types"
import type { TimeNodeData } from "@/core/graphCompiler"
import { NodeShell, Port, Position } from "./NodeShell"

function TimeNodeComponent({ selected }: FlowNodeProps<TimeNodeData>) {
  return (
    <NodeShell title="Time" icon={Clock} size="sm" selected={selected} ports={<Port type="source" position={Position.Right} portType="value" />}>
      <div className="num rounded-md bg-raised px-2 py-1.5 text-xs text-fg-muted">u_time</div>
    </NodeShell>
  )
}
export const TimeNode = memo(TimeNodeComponent)
