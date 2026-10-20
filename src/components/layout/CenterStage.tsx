import { useEffect } from "react"
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { Viewport } from "@/components/Viewport"
import { ShaderEditor } from "@/components/ShaderEditor"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { PanelHeader } from "@/components/ui"
import { TipIconButton } from "./ShortcutTip"
import { Maximize2, Minimize2, Columns2, Rows2 } from "lucide-react"
import { SEPARATOR_H, SEPARATOR_V, usePersistedGroup } from "./usePersistedGroup"
import { cn } from "@/lib/utils"

/**
 * Viewport over editor. Both panes are ALWAYS mounted: maximizing collapses the other Panel through the
 * resizable-panels API (and marks it inert), so Viewport and Monaco are never remounted by any layout change.
 */
export function CenterStage() {
  const splitOrientation = useLayoutStore((state) => state.splitOrientation)
  const toggleSplitOrientation = useLayoutStore((state) => state.toggleSplitOrientation)
  const maximizedPanel = useLayoutStore((state) => state.maximizedPanel)
  const toggleMaximizeViewport = useLayoutStore((state) => state.toggleMaximizeViewport)
  const toggleMaximizeEditor = useLayoutStore((state) => state.toggleMaximizeEditor)
  const group = usePersistedGroup("center-split")

  const viewportRef = usePanelRef()
  const editorRef = usePanelRef()

  // Drive collapse from the store (both directions are idempotent).
  useEffect(() => {
    const sync = (panel: ReturnType<typeof usePanelRef>["current"], visible: boolean) => {
      if (!panel) return
      if (visible && panel.isCollapsed()) panel.expand()
      else if (!visible && !panel.isCollapsed()) panel.collapse()
    }
    sync(viewportRef.current, maximizedPanel !== "editor")
    sync(editorRef.current, maximizedPanel !== "viewport")
  }, [maximizedPanel, viewportRef, editorRef])

  // Dragging a pane shut by hand == maximizing the other one.
  const onPaneResize = (self: "viewport" | "editor") => (size: { inPixels: number }) => {
    const other = (self === "viewport" ? editorRef : viewportRef).current
    if (size.inPixels > 0 || !other || other.getSize().inPixels <= 0) return
    const st = useLayoutStore.getState()
    const target = self === "viewport" ? "editor" : "viewport"
    if (st.maximizedPanel !== target) st.setMaximizedPanel(target)
  }

  const isVertical = splitOrientation === "vertical"
  const maximized = maximizedPanel !== "none"

  return (
    <div data-testid="center-stage" data-maximized={maximizedPanel} className="h-full w-full overflow-hidden bg-canvas">
      <Group {...group} orientation={splitOrientation} className="h-full w-full">
        <Panel id="stage-viewport" defaultSize="55%" minSize="15%" collapsible collapsedSize={0} panelRef={viewportRef} onResize={onPaneResize("viewport")} className="overflow-hidden">
          <section aria-label="Viewport" inert={maximizedPanel === "editor"} className="flex h-full flex-col overflow-hidden">
            <PanelHeader
              title="Viewport"
              className="bg-panel"
              actions={
                <>
                  {!maximized && (
                    <TipIconButton label={isVertical ? "Split horizontally" : "Split vertically"} onClick={toggleSplitOrientation}>
                      {isVertical ? <Columns2 /> : <Rows2 />}
                    </TipIconButton>
                  )}
                  <TipIconButton label={maximizedPanel === "viewport" ? "Restore layout" : "Maximize viewport"} aria-pressed={maximizedPanel === "viewport"} onClick={toggleMaximizeViewport}>
                    {maximizedPanel === "viewport" ? <Minimize2 /> : <Maximize2 />}
                  </TipIconButton>
                </>
              }
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ErrorBoundary
                fallbackTitle="Viewport error"
                fallbackMessage="Failed to initialize or render 3D graphics viewport."
                onReset={() => {
                  useProjectStore.getState().setDeviceLost(false)
                  useProjectStore.getState().triggerRecompile()
                }}
              >
                <Viewport className="h-full w-full" />
              </ErrorBoundary>
            </div>
          </section>
        </Panel>

        <Separator className={cn(isVertical ? SEPARATOR_V : SEPARATOR_H, maximized && "hidden")} />

        <Panel id="stage-editor" defaultSize="45%" minSize="15%" collapsible collapsedSize={0} panelRef={editorRef} onResize={onPaneResize("editor")} className="overflow-hidden">
          <section aria-label="Shader editor" inert={maximizedPanel === "viewport"} className="flex h-full flex-col overflow-hidden">
            <PanelHeader
              title="Shader editor"
              className="bg-panel"
              actions={
                <TipIconButton label={maximizedPanel === "editor" ? "Restore layout" : "Maximize editor"} aria-pressed={maximizedPanel === "editor"} onClick={toggleMaximizeEditor}>
                  {maximizedPanel === "editor" ? <Minimize2 /> : <Maximize2 />}
                </TipIconButton>
              }
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ErrorBoundary
                fallbackTitle="Shader editor error"
                fallbackMessage="Monaco editor encountered a fatal exception."
                onReset={() => {
                  useProjectStore.getState().setLastCompileError(null)
                }}
              >
                <ShaderEditor />
              </ErrorBoundary>
            </div>
          </section>
        </Panel>
      </Group>
    </div>
  )
}
