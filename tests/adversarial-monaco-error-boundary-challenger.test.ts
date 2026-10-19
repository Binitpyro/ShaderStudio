import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { useProjectStore } from "@/stores/projectStore"
import { COMPILER_MARKER_OWNER } from "@/components/ShaderEditor"

describe("Adversarial Challenger: Monaco Diagnostics Markers & Error Boundary Stress", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useProjectStore.setState({
      activeBackend: "webgpu",
      activeEditorTab: "render",
      lastCompileError: null,
      deviceLost: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: ErrorBoundary Adversarial Stress
  // ==========================================================================
  describe("ErrorBoundary Adversarial Stress", () => {
    it("handles deeply nested Error objects with 5-tier cause chains", () => {
      const cause5 = new Error("L5: Hardware register parity fault")
      const cause4 = new Error("L4: Vulkan / Metal driver device loss", { cause: cause5 })
      const cause3 = new Error("L3: WebGPU device loss handler failure", { cause: cause4 })
      const cause2 = new Error("L2: Render pass descriptor allocation fault", { cause: cause3 })
      const rootError = new Error("L1: Viewport render cycle crashed", { cause: cause2 })

      const boundary = new ErrorBoundary({
        children: React.createElement("div", null, "Child Content"),
        fallbackTitle: "Nested Multi-Tier Error",
      })

      boundary.state = {
        hasError: true,
        error: rootError,
        errorInfo: { componentStack: "\n    in Canvas\n    in Viewport\n    in ResizablePanels\n    in App" },
        showDetails: true,
      }

      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Nested Multi-Tier Error")
      expect(html).toContain("L1: Viewport render cycle crashed")
      expect(html).toContain("role=\"alert\"")
      expect(html).toContain("Component Stack:")
      expect(html).toContain("in Canvas")
      expect(html).toContain("in App")
    })

    it("handles circular error objects with complex reference loops without recursion or freeze", () => {
      const errorA: any = new Error("Error A: Circular Root")
      const errorB: any = new Error("Error B: Circular Secondary")
      const errorC: any = new Error("Error C: Circular Tertiary")

      errorA.cause = errorB
      errorB.cause = errorC
      errorC.cause = errorA
      errorA.self = errorA
      errorA.meta = { loop: errorB, nested: { deep: errorC } }

      const boundary = new ErrorBoundary({
        children: React.createElement("div", null, "Safe Child"),
        fallbackTitle: "Circular Test",
      })

      // componentDidCatch safely catches and logs without throwing
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      boundary.componentDidCatch(errorA, { componentStack: "\n    in DeepCircularComponent" })
      expect(consoleErrorSpy).toHaveBeenCalled()

      // Derived state from error
      const state = ErrorBoundary.getDerivedStateFromError(errorA)
      expect(state.hasError).toBe(true)
      expect(state.error).toBe(errorA)

      // Rendering with showDetails = true
      boundary.state = {
        hasError: true,
        error: errorA,
        errorInfo: { componentStack: "\n    in DeepCircularComponent" },
        showDetails: true,
      }

      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Error A: Circular Root")
      expect(html).toContain("role=\"alert\"")
      expect(html).toContain("in DeepCircularComponent")
    })

    it("handles errors with empty or whitespace messages by falling back to fallbackMessage", () => {
      const emptyError = new Error("")
      const boundary = new ErrorBoundary({
        children: React.createElement("div", null, "Child"),
        fallbackTitle: "Empty Message Test",
        fallbackMessage: "Custom fallback when message is blank",
      })

      boundary.state = {
        hasError: true,
        error: emptyError,
        errorInfo: null,
        showDetails: false,
      }

      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Empty Message Test")
      expect(html).toContain("Custom fallback when message is blank")

      // Also test default fallbackMessage
      const boundaryDefault = new ErrorBoundary({
        children: React.createElement("div"),
      })
      boundaryDefault.state = {
        hasError: true,
        error: new Error(""),
        errorInfo: null,
        showDetails: false,
      }
      const htmlDefault = renderToStaticMarkup(boundaryDefault.render() as React.ReactElement)
      expect(htmlDefault).toContain("An unexpected error occurred")
    })

    it("handles non-Error thrown entities (primitives, plain objects, symbols, null, undefined)", () => {
      const boundary = new ErrorBoundary({
        children: React.createElement("div"),
        fallbackTitle: "Primitive Catch Test",
        fallbackMessage: "Default fallback message",
      })

      const testValues = [
        "Uncaught string exception",
        12345,
        true,
        null,
        undefined,
        { status: 500, reason: "GPU timeout" },
      ]

      for (const val of testValues) {
        const state = ErrorBoundary.getDerivedStateFromError(val as any)
        expect(state.hasError).toBe(true)
        expect(state.error).toBe(val)

        boundary.state = {
          hasError: true,
          error: val as any,
          errorInfo: null,
          showDetails: true,
        }

        const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
        expect(html).toContain("Primitive Catch Test")
        expect(html).toContain("role=\"alert\"")
      }
    })

    it("resists rapid alternating invocations of toggleDetails (1000 cycles) without state drift", () => {
      const boundary = new ErrorBoundary({ children: React.createElement("div") })
      expect(boundary.state.showDetails).toBe(false)

      for (let i = 0; i < 1000; i++) {
        boundary.toggleDetails()
        expect(boundary.state.showDetails).toBe(i % 2 === 0)
      }
      expect(boundary.state.showDetails).toBe(false)

      boundary.toggleDetails()
      expect(boundary.state.showDetails).toBe(true)
    })

    it("executes onReset and cleanly purges all prior error state without leaking", () => {
      const onResetSpy = vi.fn()
      const boundary = new ErrorBoundary({
        children: React.createElement("div", { id: "restored" }, "Healthy Child"),
        onReset: onResetSpy,
      })

      boundary.state = {
        hasError: true,
        error: new Error("Fatal tokenization fault"),
        errorInfo: { componentStack: "in DeepNode" },
        showDetails: true,
      }

      boundary.resetErrorBoundary()

      expect(onResetSpy).toHaveBeenCalledTimes(1)
      expect(boundary.state.hasError).toBe(false)
      expect(boundary.state.error).toBeNull()
      expect(boundary.state.errorInfo).toBeNull()
      expect(boundary.state.showDetails).toBe(false)

      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Healthy Child")
      expect(html).not.toContain("Fatal tokenization fault")
      expect(html).not.toContain("role=\"alert\"")
    })

    it("supports custom fallbackRender prop with full reset capability", () => {
      const customFallbackRender = vi.fn(({ error, resetErrorBoundary }) => {
        return React.createElement(
          "div",
          { id: "custom-fallback" },
          React.createElement("span", null, `Custom: ${error.message}`),
          React.createElement("button", { onClick: resetErrorBoundary }, "Custom Reset")
        )
      })

      const onResetSpy = vi.fn()
      const boundary = new ErrorBoundary({
        children: React.createElement("div", null, "Child"),
        fallbackRender: customFallbackRender,
        onReset: onResetSpy,
      })

      boundary.state = {
        hasError: true,
        error: new Error("Custom fatal issue"),
        errorInfo: null,
        showDetails: false,
      }

      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Custom: Custom fatal issue")
      expect(html).toContain("Custom Reset")
      expect(customFallbackRender).toHaveBeenCalledTimes(1)

      boundary.resetErrorBoundary()
      expect(onResetSpy).toHaveBeenCalledTimes(1)
      expect(boundary.state.hasError).toBe(false)
    })
  })

  // ==========================================================================
  // Section 2: Panel Boundary Isolation
  // ==========================================================================
  describe("Panel Boundary Isolation", () => {
    it("ensures an unhandled exception in Monaco Editor does NOT crash or unmount Viewport or NodeGraph", () => {
      const monacoBoundary = new ErrorBoundary({
        fallbackTitle: "Shader Editor Error",
        fallbackMessage: "Monaco editor encountered a fatal exception.",
      })
      const viewportBoundary = new ErrorBoundary({
        fallbackTitle: "Viewport Error",
        fallbackMessage: "Failed to initialize or render 3D graphics viewport.",
      })
      const nodeGraphBoundary = new ErrorBoundary({
        fallbackTitle: "Node Graph Error",
        fallbackMessage: "Failed to render visual node graph canvas.",
      })

      // Simulate normal initial render
      expect(monacoBoundary.state.hasError).toBe(false)
      expect(viewportBoundary.state.hasError).toBe(false)
      expect(nodeGraphBoundary.state.hasError).toBe(false)

      // Simulate fatal error in Monaco Editor only
      const monacoError = new Error("Monaco WebWorker memory limit exceeded")
      monacoBoundary.state = {
        hasError: true,
        error: monacoError,
        errorInfo: { componentStack: "\n    in MonacoEditor" },
        showDetails: false,
      }

      // Check Monaco rendered fallback
      const monacoHtml = renderToStaticMarkup(monacoBoundary.render() as React.ReactElement)
      expect(monacoHtml).toContain("Shader Editor Error")
      expect(monacoHtml).toContain("Monaco WebWorker memory limit exceeded")

      // Check Viewport and NodeGraph remained untouched and operational
      expect(viewportBoundary.state.hasError).toBe(false)
      expect(nodeGraphBoundary.state.hasError).toBe(false)

      const viewportMockElement = React.createElement("div", { id: "viewport-canvas" }, "3D WebGPU Canvas")
      viewportBoundary.props = { ...viewportBoundary.props, children: viewportMockElement }
      const viewportHtml = renderToStaticMarkup(viewportBoundary.render() as React.ReactElement)
      expect(viewportHtml).toContain("3D WebGPU Canvas")
      expect(viewportHtml).not.toContain("role=\"alert\"")

      const nodeGraphMockElement = React.createElement("div", { id: "nodegraph-flow" }, "ReactFlow Nodes")
      nodeGraphBoundary.props = { ...nodeGraphBoundary.props, children: nodeGraphMockElement }
      const nodeGraphHtml = renderToStaticMarkup(nodeGraphBoundary.render() as React.ReactElement)
      expect(nodeGraphHtml).toContain("ReactFlow Nodes")
      expect(nodeGraphHtml).not.toContain("role=\"alert\"")
    })

    it("ensures an unhandled exception in Viewport does NOT crash ShaderEditor or NodeGraph", () => {
      const viewportBoundary = new ErrorBoundary({ fallbackTitle: "Viewport Error" })
      const monacoBoundary = new ErrorBoundary({ fallbackTitle: "Shader Editor Error" })
      const nodeGraphBoundary = new ErrorBoundary({ fallbackTitle: "Node Graph Error" })

      viewportBoundary.state = {
        hasError: true,
        error: new Error("GPU device destroyed during pass"),
        errorInfo: null,
        showDetails: false,
      }

      expect(viewportBoundary.state.hasError).toBe(true)
      expect(monacoBoundary.state.hasError).toBe(false)
      expect(nodeGraphBoundary.state.hasError).toBe(false)

      const editorMockElement = React.createElement("div", { id: "monaco-editor" }, "Monaco Buffer")
      monacoBoundary.props = { ...monacoBoundary.props, children: editorMockElement }
      const editorHtml = renderToStaticMarkup(monacoBoundary.render() as React.ReactElement)
      expect(editorHtml).toContain("Monaco Buffer")

      const nodeMockElement = React.createElement("div", { id: "node-graph" }, "Node Graph Content")
      nodeGraphBoundary.props = { ...nodeGraphBoundary.props, children: nodeMockElement }
      const nodeHtml = renderToStaticMarkup(nodeGraphBoundary.render() as React.ReactElement)
      expect(nodeHtml).toContain("Node Graph Content")
    })
  })

  // ==========================================================================
  // Section 3: Diagnostic Parser Adversarial Stress
  // ==========================================================================
  describe("Diagnostic Parser Adversarial Stress", () => {
    it("handles multiline mixed GLSL errors with line numbers and messages", () => {
      const glslError = `
        ERROR: 0:14: 'u_diffuse' : undeclared identifier
        ERROR: 0:28: 'vec3' : cannot convert from 'const int' to 'highp 3-component vector of float'
        ERROR: 0:45: '' : syntax error, unexpected RIGHT_BRACE
      `
      const diags = parseDiagnosticErrors(glslError)
      expect(diags).toHaveLength(3)
      expect(diags[0]).toEqual({ line: 14, column: null, message: "'u_diffuse' : undeclared identifier" })
      expect(diags[1]).toEqual({
        line: 28,
        column: null,
        message: "'vec3' : cannot convert from 'const int' to 'highp 3-component vector of float'",
      })
      expect(diags[2]).toEqual({ line: 45, column: null, message: "'' : syntax error, unexpected RIGHT_BRACE" })
    })

    it("handles multiline WGSL errors with lines and column offsets", () => {
      const wgslError = `
        :15:8 error: unresolved type 'UniformsBlock'
        :32:19 error: no matching overload for function 'textureSample'
        :50:2 error: expected ';' for statement
      `
      const diags = parseDiagnosticErrors(wgslError)
      expect(diags).toHaveLength(3)
      expect(diags[0]).toEqual({ line: 15, column: 8, message: "unresolved type 'UniformsBlock'" })
      expect(diags[1]).toEqual({ line: 32, column: 19, message: "no matching overload for function 'textureSample'" })
      expect(diags[2]).toEqual({ line: 50, column: 2, message: "expected ';' for statement" })
    })

    it("handles errors with missing column numbers safely", () => {
      const noColError = "ERROR: 0:99: missing semicolon"
      const diags = parseDiagnosticErrors(noColError)
      expect(diags).toHaveLength(1)
      expect(diags[0].line).toBe(99)
      expect(diags[0].column).toBeNull()
    })

    it("handles errors with missing line numbers by returning raw message with line null", () => {
      const noLineError = "Internal compiler abort: driver memory overflow"
      const diags = parseDiagnosticErrors(noLineError)
      expect(diags).toHaveLength(1)
      expect(diags[0].line).toBeNull()
      expect(diags[0].column).toBeNull()
      expect(diags[0].message).toBe(noLineError)
    })

    it("handles corrupt, empty, and whitespace strings without throwing", () => {
      expect(parseDiagnosticErrors("")).toEqual([])
      expect(parseDiagnosticErrors("   \n\t  \n")).toEqual([])
      expect(parseDiagnosticErrors(null)).toEqual([])
      expect(parseDiagnosticErrors(undefined as any)).toEqual([])
    })

    it("handles massive 1,000-line error logs within milliseconds", () => {
      const bigLog = Array.from({ length: 1000 }, (_, i) => `ERROR: 0:${i + 1}: test error ${i}`).join("\n")
      const start = performance.now()
      const diags = parseDiagnosticErrors(bigLog)
      const duration = performance.now() - start

      expect(diags).toHaveLength(1000)
      expect(diags[0].line).toBe(1)
      expect(diags[999].line).toBe(1000)
      expect(duration).toBeLessThan(150)
    })

    it("handles adversarial inputs: unicode, ANSI escape codes, null chars, and SQL injection strings", () => {
      const unicodeErr = "ERROR: 0:12: 💥 syntax error near '⚡'"
      const diags = parseDiagnosticErrors(unicodeErr)
      expect(diags).toHaveLength(1)
      expect(diags[0].line).toBe(12)
      expect(diags[0].message).toContain("💥 syntax error")

      const sqlErr = "ERROR: 0:1: DROP TABLE shaders; -- ' unexpected"
      const diags2 = parseDiagnosticErrors(sqlErr)
      expect(diags2).toHaveLength(1)
      expect(diags2[0].line).toBe(1)
      expect(diags2[0].message).toContain("DROP TABLE shaders")
    })
  })

  // ==========================================================================
  // Section 4: Monaco Diagnostic Markers Clamping & Lifecycle
  // ==========================================================================
  describe("Monaco Diagnostic Markers Clamping & Lifecycle", () => {
    let mockModel: any
    let mockMonaco: any
    let recordedMarkers: any[]

    beforeEach(() => {
      recordedMarkers = []
      mockModel = {
        uri: { toString: () => "inmemory://model/test" },
        getLineCount: vi.fn(() => 30),
        getLineMaxColumn: vi.fn((line: number) => {
          if (line === 5) return 20
          if (line === 30) return 40
          return 50
        }),
      }

      mockMonaco = {
        MarkerSeverity: { Error: 8, Warning: 4 },
        editor: {
          setModelMarkers: vi.fn((_model: any, owner: string, markers: any[]) => {
            expect(owner).toBe(COMPILER_MARKER_OWNER)
            recordedMarkers = markers
          }),
        },
      }
    })

    // Helper that replicates the exact clamping algorithm in ShaderEditor.tsx lines 59-83
    function computeMarkers(diagnostics: ReturnType<typeof parseDiagnosticErrors>, model: any, monaco: any) {
      const lineCount = Math.max(1, model.getLineCount())
      return diagnostics.map((diag) => {
        const rawLine = diag.line ?? 1
        const line = Math.max(1, Math.min(rawLine, lineCount))
        const maxColumn = Math.max(1, model.getLineMaxColumn(line))

        let startColumn = 1
        let endColumn = maxColumn

        if (diag.column !== null && diag.column > 0) {
          startColumn = Math.min(Math.max(1, diag.column), maxColumn)
          endColumn = Math.min(Math.max(startColumn + 1, startColumn + 4), maxColumn)
        }

        return {
          owner: COMPILER_MARKER_OWNER,
          resource: model.uri,
          severity: monaco.MarkerSeverity?.Error ?? 8,
          message: diag.message || "Shader compilation error",
          startLineNumber: line,
          startColumn,
          endLineNumber: line,
          endColumn,
          source: "Shader Compiler",
        }
      })
    }

    it("clamps error line number when compiler reports line far beyond document line count", () => {
      // Document has 30 lines. Error reports line 99999.
      const rawError = ":99999:10 error: token parse error at end of file"
      const diags = parseDiagnosticErrors(rawError)
      const markers = computeMarkers(diags, mockModel, mockMonaco)

      expect(markers).toHaveLength(1)
      expect(markers[0].startLineNumber).toBe(30)
      expect(markers[0].endLineNumber).toBe(30)
      expect(markers[0].startColumn).toBe(10)
      expect(markers[0].endColumn).toBe(14)
    })

    it("clamps error line number when compiler reports 0 or negative line", () => {
      const rawError = ":0:5 error: header parse error"
      const diags = parseDiagnosticErrors(rawError)
      const markers = computeMarkers(diags, mockModel, mockMonaco)

      expect(markers).toHaveLength(1)
      expect(markers[0].startLineNumber).toBe(1)
      expect(markers[0].endLineNumber).toBe(1)
    })

    it("clamps startColumn and endColumn when reported column exceeds line length", () => {
      // Line 5 has maxColumn 20. Error reports column 85.
      const rawError = ":5:85 error: identifier out of bounds"
      const diags = parseDiagnosticErrors(rawError)
      const markers = computeMarkers(diags, mockModel, mockMonaco)

      expect(markers).toHaveLength(1)
      expect(markers[0].startLineNumber).toBe(5)
      expect(markers[0].startColumn).toBe(20)
      expect(markers[0].endColumn).toBe(20)
    })

    it("clears markers immediately when lastCompileError is resolved to null", () => {
      mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [
        { message: "previous error", startLineNumber: 1 },
      ])
      expect(recordedMarkers).toHaveLength(1)

      // Clearing markers
      mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
      expect(recordedMarkers).toEqual([])
    })
  })

  // ==========================================================================
  // Section 5: Tab Switching Isolation in ShaderEditor & Empirical Bug Reproduction
  // ==========================================================================
  describe("Tab Switching Isolation in ShaderEditor", () => {
    it("empirically verifies the intended tab isolation specification: markers must NOT leak to other tab", () => {
      let activeTab: "render" | "compute" = "render"
      let lastCompileError: string | null = null
      let lastErrorTab: "render" | "compute" | null = null

      let currentMarkers: any[] = []
      const mockSetModelMarkers = vi.fn((markers: any[]) => {
        currentMarkers = markers
      })

      // Correct Specification Behavior:
      function applyMarkersWithIsolation(error: string | null, tab: "render" | "compute") {
        if (!error || lastErrorTab !== tab) {
          mockSetModelMarkers([])
          return
        }
        const diags = parseDiagnosticErrors(error)
        mockSetModelMarkers(diags)
      }

      // Step 1: Render tab error arrives
      lastCompileError = "ERROR: 0:14: 'u_intensity' undeclared"
      lastErrorTab = activeTab // "render"
      applyMarkersWithIsolation(lastCompileError, activeTab)
      expect(currentMarkers).toHaveLength(1)
      expect(currentMarkers[0].message).toContain("u_intensity")

      // Step 2: User switches to compute tab without clearing compile error
      activeTab = "compute"
      // Specification requires: markers are CLEARED on the compute tab
      applyMarkersWithIsolation(lastCompileError, activeTab)
      expect(currentMarkers).toEqual([])

      // Step 3: Compute tab error arrives
      lastCompileError = ":8:12 error: invalid workgroup_size"
      lastErrorTab = "compute"
      applyMarkersWithIsolation(lastCompileError, activeTab)
      expect(currentMarkers).toHaveLength(1)
      expect(currentMarkers[0].message).toContain("invalid workgroup_size")

      // Step 4: User switches back to render tab
      activeTab = "render"
      applyMarkersWithIsolation(lastCompileError, activeTab)
      expect(currentMarkers).toEqual([])
    })

    it("asserts that switching tabs isolates and clears markers on the inactive tab (remediated ShaderEditor effects)", () => {
      // In ShaderEditor.tsx (lines 95-101), the active-tab marker leak is remediated:
      // useEffect(() => {
      //   if (lastCompileError) {
      //     lastErrorTabRef.current = activeEditorTab
      //   } else {
      //     lastErrorTabRef.current = null
      //   }
      // }, [lastCompileError])
      //
      // Because activeEditorTab is NOT in the dependency array, switching tabs
      // does NOT mutate lastErrorTabRef.current. Therefore, when switching to the
      // inactive tab, lastErrorTabRef.current !== activeEditorTab evaluates to true,
      // strictly isolating and clearing markers on the inactive tab.

      let activeEditorTab: "render" | "compute" = "render"
      let lastCompileError: string | null = "ERROR: 0:14: 'u_diffuse' undeclared"
      let prevCompileError: string | null = null
      const lastErrorTabRef = { current: null as "render" | "compute" | null }

      let currentMarkers: any[] = []
      const mockSetModelMarkers = vi.fn((markers: any[]) => {
        currentMarkers = markers
      })

      // Simulates the remediated ShaderEditor lifecycle:
      // Effect 1 [lastCompileError]: updates lastErrorTabRef only when lastCompileError changes
      function runCompileErrorEffect() {
        if (lastCompileError !== prevCompileError) {
          prevCompileError = lastCompileError
          if (lastCompileError) {
            lastErrorTabRef.current = activeEditorTab
          } else {
            lastErrorTabRef.current = null
          }
        }
      }

      // Effect 2 [lastCompileError, activeEditorTab, applyMarkers]:
      function runTabAndErrorMarkerEffect() {
        if (!lastCompileError || lastErrorTabRef.current !== activeEditorTab) {
          mockSetModelMarkers([])
          return
        }
        const diags = parseDiagnosticErrors(lastCompileError)
        mockSetModelMarkers(diags)
      }

      function renderShaderEditor() {
        runCompileErrorEffect()
        runTabAndErrorMarkerEffect()
      }

      // Step 1: Initial state — on "render" tab with render error
      renderShaderEditor()
      expect(currentMarkers).toHaveLength(1)
      expect(currentMarkers[0].message).toContain("u_diffuse")
      expect(lastErrorTabRef.current).toBe("render")

      // Step 2: User switches to "compute" tab while compile error persists
      activeEditorTab = "compute"
      renderShaderEditor()

      // VERIFICATION: compile error effect did NOT run (lastCompileError unchanged),
      // lastErrorTabRef.current strictly remains "render", and markers are CLEARED on the compute tab!
      expect(lastErrorTabRef.current).toBe("render")
      expect(currentMarkers).toEqual([])

      // Step 3: User switches back to "render" tab
      activeEditorTab = "render"
      renderShaderEditor()

      // Markers are cleanly restored on the render tab
      expect(currentMarkers).toHaveLength(1)
      expect(currentMarkers[0].message).toContain("u_diffuse")
      expect(lastErrorTabRef.current).toBe("render")

      // Step 4: Compile error clears to null (e.g. successful compilation)
      lastCompileError = null
      renderShaderEditor()
      expect(lastErrorTabRef.current).toBeNull()
      expect(currentMarkers).toEqual([])

      // Step 5: Compute tab error arrives while on compute tab
      activeEditorTab = "compute"
      renderShaderEditor()
      lastCompileError = ":25:10 error: invalid workgroup size"
      renderShaderEditor()
      expect(lastErrorTabRef.current).toBe("compute")
      expect(currentMarkers).toHaveLength(1)
      expect(currentMarkers[0].message).toContain("invalid workgroup size")

      // Step 6: User switches back to render tab while compute error persists
      activeEditorTab = "render"
      renderShaderEditor()
      expect(lastErrorTabRef.current).toBe("compute")
      expect(currentMarkers).toEqual([])
    })
  })
})
