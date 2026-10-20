import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** Surface container. `raised` for nested cards. */
export function Panel({ className, raised, ...props }: React.HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return <div className={cn("flex min-h-0 flex-col text-fg", raised ? "rounded-lg border border-line bg-raised" : "bg-panel", className)} {...props} />
}

/** Sentence-case title row (40px) with optional right-aligned actions. One primary action per header. */
export function PanelHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium text-fg">{title}</h2>
        {description ? <p className="truncate text-xs text-fg-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

/** Collapsible section (native details: keyboard + a11y for free). Progressive disclosure: put advanced controls in closed sections. */
export function Section({ title, defaultOpen = true, actions, className, children }: { title: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className={cn("group border-b border-line", className)}>
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 px-3 text-xs font-medium text-fg-muted select-none hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
        <span className="flex-1">{title}</span>
        {actions ? <span className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>{actions}</span> : null}
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3 pt-1">{children}</div>
    </details>
  )
}

/** Label + control row: label left, control right. Use for inspector fields. */
export function Field({ label, htmlFor, className, children }: { label: React.ReactNode; htmlFor?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-7 items-center justify-between gap-3", className)}>
      <label htmlFor={htmlFor} className="shrink-0 text-xs text-fg-muted">{label}</label>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  )
}
