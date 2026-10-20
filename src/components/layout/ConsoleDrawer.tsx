import { useProjectStore, type EditorTab } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { Badge, Button, IconButton } from "@/components/ui"
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
    <div data-testid="console-drawer" className="flex h-full w-full select-none flex-col overflow-hidden border-t border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-fg-subtle" />
          <span className="text-sm font-medium text-fg">Console & Diagnostics</span>
          <Badge data-testid="console-error-badge" tone={errorCount > 0 ? "danger" : "success"} className="num">
            {errorCount} {errorCount === 1 ? "Error" : "Errors"}
          </Badge>
          <Badge data-testid="console-warning-badge" tone={warningCount > 0 ? "warning" : "neutral"} className="num">
            {warningCount} {warningCount === 1 ? "Warning" : "Warnings"}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {lastCompileError && (
            <Button variant="ghost" size="sm" data-testid="clear-diagnostics-btn" onClick={() => setLastCompileError(null)} aria-label="Clear Diagnostics">
              <Trash2 />
              <span>Clear Diagnostics</span>
            </Button>
          )}
          <IconButton label="Close Console" onClick={() => setConsoleOpen(false)}>
            <X />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {diagnostics.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
            No compilation errors or diagnostics.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
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
                    "group flex items-start justify-between rounded-md border border-line p-2.5 text-xs transition-colors",
                    isWarning ? "bg-warning-soft" : "bg-danger-soft",
                    hasValidLine && "cursor-pointer hover:border-line-strong"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {isWarning ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    ) : (
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                    )}
                    <div className="min-w-0">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge className="capitalize">{targetTab}</Badge>
                        {hasValidLine && (
                          <span className={cn("num font-medium", isWarning ? "text-warning" : "text-danger")}>
                            [Line {diag.line}{diag.column ? `:${diag.column}` : ""}]
                          </span>
                        )}
                      </div>
                      <span className="break-all font-mono text-fg">{diag.message}</span>
                    </div>
                  </div>

                  {hasValidLine && (
                    <button
                      type="button"
                      data-testid="jump-to-line-btn"
                      onClick={(e) => { e.stopPropagation(); handleJump(diag) }}
                      title={`Jump to line ${diag.line}`}
                      aria-label={`Jump to line ${diag.line}`}
                      className="ml-2 flex shrink-0 items-center gap-1 rounded-sm px-1 text-xs font-medium text-fg-muted hover:text-brand-text"
                    >
                      <span>Jump</span>
                      <ArrowUpRight className="size-3" />
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
