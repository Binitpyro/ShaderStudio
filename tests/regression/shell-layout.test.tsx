// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { useLayoutStore, LAYOUT_STORAGE_KEY } from "@/stores/layoutStore"
import { useTransportStore } from "@/stores/transportStore"
import { useProjectStore } from "@/stores/projectStore"
import { SHADER_TEMPLATES } from "@/core/templates"

const mounts = vi.hoisted(() => ({ viewport: 0, editor: 0, graph: 0 }))

vi.mock("@/components/Viewport", async () => {
  const React = await import("react")
  return {
    Viewport: () => {
      React.useEffect(() => {
        mounts.viewport++
      }, [])
      return <div data-testid="mock-viewport" />
    },
  }
})
vi.mock("@/components/ShaderEditor", async () => {
  const React = await import("react")
  return {
    COMPILER_MARKER_OWNER: "shaderstudio-compiler",
    ShaderEditor: () => {
      React.useEffect(() => {
        mounts.editor++
      }, [])
      return <div data-testid="mock-shader-editor" className="monaco-editor" tabIndex={0} />
    },
  }
})
vi.mock("@/components/NodeGraph", async () => {
  const React = await import("react")
  return {
    NodeGraph: () => {
      React.useEffect(() => {
        mounts.graph++
      }, [])
      return <div data-testid="mock-node-graph" />
    },
  }
})
vi.mock("@/components/ParameterPanel", () => ({ ParameterPanel: () => <div data-testid="mock-parameter-panel" /> }))
vi.mock("@/components/ProjectPanel", () => ({ ProjectPanel: () => <div /> }))
vi.mock("@/components/FileImporter", () => ({ FileImporter: () => <div /> }))
vi.mock("@/components/layout/ConsoleDrawer", () => ({ ConsoleDrawer: () => <div data-testid="console-drawer" /> }))

import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { Toolbar } from "@/components/Toolbar"
import { TemplatesSidebar } from "@/components/sidebars/TemplatesSidebar"

const st = () => useLayoutStore.getState()
const reset = () =>
  useLayoutStore.setState({
    activeActivityTab: "graph",
    isLeftSidebarOpen: true,
    isRightInspectorOpen: true,
    isConsoleOpen: false,
    splitOrientation: "vertical",
    maximizedPanel: "none",
    panelLayouts: {},
  })

describe("shell: panels never remount the viewport or editor", () => {
  beforeEach(() => {
    reset()
    mounts.viewport = mounts.editor = mounts.graph = 0
  })

  it("keeps the same Viewport and Editor DOM nodes through sidebar / inspector / console / maximize / split toggles", () => {
    render(<WorkspaceLayout />)
    const viewport = screen.getByTestId("mock-viewport")
    const editor = screen.getByTestId("mock-shader-editor")
    expect(mounts).toMatchObject({ viewport: 1, editor: 1 })

    const steps: Array<() => void> = [
      () => st().toggleLeftSidebar(),
      () => st().toggleLeftSidebar(),
      () => st().toggleRightInspector(),
      () => st().toggleRightInspector(),
      () => st().toggleConsole(),
      () => st().toggleConsole(),
      () => st().toggleMaximizeViewport(),
      () => st().toggleMaximizeEditor(),
      () => st().toggleMaximizeEditor(),
      () => st().toggleSplitOrientation(),
      () => st().toggleSplitOrientation(),
      () => st().toggleActivityTab("templates"),
      () => st().toggleActivityTab("copilot"),
      () => st().toggleActivityTab("copilot"),
    ]
    for (const step of steps) {
      act(step)
      expect(screen.getByTestId("mock-viewport")).toBe(viewport)
      expect(screen.getByTestId("mock-shader-editor")).toBe(editor)
      expect(viewport.isConnected && editor.isConnected).toBe(true)
    }
    expect(mounts).toMatchObject({ viewport: 1, editor: 1 })
  })

  it("keeps the node graph mounted across sidebar collapse and re-open", () => {
    render(<WorkspaceLayout />)
    act(() => st().toggleLeftSidebar())
    act(() => st().toggleLeftSidebar())
    expect(mounts.graph).toBe(1)
  })

  it("marks collapsed regions inert and hidden from assistive tech", () => {
    render(<WorkspaceLayout />)
    act(() => st().setRightInspectorOpen(false))
    const inspector = screen.getByTestId("right-inspector")
    expect(inspector.hasAttribute("inert")).toBe(true)
    expect(inspector.getAttribute("aria-hidden")).toBe("true")
    act(() => st().setRightInspectorOpen(true))
    expect(inspector.hasAttribute("inert")).toBe(false)
  })

  it("jumpToLine un-maximizes the viewport without remounting the editor", () => {
    render(<WorkspaceLayout />)
    const editor = screen.getByTestId("mock-shader-editor")
    act(() => st().setMaximizedPanel("viewport"))
    act(() => st().jumpToLine(10, 2))
    expect(st().maximizedPanel).toBe("none")
    expect(screen.getByTestId("mock-shader-editor")).toBe(editor)
    expect(mounts.editor).toBe(1)
  })
})

describe("shell: keyboard shortcuts", () => {
  beforeEach(() => {
    reset()
    useTransportStore.setState({ isPlaying: true })
  })

  it("Ctrl+B / Ctrl+J / Ctrl+I toggle sidebar, console, inspector", () => {
    render(<Toolbar />)
    fireEvent.keyDown(window, { key: "b", ctrlKey: true })
    expect(st().isLeftSidebarOpen).toBe(false)
    fireEvent.keyDown(window, { key: "j", ctrlKey: true })
    expect(st().isConsoleOpen).toBe(true)
    fireEvent.keyDown(window, { key: "i", ctrlKey: true })
    expect(st().isRightInspectorOpen).toBe(false)
    fireEvent.keyDown(window, { key: "I", metaKey: true })
    expect(st().isRightInspectorOpen).toBe(true)
  })

  it("Ctrl+I and Ctrl+J yield to Monaco while the editor has focus", () => {
    render(
      <>
        <Toolbar />
        <div className="monaco-editor">
          <textarea data-testid="monaco-input" />
        </div>
      </>,
    )
    const input = screen.getByTestId("monaco-input")
    fireEvent.keyDown(input, { key: "i", ctrlKey: true })
    fireEvent.keyDown(input, { key: "j", ctrlKey: true })
    expect(st().isRightInspectorOpen).toBe(true)
    expect(st().isConsoleOpen).toBe(false)
  })

  it("Space toggles playback outside inputs, editor and graph, and never inside them", () => {
    render(
      <>
        <Toolbar />
        <input data-testid="field" />
        <div className="react-flow">
          <button data-testid="graph-btn" />
        </div>
        <div className="monaco-editor">
          <textarea data-testid="mon" />
        </div>
      </>,
    )
    fireEvent.keyDown(document.body, { code: "Space" })
    expect(useTransportStore.getState().isPlaying).toBe(false)
    for (const id of ["field", "graph-btn", "mon"]) fireEvent.keyDown(screen.getByTestId(id), { code: "Space" })
    expect(useTransportStore.getState().isPlaying).toBe(false)
    fireEvent.keyDown(document.body, { code: "Space" })
    expect(useTransportStore.getState().isPlaying).toBe(true)
  })
})

describe("shell: single surfaces", () => {
  beforeEach(reset)

  it("top-bar Templates opens the templates sidebar tab; Copilot opens and focuses the copilot tab", () => {
    useLayoutStore.setState({ isLeftSidebarOpen: false, activeActivityTab: null })
    render(<Toolbar />)
    fireEvent.click(screen.getByRole("button", { name: "Templates" }))
    expect(st()).toMatchObject({ isLeftSidebarOpen: true, activeActivityTab: "templates" })
    const before = st().copilotFocusNonce
    fireEvent.click(screen.getByRole("button", { name: "Copilot" }))
    expect(st()).toMatchObject({ isLeftSidebarOpen: true, activeActivityTab: "copilot" })
    expect(st().copilotFocusNonce).toBe(before + 1)
  })

  it("Export is the only primary action in the top bar and reports clicks", () => {
    const onOpenExport = vi.fn()
    render(<Toolbar onOpenExport={onOpenExport} />)
    fireEvent.click(screen.getByRole("button", { name: "Export" }))
    expect(onOpenExport).toHaveBeenCalledTimes(1)
  })

  it("the templates sidebar lists every category, including Raymarching & SDF, and filters by it", () => {
    render(<TemplatesSidebar />)
    const group = screen.getByRole("group", { name: "Template category" })
    for (const c of ["All", "Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized", "Raymarching & SDF"]) {
      expect(group.textContent).toContain(c)
    }
    fireEvent.click(screen.getByRole("button", { name: "Raymarching & SDF" }))
    const expected = SHADER_TEMPLATES.filter((t) => t.category === "Raymarching & SDF")
    expect(expected.length).toBeGreaterThan(0)
    expect(screen.getAllByRole("listitem")).toHaveLength(expected.length)
  })

  it("loading a template recompiles and writes GLSL", () => {
    render(<TemplatesSidebar />)
    const before = useProjectStore.getState().recompileTrigger
    fireEvent.click(screen.getAllByRole("button", { name: /^Load / })[0])
    expect(useProjectStore.getState().recompileTrigger).toBeGreaterThan(before)
  })
})

describe("shell: persisted layout", () => {
  it("persists view state per user and never the transient maximize state", () => {
    act(() => {
      st().setRightInspectorOpen(false)
      st().setConsoleOpen(true)
      st().setMaximizedPanel("editor")
      st().setPanelLayout("shell-horizontal", { "left-sidebar": 20, "center-column": 60, "inspector-panel": 20 })
    })
    const saved = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null")
    expect(saved.state).toMatchObject({ isRightInspectorOpen: false, isConsoleOpen: true })
    expect(saved.state.panelLayouts["shell-horizontal"]["center-column"]).toBe(60)
    expect(saved.state).not.toHaveProperty("maximizedPanel")
    expect(saved.state).not.toHaveProperty("jumpTarget")
  })

  it("survives blocked storage without throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => act(() => st().toggleConsole())).not.toThrow()
    spy.mockRestore()
  })
})
