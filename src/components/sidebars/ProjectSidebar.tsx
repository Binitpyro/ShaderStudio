import { ProjectPanel } from "@/components/ProjectPanel"
import { FileImporter } from "@/components/FileImporter"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { SidebarFrame } from "./SidebarFrame"

export function ProjectSidebar() {
  return (
    <SidebarFrame title="Project" className="flex flex-col gap-4 p-3">
      <ErrorBoundary fallbackTitle="Project panel error">
        <ProjectPanel />
      </ErrorBoundary>
      <ErrorBoundary fallbackTitle="File importer error">
        <FileImporter />
      </ErrorBoundary>
    </SidebarFrame>
  )
}
