import { memo, useState } from "react"
import { Badge, IconButton } from "@/components/ui"
import { NodeShell, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import type { SubGraphNodeData } from "@/core/subGraphLibrary"
import { subGraphLibrary } from "@/core/subGraphLibrary"
import { Layers, ChevronDown, ChevronRight } from "lucide-react"

function SubGraphNodeComponent({ data, selected }: FlowNodeProps<SubGraphNodeData>) {
  const [collapsed, setCollapsed] = useState(data.isCollapsed ?? true)
  const def = subGraphLibrary.get(data.subGraphId)

  const displayName = data.name || def?.name || "Sub-Graph"
  const category = def?.category || "Utility"
  const inputs = def?.inputs || []
  const outputs = def?.outputs || []

  return (
    <NodeShell
      title={displayName}
      icon={Layers}
      selected={selected}
      meta={
        <span className="flex items-center gap-1">
          <Badge tone="brand">{category}</Badge>
          <IconButton
            label={collapsed ? "Expand ports" : "Collapse ports"}
            tooltip={false}
            title={collapsed ? "Expand ports" : "Collapse ports"}
            onClick={() => setCollapsed(!collapsed)}
            className="size-6 min-w-6 nodrag"
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </IconButton>
        </span>
      }
    >
      {def?.description && !collapsed && <p className="text-2xs leading-relaxed text-fg-muted">{def.description}</p>}

      <div className="flex justify-between gap-4 text-xs">
        <div className="relative flex flex-col gap-1.5">
          {inputs.map((port) => (
            <div key={port.id} className="relative flex h-5 items-center gap-1.5">
              <Port type="target" position={Position.Left} id={port.id} portType="value" style={{ left: "-18px" }} />
              <span className="font-medium">{port.name}</span>
              <span className="text-2xs lowercase text-fg-subtle">({port.type})</span>
            </div>
          ))}
          {inputs.length === 0 && <span className="text-2xs text-fg-subtle">No inputs</span>}
        </div>

        <div className="relative flex flex-col items-end gap-1.5">
          {outputs.map((port) => (
            <div key={port.id} className="relative flex h-5 items-center gap-1.5">
              <span className="text-2xs lowercase text-fg-subtle">({port.type})</span>
              <span className="font-medium">{port.name}</span>
              <Port type="source" position={Position.Right} id={port.id} portType="value" style={{ right: "-18px" }} />
            </div>
          ))}
          {outputs.length === 0 && <span className="text-2xs text-fg-subtle">No outputs</span>}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2 text-2xs text-fg-muted">
        <span><span className="num">{def?.nodes.length ?? 0}</span> internal nodes</span>
        <span>{def?.isBuiltin ? "built-in" : "custom"}</span>
      </div>
    </NodeShell>
  )
}

export const SubGraphNode = memo(SubGraphNodeComponent)
