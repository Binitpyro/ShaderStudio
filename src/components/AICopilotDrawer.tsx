import { useState } from "react"
import { useAISettingsStore } from "@/core/ai/aiSettingsStore"
import { useShallow } from "zustand/react/shallow"
import { useCopilotSessionStore } from "@/stores/copilotSessionStore"
import type { AIProvider } from "@/core/ai/types"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  Sparkles,
  Settings2,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Server,
  Zap,
} from "lucide-react"

const PRESET_PROMPTS = [
  { label: "🔮 Iridescent Bubble", prompt: "An iridescent soap bubble with rainbow Fresnel rim lighting and subtle wave distortion" },
  { label: "🌊 Liquid Gold", prompt: "Liquid molten gold with metallic sheen, reflective ripples and animated specular highlights" },
  { label: "⚡ Neon Shield", prompt: "A glowing cyberpunk hexagonal forcefield with pulsating energy waves and edge bloom" },
  { label: "🪐 Cosmic Nebula", prompt: "A deep space volumetric nebula with swirling purple and cyan dust clouds and twinkling stars" },
  { label: "📺 Retro CRT", prompt: "A retro 80s arcade monitor effect with scanlines, chromatic aberration and subtle barrel curvature" },
]

export function AICopilotDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const aiSettings = useAISettingsStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      apiKeys: s.apiKeys,
      endpoints: s.endpoints,
      models: s.models,
      visualCritique: s.visualCritique,
      setActiveProvider: s.setActiveProvider,
      setApiKey: s.setApiKey,
      setEndpoint: s.setEndpoint,
      setModel: s.setModel,
      setVisualCritique: s.setVisualCritique,
    }))
  )

  const { prompt, setPrompt, isRunning, currentSession, run: handleGenerate } = useCopilotSessionStore(
    useShallow((s) => ({ prompt: s.prompt, setPrompt: s.setPrompt, isRunning: s.isRunning, currentSession: s.currentSession, run: s.run }))
  )
  const [showSettings, setShowSettings] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  if (!isOpen) return null

  const handleTestConnection = async () => {
    setTestStatus("Testing...")
    try {
      const provider = aiSettings.activeProvider
      if (provider === "ollama") {
        const url = `${aiSettings.endpoints.ollama.replace(/\/+$/, "")}/api/tags`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          const modelCount = data.models?.length || 0
          setTestStatus(`✅ Ollama online (${modelCount} local models available)`)
        } else {
          setTestStatus(`⚠️ Ollama responded with status ${res.status}`)
        }
      } else if (provider === "lmstudio") {
        const url = `${aiSettings.endpoints.lmstudio.replace(/\/+$/, "")}/v1/models`
        const res = await fetch(url)
        if (res.ok) {
          setTestStatus("✅ LM Studio local server connected")
        } else {
          setTestStatus(`⚠️ LM Studio returned status ${res.status}`)
        }
      } else {
        setTestStatus("✅ Provider configured")
      }
    } catch (e: any) {
      setTestStatus(`❌ Connection failed: ${e.message}`)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-border bg-card shadow-2xl transition-all duration-200">
      {/* Top Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">AI Shader Copilot</h2>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary uppercase">
            {activeBackend}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Settings & Model Config"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4 space-y-4">
        {/* Settings Modal/Section */}
        {showSettings ? (
          <div className="rounded-lg border border-border bg-background p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-primary" /> Provider Configuration
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(false)}
                className="h-5 px-1.5 text-[10px]"
              >
                Close
              </Button>
            </div>

            {/* Provider Selector */}
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Active Model Provider</Label>
              <select
                value={aiSettings.activeProvider}
                onChange={(e) => aiSettings.setActiveProvider(e.target.value as AIProvider)}
                className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none"
              >
                <option value="gemini">Google Gemini (Cloud Vision)</option>
                <option value="anthropic">Anthropic Claude (Cloud Reasoning)</option>
                <option value="openai">OpenAI GPT-4o (Cloud)</option>
                <option value="ollama">🦙 Ollama (Local)</option>
                <option value="lmstudio">💻 LM Studio (Local)</option>
                <option value="custom">⚙️ Custom OpenAI-Compatible Endpoint</option>
              </select>
            </div>

            {/* Provider-Specific Settings */}
            {aiSettings.activeProvider === "gemini" && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Gemini API Key</Label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={aiSettings.apiKeys.gemini || ""}
                  onChange={(e) => aiSettings.setApiKey("gemini", e.target.value)}
                  className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                />
              </div>
            )}

            {aiSettings.activeProvider === "anthropic" && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Anthropic API Key</Label>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={aiSettings.apiKeys.anthropic || ""}
                  onChange={(e) => aiSettings.setApiKey("anthropic", e.target.value)}
                  className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                />
              </div>
            )}

            {aiSettings.activeProvider === "openai" && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">OpenAI API Key</Label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={aiSettings.apiKeys.openai || ""}
                  onChange={(e) => aiSettings.setApiKey("openai", e.target.value)}
                  className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                />
              </div>
            )}

            {aiSettings.activeProvider === "ollama" && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Ollama Endpoint URL</Label>
                  <input
                    type="text"
                    placeholder="http://localhost:11434"
                    value={aiSettings.endpoints.ollama}
                    onChange={(e) => aiSettings.setEndpoint("ollama", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Local Model Name</Label>
                  <input
                    type="text"
                    placeholder="qwen2.5-coder:7b"
                    value={aiSettings.models.ollama}
                    onChange={(e) => aiSettings.setModel("ollama", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {aiSettings.activeProvider === "lmstudio" && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">LM Studio Endpoint URL</Label>
                  <input
                    type="text"
                    placeholder="http://localhost:1234"
                    value={aiSettings.endpoints.lmstudio}
                    onChange={(e) => aiSettings.setEndpoint("lmstudio", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Model Name (or local-model)</Label>
                  <input
                    type="text"
                    placeholder="local-model"
                    value={aiSettings.models.lmstudio}
                    onChange={(e) => aiSettings.setModel("lmstudio", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {aiSettings.activeProvider === "custom" && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Base URL</Label>
                  <input
                    type="text"
                    placeholder="http://localhost:8080/v1"
                    value={aiSettings.endpoints.custom}
                    onChange={(e) => aiSettings.setEndpoint("custom", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Model Identifier</Label>
                  <input
                    type="text"
                    placeholder="model-name"
                    value={aiSettings.models.custom}
                    onChange={(e) => aiSettings.setModel("custom", e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {/* Loop Options */}
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Visual Critique Evaluation</Label>
                <Switch
                  checked={aiSettings.visualCritique}
                  onCheckedChange={aiSettings.setVisualCritique}
                />
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                className="w-full text-xs"
              >
                Test Connection
              </Button>
              {testStatus && <p className="mt-1 text-[11px] text-muted-foreground">{testStatus}</p>}
            </div>
          </div>
        ) : null}

        {/* Quick Presets */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            Quick Inspirations
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setPrompt(p.prompt)
                  handleGenerate(p.prompt)
                }}
                disabled={isRunning}
                className="rounded-full border border-border/80 bg-background/50 px-2.5 py-1 text-[11px] text-foreground hover:bg-accent hover:border-primary/50 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Input Box */}
        <div className="space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isRunning}
            placeholder={`Describe the 3D shader to generate in ${activeBackend.toUpperCase()}...`}
            rows={3}
            className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <Button
            onClick={() => handleGenerate()}
            disabled={isRunning || !prompt.trim()}
            className="w-full gap-2 text-xs"
          >
            {isRunning ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Iterating on GPU...
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                Generate & Visually Verify
              </>
            )}
          </Button>
        </div>

        {/* Iteration Progress & History */}
        {currentSession && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-primary" /> Closed-Loop Pipeline
              </span>
              <span
                className={cn(
                  "text-[10px] font-mono px-1.5 py-0.5 rounded",
                  currentSession.status === "running" && "bg-amber-500/10 text-amber-500",
                  currentSession.status === "success" && "bg-green-500/10 text-green-500",
                  currentSession.status === "error" && "bg-destructive/10 text-destructive"
                )}
              >
                {currentSession.status.toUpperCase()}
              </span>
            </div>

            {/* Steps list */}
            <div className="space-y-2">
              {currentSession.steps.map((step) => (
                <div
                  key={step.stepNumber}
                  className="rounded border border-border bg-background/60 p-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      {step.status === "success" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      {step.status === "running" && <RefreshCw className="h-3 w-3 text-amber-500 animate-spin" />}
                      {step.status === "error" && <AlertTriangle className="h-3 w-3 text-destructive" />}
                      Step {step.stepNumber}: {step.type}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{step.description}</p>

                  {/* Rendered frame snapshot preview */}
                  {step.screenshotBase64 && (
                    <div className="mt-1.5 overflow-hidden rounded border border-border/80 bg-black/40">
                      <img
                        src={step.screenshotBase64}
                        alt="Rendered Preview"
                        className="h-28 w-full object-contain"
                      />
                    </div>
                  )}

                  {/* Error messages if any */}
                  {step.errorMessages && step.errorMessages.length > 0 && (
                    <div className="rounded bg-destructive/10 p-1.5 text-[10px] font-mono text-destructive">
                      {step.errorMessages[0]}
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
