import { NodeGraph } from "@/components/NodeGraph"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { Network, PanelLeftClose } from "lucide-react"

export function NodeGraphSidebar() {
  const setLeftSidebarOpen = useLayoutStore((state) => state.setLeftSidebarOpen)

  return (
    <div className="flex h-full min-w-[240px] flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            Node Graph
          </span>
        </div>
        <button
          type="button"
          onClick={() => setLeftSidebarOpen(false)}
          title="Close Sidebar (Ctrl+B)"
          aria-label="Close Sidebar"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ErrorBoundary
          fallbackTitle="Node Graph Error"
          fallbackMessage="Failed to render visual node graph canvas."
          onReset={() => {
            useProjectStore.getState().setLastCompileError(null)
          }}
        >
          <NodeGraph className="h-full w-full" />
        </ErrorBoundary>
      </div>
    </div>
  )
}
