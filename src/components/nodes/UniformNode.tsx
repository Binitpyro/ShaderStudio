import { memo, useEffect } from "react"
import { useReactFlow } from "@xyflow/react"
import { Sliders } from "lucide-react"
import { Input, Select } from "@/components/ui"
import { NodeShell, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { useProjectStore } from "@/stores/projectStore"
import type { UniformNodeData } from "@/core/graphCompiler"

const TYPE_OPTIONS = ["float", "vec2", "vec3", "vec4", "color", "bool"] as const
type UniformType = (typeof TYPE_OPTIONS)[number]

function defaultFor(type: UniformType): number | number[] | boolean {
  switch (type) {
    case "bool": return false
    case "float": return 0.5
    case "vec2": return [0, 0]
    case "vec4": return [0.5, 0.5, 0.5, 1]
    default: return [0.5, 0.5, 0.5]
  }
}

function UniformNodeComponent({ data, selected, id }: FlowNodeProps<UniformNodeData>) {
  const { updateNodeData } = useReactFlow()
  // name/type live in node data so they survive save/load; the graph uniform is registered here but is
  // removed only when the node is deleted from the graph (NodeGraph), not when this component unmounts.
  const name = data.name || "param"
  const type: UniformType = data.uniformType || "float"
  const uniformId = data.uniformId || `uniform_${id}`

  useEffect(() => {
    const store = useProjectStore.getState()
    const existing = store.graphUniforms.find((u) => u.id === uniformId)
    if (!existing) {
      store.addGraphUniform({ id: uniformId, name, type, defaultValue: data.defaultValue ?? defaultFor(type) })
    } else if (existing.name !== name || existing.type !== type) {
      store.updateGraphUniform(uniformId, { name, type })
    }
  }, [uniformId, name, type, data.defaultValue])

  return (
    <NodeShell title="Uniform" icon={Sliders} size="sm" selected={selected} ports={<Port type="source" position={Position.Right} portType="value" />}>
      <Input value={name} onChange={(e) => updateNodeData(id, { name: e.target.value })} placeholder="Name" aria-label="Uniform name" className="h-7 text-xs nodrag" />
      <Select
        aria-label="Uniform type"
        value={type}
        onChange={(e) => {
          const next = e.target.value as UniformType
          updateNodeData(id, { uniformType: next, defaultValue: defaultFor(next) })
          useProjectStore.getState().updateGraphUniform(uniformId, { type: next, defaultValue: defaultFor(next) })
        }}
        className="nodrag"
      >
        {TYPE_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
      </Select>
    </NodeShell>
  )
}
export const UniformNode = memo(UniformNodeComponent)
