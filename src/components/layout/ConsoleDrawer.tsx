import { useProjectStore, type EditorTab } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { Button } from "@/components/ui/button"
import { Terminal, Trash2, X, AlertCircle, AlertTriangle, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

function detectTabFromError(
  message: string,
  currentTab: EditorTab,
  backend: "webgpu" | "webgl2" | "threejs"
): EditorTab {
  const lower = message.toLowerCase()
  if (lower.includes("vertex shader") || lower.includes("vertex")) return "vertex"
  if (lower.includes("compute shader") || lower.includes("compute")) return "compute"
  if (lower.includes("fragment shader") || lower.includes("fragment")) {
    return backend === "webgpu" ? "render" : "fragment"
  }
  return currentTab
}

export function ConsoleDrawer() {
  const lastCompileError = useProjectStore((state) => state.lastCompileError)
  const setLastCompileError = useProjectStore((state) => state.setLastCompileError)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const activeEditorTab = useProjectStore((state) => state.activeEditorTab)
  const setActiveEditorTab = useProjectStore((state) => state.setActiveEditorTab)

  const setConsoleOpen = useLayoutStore((state) => state.setConsoleOpen)
  const jumpToLine = useLayoutStore((state) => state.jumpToLine)

  const rawLines = (lastCompileError || "").split("\n").map((l) => l.trim()).filter(Boolean)
  const diagnostics = parseDiagnosticErrors(lastCompileError)

  const isDiagWarning = (diag: { message: string }, index: number) => {
    if (diag.message.toLowerCase().includes("warning")) return true
    const rawLine = rawLines[index] || ""
    return rawLine.toLowerCase().includes("warning")
  }

  const warnings = diagnostics.filter((d, i) => isDiagWarning(d, i))
  const errors = diagnostics.filter((d, i) => !isDiagWarning(d, i))
  const errorCount = errors.length > 0 ? errors.length : (lastCompileError && warnings.length === 0 ? 1 : 0)
  const warningCount = warnings.length

  const handleJump = (diag: { line: number | null; column: number | null; message: string }) => {
    const targetTab = detectTabFromError(lastCompileError || diag.message, activeEditorTab, activeBackend)
    if (targetTab && targetTab !== activeEditorTab) {
      setActiveEditorTab(targetTab)
    }
    const safeLine = diag.line ? Math.max(1, Math.floor(diag.line)) : 1
    const safeColumn = diag.column ? Math.max(1, Math.floor(diag.column)) : 1
    jumpToLine(safeLine, safeColumn)
  }

  return (
    <div
      data-testid="console-drawer"
      className="flex h-full w-full flex-col overflow-hidden bg-card border-t border-border select-none"
    >
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Console & Diagnostics
          </span>

          {/* Red Error count badge */}
          <span
            data-testid="console-error-badge"
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold",
              errorCount > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-emerald-500/15 text-emerald-500 font-medium"
            )}
          >
            {errorCount} {errorCount === 1 ? "Error" : "Errors"}
          </span>

          {/* Amber Warning count badge */}
          <span
            data-testid="console-warning-badge"
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-mono",
              warningCount > 0
                ? "bg-amber-500/20 text-amber-500 font-semibold"
                : "bg-muted/60 text-muted-foreground font-medium"
            )}
          >
            {warningCount} {warningCount === 1 ? "Warning" : "Warnings"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {lastCompileError && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="clear-diagnostics-btn"
              onClick={() => setLastCompileError(null)}
              title="Clear Diagnostics"
              aria-label="Clear Diagnostics"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              <span>Clear Diagnostics</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConsoleOpen(false)}
            title="Close Console"
            aria-label="Close Console"
            className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Diagnostics List */}
      <div className="flex-1 overflow-y-auto p-3">
        {diagnostics.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
            No compilation errors or diagnostics.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {diagnostics.map((diag, index) => {
              const isWarning = isDiagWarning(diag, index)
              const targetTab = detectTabFromError(lastCompileError || diag.message, activeEditorTab, activeBackend)
              const hasValidLine = typeof diag.line === "number" && diag.line > 0

              return (
                <div
                  key={index}
                  data-testid={`diagnostic-card-${index}`}
                  onClick={() => hasValidLine && handleJump(diag)}
                  className={cn(
                    "group flex items-start justify-between rounded border p-2.5 text-xs transition-colors",
                    hasValidLine && "cursor-pointer",
                    isWarning
                      ? "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                      : "border-destructive/30 bg-destructive/10 hover:bg-destructive/15"
                  )}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {isWarning ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="font-mono text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded bg-muted/70 text-foreground">
                          {targetTab}
                        </span>
                        {hasValidLine && (
                          <span
                            className={cn(
                              "font-mono font-semibold",
                              isWarning ? "text-amber-500" : "text-destructive"
                            )}
                          >
                            [Line {diag.line}{diag.column ? `:${diag.column}` : ""}]
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-foreground break-all">{diag.message}</span>
                    </div>
                  </div>

                  {hasValidLine && (
                    <button
                      type="button"
                      data-testid="jump-to-line-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleJump(diag)
                      }}
                      title={`Jump to line ${diag.line}`}
                      aria-label={`Jump to line ${diag.line}`}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-primary shrink-0 ml-2 cursor-pointer font-medium"
                    >
                      <span>Jump</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
