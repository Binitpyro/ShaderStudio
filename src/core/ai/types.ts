export type AIProvider = "gemini" | "anthropic" | "openai" | "ollama" | "lmstudio" | "custom"

export interface AISettings {
  activeProvider: AIProvider
  apiKeys: {
    gemini?: string
    anthropic?: string
    openai?: string
    custom?: string
  }
  endpoints: {
    ollama: string
    lmstudio: string
    custom: string
  }
  models: {
    gemini: string
    anthropic: string
    openai: string
    ollama: string
    lmstudio: string
    custom: string
  }
  maxAutoFixRetries: number
  visualCritique: boolean
  systemPromptPreset?: string
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  imageBase64?: string | null
}

export interface IterationStep {
  stepNumber: number
  type: "generate" | "compile_check" | "auto_fix" | "visual_critique" | "complete"
  status: "pending" | "running" | "success" | "warning" | "error"
  description: string
  codeSnippet?: string
  screenshotBase64?: string | null
  errorMessages?: string[]
  critiqueNotes?: string
  durationMs?: number
}

export interface GenerationSession {
  id: string
  userPrompt: string
  backend: "webgpu" | "webgl2" | "threejs"
  provider: AIProvider
  model: string
  startedAt: number
  completedAt?: number
  finalShaderCode?: string
  finalScreenshotBase64?: string | null
  steps: IterationStep[]
  status: "idle" | "running" | "success" | "error"
  errorMessage?: string
}
