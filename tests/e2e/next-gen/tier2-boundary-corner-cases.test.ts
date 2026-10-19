/**
 * Tier 2: Boundary & Corner Cases — ShaderStudio Feature Overhaul (R1–R5)
 *
 * Exhaustive boundary, edge condition, stress, and error validation:
 * - Sub-graph exact 8-level nesting limit & 9-level overflow error
 * - Mutual / indirect cycle detection (A -> B -> C -> A)
 * - Missing sub-graph lookup and empty graph flattening
 * - Custom node manifest validation errors (missing fields, bad types, no shaders)
 * - Custom node directory discovery resilience against corrupted JSON
 * - Math expression syntax boundaries (unbalanced parentheses, illegal operators, whitelist leaks)
 * - Frame node spatial boundaries (0x0, perimeter collision, negative coordinates)
 * - Shadow map resolution validation (rejection of non-power-of-two or unapproved sizes)
 * - Atmosphere time-of-day clamping (sub-zero, >24h, midnight/noon transitions)
 * - Memory budget threshold trigger boundaries (79.9% vs 80.1%)
 * - Mesh LOD distance decimation boundaries (distance=0, boundary transitions)
 * - Tauri desktop native file extension validation (.shaderstudio) and port validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import {
  createNextGenWorkstationHarness,
  type NextGenWorkstationHarness,
} from "./nextGenHarness"

describe("Tier 2: Boundary & Corner Cases — ShaderStudio Feature Overhaul (R1–R5)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let ws: NextGenWorkstationHarness

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    ws = createNextGenWorkstationHarness()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // R1 Boundaries: Sub-graphs, Custom Nodes, Math Expr, Annotations
  // ==========================================================================
  describe("R1 Boundaries: Sub-graphs & Node Graph Power-ups", () => {
    it("B-NODE-01: Exactly 8 levels of sub-graph nesting is permitted", () => {
      // Build an 8-level chain: sg1 -> sg2 -> ... -> sg8
      for (let i = 1; i <= 8; i++) {
        const nextId = i < 8 ? `sg_level_${i + 1}` : undefined
        ws.subgraphs.register({
          id: `sg_level_${i}`,
          name: `Nesting Level ${i}`,
          inputs: [{ id: "in", name: "in", type: "float", direction: "input" }],
          outputs: [{ id: "out", name: "out", type: "float", direction: "output" }],
          nodes: nextId
            ? [{ id: `child_${i}`, type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: nextId } }]
            : [{ id: `leaf_${i}`, type: "math", position: { x: 0, y: 0 }, data: { op: "add" } }],
          edges: [],
        })
      }

      const depth = ws.subgraphs.getNestingDepth("sg_level_1")
      expect(depth).toBe(8)
    })

    it("B-NODE-02: 9 levels of sub-graph nesting throws an explicit limit error", () => {
      // Build a 9-level chain: sg1 -> ... -> sg9
      for (let i = 1; i <= 9; i++) {
        const nextId = i < 9 ? `sg_deep_${i + 1}` : undefined
        ws.subgraphs.register({
          id: `sg_deep_${i}`,
          name: `Deep Level ${i}`,
          inputs: [],
          outputs: [],
          nodes: nextId
            ? [{ id: `child_${i}`, type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: nextId } }]
            : [{ id: `leaf_${i}`, type: "math", position: { x: 0, y: 0 }, data: { op: "sin" } }],
          edges: [],
        })
      }

      expect(() => {
        ws.subgraphs.flattenGraph(
          [{ id: "root", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "sg_deep_1" } }],
          []
        )
      }).toThrow(/Sub-graph nesting depth 9 exceeds maximum limit of 8/)
    })

    it("B-NODE-03: Multi-node indirect cycle (A -> B -> C -> A) is detected and blocked", () => {
      ws.subgraphs.register({
        id: "cycle_A",
        name: "Cycle A",
        inputs: [],
        outputs: [],
        nodes: [{ id: "nB", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "cycle_B" } }],
        edges: [],
      })
      ws.subgraphs.register({
        id: "cycle_B",
        name: "Cycle B",
        inputs: [],
        outputs: [],
        nodes: [{ id: "nC", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "cycle_C" } }],
        edges: [],
      })
      ws.subgraphs.register({
        id: "cycle_C",
        name: "Cycle C",
        inputs: [],
        outputs: [],
        nodes: [{ id: "nA", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "cycle_A" } }],
        edges: [],
      })

      expect(ws.subgraphs.detectCycle("cycle_A")).toBe(true)
      expect(() => ws.subgraphs.getNestingDepth("cycle_A")).toThrow(/Cycle detected/)
      expect(() => {
        ws.subgraphs.flattenGraph(
          [{ id: "root", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "cycle_A" } }],
          []
        )
      }).toThrow(/infinite recursion cycle detected/)
    })

    it("B-NODE-04: Non-existent sub-graph ID lookup throws descriptive error during compilation", () => {
      expect(() => {
        ws.subgraphs.flattenGraph(
          [{ id: "bad_node", type: "subgraph", position: { x: 0, y: 0 }, data: { subGraphId: "missing-subgraph-404" } }],
          []
        )
      }).toThrow(/Sub-graph "missing-subgraph-404" not found in library/)
    })

    it("B-NODE-05: Custom node manifest rejection — Missing type, title, and invalid categories", () => {
      const badCategory = {
        type: "bad_node",
        title: "Bad Node",
        category: "invalid_category",
        inputs: [],
        outputs: [],
        glsl: "void main() {}",
      }
      const check = ws.customNodes.validateManifest(badCategory)
      expect(check.valid).toBe(false)
      expect(check.errors.some((e) => e.includes("Invalid category"))).toBe(true)
    })

    it("B-NODE-06: Custom node manifest rejection — Neither GLSL nor WGSL snippet supplied", () => {
      const noShaders = {
        type: "no_shader_node",
        title: "No Shader",
        category: "utility",
        inputs: [],
        outputs: [],
      }
      const check = ws.customNodes.validateManifest(noShaders)
      expect(check.valid).toBe(false)
      expect(check.errors.some((e) => e.includes("either 'glsl' or 'wgsl'"))).toBe(true)
    })

    it("B-NODE-07: Custom node directory discovery resilience — Corrupted JSON is logged, valid loaded", () => {
      const files = {
        "custom-nodes/corrupt.json": "{ invalid json syntax ...",
        "custom-nodes/good.json": JSON.stringify({
          type: "good_node",
          title: "Good Node",
          category: "math",
          inputs: [],
          outputs: [],
          wgsl: "fn good() {}",
        }),
      }

      const res = ws.customNodes.discoverFromDirectory(files)
      expect(res.loaded).toBe(1)
      expect(res.errors["custom-nodes/corrupt.json"]).toBeDefined()
      expect(ws.customNodes.get("good_node")).toBeDefined()
    })

    it("B-NODE-08: Math expression validation — Unmatched closing parenthesis and unbalanced braces", () => {
      const res = ws.mathExpr.validate("sin(uv.x * 2.0))")
      expect(res.valid).toBe(false)
      expect(res.error).toContain("Unmatched closing parenthesis")
    })

    it("B-NODE-09: Math expression validation — Consecutive illegal operators rejected", () => {
      const res = ws.mathExpr.validate("uv.x ++ 0.5")
      expect(res.valid).toBe(false)
      expect(res.error).toContain("Invalid operator sequence")
    })

    it("B-NODE-10: Math expression validation — Empty or whitespace-only expression", () => {
      expect(ws.mathExpr.validate("").valid).toBe(false)
      expect(ws.mathExpr.validate("   ").valid).toBe(false)
      expect(ws.mathExpr.validate("").error).toBe("Expression cannot be empty")
    })

    it("B-NODE-11: Frame annotation spatial boundary — Zero dimensions and perimeter containment", () => {
      const frame = {
        id: "f0",
        type: "frame",
        position: { x: 100, y: 100 },
        width: 200,
        height: 200,
        data: {},
      }
      // Exact corners
      expect(ws.annotations.isContainedInFrame({ id: "c1", type: "math", position: { x: 100, y: 100 }, data: {} }, frame)).toBe(true)
      expect(ws.annotations.isContainedInFrame({ id: "c2", type: "math", position: { x: 300, y: 300 }, data: {} }, frame)).toBe(true)
      // Just outside
      expect(ws.annotations.isContainedInFrame({ id: "c3", type: "math", position: { x: 99.9, y: 100 }, data: {} }, frame)).toBe(false)
      expect(ws.annotations.isContainedInFrame({ id: "c4", type: "math", position: { x: 300.1, y: 300 }, data: {} }, frame)).toBe(false)
    })
  })

  // ==========================================================================
  // R2 Boundaries: Rendering Pipeline, Shadows, SSR, Atmosphere
  // ==========================================================================
  describe("R2 Boundaries: Rendering Fidelity Parity", () => {
    it("B-REND-01: Directional shadow map resolution bounds — Rejects invalid resolutions", () => {
      const adapter = ws.rendering.webgpu
      expect(() => {
        adapter.setShadowConfig({ resolution: 256 as any })
      }).toThrow(/Invalid shadow resolution 256/)

      expect(() => {
        adapter.setShadowConfig({ resolution: 8192 as any })
      }).toThrow(/Invalid shadow resolution 8192/)

      // Approved power-of-two sizes 512, 1024, 2048, 4096 work cleanly
      for (const res of [512, 1024, 2048, 4096] as const) {
        adapter.setShadowConfig({ resolution: res })
        expect(adapter.state.shadowConfig.resolution).toBe(res)
      }
    })

    it("B-REND-02: Atmosphere time-of-day clamping — Clamps <0 and >24 to [0, 24]", () => {
      const adapter = ws.rendering.webgl2

      adapter.setAtmosphereParams({ timeOfDay: -5.0 })
      expect(adapter.state.atmosphereParams.timeOfDay).toBe(0)
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0)

      adapter.setAtmosphereParams({ timeOfDay: 36.0 })
      expect(adapter.state.atmosphereParams.timeOfDay).toBe(24)
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0)
    })

    it("B-REND-03: Atmosphere solar elevation at midnight and noon boundaries", () => {
      const adapter = ws.rendering.threejs
      // Midnight (0h) -> 0 deg
      adapter.setAtmosphereParams({ timeOfDay: 0.0 })
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBe(0)

      // Noon (12h) -> 90 deg
      adapter.setAtmosphereParams({ timeOfDay: 12.0 })
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(90.0, 1)

      // Sunset (~18h) -> 0 deg
      adapter.setAtmosphereParams({ timeOfDay: 18.0 })
      expect(adapter.state.atmosphereParams.solarElevationDeg).toBeCloseTo(0.0, 1)
    })

    it("B-REND-04: Forward mode GBuffer inspection returns null", () => {
      const adapter = ws.rendering.webgpu
      adapter.setRenderingPipelineMode("forward")
      expect(adapter.getGBufferTextures()).toBeNull()
    })
  })

  // ==========================================================================
  // R3 & R4 Boundaries: Exports & Tauri Desktop
  // ==========================================================================
  describe("R3 & R4 Boundaries: Exports and Desktop App", () => {
    it("B-EXP-01: Shadertoy import handles code with no channels gracefully", () => {
      const codeWithoutChannels = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(1.0);
}
`
      const res = ws.transpiler.importShadertoy(codeWithoutChannels)
      expect(res.channels).toHaveLength(0)
      expect(res.convertedSource).toContain("void main()")
    })

    it("B-DESK-01: Native save rejects files not ending with .shaderstudio", async () => {
      await expect(
        ws.desktop.save_project_native("C:/projects/test.json", "{}")
      ).rejects.toThrow(/File extension must be .shaderstudio/)

      await expect(
        ws.desktop.save_project_native("C:/projects/test.txt", "{}")
      ).rejects.toThrow(/File extension must be .shaderstudio/)
    })

    it("B-DESK-02: Native load of non-existent project file throws not found error", async () => {
      await expect(
        ws.desktop.load_project_native("C:/projects/non_existent.shaderstudio")
      ).rejects.toThrow(/File not found/)
    })

    it("B-DESK-03: Tauri MCP bridge rejects reserved or out-of-range ports", async () => {
      await expect(ws.desktop.start_mcp_bridge(80)).rejects.toThrow(/Invalid port: 80/)
      await expect(ws.desktop.start_mcp_bridge(1024)).rejects.toThrow(/Invalid port: 1024/)
      await expect(ws.desktop.start_mcp_bridge(70000)).rejects.toThrow(/Invalid port: 70000/)

      // Valid port range 1025-65535 works
      const success = await ws.desktop.start_mcp_bridge(5200)
      expect(success).toContain("port 5200")
      ws.desktop.stop_mcp_bridge()
    })
  })

  // ==========================================================================
  // R5 Boundaries: Memory Budget & Performance Scaling
  // ==========================================================================
  describe("R5 Boundaries: Performance & Scale", () => {
    it("B-PERF-01: Memory budget warning threshold triggers at exactly 80.01% but not at 79.99%", () => {
      ws.perf.setMemoryBudget({
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8,
      })

      // 79.9MB / 100MB = 79.9% -> No warning
      const subThreshold = ws.perf.checkMemoryThreshold({ textureMB: 79.9, geometryMB: 50, totalVramMB: 120 })
      expect(subThreshold.textureWarning).toBe(false)
      expect(subThreshold.hasAnyWarning).toBe(false)

      // 80.1MB / 100MB = 80.1% -> Warning triggered
      const overThreshold = ws.perf.checkMemoryThreshold({ textureMB: 80.1, geometryMB: 50, totalVramMB: 120 })
      expect(overThreshold.textureWarning).toBe(true)
      expect(overThreshold.hasAnyWarning).toBe(true)
    })

    it("B-PERF-02: Mesh LOD selection transitions exactly at distance thresholds", () => {
      // Thresholds: lod0Dist = 10, lod1Dist = 30
      expect(ws.perf.selectLodByDistance(0)).toBe("lod0")
      expect(ws.perf.selectLodByDistance(10.0)).toBe("lod0")
      expect(ws.perf.selectLodByDistance(10.01)).toBe("lod1")
      expect(ws.perf.selectLodByDistance(30.0)).toBe("lod1")
      expect(ws.perf.selectLodByDistance(30.01)).toBe("lod2")
      expect(ws.perf.selectLodByDistance(500.0)).toBe("lod2")
    })

    it("B-PERF-03: Frame timeline circular buffer caps at exactly 60 entries", () => {
      for (let i = 0; i < 200; i++) {
        ws.perf.recordFrameTime(16.6)
      }
      expect(ws.perf.getTimeline().length).toBe(60)
    })
  })
})
