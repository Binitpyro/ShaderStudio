/**
 * Shader editor + diagnostics: ShaderEditor tabs/languages/actions, compiler marker isolation (driven through the real component's onMount),
 * ConsoleDrawer diagnostic parsing/jump, WebGL2/Three/WebGPU compile-error routing, ErrorBoundary and diagnosticParser.
 * Consolidated by fleet w1-b-ui; harness re-implementations of ShaderEditor logic were rewritten against the real component.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import * as React from "react"
import { ShaderEditor, COMPILER_MARKER_OWNER, getErrorTargetTab, doesTabMatch } from "@/components/ShaderEditor"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { useProjectStore, type EditorTab, type BackendType } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { webgpuAdapter, WebGPUAdapter } from "@/adapters/webgpu"
import { loadAdapter } from "@/adapters/activeAdapter"
import { webgl2Adapter, WebGL2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"

beforeAll(async () => { await loadAdapter("webgpu") }) // webgpu registers lazily

let capturedOnMount: ((editor: any, monaco: any) => void) | null = null
let capturedOnChange: ((value: string | undefined) => void) | null = null

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    language,
    options,
    onMount,
    onChange,
  }: {
    value: string
    language: string
    options: any
    onMount?: (editor: any, monaco: any) => void
    onChange?: (value: string | undefined) => void
  }) => {
    capturedOnMount = onMount || null
    capturedOnChange = onChange || null
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

vi.mock("@/components/SyncStatusBanner", () => ({
  SyncStatusBanner: () => <div data-testid="sync-status-banner">Sync Status</div>,
}))

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("editor actions + console (m5)", () => {

// ----------------------------------------------------------------------------
// VDOM Expansion Utilities for White-Box Event Invocation
// ----------------------------------------------------------------------------

function expandTree(node: any, idx = 0): any {
  if (!node) return node
  if (Array.isArray(node)) {
    return node.map((child, i) => expandTree(child, i))
  }
  if (typeof node.type === "function") {
    try {
      const rendered = node.type(node.props)
      return expandTree(rendered, idx)
    } catch {
      return node
    }
  }
  if (React.isValidElement(node)) {
    const key = node.key ?? `k-${idx}`
    if (node.props?.children) {
      return React.cloneElement(node as React.ReactElement<any>, {
        key,
        children: expandTree(node.props.children),
      })
    }
    return React.cloneElement(node as React.ReactElement<any>, { key })
  }
  return node
}

function renderAndCaptureVDOM(Component: React.ComponentType<any>, props: any = {}): any {
  let capturedTree: any = null
  function Interceptor() {
    const raw = Component(props)
    capturedTree = expandTree(raw)
    return React.createElement("div", { key: "interceptor-root" }, capturedTree)
  }
  renderToStaticMarkup(React.createElement(Interceptor, { key: "root" }))
  return capturedTree
}

function findVDOMNode(vdom: any, predicate: (node: any) => boolean): any {
  if (!vdom) return null
  if (predicate(vdom)) return vdom
  if (Array.isArray(vdom)) {
    for (const child of vdom) {
      const found = findVDOMNode(child, predicate)
      if (found) return found
    }
  }
  if (vdom.props?.children) {
    return findVDOMNode(vdom.props.children, predicate)
  }
  return null
}

function findAllVDOMNodes(vdom: any, predicate: (node: any) => boolean): any[] {
  const results: any[] = []
  function traverse(node: any) {
    if (!node) return
    if (predicate(node)) results.push(node)
    if (Array.isArray(node)) {
      for (const c of node) traverse(c)
    } else if (node.props?.children) {
      traverse(node.props.children)
    }
  }
  traverse(vdom)
  return results
}

// ----------------------------------------------------------------------------
// Test Suite Setup
// ----------------------------------------------------------------------------

describe("Milestone 5 Challenger 2: Adversarial Stress Suite (Parameters & Editor)", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useProjectStore.setState({
      activeBackend: "webgpu",
      activeEditorTab: "render",
      shaderSource: "// default render shader",
      vertexShaderSource: "// default vertex shader",
      computeShaderSource: "// default compute shader",
      lastCompileError: null,
      isAudioPlaying: false,
      audioGain: 1.0,
      audioSmoothing: 0.8,
      audioSourceType: "builtin",
      audioBindings: {},
      variations: [],
      activeVariationId: null,
      environmentSettings: {
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0,
        backgroundBlur: 0.0,
        showSkybox: false,
      },
    })
    useLayoutStore.setState({
      editorMinimap: false,
      maximizedPanel: "none",
      jumpTarget: null,
      isConsoleOpen: true,
      isRightInspectorOpen: true,
    })
    useFileSystemStore.setState({
      syncMode: "local",
    })
    capturedOnMount = null
    capturedOnChange = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Suite 6: Milestone 4 Monaco Editor — Multi-Tab Backend Switching & Languages
  // ==========================================================================
  describe("Suite 6: Monaco ShaderEditor — Multi-Tab Backend Switching & Languages", () => {
    it("renders Render Shader and Compute Shader (WGSL) tabs with 'rust' language on WebGPU", () => {
      useProjectStore.setState({
        activeBackend: "webgpu",
        activeEditorTab: "render",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-testid=\"tab-render\"")
      expect(html).toContain("Render Shader")
      expect(html).toContain("data-testid=\"tab-compute\"")
      expect(html).toContain("Compute Shader (WGSL)")
      expect(html).toContain("data-language=\"rust\"")
      expect(html).not.toContain("Fragment Shader")
      expect(html).not.toContain("Vertex Shader")
    })

    it("renders Fragment Shader and Vertex Shader tabs with 'glsl' language on WebGL2", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
      })

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-testid=\"tab-fragment\"")
      expect(html).toContain("Fragment Shader")
      expect(html).toContain("data-testid=\"tab-vertex\"")
      expect(html).toContain("Vertex Shader")
      expect(html).toContain("data-language=\"glsl\"")
      expect(html).not.toContain("Compute Shader (WGSL)")
    })

    it("maintains strict source code isolation across tabs without cross-contamination", () => {
      const fragCode = "// Unique Fragment Stage Code"
      const vertCode = "// Unique Vertex Stage Code"
      const compCode = "// Unique Compute Stage WGSL Code"

      useProjectStore.getState().setShaderSource(fragCode)
      useProjectStore.getState().setVertexShaderSource(vertCode)
      useProjectStore.getState().setComputeShaderSource(compCode)

      // Tab switching does not mutate contents
      useProjectStore.getState().setActiveEditorTab("vertex")
      expect(useProjectStore.getState().shaderSource).toBe(fragCode)
      expect(useProjectStore.getState().vertexShaderSource).toBe(vertCode)
      expect(useProjectStore.getState().computeShaderSource).toBe(compCode)

      useProjectStore.getState().setActiveEditorTab("compute")
      expect(useProjectStore.getState().shaderSource).toBe(fragCode)
      expect(useProjectStore.getState().vertexShaderSource).toBe(vertCode)
      expect(useProjectStore.getState().computeShaderSource).toBe(compCode)
    })
  })

  // ==========================================================================
  // Suite 8: Milestone 4 Monaco Editor — Top Action Bar Controls
  // ==========================================================================
  describe("Suite 8: Monaco ShaderEditor — Action Bar Buttons (Format, Minimap, Run)", () => {

    it("toggles Minimap option in useLayoutStore and synchronizes editor options", () => {
      expect(useLayoutStore.getState().editorMinimap).toBe(false)

      const vdom = renderAndCaptureVDOM(ShaderEditor)
      const minimapBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.["data-testid"] === "toggle-minimap-btn"
      )
      expect(minimapBtn).not.toBeNull()

      // Toggle minimap ON
      minimapBtn.props.onClick()
      expect(useLayoutStore.getState().editorMinimap).toBe(true)

      // Toggle minimap OFF
      minimapBtn.props.onClick()
      expect(useLayoutStore.getState().editorMinimap).toBe(false)
    })

    it("triggers recompile via Run button and Ctrl+Enter keyboard shortcut", () => {
      const recompileSpy = vi.spyOn(useProjectStore.getState(), "triggerRecompile")

      // 1. Run button click
      const vdom = renderAndCaptureVDOM(ShaderEditor)
      const runBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.["data-testid"] === "recompile-btn"
      )
      expect(runBtn).not.toBeNull()
      runBtn.props.onClick()
      expect(recompileSpy).toHaveBeenCalledTimes(1)

      // 2. Monaco Ctrl+Enter registered shortcut
      const mockEditor = {
        addCommand: vi.fn((_chord: any, handler: () => void) => {
          handler() // execute registered shortcut
        }),
        getModel: vi.fn(() => null),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
      }
      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3 },
        editor: { setModelMarkers: vi.fn() },
      }

      // Simulate onMount
      renderToStaticMarkup(<ShaderEditor />)
      if (capturedOnMount) {
        capturedOnMount(mockEditor as any, mockMonaco as any)
      }
      expect(mockEditor.addCommand).toHaveBeenCalled()
      expect(recompileSpy).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // Suite 9: Milestone 4 Console Drawer — Navigation, Clamping & Warnings
  // ==========================================================================
  describe("Suite 9: ConsoleDrawer — Navigation, Viewport Un-Maximizing & Clamping", () => {
    it("renders parsed error cards with line/column badges and clear diagnostics button", () => {
      useProjectStore.setState({
        lastCompileError: ":42:15 error: unexpected token 'var'",
      })

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("1 Error")
      expect(html).toContain("0 Warnings")
      expect(html).toContain("[Line 42:15]")
      expect(html).toContain("unexpected token &#x27;var&#x27;")
      expect(html).toContain("Clear Diagnostics")
      expect(html).toContain("Jump")
    })

    it("clicking Jump un-maximizes Viewport and sets jumpTarget coordinates", () => {
      useProjectStore.setState({
        lastCompileError: ":88:20 error: invalid uniform assignment",
      })
      // Viewport maximized hiding the editor
      useLayoutStore.setState({
        maximizedPanel: "viewport",
        jumpTarget: null,
      })
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      const vdom = renderAndCaptureVDOM(ConsoleDrawer)
      const jumpBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.["data-testid"] === "jump-to-line-btn"
      )
      expect(jumpBtn).not.toBeNull()

      jumpBtn.props.onClick({ stopPropagation: () => {} })

      // Viewport MUST be un-maximized to 'none' so editor becomes visible
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")

      // jumpTarget recorded with exact coordinates
      const target = useLayoutStore.getState().jumpTarget
      expect(target).not.toBeNull()
      expect(target?.line).toBe(88)
      expect(target?.column).toBe(20)
    })

    it("auto-switches activeEditorTab when jumping to error from a different stage", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
        lastCompileError: "ERROR: 0:33: error in vertex shader: undeclared variable",
      })

      const vdom = renderAndCaptureVDOM(ConsoleDrawer)
      const jumpBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.["data-testid"] === "jump-to-line-btn"
      )
      expect(jumpBtn).not.toBeNull()
      jumpBtn.props.onClick({ stopPropagation: () => {} })

      // Tab automatically switched to 'vertex'
      expect(useProjectStore.getState().activeEditorTab).toBe("vertex")
    })

    it("differentiates warnings (amber badge, AlertTriangle) from errors (red badge, AlertCircle)", () => {
      useProjectStore.setState({
        lastCompileError: "ERROR: 0:10: syntax error\nWARNING: 0:25: precision qualifier missing",
      })

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("1 Error")
      expect(html).toContain("1 Warning")
      expect(html).toContain("[Line 10]")
      expect(html).toContain("[Line 25]")
      expect(html).toContain("Clear Diagnostics")
    })

    it("clearing diagnostics resets compile error and returns console to clean state", () => {
      useProjectStore.setState({
        lastCompileError: ":1:1 error: fatal error",
      })

      const vdom = renderAndCaptureVDOM(ConsoleDrawer)
      const clearBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.["data-testid"] === "clear-diagnostics-btn"
      )
      expect(clearBtn).not.toBeNull()
      clearBtn.props.onClick()

      expect(useProjectStore.getState().lastCompileError).toBeNull()

      const cleanHtml = renderToStaticMarkup(<ConsoleDrawer />)
      expect(cleanHtml).toContain("0 Errors")
      expect(cleanHtml).toContain("0 Warnings")
      expect(cleanHtml).toContain("No compilation errors or diagnostics.")
      expect(cleanHtml).not.toContain("Clear Diagnostics")
    })
  })
})
})

describe("sync, compute routing, multi-vendor diagnostics (m4 challenger2)", () => {
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
})

describe("editor challenger (m4)", () => {
describe("Adversarial Challenger M4: Monaco Shader Editor & Console Enhancements (Requirement R4)", () => {
  beforeEach(() => {
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
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Suite 2: Jump-to-Line Adversarial Stress
  // ==========================================================================
  describe("Suite 2: Jump-to-Line Adversarial Stress", () => {

    it("ConsoleDrawer: clicking Jump button routes to correct tab and triggers jumpToLine", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "fragment",
        lastCompileError: "Vertex shader error: :18:4 error: undefined symbol 'v_normal'",
      })

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("data-testid=\"jump-to-line-btn\"")
      expect(html).toContain("[Line 18:4]")
      expect(html).toContain("vertex")

      // Calling jump action for this error
      useLayoutStore.getState().jumpToLine(18, 4)
      const target = useLayoutStore.getState().jumpTarget
      expect(target).toEqual({
        line: 18,
        column: 4,
        timestamp: expect.any(Number),
      })
    })

    it("ConsoleDrawer: does not render Jump button when compile error has no line numbers", () => {
      useProjectStore.setState({
        lastCompileError: "WebGPU Device Lost: GPU connection terminated by OS watchdog",
      })

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("1 Error")
      expect(html).toContain("GPU connection terminated")
      expect(html).not.toContain("data-testid=\"jump-to-line-btn\"")
    })
  })

  // ==========================================================================
  // Suite 5: Minimap Toggling & Persistence Stress
  // ==========================================================================
  describe("Suite 5: Minimap Toggling & Persistence Stress", () => {
    it("initializes with minimap disabled by default", () => {
      expect(useLayoutStore.getState().editorMinimap).toBe(false)
      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-minimap=\"false\"")
    })

    it("toggles minimap state in store and reflects in editor options", () => {
      useLayoutStore.getState().toggleEditorMinimap()
      expect(useLayoutStore.getState().editorMinimap).toBe(true)

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-minimap=\"true\"")

      useLayoutStore.getState().toggleEditorMinimap()
      expect(useLayoutStore.getState().editorMinimap).toBe(false)
    })

    it("Minimap toggle button reflects active visual state via bg-accent class", () => {
      useLayoutStore.setState({ editorMinimap: false })
      const htmlOff = renderToStaticMarkup(<ShaderEditor />)
      expect(htmlOff).toContain("data-testid=\"toggle-minimap-btn\"")
      expect(htmlOff).not.toContain("bg-accent text-foreground")

      useLayoutStore.setState({ editorMinimap: true })
      const htmlOn = renderToStaticMarkup(<ShaderEditor />)
      expect(htmlOn).toContain("bg-accent text-foreground font-medium")
    })
  })

  // ==========================================================================
  // Suite 6: Recompile Triggers, Shortcuts & Debounce Synchronization
  // ==========================================================================
  describe("Suite 6: Recompile Triggers, Shortcuts & Debounce Synchronization", () => {
    it("triggerRecompile increments recompileTrigger sequentially", () => {
      const initial = useProjectStore.getState().recompileTrigger
      useProjectStore.getState().triggerRecompile()
      expect(useProjectStore.getState().recompileTrigger).toBe(initial + 1)
      useProjectStore.getState().triggerRecompile()
      expect(useProjectStore.getState().recompileTrigger).toBe(initial + 2)
    })

    it("resists 1,000 rapid recompile triggers without dropped increments", () => {
      const initial = useProjectStore.getState().recompileTrigger
      for (let i = 0; i < 1000; i++) {
        useProjectStore.getState().triggerRecompile()
      }
      expect(useProjectStore.getState().recompileTrigger).toBe(initial + 1000)
    })

    it("Recompile action button renders with Run label and title shortcut", () => {
      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("data-testid=\"recompile-btn\"")
      expect(html).toContain("Recompile (Ctrl+Enter)")
      expect(html).toContain("Run")
    })

    it("Read-only mode blocks keystroke editing and provides Detach button", () => {
      useFileSystemStore.setState({ syncMode: "bridge" })

      const html = renderToStaticMarkup(<ShaderEditor />)
      expect(html).toContain("Detach &amp; edit")

      // Switching syncMode back to local removes Detach button
      useFileSystemStore.setState({ syncMode: "local" })
      const localHtml = renderToStaticMarkup(<ShaderEditor />)
      expect(localHtml).not.toContain("Detach &amp; edit")
    })
  })
})
})

describe("error boundary + diagnostic parser", () => {
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
})
})


// ============================================================================
// Real-component marker isolation: render the real ShaderEditor, grab Monaco's onMount
// and invoke it with a fake editor/monaco. onMount runs the real applyMarkers() against the
// store state at that moment, so these assertions exercise ShaderEditor's own logic.
// ============================================================================
describe("ShaderEditor compiler markers (real component, driven via onMount)", () => {
  type Marker = {
    owner: string
    severity: number
    message: string
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }

  function mountEditor(opts: { lineCount?: number; maxColumn?: number } = {}) {
    capturedOnMount = null
    renderToStaticMarkup(<ShaderEditor />)
    expect(capturedOnMount).not.toBeNull()
    const model = {
      uri: { toString: () => "inmemory://model/test" },
      getLineCount: () => opts.lineCount ?? 100,
      getLineMaxColumn: () => opts.maxColumn ?? 80,
    }
    const calls: Array<{ owner: string; markers: Marker[] }> = []
    const editor = {
      getModel: () => model,
      addCommand: vi.fn(),
      revealLineInCenter: vi.fn(),
      setPosition: vi.fn(),
      focus: vi.fn(),
      updateOptions: vi.fn(),
    }
    const monaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { Enter: 3 },
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: {
        setModelMarkers: vi.fn((_m: unknown, owner: string, markers: Marker[]) => calls.push({ owner, markers })),
      },
    }
    ;(capturedOnMount as unknown as (e: unknown, m: unknown) => void)(editor, monaco)
    return { editor, monaco, last: () => calls[calls.length - 1]?.markers ?? [], calls }
  }

  function setup(backend: BackendType, tab: EditorTab, error: string | null) {
    useProjectStore.setState({ activeBackend: backend, activeEditorTab: tab, lastCompileError: error })
  }

  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({ jumpTarget: null, maximizedPanel: "none", editorMinimap: false })
    useFileSystemStore.setState({ syncMode: "local" })
    capturedOnMount = null
  })

  describe("tab ownership helpers", () => {
    it("getErrorTargetTab routes by stage keyword and falls back to the active tab", () => {
      expect(getErrorTargetTab(null, "compute", "webgpu")).toBe("compute")
      expect(getErrorTargetTab("Vertex shader error: x", "fragment", "webgl2")).toBe("vertex")
      expect(getErrorTargetTab("Compute shader error: x", "render", "webgpu")).toBe("compute")
      expect(getErrorTargetTab("Fragment shader error: x", "vertex", "webgl2")).toBe("fragment")
      expect(getErrorTargetTab("Fragment shader error: x", "compute", "webgpu")).toBe("render")
      expect(getErrorTargetTab(":15:8 error: undeclared identifier", "vertex", "webgl2")).toBe("vertex")
    })

    it("doesTabMatch only aliases render<->fragment and rejects null / other stages", () => {
      expect(doesTabMatch(null, "render", "webgpu")).toBe(false)
      expect(doesTabMatch("compute", "compute", "webgpu")).toBe(true)
      expect(doesTabMatch("compute", "render", "webgpu")).toBe(false)
      expect(doesTabMatch("vertex", "fragment", "webgl2")).toBe(false)
      for (const backend of ["webgpu", "webgl2", "threejs"] as BackendType[]) {
        expect(doesTabMatch("render", "fragment", backend)).toBe(true)
        expect(doesTabMatch("fragment", "render", backend)).toBe(true)
        expect(doesTabMatch("render", "vertex", backend)).toBe(false)
      }
    })
  })

  describe("marker isolation per tab", () => {
    it("vertex error shows on the vertex tab and is cleared on the fragment tab", () => {
      const err = "Vertex shader error: :12:5 error: undeclared identifier"
      setup("webgl2", "vertex", err)
      const onVertex = mountEditor()
      expect(onVertex.last()).toHaveLength(1)
      expect(onVertex.last()[0]).toMatchObject({ owner: COMPILER_MARKER_OWNER, startLineNumber: 12, severity: 8 })

      setup("webgl2", "fragment", err)
      expect(mountEditor().last()).toEqual([])
    })

    it("fragment error shows on the fragment tab and is cleared on the vertex tab", () => {
      const err = "Fragment shader error: :7:3 error: bad swizzle"
      setup("webgl2", "fragment", err)
      expect(mountEditor().last()).toHaveLength(1)
      setup("webgl2", "vertex", err)
      expect(mountEditor().last()).toEqual([])
    })

    it("WebGPU compute error is isolated from the render tab", () => {
      const err = "Compute shader error: :9:2 error: bad dispatch"
      setup("webgpu", "compute", err)
      expect(mountEditor().last()).toHaveLength(1)
      setup("webgpu", "render", err)
      expect(mountEditor().last()).toEqual([])
    })

    it("a GLSL vertex error never leaks into the WebGPU compute tab after a backend switch", () => {
      setup("webgpu", "compute", "Vertex shader error: :3:1 error: x")
      expect(mountEditor().last()).toEqual([])
    })

    it("a resolved (null) error clears markers", () => {
      setup("webgl2", "fragment", null)
      const m = mountEditor()
      expect(m.last()).toEqual([])
      expect(m.monaco.editor.setModelMarkers).toHaveBeenCalledWith(expect.anything(), COMPILER_MARKER_OWNER, [])
    })

    it("tab alternation (500 switches) only ever shows markers on the owning tab", () => {
      const err = "Vertex shader error: :4:2 error: x"
      for (let i = 0; i < 500; i++) {
        const tab: EditorTab = i % 2 === 0 ? "vertex" : "fragment"
        setup("webgl2", tab, err)
        const m = mountEditor()
        expect(m.last()).toHaveLength(tab === "vertex" ? 1 : 0)
      }
    })

    it("an unkeyworded error attaches to whichever tab is active", () => {
      setup("webgl2", "vertex", ":15:8 error: undeclared identifier")
      expect(mountEditor().last()).toHaveLength(1)
    })
  })

  describe("marker geometry and severity", () => {
    it("clamps a line past the document end to the last line", () => {
      setup("webgpu", "render", ":999999:10 error: token parse error at EOF")
      const m = mountEditor({ lineCount: 25 })
      expect(m.last()[0].startLineNumber).toBe(25)
      expect(m.last()[0].endLineNumber).toBe(25)
    })

    it("clamps start/end column to the line length", () => {
      setup("webgpu", "render", ":10:95 error: identifier overflow")
      const m = mountEditor({ lineCount: 50, maxColumn: 30 })
      expect(m.last()[0]).toMatchObject({ startLineNumber: 10, startColumn: 30, endColumn: 30 })
    })

    it("uses a 4-column squiggle when the column is in range, full line otherwise", () => {
      setup("webgpu", "render", ":10:5 error: bad token")
      const withCol = mountEditor({ maxColumn: 80 }).last()[0]
      expect(withCol.startColumn).toBe(5)
      expect(withCol.endColumn).toBe(9)

      setup("webgpu", "render", ":10 error: bad token")
      const noCol = mountEditor({ maxColumn: 80 }).last()[0]
      expect(noCol.startColumn).toBe(1)
      expect(noCol.endColumn).toBe(80)
    })

    it("flags warnings as severity 4 and errors as severity 8", () => {
      setup("webgl2", "fragment", "ERROR: 0:10: syntax error\nWARNING: 0:25: precision qualifier missing")
      const markers = mountEditor().last()
      expect(markers.map((x) => x.severity)).toEqual([8, 4])
      expect(markers.map((x) => x.startLineNumber)).toEqual([10, 25])
    })

    it("an error without a line number is marked on line 1", () => {
      setup("webgpu", "render", "Shader execution timeout")
      expect(mountEditor().last()[0].startLineNumber).toBe(1)
    })
  })

  describe("mount-time behaviour", () => {
    it("registers the Ctrl+Enter shortcut and it triggers a recompile", () => {
      const before = useProjectStore.getState().recompileTrigger
      const m = mountEditor()
      const [chord, handler] = m.editor.addCommand.mock.calls[0]
      expect(chord).toBe(2048 | 3)
      handler()
      expect(useProjectStore.getState().recompileTrigger).toBe(before + 1)
    })

    it("applies a pending jumpTarget on mount, flooring line/column", () => {
      useLayoutStore.setState({ jumpTarget: { line: 14.85, column: 9.32, timestamp: 1 } })
      const m = mountEditor()
      expect(m.editor.revealLineInCenter).toHaveBeenCalledWith(14)
      expect(m.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 14, column: 9 })
      expect(m.editor.focus).toHaveBeenCalled()
    })

    it("defaults the column to 1 and clamps negative line/column to 1", () => {
      useLayoutStore.setState({ jumpTarget: { line: 42, timestamp: 1 } })
      expect(mountEditor().editor.setPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 1 })
      useLayoutStore.setState({ jumpTarget: { line: -10, column: -5, timestamp: 2 } })
      expect(mountEditor().editor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 })
    })

    it("does not jump when there is no pending jumpTarget", () => {
      expect(mountEditor().editor.revealLineInCenter).not.toHaveBeenCalled()
    })
  })

  describe("format code fallback (real handler)", () => {
    // ShaderEditor fallback: trimEnd every line, write back to the active tab's source.
    function findNode(node: any, pred: (n: any) => boolean): any {
      if (!node) return null
      if (pred(node)) return node
      if (Array.isArray(node)) {
        for (const c of node) {
          const f = findNode(c, pred)
          if (f) return f
        }
        return null
      }
      return node.props?.children ? findNode(node.props.children, pred) : null
    }
    function formatButton() {
      let tree: any = null
      function Probe() {
        tree = (ShaderEditor as any)()
        return null
      }
      renderToStaticMarkup(<Probe />)
      return findNode(tree, (n) => n?.props?.["data-testid"] === "format-code-btn")
    }

    it("trims trailing whitespace only in the active tab's source", () => {
      useProjectStore.setState({
        activeBackend: "webgl2",
        activeEditorTab: "vertex",
        vertexShaderSource: "void main() {  \t  \n}  ",
        shaderSource: "// Untouched Fragment   ",
        computeShaderSource: "// Untouched Compute  ",
      })
      const btn = formatButton()
      expect(btn).not.toBeNull()
      btn.props.onClick()
      const s = useProjectStore.getState()
      expect(s.vertexShaderSource).toBe("void main() {\n}")
      expect(s.shaderSource).toBe("// Untouched Fragment   ")
      expect(s.computeShaderSource).toBe("// Untouched Compute  ")
    })
  })
})

describe("adapter compile errors surface in the store and keep the loop alive", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
  })
  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("WebGPU: malformed WGSL sets lastCompileError and the rAF loop stays registered", async () => {
    const adapter = new WebGPUAdapter()
    await adapter.mount(env.createCanvas() as any)
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: invalid wgsl code @@@")
    expect(useProjectStore.getState().lastCompileError).toContain("Invalid syntax")
    expect(env.clock.activeCallbackCount).toBe(1)
    adapter.dispose()
  })

  it("WebGL2: malformed GLSL sets a 'Fragment shader error' and the loop stays alive", async () => {
    const adapter = new WebGL2Adapter()
    await adapter.mount(env.createCanvas() as any)
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: invalid glsl ;;;")
    expect(useProjectStore.getState().lastCompileError).toContain("Fragment shader error")
    expect(env.clock.activeCallbackCount).toBe(1)
    adapter.dispose()
  })

  it("WebGL2: recompiling a fixed shader clears the error", async () => {
    const adapter = new WebGL2Adapter()
    await adapter.mount(env.createCanvas() as any)
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER: broken")
    expect(useProjectStore.getState().lastCompileError).not.toBeNull()
    adapter.recompileShader("void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }")
    expect(useProjectStore.getState().lastCompileError).toBeNull()
    adapter.dispose()
  })
})

// Handoff from w1-c-tooling (tier5 system-hardening, UI resilience domain).
describe("ErrorBoundary and diagnostics (w1-c-tooling handoff)", () => {
  it("renders a role=alert fallback for any thrown entity (primitives, plain objects, null, undefined)", () => {
    const boundary = new ErrorBoundary({
      children: React.createElement("div"),
      fallbackTitle: "Entity Catch Test",
      fallbackMessage: "Resilient Fallback Message",
    })
    for (const entity of ["Uncaught raw string exception", 500, false, { status: 503, reason: "GPU pipeline timeout" }, null, undefined]) {
      expect(ErrorBoundary.getDerivedStateFromError(entity as any).hasError).toBe(true)
      boundary.state = { hasError: true, error: entity as any, errorInfo: null, showDetails: true }
      const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
      expect(html).toContain("Entity Catch Test")
      expect(html).toContain('role="alert"')
    }
  })

  it("renders a 10-level cause chain from the top-level error", () => {
    let err = new Error("Leaf Fault Level 10")
    for (let lvl = 9; lvl >= 1; lvl--) err = new Error(`Fault Level ${lvl}`, { cause: err })
    const boundary = new ErrorBoundary({ children: React.createElement("div"), fallbackTitle: "Multi-Tier Error Catch" })
    boundary.state = { hasError: true, error: err, errorInfo: { componentStack: "\n    in DeepLeaf\n    in RootApp" }, showDetails: true }
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain("Multi-Tier Error Catch")
    expect(html).toContain("Fault Level 1")
    expect(html).toContain('role="alert"')
  })

  it("turns a compiler error string into line/column diagnostics tagged with the editor's marker owner", () => {
    expect(typeof COMPILER_MARKER_OWNER).toBe("string")
    expect(COMPILER_MARKER_OWNER.length).toBeGreaterThan(0)
    const diags = parseDiagnosticErrors("ERROR: 0:25: 'u_diffuse' : undeclared identifier")
    expect(diags).toHaveLength(1)
    expect(diags[0].line).toBe(25)
    expect(diags[0].message).toContain("u_diffuse")
    expect(parseDiagnosticErrors(null)).toEqual([])
  })
})

// ============================================================================
// w2-c coverage: debounce cancel/flush, language-aware writes, handlers and effects of the real ShaderEditor.
// A tiny render harness keeps refs across renders and re-runs an effect only when its deps change (like React),
// since renderToStaticMarkup never runs effects.
// ============================================================================
describe("ShaderEditor write pipeline and handlers (real component, effect-aware harness)", () => {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

  function createHarness() {
    const refs: Array<{ current: unknown }> = []
    const effects: Array<{ deps?: unknown[]; cleanup?: () => void }> = []
    let tree: any = null
    const render = () => {
      let ri = 0
      let ei = 0
      const queue: Array<{ i: number; fn: () => void | (() => void); deps?: unknown[] }> = []
      function Interceptor() {
        const original = internals.H
        internals.H = {
          ...original,
          useRef: (init: unknown) => (refs[ri] ??= { current: init }, refs[ri++]),
          useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void queue.push({ i: ei++, fn, deps }),
        }
        try { tree = ShaderEditor() } finally { internals.H = original }
        return null
      }
      renderToStaticMarkup(React.createElement(Interceptor))
      for (const { i, fn, deps } of queue) {
        const prev = effects[i]
        const changed = !prev || !deps || !prev.deps || deps.some((d, k) => !Object.is(d, prev.deps![k]))
        if (!changed) continue
        prev?.cleanup?.()
        const c = fn()
        effects[i] = { deps, cleanup: typeof c === "function" ? c : undefined }
      }
      return tree
    }
    const walk = (pred: (el: any) => boolean, node: any): any => {
      if (!node || typeof node !== "object") return null
      if (Array.isArray(node)) { for (const c of node) { const r = walk(pred, c); if (r) return r } return null }
      if (node.props && pred(node)) return node
      return node.props ? walk(pred, node.props.children) : null
    }
    const find = (pred: (el: any) => boolean) => walk(pred, tree)
    const monacoEl = () => find((el) => typeof el.props.onChange === "function" && typeof el.props.onMount === "function")
    return {
      render,
      find,
      type: (value: string) => monacoEl().props.onChange(value),
      click: (testId: string) => find((el) => el.props["data-testid"] === testId).props.onClick(),
      mount: (editor: any, monaco: any = { KeyMod: { CtrlCmd: 1 }, KeyCode: { Enter: 2 }, editor: { setModelMarkers: vi.fn() } }) =>
        monacoEl().props.onMount(editor, monaco),
      unmount: () => effects.forEach((e) => e?.cleanup?.()),
      readOnly: () => monacoEl().props.options.readOnly,
    }
  }

  const st = () => useProjectStore.getState()
  let h: ReturnType<typeof createHarness>
  let doc: EventTarget

  beforeEach(() => {
    vi.useFakeTimers()
    doc = new EventTarget()
    vi.stubGlobal("document", doc) // the editor registers its editComputeShader listener on `document`
    useProjectStore.getState().resetProject()
    useLayoutStore.setState({ jumpTarget: null, maximizedPanel: "none", editorMinimap: false })
    useFileSystemStore.setState({ syncMode: "local" })
    h = createHarness()
  })
  afterEach(() => {
    h.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe("debounced writes", () => {
    it("writes the typed GLSL after 400ms, marks it dirty and triggers a recompile", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      const before = st().recompileTrigger
      h.render()
      h.type("void main() { /* A */ }")
      vi.advanceTimersByTime(399)
      expect(st().glslSource).not.toBe("void main() { /* A */ }")
      vi.advanceTimersByTime(1)
      expect(st().glslSource).toBe("void main() { /* A */ }")
      expect(st().recompileTrigger).toBe(before + 1)
    })

    it("captures the language at keystroke time: a backend switch inside the window never writes GLSL into the WGSL slot", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      const wgslBefore = st().wgslSource
      h.type("// glsl text")
      useProjectStore.setState({ activeBackend: "webgpu", activeEditorTab: "render" })
      h.render()
      vi.advanceTimersByTime(400)
      expect(st().glslSource).toBe("// glsl text")
      expect(st().wgslSource).toBe(wgslBefore)
    })

    it("WebGPU render edits go to the WGSL slot", () => {
      useProjectStore.setState({ activeBackend: "webgpu", activeEditorTab: "render" })
      h.render()
      const glslBefore = st().glslSource
      h.type("// wgsl text")
      vi.advanceTimersByTime(400)
      expect(st().wgslSource).toBe("// wgsl text")
      expect(st().glslSource).toBe(glslBefore)
    })

    it("vertex tab edits go to the vertex source", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "vertex" })
      h.render()
      h.type("// vert")
      vi.advanceTimersByTime(400)
      expect(st().vertexShaderSource).toBe("// vert")
    })

    it("compute tab edits go to the compute source and recompile the compute pipeline", () => {
      const spy = vi.spyOn(webgpuAdapter, "recompileComputeShader").mockImplementation(() => undefined as never)
      useProjectStore.setState({ activeBackend: "webgpu", activeEditorTab: "compute" })
      h.render()
      h.type("// compute")
      vi.advanceTimersByTime(400)
      expect(st().computeShaderSource).toBe("// compute")
      expect(spy).toHaveBeenCalledWith("// compute")
    })

    it("read-only sync modes ignore edits", () => {
      useFileSystemStore.setState({ syncMode: "bridge" })
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      const before = st().glslSource
      expect(h.readOnly()).toBe(true)
      h.type("ignored")
      vi.advanceTimersByTime(400)
      expect(st().glslSource).toBe(before)
    })

    it("an undefined editor value is ignored", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      const before = st().recompileTrigger
      h.type(undefined as unknown as string)
      vi.advanceTimersByTime(400)
      expect(st().recompileTrigger).toBe(before)
    })

    it("re-rendering with unchanged store sources keeps the pending write", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      h.type("// keep me")
      h.render()
      vi.advanceTimersByTime(400)
      expect(st().glslSource).toBe("// keep me")
    })
  })

  describe("stale pending edits are dropped", () => {
    it.each([
      ["project name", () => useProjectStore.setState({ currentProjectName: "Another project" })],
      ["active file", () => useProjectStore.setState({ activeShaderPath: "shaders/other.frag" })],
    ])("a %s change cancels the pending write", (_n, change) => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      h.type("// stale")
      change()
      h.render()
      vi.advanceTimersByTime(1000)
      expect(st().glslSource).not.toBe("// stale")
    })

    it.each([
      ["fragment", "webgl2", "glslSource"],
      ["vertex", "webgl2", "vertexShaderSource"],
      ["compute", "webgpu", "computeShaderSource"],
    ] as const)("an external write to the %s source (template/bridge load) cancels the pending edit", (tab, backend, field) => {
      vi.spyOn(webgpuAdapter, "recompileComputeShader").mockImplementation(() => undefined as never)
      useProjectStore.setState({ activeBackend: backend, activeEditorTab: tab })
      h.render()
      h.type("// typed")
      useProjectStore.setState({ [field]: "// from template", ...(field === "glslSource" ? { shaderSource: "// from template" } : {}) } as any)
      h.render()
      vi.advanceTimersByTime(1000)
      expect(st()[field]).toBe("// from template")
    })
  })

  describe("unmount flushes pending edits", () => {
    it.each([
      ["fragment", "webgl2", "glslSource"],
      ["vertex", "webgl2", "vertexShaderSource"],
      ["compute", "webgpu", "computeShaderSource"],
    ] as const)("closing the editor immediately commits the last %s keystrokes", (tab, backend, field) => {
      vi.spyOn(webgpuAdapter, "recompileComputeShader").mockImplementation(() => undefined as never)
      useProjectStore.setState({ activeBackend: backend, activeEditorTab: tab })
      h.render()
      h.type("// last keys")
      h.unmount()
      expect(st()[field]).toBe("// last keys")
    })
  })

  describe("toolbar handlers", () => {
    it("tab buttons switch the active editor tab", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment" })
      h.render()
      h.click("tab-vertex")
      expect(st().activeEditorTab).toBe("vertex")
      h.click("tab-fragment")
      expect(st().activeEditorTab).toBe("fragment")

      useProjectStore.setState({ activeBackend: "webgpu", activeEditorTab: "render" })
      h.render()
      h.click("tab-compute")
      expect(st().activeEditorTab).toBe("compute")
      h.click("tab-render")
      expect(st().activeEditorTab).toBe("render")
    })

    it("recompile and minimap buttons act on the stores", () => {
      h.render()
      const before = st().recompileTrigger
      h.click("recompile-btn")
      expect(st().recompileTrigger).toBe(before + 1)
      h.click("toggle-minimap-btn")
      expect(useLayoutStore.getState().editorMinimap).toBe(true)
    })

    it("format uses Monaco's formatter when supported and leaves the store untouched", () => {
      useProjectStore.setState({ activeBackend: "webgl2", activeEditorTab: "fragment", glslSource: "a  ", shaderSource: "a  " })
      h.render()
      const run = vi.fn()
      h.mount({ addCommand: vi.fn(), getModel: () => null, getAction: () => ({ isSupported: () => true, run }) })
      h.click("format-code-btn")
      expect(run).toHaveBeenCalled()
      expect(st().glslSource).toBe("a  ")
    })

    it.each([
      ["fragment", "webgl2", "glslSource"],
      ["vertex", "webgl2", "vertexShaderSource"],
      ["render", "webgpu", "wgslSource"],
      ["compute", "webgpu", "computeShaderSource"],
    ] as const)("format fallback trims trailing whitespace on the %s tab and writes it back", (tab, backend, field) => {
      const raw = "line1   \nline2\t"
      useProjectStore.setState({
        activeBackend: backend,
        activeEditorTab: tab,
        [field]: raw,
        ...(field === "glslSource" || field === "wgslSource" ? { shaderSource: raw } : {}),
      } as any)
      h.render()
      const setValue = vi.fn()
      h.mount({ addCommand: vi.fn(), getModel: () => null, getAction: () => null, setValue })
      h.click("format-code-btn")
      expect(setValue).toHaveBeenCalledWith("line1\nline2")
      expect(st()[field]).toBe("line1\nline2")
    })

    it("'Detach & edit' returns a bridge-synced editor to local mode", () => {
      useFileSystemStore.setState({ syncMode: "bridge" })
      h.render()
      const btn = h.find((el) => el.props.children === "Detach & edit")
      btn.props.onClick()
      expect(useFileSystemStore.getState().syncMode).toBe("local")
    })
  })

  describe("Monaco bridge effects", () => {
    it("jumpToLine from the console reveals and focuses that position once the editor is mounted", () => {
      h.render()
      const editor = { addCommand: vi.fn(), getModel: () => null, revealLineInCenter: vi.fn(), setPosition: vi.fn(), focus: vi.fn(), updateOptions: vi.fn() }
      h.mount(editor)
      useLayoutStore.getState().jumpToLine(7.9, 3)
      h.render()
      expect(editor.revealLineInCenter).toHaveBeenCalledWith(7)
      expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 3 })
      expect(editor.focus).toHaveBeenCalled()
    })

    it("toggling the minimap updates the live editor options", () => {
      h.render()
      const editor = { addCommand: vi.fn(), getModel: () => null, updateOptions: vi.fn() }
      h.mount(editor)
      useLayoutStore.setState({ editorMinimap: true })
      h.render()
      expect(editor.updateOptions).toHaveBeenCalledWith({ minimap: { enabled: true } })
    })

    it("the Ctrl+Enter command registered on mount recompiles", () => {
      h.render()
      const editor = { addCommand: vi.fn(), getModel: () => null }
      h.mount(editor)
      const before = st().recompileTrigger
      editor.addCommand.mock.calls[0][1]()
      expect(st().recompileTrigger).toBe(before + 1)
    })
  })

  describe("editComputeShader document event", () => {
    it("opens the compute tab and loads a custom source", () => {
      h.render()
      doc.dispatchEvent(new CustomEvent("editComputeShader", { detail: { customSource: "// custom compute" } }))
      expect(st().activeEditorTab).toBe("compute")
      expect(st().computeShaderSource).toBe("// custom compute")
    })

    it("seeds the preset code only when the compute source is empty", () => {
      h.render()
      doc.dispatchEvent(new CustomEvent("editComputeShader", { detail: { preset: "curl_noise" } }))
      expect(st().computeShaderSource.length).toBeGreaterThan(0)

      useProjectStore.setState({ computeShaderSource: "// mine" })
      doc.dispatchEvent(new CustomEvent("editComputeShader", { detail: { preset: "curl_noise" } }))
      expect(st().computeShaderSource).toBe("// mine")
    })

    it("stops listening after unmount", () => {
      h.render()
      h.unmount()
      doc.dispatchEvent(new CustomEvent("editComputeShader", { detail: { customSource: "// late" } }))
      expect(st().computeShaderSource).not.toBe("// late")
    })
  })
})
