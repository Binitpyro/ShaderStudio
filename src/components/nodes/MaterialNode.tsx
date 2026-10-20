import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import type { MaterialNodeData } from "@/core/graphCompiler"

function MaterialNodeComponent({ data, selected }: FlowNodeProps<MaterialNodeData>) {
  const activeShaderPath = useProjectStore((s) => s.activeShaderPath)
  const shaderPath = data.shaderPath || activeShaderPath || "default.wgsl"
  const handleOpenInEditor = () => {
    const project = useProjectStore.getState()
    project.setActiveEditorTab(project.activeBackend === "webgpu" ? "render" : "fragment")
    useLayoutStore.getState().jumpToLine(1)
  }
  const uniformValues = useProjectStore((s) => s.uniformValues)
  const activeBackend = useProjectStore((s) => s.activeBackend)
  const isWgsl = shaderPath.endsWith(".wgsl") || activeBackend === "webgpu"
  const uniformCount = Object.keys(uniformValues).length

  return (
    <div
      className={cn(
        "bg-card border rounded-md p-3 shadow-sm select-none text-foreground transition-all duration-150",
        selected
          ? "border-primary ring-2 ring-primary/30 min-w-[200px] max-w-[230px] shadow-lg"
          : "border-border min-w-[140px] max-w-[180px]"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-foreground">Material</div>
        <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
          {isWgsl ? "WGSL" : "GLSL"}
        </span>
      </div>
      <div
        className="w-full bg-background text-xs border border-border rounded px-2 py-1 text-left truncate font-mono"
        title={shaderPath}
      >
        {shaderPath.split("/").pop() || "default.wgsl"}
      </div>

      {selected && (
        <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1.5 font-mono text-[10px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="font-semibold text-foreground text-[11px]">Pipeline Info</span>
            <span className="text-[9px] text-emerald-400 font-bold">LINKED</span>
          </div>

          <div className="p-1.5 rounded bg-muted/30 border border-border/50 flex flex-col gap-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Active Uniforms</span>
              <span className="text-foreground font-semibold">{uniformCount}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Buffer Layout</span>
              <span className="text-foreground font-semibold">16B UBO Stride</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Audio Texture</span>
              <span className="text-emerald-400 font-semibold">512×2 R8</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenInEditor}
            className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-2 py-1 text-[10px] font-semibold text-center transition-colors cursor-pointer nodrag"
          >
            Open in Editor
          </button>
        </div>
      )}
      <Handle type="target" position={Position.Left} id="mesh" className="w-3 h-3 bg-secondary border-2 border-background" />
      <Handle type="target" position={Position.Left} id="texture" style={{ top: "65%" }} className="w-3 h-3 bg-orange-500 border-2 border-background" />
      <Handle type="target" position={Position.Left} id="audio" style={{ top: "85%" }} className="w-3 h-3 bg-emerald-400 border-2 border-background" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const MaterialNode = memo(MaterialNodeComponent)
