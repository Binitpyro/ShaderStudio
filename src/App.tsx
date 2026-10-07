import { useProjectStore } from "@/stores/projectStore"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { connect } from "@/bridge/wsBridgeClient"
import { Toolbar } from "@/components/Toolbar"
import { ResizablePanels } from "@/components/panels/ResizablePanels"

import { useEffect } from "react"

function App() {
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const setParsedUniforms = useProjectStore((state) => state.setParsedUniforms)

  // Connect to bridge on mount
  useEffect(() => {
    connect()
  }, [])

  // Parse uniforms based on backend and shader source changes
  useEffect(() => {
    if (!shaderSource) return
    const uniforms = activeBackend === "webgpu" ? parseWgslUniforms(shaderSource) : parseGlslUniforms(shaderSource)
    if (uniforms.length > 0) {
      setParsedUniforms(uniforms)
    }
  }, [shaderSource, activeBackend, setParsedUniforms])

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
