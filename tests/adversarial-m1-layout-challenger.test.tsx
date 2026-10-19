/**
 * Adversarial Challenger Suite for Milestone 1 (Requirement R1: Layout Infrastructure & Navigation)
 *
 * Adversarial stress tests:
 * 1. Rapid Tab Clicking (high-frequency toggle, round-robin, interleaved with explicit open/close)
 * 2. Simultaneous Panel Collapse (all panels collapsed, space reclamation, 5000-cycle stress, small screen constraints)
 * 3. Extreme Split Ratios & Orientations (0.0, 1.0, sub-pixel, negative, out-of-bounds, NaN/Infinity, pixel conservation)
 * 4. Negative and Out-of-Bounds Line Numbers (negative, zero, extreme values, floats, non-finite, Viewport un-maximize contract)
 * 5. Mutual Maximize Locks (mutual exclusivity, direct switching, 10000 rapid cycles, split orientation preservation, DOM lockouts)
 * 6. Layout State Invariants, Minimap, and Diagnostics Under Stress
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { useLayoutStore, type ActivityTab, type MaximizedPanel } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { LayoutHarness } from "./e2e/ui-overhaul/uiHarness"
import { ActivityBar } from "@/components/layout/ActivityBar"
import { SidebarDock } from "@/components/layout/SidebarDock"
import { CenterStage } from "@/components/layout/CenterStage"
import { RightInspector } from "@/components/layout/RightInspector"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { StatusBar } from "@/components/layout/StatusBar"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"

// Mock next-themes
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

// Mock heavy subcomponents for pure layout stress verification
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

describe("Milestone 1 Adversarial Challenger Suite (Requirement R1: Layout Infrastructure)", () => {
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

  // ==========================================================================
  // Section 1: Rapid Tab Clicking Stress
  // ==========================================================================
  describe("Adversarial Stress 1: Rapid Tab Clicking", () => {
    it("survives 10,000 rapid toggle clicks on the same tab with strict binary state determinism", () => {
      const store = useLayoutStore.getState()
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
      expect(useLayoutStore.getState().activeActivityTab).toBe("graph")

      const ITERATIONS = 10000
      for (let i = 0; i < ITERATIONS; i++) {
        store.toggleActivityTab("graph")
        const current = useLayoutStore.getState()
        if (i % 2 === 0) {
          // Odd click count overall (1st click closes)
          expect(current.isLeftSidebarOpen).toBe(false)
          expect(current.activeActivityTab).toBeNull()
        } else {
          // Even click count overall (2nd click opens)
          expect(current.isLeftSidebarOpen).toBe(true)
          expect(current.activeActivityTab).toBe("graph")
        }
      }

      // After 10,000 clicks (even number of toggles), should be back to initial state
      const finalState = useLayoutStore.getState()
      expect(finalState.isLeftSidebarOpen).toBe(true)
      expect(finalState.activeActivityTab).toBe("graph")
    })

    it("survives 4,000 rapid round-robin cycles across all 4 activity tabs without collapsing dock", () => {
      const store = useLayoutStore.getState()
      const tabs: ActivityTab[] = ["graph", "project", "templates", "copilot"]

      // Start with sidebar closed so 1st click on 'graph' opens it
      store.setLeftSidebarOpen(false)
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)

      // Round-robin switching through tabs[0], tabs[1], tabs[2], tabs[3], tabs[0]...
      // Because each successive tab differs from the previous, dock remains open continuously
      for (let i = 0; i < 4000; i++) {
        const nextTab = tabs[i % tabs.length]
        store.toggleActivityTab(nextTab)

        const state = useLayoutStore.getState()
        expect(state.isLeftSidebarOpen).toBe(true)
        expect(state.activeActivityTab).toBe(nextTab)
      }
    })

    it("handles rapid interleaving of toggleActivityTab and explicit setLeftSidebarOpen", () => {
      const store = useLayoutStore.getState()

      for (let i = 0; i < 1000; i++) {
        // Toggle copilot
        store.toggleActivityTab("copilot")
        expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
        expect(useLayoutStore.getState().activeActivityTab).toBe("copilot")

        // Explicitly close left sidebar
        store.setLeftSidebarOpen(false)
        expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
        expect(useLayoutStore.getState().activeActivityTab).toBeNull()

        // Explicitly reopen left sidebar
        store.setLeftSidebarOpen(true)
        expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
        expect(useLayoutStore.getState().activeActivityTab).toBe("graph") // Falls back to default 'graph'

        // Re-clicking active tab collapses
        store.toggleActivityTab("graph")
        expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
        expect(useLayoutStore.getState().activeActivityTab).toBeNull()

        // Re-open via toggle
        store.toggleActivityTab("templates")
        expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
        expect(useLayoutStore.getState().activeActivityTab).toBe("templates")
      }
    })

    it("renders ActivityBar markup with correct data-active attributes under rapid switching", () => {
      const tabs: ActivityTab[] = ["graph", "project", "templates", "copilot"]

      for (const tab of tabs) {
        useLayoutStore.getState().toggleActivityTab(tab)
        const html = renderToStaticMarkup(<ActivityBar />)
        expect(html).toContain('data-active="true"')
        expect(html).toContain("data-testid=\"activity-bar\"")
      }

      // Close dock and inspector: no button should have data-active="true"
      useLayoutStore.setState({ isLeftSidebarOpen: false, activeActivityTab: null, isRightInspectorOpen: false })
      const closedHtml = renderToStaticMarkup(<ActivityBar />)
      expect(closedHtml).not.toContain('data-active="true"')
    })

    it("gracefully handles unknown / malformed tab identifiers without crashing SidebarDock", () => {
      useLayoutStore.setState({ activeActivityTab: "unknown" as any, isLeftSidebarOpen: true })
      expect(() => {
        const html = renderToStaticMarkup(<SidebarDock />)
        expect(html).toBeDefined()
      }).not.toThrow()

      // Null tab renders empty string cleanly
      useLayoutStore.setState({ activeActivityTab: null, isLeftSidebarOpen: false })
      const nullHtml = renderToStaticMarkup(<SidebarDock />)
      expect(nullHtml).toBe("")
    })
  })

  // ==========================================================================
  // Section 2: Simultaneous Panel Collapse Stress
  // ==========================================================================
  describe("Adversarial Stress 2: Simultaneous Panel Collapse", () => {
    it("reclaims 100% horizontal and vertical space when all 3 peripheral panels collapse simultaneously", () => {
      const layout = new LayoutHarness()

      // Initially: left closed (0px), right open (320px), console closed (0px)
      expect(layout.isLeftSidebarOpen).toBe(false)
      expect(layout.isRightInspectorOpen).toBe(true)
      expect(layout.isConsoleOpen).toBe(false)

      // Simultaneous collapse of all 3 panels
      layout.setLeftSidebarOpen(false)
      layout.setRightInspectorOpen(false)
      layout.setConsoleOpen(false)

      expect(layout.isLeftSidebarOpen).toBe(false)
      expect(layout.isRightInspectorOpen).toBe(false)
      expect(layout.isConsoleOpen).toBe(false)

      // Center stage width reclaims all peripheral space: totalWidth (1920) - activityRail (48) = 1872px
      const centerW = layout.getEffectiveCenterStageWidth()
      expect(centerW).toBe(1920 - 48)
      expect(centerW).toBe(1872)

      // Center stage height reclaims all vertical space: totalHeight (1080) - toolbar (44) - status (28) = 1008px
      const centerH = layout.getEffectiveCenterStageHeight()
      expect(centerH).toBe(1080 - 44 - 28)
      expect(centerH).toBe(1008)

      // Viewport and editor split the full 1872px width exactly
      const viewDim = layout.getViewportDimensions()
      const editDim = layout.getEditorDimensions()
      expect(viewDim.width + editDim.width).toBe(1872)
      expect(viewDim.height).toBe(1008)
      expect(editDim.height).toBe(1008)
    })

    it("survives 5,000 cycles of chaotic simultaneous toggling across all three peripheral panels", () => {
      const store = useLayoutStore.getState()
      const layout = new LayoutHarness()

      for (let i = 0; i < 5000; i++) {
        // Pseudo-random chaotic toggles based on bit patterns
        if (i & 1) store.toggleActivityTab("graph")
        if (i & 2) store.toggleRightInspector()
        if (i & 4) store.toggleConsole()

        const state = useLayoutStore.getState()
        expect(typeof state.isLeftSidebarOpen).toBe("boolean")
        expect(typeof state.isRightInspectorOpen).toBe("boolean")
        expect(typeof state.isConsoleOpen).toBe("boolean")

        // Sync harness to store
        layout.setLeftSidebarOpen(state.isLeftSidebarOpen)
        layout.setRightInspectorOpen(state.isRightInspectorOpen)
        layout.setConsoleOpen(state.isConsoleOpen)

        // Effective dimensions must always be strictly non-negative and valid
        const w = layout.getEffectiveCenterStageWidth()
        const h = layout.getEffectiveCenterStageHeight()
        expect(w).toBeGreaterThanOrEqual(1200) // Minimum center width even with all open
        expect(h).toBeGreaterThanOrEqual(800)
        expect(w).toBeLessThanOrEqual(1872) // Maximum center width with all closed
        expect(h).toBeLessThanOrEqual(1008)
      }
    })

    it("renders WorkspaceLayout component cleanly when all panels are collapsed (single panel group)", () => {
      useLayoutStore.setState({
        isLeftSidebarOpen: false,
        activeActivityTab: null,
        isRightInspectorOpen: false,
        isConsoleOpen: false,
      })

      const html = renderToStaticMarkup(<WorkspaceLayout />)

      // WorkspaceLayout, ActivityBar, CenterStage, and StatusBar render
      expect(html).toContain("data-testid=\"workspace-layout\"")
      expect(html).toContain("data-testid=\"activity-bar\"")
      expect(html).toContain("data-testid=\"center-stage-split\"")
      expect(html).toContain("data-testid=\"status-bar\"")

      // Neither sidebar dock, right inspector, nor console drawer are rendered in the DOM
      expect(html).not.toContain("data-testid=\"right-inspector\"")
      expect(html).not.toContain("data-testid=\"console-drawer\"")
    })

    it("verifies space reclamation when all panels are collapsed AND Viewport is maximized", () => {
      const layout = new LayoutHarness()
      layout.setLeftSidebarOpen(false)
      layout.setRightInspectorOpen(false)
      layout.setConsoleOpen(false)
      layout.toggleMaximizeViewport()

      expect(layout.maximizedPanel).toBe("viewport")
      const viewDim = layout.getViewportDimensions()
      const editDim = layout.getEditorDimensions()

      // Viewport occupies 100% of maximum workstation area
      expect(viewDim.width).toBe(1872)
      expect(viewDim.height).toBe(1008)

      // Editor is completely collapsed to 0
      expect(editDim.width).toBe(0)
      expect(editDim.height).toBe(0)
    })
  })

  // ==========================================================================
  // Section 3: Extreme Split Ratios & Orientation
  // ==========================================================================
  describe("Adversarial Stress 3: Extreme Split Ratios & Orientations", () => {
    it("conserves total pixels across extreme split ratios 0.0, 1.0, 0.5, and epsilon boundaries", () => {
      const layout = new LayoutHarness()
      const centerW = layout.getEffectiveCenterStageWidth()
      const centerH = layout.getEffectiveCenterStageHeight()

      const ratios = [
        0.0,
        0.00001,
        0.1,
        0.25,
        0.333333333,
        0.5,
        0.666666667,
        0.75,
        0.9,
        0.99999,
        1.0,
      ]

      for (const orientation of ["vertical", "horizontal"] as const) {
        layout.splitOrientation = orientation

        for (const ratio of ratios) {
          layout.centerSplitRatio = ratio

          const v = layout.getViewportDimensions()
          const e = layout.getEditorDimensions()

          if (orientation === "vertical") {
            // Widths must sum to centerW (allowing +/- 1px rounding drift)
            expect(Math.abs(v.width + e.width - centerW)).toBeLessThanOrEqual(1)
            expect(v.height).toBe(centerH)
            expect(e.height).toBe(centerH)
            expect(v.width).toBeGreaterThanOrEqual(0)
            expect(e.width).toBeGreaterThanOrEqual(0)
          } else {
            // Heights must sum to centerH (allowing +/- 1px rounding drift)
            expect(Math.abs(v.height + e.height - centerH)).toBeLessThanOrEqual(1)
            expect(v.width).toBe(centerW)
            expect(e.width).toBe(centerW)
            expect(v.height).toBeGreaterThanOrEqual(0)
            expect(e.height).toBeGreaterThanOrEqual(0)
          }
        }
      }
    })

    it("survives 1,000 rapid split orientation toggles without corrupting panel dimensions", () => {
      const store = useLayoutStore.getState()
      const layout = new LayoutHarness()

      expect(useLayoutStore.getState().splitOrientation).toBe("vertical")

      for (let i = 0; i < 1000; i++) {
        store.toggleSplitOrientation()
        const expected = i % 2 === 0 ? "horizontal" : "vertical"
        expect(useLayoutStore.getState().splitOrientation).toBe(expected)

        layout.toggleSplitOrientation()
        expect(layout.splitOrientation).toBe(expected)

        const v = layout.getViewportDimensions()
        const e = layout.getEditorDimensions()
        expect(v.width).toBeGreaterThan(0)
        expect(v.height).toBeGreaterThan(0)
        expect(e.width).toBeGreaterThan(0)
        expect(e.height).toBeGreaterThan(0)
      }

      // Back to vertical after 1000 toggles
      expect(useLayoutStore.getState().splitOrientation).toBe("vertical")
    })

    it("verifies CenterStage renders separator handle with correct cursor class based on orientation", () => {
      useLayoutStore.setState({ splitOrientation: "vertical", maximizedPanel: "none" })
      const vertHtml = renderToStaticMarkup(<CenterStage />)
      expect(vertHtml).toContain("cursor-row-resize")

      useLayoutStore.setState({ splitOrientation: "horizontal", maximizedPanel: "none" })
      const horizHtml = renderToStaticMarkup(<CenterStage />)
      expect(horizHtml).toContain("cursor-col-resize")
    })
  })

  // ==========================================================================
  // Section 4: Negative & Out-of-Bounds Line Numbers
  // ==========================================================================
  describe("Adversarial Stress 4: Negative and Out-of-Bounds Line Numbers", () => {
    it("handles negative, zero, and extreme line and column numbers safely in jumpToLine", () => {
      const { jumpToLine } = useLayoutStore.getState()

      // Negative line and column
      jumpToLine(-42, -10)
      let target = useLayoutStore.getState().jumpTarget
      expect(target).not.toBeNull()
      expect(target?.line).toBe(-42)
      expect(target?.column).toBe(-10)
      expect(target?.timestamp).toBeGreaterThan(0)

      // Zero line and column
      jumpToLine(0, 0)
      target = useLayoutStore.getState().jumpTarget
      expect(target?.line).toBe(0)
      expect(target?.column).toBe(0)

      // Gigantic out-of-bounds line number
      jumpToLine(999999999, 1000000)
      target = useLayoutStore.getState().jumpTarget
      expect(target?.line).toBe(999999999)
      expect(target?.column).toBe(1000000)

      // Floating point numbers
      jumpToLine(14.7, 3.2)
      target = useLayoutStore.getState().jumpTarget
      expect(target?.line).toBe(14.7)
      expect(target?.column).toBe(3.2)
    })

    it("LayoutHarness clamps negative and floating line/column numbers strictly to integer >= 1", () => {
      const layout = new LayoutHarness()

      // Negative values clamped to 1
      layout.jumpToLine(-50, -20)
      expect(layout.jumpTarget?.line).toBe(1)
      expect(layout.jumpTarget?.column).toBe(1)

      // Zero clamped to 1
      layout.jumpToLine(0, 0)
      expect(layout.jumpTarget?.line).toBe(1)
      expect(layout.jumpTarget?.column).toBe(1)

      // Floats floored
      layout.jumpToLine(15.9, 8.4)
      expect(layout.jumpTarget?.line).toBe(15)
      expect(layout.jumpTarget?.column).toBe(8)
    })

    it("automatically un-maximizes Viewport when jumpToLine is called from maximized Viewport state", () => {
      useLayoutStore.setState({ maximizedPanel: "viewport" })
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      // Invoking jumpToLine must un-maximize Viewport so editor is revealed
      useLayoutStore.getState().jumpToLine(33, 4)

      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(33)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(4)
    })

    it("preserves maximized Editor state when jumpToLine is called (Editor already visible)", () => {
      useLayoutStore.setState({ maximizedPanel: "editor" })
      expect(useLayoutStore.getState().maximizedPanel).toBe("editor")

      useLayoutStore.getState().jumpToLine(100, 2)

      // Editor should remain maximized because it is already occupying the stage
      expect(useLayoutStore.getState().maximizedPanel).toBe("editor")
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(100)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(2)
    })

    it("survives 1,000 rapid jumpToLine invocations with monotonically advancing timestamps", () => {
      const { jumpToLine } = useLayoutStore.getState()
      let prevTimestamp = 0

      for (let i = 0; i < 1000; i++) {
        jumpToLine(i + 1, (i % 20) + 1)
        const current = useLayoutStore.getState().jumpTarget!
        expect(current.line).toBe(i + 1)
        expect(current.timestamp).toBeGreaterThanOrEqual(prevTimestamp)
        prevTimestamp = current.timestamp
      }
    })
  })

  // ==========================================================================
  // Section 5: Mutual Maximize Locks
  // ==========================================================================
  describe("Adversarial Stress 5: Mutual Maximize Locks", () => {
    it("enforces strict mutual exclusivity: Viewport and Editor can never be simultaneously maximized", () => {
      const { toggleMaximizeViewport, toggleMaximizeEditor } = useLayoutStore.getState()

      // Initial: none
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")

      // 1. Maximize Viewport
      toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      // 2. While Viewport is maximized, calling toggleMaximizeEditor directly transitions to editor
      toggleMaximizeEditor()
      expect(useLayoutStore.getState().maximizedPanel).toBe("editor")

      // 3. While Editor is maximized, calling toggleMaximizeViewport directly transitions to viewport
      toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      // 4. Calling toggleMaximizeViewport again restores to none
      toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    })

    it("survives 10,000 rapid toggle cycles between Viewport and Editor maximization without deadlocking", () => {
      const { toggleMaximizeViewport, toggleMaximizeEditor } = useLayoutStore.getState()

      for (let i = 0; i < 10000; i++) {
        if (i % 3 === 0) {
          toggleMaximizeViewport()
        } else if (i % 3 === 1) {
          toggleMaximizeEditor()
        } else {
          toggleMaximizeViewport()
        }

        const current = useLayoutStore.getState().maximizedPanel
        expect(["none", "viewport", "editor"]).toContain(current)
      }
    })

    it("gracefully falls back to Dual-Split mode in CenterStage if maximizedPanel is malformed or invalid", () => {
      useLayoutStore.setState({ maximizedPanel: "invalid_panel" as any })
      const html = renderToStaticMarkup(<CenterStage />)

      // Falls through to default dual-split mode
      expect(html).toContain("data-testid=\"center-stage-split\"")
      expect(html).toContain("3D Viewport")
      expect(html).toContain("Shader Editor")
      expect(html).not.toContain("data-testid=\"center-stage-max-viewport\"")
      expect(html).not.toContain("data-testid=\"center-stage-max-editor\"")
    })

    it("preserves split orientation toggle when changed while a panel is maximized", () => {
      useLayoutStore.setState({ splitOrientation: "vertical", maximizedPanel: "none" })

      // Maximize Viewport
      useLayoutStore.getState().toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      // Programmatically toggle split orientation while Viewport is maximized
      useLayoutStore.getState().toggleSplitOrientation()
      expect(useLayoutStore.getState().splitOrientation).toBe("horizontal")

      // Restore Viewport
      useLayoutStore.getState().toggleMaximizeViewport()
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")

      // Split orientation was preserved and is now active
      expect(useLayoutStore.getState().splitOrientation).toBe("horizontal")

      const html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("Split Vertically") // Button to toggle back to vertical
    })

    it("verifies UI action buttons lock out redundant maximize actions when a panel is maximized", () => {
      // In Maximize Viewport mode: only Restore button is rendered, not Maximize Viewport or Maximize Editor
      useLayoutStore.setState({ maximizedPanel: "viewport" })
      const viewHtml = renderToStaticMarkup(<CenterStage />)
      expect(viewHtml).toContain("3D Viewport (Maximized)")
      expect(viewHtml).toContain("Restore Split")
      expect(viewHtml).not.toContain("Maximize Viewport")
      expect(viewHtml).not.toContain("Maximize Editor")
      expect(viewHtml).not.toContain("Split Horizontally")

      // In Maximize Editor mode: only Restore button is rendered
      useLayoutStore.setState({ maximizedPanel: "editor" })
      const editHtml = renderToStaticMarkup(<CenterStage />)
      expect(editHtml).toContain("Shader Editor (Maximized)")
      expect(editHtml).toContain("Restore Split")
      expect(editHtml).not.toContain("Maximize Viewport")
      expect(editHtml).not.toContain("Maximize Editor")

      // In Dual-Split mode: both Maximize buttons and split toggle are rendered
      useLayoutStore.setState({ maximizedPanel: "none", splitOrientation: "vertical" })
      const splitHtml = renderToStaticMarkup(<CenterStage />)
      expect(splitHtml).toContain("Maximize Viewport")
      expect(splitHtml).toContain("Maximize Editor")
      expect(splitHtml).toContain("Split Horizontally")
      expect(splitHtml).not.toContain("Restore Split")
    })
  })

  // ==========================================================================
  // Section 6: Additional Layout & Store Stress Invariants
  // ==========================================================================
  describe("Adversarial Stress 6: Layout State Invariants & Minimap Toggling", () => {
    it("survives 1,000 rapid minimap toggles with strict parity", () => {
      const { toggleEditorMinimap } = useLayoutStore.getState()
      expect(useLayoutStore.getState().editorMinimap).toBe(false)

      for (let i = 0; i < 1000; i++) {
        toggleEditorMinimap()
        expect(useLayoutStore.getState().editorMinimap).toBe(i % 2 === 0)
      }

      expect(useLayoutStore.getState().editorMinimap).toBe(false)
    })

    it("verifies ConsoleDrawer error count badge and clear button behavior under compile error bursts", () => {
      // Set compile error
      useProjectStore.getState().setLastCompileError("ERROR: 0:15: 'u_diffuse' : undeclared identifier\nERROR: 0:28: 'pos' : syntax error")
      const html = renderToStaticMarkup(<ConsoleDrawer />)

      expect(html).toContain("2 Errors")
      expect(html).toContain("[Line 15]")
      expect(html).toContain("[Line 28]")
      expect(html).toContain("Clear")
      expect(html).toContain("Jump")

      // Clear compile error
      useProjectStore.getState().setLastCompileError(null)
      const clearedHtml = renderToStaticMarkup(<ConsoleDrawer />)
      expect(clearedHtml).toContain("0 Errors")
      expect(clearedHtml).toContain("No compilation errors or diagnostics.")
      expect(clearedHtml).not.toContain("Clear")
    })

    it("verifies StatusBar metrics subscription and dynamic display under telemetry stream", () => {
      const html = renderToStaticMarkup(<StatusBar />)

      expect(html).toContain("data-testid=\"status-bar\"")
      expect(html).toContain("Node Graph")
      expect(html).toContain("WGSL")
      expect(html).toContain("Bridge: Offline")
      expect(html).toContain("60 FPS · 16.6ms")
    })
  })
})
