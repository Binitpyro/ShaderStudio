import { useCallback, useLayoutEffect } from "react"
import { Group, Panel, Separator, usePanelRef, type Layout } from "react-resizable-panels"
import { useLayoutStore } from "@/stores/layoutStore"
import { ActivityBar } from "./ActivityBar"
import { SidebarDock } from "./SidebarDock"
import { CenterStage } from "./CenterStage"
import { RightInspector } from "./RightInspector"
import { ConsoleDrawer } from "./ConsoleDrawer"
import { StatusBar } from "./StatusBar"
import { SEPARATOR_H, SEPARATOR_V, usePersistedGroup } from "./usePersistedGroup"
import { cn } from "@/lib/utils"

/** Collapse/expand a Panel from a store flag. Layout effect so a persisted-closed panel never paints open. */
function useCollapseSync(ref: ReturnType<typeof usePanelRef>, open: boolean) {
  useLayoutEffect(() => {
    const p = ref.current
    if (!p) return
    if (open && p.isCollapsed()) p.expand()
    else if (!open && !p.isCollapsed()) p.collapse()
  }, [open, ref])
}

/**
 * Shell: activity bar | sidebar | (stage over console) | inspector, then status bar.
 * Every panel is always mounted; open/closed is a Panel collapse (plus `inert`), so toggling a panel can never
 * remount Viewport or Monaco.
 */
export function WorkspaceLayout() {
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const isRightInspectorOpen = useLayoutStore((state) => state.isRightInspectorOpen)
  const isConsoleOpen = useLayoutStore((state) => state.isConsoleOpen)

  const sidebarRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const consoleRef = usePanelRef()
  useCollapseSync(sidebarRef, isLeftSidebarOpen)
  useCollapseSync(inspectorRef, isRightInspectorOpen)
  useCollapseSync(consoleRef, isConsoleOpen)

  // The user dragged a panel shut (size 0) or back open: mirror it into the store so buttons and shortcuts agree.
  const onHorizontalUser = useCallback((layout: Layout) => {
    const st = useLayoutStore.getState()
    if ("left-sidebar" in layout && (layout["left-sidebar"] > 0) !== st.isLeftSidebarOpen) st.setLeftSidebarOpen(layout["left-sidebar"] > 0)
    if ("inspector-panel" in layout && (layout["inspector-panel"] > 0) !== st.isRightInspectorOpen) st.setRightInspectorOpen(layout["inspector-panel"] > 0)
  }, [])
  const onVerticalUser = useCallback((layout: Layout) => {
    const st = useLayoutStore.getState()
    if ("console-drawer-panel" in layout && (layout["console-drawer-panel"] > 0) !== st.isConsoleOpen) st.setConsoleOpen(layout["console-drawer-panel"] > 0)
  }, [])
  const horizontal = usePersistedGroup("shell-horizontal", onHorizontalUser)
  const vertical = usePersistedGroup("shell-vertical", onVerticalUser)

  return (
    <div data-testid="workspace-layout" className="flex h-full w-full overflow-hidden bg-canvas">
      <ActivityBar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Group {...horizontal} orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
          <Panel id="left-sidebar" defaultSize={isLeftSidebarOpen ? "22%" : "0%"} minSize="240px" maxSize="45%" collapsible collapsedSize={0} panelRef={sidebarRef} className="overflow-hidden">
            <SidebarDock />
          </Panel>
          <Separator className={cn(SEPARATOR_H, !isLeftSidebarOpen && "hidden")} />

          <Panel id="center-column" minSize="30%" className="overflow-hidden">
            <Group {...vertical} orientation="vertical" className="h-full w-full">
              <Panel id="center-stage-panel" defaultSize={isConsoleOpen ? "75%" : "100%"} minSize="30%" className="overflow-hidden">
                <CenterStage />
              </Panel>
              <Separator className={cn(SEPARATOR_V, !isConsoleOpen && "hidden")} />
              <Panel id="console-drawer-panel" defaultSize={isConsoleOpen ? "25%" : "0%"} minSize="15%" maxSize="60%" collapsible collapsedSize={0} panelRef={consoleRef} className="overflow-hidden">
                <div aria-hidden={isConsoleOpen ? undefined : true} inert={!isConsoleOpen} className="h-full w-full">
                  <ConsoleDrawer />
                </div>
              </Panel>
            </Group>
          </Panel>

          <Separator className={cn(SEPARATOR_H, !isRightInspectorOpen && "hidden")} />
          <Panel id="inspector-panel" defaultSize={isRightInspectorOpen ? "20%" : "0%"} minSize="240px" maxSize="40%" collapsible collapsedSize={0} panelRef={inspectorRef} className="overflow-hidden">
            <RightInspector />
          </Panel>
        </Group>

        <StatusBar />
      </div>
    </div>
  )
}
