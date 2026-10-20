// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { dispatchAICall } from "../providers"
import { useAISettingsStore } from "../aiSettingsStore"
import { setBridgeToken } from "@/bridge/wsBridgeClient"

const STORAGE_KEY = "shader-studio-ai-settings"

describe("Gemini key handling", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends the key in the x-goog-api-key header, never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) })
    vi.stubGlobal("fetch", fetchMock)
    const settings = useAISettingsStore.getState()
    await dispatchAICall("gemini", [{ role: "user", content: "hi" }], { ...settings, apiKeys: { gemini: "SECRET-KEY" } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).not.toContain("SECRET-KEY")
    expect(String(url)).not.toContain("key=")
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "SECRET-KEY" })
  })
})

describe("local-endpoint proxy fallback authenticates to the bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setBridgeToken(null)
  })

  it("sends the bridge token with the /api/ai/proxy request", async () => {
    setBridgeToken("proxy-token")
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("CORS"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "hello" } }] }) })
    vi.stubGlobal("fetch", fetchMock)
    const settings = useAISettingsStore.getState()
    await expect(dispatchAICall("ollama", [{ role: "user", content: "hi" }], settings)).resolves.toBe("hello")
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toContain("/api/ai/proxy")
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer proxy-token" })
  })
})

describe("API keys are persisted only when the user opts in", () => {
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").state ?? {}
  beforeEach(() => {
    useAISettingsStore.getState().resetToDefaults()
    localStorage.clear()
  })

  it("keeps keys out of localStorage by default", () => {
    const s = useAISettingsStore.getState()
    expect(s.rememberKeys).toBe(false)
    s.setApiKey("anthropic", "sk-ant-secret")
    expect(useAISettingsStore.getState().apiKeys.anthropic).toBe("sk-ant-secret") // still usable in memory
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("sk-ant-secret")
    expect(stored().apiKeys).toBeUndefined()
  })

  it("persists keys once 'Remember keys on this device' is on, and removes them when turned off", () => {
    const s = useAISettingsStore.getState()
    s.setRememberKeys(true)
    s.setApiKey("openai", "sk-remembered")
    expect(stored().apiKeys.openai).toBe("sk-remembered")
    useAISettingsStore.getState().setRememberKeys(false)
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("sk-remembered")
  })

  it("scrubs plaintext keys left behind by an older version when rehydrating", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { apiKeys: { gemini: "legacy-plaintext" }, activeProvider: "gemini" }, version: 0 }))
    await useAISettingsStore.persist.rehydrate()
    await new Promise((r) => setTimeout(r, 10))
    expect(useAISettingsStore.getState().apiKeys.gemini).toBe("")
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("legacy-plaintext")
  })
})
