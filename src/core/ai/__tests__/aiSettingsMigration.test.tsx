// @vitest-environment happy-dom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { useAISettingsStore } from "../aiSettingsStore"
import { AICopilotSidebar } from "@/components/sidebars/AICopilotSidebar"

const KEY = "shader-studio-ai-settings"
const stored = (state: object) => localStorage.setItem(KEY, JSON.stringify({ state, version: 0 }))

describe("legacy API key migration", () => {
  it("drops legacy stored keys and raises a one-time notice", async () => {
    stored({ activeProvider: "openai", apiKeys: { gemini: "AIza-legacy", anthropic: "", openai: "", custom: "" } })
    await useAISettingsStore.persist.rehydrate()
    const s = useAISettingsStore.getState()
    expect(s.keysMigrationNotice).toBe(true)
    expect(s.apiKeys.gemini).toBe("")
    expect(s.activeProvider).toBe("openai")
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem(KEY)).not.toContain("AIza-legacy")
    s.dismissKeysMigrationNotice()
    expect(useAISettingsStore.getState().keysMigrationNotice).toBe(false)
    await useAISettingsStore.persist.rehydrate()
    expect(useAISettingsStore.getState().keysMigrationNotice).toBe(false)
  })

  it("keeps keys when the user opted in, with no notice", async () => {
    stored({ rememberKeys: true, apiKeys: { gemini: "k", anthropic: "", openai: "", custom: "" } })
    await useAISettingsStore.persist.rehydrate()
    expect(useAISettingsStore.getState().apiKeys.gemini).toBe("k")
    expect(useAISettingsStore.getState().keysMigrationNotice).toBe(false)
  })

  it("Copilot sidebar shows a dismissible notice", () => {
    useAISettingsStore.setState({ keysMigrationNotice: true })
    render(<AICopilotSidebar />)
    expect(screen.getByText(/Saved API keys were cleared for security/)).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByText("Dismiss"))
    })
    expect(screen.queryByText(/Saved API keys were cleared/)).toBeNull()
  })
})
