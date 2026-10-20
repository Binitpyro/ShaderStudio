import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import {
  isBridgeFileMessage,
  isBridgeListMessage,
  isAgentExecuteMessage,
  isAgentCaptureMessage,
  isAgentDiagnosticsMessage,
  type AgentExecuteMessage,
  type AgentCaptureMessage,
  type AgentDiagnosticsMessage,
  type AgentFeedbackMessage,
} from "./bridgeProtocol"
import { saveSnapshot } from "@/db"
import { debounce } from "@/utils/throttle"
import { viewportCapture } from "@/utils/frameCapture"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { loadAdapter } from "@/adapters/activeAdapter"

const BRIDGE_URL = "ws://localhost:8642"
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000
const SNAPSHOT_DEBOUNCE = 5000

let ws: WebSocket | null = null
let reconnectAttempts = 0
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let isConnecting = false
let cachedToken: string | null = null

/** Removes ?token= / ?bridge_token= from the address bar so the secret is not left in history or screenshots. */
function stripTokenFromUrl() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete("token")
    url.searchParams.delete("bridge_token")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  } catch {
    /* ignore */
  }
}

// --- Auth state: close code 4401 means the token is missing/wrong; stop retrying and let the UI ask. ---
let authFailed = false
const authListeners = new Set<() => void>()
function setAuthFailed(v: boolean) {
  if (authFailed === v) return
  authFailed = v
  authListeners.forEach((l) => l())
}
export function subscribeBridgeAuth(listener: () => void) {
  authListeners.add(listener)
  return () => { authListeners.delete(listener) }
}
export function bridgeNeedsToken() {
  return authFailed
}
/** Store a pasted token and reconnect immediately. */
export function submitBridgeToken(token: string) {
  const t = token.trim()
  if (!t) return
  reconnectAttempts = 0
  setAuthFailed(false)
  connect(t)
}
/** Retry with the stored token (e.g. after restarting the bridge). */
export function retryBridge() {
  reconnectAttempts = 0
  setAuthFailed(false)
  connect()
}

/**
 * Resolves current bridge authentication token from in-memory cache,
 * URL query parameters (?token=... or ?bridge_token=...), localStorage, or environment.
 */
export function getBridgeToken(): string | null {
  if (cachedToken) return cachedToken

  // 1. URL search parameters
  if (typeof window !== "undefined" && window.location?.search) {
    try {
      const params = new URLSearchParams(window.location.search)
      const urlToken = params.get("token") || params.get("bridge_token")
      if (urlToken) {
        cachedToken = urlToken
        setBridgeToken(urlToken)
        stripTokenFromUrl()
        return cachedToken
      }
    } catch {
      /* ignore */
    }
  }

  // 2. localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = window.localStorage.getItem("shaderstudio_bridge_token")
      if (stored) {
        cachedToken = stored
        return cachedToken
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Process environment (tests / CLI)
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env
  if (env) {
    const envToken = env.SHADER_STUDIO_BRIDGE_TOKEN || env.SHADER_STUDIO_TOKEN
    if (envToken) {
      cachedToken = envToken
      return cachedToken
    }
  }

  return null
}

/**
 * Updates the active bridge authentication token and persists to localStorage if available.
 */
export function setBridgeToken(token: string | null): void {
  cachedToken = token
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      if (token) {
        window.localStorage.setItem("shaderstudio_bridge_token", token)
      } else {
        window.localStorage.removeItem("shaderstudio_bridge_token")
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Returns HTTP headers required for authenticated bridge API requests.
 */
export function getBridgeApiHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  }
  const token = getBridgeToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
    headers["X-Bridge-Token"] = token
  }
  return headers
}

/**
 * Returns the resolved HTTP URL for a bridge REST endpoint.
 */
export function getBridgeHttpUrl(endpoint: string = ""): string {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env
  const base = env?.SHADER_STUDIO_BRIDGE_HTTP_URL || "http://localhost:8642"
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`
  return `${base}${cleanEndpoint}`
}

const debouncedSaveSnapshot = debounce(saveSnapshot, SNAPSHOT_DEBOUNCE)

export function sendAgentFeedback(feedback: AgentFeedbackMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(feedback))
  }
}

/**
 * Execute shader execution request, trigger compile & optional frame capture.
 * Can be called either via WebSocket bridge or directly in-app by the Copilot.
 */
export async function executeShaderLocally(
  params: Omit<AgentExecuteMessage, "type">
): Promise<AgentFeedbackMessage> {
  const startTime = performance.now()
  const store = useProjectStore.getState()

  // 1. Switch backend if requested
  if (params.backend && params.backend !== store.activeBackend) {
    store.setActiveBackend(params.backend)
    // Small delay to let adapter mount
    await new Promise((r) => setTimeout(r, 60))
  }

  // 2. Apply uniforms if provided
  if (params.uniforms) {
    for (const [name, val] of Object.entries(params.uniforms)) {
      if (typeof val === "number") {
        store.setUniformValue(name, { type: "float", value: val })
      } else if (Array.isArray(val)) {
        const type = val.length === 2 ? "vec2" : val.length === 3 ? "vec3" : "vec4"
        store.setUniformValue(name, { type, value: val })
      } else if (typeof val === "boolean") {
        store.setUniformValue(name, { type: "bool", value: val })
      }
    }
  }

  // 3. Reset compile error, update source and recompile active adapter
  store.setLastCompileError(null)
  store.setShaderSource(params.source)
  store.triggerRecompile()

  const adapter = await loadAdapter(useProjectStore.getState().activeBackend)

  try {
    adapter.recompileShader(params.source)
  } catch (err) {
    store.setLastCompileError(err instanceof Error ? err.message : String(err))
  }

  // 4. Wait for render frames and store updates to settle
  await new Promise((resolve) => {
    let resolved = false
    const done = () => {
      if (!resolved) {
        resolved = true
        resolve(null)
      }
    }
    Promise.resolve().then(done)
    if (typeof setTimeout === "function") {
      setTimeout(done, 16)
    }
  })

  // 5. Read back compiler errors
  const currentError = useProjectStore.getState().lastCompileError
  const errors = parseDiagnosticErrors(currentError)
  const isSuccess = errors.length === 0

  // 6. Capture frame if requested
  let screenshotBase64: string | null = null
  if (params.captureSnapshot !== false) {
    screenshotBase64 = await viewportCapture.captureFrameBase64(params.snapshotOptions)
  }

  const perf = viewportCapture.getPerfMetrics()
  const activeUniforms = useProjectStore.getState().parsedUniforms.map((u) => u.name)
  const executionTimeMs = Math.round(performance.now() - startTime)

  return {
    type: "agent:feedback",
    id: params.id,
    status: isSuccess ? "success" : "error",
    backend: useProjectStore.getState().activeBackend,
    errors,
    screenshotBase64,
    perf,
    activeUniforms,
    executionTimeMs,
  }
}

async function handleAgentExecute(msg: AgentExecuteMessage) {
  const feedback = await executeShaderLocally(msg)
  sendAgentFeedback(feedback)
}

async function handleAgentCapture(msg: AgentCaptureMessage) {
  const screenshotBase64 = await viewportCapture.captureFrameBase64(msg.snapshotOptions)
  const perf = viewportCapture.getPerfMetrics()
  const currentError = useProjectStore.getState().lastCompileError
  const errors = parseDiagnosticErrors(currentError)

  const feedback: AgentFeedbackMessage = {
    type: "agent:feedback",
    id: msg.id,
    status: errors.length === 0 ? "success" : "error",
    backend: useProjectStore.getState().activeBackend,
    errors,
    screenshotBase64,
    perf,
  }
  sendAgentFeedback(feedback)
}

function handleAgentDiagnostics(msg: AgentDiagnosticsMessage) {
  const currentError = useProjectStore.getState().lastCompileError
  const errors = parseDiagnosticErrors(currentError)
  const perf = viewportCapture.getPerfMetrics()

  const feedback: AgentFeedbackMessage = {
    type: "agent:feedback",
    id: msg.id,
    status: errors.length === 0 ? "success" : "error",
    backend: useProjectStore.getState().activeBackend,
    errors,
    perf,
  }
  sendAgentFeedback(feedback)
}

export function connect(tokenOverride?: string) {
  if (tokenOverride !== undefined) {
    setBridgeToken(tokenOverride)
  }
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return
  isConnecting = true
  try {
    const token = getBridgeToken()
    const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env
    const baseUrl = env?.SHADER_STUDIO_BRIDGE_WS_URL || BRIDGE_URL
    const wsUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl

    ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      isConnecting = false
      reconnectAttempts = 0
      setAuthFailed(false)
      useFileSystemStore.getState().setBridgeConnected(true)
      useFileSystemStore.getState().setSyncMode("bridge")
    }
    ws.onmessage = async (event) => {
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
        } else if (isAgentExecuteMessage(data)) {
          await handleAgentExecute(data)
        } else if (isAgentCaptureMessage(data)) {
          await handleAgentCapture(data)
        } else if (isAgentDiagnosticsMessage(data)) {
          handleAgentDiagnostics(data)
        }
      } catch {
        /* ignore parse errors */
      }
    }
    ws.onclose = (event) => {
      isConnecting = false
      ws = null
      useFileSystemStore.getState().setBridgeConnected(false)
      const currentMode = useFileSystemStore.getState().syncMode
      if (currentMode === "bridge") useFileSystemStore.getState().setSyncMode("local")
      if (event && event.code === 4401) {
        console.warn("[BridgeClient] Unauthorized: Bridge rejected WebSocket connection with code 4401")
        setAuthFailed(true)
        return // no retry loop: the user must supply a token (SyncStatusBanner)
      }
      scheduleReconnect()
    }
    ws.onerror = () => {
      isConnecting = false
    }
  } catch {
    isConnecting = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY)
  reconnectTimeout = setTimeout(() => {
    connect()
  }, delay)
  reconnectAttempts++
}

export function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  isConnecting = false
  useFileSystemStore.getState().setBridgeConnected(false)
  const currentMode = useFileSystemStore.getState().syncMode
  if (currentMode === "bridge") useFileSystemStore.getState().setSyncMode("local")
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN
}
