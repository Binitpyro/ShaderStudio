export interface BridgeFileMessage { type: "file"; path: string; content: string }
export interface BridgeListMessage { type: "list"; files: string[] }
export type BridgeMessage = BridgeFileMessage | BridgeListMessage

export function isBridgeFileMessage(msg: unknown): msg is BridgeFileMessage {
  return typeof msg === "object" && msg !== null && "type" in msg && (msg as { type: string }).type === "file" && "path" in msg && "content" in msg
}

export function isBridgeListMessage(msg: unknown): msg is BridgeListMessage {
  return typeof msg === "object" && msg !== null && "type" in msg && (msg as { type: string }).type === "list" && "files" in msg
}
