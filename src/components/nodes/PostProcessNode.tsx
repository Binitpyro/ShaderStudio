import { memo, useState, useEffect } from "react"
import { Sparkles } from "lucide-react"
import { Button, Select } from "@/components/ui"
import { NodeShell, NodeDetails, DetailRow, Port, Position, nodeRangeClass } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import type { PostProcessNodeData } from "@/core/graphCompiler"
import type { PostProcessPassType } from "@/core/postProcessChain"
import { getActiveAdapter } from "@/adapters/activeAdapter"

const PASS_OPTIONS: { value: PostProcessPassType; label: string }[] = [
  { value: "vignette", label: "Vignette" },
  { value: "blur", label: "Gaussian Blur" },
  { value: "chromatic_aberration", label: "Chromatic Aberration" },
  { value: "bloom", label: "Bloom / Glow" },
  { value: "custom", label: "Custom Shader" },
  { value: "passthrough", label: "Passthrough" },
]

function PostProcessNodeComponent({ id, data, selected }: FlowNodeProps<PostProcessNodeData>) {
  const passType: PostProcessPassType = data.passType || "vignette"

  const getInitialNumber = (key: string, fallback: number): number => {
    const val = data.params?.[key]
    return typeof val === "number" ? val : fallback
  }

  // Local state for immediate smooth slider response
  const [params, setParams] = useState<Record<string, number>>(() => ({
    intensity: getInitialNumber("intensity", 0.5),
    radius: getInitialNumber("radius", 0.8),
    blurAmount: getInitialNumber("blurAmount", 2.0),
    aberrationOffset: getInitialNumber("aberrationOffset", 0.008),
    bloomThreshold: getInitialNumber("bloomThreshold", 0.7),
    bloomIntensity: getInitialNumber("bloomIntensity", 0.5),
  }))

  useEffect(() => {
    if (data.params) {
      const numericParams: Record<string, number> = {}
      for (const [k, v] of Object.entries(data.params)) {
        if (typeof v === "number") {
          numericParams[k] = v
        }
      }
      setParams((prev) => ({ ...prev, ...numericParams }))
    }
  }, [data.params])

  const handleTypeChange = (newType: PostProcessPassType) => {
    const event = new CustomEvent("postProcessTypeChange", {
      detail: { nodeId: id, passType: newType, params },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const handleSliderChange = (paramName: string, val: number) => {
    const next = { ...params, [paramName]: val }
    setParams(next)

    // 1. Direct adapter call for 60 FPS update
    const adapter = getActiveAdapter()
    if (adapter?.updatePostProcessUniform) {
      adapter.updatePostProcessUniform(id, paramName, val)
    }

    // 2. Dispatch event for node state sync
    const event = new CustomEvent("postProcessParamChange", {
      detail: { nodeId: id, paramName, value: val, allParams: next },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const handleEditCustom = () => {
    const event = new CustomEvent("editPostProcessShader", {
      detail: { nodeId: id, customSource: data.customSource },
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const range = (name: string, label: string, min: number, max: number, step: number, fallback: number, digits: number) => (
    <div>
      <div className="mb-1 flex justify-between text-2xs text-fg-muted">
        <span>{label}</span>
        <span className="num text-fg">{(params[name] ?? fallback).toFixed(digits)}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={params[name] ?? fallback}
        onChange={(e) => handleSliderChange(name, parseFloat(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={nodeRangeClass}
      />
    </div>
  )

  return (
    <NodeShell
      title="Post Process"
      icon={Sparkles}
      selected={selected}
      meta={<span>{passType}</span>}
      ports={
        <>
          <Port type="target" position={Position.Left} portType="surface" />
          <Port type="source" position={Position.Right} portType="surface" />
        </>
      }
    >
      <Select aria-label="Pass type" value={passType} onChange={(e) => handleTypeChange(e.target.value as PostProcessPassType)} className="nodrag">
        {PASS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </Select>

      {passType === "vignette" && (
        <div className="flex flex-col gap-2 nodrag">
          {range("intensity", "Intensity", 0, 1, 0.05, 0.5, 2)}
          {range("radius", "Radius", 0.1, 2.0, 0.05, 0.8, 2)}
        </div>
      )}
      {passType === "blur" && (
        <div className="flex flex-col gap-2 nodrag">{range("blurAmount", "Blur amount", 0, 10, 0.2, 2.0, 1)}</div>
      )}
      {passType === "chromatic_aberration" && (
        <div className="flex flex-col gap-2 nodrag">{range("aberrationOffset", "Offset", 0.001, 0.05, 0.001, 0.008, 3)}</div>
      )}
      {passType === "bloom" && (
        <div className="flex flex-col gap-2 nodrag">
          {range("bloomThreshold", "Threshold", 0.1, 1.0, 0.05, 0.7, 2)}
          {range("bloomIntensity", "Intensity", 0.1, 2.0, 0.05, 0.5, 2)}
        </div>
      )}
      {passType === "custom" && (
        <Button variant="secondary" size="sm" onClick={handleEditCustom} className="w-full nodrag">Edit shader code</Button>
      )}

      {selected && (
        <NodeDetails title="Pass pipeline">
          <DetailRow label="Node id" value={id} />
          <DetailRow label="Buffer format" value="RGBA16Float" />
          <DetailRow label="Sampling" value="Bilinear" />
        </NodeDetails>
      )}
    </NodeShell>
  )
}

export const PostProcessNode = memo(PostProcessNodeComponent)
