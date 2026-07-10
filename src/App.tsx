import { useProjectStore } from "@/stores/projectStore"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { connect } from "@/bridge/wsBridgeClient"
import { Toolbar } from "@/components/Toolbar"
import { ResizablePanels } from "@/components/panels/ResizablePanels"

function App() {
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const setParsedUniforms = useProjectStore((state) => state.setParsedUniforms)

  // Connect to bridge on mount
  if (typeof window !== "undefined") { connect() }

  // Parse uniforms based on backend
  if (shaderSource) {
    const uniforms = activeBackend === "webgpu" ? parseWgslUniforms(shaderSource) : parseGlslUniforms(shaderSource)
    if (uniforms.length > 0) setParsedUniforms(uniforms)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar />
      <main className="flex-1 overflow-hidden">
        <ResizablePanels />
      </main>
    </div>
  )
}

export default App
