import { useLayoutStore } from "@/stores/layoutStore"
import { ParameterPanel } from "@/components/ParameterPanel"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { Panel, PanelHeader } from "@/components/ui"
import { PanelRightClose } from "lucide-react"
import { TipIconButton } from "./ShortcutTip"

/** Hosts the inspector. Stays mounted when collapsed (inert) so parameter state and scroll survive Ctrl+I. */
export function RightInspector() {
  const isOpen = useLayoutStore((state) => state.isRightInspectorOpen)
  const toggleRightInspector = useLayoutStore((state) => state.toggleRightInspector)

  return (
    <aside
      data-testid="right-inspector"
      aria-label="Inspector"
      aria-hidden={isOpen ? undefined : true}
      inert={!isOpen}
      className="h-full w-full overflow-hidden"
    >
      <Panel className="h-full overflow-hidden">
        <PanelHeader
          title="Inspector"
          actions={
            <TipIconButton label="Collapse inspector" keys={["Ctrl", "I"]} onClick={toggleRightInspector}>
              <PanelRightClose />
            </TipIconButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ErrorBoundary fallbackTitle="Parameter panel error">
            <ParameterPanel />
          </ErrorBoundary>
        </div>
      </Panel>
    </aside>
  )
}
