import { useState, useRef, useEffect } from "react"
import { useLayoutStore, type ActivityTab } from "@/stores/layoutStore"
import { Button } from "@/components/ui"
import { ShortcutTip } from "./ShortcutTip"
import { Network, FolderTree, LayoutTemplate, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface TabItem {
  id: ActivityTab
  label: string
  icon: typeof Network
}

/** One surface per job: graph, project files, templates, copilot. */
export const ACTIVITY_TABS: TabItem[] = [
  { id: "graph", label: "Graph", icon: Network },
  { id: "project", label: "Project", icon: FolderTree },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "copilot", label: "Copilot", icon: Sparkles },
]

export function ActivityBar() {
  const activeTab = useLayoutStore((state) => state.activeActivityTab)
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const toggleActivityTab = useLayoutStore((state) => state.toggleActivityTab)

  const [focusedIndex, setFocusedIndex] = useState<number>(() => {
    const idx = ACTIVITY_TABS.findIndex((t) => t.id === activeTab)
    return idx >= 0 ? idx : 0
  })
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Keep the roving tabindex in sync with the active tab
  useEffect(() => {
    if (activeTab) {
      const idx = ACTIVITY_TABS.findIndex((t) => t.id === activeTab)
      if (idx >= 0) setFocusedIndex(idx)
    }
  }, [activeTab])

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = ACTIVITY_TABS.length - 1
    const next = e.key === "ArrowDown" ? (index + 1) % ACTIVITY_TABS.length : e.key === "ArrowUp" ? (index - 1 + ACTIVITY_TABS.length) % ACTIVITY_TABS.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1
    if (next < 0) return
    e.preventDefault()
    setFocusedIndex(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <nav
      data-testid="activity-bar"
      aria-label="Activity bar"
      className="relative z-20 flex w-12 shrink-0 flex-col items-center border-r border-line bg-panel py-2 select-none"
    >
      <div role="tablist" aria-orientation="vertical" aria-label="Sidebar views" className="flex flex-col items-center gap-1">
        {ACTIVITY_TABS.map(({ id, label, icon: Icon }, index) => {
          const isActive = isLeftSidebarOpen && activeTab === id
          return (
            <ShortcutTip key={id} label={label} side="right">
              <Button
                ref={(el) => {
                  tabRefs.current[index] = el
                }}
                role="tab"
                variant="ghost"
                size="icon"
                id={`activity-tab-${id}`}
                aria-controls="left-sidebar-dock"
                aria-selected={isActive}
                aria-label={label}
                tabIndex={focusedIndex === index ? 0 : -1}
                data-active={isActive ? "true" : "false"}
                onClick={() => {
                  setFocusedIndex(index)
                  toggleActivityTab(id)
                }}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onFocus={() => setFocusedIndex(index)}
                className={cn("relative", isActive && "bg-brand-soft text-brand-text hover:bg-brand-soft hover:text-brand-text")}
              >
                {isActive && <span aria-hidden className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-r bg-brand" />}
                <Icon />
              </Button>
            </ShortcutTip>
          )
        })}
      </div>
    </nav>
  )
}
