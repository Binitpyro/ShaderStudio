import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import {
  isBridgeFileMessage,
  isBridgeListMessage,
  isAgentExecuteMessage,
  isAgentCaptureMessage,
  isAgentDiagnosticsMessage,
  isBridgeHelloMessage,
  verifyBridgeProof,
  type AgentExecuteMessage,
  type AgentCaptureMessage,
  type AgentDiagnosticsMessage,
  type AgentFeedbackMessage,
} from "./bridgeProtocol"
import { debounce } from "@/utils/throttle"
import { viewportCapture } from "@/utils/frameCapture"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { loadAdapter } from "@/adapters/activeAdapter"

const BRIDGE_URL = "ws://localhost:8642"
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000
const SNAPSHOT_DEBOUNCE = 5000
const HANDSHAKE_TIMEOUT_MS = 5000
const UNTRUSTED_SERVER_CLOSE = 4403
const COMPILE_TIMEOUT_MS = 3000

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
}

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

// db (Dexie) loads on first save, not at startup.
export const saveSnapshot = (path: string, content: string) =>
  import("@/db").then((m) => m.saveSnapshot(path, content)).catch((e) => console.warn("[snapshot] save failed", e))
const debouncedSaveSnapshot = debounce(saveSnapshot, SNAPSHOT_DEBOUNCE)

export function sendAgentFeedback(feedback: AgentFeedbackMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(feedback))
  }
}

export interface CompileOutcome {
  /** Error reported by the adapter, or null when it reported success (or never reported: see timedOut). */
  error: string | null
  /** True when no adapter report arrived in time: the compile is unverified, not clean. */
  timedOut: boolean
}

/**
 * Runs `start` (one compile) and resolves once the adapter makes a real report, i.e. the store's compileSeq moves
 * (setLastCompileError, null or message). Plain clears such as graph edits do not bump it, so they cannot settle the wait.
 * If nothing reports within the timeout it resolves { timedOut: true }, never as success.
 */
export function compileAndAwait(start: () => void, timeoutMs = COMPILE_TIMEOUT_MS): Promise<CompileOutcome> {
  return new Promise((resolve) => {
    const seq = useProjectStore.getState().compileSeq
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (outcome: CompileOutcome) => {
      unsubscribe()
      clearTimeout(timer)
      resolve(outcome)
    }
    const unsubscribe = useProjectStore.subscribe((s) => {
      if (s.compileSeq !== seq) finish({ error: s.lastCompileError, timedOut: false })
    })
    timer = setTimeout(() => finish({ error: null, timedOut: true }), timeoutMs)
    try {
      start()
    } catch (err) {
      useProjectStore.getState().setLastCompileError(err instanceof Error ? err.message : String(err))
    }
  })
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

  // 1. Switch backend if requested (always compare against fresh state, never a captured snapshot)
  if (params.backend && params.backend !== useProjectStore.getState().activeBackend) {
    store.setActiveBackend(params.backend)
    // Small delay to let the Viewport swap adapters
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

  // 3. Update source, then run ONE compile on the live adapter (the Viewport's own instance) and await its real
  //    result. No triggerRecompile(): the Viewport would compile a second time.
  store.setShaderSource(params.source)
  const adapter = await loadAdapter(useProjectStore.getState().activeBackend)
  const outcome = await compileAndAwait(() => adapter.recompileShader(params.source))
  const errors = parseDiagnosticErrors(outcome.error)
  const status: AgentFeedbackMessage["status"] = outcome.timedOut ? "unverified" : errors.length === 0 ? "success" : "error"

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
    status,
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

    // Handshake: the bridge must prove it knows the token (HMAC of our nonce) before we apply anything it pushes.
    const nonce = token ? randomNonce() : null
    let settleTrust: (ok: boolean) => void = () => {}
    const trusted = new Promise<boolean>((r) => { settleTrust = r })
    const trustTimer = setTimeout(() => settleTrust(false), HANDSHAKE_TIMEOUT_MS)

    const sock = new WebSocket(nonce ? `${wsUrl}&nonce=${nonce}` : wsUrl)
    ws = sock
    void trusted.then((ok) => {
      clearTimeout(trustTimer)
      if (!ok) {
        console.warn("[BridgeClient] Server did not prove it knows the bridge token; closing and ignoring its messages")
        sock.close(UNTRUSTED_SERVER_CLOSE)
      }
    })
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
        if (isBridgeHelloMessage(data)) {
          settleTrust(!!token && !!nonce && (await verifyBridgeProof(token, nonce, data.proof)))
          return
        }
        if (!nonce || !(await trusted)) return // unverified server: drop everything
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
      clearTimeout(trustTimer)
      settleTrust(false)
      if (ws === sock) ws = null
      useFileSystemStore.getState().setBridgeConnected(false)
      const currentMode = useFileSystemStore.getState().syncMode
      if (currentMode === "bridge") useFileSystemStore.getState().setSyncMode("local")
      if (event && event.code === 4401) {
        console.warn("[BridgeClient] Unauthorized: Bridge rejected WebSocket connection with code 4401")
        setAuthFailed(true)
        return // no retry loop: the user must supply a token (SyncStatusBanner)
      }
      if (event && event.code === UNTRUSTED_SERVER_CLOSE) return // impostor / pre-handshake bridge: do not retry-loop against it
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
