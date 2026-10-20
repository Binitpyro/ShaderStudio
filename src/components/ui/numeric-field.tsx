import * as React from "react"
import { cn } from "@/lib/utils"

const clamp = (v: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
const roundTo = (v: number, step: number) => Number(v.toFixed(Math.min(8, Math.max(0, -Math.floor(Math.log10(step))) + 2)))

export interface NumericFieldProps {
  value: number
  onChange: (v: number) => void
  label?: string
  unit?: string
  min?: number
  max?: number
  step?: number
  /** Decimals shown when not editing. Default derived from step. */
  precision?: number
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
}

/**
 * Number input with drag-to-scrub on the label (or the left grip when no label).
 * Drag: step per 2px; Shift = x10, Alt = x0.1. Keys: Up/Down = step (Shift x10), Enter/blur commits, Esc reverts.
 */
export function NumericField({ value, onChange, label, unit, min, max, step = 0.01, precision, disabled, id, className, ...rest }: NumericFieldProps) {
  const dec = precision ?? Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))))
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(dec) : "")
  const [draft, setDraft] = React.useState<string | null>(null)
  const drag = React.useRef<{ x: number; v: number } | null>(null)
  const commit = (v: number) => {
    if (Number.isFinite(v)) onChange(roundTo(clamp(v, min, max), step))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, v: value }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    commit(d.v + Math.round((e.clientX - d.x) / 2) * step * mult)
  }
  const end = (e: React.PointerEvent<HTMLElement>) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div className={cn("nodrag nopan inline-flex h-8 items-center rounded-md border border-line-strong bg-raised transition-colors focus-within:border-brand hover:border-fg-subtle/60 aria-disabled:opacity-50", className)} aria-disabled={disabled || undefined}>
      <span
        data-scrub
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
        aria-hidden
        className={cn("flex h-full min-w-7 shrink-0 cursor-ew-resize touch-none select-none items-center justify-center px-1.5 text-xs text-fg-subtle hover:text-fg", disabled && "pointer-events-none")}
      >
        {label ?? "⋮⋮"}
      </span>
      <input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        aria-label={rest["aria-label"] ?? label}
        value={draft ?? fmt(value)}
        onFocus={(e) => { setDraft(fmt(value)); e.currentTarget.select() }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) commit(parseFloat(draft)); setDraft(null) }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(parseFloat(draft ?? "")); setDraft(null); e.currentTarget.blur() }
          else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur() }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const s = step * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1)
            commit((draft !== null ? parseFloat(draft) : value) + s)
            setDraft(null)
          }
        }}
        className="num h-full min-w-0 flex-1 bg-transparent pr-1 text-right text-sm text-fg outline-none focus-visible:outline-none"
      />
      {unit ? <span className="select-none pr-2 text-xs text-fg-subtle">{unit}</span> : null}
    </div>
  )
}
