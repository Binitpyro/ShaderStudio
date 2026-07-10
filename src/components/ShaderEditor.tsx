import { useRef, useCallback } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { debounce } from "@/utils/throttle"
import { Button } from "@/components/ui/button"
import { SyncStatusBanner } from "./SyncStatusBanner"

export function ShaderEditor() {
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const syncMode = useFileSystemStore((state) => state.syncMode)
  const setSyncMode = useFileSystemStore((state) => state.setSyncMode)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const debouncedUpdate = useRef(debounce((value: string) => { setShaderSource(value); triggerRecompile() }, 400)).current
  const isReadOnly = syncMode === "bridge" || syncMode === "folder"

  const handleEditorMount = useCallback<OnMount>((editor) => { editorRef.current = editor }, [])
  const handleChange = useCallback((value: string | undefined) => { if (value !== undefined && !isReadOnly) debouncedUpdate(value) }, [isReadOnly, debouncedUpdate])

  const handleDetach = useCallback(() => { setSyncMode("local") }, [setSyncMode])

  // Determine language based on backend
  const language = activeBackend === "webgpu" ? "rust" : "glsl"

  // Default shader sources based on backend
  const defaultSource = activeBackend === "webgpu"
    ? `struct Uniforms { mvp: mat4x4<f32>, color: vec3<f32> }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@vertex fn vertex_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> { return uniforms.mvp * vec4<f32>(position, 1.0); }
@fragment fn fragment_main() -> @location(0) vec4<f32> { return vec4<f32>(uniforms.color, 1.0); }`
    : `#version 300 es
precision highp float;
uniform mat4 u_mvp;
uniform vec3 u_color;
in vec3 a_position;
void main() { gl_Position = u_mvp * vec4(a_position, 1.0); }
`
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Editor</span>
          <SyncStatusBanner />
        </div>
        {isReadOnly && <Button variant="ghost" size="sm" onClick={handleDetach} className="h-6 text-xs">Detach & edit</Button>}
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage={language}
          value={shaderSource || defaultSource}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: "line",
            selectOnLineNumbers: true,
            cursorBlinking: "smooth",
            smoothScrolling: true,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  )
}
