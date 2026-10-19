import { memo, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { CustomNodeData } from "@/core/graphCompiler"
import { customNodeRegistry } from "@/core/customNodeSdk"
import { Cpu, ToggleLeft, ToggleRight } from "lucide-react"

function GenericCustomNodeComponent({ id, data, selected }: FlowNodeProps<CustomNodeData>) {
  const manifest = customNodeRegistry.get(data.manifestId)
  const customComponentName = data.customComponent || manifest?.customComponent || manifest?.customUiComponent
  const CustomComponent = customComponentName ? customNodeRegistry.getComponent(customComponentName) : null

  // If power user registered a custom React component, render it
  if (CustomComponent) {
    return <CustomComponent id={id} data={data} selected={selected} manifest={manifest} />
  }

  const [params, setParams] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = { ...(data.parameters || {}) }
    if (manifest) {
      for (const p of manifest.parameters) {
        if (initial[p.name] === undefined) {
          initial[p.name] = p.default ?? p.defaultValue ?? 0
        }
      }
    }
    return initial
  })

  const handleParamChange = useCallback(
    (name: string, value: any) => {
      setParams((prev) => {
        const next = { ...prev, [name]: value }
        if (!data.parameters) data.parameters = {}
        data.parameters[name] = value
        const evt = new CustomEvent("nodeDataChanged", {
          detail: { nodeId: id, data: { ...data, parameters: next } },
          bubbles: true,
        })
        document.dispatchEvent(evt)
        return next
      })
    },
    [id, data]
  )

  const title = manifest?.name || manifest?.title || data.manifestId || "Custom Node"
  const category = manifest?.category || "Custom"
  const inputs = manifest?.inputs || []
  const outputs = manifest?.outputs || []
  const parameters = manifest?.parameters || []

  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-3 shadow-md select-none text-foreground transition-all duration-150 min-w-[210px] max-w-[280px]",
        selected
          ? "border-primary ring-2 ring-primary/40 shadow-xl"
          : "border-border hover:border-border/80"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Cpu className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground truncate" title={title}>
            {title}
          </span>
        </div>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
          {category}
        </span>
      </div>

      {/* Description */}
      {manifest?.description && (
        <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed italic">
          {manifest.description}
        </p>
      )}

      {/* Ports Layer */}
      <div className="flex justify-between gap-4 text-[10px] font-mono mb-2">
        {/* Input Handles */}
        <div className="flex flex-col gap-1.5 relative">
          {inputs.map((port) => (
            <div key={port.id || port.name} className="relative flex items-center gap-1.5 h-5">
              <Handle
                type="target"
                position={Position.Left}
                id={port.id || port.name}
                className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background"
                style={{ left: "-18px" }}
              />
              <span className="text-foreground/90 font-medium">{port.name}</span>
              <span className="text-[8px] text-muted-foreground/70 lowercase">({port.type})</span>
            </div>
          ))}
          {inputs.length === 0 && (
            <span className="text-[8px] text-muted-foreground italic">No inputs</span>
          )}
        </div>

        {/* Output Handles */}
        <div className="flex flex-col gap-1.5 items-end relative">
          {outputs.map((port) => (
            <div key={port.id || port.name} className="relative flex items-center gap-1.5 h-5">
              <span className="text-[8px] text-muted-foreground/70 lowercase">({port.type})</span>
              <span className="text-foreground/90 font-medium">{port.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id || port.name}
                className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-background"
                style={{ right: "-18px" }}
              />
            </div>
          ))}
          {outputs.length === 0 && (
            <span className="text-[8px] text-muted-foreground italic">No outputs</span>
          )}
        </div>
      </div>

      {/* Interactive Parameter Controls */}
      {parameters.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border/50 flex flex-col gap-2 nodrag">
          {parameters.map((param) => {
            const val = params[param.name] ?? param.default ?? 0
            const uiType = typeof param.ui === "object" ? param.ui?.widget : param.ui
            const min = param.min ?? (typeof param.ui === "object" ? param.ui?.min : 0) ?? 0
            const max = param.max ?? (typeof param.ui === "object" ? param.ui?.max : 1) ?? 1
            const step = param.step ?? (typeof param.ui === "object" ? param.ui?.step : 0.01) ?? 0.01

            return (
              <div key={param.name} className="flex flex-col gap-1 text-[10px]">
                <div className="flex justify-between items-center text-muted-foreground font-mono">
                  <span>{param.name}</span>
                  <span className="text-foreground font-semibold">
                    {typeof val === "number" ? val.toFixed(2) : String(val)}
                  </span>
                </div>

                {uiType === "slider" ? (
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleParamChange(param.name, parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                ) : uiType === "color-picker" ? (
                  <input
                    type="color"
                    value={typeof val === "string" ? val : "#ffffff"}
                    onChange={(e) => handleParamChange(param.name, e.target.value)}
                    className="w-full h-6 rounded border border-border bg-background cursor-pointer"
                  />
                ) : uiType === "switch" || param.type === "bool" || param.type === "boolean" ? (
                  <button
                    type="button"
                    onClick={() => handleParamChange(param.name, !val)}
                    className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
                  >
                    {val ? (
                      <ToggleRight className="h-4 w-4 text-primary" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{val ? "Enabled" : "Disabled"}</span>
                  </button>
                ) : uiType === "dropdown" && param.options ? (
                  <select
                    value={val}
                    onChange={(e) => handleParamChange(param.name, e.target.value)}
                    className="w-full bg-background text-xs border border-border rounded px-2 py-1 font-mono"
                  >
                    {param.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleParamChange(param.name, parseFloat(e.target.value))}
                    className="w-full bg-background text-xs border border-border rounded px-2 py-0.5 font-mono"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const GenericCustomNode = memo(GenericCustomNodeComponent)
