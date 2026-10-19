import { useLayoutStore } from "@/stores/layoutStore"
import { Group, Panel, Separator } from "react-resizable-panels"
import { Viewport } from "@/components/Viewport"
import { ShaderEditor } from "@/components/ShaderEditor"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { useProjectStore } from "@/stores/projectStore"
import { Maximize2, Minimize2, Columns, Rows } from "lucide-react"

export function CenterStage() {
  const splitOrientation = useLayoutStore((state) => state.splitOrientation)
  const toggleSplitOrientation = useLayoutStore((state) => state.toggleSplitOrientation)
  const maximizedPanel = useLayoutStore((state) => state.maximizedPanel)
  const toggleMaximizeViewport = useLayoutStore((state) => state.toggleMaximizeViewport)
  const toggleMaximizeEditor = useLayoutStore((state) => state.toggleMaximizeEditor)

  // 1. Maximize Viewport Mode
  if (maximizedPanel === "viewport") {
    return (
      <div data-testid="center-stage-max-viewport" className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 select-none">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            3D Viewport (Maximized)
          </span>
          <button
            type="button"
            onClick={toggleMaximizeViewport}
            title="Restore Split"
            aria-label="Restore Split"
            className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span>Restore</span>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary
            fallbackTitle="Viewport Error"
            fallbackMessage="Failed to initialize or render 3D graphics viewport."
            onReset={() => {
              useProjectStore.getState().setDeviceLost(false)
              useProjectStore.getState().triggerRecompile()
            }}
          >
            <Viewport className="h-full w-full" />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  // 2. Maximize Editor Mode
  if (maximizedPanel === "editor") {
    return (
      <div data-testid="center-stage-max-editor" className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 select-none">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Shader Editor (Maximized)
          </span>
          <button
            type="button"
            onClick={toggleMaximizeEditor}
            title="Restore Split"
            aria-label="Restore Split"
            className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span>Restore</span>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary
            fallbackTitle="Shader Editor Error"
            fallbackMessage="Monaco editor encountered a fatal exception."
            onReset={() => {
              useProjectStore.getState().setLastCompileError(null)
            }}
          >
            <ShaderEditor />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  // 3. Dual-Split Mode (Vertical or Horizontal)
  const isVertical = splitOrientation === "vertical"

  return (
    <div data-testid="center-stage-split" className="h-full w-full overflow-hidden bg-background">
      <Group orientation={splitOrientation} className="h-full w-full">
        {/* Pane 1: 3D Viewport */}
        <Panel defaultSize="55%" minSize="20%" className="overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 select-none">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                3D Viewport
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleSplitOrientation}
                  title={isVertical ? "Split Horizontally" : "Split Vertically"}
                  aria-label="Toggle Split Orientation"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  {isVertical ? <Columns className="h-3.5 w-3.5" /> : <Rows className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={toggleMaximizeViewport}
                  title="Maximize Viewport"
                  aria-label="Maximize Viewport"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary
                fallbackTitle="Viewport Error"
                fallbackMessage="Failed to initialize or render 3D graphics viewport."
                onReset={() => {
                  useProjectStore.getState().setDeviceLost(false)
                  useProjectStore.getState().triggerRecompile()
                }}
              >
                <Viewport className="h-full w-full" />
              </ErrorBoundary>
            </div>
          </div>
        </Panel>

        {/* Resizable Divider Handle */}
        <Separator
          className={
            isVertical
              ? "h-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-row-resize"
              : "w-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-col-resize"
          }
        />

        {/* Pane 2: Monaco Shader Editor */}
        <Panel defaultSize="45%" minSize="20%" className="overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 select-none">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Shader Editor
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMaximizeEditor}
                  title="Maximize Editor"
                  aria-label="Maximize Editor"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary
                fallbackTitle="Shader Editor Error"
                fallbackMessage="Monaco editor encountered a fatal exception."
                onReset={() => {
                  useProjectStore.getState().setLastCompileError(null)
                }}
              >
                <ShaderEditor />
              </ErrorBoundary>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
