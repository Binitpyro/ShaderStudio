import { useFileSystemStore } from "@/stores/fileSystemStore"
import { useProjectStore } from "@/stores/projectStore"

export const FOLDER_POLL_MS = 1000
const SNAPSHOT_DEBOUNCE = 5000

let timer: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let ticking = false

/** Debounced IndexedDB snapshot of the active file (shared by the importer and the poller). */
export function scheduleFolderSnapshot(path: string, content: string) {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => { snapshotTimer = null; void import("@/db").then((m) => m.saveSnapshot(path, content)).catch((e) => console.warn("[snapshot] save failed", e)) }, SNAPSHOT_DEBOUNCE)
}

/** One poll pass. Reads the LIVE handle map every call, so reconnects and clears are always honoured. */
export async function pollFolderOnce() {
  if (ticking) return
  ticking = true
  try {
    for (const [path, entry] of useFileSystemStore.getState().fileHandles) {
      try {
        const file = await entry.handle.getFile()
        if (file.lastModified <= entry.lastModified) continue
        const content = await file.text()
        const fs = useFileSystemStore.getState()
        fs.setFileHandle(path, { ...entry, lastModified: file.lastModified })
        if (path === fs.activeFilePath) {
          const p = useProjectStore.getState()
          p.setShaderSource(content)
          p.triggerRecompile()
          scheduleFolderSnapshot(path, content)
        }
      } catch { /* file deleted or unreadable: skip this tick */ }
    }
  } finally {
    ticking = false
  }
}

function sync(mode: string) {
  if (mode === "folder") {
    if (!timer) timer = setInterval(() => { void pollFolderOnce() }, FOLDER_POLL_MS)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Polls while syncMode === "folder"; stops itself on any other mode. Independent of React: survives tab unmount. Idempotent. */
export function startFolderSync() {
  if (!unsubscribe) {
    unsubscribe = useFileSystemStore.subscribe((s, prev) => { if (s.syncMode !== prev.syncMode) sync(s.syncMode) })
  }
  sync(useFileSystemStore.getState().syncMode)
}

export function stopFolderSync() {
  if (timer) { clearInterval(timer); timer = null }
  if (unsubscribe) { unsubscribe(); unsubscribe = null }
}

export function isFolderSyncRunning() { return timer !== null }
