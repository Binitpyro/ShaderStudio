import { memo, useState, useCallback, useMemo } from "react"
import { Badge } from "@/components/ui"
import { NodeShell, Port, Position, nodeSelectClass } from "./NodeShell"
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
    <NodeShell
      title="Math Expression"
      icon={Calculator}
      size="lg"
      selected={selected}
      className={cn(!validation.isValid && "border-danger")}
      meta={
        validation.isValid ? (
          <Badge tone="success"><CheckCircle2 className="size-3" />VALID</Badge>
        ) : (
          <Badge tone="danger"><AlertCircle className="size-3" />SYNTAX</Badge>
        )
      }
    >
      <div>
        <label className="num mb-1 block text-2xs text-fg-muted">f({inputNames.join(", ")}) =</label>
        <input
          type="text"
          aria-label="Expression"
          value={expression}
          onChange={handleExpressionChange}
          placeholder="e.g. sin(uv.x * 10.0) * 0.5 + 0.5"
          aria-invalid={!validation.isValid}
          className={cn(nodeSelectClass, "num h-8 px-2.5", !validation.isValid && "border-danger")}
        />
        {!validation.isValid && validation.error && (
          <p className="num mt-1 rounded-md bg-danger-soft p-1.5 text-2xs leading-tight text-danger">{validation.error}</p>
        )}
      </div>

      <div className="flex justify-between gap-4 border-t border-line pt-2 text-xs">
        <div className="relative flex flex-1 flex-col gap-1.5">
          <span className="mb-0.5 text-2xs text-fg-subtle">Inputs</span>
          {inputNames.map((name) => (
            <div key={name} className="group relative flex h-5 items-center justify-between gap-1">
              <div className="flex items-center gap-1.5">
                <Port type="target" position={Position.Left} id={name} portType="value" style={{ left: "-18px" }} />
                <span className="num font-medium">{name}</span>
              </div>
              {name !== "uv" && (
                <button
                  type="button"
                  onClick={() => handleRemoveInput(name)}
                  className="rounded-sm p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 nodrag"
                  title={`Remove input '${name}'`}
                  aria-label={`Remove input ${name}`}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}

          <div className="mt-1 flex items-center gap-1 nodrag">
            <input
              type="text"
              aria-label="New input name"
              value={newPortName}
              onChange={(e) => setNewPortName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddInput()}
              placeholder="+ input"
              className={cn(nodeSelectClass, "num w-20")}
            />
            <button
              type="button"
              onClick={handleAddInput}
              className="grid size-7 place-items-center rounded-md bg-raised text-fg hover:bg-hover"
              title="Add input port"
              aria-label="Add input port"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>

        <div className="relative flex shrink-0 flex-col items-end gap-1.5">
          <span className="mb-0.5 text-2xs text-fg-subtle">Output</span>
          <div className="relative flex h-5 items-center gap-1.5">
            <select
              aria-label="Output type"
              value={outputType}
              onChange={(e) => {
                const t = e.target.value as typeof outputType
                setOutputType(t)
                data.outputType = t
              }}
              className={cn(nodeSelectClass, "num h-6 w-auto px-1 text-2xs")}
            >
              <option value="float">float</option>
              <option value="vec2">vec2</option>
              <option value="vec3">vec3</option>
              <option value="vec4">vec4</option>
            </select>
            <Port type="source" position={Position.Right} id="output" portType="value" style={{ right: "-18px" }} />
          </div>
        </div>
      </div>
    </NodeShell>
  )
}

export const MathExpressionNode = memo(MathExpressionNodeComponent)
