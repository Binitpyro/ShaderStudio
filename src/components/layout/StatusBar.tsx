import { useState, useEffect } from "react"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { Terminal, Activity, Radio } from "lucide-react"
import { cn } from "@/lib/utils"

export function StatusBar() {
  const isConsoleOpen = useLayoutStore((state) => state.isConsoleOpen)
  const toggleConsole = useLayoutStore((state) => state.toggleConsole)
  const activeActivityTab = useLayoutStore((state) => state.activeActivityTab)

  const lastCompileError = useProjectStore((state) => state.lastCompileError)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const activeEditorTab = useProjectStore((state) => state.activeEditorTab)

  const bridgeConnected = useFileSystemStore((state) => state.bridgeConnected)

  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)

  useEffect(() => {
    const unsubscribe = renderCoordinator.onMetrics((latest) => {
      setMetrics(latest)
    })
    return unsubscribe
  }, [])

  const diagnostics = parseDiagnosticErrors(lastCompileError)
  const warnings = diagnostics.filter((d) => d.message.toLowerCase().includes("warning"))
  const errors = diagnostics.filter((d) => !d.message.toLowerCase().includes("warning"))
  const errorCount = errors.length > 0 ? errors.length : (lastCompileError && warnings.length === 0 ? 1 : 0)
  const warningCount = warnings.length

  const language = activeBackend === "webgpu" ? "WGSL" : "GLSL"
  const editorTabLabel =
    activeEditorTab === "compute"
      ? "Compute"
      : activeEditorTab === "vertex"
      ? "Vertex"
      : activeBackend === "webgpu"
      ? "Render (Vertex+Frag)"
      : "Fragment"

  const tabNames: Record<string, string> = {
    graph: "Node Graph",
    project: "Project Explorer",
    templates: "Templates",
    copilot: "AI Copilot",
  }
  const currentTabLabel = activeActivityTab ? tabNames[activeActivityTab] ?? activeActivityTab : "Workspace"

  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-card/90 px-3 text-[11px] text-muted-foreground select-none z-10"
    >
      {/* Left: Console toggle & Error/Warn Badges & Active Tab */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleConsole}
          title={isConsoleOpen ? "Collapse Console" : "Expand Console"}
          aria-label="Toggle Console Drawer"
          className={cn(
            "flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors cursor-pointer hover:bg-accent hover:text-foreground",
            isConsoleOpen && "bg-accent/80 text-foreground"
          )}
        >
          <Terminal className="h-3 w-3 text-primary" />
          {errorCount > 0 ? (
            <span
              data-testid="status-error-count"
              className="rounded bg-destructive/15 px-1 text-[10px] font-mono font-semibold text-destructive"
            >
              {errorCount} {errorCount === 1 ? "Error" : "Errors"}
            </span>
          ) : (
            <span
              data-testid="status-error-count"
              className="rounded bg-emerald-500/15 px-1 text-[10px] font-mono text-emerald-500 font-medium"
            >
              0 Errors
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">{warningCount} Warn</span>
        </button>

        <span className="text-border">|</span>

        <div className="flex items-center gap-1 text-muted-foreground">
          <Activity className="h-3 w-3" />
          <span>{currentTabLabel}</span>
        </div>
      </div>

      {/* Center: Language & Editor Tab */}
      <div className="flex items-center gap-2 font-mono text-[10px]">
        <span className="rounded bg-muted px-1.5 py-0.2 text-foreground font-semibold uppercase">
          {language}
        </span>
        <span className="text-muted-foreground/80">{editorTabLabel}</span>
      </div>

      {/* Right: Bridge Status & Backend & Telemetry */}
      <div className="flex items-center gap-3 font-mono text-[10px]">
        {/* Bridge Status */}
        <div className="flex items-center gap-1.5">
          <Radio
            className={cn(
              "h-3 w-3",
              bridgeConnected ? "text-green-500 animate-pulse" : "text-amber-500/80"
            )}
          />
          <span className={bridgeConnected ? "text-green-500 font-medium" : "text-muted-foreground"}>
            {bridgeConnected ? "Bridge: Connected" : "Bridge: Offline"}
          </span>
        </div>

        <span className="text-border">|</span>

        {/* Backend */}
        <span className="uppercase text-muted-foreground font-semibold">
          {activeBackend}
        </span>

        <span className="text-border">|</span>

        {/* Telemetry (FPS & Frame Time) */}
        <div data-testid="status-telemetry" className="flex items-center gap-1 text-muted-foreground">
          {metrics ? (
            <>
              <span className="text-foreground font-semibold">{Math.round(metrics.fps)} FPS</span>
              <span>·</span>
              <span>{metrics.frameTimeMs.toFixed(1)}ms</span>
            </>
          ) : (
            <span>60 FPS · 16.6ms</span>
          )}
        </div>
      </div>
    </footer>
  )
}
