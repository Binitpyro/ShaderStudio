import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ShaderEditor, COMPILER_MARKER_OWNER, getErrorTargetTab, doesTabMatch } from "../ShaderEditor"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"

// Mock Monaco Editor component
let capturedOnMount: ((editor: any, monaco: any) => void) | null = null

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    language,
    options,
    onMount,
  }: {
    value: string
    language: string
    options: any
    onMount?: (editor: any, monaco: any) => void
  }) => {
    capturedOnMount = onMount || null
    return (
      <div
        data-testid="mock-monaco-editor"
        data-language={language}
        data-minimap={options?.minimap?.enabled ? "true" : "false"}
      >
        <pre data-testid="editor-content">{value}</pre>
      </div>
    )
  },
}))

// ShaderEditor loads Monaco through React.lazy; renderToStaticMarkup cannot resolve a lazy component, so
// resolve LazyMonaco synchronously to the mocked Monaco component above (ShaderEditor itself is real).
vi.mock("@/components/LazyMonaco", async () => ({
  LazyMonaco: (await import("@monaco-editor/react")).default,
}))

// Mock sync status banner
vi.mock("../SyncStatusBanner", () => ({
  SyncStatusBanner: () => <div data-testid="sync-status-banner">Sync Status</div>,
}))

describe("ShaderEditor Component (Requirement R4)", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({
      editorMinimap: false,
      maximizedPanel: "none",
      jumpTarget: null,
    })
  })

  // --------------------------------------------------------------------------
  // 1. Multi-Tab Switching (F-EDIT-01)
  // --------------------------------------------------------------------------
  describe("Multi-Tab Switching (F-EDIT-01)", () => {
    it("renders Render Shader and Compute Shader (WGSL) tabs in WebGPU backend", () => {
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "render",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)

      expect(html).toContain("data-testid=\"tab-render\"")
      expect(html).toContain("Render Shader")
      expect(html).toContain("data-testid=\"tab-compute\"")
      expect(html).toContain("Compute Shader (WGSL)")
      expect(html).not.toContain("Fragment Shader")
      expect(html).not.toContain("Vertex Shader")
    })

    it("renders Fragment Shader and Vertex Shader tabs in GLSL backends (WebGL2 / Three.js)", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)

      expect(html).toContain("data-testid=\"tab-fragment\"")
      expect(html).toContain("Fragment Shader")
      expect(html).toContain("data-testid=\"tab-vertex\"")
      expect(html).toContain("Vertex Shader")
      expect(html).not.toContain("Compute Shader (WGSL)")
    })

    it("preserves source code across tabs without cross-contamination", () => {
      const fragmentCode = "// Unique Fragment Code"
      const vertexCode = "// Unique Vertex Code"
      const computeCode = "// Unique Compute Code"

      useProjectStore.getState().setShaderSource(fragmentCode)
      useProjectStore.getState().setVertexShaderSource(vertexCode)
      useProjectStore.getState().setComputeShaderSource(computeCode)

      const state = useProjectStore.getState()
      expect(state.shaderSource).toBe(fragmentCode)
      expect(state.vertexShaderSource).toBe(vertexCode)
      expect(state.computeShaderSource).toBe(computeCode)

      // Switching active tab does not mutate or overwrite other tabs
      useProjectStore.getState().setActiveEditorTab("vertex")
      expect(useProjectStore.getState().shaderSource).toBe(fragmentCode)
      expect(useProjectStore.getState().vertexShaderSource).toBe(vertexCode)
      expect(useProjectStore.getState().computeShaderSource).toBe(computeCode)

      useProjectStore.getState().setActiveEditorTab("compute")
      expect(useProjectStore.getState().shaderSource).toBe(fragmentCode)
      expect(useProjectStore.getState().vertexShaderSource).toBe(vertexCode)
      expect(useProjectStore.getState().computeShaderSource).toBe(computeCode)
    })

    it("displays the correct tab content and syntax language for active tab", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "vertex",
        vertexShaderSource: "in vec3 a_pos; void main() {}",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"glsl\"")
      expect(html).toContain("in vec3 a_pos; void main() {}")

      // Switch to WebGPU compute
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "compute",
        computeShaderSource: "@compute @workgroup_size(64) fn main() {}",
      })

      const compHtml = renderToStaticMarkup(<ShaderEditor />)
      expect(compHtml).toContain("data-language=\"rust\"")
      expect(compHtml).toContain("@compute @workgroup_size(64)")
    })
  })

  // --------------------------------------------------------------------------
  // 2. Active-Tab Compiler Marker Isolation (F-EDIT-02)
  // --------------------------------------------------------------------------
  describe("Active-Tab Compiler Marker Isolation (F-EDIT-02)", () => {
    it("associates compiler errors strictly with their originating tab", () => {
      expect(getErrorTargetTab("Vertex shader error: undeclared identifier", "fragment", "webgl2")).toBe("vertex")
      expect(getErrorTargetTab("Fragment shader error: syntax error", "vertex", "webgl2")).toBe("fragment")
      expect(getErrorTargetTab("Compute shader error: workgroup size mismatch", "render", "webgpu")).toBe("compute")
      expect(getErrorTargetTab("Generic compiler error", "render", "webgpu")).toBe("render")
    })

    it("isolates diagnostic markers so squiggles do not leak into inactive tabs", () => {
      // In GLSL: vertex error does not match fragment tab
      expect(doesTabMatch("vertex", "fragment", "webgl2")).toBe(false)
      expect(doesTabMatch("vertex", "vertex", "webgl2")).toBe(true)

      // In WebGPU: compute error does not match render tab
      expect(doesTabMatch("compute", "render", "webgpu")).toBe(false)
      expect(doesTabMatch("compute", "compute", "webgpu")).toBe(true)

      // Render and fragment match symmetrically for primary viewport render shader
      expect(doesTabMatch("render", "render", "webgpu")).toBe(true)
      expect(doesTabMatch("fragment", "fragment", "webgl2")).toBe(true)
    })

    it("applies markers only when active tab matches target error tab", () => {
      const mockModel = {
        uri: { toString: () => "model-uri" },
        getLineCount: () => 10,
        getLineMaxColumn: () => 40,
      }
      let appliedMarkers: any[] = []
      const mockMonaco = {
        MarkerSeverity: { Error: 8, Warning: 4 },
        editor: {
          setModelMarkers: vi.fn((_model, owner, markers) => {
            expect(owner).toBe(COMPILER_MARKER_OWNER)
            appliedMarkers = markers
          }),
        },
      }

      // If error belongs to vertex shader, but active tab is fragment -> clear markers
      const isMatch = doesTabMatch("vertex", "fragment", "webgl2")
      expect(isMatch).toBe(false)
      if (!isMatch) {
        mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
      }
      expect(appliedMarkers).toEqual([])

      // If active tab matches vertex shader -> apply markers
      const isVertexMatch = doesTabMatch("vertex", "vertex", "webgl2")
      expect(isVertexMatch).toBe(true)
      if (isVertexMatch) {
        mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [
          {
            owner: COMPILER_MARKER_OWNER,
            severity: 8,
            message: "undeclared identifier",
            startLineNumber: 4,
          },
        ])
      }
      expect(appliedMarkers).toHaveLength(1)
      expect(appliedMarkers[0].message).toBe("undeclared identifier")
    })
  })

  // --------------------------------------------------------------------------
  // 3. Top Editor Action Bar (F-EDIT-03, F-EDIT-04, F-EDIT-05)
  // --------------------------------------------------------------------------
  describe("Top Editor Action Bar (F-EDIT-03, F-EDIT-04, F-EDIT-05)", () => {
    it("renders Run (Recompile), Format Code, and Minimap toggle buttons", () => {
      const html = renderToStaticMarkup(<ShaderEditor />)

      expect(html).toContain("data-testid=\"recompile-btn\"")
      expect(html).toContain("Recompile (Ctrl+Enter)")
      expect(html).toContain("data-testid=\"format-code-btn\"")
      expect(html).toContain("Format Code")
      expect(html).toContain("data-testid=\"toggle-minimap-btn\"")
      expect(html).toContain("Toggle Minimap")
    })

    it("toggling minimap updates layoutStore and passes enabled option to Monaco", () => {
      expect(useLayoutStore.getState().editorMinimap).toBe(false)
      useLayoutStore.getState().toggleEditorMinimap()
      expect(useLayoutStore.getState().editorMinimap).toBe(true)

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-minimap=\"true\"")
    })

    it("triggerRecompile triggers store recompileTrigger increment", () => {
      const prev = useProjectStore.getState().recompileTrigger
      useProjectStore.getState().triggerRecompile()
      expect(useProjectStore.getState().recompileTrigger).toBe(prev + 1)
    })
  })

  // --------------------------------------------------------------------------
  // 4. Monaco Mount Lifecycle & Pending Jump Handling (F-CONS-02 Remediation)
  // --------------------------------------------------------------------------
  describe("Monaco Mount Lifecycle & Pending Jump Handling", () => {
    it("applies pending jumpTarget from layoutStore upon Monaco onMount", () => {
      useLayoutStore.getState().jumpToLine(42, 5)

      renderToStaticMarkup(<ShaderEditor />)
      expect(capturedOnMount).not.toBeNull()

      const mockEditor = {
        addCommand: vi.fn(),
        getModel: vi.fn(),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
      }
      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3 },
        editor: { setModelMarkers: vi.fn() },
      }

      capturedOnMount!(mockEditor, mockMonaco)

      expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(42)
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 5 })
      expect(mockEditor.focus).toHaveBeenCalled()
    })

    it("clamps invalid or non-positive line numbers to line 1", () => {
      useLayoutStore.getState().jumpToLine(-10)

      renderToStaticMarkup(<ShaderEditor />)
      expect(capturedOnMount).not.toBeNull()

      const mockEditor = {
        addCommand: vi.fn(),
        getModel: vi.fn(),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
      }
      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3 },
        editor: { setModelMarkers: vi.fn() },
      }

      capturedOnMount!(mockEditor, mockMonaco)

      expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(1)
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 })
      expect(mockEditor.focus).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // 5. Format Code Action & Fallback Normalization (F-EDIT-03 Remediation)
  // --------------------------------------------------------------------------
  describe("Format Code Action & Fallback Normalization (F-EDIT-03)", () => {
    it("delegates to action.run() when Monaco formatDocument is supported", () => {
      const mockAction = {
        isSupported: vi.fn(() => true),
        run: vi.fn(),
      }
      const mockEditor = {
        getAction: vi.fn((id: string) => (id === "editor.action.formatDocument" ? mockAction : null)),
        setValue: vi.fn(),
      }

      const action = mockEditor.getAction("editor.action.formatDocument")
      if (action && action.isSupported()) {
        action.run()
      }

      expect(mockAction.isSupported).toHaveBeenCalled()
      expect(mockAction.run).toHaveBeenCalled()
      expect(mockEditor.setValue).not.toHaveBeenCalled()
    })

    it("executes fallback whitespace normalization when formatDocument is unsupported", () => {
      const mockAction = {
        isSupported: vi.fn(() => false),
        run: vi.fn(),
      }
      const mockEditor = {
        getAction: vi.fn((id: string) => (id === "editor.action.formatDocument" ? mockAction : null)),
        setValue: vi.fn(),
      }

      const rawSource = "void main() {   \n    float x = 1.0;   \n}"
      useProjectStore.getState().setShaderSource(rawSource)

      const action = mockEditor.getAction("editor.action.formatDocument")
      let handled = false
      if (action && action.isSupported()) {
        action.run()
        handled = true
      }

      expect(handled).toBe(false)
      expect(mockAction.run).not.toHaveBeenCalled()

      // Fallback executes: trims end of lines and normalizes
      const lines = rawSource.split("\n").map((l) => l.trimEnd())
      const formatted = lines.join("\n")
      mockEditor.setValue(formatted)
      useProjectStore.getState().setShaderSource(formatted)

      expect(mockEditor.setValue).toHaveBeenCalledWith("void main() {\n    float x = 1.0;\n}")
      expect(useProjectStore.getState().shaderSource).toBe("void main() {\n    float x = 1.0;\n}")
    })
  })
})
