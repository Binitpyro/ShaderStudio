import { memo, useState, useCallback, useMemo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { MathExpressionNodeData } from "@/core/graphCompiler"
import { validateMathExpression } from "@/core/mathExpressionValidator"
import { Calculator, CheckCircle2, AlertCircle, Plus, X } from "lucide-react"

function MathExpressionNodeComponent({ id, data, selected }: FlowNodeProps<MathExpressionNodeData>) {
  const [expression, setExpression] = useState(data.expression || "sin(uv.x * 10.0) * 0.5 + 0.5")
  const [inputNames, setInputNames] = useState<string[]>(data.inputNames || ["uv"])
  const [newPortName, setNewPortName] = useState("")
  const [outputType, setOutputType] = useState<"float" | "vec2" | "vec3" | "vec4">(data.outputType || "float")

  const validation = useMemo(() => {
    return validateMathExpression(expression, inputNames)
  }, [expression, inputNames])

  const handleExpressionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setExpression(val)
      data.expression = val
      const res = validateMathExpression(val, inputNames)
      data.syntaxError = res.error
      data.error = res.error
      if (res.outputType) {
        data.outputType = res.outputType
        setOutputType(res.outputType)
      }
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, expression: val, syntaxError: res.error } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data, inputNames]
  )

  const handleAddInput = useCallback(() => {
    const trimmed = newPortName.trim()
    if (!trimmed || inputNames.includes(trimmed)) return
    const updated = [...inputNames, trimmed]
    setInputNames(updated)
    data.inputNames = updated
    setNewPortName("")
    const evt = new CustomEvent("nodeDataChanged", {
      detail: { nodeId: id, data: { ...data, inputNames: updated } },
      bubbles: true,
    })
    document.dispatchEvent(evt)
  }, [id, data, inputNames, newPortName])

  const handleRemoveInput = useCallback(
    (name: string) => {
      const updated = inputNames.filter((n) => n !== name)
      setInputNames(updated)
      data.inputNames = updated
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, inputNames: updated } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data, inputNames]
  )

  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-3 shadow-md select-none text-foreground transition-all duration-150 min-w-[260px] max-w-[340px]",
        selected ? "ring-2 ring-primary/40 shadow-xl" : "hover:border-border/80",
        validation.isValid ? "border-emerald-500/60" : "border-destructive/80 ring-1 ring-destructive/30"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Calculator className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground truncate">Math Expression</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {validation.isValid ? (
            <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-2.5 w-2.5" />
              <span>VALID</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[9px] font-mono text-destructive font-bold px-1.5 py-0.5 rounded bg-destructive/10 border border-destructive/20">
              <AlertCircle className="h-2.5 w-2.5" />
              <span>SYNTAX</span>
            </span>
          )}
        </div>
      </div>

      {/* Formula Input */}
      <div className="mb-2">
        <label className="text-[10px] text-muted-foreground font-mono block mb-1">
          f({inputNames.join(", ")}) =
        </label>
        <input
          type="text"
          value={expression}
          onChange={handleExpressionChange}
          placeholder="e.g. sin(uv.x * 10.0) * 0.5 + 0.5"
          className={cn(
            "w-full bg-background font-mono text-xs border rounded px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none nodrag transition-colors",
            validation.isValid
              ? "border-border focus:border-emerald-500"
              : "border-destructive focus:border-destructive bg-destructive/5"
          )}
        />
        {!validation.isValid && validation.error && (
          <p className="mt-1 text-[10px] text-destructive font-mono leading-tight bg-destructive/10 p-1 rounded border border-destructive/20">
            {validation.error}
          </p>
        )}
      </div>

      {/* Ports and Handles Area */}
      <div className="flex justify-between gap-4 text-[10px] font-mono pt-2 border-t border-border/40">
        {/* Input Handles List */}
        <div className="flex flex-col gap-1.5 relative flex-1">
          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">
            Inputs
          </span>
          {inputNames.map((name) => (
            <div key={name} className="relative flex items-center justify-between gap-1 h-5 group">
              <div className="flex items-center gap-1.5">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={name}
                  className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background"
                  style={{ left: "-18px" }}
                />
                <span className="text-foreground/90 font-medium">{name}</span>
              </div>
              {name !== "uv" && (
                <button
                  type="button"
                  onClick={() => handleRemoveInput(name)}
                  className="text-muted-foreground hover:text-destructive p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity nodrag"
                  title={`Remove input '${name}'`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add input field */}
          <div className="flex items-center gap-1 mt-1 nodrag">
            <input
              type="text"
              value={newPortName}
              onChange={(e) => setNewPortName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddInput()}
              placeholder="+ input"
              className="w-16 bg-background text-[10px] border border-border rounded px-1.5 py-0.5 font-mono"
            />
            <button
              type="button"
              onClick={handleAddInput}
              className="p-1 rounded bg-muted hover:bg-muted/80 text-foreground"
              title="Add input port"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Output Handle */}
        <div className="flex flex-col items-end gap-1.5 relative shrink-0">
          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">
            Output
          </span>
          <div className="relative flex items-center gap-1.5 h-5">
            <select
              value={outputType}
              onChange={(e) => {
                const t = e.target.value as typeof outputType
                setOutputType(t)
                data.outputType = t
              }}
              className="bg-background text-[9px] font-mono border border-border rounded px-1 py-0.5 nodrag"
            >
              <option value="float">float</option>
              <option value="vec2">vec2</option>
              <option value="vec3">vec3</option>
              <option value="vec4">vec4</option>
            </select>
            <Handle
              type="source"
              position={Position.Right}
              id="output"
              className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-background"
              style={{ right: "-18px" }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const MathExpressionNode = memo(MathExpressionNodeComponent)
