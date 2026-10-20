import { useState, useSyncExternalStore } from "react"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { bridgeNeedsToken, subscribeBridgeAuth, submitBridgeToken, retryBridge } from "@/bridge/wsBridgeClient"
import { Badge, Button, Input } from "@/components/ui"

const STATUS = {
  bridge: { tone: "success", label: "Bridge", title: "Synced via local bridge" },
  folder: { tone: "info", label: "Folder", title: "Synced via folder (this tab)" },
  local: { tone: "neutral", label: "Local", title: "Editing locally, not saved to disk" },
} as const

/** Sync status as a Badge. When the dev bridge rejects us (close code 4401) it asks for a token instead. */
export function SyncStatusBanner() {
  const syncMode = useFileSystemStore((s) => s.syncMode)
  const activeFilePath = useFileSystemStore((s) => s.activeFilePath)
  const needsToken = useSyncExternalStore(subscribeBridgeAuth, bridgeNeedsToken, bridgeNeedsToken)
  const [token, setToken] = useState("")
  const status = STATUS[syncMode]

  if (needsToken) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 text-xs"
        onSubmit={(e) => { e.preventDefault(); submitBridgeToken(token); setToken("") }}
      >
        <Badge tone="warning">Bridge needs a token</Badge>
        <Input
          type="password"
          aria-label="Bridge token"
          placeholder="Paste token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-7 w-40"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!token.trim()}>Connect</Button>
        <Button type="button" size="sm" variant="ghost" onClick={retryBridge}>Retry</Button>
      </form>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
      <Badge tone={status.tone} title={status.title}>{status.label}</Badge>
      {activeFilePath && <span className="num truncate max-w-[200px]">{activeFilePath}</span>}
    </div>
  )
}
