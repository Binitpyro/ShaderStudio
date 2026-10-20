import type { ReactNode } from "react"
import { PanelLeftClose } from "lucide-react"
import { Panel, PanelHeader } from "@/components/ui"
import { TipIconButton } from "@/components/layout/ShortcutTip"
import { useLayoutStore } from "@/stores/layoutStore"
import { cn } from "@/lib/utils"

/** Shared sidebar chrome: sentence-case title row, optional actions, one close button, scrolling (or fixed) body. */
export function SidebarFrame({ title, actions, scroll = true, className, children }: { title: string; actions?: ReactNode; scroll?: boolean; className?: string; children: ReactNode }) {
  const setLeftSidebarOpen = useLayoutStore((s) => s.setLeftSidebarOpen)
  return (
    <Panel className="h-full min-w-0 overflow-hidden">
      <PanelHeader
        title={title}
        actions={
          <>
            {actions}
            <TipIconButton label="Close sidebar" keys={["Ctrl", "B"]} onClick={() => setLeftSidebarOpen(false)}>
              <PanelLeftClose />
            </TipIconButton>
          </>
        }
      />
      <div className={cn("min-h-0 flex-1", scroll ? "overflow-y-auto" : "overflow-hidden", className)}>{children}</div>
    </Panel>
  )
}
