import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * CSS-only tooltip (no portal, no deps). Shows on hover and keyboard focus of the child.
 * ponytail: clipped by overflow:hidden ancestors and not collision-aware; swap for Radix Tooltip if that bites.
 */
export function Tooltip({ label, side = "top", className, children }: { label: React.ReactNode; side?: "top" | "bottom"; className?: string; children: React.ReactNode }) {
  const id = React.useId()
  const child = React.isValidElement<{ "aria-describedby"?: string }>(children)
    ? React.cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })
    : children
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {child}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-overlay px-2 py-1 text-xs text-fg opacity-0 shadow-md ring-1 ring-line-strong transition-opacity delay-300 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {label}
      </span>
    </span>
  )
}
