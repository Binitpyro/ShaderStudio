import * as React from "react"
import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> { value: T; label: React.ReactNode; disabled?: boolean; title?: string }

/** Radio-group segmented control for 2-5 mutually exclusive options (backend, resolution...). Arrow keys move selection. */
export function Segmented<T extends string>({ value, onValueChange, options, "aria-label": ariaLabel, className }: { value: T; onValueChange: (v: T) => void; options: SegmentedOption<T>[]; "aria-label": string; className?: string }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!d || i < 0) return
    e.preventDefault()
    const group = e.currentTarget
    onValueChange(enabled[(i + d + enabled.length) % enabled.length].value)
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-raised p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={o.disabled} title={o.title}
            onClick={() => onValueChange(o.value)}
            className={cn("h-7 min-w-7 rounded-sm px-2.5 text-xs font-medium transition-colors disabled:opacity-50", on ? "bg-panel text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
