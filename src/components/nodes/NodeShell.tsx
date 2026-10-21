import type { ReactNode } from "react"
import { Handle, Position, type HandleProps } from "@xyflow/react"
import { cn } from "@/lib/utils"

/** Port colour coding by data type (design tokens only). */
export type PortType = "geometry" | "texture" | "audio" | "value" | "surface"

const PORT_CLASS: Record<PortType, string> = {
  geometry: "!bg-info",
  texture: "!bg-warning",
  audio: "!bg-success",
  value: "!bg-brand-text",
  surface: "!bg-fg-muted",
}

/** A React Flow handle styled by port type: 12px dot, grows on hover. Its enlarged hit area lives in index.css ([data-port]). */
export function Port({ portType, className, ...props }: HandleProps & { portType: PortType; className?: string }) {
  return (
    <Handle
      {...props}
      data-port={portType}
      className={cn("!size-3 !rounded-full !border-2 !border-overlay transition-transform hover:!scale-150", PORT_CLASS[portType], className)}
    />
  )
}

export { Position }

interface NodeShellProps {
  title: string
  icon?: React.ElementType
  /** Right-aligned header content (status badge, count). */
  meta?: ReactNode
  selected?: boolean
  /** Consistent widths: sm 176px, md 224px (default), lg 256px. */
  size?: "sm" | "md" | "lg"
  className?: string
  /** Handles: rendered as direct children of the card so they sit on its edge. */
  ports?: ReactNode
  children?: ReactNode
}

const WIDTH = { sm: "w-44", md: "w-56", lg: "w-64" } as const

/** Shared node chrome: header (icon + sentence-case title + meta), compact body, accent ring when selected. */
export function NodeShell({ title, icon: Icon, meta, selected, size = "md", className, ports, children }: NodeShellProps) {
  return (
    <div
      className={cn(
        "relative select-none rounded-lg border bg-overlay text-fg shadow-sm transition-shadow",
        selected ? "border-brand ring-2 ring-brand/30 shadow-md" : "border-line-strong",
        WIDTH[size],
        className
      )}
    >
      <div className="flex h-8 items-center gap-2 border-b border-line px-3">
        {Icon && <Icon className="size-3.5 shrink-0 text-fg-muted" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {meta && <span className="shrink-0 text-2xs text-fg-subtle">{meta}</span>}
      </div>
      {children != null && <div className="flex flex-col gap-2 p-3">{children}</div>}
      {ports}
    </div>
  )
}

/** Selected-only read-only details block. */
export function NodeDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2 text-2xs">
      <span className="text-xs font-medium text-fg">{title}</span>
      <div className="flex flex-col gap-1 rounded-md bg-raised p-2">{children}</div>
    </div>
  )
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-fg-muted">
      <span>{label}</span>
      <span className="num truncate text-fg">{value}</span>
    </div>
  )
}

export const nodeSelectClass = "h-7 w-full rounded-md border border-line-strong bg-raised px-2 text-xs text-fg nodrag"
export const nodeRangeClass = "h-1 w-full cursor-pointer appearance-none rounded-full bg-active accent-brand nodrag nopan"
export const nodeLabelClass = "mb-1 block text-2xs text-fg-muted"
