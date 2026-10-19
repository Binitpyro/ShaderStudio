import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { ActivityBar } from "../ActivityBar"
import { SidebarDock } from "../SidebarDock"
import { CenterStage } from "../CenterStage"
import { RightInspector } from "../RightInspector"
import { ConsoleDrawer } from "../ConsoleDrawer"
import { StatusBar } from "../StatusBar"
import { WorkspaceLayout } from "../WorkspaceLayout"

// Mock next-themes
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

// Mock heavy sub-components to keep unit tests fast and focused on layout
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

describe("Layout Components (Requirement R1)", () => {
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
  })

  describe("ActivityBar", () => {
    it("renders 4 activity tabs with labels and icons", () => {
      const html = renderToStaticMarkup(<ActivityBar />)

      expect(html).toContain("Node Graph")
      expect(html).toContain("Project Explorer")
      expect(html).toContain("Shaders &amp; Templates")
      expect(html).toContain("AI Copilot")
      expect(html).toContain("data-testid=\"activity-bar\"")
    })

    it("indicates active tab when left sidebar is open", () => {
      useLayoutStore.setState({ activeActivityTab: "graph", isLeftSidebarOpen: true })
      const html = renderToStaticMarkup(<ActivityBar />)
      expect(html).toContain("data-active=\"true\"")
    })

    it("provides W3C ARIA landmarks, roles, and controls in ActivityBar", () => {
      useLayoutStore.setState({ activeActivityTab: "graph", isLeftSidebarOpen: true })
      const html = renderToStaticMarkup(<ActivityBar />)
      expect(html).toContain("aria-label=\"Activity Bar\"")
      expect(html).toContain("role=\"tablist\"")
      expect(html).toContain("role=\"tab\"")
      expect(html).toContain("aria-controls=\"left-sidebar-dock\"")
      expect(html).toContain("aria-selected=\"true\"")
    })

    it("renders theme toggle and inspector toggle buttons", () => {
      const html = renderToStaticMarkup(<ActivityBar />)
      expect(html).toContain("Toggle Theme")
      expect(html).toContain("Toggle Inspector")
    })

    it("toggling activity tab updates layoutStore state correctly", () => {
      useLayoutStore.getState().toggleActivityTab("graph")
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
      expect(useLayoutStore.getState().activeActivityTab).toBeNull()

      useLayoutStore.getState().toggleActivityTab("project")
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
      expect(useLayoutStore.getState().activeActivityTab).toBe("project")
    })
  })

  describe("SidebarDock", () => {
    it("renders NodeGraphSidebar when active tab is 'graph' with ARIA region and close button", () => {
      useLayoutStore.setState({ activeActivityTab: "graph", isLeftSidebarOpen: true })
      const html = renderToStaticMarkup(<SidebarDock />)
      expect(html).toContain("Mock Node Graph")
      expect(html).toContain("Node Graph")
      expect(html).toContain("id=\"left-sidebar-dock\"")
      expect(html).toContain("role=\"region\"")
      expect(html).toContain("aria-label=\"Primary Sidebar\"")
      expect(html).toContain("Close Sidebar (Ctrl+B)")
      expect(html).not.toContain("select-none")
    })

    it("returns null if activeActivityTab is null", () => {
      useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false })
      const html = renderToStaticMarkup(<SidebarDock />)
      expect(html).toBe("")
    })
  })

  describe("CenterStage", () => {
    it("renders dual-split Viewport and Monaco Editor in normal mode", () => {
      useLayoutStore.setState({ maximizedPanel: "none", splitOrientation: "vertical" })
      const html = renderToStaticMarkup(<CenterStage />)

      expect(html).toContain("data-testid=\"center-stage-split\"")
      expect(html).toContain("3D Viewport")
      expect(html).toContain("Shader Editor")
      expect(html).toContain("Mock Viewport")
      expect(html).toContain("Mock Shader Editor")
      expect(html).toContain("Maximize Viewport")
      expect(html).toContain("Maximize Editor")
      expect(html).toContain("Split Horizontally")
    })

    it("renders horizontal split toggle button when in horizontal orientation", () => {
      useLayoutStore.setState({ maximizedPanel: "none", splitOrientation: "horizontal" })
      const html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("Split Vertically")
    })

    it("renders 100% Viewport with Restore button when Viewport is maximized", () => {
      useLayoutStore.setState({ maximizedPanel: "viewport" })
      const html = renderToStaticMarkup(<CenterStage />)

      expect(html).toContain("data-testid=\"center-stage-max-viewport\"")
      expect(html).toContain("3D Viewport (Maximized)")
      expect(html).toContain("Restore Split")
      expect(html).toContain("Mock Viewport")
      expect(html).not.toContain("Mock Shader Editor")
    })

    it("renders 100% Shader Editor with Restore button when Editor is maximized", () => {
      useLayoutStore.setState({ maximizedPanel: "editor" })
      const html = renderToStaticMarkup(<CenterStage />)

      expect(html).toContain("data-testid=\"center-stage-max-editor\"")
      expect(html).toContain("Shader Editor (Maximized)")
      expect(html).toContain("Restore Split")
      expect(html).toContain("Mock Shader Editor")
      expect(html).not.toContain("Mock Viewport")
    })

    it("restores split mode when toggleMaximizeViewport is invoked from maximized state", () => {
      useLayoutStore.setState({ maximizedPanel: "viewport" })
      useLayoutStore.getState().toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    })
  })

  describe("RightInspector", () => {
    it("renders Inspector header, toggle collapse button and ParameterPanel", () => {
      const html = renderToStaticMarkup(<RightInspector />)

      expect(html).toContain("data-testid=\"right-inspector\"")
      expect(html).toContain("Inspector")
      expect(html).toContain("Collapse Inspector")
      expect(html).toContain("Mock Parameter Panel")
    })

    it("toggleRightInspector updates layoutStore state", () => {
      expect(useLayoutStore.getState().isRightInspectorOpen).toBe(true)
      useLayoutStore.getState().toggleRightInspector()
      expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)
    })
  })

  describe("ConsoleDrawer", () => {
    it("renders clean state when there are 0 compile errors", () => {
      useProjectStore.getState().setLastCompileError(null)
      const html = renderToStaticMarkup(<ConsoleDrawer />)

      expect(html).toContain("data-testid=\"console-drawer\"")
      expect(html).toContain("Console &amp; Diagnostics")
      expect(html).toContain("0 Errors")
      expect(html).toContain("No compilation errors or diagnostics.")
    })

    it("renders error cards with line numbers, clear button, and jump button when compile error occurs", () => {
      useProjectStore.getState().setLastCompileError(":15:8 error: invalid type")
      const html = renderToStaticMarkup(<ConsoleDrawer />)

      expect(html).toContain("1 Error")
      expect(html).toContain("[Line 15:8]")
      expect(html).toContain("Clear")
      expect(html).toContain("Jump")
    })

    it("clearing error resets compile error in store", () => {
      useProjectStore.getState().setLastCompileError(":15:8 error: invalid type")
      expect(useProjectStore.getState().lastCompileError).not.toBeNull()
      useProjectStore.getState().setLastCompileError(null)
      expect(useProjectStore.getState().lastCompileError).toBeNull()
    })

    it("invoking jumpToLine sets jumpTarget in layoutStore", () => {
      useLayoutStore.getState().jumpToLine(15, 8)
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(15)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(8)
    })
  })

  describe("StatusBar", () => {
    it("renders footer with console toggle, error count, language, and telemetry", () => {
      const html = renderToStaticMarkup(<StatusBar />)

      expect(html).toContain("data-testid=\"status-bar\"")
      expect(html).toContain("Toggle Console Drawer")
      expect(html).toContain("0 Errors")
      expect(html).toContain("Node Graph")
      expect(html).toContain("WGSL")
      expect(html).toContain("Bridge:")
      expect(html).toContain("FPS")
    })

    it("toggling console updates isConsoleOpen in layoutStore", () => {
      expect(useLayoutStore.getState().isConsoleOpen).toBe(false)
      useLayoutStore.getState().toggleConsole()
      expect(useLayoutStore.getState().isConsoleOpen).toBe(true)
    })
  })

  describe("WorkspaceLayout", () => {
    it("renders the root layout coordinator with ActivityBar, stage, and StatusBar", () => {
      const html = renderToStaticMarkup(<WorkspaceLayout />)

      expect(html).toContain("data-testid=\"workspace-layout\"")
      expect(html).toContain("data-testid=\"activity-bar\"")
      expect(html).toContain("data-testid=\"status-bar\"")
    })
  })
})
