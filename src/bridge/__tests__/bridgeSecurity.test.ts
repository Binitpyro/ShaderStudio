import { describe, it, expect } from "vitest"
// @ts-expect-error -- untyped JS script
import { isAllowedAiUrl } from "../../../scripts/bridge.js"

describe("Bridge Security & SSRF Protection", () => {
  it("allows trusted cloud AI provider endpoints over HTTPS", () => {
    expect(isAllowedAiUrl("https://api.anthropic.com/v1/messages")).toBe(true)
    expect(isAllowedAiUrl("https://generativelanguage.googleapis.com/v1beta/models")).toBe(true)
    expect(isAllowedAiUrl("https://api.openai.com/v1/chat/completions")).toBe(true)
  })

  it("allows local offline LLMs on localhost and 127.0.0.1", () => {
    expect(isAllowedAiUrl("http://localhost:11434/api/generate")).toBe(true)
    expect(isAllowedAiUrl("http://127.0.0.1:1234/v1/chat/completions")).toBe(true)
  })

  it("blocks other local ports (SSRF into local services)", () => {
    expect(isAllowedAiUrl("http://localhost:6379/")).toBe(false)
    expect(isAllowedAiUrl("http://127.0.0.1:8642/api/status")).toBe(false)
  })

  it("blocks SSRF attacks to cloud metadata endpoints (169.254.169.254)", () => {
    expect(isAllowedAiUrl("http://169.254.169.254/latest/meta-data")).toBe(false)
    expect(isAllowedAiUrl("https://169.254.169.254/secret")).toBe(false)
  })

  it("blocks arbitrary internal LAN endpoints and external untrusted hosts", () => {
    expect(isAllowedAiUrl("http://192.168.1.1/admin")).toBe(false)
    expect(isAllowedAiUrl("http://10.0.0.1/router")).toBe(false)
    expect(isAllowedAiUrl("https://evil-attacker.com/steal-keys")).toBe(false)
    expect(isAllowedAiUrl("file:///etc/passwd")).toBe(false)
    expect(isAllowedAiUrl("javascript:alert(1)")).toBe(false)
    expect(isAllowedAiUrl("")).toBe(false)
  })
})
