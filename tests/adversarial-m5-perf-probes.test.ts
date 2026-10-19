import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  PerformanceTelemetry,
  performanceTelemetry,
} from "@/core/performanceTelemetry"
import {
  checkMemoryThreshold,
  createDefaultMemoryBudget,
  MemoryBudgetManager,
  type MemoryBudgetConfig,
  type MemoryUsage,
} from "@/core/memoryBudget"
import {
  generateMeshLods,
  selectLodByDistance,
  decimateGeometryBuffer,
  decimateIndices,
} from "@/core/meshLod"
import {
  TextureStreamer,
  createTextureStreamer,
} from "@/core/textureStreamer"

describe("Milestone 5 Adversarial Probes Suite", () => {
  beforeEach(() => {
    performanceTelemetry.reset()
  })

  // ==========================================================================
  // Area 1: checkMemoryThreshold Adversarial Probes
  // ==========================================================================
  describe("Area 1: checkMemoryThreshold Adversarial Numbers", () => {
    it("probe 1a: boundary condition at 0 MB usage", () => {
      const budget = createDefaultMemoryBudget() // 512, 256, 1024, 0.8
      const usage: MemoryUsage = { textureMB: 0, geometryMB: 0, totalVramMB: 0 }
      const result = checkMemoryThreshold(usage, budget)

      expect(result.textureWarning).toBe(false)
      expect(result.geometryWarning).toBe(false)
      expect(result.totalVramWarning).toBe(false)
      expect(result.hasAnyWarning).toBe(false)
    })

    it("probe 1b: boundary condition at exact budget (100% of budget)", () => {
      const budget: MemoryBudgetConfig = {
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8,
      }
      // Exact budget is 100MB, threshold is 80MB. 100 > 80 must trip warnings!
      const usage: MemoryUsage = { textureMB: 100, geometryMB: 100, totalVramMB: 200 }
      const result = checkMemoryThreshold(usage, budget)

      expect(result.textureWarning).toBe(true)
      expect(result.geometryWarning).toBe(true)
      expect(result.totalVramWarning).toBe(true)
      expect(result.hasAnyWarning).toBe(true)
    })

    it("probe 1c: exact 80.0% threshold quiet vs 80.0001% warning", () => {
      const budget: MemoryBudgetConfig = {
        textureBudgetMB: 100,
        geometryBudgetMB: 50,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8,
      }
      // Limits: texture = 80.0, geometry = 40.0, total = 160.0
      // Exact 80.0% must be strictly quiet (80.0 > 80.0 is false)
      const exactQuiet = checkMemoryThreshold(
        { textureMB: 80.0, geometryMB: 40.0, totalVramMB: 160.0 },
        budget
      )
      expect(exactQuiet.textureWarning).toBe(false)
      expect(exactQuiet.geometryWarning).toBe(false)
      expect(exactQuiet.totalVramWarning).toBe(false)
      expect(exactQuiet.hasAnyWarning).toBe(false)

      // 80.0001% must strictly trip warning
      const tripWarning = checkMemoryThreshold(
        { textureMB: 80.0001, geometryMB: 40.0001, totalVramMB: 160.0001 },
        budget
      )
      expect(tripWarning.textureWarning).toBe(true)
      expect(tripWarning.geometryWarning).toBe(true)
      expect(tripWarning.totalVramWarning).toBe(true)
      expect(tripWarning.hasAnyWarning).toBe(true)
    })

    it("probe 1d: zero budget handling", () => {
      const zeroBudget: MemoryBudgetConfig = {
        textureBudgetMB: 0,
        geometryBudgetMB: 0,
        totalVramBudgetMB: 0,
        warnThresholdRatio: 0.8,
      }
      // 0 MB usage on 0 MB budget: 0 > 0 is false
      const zeroUsage = checkMemoryThreshold(
        { textureMB: 0, geometryMB: 0, totalVramMB: 0 },
        zeroBudget
      )
      expect(zeroUsage.hasAnyWarning).toBe(false)

      // Any positive usage on 0 MB budget should trip
      const tinyUsage = checkMemoryThreshold(
        { textureMB: 0.0001, geometryMB: 0, totalVramMB: 0 },
        zeroBudget
      )
      expect(tinyUsage.textureWarning).toBe(true)
      expect(tinyUsage.hasAnyWarning).toBe(true)
    })

    it("probe 1e: negative values handling", () => {
      const budget = createDefaultMemoryBudget()
      const negativeUsage: MemoryUsage = {
        textureMB: -50,
        geometryMB: -100,
        totalVramMB: -500,
      }
      const result = checkMemoryThreshold(negativeUsage, budget)
      expect(result.hasAnyWarning).toBe(false)
    })

    it("probe 1f: very large values handling", () => {
      const budget = createDefaultMemoryBudget()
      const hugeUsage: MemoryUsage = {
        textureMB: Number.MAX_SAFE_INTEGER,
        geometryMB: 1e12,
        totalVramMB: Infinity,
      }
      const result = checkMemoryThreshold(hugeUsage, budget)
      expect(result.textureWarning).toBe(true)
      expect(result.geometryWarning).toBe(true)
      expect(result.totalVramWarning).toBe(true)
      expect(result.hasAnyWarning).toBe(true)
    })
  })

  // ==========================================================================
  // Area 2: performanceTelemetry Adversarial Probes
  // ==========================================================================
  describe("Area 2: performanceTelemetry Buffer Overflow & Invalid Frame Times", () => {
    it("probe 2a: timeline buffer overflow (>1000 items recorded rapidly, confirming strict 60 FIFO cap)", () => {
      const telemetry = new PerformanceTelemetry()

      // Record 1500 items rapidly
      for (let i = 1; i <= 1500; i++) {
        telemetry.recordFrameTime(i)
      }

      const timeline = telemetry.getTimeline()
      expect(timeline.length).toBe(60)
      // Strict FIFO verification: items 1441 to 1500 must be in the buffer
      expect(timeline[0]).toBe(1441)
      expect(timeline[59]).toBe(1500)
    })

    it("probe 2b: NaN, negative, and infinite frame times", () => {
      const telemetry = new PerformanceTelemetry()

      telemetry.recordFrameTime(NaN)
      telemetry.recordFrameTime(-25)
      telemetry.recordFrameTime(Infinity)
      telemetry.recordFrameTime(-Infinity)

      const timeline = telemetry.getTimeline()
      expect(timeline.length).toBe(4)
      // NaN should fallback to default 16.67
      expect(timeline[0]).toBe(16.67)
      // Negative should clamp to 0
      expect(timeline[1]).toBe(0)
      // +Infinity should fallback to 16.67
      expect(timeline[2]).toBe(16.67)
      // -Infinity should fallback to 16.67
      expect(timeline[3]).toBe(16.67)
    })

    it("probe 2c: FPS calculation with zero or negative durations", () => {
      const telemetry = new PerformanceTelemetry()

      // Empty timeline returns 60 fallback
      expect(telemetry.getAverageFps()).toBe(60)

      // Timeline with all 0ms durations
      telemetry.recordFrameTime(-10) // clamps to 0
      telemetry.recordFrameTime(-5)  // clamps to 0
      telemetry.recordFrameTime(-1)  // clamps to 0

      // avgMs is 0 -> getAverageFps() must safely return 60, not Infinity or NaN
      const fps = telemetry.getAverageFps()
      expect(fps).toBe(60)
      expect(Number.isFinite(fps)).toBe(true)
    })
  })

  // ==========================================================================
  // Area 3: meshLod Adversarial Probes
  // ==========================================================================
  describe("Area 3: meshLod Decimation Edge Cases & Distance Boundaries", () => {
    it("probe 3a: decimation on zero vertices", () => {
      const counts = generateMeshLods(0)
      expect(counts).toEqual({ lod0: 0, lod1: 0, lod2: 0 })

      const emptyPos = new Float32Array(0)
      const lod1Buffer = decimateGeometryBuffer(emptyPos, "lod1")
      expect(lod1Buffer.length).toBe(0)

      const emptyIdx = new Uint16Array(0)
      const lod1Idx = decimateIndices(emptyIdx, "lod1")
      expect(lod1Idx.length).toBe(0)
    })

    it("probe 3b: decimation on 1 vertex", () => {
      const counts = generateMeshLods(1)
      expect(counts).toEqual({ lod0: 1, lod1: 0, lod2: 0 })

      // 1 vertex (3 floats)
      const singlePos = new Float32Array([1.0, 2.0, 3.0])
      const lod1Buffer = decimateGeometryBuffer(singlePos, "lod1")
      // Should not crash and should return safely
      expect(lod1Buffer.length).toBe(3)
    })

    it("probe 3c: large vertex count (50,000 and 100,000 vertices)", () => {
      const lods50k = generateMeshLods(50000)
      expect(lods50k).toEqual({ lod0: 50000, lod1: 25000, lod2: 12500 })

      const lods100k = generateMeshLods(100000)
      expect(lods100k).toEqual({ lod0: 100000, lod1: 50000, lod2: 25000 })

      // Decimating a buffer of 50,000 vertices (150,000 floats)
      const bigBuffer = new Float32Array(50000 * 3)
      for (let i = 0; i < 50000 * 3; i++) bigBuffer[i] = i

      const decimatedLod1 = decimateGeometryBuffer(bigBuffer, "lod1", 3)
      expect(decimatedLod1.length).toBe(25000 * 3)

      const decimatedLod2 = decimateGeometryBuffer(bigBuffer, "lod2", 3)
      expect(decimatedLod2.length).toBe(12500 * 3)
    })

    it("probe 3d: distance boundary probes (0, 10.0, 10.001, 30.0, 30.001, negative distances)", () => {
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(10.0)).toBe("lod0")
      expect(selectLodByDistance(10.001)).toBe("lod1")
      expect(selectLodByDistance(30.0)).toBe("lod1")
      expect(selectLodByDistance(30.001)).toBe("lod2")
      expect(selectLodByDistance(-10)).toBe("lod0")
    })

    it("probe 3e: infinite distances probe (selectLodByDistance strictly returns lod2 for positive Infinity)", () => {
      const resultPosInf = selectLodByDistance(Infinity)
      const resultNegInf = selectLodByDistance(-Infinity)

      // Negative infinity clamps to 0 -> returns lod0
      expect(resultNegInf).toBe("lod0")

      // Positive infinity and large distances (> thresholds.lod1Dist) strictly return "lod2"
      expect(selectLodByDistance(100.0)).toBe("lod2")
      expect(selectLodByDistance(1e9)).toBe("lod2")
      expect(resultPosInf).toBe("lod2")
    })
  })

  // ==========================================================================
  // Area 4: textureStreamer Adversarial Probes
  // ==========================================================================
  describe("Area 4: textureStreamer LRU Concurrency & Eviction", () => {
    it("probe 4a: sub-millisecond timestamps guarantee deterministic LRU ordering", () => {
      const streamer = new TextureStreamer({ memoryLimitMB: 35 })
      const evicted: string[] = []
      streamer.onEvict((url) => {
        evicted.push(url)
      });

      // Simulate loading two textures
      // Touch texA, then touch texB in the same synchronous turn (same millisecond)
      ;(streamer as any).registerResident("texA.png", [2048, 2048], 0);
      ;(streamer as any).registerResident("texB.png", [2048, 2048], 0);

      streamer.touch("texA.png");
      streamer.touch("texB.png");

      // texB was touched after texA in the same millisecond.
      // When texC arrives (exceeding 35MB), texA MUST be evicted before texB!
      ;(streamer as any).registerResident("texC.png", [2048, 2048], 0);

      expect(evicted).toContain("texA.png")
      expect(streamer.isCached("texA.png")).toBe(false)
      expect(streamer.isCached("texB.png")).toBe(true)
      expect(streamer.isCached("texC.png")).toBe(true)
    })

    it("probe 4b: concurrent progressive loads with Promise.all and eviction under tight memory limit", async () => {
      // Memory limit: 35 MB (can hold two 16MB textures, 32MB total)
      const streamer = createTextureStreamer({ memoryLimitMB: 35 })
      const evicted: string[] = []
      streamer.onEvict((url) => evicted.push(url))

      // Trigger concurrent loads for 4 textures
      const loadPromises = [
        streamer.loadMipmapProgressive("tex1.png", () => {}),
        streamer.loadMipmapProgressive("tex2.png", () => {}),
        streamer.loadMipmapProgressive("tex3.png", () => {}),
        streamer.loadMipmapProgressive("tex4.png", () => {}),
      ]

      const results = await Promise.all(loadPromises)
      expect(results.every((r) => r === true)).toBe(true)

      // Two textures should have been evicted (tex1, tex2), leaving tex3 and tex4 resident
      expect(evicted).toEqual(["tex1.png", "tex2.png"])
      expect(streamer.getResidentTextureCount()).toBe(2)
      expect(streamer.isCached("tex1.png")).toBe(false)
      expect(streamer.isCached("tex2.png")).toBe(false)
      expect(streamer.isCached("tex3.png")).toBe(true)
      expect(streamer.isCached("tex4.png")).toBe(true)
    })

    it("probe 4c: dynamic memory limit reduction triggers immediate LRU eviction", async () => {
      const streamer = createTextureStreamer({ memoryLimitMB: 60 })
      await streamer.loadMipmapProgressive("tex1.png", () => {})
      await streamer.loadMipmapProgressive("tex2.png", () => {})
      await streamer.loadMipmapProgressive("tex3.png", () => {})
      // 3 textures * 16MB = 48MB <= 60MB
      expect(streamer.getResidentTextureCount()).toBe(3)

      const evicted: string[] = []
      streamer.onEvict((url) => evicted.push(url))

      // Lower limit to 35MB -> should evict oldest texture (tex1.png) to get down to 32MB
      streamer.setMemoryLimitMB(35)
      expect(evicted).toEqual(["tex1.png"])
      expect(streamer.getResidentTextureCount()).toBe(2)
      expect(streamer.isCached("tex1.png")).toBe(false)
      expect(streamer.isCached("tex2.png")).toBe(true)
      expect(streamer.isCached("tex3.png")).toBe(true)
    })
  })
})
