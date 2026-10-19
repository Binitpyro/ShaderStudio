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

export interface DiagnosticError {
  line: number | null
  column: number | null
  message: string
}

export interface AgentFeedbackMessage {
  type: "agent:feedback"
  id: string
  status: "success" | "error"
  backend: string
  errors: DiagnosticError[]
  screenshotBase64?: string | null
  perf?: { fps: number; frameTimeMs: number }
  activeUniforms?: string[]
  executionTimeMs?: number
}

export type BridgeMessage =
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
