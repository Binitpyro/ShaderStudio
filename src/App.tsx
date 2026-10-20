import { useState, useEffect, lazy, Suspense } from "react"
import { useProjectStore, type BackendType } from "@/stores/projectStore"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { connect } from "@/bridge/wsBridgeClient"
import { Toolbar } from "@/components/Toolbar"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

const ExportModal = lazy(() => import("@/components/ExportModal").then((m) => ({ default: m.ExportModal })))

/** Re-parse inspector uniforms for the active source. Always applies the result so a shader without uniforms clears the previous shader's. */
export function syncParsedUniforms(source: string, backend: BackendType) {
  const uniforms = !source ? [] : backend === "webgpu" ? parseWgslUniforms(source) : parseGlslUniforms(source)
  useProjectStore.getState().setParsedUniforms(uniforms)
}

function App() {
  const [isExportOpen, setIsExportOpen] = useState(false)
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
    <div className="relative flex h-screen flex-col overflow-hidden bg-canvas text-fg">
      <Toolbar onOpenExport={() => setIsExportOpen(true)} />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary
          fallbackTitle="Workspace error"
          fallbackMessage="The workspace encountered an unexpected error. You can retry mounting the workspace below."
        >
          <WorkspaceLayout />
        </ErrorBoundary>
      </main>
      {/* Mounted only while open so their chunks load on demand. */}
      <Suspense fallback={null}>
        {isExportOpen && <ExportModal isOpen onClose={() => setIsExportOpen(false)} />}
      </Suspense>
    </div>
  )
}

export default App
