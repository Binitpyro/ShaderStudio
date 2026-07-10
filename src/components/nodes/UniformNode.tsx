import { memo, useState, useEffect } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/projectStore"
import type { UniformNodeData } from "@/core/graphCompiler"

const TYPE_OPTIONS = ["float", "vec2", "vec3", "vec4", "color", "bool"] as const

function UniformNodeComponent({ data, selected, id }: NodeProps<UniformNodeData>) {
  const [name, setName] = useState(data.name || "param")
  const [type, setType] = useState<"float" | "vec2" | "vec3" | "vec4" | "color" | "bool">(data.uniformType || "float")
  const addGraphUniform = useProjectStore((s) => s.addGraphUniform)
  const updateGraphUniform = useProjectStore((s) => s.updateGraphUniform)
  const removeGraphUniform = useProjectStore((s) => s.removeGraphUniform)

  useEffect(() => {
    const uniformId = data.uniformId || `uniform_${id}`
    addGraphUniform({ id: uniformId, name, type, defaultValue: type === "bool" ? false : type === "float" ? 0.5 : type === "vec2" ? [0, 0] : [0.5, 0.5, 0.5] })
    return () => { removeGraphUniform(uniformId) }
  }, [id])

  useEffect(() => {
    const uniformId = data.uniformId || `uniform_${id}`
    updateGraphUniform(uniformId, { name, type })
  }, [name, type, id])

  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[140px] shadow-sm", selected ? "border-primary" : "border-border")}>
      <div className="text-xs font-semibold text-foreground mb-2">Uniform</div>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="name" className="w-full bg-background text-xs border border-border rounded px-2 py-1 mb-2" />
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-full bg-background text-xs border border-border rounded px-2 py-1">
        {TYPE_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
      </select>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-green-500 border-2 border-background" />
    </div>
  )
}
export const UniformNode = memo(UniformNodeComponent)
