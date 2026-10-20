import { memo } from "react"
import { Sparkles } from "lucide-react"
import { Badge, Button } from "@/components/ui"
import { NodeShell, NodeDetails, DetailRow, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
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
    <NodeShell
      title="Material"
      icon={Sparkles}
      selected={selected}
      meta={<Badge tone="brand">{isWgsl ? "WGSL" : "GLSL"}</Badge>}
      ports={
        <>
          <Port type="target" position={Position.Left} id="mesh" portType="geometry" style={{ top: "30%" }} />
          <Port type="target" position={Position.Left} id="texture" portType="texture" style={{ top: "60%" }} />
          <Port type="target" position={Position.Left} id="audio" portType="audio" style={{ top: "85%" }} />
          <Port type="source" position={Position.Right} portType="surface" />
        </>
      }
    >
      <div className="num truncate rounded-md bg-raised px-2 py-1.5 text-xs" title={shaderPath}>
        {shaderPath.split("/").pop() || "default.wgsl"}
      </div>
      {selected && (
        <>
          <NodeDetails title="Pipeline">
            <DetailRow label="Active uniforms" value={uniformCount} />
            <DetailRow label="Buffer layout" value="16B UBO stride" />
            <DetailRow label="Audio texture" value="512x2 R8" />
          </NodeDetails>
          <Button variant="secondary" size="sm" onClick={handleOpenInEditor} className="w-full nodrag">Open in Editor</Button>
        </>
      )}
    </NodeShell>
  )
}
export const MaterialNode = memo(MaterialNodeComponent)
