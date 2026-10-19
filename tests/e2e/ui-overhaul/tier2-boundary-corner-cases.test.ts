/**
 * Tier 2: Boundary & Corner Cases — ShaderStudio UI/UX Creative Workstation Overhaul
 *
 * Rigorous boundary, edge condition, and defensive clamping tests:
 * - Rapid clicking and tab race conditions
 * - 0px collapse and extreme viewport dimensions
 * - Center stage split ratio boundaries and mutually exclusive maximize locks
 * - Time scrub clamping (negative, EOF, micro-stepping, paused scrubbing)
 * - Resolution scale 2x clamp on high-DPI displays and invalid scale handling
 * - Empty search results, regex meta-character injection in parameter inspector
 * - Reset-to-default edge conditions (non-existent uniforms, deep struct independence)
 * - Monaco Line jump clamping (line 0, negative lines, floating point lines, hidden editor auto-reveal)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  LayoutHarness,
  TransportHarness,
  InspectorHarness,
  EditorConsoleHarness,
  type ActivityTab,
} from "./uiHarness"
import { useProjectStore, type ParsedUniform } from "@/stores/projectStore"

describe("Tier 2: Boundary & Corner Cases — UI/UX Creative Workstation Overhaul", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Rapid Clicking & Activity Bar Race Conditions
  // ==========================================================================
  describe("Rapid Clicking & Activity Bar Sidebar State Integrity", () => {
    it("handles 100 rapid sequential tab switches across Activity Bar without state corruption", () => {
      const layout = new LayoutHarness()
      const tabs: ActivityTab[] = ["graph", "project", "templates", "copilot"]

      for (let i = 0; i < 100; i++) {
        const targetTab = tabs[i % tabs.length]
        layout.toggleActivityTab(targetTab)
      }

      // After 100 clicks (ends on tabs[99 % 4] = tabs[3] = 'copilot')
      expect(layout.isLeftSidebarOpen).toBe(true)
      expect(layout.activeActivityTab).toBe("copilot")
      expect(layout.getEffectiveLeftSidebarWidth()).toBe(260)
    })

    it("handles 50 rapid toggles on the same active tab, alternating cleanly between open and 0px collapsed", () => {
      const layout = new LayoutHarness()

      for (let i = 1; i <= 50; i++) {
        layout.toggleActivityTab("graph")
        if (i % 2 === 1) {
          // Odd clicks: opened
          expect(layout.isLeftSidebarOpen).toBe(true)
          expect(layout.activeActivityTab).toBe("graph")
          expect(layout.getEffectiveLeftSidebarWidth()).toBe(260)
        } else {
          // Even clicks: collapsed to 0px
          expect(layout.isLeftSidebarOpen).toBe(false)
          expect(layout.activeActivityTab).toBeNull()
          expect(layout.getEffectiveLeftSidebarWidth()).toBe(0)
        }
      }
    })
  })

  // ==========================================================================
  // 2. 0px Collapse & Extreme Dimension Boundaries
  // ==========================================================================
  describe("0px Collapse & Workstation Dimensions", () => {
    it("reclaims 100% of available horizontal space when both sidebars are collapsed", () => {
      const layout = new LayoutHarness()

      // Collapse both left dock and right inspector
      layout.setLeftSidebarOpen(false)
      layout.setRightInspectorOpen(false)

      expect(layout.getEffectiveLeftSidebarWidth()).toBe(0)
      expect(layout.getEffectiveRightInspectorWidth()).toBe(0)

      // Total width: 1920 - 48 (rail) = 1872px dedicated to Center Stage
      expect(layout.getEffectiveCenterStageWidth()).toBe(1872)
    })

    it("preserves non-negative viewport dimensions under small laptop resolution (1280x720)", () => {
      const layout = new LayoutHarness()
      layout.totalWidth = 1280
      layout.totalHeight = 720
      layout.setLeftSidebarOpen(true)
      layout.setRightInspectorOpen(true)
      layout.setConsoleOpen(true)

      const centerW = layout.getEffectiveCenterStageWidth()
      const centerH = layout.getEffectiveCenterStageHeight()

      expect(centerW).toBeGreaterThan(0)
      expect(centerH).toBeGreaterThan(0)
      expect(centerW).toBe(1280 - 48 - 260 - 320) // 652px
      expect(centerH).toBe(720 - 44 - 28 - 180) // 468px

      const viewDims = layout.getViewportDimensions()
      expect(viewDims.width).toBeGreaterThan(0)
      expect(viewDims.height).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 3. Center Stage Split Ratio & Maximization Clamping
  // ==========================================================================
  describe("Center Stage Split & Maximization Exclusivity", () => {
    it("enforces mutually exclusive maximization: maximizing Editor cancels Viewport maximization and vice-versa", () => {
      const layout = new LayoutHarness()

      // Maximize Viewport
      layout.setMaximizedPanel("viewport")
      expect(layout.maximizedPanel).toBe("viewport")
      expect(layout.getViewportDimensions().width).toBe(layout.getEffectiveCenterStageWidth())
      expect(layout.getEditorDimensions().width).toBe(0)

      // Directly toggle maximize Editor: switches to editor
      layout.setMaximizedPanel("editor")
      expect(layout.maximizedPanel).toBe("editor")
      expect(layout.getEditorDimensions().width).toBe(layout.getEffectiveCenterStageWidth())
      expect(layout.getViewportDimensions().width).toBe(0)

      // Toggle off
      layout.setMaximizedPanel("none")
      expect(layout.maximizedPanel).toBe("none")
      expect(layout.getViewportDimensions().width).toBeGreaterThan(0)
      expect(layout.getEditorDimensions().width).toBeGreaterThan(0)
    })

    it("handles extreme split ratio drag (0.0 and 1.0) without NaN or crash", () => {
      const layout = new LayoutHarness()

      // Drag split to 0.0 (viewport min)
      layout.centerSplitRatio = 0.0
      expect(layout.getViewportDimensions().width).toBe(0)
      expect(layout.getEditorDimensions().width).toBe(layout.getEffectiveCenterStageWidth())

      // Drag split to 1.0 (editor min)
      layout.centerSplitRatio = 1.0
      expect(layout.getViewportDimensions().width).toBe(layout.getEffectiveCenterStageWidth())
      expect(layout.getEditorDimensions().width).toBe(0)
    })
  })

  // ==========================================================================
  // 4. Time Scrub Boundaries & Precision Clamping
  // ==========================================================================
  describe("Time Scrub Boundaries & Precision", () => {
    it("clamps negative time scrub values to 0.00s", () => {
      const transport = new TransportHarness()

      transport.seek(-15.75)
      expect(transport.currentTime).toBe(0.0)
      expect(transport.getFormattedTime()).toBe("00:00.00")

      transport.setCurrentTime(-999.0)
      expect(transport.currentTime).toBe(0.0)
    })

    it("clamps forward scrub values beyond duration to timeline end", () => {
      const transport = new TransportHarness()
      transport.duration = 120.0 // 2 minutes

      transport.seek(9999.0)
      expect(transport.currentTime).toBe(120.0)
      expect(transport.getFormattedTime()).toBe("02:00.00")
    })

    it("preserves high-precision sub-millisecond timeline stepping without NaN drift", () => {
      const transport = new TransportHarness()

      // Step by 0.001s (1 millisecond)
      for (let i = 0; i < 100; i++) {
        transport.seek(transport.currentTime + 0.001)
      }
      expect(transport.currentTime).toBeCloseTo(0.1, 3)
      expect(Number.isNaN(transport.currentTime)).toBe(false)
    })

    it("ensures seeking while paused does not accidentally restart playback", () => {
      const transport = new TransportHarness()
      transport.setIsPlaying(false)
      expect(transport.isPlaying).toBe(false)

      transport.seek(15.0)
      expect(transport.currentTime).toBe(15.0)
      expect(transport.isPlaying).toBe(false) // Stays paused
    })
  })

  // ==========================================================================
  // 5. Resolution Scale Multiplier Clamping & High-DPI Guardrails
  // ==========================================================================
  describe("Resolution Scale Clamping & High-DPI Guardrails", () => {
    it("caps 2x scale and native scale to 2.0 DPR on 4K/Retina displays to protect GPU memory", () => {
      const transport = new TransportHarness()

      // On host with 3.5 DPR (ultra-dense mobile/retina screen)
      transport.setResolutionScale("native")
      expect(transport.getEffectiveDpr(3.5)).toBe(2.0)

      transport.setResolutionScale(2)
      expect(transport.getEffectiveDpr(3.5)).toBe(2.0)

      // On standard 1.0 DPR display
      transport.setResolutionScale(0.5)
      expect(transport.getEffectiveDpr(1.0)).toBe(0.5)

      transport.setResolutionScale(1)
      expect(transport.getEffectiveDpr(1.0)).toBe(1.0)
    })

    it("sanitizes unexpected or out-of-bounds scale inputs", () => {
      const transport = new TransportHarness()

      // Invalid negative number clamps to 0.5
      transport.setResolutionScale(-5 as any)
      expect(transport.resolutionScale).toBe(0.5)

      // Excessive number clamps to 2
      transport.setResolutionScale(10 as any)
      expect(transport.resolutionScale).toBe(2)
    })
  })

  // ==========================================================================
  // 6. Parameter Inspector Search Filter & Regex Safety
  // ==========================================================================
  describe("Parameter Inspector Search Filter Edge Cases", () => {
    it("handles regex meta-characters in search query without throwing syntax exceptions", () => {
      const inspector = new InspectorHarness()
      const sampleUniforms: ParsedUniform[] = [
        { name: "u_pattern[0]", type: "f32", kind: "scalar" },
        { name: "u_weight(alpha)", type: "f32", kind: "scalar" },
        { name: "u_test$val", type: "f32", kind: "scalar" },
      ]

      // Search query containing regex syntax characters: (, ), [, ], $, *, +, ?
      expect(() => {
        inspector.setSearchQuery("pattern[0]")
        const matches = inspector.getFilteredUniforms(sampleUniforms)
        expect(matches).toHaveLength(1)
        expect(matches[0].name).toBe("u_pattern[0]")
      }).not.toThrow()

      expect(() => {
        inspector.setSearchQuery("(alpha)")
        const matches = inspector.getFilteredUniforms(sampleUniforms)
        expect(matches).toHaveLength(1)
        expect(matches[0].name).toBe("u_weight(alpha)")
      }).not.toThrow()

      expect(() => {
        inspector.setSearchQuery(".*+?^${}()|[]\\")
        const matches = inspector.getFilteredUniforms(sampleUniforms)
        expect(matches).toHaveLength(0)
      }).not.toThrow()
    })

    it("trims leading and trailing whitespace from search queries", () => {
      const inspector = new InspectorHarness()
      const sampleUniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "f32", kind: "scalar" },
      ]

      inspector.setSearchQuery("   roughness   ")
      expect(inspector.getFilteredUniforms(sampleUniforms)).toHaveLength(1)

      inspector.setSearchQuery("    ")
      // Whitespace-only search returns all uniforms
      expect(inspector.getFilteredUniforms(sampleUniforms)).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 7. Reset to Defaults Boundary Conditions
  // ==========================================================================
  describe("Reset to Defaults Boundary Safety", () => {
    it("handles reset request for non-existent uniform gracefully as a safe no-op", () => {
      const inspector = new InspectorHarness()
      inspector.setParsedDefaults({
        u_valid: { type: "float", value: 1.0 },
      })

      expect(() => {
        inspector.resetUniformToDefault("u_ghost_variable")
      }).not.toThrow()
    })

    it("resets deep struct/matrix uniforms independently without reference pollution", () => {
      const inspector = new InspectorHarness()
      const defaultMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      inspector.setParsedDefaults({
        u_modelMatrix: { type: "mat4", value: [...defaultMatrix] },
      })

      // Mutate in store
      useProjectStore.getState().setUniformValue("u_modelMatrix", {
        type: "mat4",
        value: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
      })

      // Reset
      inspector.resetUniformToDefault("u_modelMatrix")
      const restored = useProjectStore.getState().uniformValues.u_modelMatrix.value as number[]
      expect(restored).toEqual(defaultMatrix)

      // Mutate restored array directly; verify parsedDefaults remains pristine
      restored[0] = 999
      expect((inspector.parsedDefaults.u_modelMatrix.value as number[])[0]).toBe(1)
    })
  })

  // ==========================================================================
  // 8. Monaco Line Jump Clamping & Negative Coordinate Handling
  // ==========================================================================
  describe("Monaco Line Jump Clamping & Hidden Editor Auto-Reveal", () => {
    it("clamps negative lines and line 0 to line 1", () => {
      const layout = new LayoutHarness()

      layout.jumpToLine(0, 5)
      expect(layout.jumpTarget?.line).toBe(1)
      expect(layout.jumpTarget?.column).toBe(5)

      layout.jumpToLine(-42, 10)
      expect(layout.jumpTarget?.line).toBe(1)
      expect(layout.jumpTarget?.column).toBe(10)
    })

    it("floors floating point line numbers to integer", () => {
      const layout = new LayoutHarness()

      layout.jumpToLine(24.8, 3.9)
      expect(layout.jumpTarget?.line).toBe(24)
      expect(layout.jumpTarget?.column).toBe(3)
    })

    it("defaults missing or invalid column to column 1", () => {
      const layout = new LayoutHarness()

      layout.jumpToLine(10, undefined)
      expect(layout.jumpTarget?.column).toBe(1)

      layout.jumpToLine(10, -5)
      expect(layout.jumpTarget?.column).toBe(1)
    })

    it("automatically un-maximizes Viewport when line jump is triggered so the editor becomes visible", () => {
      const layout = new LayoutHarness()
      layout.setMaximizedPanel("viewport")
      expect(layout.maximizedPanel).toBe("viewport")

      // User clicks error line jump
      layout.jumpToLine(15, 4)
      expect(layout.maximizedPanel).toBe("none")
      expect(layout.jumpTarget?.line).toBe(15)
    })
  })
})
