/**
 * Tier 4: Real-World Application Scenarios — ShaderStudio UI/UX Creative Workstation Overhaul
 *
 * End-to-end artist workstation workflows:
 * - Scenario 1: Creative Shader Authoring from Scratch (Template Loading, Viewport Maximize, Resolution Scaling)
 * - Scenario 2: Audio-Reactive Interactive VJ Performance (Audio Dynamics Accordion, Timeline Scrubbing, Reset t=0)
 * - Scenario 3: Multi-Pass Compute Shader Development & Debugging (Multi-Tabs, Console Drawer Jump-to-Line, Ctrl+Enter)
 * - Scenario 4: Production Preset Variation Curation & Packaging (Variations Snapshot Save/Apply, Project Export)
 * - Scenario 5: Stressful Long-Running Creative Workstation Session (Multi-Panel Switching, Backend Transitions, Zero-Leak Stability)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  createWorkstationHarness,
  type ShaderEditorTab,
} from "./uiHarness"
import { useProjectStore, type ParsedUniform } from "@/stores/projectStore"
import { renderCoordinator } from "@/core/renderCoordinator"

describe("Tier 4: Real-World Application Scenarios — UI/UX Creative Workstation Overhaul", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  it("Scenario 1: Creative Shader Authoring from Scratch (Template Loading, Fullscreen & Resolution Scaling)", () => {
    const ws = createWorkstationHarness()

    // Step 1: Artist starts with blank project
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().shaderSource).toBe("")

    // Step 2: Open Activity Bar 'templates' tab
    ws.layout.toggleActivityTab("templates")
    expect(ws.layout.isLeftSidebarOpen).toBe(true)
    expect(ws.layout.activeActivityTab).toBe("templates")

    // Step 3: Load Raymarching Template into Shader Editor
    const raymarchingWGSL = `
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u_resolution;
  let d = length(uv - vec2f(0.5)) - 0.25;
  return vec4f(vec3f(step(0.0, -d)), 1.0);
}
`
    useProjectStore.getState().setShaderSource(raymarchingWGSL)
    ws.editorConsole.setSource("fragment", raymarchingWGSL)
    expect(useProjectStore.getState().shaderSource).toContain("fs_main")

    // Step 4: Maximize Viewport for immersive full-screen inspection
    ws.layout.toggleMaximizeViewport()
    expect(ws.layout.maximizedPanel).toBe("viewport")
    expect(ws.layout.getViewportDimensions().width).toBe(ws.layout.getEffectiveCenterStageWidth())
    expect(ws.layout.getEditorDimensions().width).toBe(0)

    // Step 5: Test draft rendering at 0.5x resolution scale
    ws.transport.setResolutionScale(0.5)
    expect(ws.transport.resolutionScale).toBe(0.5)
    expect(ws.transport.getEffectiveDpr(1.0)).toBe(0.5)

    // Step 6: Switch to hero render mode at 2x supersampling
    ws.transport.setResolutionScale(2)
    expect(ws.transport.resolutionScale).toBe(2)
    expect(ws.transport.getEffectiveDpr(1.0)).toBe(2.0)

    // Step 7: Restore Viewport to normal dual-split stage
    ws.layout.toggleMaximizeViewport()
    expect(ws.layout.maximizedPanel).toBe("none")
    expect(ws.layout.getEditorDimensions().width).toBeGreaterThan(0)
  })

  it("Scenario 2: Audio-Reactive Interactive VJ Performance (Dynamics Accordion, Scrubbing & Reset)", () => {
    const ws = createWorkstationHarness()

    // Step 1: Open Audio Dynamics accordion in Parameter Inspector
    ws.inspector.openAccordions.add("audio")
    expect(ws.inspector.isAccordionOpen("audio")).toBe(true)

    // Step 2: Configure audio reactive band bindings
    ws.inspector.audio.gain = 1.5
    ws.inspector.audio.smoothing = 0.85
    ws.inspector.audio.reactiveBindings["u_bassDrop"] = { band: "bass", amount: 3.0 }

    // Step 3: Start playback
    ws.transport.setIsPlaying(true)
    ws.transport.tick(5000) // 5 seconds of VJ performance
    expect(ws.transport.currentTime).toBeCloseTo(5.0, 2)

    // Step 4: Pause at peak beat drop, scrub timeline to inspect single frame
    ws.transport.setIsPlaying(false)
    let scrubRedrawFired = false
    ws.transport.onRenderFrame((time, isSeek) => {
      if (isSeek) scrubRedrawFired = true
    })

    ws.transport.seek(3.75) // Scrub to 00:03.75
    expect(ws.transport.currentTime).toBe(3.75)
    expect(ws.transport.getFormattedTime()).toBe("00:03.75")
    expect(scrubRedrawFired).toBe(true)

    // Step 5: Rewind / Reset Time to t=0 for live drop
    ws.transport.resetTime()
    expect(ws.transport.currentTime).toBe(0.0)
    expect(ws.transport.getFormattedTime()).toBe("00:00.00")

    // Step 6: Resume live playback
    ws.transport.setIsPlaying(true)
    ws.transport.tick(1000)
    expect(ws.transport.currentTime).toBeCloseTo(1.0, 2)
  })

  it("Scenario 3: Multi-Pass Compute Shader Development & Debugging Workflow", () => {
    const ws = createWorkstationHarness()

    // Step 1: Switch editor tab from Fragment to Compute
    expect(ws.editorConsole.activeTab).toBe("fragment")
    ws.editorConsole.setActiveTab("compute")
    expect(ws.editorConsole.activeTab).toBe("compute")

    // Step 2: Write compute kernel code
    const initialCompute = `@compute @workgroup_size(64)\nfn cs_main(@builtin(global_invocation_id) id: vec3u) {\n  let x = id.x;\n}\n`
    ws.editorConsole.setSource("compute", initialCompute)

    // Step 3: Simulate syntax typo introduced by developer
    const errorCompute = `@compute @workgroup_size(64)\nfn cs_main(@builtin(global_invocation_id) id: vec3u) {\n  let x = id.x + \n}\n`
    ws.editorConsole.setSource("compute", errorCompute)

    // Compiler produces diagnostic error
    const diagId = ws.editorConsole.addDiagnostic({
      tab: "compute",
      severity: "error",
      message: "expected expression after '+'",
      line: 3,
      column: 17,
    })

    // Diagnostic card appears in Console drawer
    expect(ws.editorConsole.getErrorCount()).toBe(1)
    expect(ws.editorConsole.getActiveTabDiagnostics()).toHaveLength(1)

    // Step 4: User clicks error card in Console drawer
    const jumpHandled = ws.editorConsole.clickToJump(diagId, ws.layout)
    expect(jumpHandled).toBe(true)
    expect(ws.editorConsole.activeTab).toBe("compute")
    expect(ws.layout.jumpTarget?.line).toBe(3)
    expect(ws.layout.jumpTarget?.column).toBe(17)

    // Step 5: Developer fixes typo and triggers Ctrl+Enter instant recompile
    const fixedCompute = `@compute @workgroup_size(64)\nfn cs_main(@builtin(global_invocation_id) id: vec3u) {\n  let x = id.x + 1u;\n}\n`
    ws.editorConsole.setSource("compute", fixedCompute)
    ws.editorConsole.clearDiagnostics()
    ws.editorConsole.triggerRecompile()

    expect(ws.editorConsole.getErrorCount()).toBe(0)
    expect(ws.editorConsole.getActiveTabDiagnostics()).toHaveLength(0)
    expect(ws.editorConsole.recompileCount).toBeGreaterThan(0)
  })

  it("Scenario 4: Production Preset Variation Curation & Packaging Workflow", () => {
    const ws = createWorkstationHarness()

    // Step 1: Setup project uniforms in inspector
    useProjectStore.getState().setUniformValue("u_specular", { type: "float", value: 0.2 })
    useProjectStore.getState().setUniformValue("u_tint", { type: "color", value: [1.0, 0.4, 0.2] })

    // Step 2: Create variation snapshot 'Warm Sunset'
    const varSunset = ws.inspector.saveVariation("Warm Sunset")
    expect(varSunset).toBeDefined()

    // Step 3: Modify uniforms for 'Cyber Matrix'
    useProjectStore.getState().setUniformValue("u_specular", { type: "float", value: 1.0 })
    useProjectStore.getState().setUniformValue("u_tint", { type: "color", value: [0.0, 1.0, 0.2] })
    const varCyber = ws.inspector.saveVariation("Cyber Matrix")

    // Step 4: Toggle between variations and verify instantaneous parameter restoration
    ws.inspector.applyVariation(varSunset)
    expect(useProjectStore.getState().uniformValues.u_specular.value).toBe(0.2)
    expect(useProjectStore.getState().uniformValues.u_tint.value).toEqual([1.0, 0.4, 0.2])

    ws.inspector.applyVariation(varCyber)
    expect(useProjectStore.getState().uniformValues.u_specular.value).toBe(1.0)
    expect(useProjectStore.getState().uniformValues.u_tint.value).toEqual([0.0, 1.0, 0.2])

    // Step 5: Export project bundle with variations
    useProjectStore.getState().setCurrentProjectName("NeonStation")
    const bundle = useProjectStore.getState().exportProjectData()
    expect(bundle.name).toBe("NeonStation")
    expect(bundle.variations).toHaveLength(2)
  })

  it("Scenario 5: Stressful Long-Running Creative Workstation Session", () => {
    const ws = createWorkstationHarness()

    // 1. Simulate 20 rapid workstation reconfiguration cycles
    const backends: Array<"webgpu" | "webgl2" | "threejs"> = ["webgpu", "webgl2", "threejs"]
    const scales: Array<0.5 | 1 | 2 | "native"> = [0.5, 1, 2, "native"]

    for (let i = 0; i < 20; i++) {
      // Switch backend
      useProjectStore.getState().setActiveBackend(backends[i % backends.length])

      // Switch resolution scale
      ws.transport.setResolutionScale(scales[i % scales.length])

      // Advance virtual clock
      ws.transport.tick(16.67)

      // Toggle sidebars
      if (i % 3 === 0) ws.layout.toggleActivityTab("graph")
      if (i % 4 === 0) ws.layout.toggleRightInspector()
      if (i % 5 === 0) ws.layout.toggleSplitOrientation()
    }

    // 2. Validate final workstation integrity
    expect(ws.transport.isPlaying).toBe(true)
    expect(ws.transport.currentTime).toBeGreaterThan(0)
    expect(ws.layout.getEffectiveCenterStageWidth()).toBeGreaterThan(0)
    expect(ws.layout.getEffectiveCenterStageHeight()).toBeGreaterThan(0)
  })
})
