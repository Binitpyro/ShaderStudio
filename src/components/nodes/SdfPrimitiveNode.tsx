import { memo, useCallback } from "react"
import { useReactFlow } from "@xyflow/react"
import { Label, Slider } from "@/components/ui"
import { NodeShell, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { Shapes } from "lucide-react"
import type { SdfPrimitiveNodeData } from "@/core/graphCompiler"
import type { SdfPrimitiveType } from "@/core/sdf/sdfPrimitives"
import { DEFAULT_PRIMITIVE_PARAMS } from "@/core/sdf/sdfPrimitives"

const PRIMITIVE_TYPES: Array<{ id: SdfPrimitiveType; label: string }> = [
  { id: "sphere", label: "Sphere" },
  { id: "box", label: "Box" },
  { id: "torus", label: "Torus" },
  { id: "cylinder", label: "Cylinder" },
  { id: "capsule", label: "Capsule" },
  { id: "plane", label: "Plane" },
]

function SdfPrimitiveNodeComponent({ id, data, selected }: FlowNodeProps<SdfPrimitiveNodeData>) {
  const primitiveType = data.primitiveType || "sphere"
  const params = data.params || DEFAULT_PRIMITIVE_PARAMS[primitiveType]

  const { updateNodeData } = useReactFlow()

  // React Flow owns node data: update through its API instead of mutating props.
  const updateData = useCallback(
    (newType: SdfPrimitiveType, newParams: any) => {
      updateNodeData(id, { primitiveType: newType, params: newParams })
    },
    [id, updateNodeData]
  )

  const handleTypeChange = (newType: SdfPrimitiveType) => {
    const defaultParams = { ...DEFAULT_PRIMITIVE_PARAMS[newType] }
    updateData(newType, defaultParams)
  }

  const handleOffsetChange = (axis: 0 | 1 | 2, val: number) => {
    const newOffset: [number, number, number] = [
      axis === 0 ? val : (params.offset?.[0] ?? 0),
      axis === 1 ? val : (params.offset?.[1] ?? 0),
      axis === 2 ? val : (params.offset?.[2] ?? 0),
    ]
    updateData(primitiveType, { ...params, offset: newOffset })
  }

  const handleRadiusChange = (radius: number) => {
    updateData(primitiveType, { ...params, radius })
  }

  const handleMajorRadiusChange = (majorRadius: number) => {
    updateData(primitiveType, { ...params, majorRadius })
  }

  const handleMinorRadiusChange = (minorRadius: number) => {
    updateData(primitiveType, { ...params, minorRadius })
  }

  const handleBoxSizeChange = (axis: 0 | 1 | 2, val: number) => {
    const curSize = params.size ?? [0.8, 0.8, 0.8]
    const newSize: [number, number, number] = [
      axis === 0 ? val : curSize[0],
      axis === 1 ? val : curSize[1],
      axis === 2 ? val : curSize[2],
    ]
    updateData(primitiveType, { ...params, size: newSize })
  }

  const row = (label: string, value: string, slider: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="num text-xs text-fg-muted">{value}</span>
      </div>
      {slider}
    </div>
  )

  return (
    <NodeShell
      title="SDF Primitive"
      icon={Shapes}
      selected={selected}
      meta={<span>{primitiveType}</span>}
      ports={<Port type="source" position={Position.Right} id="sdf" portType="geometry" />}
    >
      <div className="grid grid-cols-3 gap-1">
        {PRIMITIVE_TYPES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleTypeChange(p.id)}
            aria-pressed={primitiveType === p.id}
            className={cn(
              "h-7 truncate rounded-md px-1 text-2xs font-medium transition-colors nodrag",
              primitiveType === p.id ? "bg-brand text-brand-fg" : "bg-raised text-fg-muted hover:bg-hover hover:text-fg"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {primitiveType === "sphere" &&
        row("Radius", (params.radius ?? 1.0).toFixed(2),
          <Slider value={[params.radius ?? 1.0]} min={0.1} max={3.0} step={0.05} onValueChange={([v]) => handleRadiusChange(v)} />)}

      {primitiveType === "box" &&
        row("Half-extents", `${(params.size?.[0] ?? 0.8).toFixed(1)}, ${(params.size?.[1] ?? 0.8).toFixed(1)}`,
          <Slider value={[params.size?.[0] ?? 0.8]} min={0.1} max={2.5} step={0.05} onValueChange={([v]) => handleBoxSizeChange(0, v)} />)}

      {primitiveType === "torus" && (
        <>
          {row("Major radius", (params.majorRadius ?? 1.0).toFixed(2),
            <Slider value={[params.majorRadius ?? 1.0]} min={0.2} max={3.0} step={0.05} onValueChange={([v]) => handleMajorRadiusChange(v)} />)}
          {row("Minor radius", (params.minorRadius ?? 0.35).toFixed(2),
            <Slider value={[params.minorRadius ?? 0.35]} min={0.05} max={1.0} step={0.02} onValueChange={([v]) => handleMinorRadiusChange(v)} />)}
        </>
      )}

      <div className="border-t border-line pt-2">
        {row("Offset X", `${(params.offset?.[0] ?? 0).toFixed(1)}, ${(params.offset?.[1] ?? 0).toFixed(1)}`,
          <Slider value={[params.offset?.[0] ?? 0]} min={-3.0} max={3.0} step={0.1} onValueChange={([v]) => handleOffsetChange(0, v)} />)}
      </div>
    </NodeShell>
  )
}

export const SdfPrimitiveNode = memo(SdfPrimitiveNodeComponent)
