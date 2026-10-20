/**
 * Layout / workstation behaviour: layoutStore state machine (activity dock, inspector,
 * console, split/maximize, jumpToLine) and the real layout components that read it.
 * Consolidated from the M1/M5 layout adversarial suites (fleet w1-b-ui).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { useLayoutStore, type ActivityTab } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { ActivityBar } from "@/components/layout/ActivityBar"
import { SidebarDock } from "@/components/layout/SidebarDock"
import { CenterStage } from "@/components/layout/CenterStage"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { StatusBar } from "@/components/layout/StatusBar"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}))

// Heavy children are stubbed so only the layout components themselves are under test.
vi.mock("@/components/Viewport", () => ({
  Viewport: ({ className }: { className?: string }) => (
    <div data-testid="mock-viewport" className={className}>Mock Viewport</div>
  ),
}))
vi.mock("@/components/ShaderEditor", () => ({
  ShaderEditor: () => <div data-testid="mock-shader-editor">Mock Shader Editor</div>,
  COMPILER_MARKER_OWNER: "shaderstudio-compiler",
}))
vi.mock("@/components/ParameterPanel", () => ({
  ParameterPanel: () => <div data-testid="mock-parameter-panel">Mock Parameter Panel</div>,
}))
vi.mock("@/components/NodeGraph", () => ({
  NodeGraph: ({ className }: { className?: string }) => (
    <div data-testid="mock-node-graph" className={className}>Mock Node Graph</div>
  ),
}))
vi.mock("@/components/ProjectPanel", () => ({
  ProjectPanel: () => <div data-testid="mock-project-panel">Mock Project Panel</div>,
}))
vi.mock("@/components/FileImporter", () => ({
  FileImporter: () => <div data-testid="mock-file-importer">Mock File Importer</div>,
}))

const TABS: ActivityTab[] = ["graph", "project", "templates", "copilot"]
const st = () => useLayoutStore.getState()

describe("layoutStore: activity dock", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      activeActivityTab: "graph",
      isLeftSidebarOpen: true,
      isRightInspectorOpen: true,
      isConsoleOpen: false,
      splitOrientation: "vertical",
      maximizedPanel: "none",
      editorMinimap: false,
      jumpTarget: null,
    })
    useProjectStore.getState().resetProject()
    useFileSystemStore.setState({ bridgeConnected: false })
  })

  it("10,000 re-clicks of the active tab alternate collapse/open deterministically (0px collapse)", () => {
    for (let i = 0; i < 10000; i++) {
      st().toggleActivityTab("graph")
      if (i % 2 === 0) {
        expect(st().isLeftSidebarOpen).toBe(false)
        expect(st().activeActivityTab).toBeNull()
      } else {
        expect(st().isLeftSidebarOpen).toBe(true)
        expect(st().activeActivityTab).toBe("graph")
      }
    }
    expect(st().isLeftSidebarOpen).toBe(true)
    expect(st().activeActivityTab).toBe("graph")
  })

  it("round-robin across distinct tabs never collapses the dock", () => {
    st().setLeftSidebarOpen(false)
    for (let i = 0; i < 4000; i++) {
      const next = TABS[i % TABS.length]
      st().toggleActivityTab(next)
      expect(st().isLeftSidebarOpen).toBe(true)
      expect(st().activeActivityTab).toBe(next)
    }
  })

  it("re-clicking any active tab collapses the dock and nulls the active tab", () => {
    useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false })
    for (const tab of TABS) {
      st().toggleActivityTab(tab)
      expect(st().isLeftSidebarOpen).toBe(true)
      expect(st().activeActivityTab).toBe(tab)
      st().toggleActivityTab(tab)
      expect(st().isLeftSidebarOpen).toBe(false)
      expect(st().activeActivityTab).toBeNull()
    }
  })

  it("setLeftSidebarOpen(false) is idempotent and setLeftSidebarOpen(true) falls back to 'graph'", () => {
    st().toggleActivityTab("templates")
    for (let i = 0; i < 50; i++) {
      st().setLeftSidebarOpen(false)
      expect(st().isLeftSidebarOpen).toBe(false)
      expect(st().activeActivityTab).toBeNull()
    }
    st().setLeftSidebarOpen(true)
    expect(st().isLeftSidebarOpen).toBe(true)
    expect(st().activeActivityTab).toBe("graph")
  })

  it("interleaved toggleActivityTab and explicit setLeftSidebarOpen stay consistent", () => {
    for (let i = 0; i < 1000; i++) {
      st().toggleActivityTab("copilot")
      expect(st().isLeftSidebarOpen).toBe(true)
      expect(st().activeActivityTab).toBe("copilot")
      st().setLeftSidebarOpen(false)
      expect(st().isLeftSidebarOpen).toBe(false)
      expect(st().activeActivityTab).toBeNull()
      st().setLeftSidebarOpen(true)
      expect(st().activeActivityTab).toBe("graph")
      st().toggleActivityTab("graph")
      expect(st().isLeftSidebarOpen).toBe(false)
      st().toggleActivityTab("templates")
      expect(st().activeActivityTab).toBe("templates")
    }
  })

  it("ActivityBar markup reflects the active tab via aria-label + data-active", () => {
    useLayoutStore.setState({ activeActivityTab: "copilot", isLeftSidebarOpen: true })
    let html = renderToStaticMarkup(<ActivityBar />)
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toMatch(/aria-label="Copilot"[^>]*data-active="true"/)
    expect(html).toMatch(/aria-label="Graph"[^>]*data-active="false"/)

    for (const tab of TABS) {
      useLayoutStore.setState({ activeActivityTab: tab, isLeftSidebarOpen: true })
      expect(renderToStaticMarkup(<ActivityBar />)).toContain('data-active="true"')
    }

    useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false, isRightInspectorOpen: false })
    html = renderToStaticMarkup(<ActivityBar />)
    expect(html).not.toContain('data-active="true"')
    expect(html).toMatch(/aria-label="Copilot"[^>]*data-active="false"/)
  })

  it("SidebarDock tolerates an unknown tab id and renders nothing when closed", () => {
    useLayoutStore.setState({ activeActivityTab: "unknown" as never, isLeftSidebarOpen: true })
    expect(() => renderToStaticMarkup(<SidebarDock />)).not.toThrow()
    useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false })
    expect(renderToStaticMarkup(<SidebarDock />)).toBe("")
  })

  it("chaotic simultaneous toggling of dock / inspector / console keeps booleans valid", () => {
    for (let i = 0; i < 5000; i++) {
      if (i & 1) st().toggleActivityTab("graph")
      if (i & 2) st().toggleRightInspector()
      if (i & 4) st().toggleConsole()
      expect(typeof st().isLeftSidebarOpen).toBe("boolean")
      expect(typeof st().isRightInspectorOpen).toBe("boolean")
      expect(typeof st().isConsoleOpen).toBe("boolean")
    }
  })

  it("individual panel toggles flip only their own flag", () => {
    st().toggleRightInspector()
    expect(st().isRightInspectorOpen).toBe(false)
    st().toggleConsole()
    expect(st().isConsoleOpen).toBe(true)
    st().setRightInspectorOpen(true)
    st().setConsoleOpen(false)
    expect(st().isRightInspectorOpen).toBe(true)
    expect(st().isConsoleOpen).toBe(false)
    expect(st().isLeftSidebarOpen).toBe(true)
  })

  it("1,000 minimap toggles keep strict parity", () => {
    expect(st().editorMinimap).toBe(false)
    for (let i = 0; i < 1000; i++) {
      st().toggleEditorMinimap()
      expect(st().editorMinimap).toBe(i % 2 === 0)
    }
    expect(st().editorMinimap).toBe(false)
  })

  it("layout manipulation never dirties the project store; getInitialState is the SSR snapshot", () => {
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    st().toggleActivityTab("project")
    st().toggleRightInspector()
    st().toggleConsole()
    st().toggleSplitOrientation()
    st().toggleMaximizeViewport()
    st().toggleMaximizeViewport()
    st().toggleEditorMinimap()
    st().jumpToLine(99, 1)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)

    useLayoutStore.setState({ activeActivityTab: "copilot", isLeftSidebarOpen: false })
    expect(useLayoutStore.getInitialState().activeActivityTab).toBe("copilot")
    expect(useLayoutStore.getInitialState().isLeftSidebarOpen).toBe(false)
  })
})

describe("layoutStore: split / maximize", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      activeActivityTab: "graph",
      isLeftSidebarOpen: true,
      isRightInspectorOpen: true,
      isConsoleOpen: false,
      splitOrientation: "vertical",
      maximizedPanel: "none",
      editorMinimap: false,
      jumpTarget: null,
    })
  })

  it("Viewport and Editor are mutually exclusive when maximized", () => {
    expect(st().maximizedPanel).toBe("none")
    st().toggleMaximizeViewport()
    expect(st().maximizedPanel).toBe("viewport")
    st().toggleMaximizeEditor()
    expect(st().maximizedPanel).toBe("editor")
    st().toggleMaximizeViewport()
    expect(st().maximizedPanel).toBe("viewport")
    st().toggleMaximizeViewport()
    expect(st().maximizedPanel).toBe("none")
  })

  it("setMaximizedPanel cycles viewport -> editor -> none repeatedly", () => {
    for (let i = 0; i < 500; i++) {
      st().setMaximizedPanel("viewport")
      expect(st().maximizedPanel).toBe("viewport")
      st().setMaximizedPanel("editor")
      expect(st().maximizedPanel).toBe("editor")
      st().setMaximizedPanel("none")
      expect(st().maximizedPanel).toBe("none")
    }
  })

  it("2,000 maximize/restore cycles for each panel have no state drift", () => {
    for (let i = 0; i < 2000; i++) {
      st().toggleMaximizeViewport()
      expect(st().maximizedPanel).toBe(i % 2 === 0 ? "viewport" : "none")
    }
    for (let i = 0; i < 2000; i++) {
      st().toggleMaximizeEditor()
      expect(st().maximizedPanel).toBe(i % 2 === 0 ? "editor" : "none")
    }
  })

  it("mixed viewport/editor toggling for 10,000 rounds always yields a valid panel", () => {
    for (let i = 0; i < 10000; i++) {
      if (i % 3 === 1) st().toggleMaximizeEditor()
      else st().toggleMaximizeViewport()
      expect(["none", "viewport", "editor"]).toContain(st().maximizedPanel)
    }
  })

  it("1,000 split orientation toggles alternate and end back on vertical", () => {
    for (let i = 0; i < 1000; i++) {
      st().toggleSplitOrientation()
      expect(st().splitOrientation).toBe(i % 2 === 0 ? "horizontal" : "vertical")
    }
    expect(st().splitOrientation).toBe("vertical")
  })

  it("split orientation is preserved across maximize/restore of either panel", () => {
    st().toggleSplitOrientation()
    for (const toggle of [st().toggleMaximizeViewport, st().toggleMaximizeEditor]) {
      toggle()
      expect(st().maximizedPanel).not.toBe("none")
      expect(st().splitOrientation).toBe("horizontal")
      toggle()
      expect(st().maximizedPanel).toBe("none")
      expect(st().splitOrientation).toBe("horizontal")
    }
    // toggling orientation while a panel is maximized is retained after restore
    useLayoutStore.setState({ splitOrientation: "vertical" })
    st().toggleMaximizeViewport()
    st().toggleSplitOrientation()
    st().toggleMaximizeViewport()
    expect(st().splitOrientation).toBe("horizontal")
    expect(renderToStaticMarkup(<CenterStage />)).toContain("Split vertically")
  })
})

describe("layoutStore: jumpToLine", () => {
  beforeEach(() => {
    useLayoutStore.setState({ maximizedPanel: "none", jumpTarget: null })
    useProjectStore.getState().resetProject()
  })

  it("un-maximizes a maximized Viewport so the editor is revealed", () => {
    st().setMaximizedPanel("viewport")
    expect(renderToStaticMarkup(<CenterStage />)).toContain('data-maximized="viewport"')

    st().jumpToLine(42, 7)
    expect(st().maximizedPanel).toBe("none")
    expect(st().jumpTarget?.line).toBe(42)
    expect(st().jumpTarget?.column).toBe(7)
    expect(st().jumpTarget?.timestamp).toBeGreaterThan(0)

    const html = renderToStaticMarkup(<CenterStage />)
    expect(html).toContain('data-maximized="none"')
    expect(html).toContain("Mock Viewport")
    expect(html).toContain("Mock Shader Editor")
  })

  it("keeps a maximized Editor maximized and leaves split mode untouched", () => {
    st().setMaximizedPanel("editor")
    st().jumpToLine(108, 12)
    expect(st().maximizedPanel).toBe("editor")
    expect(st().jumpTarget?.line).toBe(108)
    expect(st().jumpTarget?.column).toBe(12)
    expect(renderToStaticMarkup(<CenterStage />)).toContain('data-maximized="editor"')

    useLayoutStore.setState({ maximizedPanel: "none" })
    st().jumpToLine(15, 3)
    expect(st().maximizedPanel).toBe("none")
    expect(st().jumpTarget).toMatchObject({ line: 15, column: 3 })
  })

  it("re-jumping to the exact same line advances the timestamp (so effects re-fire)", () => {
    let t = 1000
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (t += 10))
    st().jumpToLine(25, 4)
    const first = st().jumpTarget!.timestamp
    st().jumpToLine(25, 4)
    expect(st().jumpTarget!.timestamp).toBeGreaterThan(first)
    spy.mockRestore()
  })

  it("1,000 rapid jumps keep the line and a non-decreasing timestamp", () => {
    let prev = 0
    for (let i = 0; i < 1000; i++) {
      st().jumpToLine(i + 1, (i % 20) + 1)
      const cur = st().jumpTarget!
      expect(cur.line).toBe(i + 1)
      expect(cur.timestamp).toBeGreaterThanOrEqual(prev)
      prev = cur.timestamp
    }
  })

  // Contract: jumpToLine normalises line/column to integers >= 1 (Monaco cannot reveal anything else).
  it("clamps negative, zero and fractional line/column to integers >= 1", () => {
    st().jumpToLine(-50, -20)
    expect(st().jumpTarget).toMatchObject({ line: 1, column: 1 })
    st().jumpToLine(0, 0)
    expect(st().jumpTarget).toMatchObject({ line: 1, column: 1 })
    st().jumpToLine(15.9, 8.4)
    expect(st().jumpTarget).toMatchObject({ line: 15, column: 8 })
  })

  it("accepts very large line/column values without throwing", () => {
    st().jumpToLine(999999999, 1000000)
    expect(st().jumpTarget).toMatchObject({ line: 999999999, column: 1000000 })
  })
})

describe("layout components", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      activeActivityTab: "graph",
      isLeftSidebarOpen: true,
      isRightInspectorOpen: true,
      isConsoleOpen: false,
      splitOrientation: "vertical",
      maximizedPanel: "none",
      editorMinimap: false,
      jumpTarget: null,
    })
    useProjectStore.getState().resetProject()
    useFileSystemStore.setState({ bridgeConnected: false })
  })

  it("WorkspaceLayout renders the full shell with the inspector open", () => {
    const html = renderToStaticMarkup(<WorkspaceLayout />)
    for (const id of ["workspace-layout", "activity-bar", "status-bar", "center-stage", "right-inspector", "console-drawer"]) {
      expect(html).toContain(`data-testid="${id}"`)
    }
  })

  it("WorkspaceLayout with every peripheral panel closed keeps all panels mounted but inert", () => {
    useLayoutStore.setState({ isLeftSidebarOpen: false, activeActivityTab: null, isRightInspectorOpen: false, isConsoleOpen: false })
    const html = renderToStaticMarkup(<WorkspaceLayout />)
    for (const id of ["workspace-layout", "activity-bar", "center-stage", "status-bar", "right-inspector", "console-drawer"]) {
      expect(html).toContain(`data-testid="${id}"`)
    }
    expect(html).toMatch(/<aside[^>]*inert=""[^>]*data-testid="right-inspector"|<aside[^>]*data-testid="right-inspector"[^>]*inert=""/)
  })

  it("CenterStage marks the maximized mode and keeps both panes in the DOM", () => {
    for (const mode of ["viewport", "editor", "none"] as const) {
      useLayoutStore.setState({ maximizedPanel: mode })
      const html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain(`data-maximized="${mode}"`)
      expect(html).toContain("Mock Viewport")
      expect(html).toContain("Mock Shader Editor")
    }
  })

  it("CenterStage separator is horizontal or vertical with the split orientation", () => {
    useLayoutStore.setState({ splitOrientation: "vertical" })
    expect(renderToStaticMarkup(<CenterStage />)).toContain('aria-orientation="horizontal"')
    useLayoutStore.setState({ splitOrientation: "horizontal" })
    expect(renderToStaticMarkup(<CenterStage />)).toContain('aria-orientation="vertical"')
  })

  it("CenterStage falls back to the split view on a malformed maximizedPanel", () => {
    useLayoutStore.setState({ maximizedPanel: "invalid_panel" as never })
    const html = renderToStaticMarkup(<CenterStage />)
    expect(html).toContain("Mock Viewport")
    expect(html).toContain("Mock Shader Editor")
  })

  it("CenterStage action buttons follow the mode", () => {
    useLayoutStore.setState({ maximizedPanel: "viewport" })
    let html = renderToStaticMarkup(<CenterStage />)
    expect(html).toContain("Restore layout")
    expect(html).not.toContain("Maximize viewport")
    expect(html).not.toContain("Split horizontally")

    useLayoutStore.setState({ maximizedPanel: "none", splitOrientation: "vertical" })
    html = renderToStaticMarkup(<CenterStage />)
    expect(html).toContain("Maximize viewport")
    expect(html).toContain("Maximize editor")
    expect(html).toContain("Split horizontally")
    expect(html).not.toContain("Restore layout")
  })

  it("ConsoleDrawer shows per-error cards with line refs, Jump and Clear, and resets when cleared", () => {
    useProjectStore.getState().setLastCompileError(
      "ERROR: 0:15: 'u_diffuse' : undeclared identifier\nERROR: 0:28: 'pos' : syntax error"
    )
    let html = renderToStaticMarkup(<ConsoleDrawer />)
    expect(html).toContain("2 Errors")
    expect(html).toContain("[Line 15]")
    expect(html).toContain("[Line 28]")
    expect(html).toContain("Clear")
    expect(html).toContain("Jump")

    useProjectStore.getState().setLastCompileError(null)
    html = renderToStaticMarkup(<ConsoleDrawer />)
    expect(html).toContain("0 Errors")
    expect(html).toContain("No compilation errors or diagnostics.")
    expect(html).not.toContain("Clear")
  })

  it("ConsoleDrawer column-qualified error renders [Line L:C] and the Jump action drives jumpToLine", () => {
    useLayoutStore.getState().setMaximizedPanel("viewport")
    useProjectStore.getState().setLastCompileError(":33:14: error: unresolved reference 'foo'")
    const html = renderToStaticMarkup(<ConsoleDrawer />)
    expect(html).toContain("[Line 33:14]")
    expect(html).toContain("unresolved reference &#x27;foo&#x27;")
    expect(html).toContain("Jump")

    st().jumpToLine(33, 14)
    expect(st().maximizedPanel).toBe("none")
    expect(st().jumpTarget).toMatchObject({ line: 33, column: 14 })
  })

  it("ConsoleDrawer error without a line number offers no Jump button", () => {
    useProjectStore.getState().setLastCompileError("Shader execution timeout / watchdog trigger")
    const html = renderToStaticMarkup(<ConsoleDrawer />)
    expect(html).toContain("1 Error")
    expect(html).toContain("Shader execution timeout / watchdog trigger")
    expect(html).not.toContain("Jump")
  })

  it("StatusBar renders language, bridge state and console toggle", () => {
    const html = renderToStaticMarkup(<StatusBar />)
    expect(html).toContain('data-testid="status-bar"')
    expect(html).toContain("WGSL")
    expect(html).toContain("Bridge offline")
    expect(html).toContain("Toggle console")
  })
})
