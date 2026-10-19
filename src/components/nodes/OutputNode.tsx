import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { OutputNodeData } from "@/core/graphCompiler"

function OutputNodeComponent({ selected }: FlowNodeProps<OutputNodeData>) {
  return (
    <div
      className={cn(
        "bg-card border rounded-md p-3 shadow-sm select-none text-foreground transition-all duration-150",
        selected
          ? "border-primary ring-2 ring-primary/30 min-w-[170px] max-w-[200px] shadow-lg"
          : "border-border min-w-[100px] max-w-[130px]"
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-semibold text-foreground">Output</div>
        <span className="text-[9px] font-mono text-emerald-400 font-bold">READY</span>
      </div>
      <div className="w-full bg-primary/20 text-primary border border-primary/40 font-mono text-xs rounded px-2 py-1 text-center font-bold">
        Screen Display
      </div>

      {selected && (
        <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1 font-mono text-[10px]">
          <div className="flex justify-between text-muted-foreground">
            <span>Surface</span>
            <span className="text-foreground">Canvas</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Format</span>
            <span className="text-foreground">BGRA8 / sRGB</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Alpha</span>
            <span className="text-foreground">Premultiplied</span>
          </div>
          <div className="text-[9px] text-emerald-400 text-center pt-0.5 border-t border-border/30 font-semibold">
            Direct Viewport Pipeline
          </div>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const OutputNode = memo(OutputNodeComponent)
