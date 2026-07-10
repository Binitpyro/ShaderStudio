import { useProjectStore, type BackendType } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const BACKEND_OPTIONS: { value: BackendType; label: string }[] = [
  { value: "webgpu", label: "WebGPU" },
  { value: "webgl2", label: "WebGL2" },
  { value: "threejs", label: "Three.js" },
]

export function Toolbar() {
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)
  const autoCompile = useProjectStore((state) => state.autoCompile)
  const setAutoCompile = useProjectStore((state) => state.setAutoCompile)
  const hasUnsavedChanges = useProjectStore((state) => state.hasUnsavedChanges)
  const currentProjectName = useProjectStore((state) => state.currentProjectName)
  const bridgeConnected = useFileSystemStore((state) => state.bridgeConnected)

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <span className={cn("h-2 w-2 rounded-full", bridgeConnected ? "bg-green-500" : "bg-primary")} />
        <h1 className="text-sm font-semibold tracking-tight text-foreground">Shader Studio</h1>
        {currentProjectName && <span className="text-xs text-muted-foreground">- {currentProjectName}</span>}
        {hasUnsavedChanges && <span className="text-xs text-muted-foreground">*</span>}
      </div>

      <div className="flex items-center gap-3">
        <select
          value={activeBackend}
          onChange={(e) => setActiveBackend(e.target.value as BackendType)}
          className="bg-background text-xs border border-border rounded px-2 py-1 font-mono"
        >
          {BACKEND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="auto-compile" checked={autoCompile} onCheckedChange={setAutoCompile} />
          <Label htmlFor="auto-compile" className="text-xs text-muted-foreground cursor-pointer">Auto-compile</Label>
        </div>
      </div>
    </div>
  )
}
