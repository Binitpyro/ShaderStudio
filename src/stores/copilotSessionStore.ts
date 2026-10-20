import { create } from "zustand"
import { runAIShaderGeneration } from "@/core/ai/aiAgentRunner"
import { useAISettingsStore } from "@/core/ai/aiSettingsStore"
import type { GenerationSession, IterationStep } from "@/core/ai/types"

// Non-persisted copilot state shared by AICopilotDrawer/AICopilotSidebar. Lives outside the (lazily mounted,
// unmount-on-close) components so an in-flight run survives close/reopen and can't be started twice.
interface CopilotSessionState {
  prompt: string
  isRunning: boolean
  currentSession: GenerationSession | null
  setPrompt: (p: string) => void
  run: (customPrompt?: string) => Promise<void>
}

export const useCopilotSessionStore = create<CopilotSessionState>()((set, get) => ({
  prompt: "",
  isRunning: false,
  currentSession: null,
  setPrompt: (prompt) => set({ prompt }),
  run: async (customPrompt) => {
    const text = customPrompt || get().prompt
    if (!text.trim() || get().isRunning) return // concurrent-run guard
    set({ isRunning: true, currentSession: null })
    try {
      await runAIShaderGeneration(text, useAISettingsStore.getState(), {
        onStepUpdate: (step: IterationStep) =>
          set((s) => {
            if (!s.currentSession) return s
            const steps = [...s.currentSession.steps]
            const i = steps.findIndex((x) => x.stepNumber === step.stepNumber)
            if (i !== -1) steps[i] = step
            else steps.push(step)
            return { currentSession: { ...s.currentSession, steps } }
          }),
        onComplete: (session) => set({ currentSession: session, isRunning: false }),
      })
    } catch {
      set({ isRunning: false })
    }
  },
}))
