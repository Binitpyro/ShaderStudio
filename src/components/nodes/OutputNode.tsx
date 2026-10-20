import { memo } from "react"
import { Tv } from "lucide-react"
import type { FlowNodeProps } from "./types"
import type { OutputNodeData } from "@/core/graphCompiler"
import { NodeShell, NodeDetails, DetailRow, Port, Position } from "./NodeShell"
import { Badge } from "@/components/ui"

function OutputNodeComponent({ selected }: FlowNodeProps<OutputNodeData>) {
  return (
    <NodeShell
      title="Output"
      icon={Tv}
      size="sm"
      selected={selected}
      meta={<Badge tone="success">Ready</Badge>}
      ports={<Port type="target" position={Position.Left} portType="surface" />}
    >
      <div className="rounded-md bg-raised px-2 py-1.5 text-center text-xs text-fg-muted">Screen display</div>
      {selected && (
        <NodeDetails title="Surface">
          <DetailRow label="Target" value="Canvas" />
          <DetailRow label="Format" value="BGRA8 / sRGB" />
          <DetailRow label="Alpha" value="Premultiplied" />
        </NodeDetails>
      )}
    </NodeShell>
  )
}
export const OutputNode = memo(OutputNodeComponent)
