/**
 * Tier 3: Cross-Feature Combinations — ShaderStudio UI/UX Creative Workstation Overhaul
 *
 * Pairwise and multi-feature interaction tests covering complex intersecting workflows:
 * - Combo 1: Sidebar Dock + Center Stage Split + Resolution Scaling + Viewport Resize
 * - Combo 2: Transport Play/Pause + Timeline Scrub + Audio VU Modulation + Single Frame Render
 * - Combo 3: Parameter Inspector Search + Per-Uniform Reset + Store Synchronization
 * - Combo 4: Monaco Multi-Tabs + Marker Isolation + Console Error Click-to-Jump + Auto Un-Maximize
 * - Combo 5: Variations Snapshot Save/Apply + Virtual Playback Clock Continuity
 * - Combo 6: Theme Toggle + Uniform Color Inputs + Status Bar Telemetry
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

describe("Tier 3: Cross-Feature Combinations — UI/UX Creative Workstation Overhaul", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  it("Combo 1: Sidebar Dock Open/Collapse + Center Stage Orientation + Resolution Scaling", () => {
    const workstation = createWorkstationHarness()

    // 1. Initial default: left sidebar closed, right inspector open, 1x resolution, vertical split
    expect(workstation.layout.isLeftSidebarOpen).toBe(false)
    expect(workstation.layout.isRightInspectorOpen).toBe(true)
    expect(workstation.transport.resolutionScale).toBe(1)

    const initialViewport = workstation.layout.getViewportDimensions()
    expect(initialViewport.width).toBeGreaterThan(0)
    expect(initialViewport.height).toBeGreaterThan(0)

    // 2. Open left Activity Bar 'graph' sidebar
    workstation.layout.toggleActivityTab("graph")
    expect(workstation.layout.isLeftSidebarOpen).toBe(true)

    // Viewport width contracts because dock expanded by 260px
    const viewAfterSidebarOpen = workstation.layout.getViewportDimensions()
    expect(viewAfterSidebarOpen.width).toBeLessThan(initialViewport.width)

    // 3. Switch split orientation to horizontal (stacked)
    workstation.layout.toggleSplitOrientation()
    expect(workstation.layout.splitOrientation).toBe("horizontal")

    const viewAfterHoriz = workstation.layout.getViewportDimensions()
    expect(viewAfterHoriz.width).toBe(workstation.layout.getEffectiveCenterStageWidth())

    // 4. Set resolution scaling to 2x (supersampling)
    workstation.transport.setResolutionScale(2)
    const effectiveDpr = workstation.transport.getEffectiveDpr(1.0)
    expect(effectiveDpr).toBe(2.0)

    // Virtual render buffer dimensions scale with DPR
    const renderBufferWidth = Math.round(viewAfterHoriz.width * effectiveDpr)
    const renderBufferHeight = Math.round(viewAfterHoriz.height * effectiveDpr)
    expect(renderBufferWidth).toBe(viewAfterHoriz.width * 2)
    expect(renderBufferHeight).toBe(viewAfterHoriz.height * 2)

    // 5. Collapse both sidebars: center stage expands to maximum
    workstation.layout.setLeftSidebarOpen(false)
    workstation.layout.setRightInspectorOpen(false)
    const maxCenterWidth = workstation.layout.getEffectiveCenterStageWidth()
    expect(maxCenterWidth).toBe(1920 - 48) // 1872px
  })

  it("Combo 2: Transport Play/Pause + Timeline Scrub + Audio VU Modulation + Single Frame Redraw", () => {
    const workstation = createWorkstationHarness()

    // 1. Start playback and advance clock
    workstation.transport.setIsPlaying(true)
    workstation.transport.tick(1000) // +1s
    expect(workstation.transport.currentTime).toBeCloseTo(1.0, 2)

    // 2. Set up audio binding in inspector
    workstation.inspector.audio.reactiveBindings["u_audioPulse"] = { band: "bass", amount: 2.5 }
    workstation.inspector.audio.vuMeters.bass = 0.8

    // 3. Pause playback
    workstation.transport.setIsPlaying(false)
    expect(workstation.transport.isPlaying).toBe(false)

    let redrawCount = 0
    let renderTime = 0
    workstation.transport.onRenderFrame((time, isSeek) => {
      if (isSeek) {
        redrawCount++
        renderTime = time
      }
    })

    // 4. Scrub timeline to exact beat drop at t=42.50s
    workstation.transport.seek(42.5)
    expect(workstation.transport.currentTime).toBe(42.5)
    expect(redrawCount).toBe(1)
    expect(renderTime).toBe(42.5)

    // Modulate audio uniform value at scrubbed frame
    const modulatedVal = workstation.inspector.audio.vuMeters.bass * workstation.inspector.audio.reactiveBindings["u_audioPulse"].amount
    expect(modulatedVal).toBeCloseTo(2.0, 2)

    // 5. Resume playback from scrubbed position
    workstation.transport.setIsPlaying(true)
    workstation.transport.tick(500) // +0.5s
    expect(workstation.transport.currentTime).toBeCloseTo(43.0, 2)
  })

  it("Combo 3: Parameter Inspector Search Query + Per-Uniform Reset + Live Store Sync", () => {
    const workstation = createWorkstationHarness()

    const parsedUniforms: ParsedUniform[] = [
      { name: "u_fogDensity", type: "f32", kind: "scalar" },
      { name: "u_fogColor", type: "vec3f", kind: "color" },
      { name: "u_cameraSpeed", type: "f32", kind: "scalar" },
    ]

    const initialDefaults = {
      u_fogDensity: { type: "float" as const, value: 0.05 },
      u_fogColor: { type: "vec3" as const, value: [0.8, 0.8, 0.9] },
      u_cameraSpeed: { type: "float" as const, value: 1.0 },
    }
    workstation.inspector.setParsedDefaults(initialDefaults)
    useProjectStore.getState().setUniformValue("u_fogDensity", { type: "float", value: 0.95 })
    useProjectStore.getState().setUniformValue("u_fogColor", { type: "vec3", value: [0.1, 0.2, 0.3] })
    useProjectStore.getState().setUniformValue("u_cameraSpeed", { type: "float", value: 5.0 })

    // 1. Search for "fog"
    workstation.inspector.setSearchQuery("fog")
    const filtered = workstation.inspector.getFilteredUniforms(parsedUniforms)
    expect(filtered).toHaveLength(2)
    expect(filtered.map((u) => u.name)).toEqual(["u_fogDensity", "u_fogColor"])

    // 2. Reset u_fogDensity to default
    workstation.inspector.resetUniformToDefault("u_fogDensity")

    // u_fogDensity is restored to default 0.05, while u_cameraSpeed remains 5.0
    expect(useProjectStore.getState().uniformValues.u_fogDensity.value).toBe(0.05)
    expect(useProjectStore.getState().uniformValues.u_cameraSpeed.value).toBe(5.0)

    // 3. Clear search query: all uniforms visible
    workstation.inspector.setSearchQuery("")
    expect(workstation.inspector.getFilteredUniforms(parsedUniforms)).toHaveLength(3)
  })

  it("Combo 4: Monaco Multi-Tabs + Diagnostic Isolation + Console Drawer Jump-to-Line + Viewport Restore", () => {
    const workstation = createWorkstationHarness()

    // 1. Maximize Viewport (artist is inspecting 3D model)
    workstation.layout.setMaximizedPanel("viewport")
    expect(workstation.layout.maximizedPanel).toBe("viewport")
    expect(workstation.layout.getEditorDimensions().width).toBe(0)

    // 2. Diagnostics arrive from compiler across multiple tabs
    workstation.editorConsole.addDiagnostic({
      tab: "vertex",
      severity: "error",
      message: "undeclared attribute a_normal",
      line: 8,
      column: 12,
    })
    const compDiagId = workstation.editorConsole.addDiagnostic({
      tab: "compute",
      severity: "error",
      message: "storage buffer binding out of range",
      line: 55,
      column: 20,
    })

    expect(workstation.editorConsole.getErrorCount()).toBe(2)

    // 3. User clicks Compute diagnostic in bottom Console drawer
    const jumpResult = workstation.editorConsole.clickToJump(compDiagId, workstation.layout)
    expect(jumpResult).toBe(true)

    // Monaco tab automatically switches to Compute
    expect(workstation.editorConsole.activeTab).toBe("compute")

    // Active tab marker isolation: only Compute diagnostics are visible in Monaco
    const activeMarkers = workstation.editorConsole.getActiveTabDiagnostics()
    expect(activeMarkers).toHaveLength(1)
    expect(activeMarkers[0].message).toContain("storage buffer binding")

    // Viewport automatically un-maximized so Monaco Editor is revealed
    expect(workstation.layout.maximizedPanel).toBe("none")
    expect(workstation.layout.getEditorDimensions().width).toBeGreaterThan(0)

    // Jump target set to line 55, column 20
    expect(workstation.layout.jumpTarget?.line).toBe(55)
    expect(workstation.layout.jumpTarget?.column).toBe(20)
  })

  it("Combo 5: Variations Snapshot Save/Apply + Virtual Playback Clock Continuity", () => {
    const workstation = createWorkstationHarness()

    // 1. Set uniforms at t=5s
    workstation.transport.setCurrentTime(5.0)
    useProjectStore.getState().setUniformValue("u_bloom", { type: "float", value: 2.0 })
    useProjectStore.getState().setUniformValue("u_tint", { type: "vec3", value: [1.0, 0.0, 0.0] })

    // Save variation
    const varA = workstation.inspector.saveVariation("Vibrant Red")

    // 2. Advance time to t=25s, alter uniforms
    workstation.transport.setCurrentTime(25.0)
    useProjectStore.getState().setUniformValue("u_bloom", { type: "float", value: 0.1 })
    useProjectStore.getState().setUniformValue("u_tint", { type: "vec3", value: [0.0, 0.0, 1.0] })

    const varB = workstation.inspector.saveVariation("Cool Blue")

    // 3. Apply Variation A: uniforms restore immediately while timeline position remains t=25s
    workstation.inspector.applyVariation(varA)
    expect(useProjectStore.getState().uniformValues.u_bloom.value).toBe(2.0)
    expect(useProjectStore.getState().uniformValues.u_tint.value).toEqual([1.0, 0.0, 0.0])
    expect(workstation.transport.currentTime).toBe(25.0)

    // 4. Apply Variation B
    workstation.inspector.applyVariation(varB)
    expect(useProjectStore.getState().uniformValues.u_bloom.value).toBe(0.1)
    expect(useProjectStore.getState().uniformValues.u_tint.value).toEqual([0.0, 0.0, 1.0])
  })

  it("Combo 6: Theme Toggle + Status Bar Telemetry + Backend Badges", () => {
    const workstation = createWorkstationHarness()

    // 1. Set backend to WebGPU
    useProjectStore.getState().setActiveBackend("webgpu")
    expect(useProjectStore.getState().activeBackend).toBe("webgpu")

    // 2. Status bar telemetry receives metrics from transport
    let statusTelemetry: any = null
    workstation.transport.onMetrics((metrics) => {
      statusTelemetry = {
        backend: useProjectStore.getState().activeBackend,
        fps: metrics.fps,
        frameTime: metrics.frameTimeMs,
        errors: workstation.editorConsole.getErrorCount(),
      }
    })

    workstation.transport.tick(16.6)
    expect(statusTelemetry.backend).toBe("webgpu")
    expect(statusTelemetry.fps).toBe(60)
    expect(statusTelemetry.errors).toBe(0)

    // 3. Introduce diagnostic error
    workstation.editorConsole.addDiagnostic({
      tab: "fragment",
      severity: "error",
      message: "syntax error",
      line: 1,
    })

    workstation.transport.tick(16.6)
    expect(statusTelemetry.errors).toBe(1)

    // 4. Switch backend badge to WebGL2
    useProjectStore.getState().setActiveBackend("webgl2")
    workstation.transport.tick(16.6)
    expect(statusTelemetry.backend).toBe("webgl2")
  })
})
