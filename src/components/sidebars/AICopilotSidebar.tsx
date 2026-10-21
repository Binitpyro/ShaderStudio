import { useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useAISettingsStore } from "@/core/ai/aiSettingsStore"
import { useCopilotSessionStore } from "@/stores/copilotSessionStore"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import type { AIProvider } from "@/core/ai/types"
import { Badge, Button, Input, Label, Select, Switch, Textarea } from "@/components/ui"
import { CheckCircle2, AlertTriangle, RefreshCw, Settings2, Sparkles } from "lucide-react"
import { TipIconButton } from "@/components/layout/ShortcutTip"
import { SidebarFrame } from "./SidebarFrame"

const PRESET_PROMPTS = [
  { label: "Iridescent bubble", prompt: "An iridescent soap bubble with rainbow Fresnel rim lighting and subtle wave distortion" },
  { label: "Liquid gold", prompt: "Liquid molten gold with metallic sheen, reflective ripples and animated specular highlights" },
  { label: "Neon shield", prompt: "A glowing cyberpunk hexagonal forcefield with pulsating energy waves and edge bloom" },
  { label: "Cosmic nebula", prompt: "A deep space volumetric nebula with swirling purple and cyan dust clouds and twinkling stars" },
  { label: "Retro CRT", prompt: "A retro 80s arcade monitor effect with scanlines, chromatic aberration and subtle barrel curvature" },
]

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: "gemini", label: "Google Gemini (cloud)" },
  { value: "anthropic", label: "Anthropic Claude (cloud)" },
  { value: "openai", label: "OpenAI GPT-4o (cloud)" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "lmstudio", label: "LM Studio (local)" },
  { value: "custom", label: "Custom OpenAI-compatible endpoint" },
]

const KEY_PLACEHOLDER = { gemini: "AIzaSy...", anthropic: "sk-ant-...", openai: "sk-..." } as const
const ENDPOINT_PLACEHOLDER = { ollama: "http://localhost:11434", lmstudio: "http://localhost:1234", custom: "http://localhost:8080/v1" } as const
const MODEL_PLACEHOLDER = { ollama: "qwen2.5-coder:7b", lmstudio: "local-model", custom: "model-name" } as const

type KeyProvider = keyof typeof KEY_PLACEHOLDER
type EndpointProvider = keyof typeof ENDPOINT_PLACEHOLDER

/** The one Copilot surface (sidebar tab). Session state lives in copilotSessionStore so runs survive tab switches. */
export function AICopilotSidebar() {
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const focusNonce = useLayoutStore((s) => s.copilotFocusNonce)
  const ai = useAISettingsStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      apiKeys: s.apiKeys,
      endpoints: s.endpoints,
      models: s.models,
      visualCritique: s.visualCritique,
      rememberKeys: s.rememberKeys,
      keysMigrationNotice: s.keysMigrationNotice,
      dismissKeysMigrationNotice: s.dismissKeysMigrationNotice,
      setRememberKeys: s.setRememberKeys,
      setActiveProvider: s.setActiveProvider,
      setApiKey: s.setApiKey,
      setEndpoint: s.setEndpoint,
      setModel: s.setModel,
      setVisualCritique: s.setVisualCritique,
    })),
  )
  const { prompt, setPrompt, isRunning, currentSession, run: handleGenerate } = useCopilotSessionStore(
    useShallow((s) => ({ prompt: s.prompt, setPrompt: s.setPrompt, isRunning: s.isRunning, currentSession: s.currentSession, run: s.run })),
  )
  const [showSettings, setShowSettings] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // The top-bar Copilot button bumps the nonce: focus the prompt whenever it changes.
  useEffect(() => {
    if (focusNonce > 0) promptRef.current?.focus()
  }, [focusNonce])

  const handleTestConnection = async () => {
    setTestStatus("Testing...")
    try {
      const provider = ai.activeProvider
      if (provider === "ollama") {
        const res = await fetch(`${ai.endpoints.ollama.replace(/\/+$/, "")}/api/tags`)
        if (res.ok) {
          const data = await res.json()
          setTestStatus(`Ollama online (${data.models?.length || 0} local models available)`)
        } else setTestStatus(`Ollama responded with status ${res.status}`)
      } else if (provider === "lmstudio") {
        const res = await fetch(`${ai.endpoints.lmstudio.replace(/\/+$/, "")}/v1/models`)
        setTestStatus(res.ok ? "LM Studio local server connected" : `LM Studio returned status ${res.status}`)
      } else {
        setTestStatus("Provider configured")
      }
    } catch (e) {
      setTestStatus(`Connection failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const provider = ai.activeProvider
  const isKeyProvider = provider === "gemini" || provider === "anthropic" || provider === "openai"

  return (
    <SidebarFrame
      title="Copilot"
      className="flex flex-col gap-4 p-3"
      actions={
        <TipIconButton label="Provider settings" aria-pressed={showSettings} onClick={() => setShowSettings((v) => !v)} className={showSettings ? "bg-active text-fg" : undefined}>
          <Settings2 />
        </TipIconButton>
      }
    >
      {ai.keysMigrationNotice && (
        <div role="status" className="flex items-start justify-between gap-2 rounded-lg bg-raised p-3 text-xs text-fg-muted">
          <p>Saved API keys were cleared for security. Re-enter them and tick 'Remember keys on this device' to keep them.</p>
          <Button size="sm" variant="secondary" onClick={ai.dismissKeysMigrationNotice}>
            Dismiss
          </Button>
        </div>
      )}
      {showSettings && (
        <section aria-label="Provider settings" className="flex flex-col gap-3 rounded-lg bg-raised p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copilot-provider">Provider</Label>
            <Select id="copilot-provider" value={provider} onChange={(e) => ai.setActiveProvider(e.target.value as AIProvider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          {isKeyProvider && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copilot-key">API key</Label>
              <Input
                id="copilot-key"
                type="password"
                autoComplete="off"
                placeholder={KEY_PLACEHOLDER[provider as KeyProvider]}
                value={ai.apiKeys[provider as KeyProvider] || ""}
                onChange={(e) => ai.setApiKey(provider as KeyProvider, e.target.value)}
                className="font-mono"
              />
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="copilot-remember-keys">Remember keys on this device</Label>
                <Switch id="copilot-remember-keys" checked={ai.rememberKeys} onCheckedChange={ai.setRememberKeys} />
              </div>
            </div>
          )}

          {!isKeyProvider && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="copilot-endpoint">Endpoint URL</Label>
                <Input
                  id="copilot-endpoint"
                  placeholder={ENDPOINT_PLACEHOLDER[provider as EndpointProvider]}
                  value={ai.endpoints[provider as EndpointProvider]}
                  onChange={(e) => ai.setEndpoint(provider as EndpointProvider, e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="copilot-model">Model</Label>
                <Input
                  id="copilot-model"
                  placeholder={MODEL_PLACEHOLDER[provider as EndpointProvider]}
                  value={ai.models[provider as EndpointProvider]}
                  onChange={(e) => ai.setModel(provider as EndpointProvider, e.target.value)}
                  className="font-mono"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="copilot-critique">Visual critique</Label>
            <Switch id="copilot-critique" checked={ai.visualCritique} onCheckedChange={ai.setVisualCritique} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Button size="sm" variant="secondary" onClick={handleTestConnection}>
              Test connection
            </Button>
            {testStatus && (
              <p role="status" className="text-xs text-fg-muted">
                {testStatus}
              </p>
            )}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="copilot-prompt">Describe a shader</Label>
          <Badge>{activeBackend}</Badge>
        </div>
        <Textarea
          id="copilot-prompt"
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isRunning}
          rows={4}
          placeholder="Raymarched clouds, a glowing forcefield, a CRT scanline pass..."
          className="resize-none"
        />
        <Button onClick={() => handleGenerate()} disabled={isRunning || !prompt.trim()} className="w-full">
          {isRunning ? (
            <>
              <RefreshCw className="animate-spin" /> Generating...
            </>
          ) : (
            <>
              <Sparkles /> Generate shader
            </>
          )}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-fg-muted">Try one</h3>
        <div className="flex flex-wrap gap-1">
          {PRESET_PROMPTS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="secondary"
              disabled={isRunning}
              onClick={() => {
                setPrompt(p.prompt)
                handleGenerate(p.prompt)
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {currentSession && (
        <section aria-label="Generation progress" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-fg-muted">Generation steps</h3>
            <Badge tone={currentSession.status === "success" ? "success" : currentSession.status === "error" ? "danger" : "warning"}>
              {currentSession.status === "success" ? "Done" : currentSession.status === "error" ? "Failed" : "In progress"}
            </Badge>
          </div>
          <ol className="flex flex-col gap-2">
            {currentSession.steps.map((step) => (
              <li key={step.stepNumber} className="flex flex-col gap-1.5 rounded-lg bg-raised p-2.5 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-fg">
                  {step.status === "success" && <CheckCircle2 className="size-3.5 text-success" />}
                  {step.status === "running" && <RefreshCw className="size-3.5 animate-spin text-warning" />}
                  {step.status === "error" && <AlertTriangle className="size-3.5 text-danger" />}
                  <span>
                    Step <span className="num">{step.stepNumber}</span>: {step.type}
                  </span>
                </span>
                {step.description && <p className="text-fg-muted">{step.description}</p>}
                {step.screenshotBase64 && <img src={step.screenshotBase64} alt="Rendered preview" className="h-28 w-full rounded-md bg-canvas object-contain" />}
                {step.errorMessages && step.errorMessages.length > 0 && <p className="line-clamp-3 rounded-md bg-danger-soft p-1.5 font-mono text-2xs text-danger">{step.errorMessages.join(", ")}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </SidebarFrame>
  )
}
