import { memo, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
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

  const updateData = useCallback(
    (newType: SdfPrimitiveType, newParams: any) => {
      data.primitiveType = newType
      data.params = newParams
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, primitiveType: newType, params: newParams } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
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

  return (
    <div
      className={cn(
        "bg-card/95 backdrop-blur-md border rounded-lg p-3 w-[220px] shadow-md transition-all",
        selected ? "border-primary ring-1 ring-primary/40" : "border-border/80"
      )}
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <Shapes className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wide">SDF Primitive</span>
        </div>
        <span className="text-[10px] font-mono uppercase text-muted-foreground px-1.5 py-0.5 bg-muted/40 rounded">
          {primitiveType}
        </span>
      </div>

      {/* Primitive Type selector */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1">
          {PRIMITIVE_TYPES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleTypeChange(p.id)}
              className={cn(
                "py-0.5 px-1 rounded text-[10px] font-medium transition-all border cursor-pointer text-center truncate",
                primitiveType === p.id
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-background/80 text-muted-foreground border-border/70 hover:text-foreground hover:border-primary/40"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Dynamic dimensions according to primitive */}
        {primitiveType === "sphere" && (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <Label className="text-[11px]">Radius</Label>
              <span className="text-muted-foreground">{(params.radius ?? 1.0).toFixed(2)}</span>
            </div>
            <Slider
              value={[params.radius ?? 1.0]}
              min={0.1}
              max={3.0}
              step={0.05}
              onValueChange={([v]) => handleRadiusChange(v)}
            />
          </div>
        )}

        {primitiveType === "box" && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <Label className="text-[11px]">Half-Extents</Label>
              <span className="text-muted-foreground">
                {(params.size?.[0] ?? 0.8).toFixed(1)}, {(params.size?.[1] ?? 0.8).toFixed(1)}
              </span>
            </div>
            <Slider
              value={[params.size?.[0] ?? 0.8]}
              min={0.1}
              max={2.5}
              step={0.05}
              onValueChange={([v]) => handleBoxSizeChange(0, v)}
            />
          </div>
        )}

        {primitiveType === "torus" && (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <Label className="text-[11px]">Major R</Label>
              <span className="text-muted-foreground">{(params.majorRadius ?? 1.0).toFixed(2)}</span>
            </div>
            <Slider
              value={[params.majorRadius ?? 1.0]}
              min={0.2}
              max={3.0}
              step={0.05}
              onValueChange={([v]) => handleMajorRadiusChange(v)}
            />
            <div className="flex items-center justify-between text-[11px] font-mono pt-1">
              <Label className="text-[11px]">Minor r</Label>
              <span className="text-muted-foreground">{(params.minorRadius ?? 0.35).toFixed(2)}</span>
            </div>
            <Slider
              value={[params.minorRadius ?? 0.35]}
              min={0.05}
              max={1.0}
              step={0.02}
              onValueChange={([v]) => handleMinorRadiusChange(v)}
            />
          </div>
        )}

        {/* Translation offset */}
        <div className="flex flex-col gap-1 pt-1.5 border-t border-border/40">
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
            <span>Offset X / Y</span>
            <span>
              {(params.offset?.[0] ?? 0).toFixed(1)}, {(params.offset?.[1] ?? 0).toFixed(1)}
            </span>
          </div>
          <Slider
            value={[params.offset?.[0] ?? 0]}
            min={-3.0}
            max={3.0}
            step={0.1}
            onValueChange={([v]) => handleOffsetChange(0, v)}
          />
        </div>
      </div>

      {/* Output SDF handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="sdf"
        className="w-3 h-3 bg-cyan-400 border-2 border-background shadow-xs hover:scale-125 transition-transform"
      />
    </div>
  )
}

export const SdfPrimitiveNode = memo(SdfPrimitiveNodeComponent)
