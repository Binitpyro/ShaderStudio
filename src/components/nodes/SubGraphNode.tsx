import { memo, useState } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
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
    <div
      className={cn(
        "bg-card border rounded-lg p-3 shadow-md select-none text-foreground transition-all duration-150 min-w-[200px] max-w-[280px]",
        selected
          ? "border-primary ring-2 ring-primary/40 shadow-xl"
          : "border-border hover:border-border/80"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground truncate" title={displayName}>
            {displayName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            {category}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"
            title={collapsed ? "Expand ports" : "Collapse ports"}
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Description */}
      {def?.description && !collapsed && (
        <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed italic">
          {def.description}
        </p>
      )}

      {/* Ports List */}
      <div className="flex justify-between gap-4 text-[10px] font-mono">
        {/* Input Ports */}
        <div className="flex flex-col gap-2 relative">
          {inputs.map((port) => (
            <div key={port.id} className="relative flex items-center gap-1.5 h-5">
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background"
                style={{ left: "-18px" }}
              />
              <span className="text-foreground/90 font-medium">{port.name}</span>
              <span className="text-[8px] text-muted-foreground/70 lowercase">({port.type})</span>
            </div>
          ))}
          {inputs.length === 0 && (
            <span className="text-[9px] text-muted-foreground italic">No inputs</span>
          )}
        </div>

        {/* Output Ports */}
        <div className="flex flex-col gap-2 items-end relative">
          {outputs.map((port) => (
            <div key={port.id} className="relative flex items-center gap-1.5 h-5">
              <span className="text-[8px] text-muted-foreground/70 lowercase">({port.type})</span>
              <span className="text-foreground/90 font-medium">{port.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-background"
                style={{ right: "-18px" }}
              />
            </div>
          ))}
          {outputs.length === 0 && (
            <span className="text-[9px] text-muted-foreground italic">No outputs</span>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-2.5 pt-1.5 border-t border-border/40 flex items-center justify-between text-[9px] text-muted-foreground font-mono">
        <span>{def?.nodes.length ?? 0} internal nodes</span>
        <span className="text-primary/80">{def?.isBuiltin ? "built-in" : "custom"}</span>
      </div>
    </div>
  )
}

export const SubGraphNode = memo(SubGraphNodeComponent)
