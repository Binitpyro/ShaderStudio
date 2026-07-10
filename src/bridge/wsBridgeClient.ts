import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { isBridgeFileMessage, isBridgeListMessage } from "./bridgeProtocol"
import { saveSnapshot } from "@/db"

const BRIDGE_URL = "ws://localhost:8642"
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000
const SNAPSHOT_DEBOUNCE = 5000

let ws: WebSocket | null = null
let reconnectAttempts = 0
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let isConnecting = false
let snapshotTimeout: ReturnType<typeof setTimeout> | null = null
let lastSnapshotPath: string | null = null

function debouncedSaveSnapshot(path: string, content: string) {
  if (snapshotTimeout) clearTimeout(snapshotTimeout)
  lastSnapshotPath = path
  snapshotTimeout = setTimeout(() => {
    if (lastSnapshotPath) saveSnapshot(lastSnapshotPath, content)
    snapshotTimeout = null
  }, SNAPSHOT_DEBOUNCE)
}

export function connect() {
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return
  isConnecting = true
  try {
    ws = new WebSocket(BRIDGE_URL)
    ws.onopen = () => {
      isConnecting = false
      reconnectAttempts = 0
      useFileSystemStore.getState().setBridgeConnected(true)
      useFileSystemStore.getState().setSyncMode("bridge")
    }
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (isBridgeFileMessage(data)) {
          const store = useProjectStore.getState()
          store.setShaderSource(data.content)
          store.setActiveShaderPath(data.path)
          store.triggerRecompile()
          useFileSystemStore.getState().setActiveFilePath(data.path)
          debouncedSaveSnapshot(data.path, data.content)
        } else if (isBridgeListMessage(data)) {
          if (data.files.length > 0) useFileSystemStore.getState().setActiveFilePath(data.files[0])
        }
      } catch { /* ignore parse errors */ }
    }
    ws.onclose = () => {
      isConnecting = false
      ws = null
      useFileSystemStore.getState().setBridgeConnected(false)
      const currentMode = useFileSystemStore.getState().syncMode
      if (currentMode === "bridge") useFileSystemStore.getState().setSyncMode("local")
      scheduleReconnect()
    }
    ws.onerror = () => { isConnecting = false }
  } catch {
    isConnecting = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY)
  reconnectTimeout = setTimeout(() => { connect() }, delay)
  reconnectAttempts++
}

export function disconnect() {
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null }
  if (ws) { ws.close(); ws = null }
  isConnecting = false
  useFileSystemStore.getState().setBridgeConnected(false)
  const currentMode = useFileSystemStore.getState().syncMode
  if (currentMode === "bridge") useFileSystemStore.getState().setSyncMode("local")
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN
}
