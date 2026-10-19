import { describe, it, expect } from "vitest"
import { useAISettingsStore } from "../aiSettingsStore"

describe("AI Settings Store", () => {
  it("initializes with default providers and endpoints", () => {
    const state = useAISettingsStore.getState()
    expect(state.endpoints.ollama).toBe("http://localhost:11434")
    expect(state.endpoints.lmstudio).toBe("http://localhost:1234")
    expect(state.models.ollama).toBe("qwen2.5-coder:7b")
    expect(state.models.lmstudio).toBe("local-model")
  })

  it("updates provider and local endpoints", () => {
    const store = useAISettingsStore.getState()
    store.setActiveProvider("ollama")
    store.setEndpoint("ollama", "http://192.168.1.100:11434")
    store.setModel("ollama", "deepseek-coder:6.7b")

    const updated = useAISettingsStore.getState()
    expect(updated.activeProvider).toBe("ollama")
    expect(updated.endpoints.ollama).toBe("http://192.168.1.100:11434")
    expect(updated.models.ollama).toBe("deepseek-coder:6.7b")
  })

  it("clamps auto-fix retries within valid bounds", () => {
    const store = useAISettingsStore.getState()
    store.setMaxAutoFixRetries(10)
    expect(useAISettingsStore.getState().maxAutoFixRetries).toBe(5)

    store.setMaxAutoFixRetries(-2)
    expect(useAISettingsStore.getState().maxAutoFixRetries).toBe(0)
  })
})
