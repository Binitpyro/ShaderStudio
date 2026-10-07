import { useState, useEffect } from "react"
import Editor from "@monaco-editor/react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/projectStore"
import { CUSTOM_WGSL_TEMPLATE, CUSTOM_GLSL_TEMPLATE } from "@/core/postProcessChain"

interface PostProcessDrawerProps {
  isOpen: boolean
  nodeId: string | null
  initialCode?: string
  onClose: () => void
  onSave: (nodeId: string, code: string) => void
}

export function PostProcessDrawer({
  isOpen,
  nodeId,
  initialCode,
  onClose,
  onSave,
}: PostProcessDrawerProps) {
  const activeBackend = useProjectStore((s) => s.activeBackend)
  const defaultTemplate = activeBackend === "webgpu" ? CUSTOM_WGSL_TEMPLATE : CUSTOM_GLSL_TEMPLATE
  const [code, setCode] = useState<string>(initialCode || defaultTemplate)

  useEffect(() => {
    setCode(initialCode || (activeBackend === "webgpu" ? CUSTOM_WGSL_TEMPLATE : CUSTOM_GLSL_TEMPLATE))
  }, [nodeId, initialCode, activeBackend])

  if (!isOpen || !nodeId) return null

  const handleReset = () => {
    const template = activeBackend === "webgpu" ? CUSTOM_WGSL_TEMPLATE : CUSTOM_GLSL_TEMPLATE
    setCode(template)
    onSave(nodeId, template)
  }

  const handleChange = (val: string | undefined) => {
    if (val !== undefined) {
      setCode(val)
      onSave(nodeId, val)
    }
  }

  const language = activeBackend === "webgpu" ? "rust" : "glsl"

  return (
    <div className="absolute top-12 right-4 z-50 w-[480px] h-[400px] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 bg-muted/40">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs font-semibold">Post-Process Shader</span>
          <span className="text-[10px] text-muted-foreground font-mono">({nodeId})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground">
            Reset Template
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
            ✕
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={handleChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "monospace",
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 6, bottom: 6 },
          }}
        />
      </div>
    </div>
  )
}
