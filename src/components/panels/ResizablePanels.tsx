import { Group, Panel, Separator } from "react-resizable-panels"
import { Viewport } from "@/components/Viewport"
import { ShaderEditor } from "@/components/ShaderEditor"
import { ParameterPanel } from "@/components/ParameterPanel"
import { ErrorPanel } from "@/components/ErrorPanel"
import { NodeGraph } from "@/components/NodeGraph"
import { ProjectPanel } from "@/components/ProjectPanel"
import { FileImporter } from "@/components/FileImporter"

function ResizeHandle({ orientation }: { orientation?: "horizontal" | "vertical" }) {
  const isVertical = orientation === "vertical"
  return <Separator className={isVertical ? "h-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-row-resize" : "w-1.5 bg-border hover:bg-primary transition-colors duration-150 cursor-col-resize"} />
}

export function ResizablePanels() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Group orientation="horizontal" className="flex-1 overflow-hidden">
        <Panel defaultSize={20} minSize={10} maxSize={35}>
          <div className="flex h-full flex-col overflow-hidden bg-card">
            <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Node Graph</span>
            </div>
            <div className="flex-1 overflow-hidden">
              <NodeGraph className="h-full w-full" />
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        <Panel minSize={30}>
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize={60} minSize={20}>
              <div className="h-full bg-background">
                <Viewport className="h-full w-full" />
              </div>
            </Panel>

            <ResizeHandle orientation="vertical" />

            <Panel defaultSize={40} minSize={10}>
              <ShaderEditor />
            </Panel>
          </Group>
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={18} minSize={8} maxSize={35}>
          <div className="flex h-full flex-col overflow-hidden">
            <ParameterPanel />
            <Separator />
            <div className="shrink-0 p-2 border-t border-border">
              <FileImporter />
              <div className="mt-2">
                <ProjectPanel />
              </div>
            </div>
          </div>
        </Panel>
      </Group>

      <div className="h-28 shrink-0 overflow-hidden">
        <ErrorPanel />
      </div>
    </div>
  )
}
