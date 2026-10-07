import { memo, useState, useCallback, useEffect } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import type { PostProcessNodeData } from "@/core/graphCompiler"
import type { PostProcessPassType } from "@/core/postProcessChain"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { useProjectStore } from "@/stores/projectStore"

const PASS_OPTIONS: { value: PostProcessPassType; label: string }[] = [
  { value: "vignette", label: "Vignette" },
  { value: "blur", label: "Gaussian Blur" },
  { value: "chromatic_aberration", label: "Chromatic Aberration" },
  { value: "bloom", label: "Bloom / Glow" },
  { value: "custom", label: "Custom Shader" },
  { value: "passthrough", label: "Passthrough" },
]

function PostProcessNodeComponent({ id, data, selected }: NodeProps<PostProcessNodeData>) {
  const activeBackend = useProjectStore((s) => s.activeBackend)
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

  const getAdapter = useCallback(() => {
    switch (activeBackend) {
      case "webgpu": return webgpuAdapter
      case "webgl2": return webgl2Adapter
      case "threejs": return threejsAdapter
      default: return webgpuAdapter
    }
  }, [activeBackend])

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
    const adapter = getAdapter()
    if (adapter.updatePostProcessUniform) {
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

  return (
    <div
      className={cn(
        "bg-card border rounded-md p-3 min-w-[190px] max-w-[220px] shadow-sm select-none text-foreground",
        selected ? "border-primary" : "border-border"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">Post Process</span>
        <span className="text-[10px] text-muted-foreground uppercase font-mono">{passType}</span>
      </div>

      <select
        value={passType}
        onChange={(e) => handleTypeChange(e.target.value as PostProcessPassType)}
        className="w-full bg-background text-xs border border-border rounded px-2 py-1 mb-2 font-mono"
      >
        {PASS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Contextual Sliders based on passType */}
      {passType === "vignette" && (
        <div className="space-y-2 pt-1 border-t border-border/50 text-[11px]">
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Intensity</span>
              <span>{(params.intensity ?? 0.5).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={params.intensity ?? 0.5}
              onChange={(e) => handleSliderChange("intensity", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Radius</span>
              <span>{(params.radius ?? 0.8).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              value={params.radius ?? 0.8}
              onChange={(e) => handleSliderChange("radius", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      )}

      {passType === "blur" && (
        <div className="space-y-2 pt-1 border-t border-border/50 text-[11px]">
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Blur Amount</span>
              <span>{(params.blurAmount ?? 2.0).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              step="0.2"
              value={params.blurAmount ?? 2.0}
              onChange={(e) => handleSliderChange("blurAmount", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      )}

      {passType === "chromatic_aberration" && (
        <div className="space-y-2 pt-1 border-t border-border/50 text-[11px]">
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Offset</span>
              <span>{(params.aberrationOffset ?? 0.008).toFixed(3)}</span>
            </div>
            <input
              type="range"
              min="0.001"
              max="0.05"
              step="0.001"
              value={params.aberrationOffset ?? 0.008}
              onChange={(e) => handleSliderChange("aberrationOffset", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      )}

      {passType === "bloom" && (
        <div className="space-y-2 pt-1 border-t border-border/50 text-[11px]">
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Threshold</span>
              <span>{(params.bloomThreshold ?? 0.7).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={params.bloomThreshold ?? 0.7}
              onChange={(e) => handleSliderChange("bloomThreshold", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
          <div>
            <div className="flex justify-between text-muted-foreground mb-0.5">
              <span>Intensity</span>
              <span>{(params.bloomIntensity ?? 0.5).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              value={params.bloomIntensity ?? 0.5}
              onChange={(e) => handleSliderChange("bloomIntensity", parseFloat(e.target.value))}
              className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      )}

      {passType === "custom" && (
        <div className="pt-2 border-t border-border/50">
          <button
            type="button"
            onClick={handleEditCustom}
            className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-2 py-1 text-xs font-medium transition-colors"
          >
            Edit Shader Code
          </button>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-secondary border-2 border-background" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}

export const PostProcessNode = memo(PostProcessNodeComponent)
