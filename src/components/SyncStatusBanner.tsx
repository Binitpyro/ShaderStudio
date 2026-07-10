import { useFileSystemStore } from "@/stores/fileSystemStore"
import { cn } from "@/lib/utils"

const STATUS_CONFIG = {
  bridge: { dot: "bg-green-500", text: "Synced via local bridge" },
  folder: { dot: "bg-yellow-500", text: "Synced via folder (this tab)" },
  local: { dot: "bg-muted-foreground", text: "Editing locally - not saved to disk" },
} as const

export function SyncStatusBanner() {
  const syncMode = useFileSystemStore((state) => state.syncMode)
  const activeFilePath = useFileSystemStore((state) => state.activeFilePath)
  const config = STATUS_CONFIG[syncMode]

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      <span>{config.text}</span>
      {activeFilePath && <span className="font-mono text-foreground/60 truncate max-w-[200px]">- {activeFilePath}</span>}
    </div>
  )
}
