import { useLayoutStore } from "@/stores/layoutStore"
import { ParameterPanel } from "@/components/ParameterPanel"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { SlidersHorizontal, PanelRightClose } from "lucide-react"

export function RightInspector() {
  const toggleRightInspector = useLayoutStore((state) => state.toggleRightInspector)

  return (
    <div
      data-testid="right-inspector"
      className="flex h-full w-full min-w-[240px] flex-col overflow-hidden bg-card border-l border-border select-none"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            Inspector
          </span>
        </div>
        <button
          type="button"
          onClick={toggleRightInspector}
          title="Collapse Inspector"
          aria-label="Collapse Inspector"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ErrorBoundary fallbackTitle="Parameter Panel Error">
          <ParameterPanel />
        </ErrorBoundary>
      </div>
    </div>
  )
}
