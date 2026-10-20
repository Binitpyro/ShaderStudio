import { useState, useEffect, lazy, Suspense } from "react"
import { useProjectStore, type BackendType } from "@/stores/projectStore"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { connect } from "@/bridge/wsBridgeClient"
import { Toolbar } from "@/components/Toolbar"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

const AICopilotDrawer = lazy(() => import("@/components/AICopilotDrawer").then((m) => ({ default: m.AICopilotDrawer })))
const ExportModal = lazy(() => import("@/components/ExportModal").then((m) => ({ default: m.ExportModal })))
const TemplatesModal = lazy(() => import("@/components/TemplatesModal").then((m) => ({ default: m.TemplatesModal })))

/** Re-parse inspector uniforms for the active source. Always applies the result so a shader without uniforms clears the previous shader's. */
export function syncParsedUniforms(source: string, backend: BackendType) {
  const uniforms = !source ? [] : backend === "webgpu" ? parseWgslUniforms(source) : parseGlslUniforms(source)
  useProjectStore.getState().setParsedUniforms(uniforms)
}

function App() {
  const [isCopilotOpen, setIsCopilotOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false)
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const activeBackend = useProjectStore((state) => state.activeBackend)

  // Connect to bridge on mount
  useEffect(() => {
    connect()
  }, [])

  // Auto-load starter scene if project is empty on startup
  useEffect(() => {
    const state = useProjectStore.getState()
    if (!state.shaderSource && state._graphNodes.length === 0) {
      state.loadStarterScene()
    }
  }, [])

  // Autoplay procedural audio synth on first user window gesture
  useEffect(() => {
    let isCancelled = false
    const handleFirstInteraction = async () => {
      window.removeEventListener("pointerdown", handleFirstInteraction)
      window.removeEventListener("keydown", handleFirstInteraction)
      if (isCancelled) return

      const store = useProjectStore.getState()
      if (!store.isAudioPlaying) {
        try {
          const { audioEngine } = await import("@/audio/audioEngine")
          await audioEngine.play()
          store.setIsAudioPlaying(true)
        } catch (e) {
          console.warn("Audio autoplay on first gesture:", e)
        }
      }
    }

    window.addEventListener("pointerdown", handleFirstInteraction)
    window.addEventListener("keydown", handleFirstInteraction)

    return () => {
      isCancelled = true
      window.removeEventListener("pointerdown", handleFirstInteraction)
      window.removeEventListener("keydown", handleFirstInteraction)
    }
  }, [])

  // Parse uniforms based on backend and shader source changes
  useEffect(() => {
    syncParsedUniforms(shaderSource, activeBackend)
  }, [shaderSource, activeBackend])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground relative">
      <Toolbar
        isCopilotOpen={isCopilotOpen}
        onToggleCopilot={() => setIsCopilotOpen((prev) => !prev)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenTemplates={() => setIsTemplatesOpen(true)}
      />
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary
          fallbackTitle="Application Workspace Error"
          fallbackMessage="The workspace encountered an unexpected error. You can retry mounting the workspace below."
        >
          <WorkspaceLayout />
        </ErrorBoundary>
      </main>
      <Suspense fallback={null}>
        <AICopilotDrawer
          isOpen={isCopilotOpen}
          onClose={() => setIsCopilotOpen(false)}
        />
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
        />
        <TemplatesModal
          isOpen={isTemplatesOpen}
          onClose={() => setIsTemplatesOpen(false)}
        />
      </Suspense>
    </div>
  )
}

export default App
