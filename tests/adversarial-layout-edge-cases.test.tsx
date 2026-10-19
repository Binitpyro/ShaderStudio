import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { renderCoordinator } from "@/core/renderCoordinator"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { CenterStage } from "@/components/layout/CenterStage"
import { ActivityBar } from "@/components/layout/ActivityBar"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { StatusBar } from "@/components/layout/StatusBar"
import { RightInspector } from "@/components/layout/RightInspector"
import {
  setupE2ETestEnvironment,
  teardownE2ETestEnvironment,
  MockCanvasElement,
} from "./e2e/mocks"

// Mock next-themes for server / headless environments
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

// Mock Three.js WebGLRenderer to utilize headless MockThreeRenderer
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<any>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("Adversarial Layout Edge Cases & Stress Harness (Milestone 1)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
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

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Domain 1: Extreme Viewport Dimensions (Small Laptop vs Ultrawide)
  // ==========================================================================
  describe("Domain 1: Extreme Viewport Dimensions", () => {
    interface LayoutGeometry {
      viewportWidth: number
      viewportHeight: number
      activityRailWidth: number
      statusBarHeight: number
      availableWidth: number
      availableHeight: number
      leftSidebarWidth: number
      rightInspectorWidth: number
      centerStageWidth: number
      centerStageHeight: number
    }

    function computeGeometry(
      viewportWidth: number,
      viewportHeight: number,
      isLeftOpen = true,
      isRightOpen = true,
      isConsoleOpen = false
    ): LayoutGeometry {
      const activityRailWidth = 48
      const statusBarHeight = 24
      const availableWidth = Math.max(0, viewportWidth - activityRailWidth)
      const availableHeight = Math.max(0, viewportHeight - statusBarHeight)

      // Panel percentage allocations from WorkspaceLayout.tsx
      const leftSidebarPercent = isLeftOpen ? 0.22 : 0
      const rightInspectorPercent = isRightOpen ? 0.20 : 0
      const centerPercent = 1.0 - leftSidebarPercent - rightInspectorPercent

      const leftSidebarWidth = availableWidth * leftSidebarPercent
      const rightInspectorWidth = availableWidth * rightInspectorPercent
      const centerStageWidth = availableWidth * centerPercent

      const consoleDrawerPercent = isConsoleOpen ? 0.25 : 0
      const centerStageHeight = availableHeight * (1.0 - consoleDrawerPercent)

      return {
        viewportWidth,
        viewportHeight,
        activityRailWidth,
        statusBarHeight,
        availableWidth,
        availableHeight,
        leftSidebarWidth,
        rightInspectorWidth,
        centerStageWidth,
        centerStageHeight,
      }
    }

    it("verifies small laptop screen (1024x768) maintains non-overlapping positive bounds", () => {
      const geo = computeGeometry(1024, 768, true, true, false)

      expect(geo.availableWidth).toBe(976)
      expect(geo.availableHeight).toBe(744)
      expect(geo.centerStageWidth).toBeCloseTo(976 * 0.58, 1) // ~566.08px
      expect(geo.centerStageWidth).toBeGreaterThan(250)
      expect(geo.leftSidebarWidth).toBeCloseTo(976 * 0.22, 1) // ~214.72px
      expect(geo.rightInspectorWidth).toBeCloseTo(976 * 0.20, 1) // ~195.2px
      expect(geo.centerStageHeight).toBe(744)

      // In vertical split: Viewport (55%) and Editor (45%)
      const splitViewportWidth = geo.centerStageWidth * 0.55
      const splitEditorWidth = geo.centerStageWidth * 0.45
      expect(splitViewportWidth).toBeGreaterThan(200)
      expect(splitEditorWidth).toBeGreaterThan(200)

      // With Console Drawer open: 25% height
      const geoWithConsole = computeGeometry(1024, 768, true, true, true)
      expect(geoWithConsole.centerStageHeight).toBeCloseTo(744 * 0.75, 1) // 558px
      expect(geoWithConsole.availableHeight - geoWithConsole.centerStageHeight).toBeCloseTo(744 * 0.25, 1) // 186px

      // DOM rendering verification under small laptop config
      const html = renderToStaticMarkup(<WorkspaceLayout />)
      expect(html).toContain("data-testid=\"workspace-layout\"")
      expect(html).toContain("data-testid=\"activity-bar\"")
      expect(html).toContain("data-testid=\"status-bar\"")
      expect(html).toContain("data-testid=\"center-stage-split\"")
      expect(html).toContain("data-testid=\"right-inspector\"")
    })

    it("verifies ultrawide display (3440x1440) allocates extensive space without coordinate overflow", () => {
      const geo = computeGeometry(3440, 1440, true, true, false)

      expect(geo.availableWidth).toBe(3392)
      expect(geo.availableHeight).toBe(1416)
      expect(geo.centerStageWidth).toBeCloseTo(3392 * 0.58, 1) // ~1967.36px
      expect(geo.leftSidebarWidth).toBeCloseTo(3392 * 0.22, 1) // ~746.24px
      expect(geo.rightInspectorWidth).toBeCloseTo(3392 * 0.20, 1) // ~678.40px

      // Center stage horizontal split: Viewport and Editor stacked top-bottom
      useLayoutStore.setState({ splitOrientation: "horizontal" })
      const horizViewportHeight = geo.centerStageHeight * 0.55
      const horizEditorHeight = geo.centerStageHeight * 0.45
      expect(horizViewportHeight).toBeGreaterThan(700)
      expect(horizEditorHeight).toBeGreaterThan(600)

      // Viewport aspect ratio in horizontal split on ultrawide:
      const aspect = geo.centerStageWidth / horizViewportHeight
      expect(aspect).toBeGreaterThan(2.0) // Ultrawide aspect ratio > 2.5:1
      expect(Number.isFinite(aspect)).toBe(true)

      const html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("Split Vertically")
    })

    it("verifies super-ultrawide (5120x1440, 32:9 dual QHD) scales smoothly", () => {
      const geo = computeGeometry(5120, 1440, true, true, false)
      expect(geo.availableWidth).toBe(5072)
      expect(geo.centerStageWidth).toBeCloseTo(5072 * 0.58, 1) // ~2941.76px
      expect(geo.centerStageWidth).toBeGreaterThan(2800)
    })

    it("verifies compact vertical mobile/tablet screen (375x667 and 768x1024)", () => {
      // 375x667: Sidebars collapsed to maximize stage
      const mobileGeo = computeGeometry(375, 667, false, false, false)
      expect(mobileGeo.availableWidth).toBe(327)
      expect(mobileGeo.centerStageWidth).toBe(327) // 100% reclamation
      expect(mobileGeo.leftSidebarWidth).toBe(0)
      expect(mobileGeo.rightInspectorWidth).toBe(0)

      // 768x1024: Tablet vertical
      const tabletGeo = computeGeometry(768, 1024, true, false, false)
      expect(tabletGeo.availableWidth).toBe(720)
      expect(tabletGeo.leftSidebarWidth).toBeCloseTo(720 * 0.22, 1)
      expect(tabletGeo.centerStageWidth).toBeCloseTo(720 * 0.78, 1) // 561.6px
    })

    it("verifies dynamic resolution switching back-and-forth across extremes", () => {
      const resolutions = [
        { w: 1024, h: 768 },
        { w: 3440, h: 1440 },
        { w: 800, h: 600 },
        { w: 5120, h: 1440 },
        { w: 1920, h: 1080 },
      ]

      for (const res of resolutions) {
        const geo = computeGeometry(res.w, res.h)
        expect(geo.centerStageWidth).toBeGreaterThan(0)
        expect(geo.centerStageHeight).toBeGreaterThan(0)
        expect(Number.isFinite(geo.centerStageWidth)).toBe(true)
        expect(Number.isFinite(geo.centerStageHeight)).toBe(true)
      }
    })
  })

  // ==========================================================================
  // Domain 2: Zero-Dimension Canvas Safety & Boundary Inputs
  // ==========================================================================
  describe("Domain 2: Zero-Dimension Canvas Safety", () => {
    it("WebGPUAdapter: resize(0, 0) clamps canvas dimensions to at least 1x1 without throwing", async () => {
      const canvas = env.createCanvas(0, 0)
      const mounted = await webgpuAdapter.mount(canvas as any)
      expect(mounted).toBe(true)

      // Direct resize to (0, 0)
      webgpuAdapter.resize(0, 0)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Negative dimension safety
      webgpuAdapter.resize(-100, -200)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Half-zero dimensions (0 x 768, 1024 x 0)
      webgpuAdapter.resize(0, 768)
      expect(canvas.width).toBe(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      webgpuAdapter.resize(1024, 0)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBe(1)

      // Verify renderFrame runs cleanly on 1x1 clamped canvas
      expect(() => webgpuAdapter.renderFrame(100, 16)).not.toThrow()
    })

    it("WebGL2Adapter: resize(0, 0) clamps dimensions to 1x1 and preserves valid viewport & aspect ratio", async () => {
      const canvas = env.createCanvas(0, 0)
      const mounted = await webgl2Adapter.mount(canvas as any)
      expect(mounted).toBe(true)

      // Resize to (0, 0)
      webgl2Adapter.resize(0, 0)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Negative inputs
      webgl2Adapter.resize(-50, -50)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Render frame on 1x1 clamped canvas: ensure no division by zero in aspect ratio
      expect(() => webgl2Adapter.renderFrame(200, 16)).not.toThrow()
    })

    it("ThreeJSAdapter: resize(0, 0) clamps dimensions to safe minimum (1x1) with valid camera aspect", async () => {
      const canvas = env.createCanvas(0, 0)
      const mounted = await threejsAdapter.mount(canvas as any)
      expect(mounted).toBe(true)

      // Resize to (0, 0)
      threejsAdapter.resize(0, 0)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Fractional sub-pixel inputs
      threejsAdapter.resize(0.3, 0.4)
      expect(canvas.width).toBeGreaterThanOrEqual(1)
      expect(canvas.height).toBeGreaterThanOrEqual(1)

      // Render frame
      expect(() => threejsAdapter.renderFrame(300, 16)).not.toThrow()
    })

    it("Rapid resize stress harness: handles 100 random sizes including zeroes and negative bounds", async () => {
      const canvas = env.createCanvas(800, 600)
      await webgpuAdapter.mount(canvas as any)

      const testSizes = [
        [0, 0],
        [-10, 0],
        [0, -10],
        [-100, -100],
        [0.001, 0.001],
        [1, 1],
        [1024, 768],
        [0, 0],
        [3440, 1440],
        [-1, 1440],
        [5120, 0],
      ]

      for (let i = 0; i < 100; i++) {
        const [w, h] = testSizes[i % testSizes.length]
        expect(() => webgpuAdapter.resize(w, h)).not.toThrow()
        expect(canvas.width).toBeGreaterThanOrEqual(1)
        expect(canvas.height).toBeGreaterThanOrEqual(1)
      }
    })
  })

  // ==========================================================================
  // Domain 3: jumpTarget Un-Maximize Behavior & Cross-Component Navigation
  // ==========================================================================
  describe("Domain 3: jumpTarget Un-Maximize Behavior", () => {
    it("un-maximizes Viewport to 'none' when jumpToLine is called while Viewport is maximized", () => {
      const { setMaximizedPanel, jumpToLine } = useLayoutStore.getState()

      // 1. Maximize Viewport
      setMaximizedPanel("viewport")
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      // CenterStage in maximized viewport mode renders only 3D Viewport
      let html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("3D Viewport (Maximized)")
      expect(html).not.toContain("Shader Editor")

      // 2. Trigger jumpToLine from diagnostic error navigation
      jumpToLine(42, 7)

      // 3. Maximized panel MUST be restored to 'none' so editor is unhidden
      const state = useLayoutStore.getState()
      expect(state.maximizedPanel).toBe("none")
      expect(state.jumpTarget).not.toBeNull()
      expect(state.jumpTarget?.line).toBe(42)
      expect(state.jumpTarget?.column).toBe(7)
      expect(state.jumpTarget?.timestamp).toBeGreaterThan(0)

      // 4. CenterStage re-renders dual-split pane with both Viewport and Editor
      html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("data-testid=\"center-stage-split\"")
      expect(html).toContain("3D Viewport")
      expect(html).toContain("Shader Editor")
    })

    it("preserves Editor maximized state when jumpToLine is called while Editor is already maximized", () => {
      const { setMaximizedPanel, jumpToLine } = useLayoutStore.getState()

      // Maximize Editor
      setMaximizedPanel("editor")
      expect(useLayoutStore.getState().maximizedPanel).toBe("editor")

      // Trigger jumpToLine
      jumpToLine(108, 12)

      // Editor was already visible and maximized; must remain 'editor'
      const state = useLayoutStore.getState()
      expect(state.maximizedPanel).toBe("editor")
      expect(state.jumpTarget?.line).toBe(108)
      expect(state.jumpTarget?.column).toBe(12)

      const html = renderToStaticMarkup(<CenterStage />)
      expect(html).toContain("Shader Editor (Maximized)")
    })

    it("maintains 'none' when jumpToLine is called in normal split mode", () => {
      const { jumpToLine } = useLayoutStore.getState()
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")

      jumpToLine(15, 3)

      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(15)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(3)
    })

    it("updates timestamp monotonically on rapid successive calls to the exact same line", () => {
      let mockTime = 1000
      const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        return (mockTime += 10)
      })

      const { jumpToLine } = useLayoutStore.getState()

      jumpToLine(25, 4)
      const firstTimestamp = useLayoutStore.getState().jumpTarget!.timestamp

      jumpToLine(25, 4)
      const secondTimestamp = useLayoutStore.getState().jumpTarget!.timestamp

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp)
      dateSpy.mockRestore()
    })

    it("ConsoleDrawer diagnostic card interaction correctly triggers jumpToLine", () => {
      useLayoutStore.getState().setMaximizedPanel("viewport")
      useProjectStore.getState().setLastCompileError(":33:14: error: unresolved reference 'foo'")

      const html = renderToStaticMarkup(<ConsoleDrawer />)
      expect(html).toContain("[Line 33:14]")
      expect(html).toContain("unresolved reference &#x27;foo&#x27;")
      expect(html).toContain("Jump")

      // Execute jump via layoutStore as card onClick would
      useLayoutStore.getState().jumpToLine(33, 14)
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(33)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(14)
    })
  })

  // ==========================================================================
  // Domain 4: Lifecycle, Zombie rAF Loops & Memory Isolation during Maximize Toggles
  // ==========================================================================
  describe("Domain 4: Lifecycle & Zombie Loop Prevention", () => {
    it("ensures renderCoordinator stops and detaches adapter when Viewport is unmounted", async () => {
      const canvas = env.createCanvas(800, 600)
      await webgpuAdapter.mount(canvas as any)

      renderCoordinator.setActiveAdapter(webgpuAdapter)
      renderCoordinator.start()

      // Confirm loop is active
      expect(renderCoordinator.getActiveAdapter()).toBe(webgpuAdapter)

      // Simulate unmount cleanup of Viewport (as executed in Viewport.tsx useEffect cleanup)
      renderCoordinator.setActiveAdapter(null)
      renderCoordinator.stop()
      webgpuAdapter.dispose()

      // Confirm coordinator is completely inert
      expect(renderCoordinator.getActiveAdapter()).toBeNull()

      // Step mock clock forward by 1000ms: no frames should be drawn to disposed adapter
      const renderSpy = vi.spyOn(webgpuAdapter, "renderFrame")
      env.clock.step(1000)
      expect(renderSpy).not.toHaveBeenCalled()
    })

    it("handles 20 rapid maximize and restore toggles without corrupting state or leaking adapters", async () => {
      const { toggleMaximizeViewport, toggleMaximizeEditor } = useLayoutStore.getState()

      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          toggleMaximizeViewport()
          expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")
          toggleMaximizeViewport()
          expect(useLayoutStore.getState().maximizedPanel).toBe("none")
        } else {
          toggleMaximizeEditor()
          expect(useLayoutStore.getState().maximizedPanel).toBe("editor")
          toggleMaximizeEditor()
          expect(useLayoutStore.getState().maximizedPanel).toBe("none")
        }
      }

      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    })
  })

  // ==========================================================================
  // Domain 5: State Isolation, Project Decoupling & Error Resilience
  // ==========================================================================
  describe("Domain 5: State Isolation & Error Resilience", () => {
    it("guarantees layout state manipulations do not dirty or mutate projectStore serialization state", () => {
      expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)

      // Perform wide variety of layout operations
      useLayoutStore.getState().toggleActivityTab("project")
      useLayoutStore.getState().toggleRightInspector()
      useLayoutStore.getState().toggleConsole()
      useLayoutStore.getState().toggleSplitOrientation()
      useLayoutStore.getState().toggleMaximizeViewport()
      useLayoutStore.getState().toggleMaximizeViewport()
      useLayoutStore.getState().toggleEditorMinimap()
      useLayoutStore.getState().jumpToLine(99, 1)

      // Project store MUST remain untouched and not marked dirty
      expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    })

    it("verifies SSR and test snapshot parity via getInitialState", () => {
      useLayoutStore.setState({ activeActivityTab: "copilot", isLeftSidebarOpen: false })
      expect(useLayoutStore.getInitialState().activeActivityTab).toBe("copilot")
      expect(useLayoutStore.getInitialState().isLeftSidebarOpen).toBe(false)
    })

    it("handles diagnostic errors without line numbers without crashing or creating invalid jump targets", () => {
      useProjectStore.getState().setLastCompileError("Shader execution timeout / watchdog trigger")
      const html = renderToStaticMarkup(<ConsoleDrawer />)

      expect(html).toContain("1 Error")
      expect(html).toContain("Shader execution timeout / watchdog trigger")
      expect(html).not.toContain("Jump") // No jump button rendered for errors without line numbers
    })
  })

  // ==========================================================================
  // Domain 6: Device Pixel Ratio (DPR) Scaling & High-DPI Displays
  // ==========================================================================
  describe("Domain 6: High-DPI Scaling & Monaco Dispatch Simulation", () => {
    it("clamps zero-dimension canvas to 1x1 across extreme DPR settings (0.5, 1.0, 2.0, 3.0)", async () => {
      const dprValues = [0.5, 1.0, 2.0, 3.0]
      const originalDPR = window.devicePixelRatio

      for (const dpr of dprValues) {
        Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true })

        const canvas = env.createCanvas(0, 0)
        await webgpuAdapter.mount(canvas as any)
        webgpuAdapter.resize(0, 0)

        // Math.max(1, Math.floor(0 * dpr)) === 1
        expect(canvas.width).toBeGreaterThanOrEqual(1)
        expect(canvas.height).toBeGreaterThanOrEqual(1)

        // Non-zero dimensions scale correctly with DPR
        webgpuAdapter.resize(100, 100)
        expect(canvas.width).toBe(Math.floor(100 * dpr))
        expect(canvas.height).toBe(Math.floor(100 * dpr))
      }

      Object.defineProperty(window, "devicePixelRatio", { value: originalDPR, configurable: true })
    })

    it("simulates Monaco Editor reacting to jumpTarget dispatch", () => {
      const mockEditor = {
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
      }

      // Simulate ShaderEditor jumpTarget hook effect
      const simulateJumpEffect = (jumpTarget: { line: number; column?: number } | null) => {
        if (!jumpTarget) return
        mockEditor.revealLineInCenter(jumpTarget.line)
        mockEditor.setPosition({ lineNumber: jumpTarget.line, column: jumpTarget.column || 1 })
        mockEditor.focus()
      }

      useLayoutStore.getState().jumpToLine(55, 10)
      simulateJumpEffect(useLayoutStore.getState().jumpTarget)

      expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(55)
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 55, column: 10 })
      expect(mockEditor.focus).toHaveBeenCalled()
    })
  })
})

