import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/projectStore"
import type { MaterialNodeData } from "@/core/graphCompiler"

function MaterialNodeComponent({ data, selected }: NodeProps<MaterialNodeData>) {
  const activeShaderPath = useProjectStore((s) => s.activeShaderPath)
  const shaderPath = data.shaderPath || activeShaderPath || "default.wgsl"
  const handleShaderClick = () => { const event = new CustomEvent("focusShader", { detail: { path: shaderPath }, bubbles: true }); document.dispatchEvent(event) }
  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[140px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-2">Material</div>
      <button onClick={handleShaderClick} className="w-full bg-background text-xs border border-border rounded px-2 py-1 text-left hover:border-primary transition-colors truncate" title={shaderPath}>
        {shaderPath.split("/").pop() || "default.wgsl"}
      </button>
      <Handle type="target" position={Position.Left} id="mesh" className="w-3 h-3 bg-secondary border-2 border-background" />
      <Handle type="target" position={Position.Left} id="texture" style={{ top: "70%" }} className="w-3 h-3 bg-orange-500 border-2 border-background" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const MaterialNode = memo(MaterialNodeComponent)
