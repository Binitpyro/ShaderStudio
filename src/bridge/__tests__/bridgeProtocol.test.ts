import { describe, it, expect } from "vitest"
import {
  isBridgeFileMessage,
  isBridgeListMessage,
  isAgentExecuteMessage,
  isAgentCaptureMessage,
  isAgentDiagnosticsMessage,
  isAgentFeedbackMessage,
} from "../bridgeProtocol"

describe("Bridge Protocol Validators", () => {
  it("validates bridge file message", () => {
    expect(isBridgeFileMessage({ type: "file", path: "test.wgsl", content: "void main(){}" })).toBe(true)
    expect(isBridgeFileMessage({ type: "file", path: "test.wgsl" })).toBe(false)
  })

  it("validates bridge list message", () => {
    expect(isBridgeListMessage({ type: "list", files: ["a.wgsl", "b.glsl"] })).toBe(true)
    expect(isBridgeListMessage({ type: "list" })).toBe(false)
  })

  it("validates agent execute message", () => {
    const valid = {
      type: "agent:execute",
      id: "rpc_123",
      source: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }",
      backend: "webgpu",
      uniforms: { u_speed: 1.5 },
      captureSnapshot: true,
    }
    expect(isAgentExecuteMessage(valid)).toBe(true)
    expect(isAgentExecuteMessage({ type: "agent:execute" })).toBe(false)
  })

  it("validates agent capture message", () => {
    expect(isAgentCaptureMessage({ type: "agent:capture", id: "cap_456" })).toBe(true)
    expect(isAgentCaptureMessage({ type: "agent:capture" })).toBe(false)
  })

  it("validates agent diagnostics message", () => {
    expect(isAgentDiagnosticsMessage({ type: "agent:diagnostics", id: "diag_789" })).toBe(true)
    expect(isAgentDiagnosticsMessage({ type: "other", id: "diag_789" })).toBe(false)
  })

  it("validates agent feedback message", () => {
    const validFeedback = {
      type: "agent:feedback",
      id: "rpc_123",
      status: "success",
      backend: "webgpu",
      errors: [],
      screenshotBase64: "data:image/png;base64,iVBORw...",
    }
    expect(isAgentFeedbackMessage(validFeedback)).toBe(true)
  })
})
