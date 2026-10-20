import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/** Accepts #rgb / #rrggbb (leading # optional); returns lowercase "#rrggbb" or null. */
export function parseHex(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]
  return `#${h.toLowerCase()}`
}

/** Swatch (native color picker) + hex readout. value is "#rrggbb". With `hexInput` the readout is an editable text field. */
export function ColorField({ value, onChange, "aria-label": ariaLabel = "Color", disabled, className, hexInput }: { value: string; onChange: (hex: string) => void; "aria-label"?: string; disabled?: boolean; className?: string; hexInput?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    const hex = parseHex(draft)
    if (hex && hex !== value.toLowerCase()) onChange(hex)
    else setDraft(value) // invalid or unchanged: revert
  }

  return (
    <label className={cn("nodrag nopan inline-flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-raised pl-1.5 pr-2.5 transition-colors focus-within:border-brand hover:border-fg-subtle/60 has-[:disabled]:opacity-50", className)}>
      <span className="relative size-5 shrink-0 overflow-hidden rounded-sm ring-1 ring-inset ring-line-strong" style={{ background: value }}>
        <input type="color" aria-label={ariaLabel} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </span>
      {hexInput ? (
        <input
          type="text"
          aria-label={`${ariaLabel} hex`}
          spellCheck={false}
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit() }
            else if (e.key === "Escape") setDraft(value)
          }}
          className="num min-w-0 flex-1 bg-transparent text-xs uppercase text-fg-muted outline-none focus:text-fg"
        />
      ) : (
        <span className="num text-xs uppercase text-fg-muted">{value}</span>
      )}
    </label>
  )
}
