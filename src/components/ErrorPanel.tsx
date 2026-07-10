import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"

function extractLineFromError(error: string): number | null {
  const lineMatch = error.match(/line\s*(\d+)/i) || error.match(/:(\d+):/)
  return lineMatch ? parseInt(lineMatch[1], 10) : null
}

export function ErrorPanel() {
  const lastCompileError = useProjectStore((state) => state.lastCompileError)
  const setLastCompileError = useProjectStore((state) => state.setLastCompileError)
  const errorLine = lastCompileError ? extractLineFromError(lastCompileError) : null

  if (!lastCompileError) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-card">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Console</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground/60">No errors</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Console</span>
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setLastCompileError(null)} className="h-6 text-xs">Clear</Button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="rounded bg-destructive/10 border border-destructive/30 p-2">
          {errorLine && <div className="text-xs text-muted-foreground mb-1">Error at line {errorLine}</div>}
          <pre className="text-xs font-mono whitespace-pre-wrap break-all text-destructive">{lastCompileError}</pre>
        </div>
      </div>
    </div>
  )
}
