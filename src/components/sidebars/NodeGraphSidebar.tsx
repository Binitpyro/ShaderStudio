import { NodeGraph } from "@/components/NodeGraph"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { useProjectStore } from "@/stores/projectStore"
import { SidebarFrame } from "./SidebarFrame"

export function NodeGraphSidebar() {
  return (
    <SidebarFrame title="Graph" scroll={false}>
      <ErrorBoundary
        fallbackTitle="Node graph error"
        fallbackMessage="Failed to render visual node graph canvas."
        onReset={() => {
          useProjectStore.getState().setLastCompileError(null)
        }}
      >
        <NodeGraph className="h-full w-full" />
      </ErrorBoundary>
    </SidebarFrame>
  )
}
