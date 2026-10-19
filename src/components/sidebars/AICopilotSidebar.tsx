import { useState } from "react"
import { useAISettingsStore } from "@/core/ai/aiSettingsStore"
import { runAIShaderGeneration } from "@/core/ai/aiAgentRunner"
import type { GenerationSession, IterationStep, AIProvider } from "@/core/ai/types"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useLayoutStore } from "@/stores/layoutStore"
import {
  Sparkles,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal,
  PanelLeftClose,
} from "lucide-react"

const PRESET_PROMPTS = [
  { label: "🔮 Iridescent Bubble", prompt: "An iridescent soap bubble with rainbow Fresnel rim lighting and subtle wave distortion" },
  { label: "🌊 Liquid Gold", prompt: "Liquid molten gold with metallic sheen, reflective ripples and animated specular highlights" },
  { label: "⚡ Neon Shield", prompt: "A glowing cyberpunk hexagonal forcefield with pulsating energy waves and edge bloom" },
  { label: "🪐 Cosmic Nebula", prompt: "A deep space volumetric nebula with swirling purple and cyan dust clouds and twinkling stars" },
  { label: "📺 Retro CRT", prompt: "A retro 80s arcade monitor effect with scanlines, chromatic aberration and subtle barrel curvature" },
]

export function AICopilotSidebar() {
  const aiSettings = useAISettingsStore()

  const [prompt, setPrompt] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [currentSession, setCurrentSession] = useState<GenerationSession | null>(null)

  const handleGenerate = async (customPrompt?: string) => {
    const textToRun = customPrompt || prompt
    if (!textToRun.trim() || isRunning) return

    setIsRunning(true)
    setCurrentSession(null)

    try {
      await runAIShaderGeneration(textToRun, aiSettings, {
        onStepUpdate: (step: IterationStep) => {
          setCurrentSession((prev) => {
            if (!prev) return null
            const updatedSteps = [...prev.steps]
            const index = updatedSteps.findIndex((s) => s.stepNumber === step.stepNumber)
            if (index !== -1) {
              updatedSteps[index] = step
            } else {
              updatedSteps.push(step)
            }
            return { ...prev, steps: updatedSteps }
          })
        },
        onComplete: (session: GenerationSession) => {
          setCurrentSession(session)
          setIsRunning(false)
        },
      })
    } catch {
      setIsRunning(false)
    }
  }

  const setLeftSidebarOpen = useLayoutStore((state) => state.setLeftSidebarOpen)

  return (
    <div className="flex h-full min-w-[240px] flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            AI Copilot
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
            className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
            title="AI Settings"
            aria-label="AI Settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <button
            type="button"
            onClick={() => setLeftSidebarOpen(false)}
            title="Close Sidebar (Ctrl+B)"
            aria-label="Close Sidebar"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Settings view */}
        {showSettings && (
          <div className="rounded-md border border-border bg-background/50 p-2.5 space-y-2 text-xs">
            <h4 className="font-semibold text-foreground">AI Configuration</h4>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Provider</Label>
              <select
                value={aiSettings.activeProvider}
                onChange={(e) => aiSettings.setActiveProvider(e.target.value as AIProvider)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
              >
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="lmstudio">LM Studio (Local)</option>
              </select>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label htmlFor="sidebar-autofix" className="text-[11px] text-muted-foreground">
                Visual Critique
              </Label>
              <Switch
                id="sidebar-autofix"
                checked={aiSettings.visualCritique}
                onCheckedChange={aiSettings.setVisualCritique}
              />
            </div>
          </div>
        )}

        {/* Prompt Input */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground">Shader Description</Label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe visual effects, raymarching, particles, or lighting..."
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-background p-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isRunning}
          />
          <Button
            size="sm"
            onClick={() => handleGenerate()}
            disabled={isRunning || !prompt.trim()}
            className="w-full h-7 text-xs font-medium gap-1.5 cursor-pointer"
          >
            {isRunning ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" /> Generate Shader
              </>
            )}
          </Button>
        </div>

        {/* Quick Presets */}
        <div className="space-y-1.5 pt-1 border-t border-border/60">
          <span className="text-[11px] font-medium text-muted-foreground">Preset Inspirations</span>
          <div className="flex flex-col gap-1">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setPrompt(p.prompt)
                  handleGenerate(p.prompt)
                }}
                disabled={isRunning}
                className="text-left rounded border border-border/40 bg-background/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer truncate"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Session Progress Steps */}
        {currentSession && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">Generation Steps</span>
              <span className="text-[11px] text-muted-foreground">
                {currentSession.status === "success" ? (
                  <span className="text-green-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Done
                  </span>
                ) : currentSession.status === "error" ? (
                  <span className="text-destructive font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Failed
                  </span>
                ) : (
                  <span className="text-primary font-medium flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" /> In Progress
                  </span>
                )}
              </span>
            </div>

            <div className="space-y-1.5">
              {currentSession.steps.map((step) => (
                <div
                  key={step.stepNumber}
                  className="rounded border border-border/50 bg-background/40 p-2 text-[11px] space-y-1"
                >
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-muted-foreground">Step {step.stepNumber}</span>
                    <span
                      className={
                        step.status === "success"
                          ? "text-green-400"
                          : step.status === "error"
                          ? "text-destructive"
                          : "text-primary"
                      }
                    >
                      {step.status}
                    </span>
                  </div>
                  {step.errorMessages && step.errorMessages.length > 0 && (
                    <div className="flex items-start gap-1 text-destructive font-mono text-[10px]">
                      <Terminal className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{step.errorMessages.join(", ")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
