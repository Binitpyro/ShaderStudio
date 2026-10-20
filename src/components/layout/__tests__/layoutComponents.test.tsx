// @vitest-environment happy-dom
import "../../../../tests/setup/rtl"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { ActivityBar } from "../ActivityBar"
import { SidebarDock } from "../SidebarDock"
import { CenterStage } from "../CenterStage"
import { RightInspector } from "../RightInspector"
import { StatusBar } from "../StatusBar"
import { WorkspaceLayout } from "../WorkspaceLayout"

vi.mock("@/components/Viewport", () => ({ Viewport: () => <div data-testid="mock-viewport">Mock Viewport</div> }))
vi.mock("@/components/ShaderEditor", () => ({ ShaderEditor: () => <div data-testid="mock-shader-editor">Mock Shader Editor</div>, COMPILER_MARKER_OWNER: "shaderstudio-compiler" }))
vi.mock("@/components/ParameterPanel", () => ({ ParameterPanel: () => <div data-testid="mock-parameter-panel">Mock Parameter Panel</div> }))
vi.mock("@/components/NodeGraph", () => ({ NodeGraph: () => <div data-testid="mock-node-graph">Mock Node Graph</div> }))
vi.mock("@/components/ProjectPanel", () => ({ ProjectPanel: () => <div>Mock Project Panel</div> }))
vi.mock("@/components/FileImporter", () => ({ FileImporter: () => <div>Mock File Importer</div> }))
vi.mock("@/components/layout/ConsoleDrawer", () => ({ ConsoleDrawer: () => <div data-testid="console-drawer">Mock Console</div> }))

describe("Layout components", () => {
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
    it("renders the four views as a labelled tablist inside a labelled navigation landmark", () => {
      render(<ActivityBar />)
      expect(screen.getByRole("navigation", { name: "Activity bar" })).toBeTruthy()
      const tabs = within(screen.getByRole("tablist")).getAllByRole("tab")
      expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Graph", "Project", "Templates", "Copilot"])
      expect(tabs[0].getAttribute("aria-selected")).toBe("true")
      expect(tabs[0].getAttribute("aria-controls")).toBe("left-sidebar-dock")
    })

    it("clicking the active tab collapses the sidebar; another tab switches and opens it", () => {
      render(<ActivityBar />)
      fireEvent.click(screen.getByRole("tab", { name: "Graph" }))
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
      fireEvent.click(screen.getByRole("tab", { name: "Project" }))
      expect(useLayoutStore.getState()).toMatchObject({ isLeftSidebarOpen: true, activeActivityTab: "project" })
    })

    it("arrow keys move roving focus", () => {
      render(<ActivityBar />)
      const graph = screen.getByRole("tab", { name: "Graph" })
      graph.focus()
      fireEvent.keyDown(graph, { key: "ArrowDown" })
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Project" }))
    })

    it("carries no theme or inspector toggles (single home: the top bar)", () => {
      render(<ActivityBar />)
      expect(screen.queryByLabelText(/theme/i)).toBeNull()
      expect(screen.queryByLabelText(/inspector/i)).toBeNull()
    })
  })

  describe("SidebarDock", () => {
    it("shows the graph sidebar with a close button that collapses the dock", () => {
      render(<SidebarDock />)
      expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy()
      expect(screen.getByTestId("mock-node-graph")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }))
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
    })

    it("renders nothing when there is no active tab and none was shown", () => {
      useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false })
      const { container } = render(<SidebarDock />)
      expect(container.innerHTML).toBe("")
    })

    it("keeps the last tab mounted but inert after collapsing", () => {
      const { container, rerender } = render(<SidebarDock />)
      useLayoutStore.getState().setLeftSidebarOpen(false)
      rerender(<SidebarDock />)
      const aside = container.querySelector("aside")!
      expect(aside.hasAttribute("inert")).toBe(true)
      expect(screen.getByTestId("mock-node-graph")).toBeTruthy()
    })
  })

  describe("CenterStage", () => {
    it("shows viewport and editor with maximize and split controls", () => {
      render(<CenterStage />)
      expect(screen.getByTestId("mock-viewport")).toBeTruthy()
      expect(screen.getByTestId("mock-shader-editor")).toBeTruthy()
      expect(screen.getByRole("button", { name: "Maximize viewport" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Maximize editor" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Split horizontally" })).toBeTruthy()
    })

    it("maximize toggles store state and the label becomes Restore layout", () => {
      render(<CenterStage />)
      fireEvent.click(screen.getByRole("button", { name: "Maximize viewport" }))
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")
      expect(screen.getByTestId("center-stage").getAttribute("data-maximized")).toBe("viewport")
      fireEvent.click(screen.getByRole("button", { name: "Restore layout" }))
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    })

    it("split toggle flips the orientation", () => {
      render(<CenterStage />)
      fireEvent.click(screen.getByRole("button", { name: "Split horizontally" }))
      expect(useLayoutStore.getState().splitOrientation).toBe("horizontal")
      expect(screen.getByRole("button", { name: "Split vertically" })).toBeTruthy()
    })
  })

  describe("RightInspector", () => {
    it("renders a labelled inspector with a collapse button and the parameter panel", () => {
      render(<RightInspector />)
      expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy()
      expect(screen.getByTestId("mock-parameter-panel")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Collapse inspector" }))
      expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)
    })
  })

  describe("StatusBar", () => {
    it("shows error count, language, bridge state and toggles the console", () => {
      render(<StatusBar />)
      expect(screen.getByTestId("status-bar")).toBeTruthy()
      expect(screen.getByTestId("status-error-count").textContent).toBe("0 errors")
      expect(screen.getByText(/WGSL/)).toBeTruthy()
      expect(screen.getByText(/Bridge/)).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Toggle console" }))
      expect(useLayoutStore.getState().isConsoleOpen).toBe(true)
    })

    it("counts a compile error", () => {
      useProjectStore.getState().setLastCompileError(":15:8 error: invalid type")
      render(<StatusBar />)
      expect(screen.getByTestId("status-error-count").textContent).toBe("1 error")
    })
  })

  describe("WorkspaceLayout", () => {
    it("renders activity bar, stage, inspector, console and status bar together", () => {
      render(<WorkspaceLayout />)
      for (const id of ["workspace-layout", "activity-bar", "center-stage", "right-inspector", "console-drawer", "status-bar"]) {
        expect(screen.getByTestId(id)).toBeTruthy()
      }
    })
  })
})
