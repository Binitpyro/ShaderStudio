import { useState, useRef, useEffect } from "react"
import { useLayoutStore, type ActivityTab } from "@/stores/layoutStore"
import { useTheme } from "@/components/theme-provider"
import {
  Network,
  FolderTree,
  Palette,
  Sparkles,
  Sun,
  Moon,
  SlidersHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface TabItem {
  id: ActivityTab
  label: string
  icon: typeof Network
}

const TABS: TabItem[] = [
  { id: "graph", label: "Node Graph", icon: Network },
  { id: "project", label: "Project Explorer", icon: FolderTree },
  { id: "templates", label: "Shaders & Templates", icon: Palette },
  { id: "copilot", label: "AI Copilot", icon: Sparkles },
]

export function ActivityBar() {
  const activeTab = useLayoutStore((state) => state.activeActivityTab)
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const toggleActivityTab = useLayoutStore((state) => state.toggleActivityTab)

  const isRightInspectorOpen = useLayoutStore((state) => state.isRightInspectorOpen)
  const toggleRightInspector = useLayoutStore((state) => state.toggleRightInspector)

  const { theme, setTheme, resolvedTheme } = useTheme()

  const [focusedIndex, setFocusedIndex] = useState<number>(() => {
    const idx = TABS.findIndex((t) => t.id === activeTab)
    return idx >= 0 ? idx : 0
  })
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Keep focusedIndex in sync with activeTab changes
  useEffect(() => {
    if (activeTab) {
      const idx = TABS.findIndex((t) => t.id === activeTab)
      if (idx >= 0) setFocusedIndex(idx)
    }
  }, [activeTab])

  const handleToggleTheme = () => {
    const current = resolvedTheme || theme || "dark"
    setTheme(current === "dark" ? "light" : "dark")
  }

  const isDark = (resolvedTheme || theme || "dark") === "dark"

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index
    if (e.key === "ArrowDown") {
      e.preventDefault()
      nextIndex = (index + 1) % TABS.length
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      nextIndex = (index - 1 + TABS.length) % TABS.length
    } else if (e.key === "Home") {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === "End") {
      e.preventDefault()
      nextIndex = TABS.length - 1
    } else {
      return
    }

    setFocusedIndex(nextIndex)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <nav
      data-testid="activity-bar"
      aria-label="Activity Bar"
      className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-card/95 py-2.5 z-20 select-none"
    >
      {/* Top tabs */}
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Activity Views"
        className="flex flex-col items-center gap-1.5 w-full"
      >
        {TABS.map(({ id, label, icon: Icon }, index) => {
          const isActive = isLeftSidebarOpen && activeTab === id
          const isFocused = focusedIndex === index
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={`activity-tab-${id}`}
              aria-controls="left-sidebar-dock"
              aria-selected={isActive}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => {
                setFocusedIndex(index)
                toggleActivityTab(id)
              }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onFocus={() => setFocusedIndex(index)}
              title={label}
              aria-label={label}
              data-active={isActive ? "true" : "false"}
              className={cn(
                "group relative flex h-10 w-10 items-center justify-center rounded-md text-xs transition-colors cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
              )}
              <Icon className="h-5 w-5 transition-transform group-hover:scale-105" />
            </button>
          )
        })}
      </div>

      {/* Bottom triggers: Theme & Inspector */}
      <div className="flex flex-col items-center gap-1.5 w-full pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={handleToggleTheme}
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label="Toggle Theme"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={toggleRightInspector}
          title={isRightInspectorOpen ? "Collapse Inspector" : "Expand Inspector"}
          aria-label="Toggle Inspector"
          aria-expanded={isRightInspectorOpen}
          aria-controls="right-inspector"
          data-active={isRightInspectorOpen ? "true" : "false"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            isRightInspectorOpen
              ? "text-primary bg-primary/10"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
    </nav>
  )
}
