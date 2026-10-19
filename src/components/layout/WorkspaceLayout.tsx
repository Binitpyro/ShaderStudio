import { useLayoutStore } from "@/stores/layoutStore"
import { Group, Panel, Separator } from "react-resizable-panels"
import { ActivityBar } from "./ActivityBar"
import { SidebarDock } from "./SidebarDock"
import { CenterStage } from "./CenterStage"
import { RightInspector } from "./RightInspector"
import { ConsoleDrawer } from "./ConsoleDrawer"
import { StatusBar } from "./StatusBar"

export function WorkspaceLayout() {
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const isRightInspectorOpen = useLayoutStore((state) => state.isRightInspectorOpen)
  const isConsoleOpen = useLayoutStore((state) => state.isConsoleOpen)

  return (
    <div
      data-testid="workspace-layout"
      className="flex h-full w-full overflow-hidden bg-background relative"
    >
      {/* 48px Left Activity Rail */}
      <ActivityBar />

      {/* Main Resizable Panel Workspace */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Group orientation="horizontal" className="flex-1 overflow-hidden">
          {/* 1. Sliding Left Sidebar Dock */}
          {isLeftSidebarOpen && (
            <>
              <Panel
                id="left-sidebar"
                defaultSize="22%"
                minSize="240px"
                maxSize="45%"
                className="overflow-hidden min-w-[240px]"
              >
                <SidebarDock />
              </Panel>
              <Separator className="w-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-col-resize" />
            </>
          )}

          {/* 2. Center Column (CenterStage + Collapsible ConsoleDrawer) */}
          <Panel id="center-column" minSize="30%" className="overflow-hidden">
            {isConsoleOpen ? (
              <Group orientation="vertical" className="h-full w-full">
                <Panel
                  id="center-stage-panel"
                  defaultSize="75%"
                  minSize="30%"
                  className="overflow-hidden"
                >
                  <CenterStage />
                </Panel>
                <Separator className="h-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-row-resize" />
                <Panel
                  id="console-drawer-panel"
                  defaultSize="25%"
                  minSize="15%"
                  maxSize="60%"
                  className="overflow-hidden"
                >
                  <ConsoleDrawer />
                </Panel>
              </Group>
            ) : (
              <CenterStage />
            )}
          </Panel>

          {/* 3. Collapsible Right Inspector */}
          {isRightInspectorOpen && (
            <>
              <Separator className="w-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-col-resize" />
              <Panel
                id="right-inspector"
                defaultSize="20%"
                minSize="240px"
                maxSize="40%"
                className="overflow-hidden min-w-[240px]"
              >
                <RightInspector />
              </Panel>
            </>
          )}
        </Group>

        {/* 4. Persistent Status Bar Footer */}
        <StatusBar />
      </div>
    </div>
  )
}
