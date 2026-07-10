import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import type { PostProcessNodeData } from "@/core/graphCompiler"

function PostProcessNodeComponent({ selected }: NodeProps<PostProcessNodeData>) {
  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[120px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-1">Post Process</div>
      <div className="w-full bg-background text-xs text-muted-foreground rounded px-2 py-1 border border-border">vignette</div>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-secondary border-2 border-background" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const PostProcessNode = memo(PostProcessNodeComponent)
