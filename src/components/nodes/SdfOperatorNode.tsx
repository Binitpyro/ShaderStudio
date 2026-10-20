import { memo, useCallback } from "react"
import { useReactFlow } from "@xyflow/react"
import { Label, Slider } from "@/components/ui"
import { NodeShell, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
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

  const { updateNodeData } = useReactFlow()

  // React Flow owns node data: update through its API instead of mutating props.
  const updateData = useCallback(
    (newType: SdfOperatorType, newParams: any) => {
      updateNodeData(id, { operatorType: newType, params: newParams })
    },
    [id, updateNodeData]
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
    <NodeShell
      title="SDF Operator"
      icon={Combine}
      selected={selected}
      meta={<span>{operatorType.replace("smooth_", "s-")}</span>}
      ports={
        <>
          <Port type="target" position={Position.Left} id="a" portType="geometry" style={{ top: isSingleInput ? "50%" : "30%" }} />
          {!isSingleInput && <Port type="target" position={Position.Left} id="b" portType="geometry" style={{ top: "70%" }} />}
          <Port type="source" position={Position.Right} id="sdf" portType="geometry" />
        </>
      }
    >
      <div className="grid grid-cols-3 gap-1">
        {OPERATOR_TYPES.map((op) => (
          <button
            key={op.id}
            type="button"
            onClick={() => handleTypeChange(op.id)}
            aria-pressed={operatorType === op.id}
            className={cn(
              "h-7 truncate rounded-md px-1 text-2xs font-medium transition-colors nodrag",
              operatorType === op.id ? "bg-brand text-brand-fg" : "bg-raised text-fg-muted hover:bg-hover hover:text-fg"
            )}
          >
            {op.label}
          </button>
        ))}
      </div>

      {isSmooth && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Smoothness (k)</Label>
            <span className="num text-xs text-fg-muted">{(params.smoothness ?? 0.2).toFixed(2)}</span>
          </div>
          <Slider value={[params.smoothness ?? 0.2]} min={0.01} max={1.0} step={0.02} onValueChange={([v]) => handleSmoothnessChange(v)} />
        </div>
      )}

      {isTwist && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Twist rate</Label>
            <span className="num text-xs text-fg-muted">{(params.twistRate ?? 1.0).toFixed(2)}</span>
          </div>
          <Slider value={[params.twistRate ?? 1.0]} min={0.1} max={4.0} step={0.1} onValueChange={([v]) => handleTwistRateChange(v)} />
        </div>
      )}
    </NodeShell>
  )
}

export const SdfOperatorNode = memo(SdfOperatorNodeComponent)
