import { lazy, Suspense, useRef } from "react"
import { useLayoutStore, type ActivityTab } from "@/stores/layoutStore"
import { NodeGraphSidebar } from "@/components/sidebars/NodeGraphSidebar"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

const ProjectSidebar = lazy(() => import("@/components/sidebars/ProjectSidebar").then((m) => ({ default: m.ProjectSidebar })))
const TemplatesSidebar = lazy(() => import("@/components/sidebars/TemplatesSidebar").then((m) => ({ default: m.TemplatesSidebar })))
const AICopilotSidebar = lazy(() => import("@/components/sidebars/AICopilotSidebar").then((m) => ({ default: m.AICopilotSidebar })))

/**
 * Hosts the active sidebar tab. When the sidebar collapses the last tab stays mounted (inert, zero width) so the
 * node graph keeps its viewport, selection and zoom across Ctrl+B.
 */
export function SidebarDock() {
  const activeTab = useLayoutStore((state) => state.activeActivityTab)
  const lastTab = useRef<ActivityTab | null>(null)
  if (activeTab) lastTab.current = activeTab
  const tab = activeTab ?? lastTab.current

  if (!tab) return null

  return (
    <aside
      id="left-sidebar-dock"
      aria-label="Sidebar"
      aria-hidden={activeTab ? undefined : true}
      inert={!activeTab}
      data-testid="left-sidebar-dock"
      className="h-full w-full overflow-hidden bg-panel"
    >
      <ErrorBoundary fallbackTitle="Sidebar error" fallbackMessage="The active sidebar view failed to load.">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-fg-subtle">Loading...</div>}>
          {tab === "graph" && <NodeGraphSidebar />}
          {tab === "project" && <ProjectSidebar />}
          {tab === "templates" && <TemplatesSidebar />}
          {tab === "copilot" && <AICopilotSidebar />}
        </Suspense>
      </ErrorBoundary>
    </aside>
  )
}
