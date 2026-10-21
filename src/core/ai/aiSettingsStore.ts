import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { AIProvider, AISettings } from "./types"

interface AISettingsState extends AISettings {
  /** One-time, in-memory only: legacy plaintext keys were found in storage and dropped. */
  keysMigrationNotice: boolean
  dismissKeysMigrationNotice: () => void
  setActiveProvider: (provider: AIProvider) => void
  setApiKey: (provider: keyof AISettings["apiKeys"], key: string) => void
  setEndpoint: (provider: keyof AISettings["endpoints"], endpoint: string) => void
  setModel: (provider: keyof AISettings["models"], model: string) => void
  setMaxAutoFixRetries: (retries: number) => void
  setVisualCritique: (enabled: boolean) => void
  setRememberKeys: (remember: boolean) => void
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
  rememberKeys: false,
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      keysMigrationNotice: false,
      dismissKeysMigrationNotice: () => set({ keysMigrationNotice: false }),

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

      setRememberKeys: (remember) => set({ rememberKeys: remember }),

      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: "shader-studio-ai-settings",
      // API keys only touch localStorage when the user opted in ("Remember keys on this device").
      partialize: (s) => {
        const { apiKeys, keysMigrationNotice: _notice, dismissKeysMigrationNotice: _dismiss, ...rest } = s
        return s.rememberKeys ? { ...rest, apiKeys } : rest
      },
      // Drop keys that an older version (or a since-revoked opt-in) left in storage, and rewrite storage without them.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AISettingsState>
        const { apiKeys, ...rest } = p
        const hadLegacyKeys = !p.rememberKeys && !!apiKeys && Object.values(apiKeys).some((k) => typeof k === "string" && k !== "")
        return { ...current, ...rest, keysMigrationNotice: hadLegacyKeys, ...(p.rememberKeys && apiKeys ? { apiKeys: { ...current.apiKeys, ...apiKeys } } : {}) }
      },
      onRehydrateStorage: () => () => {
        if (typeof localStorage !== "undefined") queueMicrotask(() => useAISettingsStore.setState({}))
      },
    }
  )
)
