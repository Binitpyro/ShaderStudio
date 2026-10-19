import { memo, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Combine } from "lucide-react"
import type { SdfOperatorNodeData } from "@/core/graphCompiler"
import type { SdfOperatorType } from "@/core/sdf/sdfOperators"
import { DEFAULT_OPERATOR_PARAMS } from "@/core/sdf/sdfOperators"

const OPERATOR_TYPES: Array<{ id: SdfOperatorType; label: string }> = [
  { id: "smooth_union", label: "Smooth Union" },
  { id: "union", label: "Union" },
  { id: "subtraction", label: "Subtract" },
  { id: "intersection", label: "Intersect" },
  { id: "repetition", label: "Repeat" },
  { id: "twist", label: "Twist" },
]

function SdfOperatorNodeComponent({ id, data, selected }: FlowNodeProps<SdfOperatorNodeData>) {
  const operatorType = data.operatorType || "smooth_union"
  const params = data.params || DEFAULT_OPERATOR_PARAMS[operatorType]

  const updateData = useCallback(
    (newType: SdfOperatorType, newParams: any) => {
      data.operatorType = newType
      data.params = newParams
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, operatorType: newType, params: newParams } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
  )

  const handleTypeChange = (newType: SdfOperatorType) => {
    const defaultParams = { ...DEFAULT_OPERATOR_PARAMS[newType] }
    updateData(newType, defaultParams)
  }

  const handleSmoothnessChange = (smoothness: number) => {
    updateData(operatorType, { ...params, smoothness })
  }

  const handleTwistRateChange = (twistRate: number) => {
    updateData(operatorType, { ...params, twistRate })
  }

  const isSmooth = operatorType.startsWith("smooth_")
  const isTwist = operatorType === "twist"
  const isSingleInput = operatorType === "repetition" || operatorType === "twist"

  return (
    <div
      className={cn(
        "bg-card/95 backdrop-blur-md border rounded-lg p-3 w-[220px] shadow-md transition-all relative",
        selected ? "border-primary ring-1 ring-primary/40" : "border-border/80"
      )}
    >
      {/* Target input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="a"
        style={{ top: isSingleInput ? "50%" : "30%" }}
        className="w-3 h-3 bg-cyan-400 border-2 border-background shadow-xs hover:scale-125 transition-transform"
      />
      {!isSingleInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="b"
          style={{ top: "70%" }}
          className="w-3 h-3 bg-cyan-400 border-2 border-background shadow-xs hover:scale-125 transition-transform"
        />
      )}

      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <Combine className="h-3.5 w-3.5 text-purple-400" />
          <span className="text-xs font-semibold tracking-wide">SDF Operator</span>
        </div>
        <span className="text-[10px] font-mono uppercase text-muted-foreground px-1.5 py-0.5 bg-muted/40 rounded">
          {operatorType.replace("smooth_", "s-")}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1">
          {OPERATOR_TYPES.map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => handleTypeChange(op.id)}
              className={cn(
                "py-0.5 px-1 rounded text-[10px] font-medium transition-all border cursor-pointer text-center truncate",
                operatorType === op.id
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-background/80 text-muted-foreground border-border/70 hover:text-foreground hover:border-primary/40"
              )}
            >
              {op.label}
            </button>
          ))}
        </div>

        {isSmooth && (
          <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <Label className="text-[11px]">Smoothness (k)</Label>
              <span className="text-muted-foreground">{(params.smoothness ?? 0.2).toFixed(2)}</span>
            </div>
            <Slider
              value={[params.smoothness ?? 0.2]}
              min={0.01}
              max={1.0}
              step={0.02}
              onValueChange={([v]) => handleSmoothnessChange(v)}
            />
          </div>
        )}

        {isTwist && (
          <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <Label className="text-[11px]">Twist Rate</Label>
              <span className="text-muted-foreground">{(params.twistRate ?? 1.0).toFixed(2)}</span>
            </div>
            <Slider
              value={[params.twistRate ?? 1.0]}
              min={0.1}
              max={4.0}
              step={0.1}
              onValueChange={([v]) => handleTwistRateChange(v)}
            />
          </div>
        )}
      </div>

      {/* Output SDF handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="sdf"
        className="w-3 h-3 bg-purple-400 border-2 border-background shadow-xs hover:scale-125 transition-transform"
      />
    </div>
  )
}

export const SdfOperatorNode = memo(SdfOperatorNodeComponent)
