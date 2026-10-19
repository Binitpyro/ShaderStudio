import { lazy, Suspense } from "react"
import { useLayoutStore } from "@/stores/layoutStore"
import { NodeGraphSidebar } from "@/components/sidebars/NodeGraphSidebar"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

const ProjectSidebar = lazy(() =>
  import("@/components/sidebars/ProjectSidebar").then((m) => ({ default: m.ProjectSidebar }))
)
const TemplatesSidebar = lazy(() =>
  import("@/components/sidebars/TemplatesSidebar").then((m) => ({ default: m.TemplatesSidebar }))
)
const AICopilotSidebar = lazy(() =>
  import("@/components/sidebars/AICopilotSidebar").then((m) => ({ default: m.AICopilotSidebar }))
)

export function SidebarDock() {
  const activeTab = useLayoutStore((state) => state.activeActivityTab)

  if (!activeTab) return null

  return (
    <aside
      id="left-sidebar-dock"
      role="region"
      aria-label="Primary Sidebar"
      data-testid="left-sidebar-dock"
      className="h-full w-full min-w-[240px] overflow-hidden bg-card border-r border-border"
    >
      <ErrorBoundary
        fallbackTitle="Sidebar Dock Error"
        fallbackMessage="The active sidebar view failed to load."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
              Loading sidebar...
            </div>
          }
        >
          {activeTab === "graph" && <NodeGraphSidebar />}
          {activeTab === "project" && <ProjectSidebar />}
          {activeTab === "templates" && <TemplatesSidebar />}
          {activeTab === "copilot" && <AICopilotSidebar />}
        </Suspense>
      </ErrorBoundary>
    </aside>
  )
}
