/**
 * Tier 1: Feature Coverage — ShaderStudio UI/UX Creative Workstation Overhaul
 *
 * Comprehensive feature coverage for requirements R1-R4:
 * - R1: Activity Bar, sliding sidebars, center stage split/maximize, bottom console, status bar
 * - R2: Studio transport toolbar, play/pause, scrub, rewind (t=0), resolution scaling, telemetry
 * - R3: Parameter Inspector 5 accordion sections, search/filter, per-uniform reset, presets
 * - R4: Monaco multi-tabs, active-tab marker isolation, format/minimap/Ctrl+Enter, console jump-to-line
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  LayoutHarness,
  TransportHarness,
  InspectorHarness,
  EditorConsoleHarness,
  createWorkstationHarness,
} from "./uiHarness"
import { useProjectStore, type ParsedUniform } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"

describe("Tier 1: Feature Coverage — UI/UX Creative Workstation Overhaul", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // R1: Activity Bar & Sliding Sidebars (F-ACT-01 to F-ACT-09, F-LAYOUT-01)
  // ==========================================================================
  describe("R1: Activity Bar, Sliding Sidebars & Center Stage Layout", () => {
    it("F-ACT-01 & F-ACT-02: Activity Bar 48px rail toggles sliding sidebar dock open and collapses to 0px on re-click", () => {
      const layout = new LayoutHarness()

      // Initial state: rail is 48px, sidebar closed (0px width)
      expect(layout.activityRailWidth).toBe(48)
      expect(layout.isLeftSidebarOpen).toBe(false)
      expect(layout.activeActivityTab).toBeNull()
      expect(layout.getEffectiveLeftSidebarWidth()).toBe(0)

      // Click 'graph' tab: slides dock open (260px)
      layout.toggleActivityTab("graph")
      expect(layout.isLeftSidebarOpen).toBe(true)
      expect(layout.activeActivityTab).toBe("graph")
      expect(layout.getEffectiveLeftSidebarWidth()).toBe(260)

      // Click another tab ('project'): switches tab while remaining open
      layout.toggleActivityTab("project")
      expect(layout.isLeftSidebarOpen).toBe(true)
      expect(layout.activeActivityTab).toBe("project")
      expect(layout.getEffectiveLeftSidebarWidth()).toBe(260)

      // Re-click active 'project' tab: collapses dock to 0px
      layout.toggleActivityTab("project")
      expect(layout.isLeftSidebarOpen).toBe(false)
      expect(layout.activeActivityTab).toBeNull()
      expect(layout.getEffectiveLeftSidebarWidth()).toBe(0)
    })

    it("F-ACT-03: Collapsible right inspector toggles open/closed and reclaims center stage width", () => {
      const layout = new LayoutHarness()

      // Default: right inspector is open (320px)
      expect(layout.isRightInspectorOpen).toBe(true)
      expect(layout.getEffectiveRightInspectorWidth()).toBe(320)
      const initialCenterWidth = layout.getEffectiveCenterStageWidth()

      // Toggle inspector closed: collapses to 0px
      layout.toggleRightInspector()
      expect(layout.isRightInspectorOpen).toBe(false)
      expect(layout.getEffectiveRightInspectorWidth()).toBe(0)

      // Center stage reclaims 320px
      const expandedCenterWidth = layout.getEffectiveCenterStageWidth()
      expect(expandedCenterWidth).toBe(initialCenterWidth + 320)

      // Toggle inspector open again
      layout.toggleRightInspector()
      expect(layout.isRightInspectorOpen).toBe(true)
      expect(layout.getEffectiveCenterStageWidth()).toBe(initialCenterWidth)
    })

    it("F-ACT-04 & F-ACT-05: Center stage resizable dual-split and horizontal/vertical orientation toggle", () => {
      const layout = new LayoutHarness()

      // Default: vertical split (side-by-side) with 60/40 ratio
      expect(layout.splitOrientation).toBe("vertical")
      expect(layout.centerSplitRatio).toBe(0.6)

      const vertView = layout.getViewportDimensions()
      const vertEdit = layout.getEditorDimensions()
      expect(vertView.height).toBe(vertEdit.height)
      expect(vertView.width).toBeGreaterThan(vertEdit.width)
      expect(vertView.width + vertEdit.width).toBe(layout.getEffectiveCenterStageWidth())

      // Toggle orientation to horizontal (stacked top-and-bottom)
      layout.toggleSplitOrientation()
      expect(layout.splitOrientation).toBe("horizontal")

      const horizView = layout.getViewportDimensions()
      const horizEdit = layout.getEditorDimensions()
      expect(horizView.width).toBe(horizEdit.width)
      expect(horizView.height).toBeGreaterThan(horizEdit.height)
      expect(horizView.height + horizEdit.height).toBe(layout.getEffectiveCenterStageHeight())
    })

    it("F-ACT-06 & F-ACT-07: Quick Maximize/Restore toggles for 3D Viewport and Monaco Editor", () => {
      const layout = new LayoutHarness()

      // Default: no panel maximized
      expect(layout.maximizedPanel).toBe("none")

      // Maximize Viewport: editor collapses to 0px width/height, viewport occupies full stage
      layout.toggleMaximizeViewport()
      expect(layout.maximizedPanel).toBe("viewport")
      expect(layout.getViewportDimensions().width).toBe(layout.getEffectiveCenterStageWidth())
      expect(layout.getViewportDimensions().height).toBe(layout.getEffectiveCenterStageHeight())
      expect(layout.getEditorDimensions().width).toBe(0)
      expect(layout.getEditorDimensions().height).toBe(0)

      // Restore Viewport: restores split
      layout.toggleMaximizeViewport()
      expect(layout.maximizedPanel).toBe("none")
      expect(layout.getEditorDimensions().width).toBeGreaterThan(0)

      // Maximize Monaco Editor: viewport collapses to 0px
      layout.toggleMaximizeEditor()
      expect(layout.maximizedPanel).toBe("editor")
      expect(layout.getEditorDimensions().width).toBe(layout.getEffectiveCenterStageWidth())
      expect(layout.getViewportDimensions().width).toBe(0)

      // Restore Editor: restores split
      layout.toggleMaximizeEditor()
      expect(layout.maximizedPanel).toBe("none")
    })

    it("F-ACT-08 & F-ACT-09: Bottom Console drawer and persistent Status Bar footer telemetry", () => {
      const layout = new LayoutHarness()

      // Default: console drawer closed
      expect(layout.isConsoleOpen).toBe(false)
      const stageHeightClosed = layout.getEffectiveCenterStageHeight()

      // Open console drawer
      layout.toggleConsole()
      expect(layout.isConsoleOpen).toBe(true)
      const stageHeightOpen = layout.getEffectiveCenterStageHeight()
      expect(stageHeightOpen).toBe(stageHeightClosed - layout.consoleExpandedHeight)

      // Status Bar footer height preserved
      expect(layout.statusBarHeight).toBe(28)
      expect(layout.toolbarHeight).toBe(44)
    })

    it("F-LAYOUT-01: layoutStore isolates UI workspace state from project serialization", () => {
      const layout = new LayoutHarness()
      layout.toggleActivityTab("copilot")
      layout.toggleMaximizeViewport()

      // Project store does not contain transient layout DOM states
      const projectState = useProjectStore.getState()
      expect((projectState as any).isLeftSidebarOpen).toBeUndefined()
      expect((projectState as any).maximizedPanel).toBeUndefined()

      // Exporting project data produces clean serialization without UI layout pollution
      const exported = projectState.exportProjectData()
      expect((exported as any).isLeftSidebarOpen).toBeUndefined()
      expect((exported as any).splitOrientation).toBeUndefined()
    })

    it("F-LAYOUT-01 (Live Zustand Store): verifies useLayoutStore state transitions, dock toggling and line jumping", () => {
      useLayoutStore.setState({
        activeActivityTab: null,
        isLeftSidebarOpen: false,
        isRightInspectorOpen: true,
        isConsoleOpen: false,
        splitOrientation: "vertical",
        maximizedPanel: "none",
        jumpTarget: null,
      })

      // Toggle Activity Tab
      useLayoutStore.getState().toggleActivityTab("graph")
      expect(useLayoutStore.getState().activeActivityTab).toBe("graph")
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)

      // Re-click active tab collapses dock to 0px
      useLayoutStore.getState().toggleActivityTab("graph")
      expect(useLayoutStore.getState().activeActivityTab).toBeNull()
      expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)

      // Toggle Right Inspector
      useLayoutStore.getState().toggleRightInspector()
      expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)

      // Toggle Console Drawer
      useLayoutStore.getState().toggleConsole()
      expect(useLayoutStore.getState().isConsoleOpen).toBe(true)

      // Split Orientation toggle
      useLayoutStore.getState().toggleSplitOrientation()
      expect(useLayoutStore.getState().splitOrientation).toBe("horizontal")

      // Maximize Viewport then jumpToLine auto-un-maximizes Viewport
      useLayoutStore.getState().setMaximizedPanel("viewport")
      expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

      useLayoutStore.getState().jumpToLine(42, 5)
      expect(useLayoutStore.getState().maximizedPanel).toBe("none")
      expect(useLayoutStore.getState().jumpTarget?.line).toBe(42)
      expect(useLayoutStore.getState().jumpTarget?.column).toBe(5)
    })
  })

  // ==========================================================================
  // R2: Studio Transport Toolbar & Navigation (F-TRAN-01 to F-TRAN-13)
  // ==========================================================================
  describe("R2: Full Studio Transport Toolbar & Navigation Controls", () => {
    it("F-TRAN-01 & F-TRAN-02: Virtual playback clock advances when playing and halts when paused", () => {
      const transport = new TransportHarness()

      expect(transport.isPlaying).toBe(true)
      expect(transport.currentTime).toBe(0.0)

      // Advance clock by 500ms (0.5s) while playing
      transport.tick(500)
      expect(transport.currentTime).toBeCloseTo(0.5, 3)

      // Pause playback
      transport.setIsPlaying(false)
      expect(transport.isPlaying).toBe(false)

      // Advance clock by another 500ms while paused: time does NOT advance
      transport.tick(500)
      expect(transport.currentTime).toBeCloseTo(0.5, 3)

      // Resume playback: time continues advancing
      transport.setIsPlaying(true)
      transport.tick(250)
      expect(transport.currentTime).toBeCloseTo(0.75, 3)
    })

    it("F-TRAN-03: Rewind / Reset Time (t=0) resets playback time with immediate canvas redraw notification", () => {
      const transport = new TransportHarness()
      transport.setCurrentTime(14.85)
      expect(transport.currentTime).toBe(14.85)

      let redrawTriggered = false
      let redrawTime = -1
      transport.onRenderFrame((time, isSeek) => {
        redrawTriggered = true
        redrawTime = time
        expect(isSeek).toBe(true)
      })

      // Reset time to t=0
      transport.resetTime()
      expect(transport.currentTime).toBe(0.0)
      expect(redrawTriggered).toBe(true)
      expect(redrawTime).toBe(0.0)
    })

    it("F-TRAN-04 & F-TRAN-05: Digital time counter formatting and synchronous single-frame render during scrub while paused", () => {
      const transport = new TransportHarness()
      transport.setCurrentTime(65.42) // 1 minute 5.42 seconds
      expect(transport.getFormattedTime()).toBe("01:05.42")

      // Pause playback
      transport.setIsPlaying(false)

      let singleFrameRenderCount = 0
      let lastScrubTime = 0
      transport.onRenderFrame((time, isSeek) => {
        if (isSeek) {
          singleFrameRenderCount++
          lastScrubTime = time
        }
      })

      // Scrub timeline to 24.50s
      transport.seek(24.5)
      expect(transport.currentTime).toBe(24.5)
      expect(transport.getFormattedTime()).toBe("00:24.50")
      expect(singleFrameRenderCount).toBe(1)
      expect(lastScrubTime).toBe(24.5)
      expect(transport.getSingleFrameRenderCount()).toBe(1)
    })

    it("F-TRAN-06 & F-TRAN-07: Canvas resolution scaling selector (0.5x, 1x, 2x, Native DPI) and effective DPR calculations", () => {
      const transport = new TransportHarness()

      // Default: 1x scale
      expect(transport.resolutionScale).toBe(1)
      expect(transport.getEffectiveDpr(1.0)).toBe(1.0)
      expect(transport.getEffectiveDpr(2.0)).toBe(1.0)

      // 0.5x performance scale
      transport.setResolutionScale(0.5)
      expect(transport.resolutionScale).toBe(0.5)
      expect(transport.getEffectiveDpr(1.0)).toBe(0.5)

      // 2x high-resolution supersampling scale
      transport.setResolutionScale(2)
      expect(transport.resolutionScale).toBe(2)
      expect(transport.getEffectiveDpr(1.0)).toBe(2.0)

      // Native DPI scale (uses host DPR capped at 2.0)
      transport.setResolutionScale("native")
      expect(transport.resolutionScale).toBe("native")
      expect(transport.getEffectiveDpr(1.5)).toBe(1.5)
      expect(transport.getEffectiveDpr(3.0)).toBe(2.0) // Capped at 2.0 for GPU buffer safety
    })

    it("F-TRAN-10: Real-time FPS and GPU frame time telemetry broadcast", () => {
      const transport = new TransportHarness()
      let lastMetrics: any = null

      transport.onMetrics((m) => {
        lastMetrics = m
      })

      // Tick 16.67ms (60 FPS)
      transport.tick(16.67)
      expect(lastMetrics).not.toBeNull()
      expect(lastMetrics.fps).toBe(60)
      expect(lastMetrics.frameTimeMs).toBe(16.67)
      expect(lastMetrics.isPlaying).toBe(true)
    })
  })

  // ==========================================================================
  // R3: Parameter Inspector & Organization (F-INSP-01 to F-INSP-09)
  // ==========================================================================
  describe("R3: Parameter Inspector & Accordion Organization", () => {
    it("F-INSP-01: Collapsible accordion sections support individual expand and collapse", () => {
      const inspector = new InspectorHarness()

      // Default open: uniforms, environment
      expect(inspector.isAccordionOpen("uniforms")).toBe(true)
      expect(inspector.isAccordionOpen("environment")).toBe(true)
      expect(inspector.isAccordionOpen("audio")).toBe(false)
      expect(inspector.isAccordionOpen("compute")).toBe(false)
      expect(inspector.isAccordionOpen("variations")).toBe(false)

      // Expand audio accordion
      inspector.toggleAccordion("audio")
      expect(inspector.isAccordionOpen("audio")).toBe(true)

      // Collapse uniforms accordion
      inspector.toggleAccordion("uniforms")
      expect(inspector.isAccordionOpen("uniforms")).toBe(false)
    })

    it("F-INSP-02: Section 1 Shader Uniforms real-time search/filter query filters controls by name", () => {
      const inspector = new InspectorHarness()
      const sampleUniforms: ParsedUniform[] = [
        { name: "u_tintColor", type: "vec4f", kind: "color" },
        { name: "u_roughness", type: "f32", kind: "scalar" },
        { name: "u_lightPos", type: "vec3f", kind: "vector" },
        { name: "u_exposure", type: "f32", kind: "scalar" },
      ]

      // Empty search query returns all uniforms
      expect(inspector.getFilteredUniforms(sampleUniforms)).toHaveLength(4)

      // Filter by 'color' (case-insensitive)
      inspector.setSearchQuery("color")
      const colorMatches = inspector.getFilteredUniforms(sampleUniforms)
      expect(colorMatches).toHaveLength(1)
      expect(colorMatches[0].name).toBe("u_tintColor")

      // Filter by 'u_' returns all
      inspector.setSearchQuery("u_")
      expect(inspector.getFilteredUniforms(sampleUniforms)).toHaveLength(4)

      // Filter by non-existent name returns empty array
      inspector.setSearchQuery("non_existent_uniform")
      expect(inspector.getFilteredUniforms(sampleUniforms)).toHaveLength(0)
    })

    it("F-INSP-03 & F-INSP-04: Per-uniform reset button and global reset-all restore original parsed defaults", () => {
      const inspector = new InspectorHarness()
      const initialDefaults = {
        u_speed: { type: "float" as const, value: 1.0 },
        u_glow: { type: "float" as const, value: 0.5 },
      }
      inspector.setParsedDefaults(initialDefaults)

      // User modifies values in store
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 9.9 })
      useProjectStore.getState().setUniformValue("u_glow", { type: "float", value: 3.3 })
      expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(9.9)

      // Reset single uniform u_speed
      inspector.resetUniformToDefault("u_speed")
      expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(1.0)
      expect(useProjectStore.getState().uniformValues.u_glow.value).toBe(3.3) // u_glow unchanged

      // Reset All uniforms
      inspector.resetAllUniformsToDefault()
      expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(1.0)
      expect(useProjectStore.getState().uniformValues.u_glow.value).toBe(0.5)
    })

    it("F-INSP-06 to F-INSP-09: Environment, Audio Dynamics, Compute Simulation & Variations accordions", () => {
      const inspector = new InspectorHarness()

      // Section 2: Environment
      inspector.setEnvironmentPreset("cyberpunk")
      inspector.setEnvironmentExposure(2.4)
      expect(inspector.environment.preset).toBe("cyberpunk")
      expect(inspector.environment.exposure).toBe(2.4)

      // Section 3: Audio Dynamics
      inspector.setAudioGain(2.5)
      expect(inspector.audio.gain).toBe(2.5)

      // Section 4: Compute Simulation re-seed
      const prevSeed = inspector.compute.seed
      inspector.reseedComputeSimulation()
      expect(inspector.compute.seed).not.toBe(prevSeed)

      // Section 5: Variations snapshot save & apply
      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.85 })
      const varId = inspector.saveVariation("Matte Metal")
      expect(varId).toBeDefined()

      // Change value
      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.1 })
      expect(useProjectStore.getState().uniformValues.u_roughness.value).toBe(0.1)

      // Apply snapshot
      inspector.applyVariation(varId)
      expect(useProjectStore.getState().uniformValues.u_roughness.value).toBe(0.85)
    })
  })

  // ==========================================================================
  // R4: Monaco Editor & Console Enhancements (F-EDIT-01 to F-EDIT-05, F-CONS-01 to F-CONS-03)
  // ==========================================================================
  describe("R4: Monaco Shader Editor & Console Drawer Enhancements", () => {
    it("F-EDIT-01 & F-EDIT-02: Multi-tab switching and active-tab compiler diagnostic marker isolation", () => {
      const editor = new EditorConsoleHarness()

      expect(editor.activeTab).toBe("fragment")

      // Add diagnostics for fragment and compute tabs
      editor.addDiagnostic({
        tab: "fragment",
        severity: "error",
        message: "expected ';' in fragment shader",
        line: 12,
        column: 8,
      })
      editor.addDiagnostic({
        tab: "compute",
        severity: "error",
        message: "workgroup size mismatch",
        line: 4,
        column: 1,
      })

      // When fragment tab is active, only fragment error is visible to Monaco markers
      const fragDiags = editor.getActiveTabDiagnostics()
      expect(fragDiags).toHaveLength(1)
      expect(fragDiags[0].message).toContain("expected ';'")

      // Switch to compute tab: now only compute error is visible
      editor.setActiveTab("compute")
      const compDiags = editor.getActiveTabDiagnostics()
      expect(compDiags).toHaveLength(1)
      expect(compDiags[0].message).toContain("workgroup size mismatch")

      // Switch to vertex tab: zero errors visible
      editor.setActiveTab("vertex")
      expect(editor.getActiveTabDiagnostics()).toHaveLength(0)

      // Overall console still reflects total 2 errors
      expect(editor.getErrorCount()).toBe(2)
    })

    it("F-EDIT-03, F-EDIT-04 & F-EDIT-05: Format Code, Minimap toggle and Ctrl+Enter instant recompile shortcut", () => {
      const editor = new EditorConsoleHarness()

      // Format code cleans trailing spaces
      editor.setSource("fragment", "void main() {   \n  col = 1.0;   \n}")
      editor.formatCode()
      expect(editor.sources.fragment).toBe("void main() {\n  col = 1.0;\n}")

      // Minimap toggle
      expect(editor.minimapEnabled).toBe(true)
      editor.toggleMinimap()
      expect(editor.minimapEnabled).toBe(false)

      // Ctrl+Enter trigger recompile
      const initialRecompiles = editor.recompileCount
      editor.triggerRecompile()
      expect(editor.recompileCount).toBe(initialRecompiles + 1)
      expect(useProjectStore.getState().recompileTrigger).toBeGreaterThan(0)
    })

    it("F-CONS-01, F-CONS-02 & F-CONS-03: Console Drawer error cards, click-to-jump line navigation, and clear button", () => {
      const layout = new LayoutHarness()
      const editor = new EditorConsoleHarness()

      const diagId = editor.addDiagnostic({
        tab: "compute",
        severity: "error",
        message: "undeclared variable u_particles",
        line: 42,
        column: 15,
      })

      expect(editor.getErrorCount()).toBe(1)
      expect(editor.getWarningCount()).toBe(0)

      // Ensure viewport was initially maximized to test automatic un-maximize on line jump
      layout.setMaximizedPanel("viewport")
      expect(layout.maximizedPanel).toBe("viewport")

      // Click error card in console drawer to jump to line 42 in Compute tab
      const jumpSuccess = editor.clickToJump(diagId, layout)
      expect(jumpSuccess).toBe(true)

      // Active tab automatically switched to compute
      expect(editor.activeTab).toBe("compute")

      // Viewport automatically un-maximized so editor is visible
      expect(layout.maximizedPanel).toBe("none")

      // Jump target set with clamped line and column
      expect(layout.jumpTarget).not.toBeNull()
      expect(layout.jumpTarget?.line).toBe(42)
      expect(layout.jumpTarget?.column).toBe(15)

      // Clear diagnostics button
      editor.clearDiagnostics()
      expect(editor.getErrorCount()).toBe(0)
      expect(editor.diagnostics).toHaveLength(0)
    })
  })
})
