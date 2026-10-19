import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { AIProvider, AISettings } from "./types"

interface AISettingsState extends AISettings {
  setActiveProvider: (provider: AIProvider) => void
  setApiKey: (provider: keyof AISettings["apiKeys"], key: string) => void
  setEndpoint: (provider: keyof AISettings["endpoints"], endpoint: string) => void
  setModel: (provider: keyof AISettings["models"], model: string) => void
  setMaxAutoFixRetries: (retries: number) => void
  setVisualCritique: (enabled: boolean) => void
  resetToDefaults: () => void
}

const DEFAULT_SETTINGS: AISettings = {
  activeProvider: "gemini",
  apiKeys: {
    gemini: "",
    anthropic: "",
    openai: "",
    custom: "",
  },
  endpoints: {
    ollama: "http://localhost:11434",
    lmstudio: "http://localhost:1234",
    custom: "http://localhost:8080/v1",
  },
  models: {
    gemini: "gemini-2.5-flash",
    anthropic: "claude-3-7-sonnet-20250219",
    openai: "gpt-4o",
    ollama: "qwen2.5-coder:7b",
    lmstudio: "local-model",
    custom: "default",
  },
  maxAutoFixRetries: 3,
  visualCritique: true,
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setActiveProvider: (provider) => set({ activeProvider: provider }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),

      setEndpoint: (provider, endpoint) =>
        set((state) => ({
          endpoints: { ...state.endpoints, [provider]: endpoint },
        })),

      setModel: (provider, model) =>
        set((state) => ({
          models: { ...state.models, [provider]: model },
        })),

      setMaxAutoFixRetries: (retries) => set({ maxAutoFixRetries: Math.max(0, Math.min(5, retries)) }),

      setVisualCritique: (enabled) => set({ visualCritique: enabled }),

      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: "shader-studio-ai-settings",
    }
  )
)
