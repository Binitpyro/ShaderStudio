import { ProjectPanel } from "@/components/ProjectPanel"
import { FileImporter } from "@/components/FileImporter"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { useLayoutStore } from "@/stores/layoutStore"
import { FolderTree, PanelLeftClose } from "lucide-react"

export function ProjectSidebar() {
  const setLeftSidebarOpen = useLayoutStore((state) => state.setLeftSidebarOpen)

  return (
    <div className="flex h-full min-w-[240px] flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            Project Explorer
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
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <ErrorBoundary fallbackTitle="Project Panel Error">
          <ProjectPanel />
        </ErrorBoundary>
        <div className="pt-2 border-t border-border">
          <ErrorBoundary fallbackTitle="File Importer Error">
            <FileImporter />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
