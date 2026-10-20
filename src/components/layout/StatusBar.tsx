import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { Switch } from "@/components/ui"
import { ShortcutTip } from "./ShortcutTip"
import { Terminal } from "lucide-react"
import { cn } from "@/lib/utils"

export function StatusBar() {
  const isConsoleOpen = useLayoutStore((state) => state.isConsoleOpen)
  const toggleConsole = useLayoutStore((state) => state.toggleConsole)

  const lastCompileError = useProjectStore((state) => state.lastCompileError)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const activeEditorTab = useProjectStore((state) => state.activeEditorTab)
  const autoCompile = useProjectStore((state) => state.autoCompile)
  const setAutoCompile = useProjectStore((state) => state.setAutoCompile)

  const bridgeConnected = useFileSystemStore((state) => state.bridgeConnected)

  const diagnostics = parseDiagnosticErrors(lastCompileError)
  const warnings = diagnostics.filter((d) => d.message.toLowerCase().includes("warning"))
  const errors = diagnostics.filter((d) => !d.message.toLowerCase().includes("warning"))
  const errorCount = errors.length > 0 ? errors.length : lastCompileError && warnings.length === 0 ? 1 : 0
  const warningCount = warnings.length

  const language = activeBackend === "webgpu" ? "WGSL" : "GLSL"
  const editorTabLabel =
    activeEditorTab === "compute" ? "Compute" : activeEditorTab === "vertex" ? "Vertex" : activeBackend === "webgpu" ? "Render (vertex + fragment)" : "Fragment"

  return (
    <footer data-testid="status-bar" className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-2 text-xs text-fg-muted select-none">
      <div className="flex items-center gap-3">
        <ShortcutTip label={isConsoleOpen ? "Hide console" : "Show console"} keys={["Ctrl", "J"]} side="top">
          <button
            type="button"
            onClick={toggleConsole}
            aria-label="Toggle console"
            aria-expanded={isConsoleOpen}
            className={cn("flex h-5 items-center gap-1.5 rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-fg", isConsoleOpen && "bg-active text-fg")}
          >
            <Terminal aria-hidden className="size-3.5" />
            <span data-testid="status-error-count" className={cn(errorCount > 0 ? "text-danger" : "text-fg-muted")}>
              <span className="num">{errorCount}</span> {errorCount === 1 ? "error" : "errors"}
            </span>
            <span>
              <span className="num">{warningCount}</span> {warningCount === 1 ? "warning" : "warnings"}
            </span>
          </button>
        </ShortcutTip>

        <label className="flex cursor-pointer items-center gap-1.5">
          <Switch checked={autoCompile} onCheckedChange={setAutoCompile} className="scale-90" />
          <span>Auto-compile</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <span>
          {language} <span className="text-fg-subtle">/ {editorTabLabel}</span>
        </span>
        <span className="flex items-center gap-1.5" title={bridgeConnected ? "Bridge server connected" : "Bridge server offline"}>
          <span aria-hidden className={cn("size-1.5 rounded-full", bridgeConnected ? "bg-success" : "bg-fg-disabled")} />
          {bridgeConnected ? "Bridge connected" : "Bridge offline"}
        </span>
      </div>
    </footer>
  )
}
