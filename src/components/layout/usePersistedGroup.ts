import { useCallback, useState } from "react"
import type { Layout, LayoutChangedMeta } from "react-resizable-panels"
import { useLayoutStore } from "@/stores/layoutStore"

/**
 * Props for a resizable Group whose sizes persist per user: read once at mount, saved after user drags only.
 * `onUserLayout` lets a group reconcile store flags when the user drags a panel shut or open.
 */
export function usePersistedGroup(id: string, onUserLayout?: (layout: Layout) => void) {
  const [defaultLayout] = useState<Layout | undefined>(() => useLayoutStore.getState().panelLayouts[id])
  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return
      useLayoutStore.getState().setPanelLayout(id, layout)
      onUserLayout?.(layout)
    },
    [id, onUserLayout],
  )
  return { id, defaultLayout, onLayoutChanged }
}

/** Shared separator look: 1px hairline, brand colour while hovered, focused or dragged. */
export const SEPARATOR_H = "w-px shrink-0 bg-line transition-colors data-[separator=hover]:bg-brand data-[separator=active]:bg-brand data-[separator=focus]:bg-brand"
export const SEPARATOR_V = "h-px shrink-0 bg-line transition-colors data-[separator=hover]:bg-brand data-[separator=active]:bg-brand data-[separator=focus]:bg-brand"
