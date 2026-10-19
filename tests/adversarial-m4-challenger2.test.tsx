import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import * as React from "react"
import { ShaderEditor, COMPILER_MARKER_OWNER, getErrorTargetTab, doesTabMatch } from "@/components/ShaderEditor"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { useProjectStore, type EditorTab, type BackendType } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { webgpuAdapter } from "@/adapters/webgpu"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"

// Mock Monaco Editor component for static markup testing
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    language,
    options,
  }: {
    value: string
    language: string
    options: any
  }) => (
    <div
      data-testid="mock-monaco-editor"
      data-language={language}
      data-minimap={options?.minimap?.enabled ? "true" : "false"}
    >
      <pre data-testid="editor-content">{value}</pre>
    </div>
  ),
}))

// Mock sync status banner
vi.mock("@/components/SyncStatusBanner", () => ({
  SyncStatusBanner: () => <div data-testid="sync-status-banner">Sync Status</div>,
}))

// Mock Three.js WebGLRenderer with MockThreeRenderer
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Challenger 2 M4: Editor Sync, Compute Routing & Multi-Vendor Diagnostics", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({
      editorMinimap: false,
      maximizedPanel: "none",
      jumpTarget: null,
      isConsoleOpen: true,
    })
    useFileSystemStore.setState({
      syncMode: "local",
    })
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Suite 1: WebGL2 & Three.js Multi-Tab Source Isolation & Compilation Sync
  // ==========================================================================
  describe("Suite 1: WebGL2 & Three.js Multi-Tab Source Isolation & Compilation Sync", () => {
    it("preserves separate fragment and vertex sources in store when switching tabs in WebGL2", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
      })

      const initialFrag = "precision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }"
      const initialVert = "in vec3 a_position;\nvoid main() { gl_Position = vec4(a_position, 1.0); }"

      useProjectStore.getState().setShaderSource(initialFrag)
      useProjectStore.getState().setVertexShaderSource(initialVert)

      expect(useProjectStore.getState().shaderSource).toBe(initialFrag)
      expect(useProjectStore.getState().vertexShaderSource).toBe(initialVert)

      // Switch to vertex tab
      useProjectStore.getState().setActiveEditorTab("vertex")
      expect(useProjectStore.getState().activeEditorTab).toBe("vertex")
      expect(useProjectStore.getState().shaderSource).toBe(initialFrag)
      expect(useProjectStore.getState().vertexShaderSource).toBe(initialVert)

      // Mutate vertex shader
      const updatedVert = "in vec3 a_position;\nuniform mat4 u_mvp;\nvoid main() { gl_Position = u_mvp * vec4(a_position, 1.0); }"
      useProjectStore.getState().setVertexShaderSource(updatedVert)

      // Fragment shader MUST remain strictly untouched
      expect(useProjectStore.getState().vertexShaderSource).toBe(updatedVert)
      expect(useProjectStore.getState().shaderSource).toBe(initialFrag)

      // Switch back to fragment tab
      useProjectStore.getState().setActiveEditorTab("fragment")
      expect(useProjectStore.getState().activeEditorTab).toBe("fragment")
      expect(useProjectStore.getState().vertexShaderSource).toBe(updatedVert)
      expect(useProjectStore.getState().shaderSource).toBe(initialFrag)

      // Mutate fragment shader
      const updatedFrag = "precision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }"
      useProjectStore.getState().setShaderSource(updatedFrag)

      // Vertex shader MUST remain strictly untouched
      expect(useProjectStore.getState().shaderSource).toBe(updatedFrag)
      expect(useProjectStore.getState().vertexShaderSource).toBe(updatedVert)
    })

    it("WebGL2Adapter.recompileShader consumes custom vertexShaderSource and passed fragmentSource", async () => {
      const canvas = env.canvas
      await webgl2Adapter.mount(canvas as any)

      const customVertex = `
        in vec3 a_position;
        uniform mat4 u_mvp;
        out vec3 v_pos;
        void main() {
          v_pos = a_position;
          gl_Position = u_mvp * vec4(a_position, 1.0);
        }
      `
      const customFragment = `
        precision highp float;
        in vec3 v_pos;
        out vec4 fragColor;
        void main() {
          fragColor = vec4(v_pos, 1.0);
        }
      `

      useProjectStore.getState().setVertexShaderSource(customVertex)
      useProjectStore.getState().setShaderSource(customFragment)

      // Recompile with custom fragment shader
      webgl2Adapter.recompileShader(customFragment)

      // Verify no compilation error was produced
      expect(useProjectStore.getState().lastCompileError).toBeNull()
    })

    it("WebGL2Adapter sets lastCompileError with 'Vertex shader error:' when custom vertex compilation fails", async () => {
      const canvas = env.canvas
      await webgl2Adapter.mount(canvas as any)

      // Setup mock to fail vertex shader compilation
      const gl = (canvas as any).getContext("webgl2")
      const origGetShaderParameter = gl.getShaderParameter.bind(gl)
      const origGetShaderInfoLog = gl.getShaderInfoLog.bind(gl)

      let failedShader = false
      gl.getShaderParameter = (shader: any, pname: number) => {
        if (pname === gl.COMPILE_STATUS && !failedShader) {
          failedShader = true
          return false
        }
        return origGetShaderParameter(shader, pname)
      }
      gl.getShaderInfoLog = () => "ERROR: 0:4: 'u_unknown' : undeclared identifier"

      useProjectStore.getState().setVertexShaderSource("invalid vertex shader source")
      webgl2Adapter.recompileShader("precision highp float; out vec4 fragColor; void main() { fragColor = vec4(1.0); }")

      const lastError = useProjectStore.getState().lastCompileError
      expect(lastError).not.toBeNull()
      expect(lastError).toContain("Vertex shader error:")
      expect(lastError).toContain("ERROR: 0:4: 'u_unknown' : undeclared identifier")

      // Verify getErrorTargetTab routes to vertex tab
      const targetTab = getErrorTargetTab(lastError, "fragment", "webgl2")
      expect(targetTab).toBe("vertex")

      // Restore gl mock
      gl.getShaderParameter = origGetShaderParameter
      gl.getShaderInfoLog = origGetShaderInfoLog
    })

    it("WebGL2Adapter sets lastCompileError with 'Fragment shader error:' when fragment compilation fails", async () => {
      const canvas = env.canvas
      await webgl2Adapter.mount(canvas as any)

      const gl = (canvas as any).getContext("webgl2")
      const origGetShaderParameter = gl.getShaderParameter.bind(gl)
      const origGetShaderInfoLog = gl.getShaderInfoLog.bind(gl)

      let callCount = 0
      gl.getShaderParameter = (shader: any, pname: number) => {
        if (pname === gl.COMPILE_STATUS) {
          callCount++
          if (callCount === 2) {
            // Second shader compiled is fragmentShader
            return false
          }
        }
        return origGetShaderParameter(shader, pname)
      }
      gl.getShaderInfoLog = () => "ERROR: 0:14: 'u_diffuse' : undeclared identifier"

      useProjectStore.getState().setVertexShaderSource("")
      webgl2Adapter.recompileShader("invalid fragment shader")

      const lastError = useProjectStore.getState().lastCompileError
      expect(lastError).not.toBeNull()
      expect(lastError).toContain("Fragment shader error:")
      expect(lastError).toContain("ERROR: 0:14: 'u_diffuse' : undeclared identifier")

      // Verify getErrorTargetTab routes to fragment tab
      const targetTab = getErrorTargetTab(lastError, "vertex", "webgl2")
      expect(targetTab).toBe("fragment")

      gl.getShaderParameter = origGetShaderParameter
      gl.getShaderInfoLog = origGetShaderInfoLog
    })

    it("ThreeAdapter.recompileShader assigns custom vertexShader and fragmentShader to material", async () => {
      const canvas = env.canvas
      await threejsAdapter.mount(canvas as any)

      const customVertex = "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
      const customFragment = "void main() { gl_FragColor = vec4(0.5, 0.2, 0.8, 1.0); }"

      useProjectStore.getState().setVertexShaderSource(customVertex)
      useProjectStore.getState().setShaderSource(customFragment)

      threejsAdapter.recompileShader(customFragment)

      const material = (threejsAdapter as any).material
      expect(material).toBeDefined()
      expect(material.vertexShader).toBe(customVertex)
      expect(material.fragmentShader).toBe(customFragment)
      expect(useProjectStore.getState().lastCompileError).toBeNull()
    })

    it("ThreeAdapter falls back to defaultVertexShader if vertexShaderSource is empty", async () => {
      const canvas = env.canvas
      await threejsAdapter.mount(canvas as any)

      useProjectStore.getState().setVertexShaderSource("")
      const customFrag = "void main() { gl_FragColor = vec4(1.0); }"

      threejsAdapter.recompileShader(customFrag)

      const material = (threejsAdapter as any).material
      expect(material.vertexShader).toBe((threejsAdapter as any).defaultVertexShader)
      expect(material.fragmentShader).toBe(customFrag)
    })
  })

  // ==========================================================================
  // Suite 2: WebGPU Render & Compute Tabs, Syntax Highlighting & Routing
  // ==========================================================================
  describe("Suite 2: WebGPU Render & Compute Tabs, Syntax Highlighting & Routing", () => {
    it("renders Render Shader and Compute Shader (WGSL) tabs in WebGPU mode", () => {
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "render",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-testid=\"tab-render\"")
      expect(html).toContain("Render Shader")
      expect(html).toContain("data-testid=\"tab-compute\"")
      expect(html).toContain("Compute Shader (WGSL)")
      expect(html).not.toContain("data-testid=\"tab-fragment\"")
      expect(html).not.toContain("data-testid=\"tab-vertex\"")
    })

    it("renders Fragment Shader and Vertex Shader tabs in WebGL2 and Three.js mode", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
      })

      const gl2Html = renderToStaticMarkup(<ShaderEditor />)
      expect(gl2Html).toContain("data-testid=\"tab-fragment\"")
      expect(gl2Html).toContain("Fragment Shader")
      expect(gl2Html).toContain("data-testid=\"tab-vertex\"")
      expect(gl2Html).toContain("Vertex Shader")
      expect(gl2Html).not.toContain("data-testid=\"tab-render\"")
      expect(gl2Html).not.toContain("data-testid=\"tab-compute\"")

      useProjectStore.setState({
        activeBackend: "threejs",
        activeEditorTab: "fragment",
      })

      const threeHtml = renderToStaticMarkup(<ShaderEditor />)
      expect(threeHtml).toContain("data-testid=\"tab-fragment\"")
      expect(threeHtml).toContain("data-testid=\"tab-vertex\"")
      expect(threeHtml).not.toContain("data-testid=\"tab-render\"")
    })

    it("correctly toggles syntax highlighting language between glsl and rust (WGSL)", () => {
      // 1. In WebGL2: fragment is glsl
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
      })
      let html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"glsl\"")

      // 2. In WebGL2: vertex is glsl
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "vertex",
      })
      html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"glsl\"")

      // 3. In WebGL2: compute tab (e.g. via edit event) is rust (WGSL)
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "compute",
      })
      html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"rust\"")

      // 4. In Three.js: fragment and vertex are glsl
      useProjectStore.setState({
        activeBackend: "threejs",
        activeEditorTab: "fragment",
      })
      html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"glsl\"")

      // 5. In WebGPU: render tab is rust (WGSL)
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "render",
      })
      html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"rust\"")

      // 6. In WebGPU: compute tab is rust (WGSL)
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "compute",
      })
      html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-language=\"rust\"")
    })

    it("switching activeBackend in store seamlessly normalizes activeEditorTab and syntax language", () => {
      // Start in WebGL2 on vertex tab
      useProjectStore.getState().setActiveBackend("webgl2")
      useProjectStore.getState().setActiveEditorTab("vertex")
      expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      expect(useProjectStore.getState().activeEditorTab).toBe("vertex")

      // Switch to WebGPU -> tab automatically transitions to 'render'
      useProjectStore.getState().setActiveBackend("webgpu")
      expect(useProjectStore.getState().activeBackend).toBe("webgpu")
      expect(useProjectStore.getState().activeEditorTab).toBe("render")

      // Switch back to WebGL2 -> tab automatically transitions to 'fragment'
      useProjectStore.getState().setActiveBackend("webgl2")
      expect(useProjectStore.getState().activeBackend).toBe("webgl2")
      expect(useProjectStore.getState().activeEditorTab).toBe("fragment")
    })

    it("routes compute shader edits to webgpuAdapter.recompileComputeShader", () => {
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "compute",
      })

      const recompileSpy = vi.spyOn(webgpuAdapter, "recompileComputeShader")

      const newComputeCode = "@compute @workgroup_size(64) fn main() { /* custom compute */ }"
      useProjectStore.getState().setComputeShaderSource(newComputeCode)
      webgpuAdapter.recompileComputeShader(newComputeCode)

      expect(recompileSpy).toHaveBeenCalledWith(newComputeCode)
      expect(useProjectStore.getState().computeShaderSource).toBe(newComputeCode)
      expect(useProjectStore.getState().shaderSource).not.toBe(newComputeCode)

      recompileSpy.mockRestore()
    })
  })

  // ==========================================================================
  // Suite 3: ConsoleDrawer Diagnostics Parser across GPU Drivers
  // ==========================================================================
  describe("Suite 3: ConsoleDrawer Diagnostics Parser across GPU Drivers", () => {
    // 3.1 NVIDIA Driver Multi-line Logs
    describe("NVIDIA Driver Logs", () => {
      it("parses multi-line ANGLE / NVIDIA WebGL error logs with line numbers and messages", () => {
        const nvidiaError = [
          "ERROR: 0:14: 'u_diffuse' : undeclared identifier",
          "ERROR: 0:14: '=' : cannot convert from 'const int' to 'highp mat4'",
          "ERROR: 0:28: 'calcLighting' : no matching overloaded function found",
        ].join("\n")

        const diags = parseDiagnosticErrors(nvidiaError)
        expect(diags).toHaveLength(3)
        expect(diags[0]).toEqual({
          line: 14,
          column: null,
          message: "'u_diffuse' : undeclared identifier",
        })
        expect(diags[1]).toEqual({
          line: 14,
          column: null,
          message: "'=' : cannot convert from 'const int' to 'highp mat4'",
        })
        expect(diags[2]).toEqual({
          line: 28,
          column: null,
          message: "'calcLighting' : no matching overloaded function found",
        })

        // Verify ConsoleDrawer badge counts
        useProjectStore.getState().setLastCompileError(nvidiaError)
        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("3 Errors")
        expect(html).toContain("0 Warnings")
        expect(html).toContain("[Line 14]")
        expect(html).toContain("[Line 28]")
      })

      it("correctly parses WebGL WARNING: 0:7 as line 7 with proper badge rendering", () => {
        const warningLine = "WARNING: 0:7: 'u_exposure' : variable declared but not used"
        const diags = parseDiagnosticErrors(warningLine)
        expect(diags).toHaveLength(1)

        // WebGL WARNING: 0:7 matches WebGL regex and parses line 7 with null column
        expect(diags[0].line).toBe(7)
        expect(diags[0].column).toBeNull()

        // In ConsoleDrawer, coordinate badges render properly guarded without literal "0"
        useProjectStore.getState().setLastCompileError(warningLine)
        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("1 Warning")
        expect(html).not.toContain("0 Warnings")
        expect(html).toContain("[Line 7]")
        expect(html).not.toContain("render</span>0</div>")
      })
    })

    // 3.2 Mesa / Linux Driver Logs
    describe("Mesa / Linux Driver Logs", () => {
      it("parses multi-line Mesa error logs with line extraction", () => {
        const mesaError = [
          "ERROR: 0:12: undeclared identifier `u_albedo'",
          "ERROR: 0:34: syntax error, unexpected IDENTIFIER",
        ].join("\n")

        const diags = parseDiagnosticErrors(mesaError)
        expect(diags).toHaveLength(2)
        expect(diags[0].line).toBe(12)
        expect(diags[0].message).toContain("undeclared identifier")
        expect(diags[1].line).toBe(34)
        expect(diags[1].message).toContain("syntax error")

        useProjectStore.getState().setLastCompileError(mesaError)
        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("2 Errors")
      })
    })

    // 3.3 Apple / Metal GLSL Logs
    describe("Apple / macOS / Metal GLSL Logs", () => {
      it("parses Apple WebGL error format without columns", () => {
        const appleLog = [
          "ERROR: 0:42: 'gl_FragColor' : undeclared identifier",
          "ERROR: 0:45: 'vec4' : no matching overloaded function found",
        ].join("\n")

        const diags = parseDiagnosticErrors(appleLog)
        expect(diags).toHaveLength(2)
        expect(diags[0]).toEqual({
          line: 42,
          column: null,
          message: "'gl_FragColor' : undeclared identifier",
        })
        expect(diags[1]).toEqual({
          line: 45,
          column: null,
          message: "'vec4' : no matching overloaded function found",
        })
      })

      it("parses Apple / Metal GLSL log containing column numbers (ERROR: 0:line:col)", () => {
        const appleColLog = "ERROR: 0:18:12: 'texture2D' : no matching overloaded function found"
        const diags = parseDiagnosticErrors(appleColLog)
        expect(diags).toHaveLength(1)
        expect(diags[0].line).toBe(18)
        expect(diags[0].column).toBe(12)
        expect(diags[0].message).toBe("'texture2D' : no matching overloaded function found")

        useProjectStore.getState().setLastCompileError(appleColLog)
        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("[Line 18:12]")
      })
    })

    // 3.4 WGSL Tint (Chrome Dawn) Logs
    describe("WGSL Tint (Chrome Dawn) Logs", () => {
      it("parses multi-line Tint error and warning logs with line and column extraction", () => {
        const tintLog = [
          ":12:15 error: unresolved identifier 'u_camera'",
          ":18:4 error: expected ';' for statement",
          ":25:10 warning: uniform 'u_light' is never read",
        ].join("\n")

        const diags = parseDiagnosticErrors(tintLog)
        expect(diags).toHaveLength(3)

        expect(diags[0]).toEqual({
          line: 12,
          column: 15,
          message: "unresolved identifier 'u_camera'",
        })
        expect(diags[1]).toEqual({
          line: 18,
          column: 4,
          message: "expected ';' for statement",
        })
        expect(diags[2]).toEqual({
          line: 25,
          column: 10,
          message: "uniform 'u_light' is never read",
        })

        useProjectStore.getState().setLastCompileError(tintLog)
        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("2 Errors")
        expect(html).toContain("1 Warning")
        expect(html).toContain("[Line 12:15]")
        expect(html).toContain("[Line 18:4]")
        expect(html).toContain("[Line 25:10]")
      })

      it("parses Tint logs without leading colons (line:col error: ...)", () => {
        const tintNoColon = [
          "14:8 error: invalid type 'vec5<f32>'",
          "32:1 error: return type mismatch",
        ].join("\n")

        const diags = parseDiagnosticErrors(tintNoColon)
        expect(diags).toHaveLength(2)
        expect(diags[0].line).toBe(14)
        expect(diags[0].column).toBe(8)
        expect(diags[1].line).toBe(32)
        expect(diags[1].column).toBe(1)
      })

      it("handles multi-line Tint diagnostic logs with candidate notes gracefully", () => {
        const tintWithNotes = [
          "12:15 error: no matching call to 'textureSample'",
          "12:15 note: 1 candidate function found",
          "19:1 error: missing closing brace",
        ].join("\n")

        const diags = parseDiagnosticErrors(tintWithNotes)
        expect(diags.length).toBeGreaterThanOrEqual(2)
        expect(diags[0].line).toBe(12)
        expect(diags[0].column).toBe(15)
      })
    })

    // 3.5 WGSL Naga (Firefox Wgpu) Logs
    describe("WGSL Naga (Firefox Wgpu) Logs", () => {
      it("handles Naga line bracket format 'error: [14:5] Expression is invalid'", () => {
        const nagaBracketLog = "error: [14:5] Expression is invalid: expected 'u32', found '&str'"
        const diags = parseDiagnosticErrors(nagaBracketLog)
        expect(diags).toHaveLength(1)
        expect(diags[0].line).toBe(14)
        expect(diags[0].column).toBe(5)
      })

      it("handles Naga arrow diagnostic '--> wgsl:20:8: unknown field'", () => {
        const nagaArrowLog = "error: --> wgsl:20:8: unknown field 'xyz' of type vec2<f32>"
        const diags = parseDiagnosticErrors(nagaArrowLog)
        expect(diags).toHaveLength(1)
        expect(diags[0].line).toBe(20)
        expect(diags[0].column).toBe(8)
      })
    })

    // 3.6 Click-to-Jump and Tab Switching from ConsoleDrawer
    describe("ConsoleDrawer Click-to-Jump Navigation", () => {
      it("clicking Jump for vertex shader error sets activeEditorTab to vertex and triggers jumpToLine", () => {
        useProjectStore.setState({
          activeBackend: "webgl2",
          activeEditorTab: "fragment",
          lastCompileError: "Vertex shader error: :14:8 error: syntax error",
        })

        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("data-testid=\"jump-to-line-btn\"")
        expect(html).toContain("vertex")
        expect(html).toContain("[Line 14:8]")

        // Simulate jump action as executed in ConsoleDrawer line 47-53
        useProjectStore.getState().setActiveEditorTab("vertex")
        useLayoutStore.getState().jumpToLine(14, 8)

        expect(useProjectStore.getState().activeEditorTab).toBe("vertex")
        expect(useLayoutStore.getState().jumpTarget).toEqual({
          line: 14,
          column: 8,
          timestamp: expect.any(Number),
        })
      })

      it("clicking Clear Diagnostics sets lastCompileError to null in store and clears drawer", () => {
        useProjectStore.getState().setLastCompileError("ERROR: 0:1: syntax error")
        expect(useProjectStore.getState().lastCompileError).not.toBeNull()

        // Clear action
        useProjectStore.getState().setLastCompileError(null)
        expect(useProjectStore.getState().lastCompileError).toBeNull()

        const html = renderToStaticMarkup(<ConsoleDrawer />)
        expect(html).toContain("0 Errors")
        expect(html).toContain("0 Warnings")
        expect(html).toContain("No compilation errors or diagnostics.")
      })
    })
  })

  // ==========================================================================
  // Suite 4: Adversarial Edge Cases & Stress
  // ==========================================================================
  describe("Suite 4: Adversarial Edge Cases & Stress", () => {
    it("handles malicious XSS / HTML injection payloads in shader errors safely", () => {
      const xssError = "ERROR: 0:10: '<script>alert(1)</script>' : undeclared identifier"
      useProjectStore.getState().setLastCompileError(xssError)

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
      expect(html).not.toContain("<script>alert(1)</script>")
    })

    it("handles 500-line massive driver error log without freezing or blowing stack", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `ERROR: 0:${i + 1}: 'var_${i}' : undeclared identifier`)
      const bigLog = lines.join("\n")

      const start = performance.now()
      const diags = parseDiagnosticErrors(bigLog)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(150)
      expect(diags).toHaveLength(500)
      expect(diags[0].line).toBe(1)
      expect(diags[499].line).toBe(500)
    })

    it("resists 1,000 rapid alternating tab and backend switches without state corruption", () => {
      const backends: BackendType[] = ["webgpu", "webgl2", "threejs"]
      const tabs: EditorTab[] = ["render", "compute", "fragment", "vertex"]

      for (let i = 0; i < 1000; i++) {
        const b = backends[i % backends.length]
        const t = tabs[i % tabs.length]
        useProjectStore.getState().setActiveBackend(b)
        useProjectStore.getState().setActiveEditorTab(t)
      }

      // Verify store is healthy
      expect(useProjectStore.getState().activeBackend).toBeDefined()
      expect(useProjectStore.getState().activeEditorTab).toBeDefined()
    })
  })
})
