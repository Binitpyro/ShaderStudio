import { cn } from "@/lib/utils"

/** Swatch (native color picker) + hex readout. value is "#rrggbb". */
export function ColorField({ value, onChange, "aria-label": ariaLabel = "Color", disabled, className }: { value: string; onChange: (hex: string) => void; "aria-label"?: string; disabled?: boolean; className?: string }) {
  return (
    <label className={cn("nodrag nopan inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised pl-1.5 pr-2.5 transition-colors focus-within:border-brand hover:border-fg-subtle/60 has-[:disabled]:opacity-50", className)}>
      <span className="relative size-5 overflow-hidden rounded-sm ring-1 ring-inset ring-line-strong" style={{ background: value }}>
        <input type="color" aria-label={ariaLabel} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </span>
      <span className="num text-xs uppercase text-fg-muted">{value}</span>
    </label>
  )
}
