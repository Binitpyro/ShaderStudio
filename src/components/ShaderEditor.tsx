import { useRef, useCallback, useEffect, Suspense } from "react"
import type { OnMount } from "@monaco-editor/react"
import { useProjectStore, languageForBackend, type EditorTab, type BackendType, type ShaderLanguage } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { debounce, type Debounced } from "@/utils/throttle"
import { renderCoordinator } from "@/core/renderCoordinator"
import { Button, IconButton, Tabs, TabsList, TabsTrigger } from "@/components/ui"
import { LazyMonaco as Editor } from "./LazyMonaco"
import { SyncStatusBanner } from "./SyncStatusBanner"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { getLoadedWebgpuAdapter } from "@/adapters/activeAdapter"
import { getComputePresetCode } from "@/core/computePresets"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import defaultComputeWgsl from "@/shaders/compute/default.compute.wgsl?raw"
import defaultVertSource from "@/shaders/default.vert?raw"
import defaultFragSource from "@/shaders/starter.frag?raw"
import starterWgslSource from "@/shaders/starter.wgsl?raw"
import { Play, AlignLeft, Map } from "lucide-react"

export const COMPILER_MARKER_OWNER = "shaderstudio-compiler"

const defaultWebGPUSource = starterWgslSource

export function getErrorTargetTab(
  error: string | null,
  activeTab: EditorTab,
  backend: BackendType
): EditorTab {
  if (!error) return activeTab
  const lower = error.toLowerCase()
  if (lower.includes("vertex shader") || lower.includes("vertex")) return "vertex"
  if (lower.includes("compute shader") || lower.includes("compute")) return "compute"
  if (lower.includes("fragment shader") || lower.includes("fragment")) {
    return backend === "webgpu" ? "render" : "fragment"
  }
  return activeTab
}

export function doesTabMatch(
  targetTab: EditorTab | null,
  currentTab: EditorTab,
  backend: BackendType
): boolean {
  if (!targetTab) return false
  if (targetTab === currentTab) return true
  if (backend === "webgpu") {
    if (
      (targetTab === "render" || targetTab === "fragment") &&
      (currentTab === "render" || currentTab === "fragment")
    ) {
      return true
    }
  } else {
    if (
      (targetTab === "render" || targetTab === "fragment") &&
      (currentTab === "fragment" || currentTab === "render")
    ) {
      return true
    }
  }
  return false
}

export function ShaderEditor() {
  const { resolvedTheme } = useTheme()
  const shaderSource = useProjectStore((state) => state.shaderSource)
  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const vertexShaderSource = useProjectStore((state) => state.vertexShaderSource)
  const setVertexShaderSource = useProjectStore((state) => state.setVertexShaderSource)
  const computeShaderSource = useProjectStore((state) => state.computeShaderSource)
  const setComputeShaderSource = useProjectStore((state) => state.setComputeShaderSource)
  const activeEditorTab = useProjectStore((state) => state.activeEditorTab)
  const setActiveEditorTab = useProjectStore((state) => state.setActiveEditorTab)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const lastCompileError = useProjectStore((state) => state.lastCompileError)

  const syncMode = useFileSystemStore((state) => state.syncMode)
  const setSyncMode = useFileSystemStore((state) => state.setSyncMode)

  const jumpTarget = useLayoutStore((state) => state.jumpTarget)
  const editorMinimap = useLayoutStore((state) => state.editorMinimap)
  const toggleEditorMinimap = useLayoutStore((state) => state.toggleEditorMinimap)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const lastErrorTabRef = useRef<EditorTab | null>(null)

  // What this editor last wrote to the store per tab. A store value that differs from it was written by
  // someone else (project / template / file load, bridge sync) -> any pending debounced edit is stale.
  const lastWrite = useRef<{ render?: string; vertex?: string; compute?: string }>({})

  // The language is captured when the keystroke happens, so a backend switch inside the debounce window
  // can never write WGSL text into the GLSL slot (or vice versa).
  // Lazy init: useRef(debounce(...)) would build (and discard) a new debounce closure on every render.
  const renderDebounceRef = useRef<Debounced<[string, ShaderLanguage]> | null>(null)
  if (!renderDebounceRef.current) {
    renderDebounceRef.current = debounce((value: string, language: ShaderLanguage) => {
      lastWrite.current.render = value
      setShaderSource(value, language)
      triggerRecompile()
    }, 400)
  }
  const debouncedRenderUpdate = renderDebounceRef.current

  const vertexDebounceRef = useRef<Debounced<[string]> | null>(null)
  if (!vertexDebounceRef.current) {
    vertexDebounceRef.current = debounce((value: string) => {
      lastWrite.current.vertex = value
      setVertexShaderSource(value)
      triggerRecompile()
    }, 400)
  }
  const debouncedVertexUpdate = vertexDebounceRef.current

  const computeDebounceRef = useRef<Debounced<[string]> | null>(null)
  if (!computeDebounceRef.current) {
    computeDebounceRef.current = debounce((value: string) => {
      lastWrite.current.compute = value
      setComputeShaderSource(value)
      getLoadedWebgpuAdapter()?.recompileComputeShader?.(value)
      // Called on the adapter directly (bypassing Viewport's redraw wrapper): wake an idle loop ourselves.
      renderCoordinator.requestRender()
      triggerRecompile()
    }, 400)
  }
  const debouncedComputeUpdate = computeDebounceRef.current

  const currentProjectName = useProjectStore((state) => state.currentProjectName)
  const activeShaderPath = useProjectStore((state) => state.activeShaderPath)

  // Project / active file changed: drop every pending write so it cannot clobber what was just loaded.
  useEffect(() => {
    debouncedRenderUpdate.cancel()
    debouncedVertexUpdate.cancel()
    debouncedComputeUpdate.cancel()
    lastWrite.current = {}
  }, [currentProjectName, activeShaderPath, debouncedRenderUpdate, debouncedVertexUpdate, debouncedComputeUpdate])

  // External source writes (template load, bridge, file importer): cancel the matching pending write.
  useEffect(() => {
    if (shaderSource !== lastWrite.current.render) debouncedRenderUpdate.cancel()
  }, [shaderSource, debouncedRenderUpdate])
  useEffect(() => {
    if (vertexShaderSource !== lastWrite.current.vertex) debouncedVertexUpdate.cancel()
  }, [vertexShaderSource, debouncedVertexUpdate])
  useEffect(() => {
    if (computeShaderSource !== lastWrite.current.compute) debouncedComputeUpdate.cancel()
  }, [computeShaderSource, debouncedComputeUpdate])

  // Closing the editor must not lose the last keystrokes.
  useEffect(
    () => () => {
      debouncedRenderUpdate.flush()
      debouncedVertexUpdate.flush()
      debouncedComputeUpdate.flush()
    },
    [debouncedRenderUpdate, debouncedVertexUpdate, debouncedComputeUpdate]
  )

  const isReadOnly = syncMode === "bridge" || syncMode === "folder"

  // Tab evaluation
  const isComputeTab = activeEditorTab === "compute"
  const isVertexTab = activeEditorTab === "vertex"

  // Determine language based on backend / tab
  const language = isComputeTab || activeBackend === "webgpu" ? "rust" : "glsl"

  // Active source resolution per tab without cross-contamination
  let activeValue = ""
  if (activeBackend === "webgpu") {
    if (isComputeTab) {
      activeValue = computeShaderSource || defaultComputeWgsl
    } else {
      activeValue = shaderSource || defaultWebGPUSource
    }
  } else {
    if (isVertexTab) {
      activeValue = vertexShaderSource || defaultVertSource
    } else {
      activeValue = shaderSource || defaultFragSource
    }
  }

  // Core marker application & clearance function (F-EDIT-02)
  const applyMarkers = useCallback(
    (error: string | null, tab: EditorTab) => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return

      const model = editor.getModel()
      if (!model) return

      const targetErrorTab =
        lastErrorTabRef.current || (error ? getErrorTargetTab(error, tab, activeBackend) : null)

      // If no error or error does not belong to the currently active tab, clear markers
      if (!error || !doesTabMatch(targetErrorTab, tab, activeBackend)) {
        monaco.editor.setModelMarkers(model, COMPILER_MARKER_OWNER, [])
        return
      }

      const rawLines = (error || "").split("\n").map((l) => l.trim()).filter(Boolean)
      const diagnostics = parseDiagnosticErrors(error)
      const lineCount = Math.max(1, model.getLineCount())

      const markers = diagnostics.map((diag, idx) => {
        const rawLine = diag.line ?? 1
        const line = Math.max(1, Math.min(rawLine, lineCount))
        const maxColumn = Math.max(1, model.getLineMaxColumn(line))

        let startColumn = 1
        let endColumn = maxColumn

        if (diag.column !== null && diag.column > 0) {
          startColumn = Math.min(Math.max(1, diag.column), maxColumn)
          endColumn = Math.min(Math.max(startColumn + 1, startColumn + 4), maxColumn)
        }

        const isWarning =
          diag.message.toLowerCase().includes("warning") ||
          (rawLines[idx]?.toLowerCase().includes("warning") ?? false)

        return {
          owner: COMPILER_MARKER_OWNER,
          resource: model.uri,
          severity: isWarning
            ? (monaco.MarkerSeverity?.Warning ?? 4)
            : (monaco.MarkerSeverity?.Error ?? 8),
          message: diag.message || "Shader compilation error",
          startLineNumber: line,
          startColumn,
          endLineNumber: line,
          endColumn,
          source: "Shader Compiler",
        }
      })

      monaco.editor.setModelMarkers(model, COMPILER_MARKER_OWNER, markers)
    },
    [activeBackend]
  )

  const handleEditorMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco

      // Register Ctrl+Enter / Cmd+Enter instant recompile shortcut (F-EDIT-05)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        useProjectStore.getState().triggerRecompile()
      })

      applyMarkers(
        useProjectStore.getState().lastCompileError,
        useProjectStore.getState().activeEditorTab
      )

      // Apply any pending jumpTarget that arrived while Viewport was maximized or editor was mounting (F-CONS-02)
      const pendingJump = useLayoutStore.getState().jumpTarget
      if (pendingJump && pendingJump.line) {
        const line = Math.max(1, Math.floor(pendingJump.line))
        const col = pendingJump.column ? Math.max(1, Math.floor(pendingJump.column)) : 1
        editor.revealLineInCenter(line)
        editor.setPosition({ lineNumber: line, column: col })
        editor.focus()
      }
    },
    [applyMarkers]
  )

  // Track error tab association: strictly records the tab where the compile error occurred
  useEffect(() => {
    if (lastCompileError) {
      lastErrorTabRef.current = getErrorTargetTab(lastCompileError, activeEditorTab, activeBackend)
    } else {
      lastErrorTabRef.current = null
    }
  }, [lastCompileError, activeEditorTab, activeBackend])

  // React to error and tab changes, isolating markers
  useEffect(() => {
    applyMarkers(lastCompileError, activeEditorTab)

    return () => {
      const model = editorRef.current?.getModel()
      const monaco = monacoRef.current
      if (model && monaco) {
        monaco.editor.setModelMarkers(model, COMPILER_MARKER_OWNER, [])
      }
    }
  }, [lastCompileError, activeEditorTab, applyMarkers])

  // Update Monaco editor minimap whenever editorMinimap option changes (F-EDIT-04)
  useEffect(() => {
    editorRef.current?.updateOptions({
      minimap: { enabled: editorMinimap },
    })
  }, [editorMinimap])

  // React to jumpTarget navigation from ConsoleDrawer (F-CONS-02)
  useEffect(() => {
    if (!jumpTarget || !jumpTarget.line || !editorRef.current) return
    const editor = editorRef.current
    const line = Math.max(1, Math.floor(jumpTarget.line))
    const col = jumpTarget.column ? Math.max(1, Math.floor(jumpTarget.column)) : 1
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: col })
    editor.focus()
  }, [jumpTarget])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined && !isReadOnly) {
        if (activeBackend === "webgpu") {
          if (isComputeTab) {
            debouncedComputeUpdate(value)
          } else {
            debouncedRenderUpdate(value, languageForBackend(activeBackend))
          }
        } else {
          if (isVertexTab) {
            debouncedVertexUpdate(value)
          } else {
            debouncedRenderUpdate(value, languageForBackend(activeBackend))
          }
        }
      }
    },
    [
      isReadOnly,
      activeBackend,
      isComputeTab,
      isVertexTab,
      debouncedComputeUpdate,
      debouncedRenderUpdate,
      debouncedVertexUpdate,
    ]
  )

  // Format Code document action (F-EDIT-03)
  const handleFormatCode = useCallback(() => {
    const editor = editorRef.current
    if (editor) {
      const action = editor.getAction("editor.action.formatDocument")
      if (action && action.isSupported()) {
        action.run()
        return
      }
    }

    // Fallback format: normalize whitespace and indents
    const lines = activeValue.split("\n").map((l) => l.trimEnd())
    const formatted = lines.join("\n")

    if (editor && typeof editor.setValue === "function") {
      editor.setValue(formatted)
    }

    if (activeBackend === "webgpu") {
      if (isComputeTab) {
        setComputeShaderSource(formatted)
      } else {
        setShaderSource(formatted)
      }
    } else {
      if (isVertexTab) {
        setVertexShaderSource(formatted)
      } else {
        setShaderSource(formatted)
      }
    }
  }, [
    activeValue,
    activeBackend,
    isComputeTab,
    isVertexTab,
    setComputeShaderSource,
    setVertexShaderSource,
    setShaderSource,
  ])

  const handleDetach = useCallback(() => {
    setSyncMode("local")
  }, [setSyncMode])

  useEffect(() => {
    const handleEdit = (e: CustomEvent) => {
      setActiveEditorTab("compute")
      if (e.detail?.customSource) {
        setComputeShaderSource(e.detail.customSource)
      } else if (!useProjectStore.getState().computeShaderSource) {
        const code = getComputePresetCode(e.detail?.preset || "curl_noise")
        setComputeShaderSource(code)
      }
    }
    document.addEventListener("editComputeShader", handleEdit as EventListener)
    return () => document.removeEventListener("editComputeShader", handleEdit as EventListener)
  }, [setComputeShaderSource, setActiveEditorTab])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-2">
        <div className="flex min-w-0 items-center gap-3">
          {activeBackend === "webgpu" ? (
            <Tabs value={isComputeTab ? "compute" : "render"} onValueChange={(v) => setActiveEditorTab(v as EditorTab)}>
              <TabsList className="h-9 border-b-0 px-0">
                <TabsTrigger value="render" data-testid="tab-render" onClick={() => setActiveEditorTab("render")}>Render Shader</TabsTrigger>
                <TabsTrigger value="compute" data-testid="tab-compute" onClick={() => setActiveEditorTab("compute")}>Compute Shader (WGSL)</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <Tabs value={isVertexTab ? "vertex" : "fragment"} onValueChange={(v) => setActiveEditorTab(v as EditorTab)}>
              <TabsList className="h-9 border-b-0 px-0">
                <TabsTrigger value="fragment" data-testid="tab-fragment" onClick={() => setActiveEditorTab("fragment")}>Fragment Shader</TabsTrigger>
                <TabsTrigger value="vertex" data-testid="tab-vertex" onClick={() => setActiveEditorTab("vertex")}>Vertex Shader</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <SyncStatusBanner />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {isReadOnly && (
            <Button variant="outline" size="sm" onClick={handleDetach} className="mr-1">Detach & edit</Button>
          )}
          <IconButton label="Recompile (Ctrl+Enter)" data-testid="recompile-btn" onClick={() => triggerRecompile()}>
            <Play className="fill-current text-brand-text" />
          </IconButton>
          <IconButton label="Format code" data-testid="format-code-btn" onClick={handleFormatCode}>
            <AlignLeft />
          </IconButton>
          <IconButton
            label={editorMinimap ? "Hide minimap" : "Show minimap"}
            data-testid="toggle-minimap-btn"
            aria-pressed={editorMinimap}
            onClick={toggleEditorMinimap}
            className={cn(editorMinimap && "bg-active text-fg")}
          >
            <Map />
          </IconButton>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={null}>
        <Editor
          height="100%"
          language={language}
          value={activeValue}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: editorMinimap },
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
        </Suspense>
      </div>
    </div>
  )
}
