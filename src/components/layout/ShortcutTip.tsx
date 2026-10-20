import * as React from "react"
import { IconButton, Kbd, type IconButtonProps } from "@/components/ui"
import { cn } from "@/lib/utils"

type Side = "top" | "bottom" | "bottom-start" | "bottom-end" | "right"

const SIDE: Record<Side, string> = {
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  "bottom-start": "top-full left-0 mt-1.5",
  "bottom-end": "top-full right-0 mt-1.5",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
}

/**
 * Hover/focus tooltip with an optional keyboard shortcut (`keys` -> one Kbd per key).
 * Same CSS-only approach as ui/Tooltip, plus edge-aligned and `right` placements for panel headers and the activity bar.
 * ponytail: not collision-aware; callers pick a side that stays inside their overflow box.
 */
export function ShortcutTip({ label, keys, side = "bottom", className, children }: { label: string; keys?: string[]; side?: Side; className?: string; children: React.ReactElement<{ "aria-describedby"?: string }> }) {
  const id = React.useId()
  const child = React.cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {child}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-overlay px-2 py-1 text-xs text-fg opacity-0 shadow-md ring-1 ring-line-strong transition-opacity delay-300 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          SIDE[side],
        )}
      >
        {label}
        {keys?.length ? <span className="flex items-center gap-0.5">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span> : null}
      </span>
    </span>
  )
}

/** Labelled icon button whose tooltip carries the shortcut. Defaults to bottom-end so tips never clip inside panel headers. */
export function TipIconButton({ label, keys, side = "bottom-end", ...props }: IconButtonProps & { keys?: string[]; side?: Side }) {
  return (
    <ShortcutTip label={label} keys={keys} side={side}>
      <IconButton label={label} tooltip={false} {...props} />
    </ShortcutTip>
  )
}
