import { memo, useState, useCallback } from "react"
import { Badge } from "@/components/ui"
import { NodeShell, Port, Position, nodeRangeClass, nodeSelectClass } from "./NodeShell"
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
    <NodeShell title={title} icon={Cpu} selected={selected} meta={<Badge tone="brand">{category}</Badge>}>
      {manifest?.description && <p className="text-2xs leading-relaxed text-fg-muted">{manifest.description}</p>}

      <div className="flex justify-between gap-4 text-xs">
        <div className="relative flex flex-col gap-1.5">
          {inputs.map((port) => (
            <div key={port.id || port.name} className="relative flex h-5 items-center gap-1.5">
              <Port type="target" position={Position.Left} id={port.id || port.name} portType="value" style={{ left: "-18px" }} />
              <span className="font-medium">{port.name}</span>
              <span className="text-2xs lowercase text-fg-subtle">({port.type})</span>
            </div>
          ))}
          {inputs.length === 0 && <span className="text-2xs text-fg-subtle">No inputs</span>}
        </div>

        <div className="relative flex flex-col items-end gap-1.5">
          {outputs.map((port) => (
            <div key={port.id || port.name} className="relative flex h-5 items-center gap-1.5">
              <span className="text-2xs lowercase text-fg-subtle">({port.type})</span>
              <span className="font-medium">{port.name}</span>
              <Port type="source" position={Position.Right} id={port.id || port.name} portType="value" style={{ right: "-18px" }} />
            </div>
          ))}
          {outputs.length === 0 && <span className="text-2xs text-fg-subtle">No outputs</span>}
        </div>
      </div>

      {parameters.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-2 nodrag">
          {parameters.map((param) => {
            const val = params[param.name] ?? param.default ?? 0
            const uiType = typeof param.ui === "object" ? param.ui?.widget : param.ui
            const min = param.min ?? (typeof param.ui === "object" ? param.ui?.min : 0) ?? 0
            const max = param.max ?? (typeof param.ui === "object" ? param.ui?.max : 1) ?? 1
            const step = param.step ?? (typeof param.ui === "object" ? param.ui?.step : 0.01) ?? 0.01

            return (
              <div key={param.name} className="flex flex-col gap-1 text-2xs">
                <div className="flex items-center justify-between text-fg-muted">
                  <span>{param.name}</span>
                  <span className="num text-fg">{typeof val === "number" ? val.toFixed(2) : String(val)}</span>
                </div>

                {uiType === "slider" ? (
                  <input
                    type="range"
                    aria-label={param.name}
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleParamChange(param.name, parseFloat(e.target.value))}
                    className={nodeRangeClass}
                  />
                ) : uiType === "color-picker" ? (
                  <input
                    type="color"
                    aria-label={param.name}
                    value={typeof val === "string" ? val : "#ffffff"}
                    onChange={(e) => handleParamChange(param.name, e.target.value)}
                    className="h-7 w-full cursor-pointer rounded-md border border-line-strong bg-raised"
                  />
                ) : uiType === "switch" || param.type === "bool" || param.type === "boolean" ? (
                  <button
                    type="button"
                    onClick={() => handleParamChange(param.name, !val)}
                    className="flex items-center gap-1.5 text-xs text-fg"
                  >
                    {val ? <ToggleRight className="size-4 text-brand-text" /> : <ToggleLeft className="size-4 text-fg-subtle" />}
                    <span>{val ? "Enabled" : "Disabled"}</span>
                  </button>
                ) : uiType === "dropdown" && param.options ? (
                  <select
                    aria-label={param.name}
                    value={val}
                    onChange={(e) => handleParamChange(param.name, e.target.value)}
                    className={nodeSelectClass}
                  >
                    {param.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    aria-label={param.name}
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleParamChange(param.name, parseFloat(e.target.value))}
                    className={cn(nodeSelectClass, "num")}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </NodeShell>
  )
}

export const GenericCustomNode = memo(GenericCustomNodeComponent)
