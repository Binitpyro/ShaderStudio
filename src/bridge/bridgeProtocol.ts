export interface BridgeFileMessage {
  type: "file"
  path: string
  content: string
}

export interface BridgeListMessage {
  type: "list"
  files: string[]
}

export interface AgentExecuteMessage {
  type: "agent:execute"
  id: string
  source: string
  backend?: "webgpu" | "webgl2" | "threejs"
  uniforms?: Record<string, any>
  captureSnapshot?: boolean
  snapshotOptions?: { width?: number; height?: number }
}

export interface AgentCaptureMessage {
  type: "agent:capture"
  id: string
  snapshotOptions?: { width?: number; height?: number }
}

export interface AgentDiagnosticsMessage {
  type: "agent:diagnostics"
  id: string
}

/** First message from the bridge when the client sent ?nonce=: HMAC-SHA256(token, nonce) in hex. */
export interface BridgeHelloMessage {
  type: "hello"
  proof: string
}

/**
 * Sent by the client after it verified the hello proof. The token travels only in this message, never in the WebSocket
 * URL; the server drops (4401) any other first message and any socket that has not authenticated within 5 s.
 */
export interface BridgeAuthMessage {
  type: "auth"
  token: string
}

export function isBridgeHelloMessage(msg: unknown): msg is BridgeHelloMessage {
  return typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "hello" && typeof (msg as { proof?: unknown }).proof === "string"
}

/** HMAC-SHA256(token, nonce) as hex via WebCrypto. Mirrors computeHandshakeProof in scripts/bridge.js. */
export async function computeBridgeProof(token: string, nonce: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(nonce)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function verifyBridgeProof(token: string, nonce: string, proof: string): Promise<boolean> {
  const expected = await computeBridgeProof(token, nonce)
  if (proof.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i)
  return diff === 0
}

export interface DiagnosticError {
  line: number | null
  column: number | null
  message: string
}

export interface AgentFeedbackMessage {
  type: "agent:feedback"
  id: string
  /** "unverified": the adapter never reported a compile result in time, so neither success nor failure is known. */
  status: "success" | "error" | "unverified"
  backend: string
  errors: DiagnosticError[]
  screenshotBase64?: string | null
  perf?: { fps: number; frameTimeMs: number }
  activeUniforms?: string[]
  executionTimeMs?: number
}

export type BridgeMessage =
  | BridgeHelloMessage
  | BridgeAuthMessage
  | BridgeFileMessage
  | BridgeListMessage
  | AgentExecuteMessage
  | AgentCaptureMessage
  | AgentDiagnosticsMessage
  | AgentFeedbackMessage

export function isBridgeFileMessage(msg: unknown): msg is BridgeFileMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "file" &&
    "path" in msg &&
    "content" in msg
  )
}

export function isBridgeListMessage(msg: unknown): msg is BridgeListMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "list" &&
    "files" in msg
  )
}

export function isAgentExecuteMessage(msg: unknown): msg is AgentExecuteMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "agent:execute" &&
    "id" in msg &&
    "source" in msg
  )
}

export function isAgentCaptureMessage(msg: unknown): msg is AgentCaptureMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "agent:capture" &&
    "id" in msg
  )
}

export function isAgentDiagnosticsMessage(msg: unknown): msg is AgentDiagnosticsMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "agent:diagnostics" &&
    "id" in msg
  )
}

export function isAgentFeedbackMessage(msg: unknown): msg is AgentFeedbackMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type: string }).type === "agent:feedback" &&
    "id" in msg &&
    "status" in msg
  )
}
