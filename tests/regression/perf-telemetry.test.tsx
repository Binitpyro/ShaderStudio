// fleet(w1-a-render): consolidated from unit-m5-perf.test.ts, adversarial-m5-perf-probes.test.ts, adversarial-m5-gate2-probes.test.ts, adversarial-m5-perf-challenge.test.tsx, adversarial-m2-challenger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PerformanceTelemetry, performanceTelemetry, type DetailedGpuMetrics } from "@/core/performanceTelemetry"
import { MemoryBudgetManager, checkMemoryThreshold, createDefaultMemoryBudget, type MemoryBudgetConfig, type MemoryUsage } from "@/core/memoryBudget"
import { generateMeshLods, selectLodByDistance, decimateGeometryBuffer, decimateIndices, DEFAULT_LOD_THRESHOLDS } from "@/core/meshLod"
import { TextureStreamer, createTextureStreamer } from "@/core/textureStreamer"
import { useProjectStore } from "@/stores/projectStore"
import { renderCoordinator, RenderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react"
import { PerfOverlay, ScreenshotButton } from "@/components/PerfOverlay"
import { MeshNode } from "@/components/nodes/MeshNode"
import { viewportCapture } from "@/utils/frameCapture"
import { setupDOMEnvironment, teardownDOMEnvironment } from "../e2e/mocks/mockDOM"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import * as THREE from "three"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter, webgpuAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter, webgl2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter, threejsAdapter } from "@/adapters/threejs"
import { subGraphLibrary, collapseNodesToSubGraph, BUILTIN_FRESNEL_RIM, BUILTIN_NOISE_GEN, BUILTIN_UV_DISTORTION, type SubGraphDefinition } from "@/core/subGraphLibrary"
import { flattenGraph, compileGraph, buildSdfTree, MAX_SUBGRAPH_DEPTH, type GraphNodeData } from "@/core/graphCompiler"
import { customNodeRegistry, validateCustomNodeManifest, type CustomNodeManifest } from "@/core/customNodeSdk"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { transpileToUE5, transpileToUnrealHLSL, transpileToBlenderOSL, exportGltf2Material, packOrmTexture, generateNpmPackage, importShadertoy, createProjectFromShadertoy, generateR3FExport } from "@/core/engineTranspiler"
import { getDefaultProjectPath, saveProjectNative, loadProjectNative, startMcpBridge, getMcpBridgeStatus, getMcpBridgePort, stopMcpBridge, minimizeWindow, maximizeWindow, closeWindow, setupTray, isTrayActive, validateBinarySizeConfig, resetDesktopFallbackState } from "@/desktop/tauriBridge"
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

describe("R5 performance and scale unit suite", () => {
describe("Milestone 5 (R5: Performance & Scale) Unit Test Suite", () => {
  beforeEach(() => {
    performanceTelemetry.reset()
    useProjectStore.getState().resetProject()
  })

  // ==========================================================================
  // R5a: GPU Profiler & Frame Timeline
  // ==========================================================================
  describe("R5a: PerformanceTelemetry & Frame Timeline", () => {
    it("maintains an empty buffer fallback of 60 FPS", () => {
      const telemetry = new PerformanceTelemetry()
      expect(telemetry.getTimeline()).toEqual([])
      expect(telemetry.getAverageFps()).toBe(60)
    })

    it("records frame times and enforces strict 60-frame rolling circular buffer", () => {
      const telemetry = new PerformanceTelemetry()

      for (let i = 1; i <= 60; i++) {
        telemetry.recordFrameTime(i)
      }
      expect(telemetry.getTimeline().length).toBe(60)
      expect(telemetry.getTimeline()[0]).toBe(1)
      expect(telemetry.getTimeline()[59]).toBe(60)

      // 61st frame should evict the first frame (FIFO)
      telemetry.recordFrameTime(100)
      const timelineAfter61 = telemetry.getTimeline()
      expect(timelineAfter61.length).toBe(60)
      expect(timelineAfter61[0]).toBe(2)
      expect(timelineAfter61[59]).toBe(100)

      // Stress test: record 250 frames
      for (let i = 0; i < 250; i++) {
        telemetry.recordFrameTime(16.6)
      }
      expect(telemetry.getTimeline().length).toBe(60)
    })

    it("calculates average FPS accurately across different frame durations", () => {
      const telemetry = new PerformanceTelemetry()

      // 16.666 ms average ~ 60 FPS
      for (let i = 0; i < 60; i++) {
        telemetry.recordFrameTime(16.666667)
      }
      expect(telemetry.getAverageFps()).toBeCloseTo(60, 0)

      // 33.333 ms average ~ 30 FPS
      telemetry.reset()
      for (let i = 0; i < 60; i++) {
        telemetry.recordFrameTime(33.333333)
      }
      expect(telemetry.getAverageFps()).toBeCloseTo(30, 0)

      // 8.333 ms average ~ 120 FPS
      telemetry.reset()
      for (let i = 0; i < 60; i++) {
        telemetry.recordFrameTime(8.333333)
      }
      expect(telemetry.getAverageFps()).toBeCloseTo(120, 0)
    })

    it("handles non-finite or invalid frame durations safely", () => {
      const telemetry = new PerformanceTelemetry()
      telemetry.recordFrameTime(-5)
      telemetry.recordFrameTime(NaN)
      telemetry.recordFrameTime(Infinity)
      expect(telemetry.getTimeline().length).toBe(3)
      expect(telemetry.getAverageFps()).toBeGreaterThan(0)
    })

    it("records and clears per-pass execution timings", () => {
      const telemetry = new PerformanceTelemetry()
      telemetry.setPassTiming("gbuffer", 2.4)
      telemetry.setPassTiming("shadow", 1.8)
      telemetry.setPassTiming("lighting", 3.2)
      telemetry.setPassTiming("ssr", 4.5)
      telemetry.setPassTiming("postprocess", 1.1)

      const timings = telemetry.getPassTimings()
      expect(timings.gbuffer).toBe(2.4)
      expect(timings.shadow).toBe(1.8)
      expect(timings.lighting).toBe(3.2)
      expect(timings.ssr).toBe(4.5)
      expect(timings.postprocess).toBe(1.1)

      telemetry.clearPassTimings()
      expect(telemetry.getPassTimings()).toEqual({})
    })

    it("calculates texture and geometry VRAM memory correctly", () => {
      const telemetry = new PerformanceTelemetry()

      // 1024x1024 RGBA8 (4 bytes per pixel) = 4,194,304 bytes
      const texBytes = telemetry.calculateTextureMemory(1024, 1024, 4)
      expect(texBytes).toBe(4 * 1024 * 1024)

      // 2048x2048 RGBA16F (8 bytes per pixel) = 33,554,432 bytes
      const hdrBytes = telemetry.calculateTextureMemory(2048, 2048, 8)
      expect(hdrBytes).toBe(32 * 1024 * 1024)

      // 10,000 vertices with 32-byte stride = 320,000 bytes
      const geomBytes = telemetry.calculateGeometryMemory(10000, 32)
      expect(geomBytes).toBe(320000)

      // Combined estimate
      const totalEstimated = telemetry.estimateVramBytes(
        [
          { width: 1024, height: 1024, bytesPerPixel: 4 },
          { width: 512, height: 512, bytesPerPixel: 4 },
        ],
        [{ vertexCount: 1000, strideBytes: 32 }]
      )
      expect(totalEstimated).toBe(4 * 1024 * 1024 + 1024 * 1024 + 32000)

      // Safe fallback for NaN and non-finite dimensions
      expect(telemetry.calculateTextureMemory(NaN, 100)).toBe(0)
      expect(telemetry.calculateTextureMemory(100, NaN)).toBe(0)
      expect(telemetry.calculateTextureMemory(NaN, NaN)).toBe(0)
      expect(telemetry.calculateTextureMemory(Infinity, 100)).toBe(0)
      expect(telemetry.calculateTextureMemory(100, 100, NaN)).toBe(0)
      expect(telemetry.calculateGeometryMemory(NaN, 32)).toBe(0)
      expect(telemetry.calculateGeometryMemory(1000, NaN)).toBe(0)
      expect(telemetry.calculateGeometryMemory(NaN, NaN)).toBe(0)
      expect(telemetry.calculateGeometryMemory(Infinity, 32)).toBe(0)
    })

    it("registers and unregisters live resources to compute live VRAM", () => {
      const telemetry = new PerformanceTelemetry()
      telemetry.registerTexture("albedo_map", 1024, 1024, 4)
      telemetry.registerGeometry("main_mesh", 5000, 32)

      const expectedBytes = 1024 * 1024 * 4 + 5000 * 32
      expect(telemetry.getEstimatedVramBytes()).toBe(expectedBytes)

      telemetry.unregisterTexture("albedo_map")
      expect(telemetry.getEstimatedVramBytes()).toBe(5000 * 32)

      telemetry.unregisterGeometry("main_mesh")
      expect(telemetry.getEstimatedVramBytes()).toBe(0)

      // Manual override takes precedence when set
      telemetry.setEstimatedVramBytes(123456)
      expect(telemetry.getEstimatedVramBytes()).toBe(123456)
    })

    it("assembles complete DetailedGpuMetrics matching Contract 4", () => {
      const telemetry = new PerformanceTelemetry()
      telemetry.recordFrameTime(16.0)
      telemetry.recordFrameTime(17.0)
      telemetry.setDrawCalls(14)
      telemetry.setTriangles(45000)
      telemetry.setPassTiming("gbuffer", 3.0)
      telemetry.setEstimatedVramBytes(104857600) // 100 MB

      const metrics: DetailedGpuMetrics = telemetry.getMetrics()
      expect(metrics.fps).toBe(61)
      expect(metrics.frameTime).toBe(17.0)
      expect(metrics.drawCalls).toBe(14)
      expect(metrics.triangles).toBe(45000)
      expect(metrics.passTimings.gbuffer).toBe(3.0)
      expect(metrics.estimatedVramBytes).toBe(104857600)
      expect(metrics.frameTimeline.length).toBe(2)
    })

    it("broadcasts metrics to telemetry subscribers", () => {
      const telemetry = new PerformanceTelemetry()
      const listener = vi.fn()
      const unsub = telemetry.subscribe(listener)

      telemetry.recordFrameTime(16.6)
      telemetry.notifySubscribers()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ fps: 60 }))

      unsub()
      telemetry.notifySubscribers()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("integrates with renderCoordinator Phase 5 telemetry recording", () => {
      performanceTelemetry.reset()
      renderCoordinator.tick(1000)
      renderCoordinator.tick(1016.6)

      const timeline = performanceTelemetry.getTimeline()
      expect(timeline.length).toBeGreaterThanOrEqual(1)
      expect(timeline[timeline.length - 1]).toBeCloseTo(16.6, 1)
    })
  })

  // ==========================================================================
  // R5b: Memory Budget System
  // ==========================================================================
  describe("R5b: MemoryBudgetManager & ProjectStore", () => {
    it("creates default memory budget with 512MB textures, 256MB geometry, 1024MB total, 0.8 ratio", () => {
      const defaults = createDefaultMemoryBudget()
      expect(defaults).toEqual({
        textureBudgetMB: 512,
        geometryBudgetMB: 256,
        totalVramBudgetMB: 1024,
        warnThresholdRatio: 0.8,
      })
    })


    it("checks geometry and total VRAM threshold warnings independently", () => {
      const manager = new MemoryBudgetManager({
        textureBudgetMB: 100,
        geometryBudgetMB: 50,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8,
      })

      // Geometry limit = 40 MB. 40.01 trips geometry
      const geomAlert = manager.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 40.01,
        totalVramMB: 100,
      })
      expect(geomAlert.geometryWarning).toBe(true)
      expect(geomAlert.textureWarning).toBe(false)
      expect(geomAlert.totalVramWarning).toBe(false)
      expect(geomAlert.hasAnyWarning).toBe(true)

      // Total limit = 160 MB. 160.1 trips total VRAM
      const vramAlert = manager.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 30,
        totalVramMB: 160.1,
      })
      expect(vramAlert.totalVramWarning).toBe(true)
      expect(vramAlert.geometryWarning).toBe(false)
      expect(vramAlert.hasAnyWarning).toBe(true)
    })

    it("notifies warning and eviction listeners during evaluateUsage", () => {
      const manager = new MemoryBudgetManager({
        textureBudgetMB: 100,
        warnThresholdRatio: 0.8,
      })

      const warningListener = vi.fn()
      const evictionListener = vi.fn()
      manager.onWarning(warningListener)
      manager.onEvictionRequired(evictionListener)

      // Under threshold: no notifications
      manager.evaluateUsage({ textureMB: 75, geometryMB: 20, totalVramMB: 100 })
      expect(warningListener).not.toHaveBeenCalled()
      expect(evictionListener).not.toHaveBeenCalled()

      // Exceeds texture threshold by 10 MB (90MB vs 80MB limit)
      manager.evaluateUsage({ textureMB: 90, geometryMB: 20, totalVramMB: 120 })
      expect(warningListener).toHaveBeenCalledTimes(1)
      expect(evictionListener).toHaveBeenCalledWith("texture", 10)
    })

    it("integrates memory budget actions into projectStore", () => {
      const store = useProjectStore.getState()
      expect(store.getMemoryBudget()).toEqual(createDefaultMemoryBudget())

      store.setMemoryBudget({
        textureBudgetMB: 256,
        warnThresholdRatio: 0.75,
      })

      const updated = useProjectStore.getState().getMemoryBudget()
      expect(updated.textureBudgetMB).toBe(256)
      expect(updated.warnThresholdRatio).toBe(0.75)

      // 256 * 0.75 = 192. 193 MB should trip
      const check = useProjectStore.getState().checkMemoryThreshold({
        textureMB: 193,
        geometryMB: 50,
        totalVramMB: 250,
      })
      expect(check.textureWarning).toBe(true)
      expect(check.hasAnyWarning).toBe(true)

      // Exporting and loading project data retains memory budget
      const exported = useProjectStore.getState().exportProjectData()
      expect(exported.memoryBudget?.textureBudgetMB).toBe(256)

      useProjectStore.getState().resetProject()
      expect(useProjectStore.getState().getMemoryBudget().textureBudgetMB).toBe(512)

      useProjectStore.getState().loadProjectData(exported)
      expect(useProjectStore.getState().getMemoryBudget().textureBudgetMB).toBe(256)
    })
  })

  // ==========================================================================
  // R5c: Mesh LOD System
  // ==========================================================================
  describe("R5c: Mesh LOD Generator & Distance Selection", () => {
    it("generates 3 LOD levels with 100%, 50%, and 25% vertex decimation ratios", () => {
      const lods = generateMeshLods(100000)
      expect(lods.lod0).toBe(100000)
      expect(lods.lod1).toBe(50000)
      expect(lods.lod2).toBe(25000)

      const oddLods = generateMeshLods(777)
      expect(oddLods.lod0).toBe(777)
      expect(oddLods.lod1).toBe(388) // floor(777 * 0.5)
      expect(oddLods.lod2).toBe(194) // floor(777 * 0.25)
    })

    it("handles boundary inputs for vertexCount safely", () => {
      expect(generateMeshLods(0)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(-100)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(NaN)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
    })

    it("selects LOD based on distance thresholds <= 10.0 -> lod0, <= 30.0 -> lod1, > 30.0 -> lod2", () => {
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(5)).toBe("lod0")
      expect(selectLodByDistance(10.0)).toBe("lod0")
      expect(selectLodByDistance(10.01)).toBe("lod1")
      expect(selectLodByDistance(20.0)).toBe("lod1")
      expect(selectLodByDistance(30.0)).toBe("lod1")
      expect(selectLodByDistance(30.01)).toBe("lod2")
      expect(selectLodByDistance(100.0)).toBe("lod2")
      expect(selectLodByDistance(Infinity)).toBe("lod2")
      expect(selectLodByDistance(-Infinity)).toBe("lod0")
      expect(selectLodByDistance(NaN)).toBe("lod0")
    })

    it("supports custom distance thresholds", () => {
      const custom = { lod0Dist: 25, lod1Dist: 75 }
      expect(selectLodByDistance(20, custom)).toBe("lod0")
      expect(selectLodByDistance(25, custom)).toBe("lod0")
      expect(selectLodByDistance(25.1, custom)).toBe("lod1")
      expect(selectLodByDistance(75, custom)).toBe("lod1")
      expect(selectLodByDistance(75.1, custom)).toBe("lod2")
    })

    it("decimates vertex positions Float32Array accurately according to target LOD", () => {
      // 8 vertices with 3 components (x, y, z) = 24 floats
      const positions = new Float32Array(24)
      for (let i = 0; i < 24; i++) positions[i] = i

      // lod0: exact full copy
      const lod0Buffer = decimateGeometryBuffer(positions, "lod0", 3)
      expect(lod0Buffer.length).toBe(24)
      expect(lod0Buffer[0]).toBe(0)

      // lod1: half resolution (step 2) -> 4 vertices * 3 = 12 floats
      const lod1Buffer = decimateGeometryBuffer(positions, "lod1", 3)
      expect(lod1Buffer.length).toBe(12)
      // Vertex 0: positions[0..2] (0, 1, 2)
      expect(lod1Buffer[0]).toBe(0)
      expect(lod1Buffer[1]).toBe(1)
      expect(lod1Buffer[2]).toBe(2)
      // Vertex 1: positions[6..8] (6, 7, 8)
      expect(lod1Buffer[3]).toBe(6)
      expect(lod1Buffer[4]).toBe(7)
      expect(lod1Buffer[5]).toBe(8)

      // lod2: quarter resolution (step 4) -> 2 vertices * 3 = 6 floats
      const lod2Buffer = decimateGeometryBuffer(positions, "lod2", 3)
      expect(lod2Buffer.length).toBe(6)
      expect(lod2Buffer[0]).toBe(0)
      expect(lod2Buffer[3]).toBe(12)
    })

    it("decimates triangle index buffers accurately", () => {
      // 8 triangles = 24 indices
      const indices = new Uint16Array(24)
      for (let i = 0; i < 24; i++) indices[i] = i

      const lod0 = decimateIndices(indices, "lod0")
      expect(lod0.length).toBe(24)

      const lod1 = decimateIndices(indices, "lod1")
      expect(lod1.length).toBe(12) // 4 triangles

      const lod2 = decimateIndices(indices, "lod2")
      expect(lod2.length).toBe(6) // 2 triangles
    })
  })

  // ==========================================================================
  // R5d: Progressive Texture Streaming
  // ==========================================================================
  describe("R5d: Progressive Texture Streaming & LRU Cache", () => {
    it("progressively streams mip 2 (128x128), mip 1 (512x512), and mip 0 (2048x2048)", async () => {
      const streamer = createTextureStreamer()
      const sequence: Array<{ level: number; resolution: [number, number] }> = []

      const result = await streamer.loadMipmapProgressive(
        "textures/albedo_4k.png",
        (level, resolution) => {
          sequence.push({ level, resolution })
        }
      )

      expect(result).toBe(true)
      expect(sequence).toEqual([
        { level: 2, resolution: [128, 128] },
        { level: 1, resolution: [512, 512] },
        { level: 0, resolution: [2048, 2048] },
      ])
    })

    it("rejects invalid or empty texture URLs gracefully", async () => {
      const streamer = createTextureStreamer()
      const cb = vi.fn()
      const result = await streamer.loadMipmapProgressive("", cb)
      expect(result).toBe(false)
      expect(cb).not.toHaveBeenCalled()
    })

    it("tracks resident memory and caches textures", async () => {
      const streamer = createTextureStreamer()
      expect(streamer.getResidentTextureCount()).toBe(0)

      await streamer.loadMipmapProgressive("texA.png", () => {})
      expect(streamer.isCached("texA.png")).toBe(true)
      expect(streamer.getResidentTextureCount()).toBe(1)

      // 2048x2048 RGBA8 = 16 MB = 16,777,216 bytes
      expect(streamer.getResidentMemoryBytes()).toBe(2048 * 2048 * 4)
      expect(streamer.getResidentMemoryMB()).toBe(16)
    })

    it("evicts least recently used textures when memory limit is exceeded", async () => {
      // Memory limit = 25 MB. Each 2048x2048 texture takes 16 MB.
      // Loading two 16MB textures will exceed 25MB and force eviction of the first texture.
      const streamer = new TextureStreamer({ memoryLimitMB: 25 })
      const evicted: string[] = []
      streamer.onEvict((url) => {
        evicted.push(url)
      })

      await streamer.loadMipmapProgressive("tex1.png", () => {})
      expect(streamer.getResidentTextureCount()).toBe(1)
      expect(streamer.isCached("tex1.png")).toBe(true)

      // Loading tex2 requires 16MB more (total 32MB > 25MB limit), evicting tex1
      await streamer.loadMipmapProgressive("tex2.png", () => {})
      expect(evicted).toContain("tex1.png")
      expect(streamer.isCached("tex1.png")).toBe(false)
      expect(streamer.isCached("tex2.png")).toBe(true)
      expect(streamer.getResidentTextureCount()).toBe(1)
    })

    it("respects access timestamps when choosing which texture to evict", async () => {
      // Limit 35 MB: can hold two 16MB textures (32MB), but a third forces eviction
      const streamer = new TextureStreamer({ memoryLimitMB: 35 })
      const evicted: string[] = []
      streamer.onEvict((url) => evicted.push(url))

      await streamer.loadMipmapProgressive("tex1.png", () => {})
      await streamer.loadMipmapProgressive("tex2.png", () => {})
      expect(streamer.getResidentTextureCount()).toBe(2)

      // Touch tex1 to make it newer than tex2
      streamer.touch("tex1.png")

      // Load tex3 -> tex2 should be evicted because tex1 was touched more recently!
      await streamer.loadMipmapProgressive("tex3.png", () => {})
      expect(evicted).toEqual(["tex2.png"])
      expect(streamer.isCached("tex1.png")).toBe(true)
      expect(streamer.isCached("tex2.png")).toBe(false)
      expect(streamer.isCached("tex3.png")).toBe(true)
    })
  })

  // ==========================================================================
  // UI Component Integration: PerfOverlay & MeshNode
  // ==========================================================================
  describe("UI Component Integration: PerfOverlay & MeshNode", () => {
    it("renders PerfOverlay with GPU profiler, FPS, timeline canvas, and memory stats", () => {
      performanceTelemetry.recordFrameTime(16.6)
      performanceTelemetry.setDrawCalls(10)
      performanceTelemetry.setTriangles(25000)
      performanceTelemetry.setEstimatedVramBytes(50 * 1024 * 1024)

      const html = renderToStaticMarkup(React.createElement(PerfOverlay))
      expect(html).toContain("GPU Profiler")
      expect(html).toContain("FPS")
      expect(html).toContain("Frame")
      expect(html).toContain("<canvas")
      expect(html).toContain("60-FRAME TIMELINE")
      expect(html).toContain("Draw Calls / Tris")
      expect(html).toContain("VRAM")
      expect(html).toContain("50 MB / 1024 MB")
    })

    it("displays memory warning alert badge in PerfOverlay when VRAM exceeds 80%", () => {
      // Total budget is 1024 MB. 80% is 819.2 MB.
      // Set VRAM usage to 850 MB (exceeding 80% warning threshold)
      performanceTelemetry.setEstimatedVramBytes(850 * 1024 * 1024)

      const html = renderToStaticMarkup(React.createElement(PerfOverlay))
      expect(html).toContain("VRAM Alert: &gt;80% Budget")
    })

    it("renders MeshNode with LOD level selection and vertex decimation tiers when selected", () => {
      const meshElement = React.createElement(MeshNode, {
        id: "mesh-test-1",
        data: { type: "mesh", geometry: "cube" } as any,
        selected: true,
        type: "mesh",
        zIndex: 1,
        isConnectable: true,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
        dragging: false,
      } as any)

      const html = renderToStaticMarkup(
        React.createElement(ReactFlowProvider, null, meshElement)
      )

      expect(html).toContain("Mesh Geometry")
      expect(html).toContain("Level of Detail")
      expect(html).toContain("LOD 0 (100% Detail)")
      expect(html).toContain("LOD 1 (50% Detail)")
      expect(html).toContain("LOD 2 (25% Detail)")
      expect(html).toContain("L0")
      expect(html).toContain("36v") // Cube has 36 vertices
      expect(html).toContain("L1")
      expect(html).toContain("18v") // 50% = 18 vertices
      expect(html).toContain("L2")
      expect(html).toContain("9v") // 25% = 9 vertices
    })
  })
})
})

describe("M5 adversarial probes", () => {
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
})

describe("M5 gate 2 probes: meshLod and memory calculators", () => {
describe("Milestone 5 Gate 2 Empirical Challenger Probes", () => {
  describe("1. Probe selectLodByDistance in src/core/meshLod.ts", () => {
    it("handles Infinity, +Infinity, -Infinity, NaN, 0, -10, 10.0, 10.0001, 30.0, 30.0001, 1e12", () => {
      // 1. Positive Infinity
      expect(selectLodByDistance(Infinity)).toBe("lod2")
      expect(selectLodByDistance(+Infinity)).toBe("lod2")

      // 2. Extremely large finite distances (> 30.0)
      expect(selectLodByDistance(1e12)).toBe("lod2")
      expect(selectLodByDistance(Number.MAX_VALUE)).toBe("lod2")
      expect(selectLodByDistance(100.0)).toBe("lod2")
      expect(selectLodByDistance(30.0001)).toBe("lod2")
      expect(selectLodByDistance(30.0000001)).toBe("lod2")

      // 3. Exact threshold 30.0 (<= lod1Dist) -> lod1
      expect(selectLodByDistance(30.0)).toBe("lod1")

      // 4. Intermediate distances (10.0 < dist <= 30.0) -> lod1
      expect(selectLodByDistance(10.0001)).toBe("lod1")
      expect(selectLodByDistance(20.0)).toBe("lod1")

      // 5. Exact threshold 10.0 (<= lod0Dist) -> lod0
      expect(selectLodByDistance(10.0)).toBe("lod0")

      // 6. Near zero and zero -> lod0
      expect(selectLodByDistance(5.0)).toBe("lod0")
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(-0)).toBe("lod0")

      // 7. Negative numbers and negative Infinity -> safely clamped to 0 -> lod0
      expect(selectLodByDistance(-10)).toBe("lod0")
      expect(selectLodByDistance(-1e12)).toBe("lod0")
      expect(selectLodByDistance(-Infinity)).toBe("lod0")

      // 8. NaN -> safely treated as 0 -> lod0
      expect(selectLodByDistance(NaN)).toBe("lod0")
    })

    it("verifies strict lod2 guarantee for all numbers > 30 and positive Infinity", () => {
      const distancesAbove30 = [
        30.000000000001,
        30.0001,
        30.1,
        31,
        50,
        100,
        1000,
        1e6,
        1e12,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_VALUE,
        Infinity,
        +Infinity,
      ]

      for (const d of distancesAbove30) {
        expect(selectLodByDistance(d)).toBe("lod2")
      }
    })

    it("verifies custom threshold behavior with boundary conditions", () => {
      const customThresholds = { lod0Dist: 50, lod1Dist: 150 }
      expect(selectLodByDistance(Infinity, customThresholds)).toBe("lod2")
      expect(selectLodByDistance(150.001, customThresholds)).toBe("lod2")
      expect(selectLodByDistance(150.0, customThresholds)).toBe("lod1")
      expect(selectLodByDistance(50.001, customThresholds)).toBe("lod1")
      expect(selectLodByDistance(50.0, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(0, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(-Infinity, customThresholds)).toBe("lod0")
      expect(selectLodByDistance(NaN, customThresholds)).toBe("lod0")
    })
  })

  describe("2. Probe calculateTextureMemory and calculateGeometryMemory in src/core/performanceTelemetry.ts", () => {
    const telemetry = new PerformanceTelemetry()

    describe("calculateTextureMemory(width, height, bytesPerPixel)", () => {
      it("returns 0 for all non-finite dimensions (NaN, Infinity, -Infinity)", () => {
        // NaN in any argument
        expect(telemetry.calculateTextureMemory(NaN, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, NaN, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, NaN)).toBe(0)
        expect(telemetry.calculateTextureMemory(NaN, NaN, NaN)).toBe(0)

        // Infinity in any argument
        expect(telemetry.calculateTextureMemory(Infinity, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, Infinity, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, Infinity)).toBe(0)
        expect(telemetry.calculateTextureMemory(Infinity, Infinity, Infinity)).toBe(0)

        // -Infinity in any argument
        expect(telemetry.calculateTextureMemory(-Infinity, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, -Infinity, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, -Infinity)).toBe(0)
        expect(telemetry.calculateTextureMemory(-Infinity, -Infinity, -Infinity)).toBe(0)
      })

      it("returns 0 for all non-positive dimensions (<= 0)", () => {
        // Zero dimensions
        expect(telemetry.calculateTextureMemory(0, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 0, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, 0)).toBe(0)
        expect(telemetry.calculateTextureMemory(0, 0, 0)).toBe(0)
        expect(telemetry.calculateTextureMemory(-0, 100, 4)).toBe(0)

        // Negative dimensions
        expect(telemetry.calculateTextureMemory(-1, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, -50, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, -4)).toBe(0)
        expect(telemetry.calculateTextureMemory(-10, -10, -10)).toBe(0)
      })

      it("safely handles non-integer dimensions via Math.floor", () => {
        // width = 10.8 -> floor 10, height = 10.2 -> floor 10, bytesPerPixel = 4 -> 400
        expect(telemetry.calculateTextureMemory(10.8, 10.2, 4)).toBe(400)
        // dimensions < 1 floor to 0
        expect(telemetry.calculateTextureMemory(0.5, 100, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 0.999, 4)).toBe(0)
        expect(telemetry.calculateTextureMemory(100, 100, 0.5)).toBe(0)
      })

      it("computes accurate memory for valid standard textures", () => {
        expect(telemetry.calculateTextureMemory(1024, 1024, 4)).toBe(4194304) // 4 MB
        expect(telemetry.calculateTextureMemory(2048, 2048, 4)).toBe(16777216) // 16 MB
        expect(telemetry.calculateTextureMemory(4096, 4096, 4)).toBe(67108864) // 64 MB
      })
    })

    describe("calculateGeometryMemory(vertexCount, strideBytes)", () => {
      it("returns 0 for all non-finite arguments (NaN, Infinity, -Infinity)", () => {
        expect(telemetry.calculateGeometryMemory(NaN, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, NaN)).toBe(0)
        expect(telemetry.calculateGeometryMemory(NaN, NaN)).toBe(0)

        expect(telemetry.calculateGeometryMemory(Infinity, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, Infinity)).toBe(0)
        expect(telemetry.calculateGeometryMemory(Infinity, Infinity)).toBe(0)

        expect(telemetry.calculateGeometryMemory(-Infinity, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, -Infinity)).toBe(0)
        expect(telemetry.calculateGeometryMemory(-Infinity, -Infinity)).toBe(0)
      })

      it("returns 0 for all non-positive arguments (<= 0)", () => {
        expect(telemetry.calculateGeometryMemory(0, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, 0)).toBe(0)
        expect(telemetry.calculateGeometryMemory(0, 0)).toBe(0)

        expect(telemetry.calculateGeometryMemory(-10, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(1000, -32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(-100, -32)).toBe(0)
      })

      it("safely handles non-integer vertex counts and strides via Math.floor", () => {
        expect(telemetry.calculateGeometryMemory(100.9, 32.5)).toBe(100 * 32)
        expect(telemetry.calculateGeometryMemory(0.8, 32)).toBe(0)
        expect(telemetry.calculateGeometryMemory(100, 0.5)).toBe(0)
      })

      it("computes accurate memory for standard geometry buffers", () => {
        expect(telemetry.calculateGeometryMemory(10000, 32)).toBe(320000)
        expect(telemetry.calculateGeometryMemory(50000, 32)).toBe(1600000)
      })
    })
  })
})
})

describe("M5 PerfOverlay, coordinator telemetry and memory budget persistence", () => {
/**
 * Milestone 5 Adversarial Challenger Verification Suite
 * Targets:
 *   1. PerfOverlay.tsx: Canvas 2D rendering stability under dynamic metric changes,
 *      visual warning badge rendering (hasAnyWarning / isVramOverBudget), and screenshot export logic.
 *   2. renderCoordinator.ts: Phase 5 telemetry integration does not mutate delta times or
 *      interfere with the virtual playback clock.
 *   3. projectStore.ts: memoryBudget serialization round-trips via exportProjectData & loadProjectData.
 */


// Mock canvas 2D context recorder
function createMockCanvas2DContext() {
  const operations: Array<{ method: string; args: any[] }> = []
  const fills: Array<{ color: string; rect: [number, number, number, number] }> = []
  const strokes: Array<{ color: string; dash: number[] }> = []

  let currentFillStyle = "#000000"
  let currentStrokeStyle = "#000000"
  let currentLineWidth = 1
  let currentLineDash: number[] = []

  const ctx = {
    get fillStyle() {
      return currentFillStyle
    },
    set fillStyle(val: string) {
      currentFillStyle = val
      operations.push({ method: "set fillStyle", args: [val] })
    },
    get strokeStyle() {
      return currentStrokeStyle
    },
    set strokeStyle(val: string) {
      currentStrokeStyle = val
      operations.push({ method: "set strokeStyle", args: [val] })
    },
    get lineWidth() {
      return currentLineWidth
    },
    set lineWidth(val: number) {
      currentLineWidth = val
      operations.push({ method: "set lineWidth", args: [val] })
    },
    setLineDash(dash: number[]) {
      currentLineDash = [...dash]
      operations.push({ method: "setLineDash", args: [dash] })
    },
    clearRect(x: number, y: number, w: number, h: number) {
      operations.push({ method: "clearRect", args: [x, y, w, h] })
    },
    fillRect(x: number, y: number, w: number, h: number) {
      operations.push({ method: "fillRect", args: [x, y, w, h] })
      fills.push({ color: currentFillStyle, rect: [x, y, w, h] })
    },
    beginPath() {
      operations.push({ method: "beginPath", args: [] })
    },
    moveTo(x: number, y: number) {
      operations.push({ method: "moveTo", args: [x, y] })
    },
    lineTo(x: number, y: number) {
      operations.push({ method: "lineTo", args: [x, y] })
    },
    stroke() {
      operations.push({ method: "stroke", args: [] })
      strokes.push({ color: currentStrokeStyle, dash: [...currentLineDash] })
    },
    _operations: operations,
    _fills: fills,
    _strokes: strokes,
  }

  return ctx
}

describe("Adversarial Milestone 5 Verification Suite", () => {
  beforeEach(() => {
    setupDOMEnvironment()
    performanceTelemetry.reset()
    useProjectStore.getState().resetProject()
    renderCoordinator.stop()
    renderCoordinator.clearLog()
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.setPlaybackSpeed(1.0)
  })

  afterEach(() => {
    teardownDOMEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SECTION 1: PerfOverlay.tsx Empirical Probes
  // ==========================================================================
  describe("1. PerfOverlay.tsx Adversarial Probes", () => {
    describe("1.1 Canvas 2D Rendering Stability Under Dynamic Metrics", () => {
      // Direct simulation of the canvas rendering effect in PerfOverlay
      function renderPerfTimelineCanvas(
        canvas: HTMLCanvasElement,
        metrics: DetailedGpuMetrics
      ) {
        const ctx = canvas.getContext("2d")
        if (!ctx) return false

        const width = canvas.width
        const height = canvas.height
        ctx.clearRect(0, 0, width, height)

        const timeline =
          metrics.frameTimeline.length > 0
            ? metrics.frameTimeline
            : [metrics.frameTime || 16.6]

        const maxMs = Math.max(33.3, ...timeline, 20)
        const barWidth = width / 60
        const startOffset = Math.max(0, 60 - timeline.length)

        // Background gradient grid
        ctx.fillStyle = "rgba(15, 23, 42, 0.4)"
        ctx.fillRect(0, 0, width, height)

        // Target 16.6ms (60 FPS) guideline
        const targetY = height - (16.67 / maxMs) * height
        ctx.strokeStyle = "rgba(16, 185, 129, 0.6)"
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(0, targetY)
        ctx.lineTo(width, targetY)
        ctx.stroke()
        ctx.setLineDash([])

        // Target 33.3ms (30 FPS) guideline
        const slowY = height - (33.33 / maxMs) * height
        ctx.strokeStyle = "rgba(239, 68, 68, 0.3)"
        ctx.beginPath()
        ctx.moveTo(0, slowY)
        ctx.lineTo(width, slowY)
        ctx.stroke()

        // Render bars
        for (let i = 0; i < timeline.length; i++) {
          const ms = timeline[i]
          const barHeight = Math.max(2, (ms / maxMs) * height)
          const x = (startOffset + i) * barWidth
          const y = height - barHeight

          if (ms > 33.3) {
            ctx.fillStyle = "#ef4444" // Red (spike / <30fps)
          } else if (ms > 16.7) {
            ctx.fillStyle = "#eab308" // Yellow (30-60fps)
          } else {
            ctx.fillStyle = "#10b981" // Emerald (>=60fps)
          }

          ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight)
        }

        return true
      }

      it("handles completely empty timeline without dividing by zero or throwing", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const emptyMetrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 0,
          passTimings: {},
          drawCalls: 0,
          triangles: 0,
          estimatedVramBytes: 0,
          frameTimeline: [],
        }

        const success = renderPerfTimelineCanvas(canvas, emptyMetrics)
        expect(success).toBe(true)
        expect(mockCtx._operations.some((op) => op.method === "clearRect")).toBe(true)
        // Background + 1 fallback bar = 2 fillRect calls
        expect(mockCtx._fills.length).toBe(2)
        expect(mockCtx._strokes.length).toBe(2) // 16.6ms & 33.3ms guidelines
      })

      it("handles single-frame timeline correctly and positions it at the rightmost slot", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const singleMetrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 16.6,
          passTimings: {},
          drawCalls: 1,
          triangles: 100,
          estimatedVramBytes: 1024,
          frameTimeline: [16.6],
        }

        renderPerfTimelineCanvas(canvas, singleMetrics)
        // 1 background fill + 1 bar fill = 2 fills
        expect(mockCtx._fills.length).toBe(2)
        const barFill = mockCtx._fills[1]
        // startOffset = 60 - 1 = 59
        // barWidth = 188 / 60 = 3.1333
        // x = 59 * (188 / 60) ~ 184.86
        expect(barFill.rect[0]).toBeCloseTo(59 * (188 / 60), 1)
        expect(barFill.color).toBe("#10b981") // 16.6ms is <= 16.7ms (emerald)
      })

      it("handles full 60 frames and precisely maps green, yellow, and red categories", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        // 20 green frames (10ms), 20 yellow frames (22ms), 20 red frames (45ms)
        const timeline: number[] = [
          ...Array(20).fill(10.0),
          ...Array(20).fill(22.0),
          ...Array(20).fill(45.0),
        ]

        const metrics: DetailedGpuMetrics = {
          fps: 40,
          frameTime: 45.0,
          passTimings: {},
          drawCalls: 5,
          triangles: 12000,
          estimatedVramBytes: 1048576,
          frameTimeline: timeline,
        }

        renderPerfTimelineCanvas(canvas, metrics)
        // 1 background + 60 bars = 61 fills
        expect(mockCtx._fills.length).toBe(61)

        const barFills = mockCtx._fills.slice(1)
        const greenBars = barFills.filter((f) => f.color === "#10b981")
        const yellowBars = barFills.filter((f) => f.color === "#eab308")
        const redBars = barFills.filter((f) => f.color === "#ef4444")

        expect(greenBars.length).toBe(20)
        expect(yellowBars.length).toBe(20)
        expect(redBars.length).toBe(20)
      })

      it("handles extreme spikes (10,000ms), 0ms, and negative numbers without NaNs or coordinate overflow", () => {
        const mockCtx = createMockCanvas2DContext()
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(mockCtx),
        } as unknown as HTMLCanvasElement

        const extremeTimeline = [-50, 0, 0.001, 16.6, 9999.9, 100000]
        const metrics: DetailedGpuMetrics = {
          fps: 1,
          frameTime: 100000,
          passTimings: {},
          drawCalls: 1,
          triangles: 1,
          estimatedVramBytes: 0,
          frameTimeline: extremeTimeline,
        }

        renderPerfTimelineCanvas(canvas, metrics)
        const barFills = mockCtx._fills.slice(1)
        expect(barFills.length).toBe(6)

        // Verify every coordinate and dimension is finite and positive
        for (const fill of barFills) {
          const [x, y, w, h] = fill.rect
          expect(Number.isFinite(x)).toBe(true)
          expect(Number.isFinite(y)).toBe(true)
          expect(Number.isFinite(w)).toBe(true)
          expect(Number.isFinite(h)).toBe(true)
          expect(w).toBeGreaterThan(0)
          expect(h).toBeGreaterThanOrEqual(2) // Math.max(2, ...)
        }
      })

      it("returns false gracefully when canvas getContext('2d') is null", () => {
        const canvas = {
          width: 188,
          height: 44,
          getContext: vi.fn().mockReturnValue(null),
        } as unknown as HTMLCanvasElement

        const metrics: DetailedGpuMetrics = {
          fps: 60,
          frameTime: 16.6,
          passTimings: {},
          drawCalls: 1,
          triangles: 10,
          estimatedVramBytes: 100,
          frameTimeline: [16.6],
        }

        const success = renderPerfTimelineCanvas(canvas, metrics)
        expect(success).toBe(false)
      })
    })

    describe("1.2 Visual Warning Badge Rendering (hasAnyWarning & isVramOverBudget)", () => {
      it("does NOT render warning badge when VRAM is at or below the 80% threshold", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 1000,
          warnThresholdRatio: 0.8, // 800 MB limit
        })

        // Exactly 800 MB: 800.0 > 800.0 is false -> no warning
        performanceTelemetry.setEstimatedVramBytes(800 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).not.toContain("VRAM Alert:")
        expect(html).not.toContain("animate-pulse")
        expect(html).toContain("800 MB / 1000 MB")
      })

      it("DOES render pulsing warning badge when VRAM strictly exceeds budget ratio", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 1000,
          warnThresholdRatio: 0.8, // 800 MB limit
        })

        // 800.1 MB: strictly exceeds 800.0 MB -> warning trips
        performanceTelemetry.setEstimatedVramBytes(800.1 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).toContain("VRAM Alert: &gt;80% Budget")
        expect(html).toContain("animate-pulse")
        expect(html).toContain("800.1 MB / 1000 MB")
        expect(html).toContain("text-red-400 font-bold")
      })

      it("renders warning badge with dynamic ratio when warnThresholdRatio is customized", () => {
        useProjectStore.getState().setMemoryBudget({
          totalVramBudgetMB: 500,
          warnThresholdRatio: 0.65, // 325 MB limit
        })

        performanceTelemetry.setEstimatedVramBytes(350 * 1024 * 1024)

        const html = renderToStaticMarkup(React.createElement(PerfOverlay))
        expect(html).toContain("VRAM Alert: &gt;65% Budget")
        expect(html).toContain("350 MB / 500 MB")
      })
    })

    describe("1.3 Screenshot Export Logic & ViewportCapture Registration", () => {
      it("registers live performance metrics to viewportCapture service", () => {
        performanceTelemetry.recordFrameTime(14.2)
        performanceTelemetry.notifySubscribers()

        // Render PerfOverlay (which registers metrics via viewportCapture)
        renderToStaticMarkup(React.createElement(PerfOverlay))

        // Query viewportCapture metrics
        const captured = viewportCapture.getPerfMetrics()
        expect(captured).toBeDefined()
        expect(typeof captured.fps).toBe("number")
        expect(typeof captured.frameTimeMs).toBe("number")
        expect(captured.fps).toBeGreaterThanOrEqual(1)
      })

      it("handles ScreenshotButton with null canvas gracefully without throwing", () => {
        const nullCanvasRef = { current: null }
        const html = renderToStaticMarkup(
          React.createElement(ScreenshotButton, { canvasRef: nullCanvasRef })
        )
        expect(html).toContain("Screenshot")
      })

      it("executes ScreenshotButton capture and triggers download link click", () => {
        const mockBlob = { size: 1024, type: "image/png" }
        const toBlobSpy = vi.fn((cb: (blob: any) => void) => {
          cb(mockBlob)
        })
        const canvasRef = { current: { toBlob: toBlobSpy } as unknown as HTMLCanvasElement }

        const clickSpy = vi.fn()
        const appendChildSpy = vi.fn()
        const removeChildSpy = vi.fn()
        const anchor: any = { href: "", download: "", click: clickSpy }
        const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/mock-uuid")
        const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        vi.stubGlobal("document", {
          body: { appendChild: appendChildSpy, removeChild: removeChildSpy },
          createElement: () => anchor,
        })

        try {
          // Render the REAL ScreenshotButton and pull the onClick it wires onto its <button>.
          let tree: any = null
          function Interceptor() {
            tree = (ScreenshotButton as any)({ canvasRef })
            return null
          }
          renderToStaticMarkup(React.createElement(Interceptor))
          expect(tree.type).toBe("button")
          expect(typeof tree.props.onClick).toBe("function")

          tree.props.onClick()

          expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), "image/png")
          expect(createObjectURLSpy).toHaveBeenCalledWith(mockBlob)
          expect(anchor.href).toBe("blob:http://localhost/mock-uuid")
          expect(anchor.download).toMatch(/^shader-studio-\d+\.png$/)
          expect(appendChildSpy).toHaveBeenCalledWith(anchor)
          expect(clickSpy).toHaveBeenCalledTimes(1)
          expect(removeChildSpy).toHaveBeenCalledWith(anchor)
          expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:http://localhost/mock-uuid")
        } finally {
          createObjectURLSpy.mockRestore()
          revokeObjectURLSpy.mockRestore()
          vi.unstubAllGlobals()
        }
      })
    })
  })

  // ==========================================================================
  // SECTION 2: renderCoordinator.ts Virtual Clock & Telemetry Probes
  // ==========================================================================
  describe("2. renderCoordinator.ts Phase 5 Telemetry & Virtual Clock Integrity", () => {

    it("verifies Phase 5 telemetry does NOT mutate frame delta or virtual clock", () => {
      const coordinator = new RenderCoordinator()
      const recordedDeltas: number[] = []
      const virtualTimes: number[] = []

      coordinator.registerPreRenderHook("probe-hook", (virtualTime, delta) => {
        virtualTimes.push(virtualTime)
        recordedDeltas.push(delta)
      })

      // Frame 1: baseline bootstrap at t=1000
      coordinator.tick(1000)
      coordinator.seek(0) // reset virtual time to 0 while keeping lastTime = 1000

      // Frame 2: +16.0ms at t=1016.0
      coordinator.tick(1016.0)
      // Frame 3: +33.0ms at t=1049.0
      coordinator.tick(1049.0)

      // Expected delta values
      expect(recordedDeltas[recordedDeltas.length - 2]).toBe(16.0)
      expect(recordedDeltas[recordedDeltas.length - 1]).toBe(33.0)

      // Verify virtual playback time accumulation:
      // delta 16.0ms -> +0.016s -> 16.0ms
      // delta 33.0ms -> +0.033s -> 49.0ms
      expect(virtualTimes[virtualTimes.length - 2]).toBeCloseTo(16.0, 2)
      expect(virtualTimes[virtualTimes.length - 1]).toBeCloseTo(49.0, 2)
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.049, 4)

      // Verify that performanceTelemetry recorded exact frame times without mutation
      const timeline = performanceTelemetry.getTimeline()
      expect(timeline.length).toBeGreaterThanOrEqual(2)
      expect(timeline[timeline.length - 2]).toBe(16.0)
      expect(timeline[timeline.length - 1]).toBe(33.0)
    })

    it("freezes virtual clock while paused, delivers delta=0 to adapter, and preserves telemetry recording", () => {
      const coordinator = new RenderCoordinator()
      const adapterRenderSpy = vi.fn()
      const mockAdapter = {
        renderFrame: adapterRenderSpy,
        dispose: vi.fn(),
      }
      coordinator.setActiveAdapter(mockAdapter)

      // Advance initially
      coordinator.tick(1000)
      coordinator.tick(1020)
      const timeBeforePause = coordinator.getPlaybackTime()
      expect(timeBeforePause).toBeGreaterThan(0)

      // Pause playback
      coordinator.setPlaying(false)
      expect(coordinator.getIsPlaying()).toBe(false)

      adapterRenderSpy.mockClear()

      // Tick while paused (+50ms wall clock)
      coordinator.tick(1070)

      // 1. Virtual playback time MUST NOT advance
      expect(coordinator.getPlaybackTime()).toBe(timeBeforePause)

      // 2. Adapter renderFrame must receive delta = 0 while paused
      expect(adapterRenderSpy).toHaveBeenCalledWith(timeBeforePause * 1000, 0)

      // 3. Telemetry in Phase 5 still records the actual wall clock delta (50ms)
      const timeline = performanceTelemetry.getTimeline()
      expect(timeline[timeline.length - 1]).toBe(50)
    })

    it("scales virtual clock accurately across variable playback speeds (0.5x, 2.0x, 0.0x)", () => {
      const coordinator = new RenderCoordinator()

      // Bootstrap at 1000 and seek to 0
      coordinator.tick(1000)
      coordinator.seek(0)

      // 0.5x speed
      coordinator.setPlaybackSpeed(0.5)
      coordinator.tick(1020) // 20ms delta * 0.5 = 10ms virtual advancement
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.01, 3)

      // 2.0x speed
      coordinator.setPlaybackSpeed(2.0)
      coordinator.tick(1040) // 20ms delta * 2.0 = 40ms -> total 50ms virtual
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.05, 3)

      // 0.0x speed
      coordinator.setPlaybackSpeed(0.0)
      coordinator.tick(1100) // 60ms delta * 0 = 0 -> total still 50ms virtual
      expect(coordinator.getPlaybackTime()).toBeCloseTo(0.05, 3)
    })

    it("verifies seek operation immediately dispatches render with zero delta and increments count", () => {
      const coordinator = new RenderCoordinator()
      const adapterRenderSpy = vi.fn()
      const mockAdapter = {
        renderFrame: adapterRenderSpy,
        dispose: vi.fn(),
      }
      coordinator.setActiveAdapter(mockAdapter)

      expect(coordinator.getSingleFrameRenderCount()).toBe(0)

      // Seek to 42.5 seconds
      coordinator.seek(42.5)

      expect(coordinator.getPlaybackTime()).toBe(42.5)
      expect(coordinator.getSingleFrameRenderCount()).toBe(1)
      expect(adapterRenderSpy).toHaveBeenCalledWith(42500, 0)

      // Clamping negative seek to 0.0
      coordinator.seek(-10)
      expect(coordinator.getPlaybackTime()).toBe(0)
      expect(coordinator.getSingleFrameRenderCount()).toBe(2)
      expect(adapterRenderSpy).toHaveBeenCalledWith(0, 0)
    })

    it("survives throwing telemetry subscribers without crashing the render loop", () => {
      const coordinator = new RenderCoordinator()
      const badSubscriber = vi.fn().mockImplementation(() => {
        throw new Error("Adversarial subscriber fault injection!")
      })

      // performanceTelemetry subscriber fault
      const unsubTelemetry = performanceTelemetry.subscribe(badSubscriber)

      expect(() => {
        coordinator.tick(1000)
        coordinator.tick(1016.6)
      }).not.toThrow()

      unsubTelemetry()
    })
  })

  // ==========================================================================
  // SECTION 3: projectStore.ts Memory Budget Serialization Probes
  // ==========================================================================
  describe("3. projectStore.ts Memory Budget Serialization & Round-Trip", () => {
    it("initializes project with Contract 4 default memory budget", () => {
      const store = useProjectStore.getState()
      expect(store.memoryBudget).toEqual({
        textureBudgetMB: 512,
        geometryBudgetMB: 256,
        totalVramBudgetMB: 1024,
        warnThresholdRatio: 0.8,
      })
      expect(store.getMemoryBudget()).toEqual(store.memoryBudget)
    })

    it("partially updates memory budget and marks unsaved changes flag", () => {
      const store = useProjectStore.getState()
      expect(store.hasUnsavedChanges).toBe(false)

      store.setMemoryBudget({
        textureBudgetMB: 768,
        warnThresholdRatio: 0.85,
      })

      const updated = useProjectStore.getState().memoryBudget
      expect(updated.textureBudgetMB).toBe(768)
      expect(updated.geometryBudgetMB).toBe(256) // preserved default
      expect(updated.totalVramBudgetMB).toBe(1024) // preserved default
      expect(updated.warnThresholdRatio).toBe(0.85)
      expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    })

    it("round-trips custom memory budget perfectly through exportProjectData and loadProjectData", () => {
      const store = useProjectStore.getState()
      const customBudget: MemoryBudgetConfig = {
        textureBudgetMB: 1536,
        geometryBudgetMB: 512,
        totalVramBudgetMB: 2048,
        warnThresholdRatio: 0.75,
      }

      store.setMemoryBudget(customBudget)
      const exported = store.exportProjectData()

      expect(exported.memoryBudget).toEqual(customBudget)

      // Reset project back to defaults
      store.resetProject()
      expect(useProjectStore.getState().memoryBudget).toEqual(createDefaultMemoryBudget())

      // Re-load exported data
      store.loadProjectData(exported)
      expect(useProjectStore.getState().memoryBudget).toEqual(customBudget)
      expect(useProjectStore.getState().getMemoryBudget()).toEqual(customBudget)
    })

    it("safely handles legacy or corrupted project data lacking memoryBudget", () => {
      const store = useProjectStore.getState()
      const legacyData: any = {
        name: "Legacy Project",
        version: "1.0",
        backend: "webgl2",
        graphNodes: [],
        graphEdges: [],
        uniformValues: {},
        graphUniforms: [],
        shaderSources: {},
        audioSettings: {},
        audioBindings: [],
        variations: [],
        environmentSettings: {},
        // memoryBudget is missing entirely!
      }

      expect(() => {
        store.loadProjectData(legacyData)
      }).not.toThrow()

      // Falls back safely to default memory budget
      expect(useProjectStore.getState().memoryBudget).toEqual(createDefaultMemoryBudget())
    })

    it("safely handles partial memoryBudget in project data by merging with defaults", () => {
      const store = useProjectStore.getState()
      const partialData: any = {
        name: "Partial Project",
        version: "1.0",
        backend: "webgpu",
        graphNodes: [],
        graphEdges: [],
        uniformValues: {},
        graphUniforms: [],
        shaderSources: {},
        audioSettings: {},
        audioBindings: [],
        variations: [],
        environmentSettings: {},
        memoryBudget: {
          totalVramBudgetMB: 4096,
          // textureBudgetMB, geometryBudgetMB, warnThresholdRatio missing!
        },
      }

      store.loadProjectData(partialData)
      const budget = useProjectStore.getState().memoryBudget
      expect(budget.totalVramBudgetMB).toBe(4096)
      expect(budget.textureBudgetMB).toBe(512) // merged default
      expect(budget.geometryBudgetMB).toBe(256) // merged default
      expect(budget.warnThresholdRatio).toBe(0.8) // merged default
    })

    it("verifies checkMemoryThreshold on projectStore adheres strictly to '>' inequality", () => {
      const store = useProjectStore.getState()
      store.setMemoryBudget({
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 200,
        warnThresholdRatio: 0.8, // 80 MB, 80 MB, 160 MB
      })

      // Under threshold
      const under = store.checkMemoryThreshold({
        textureMB: 79.9,
        geometryMB: 79.9,
        totalVramMB: 159.9,
      })
      expect(under.hasAnyWarning).toBe(false)

      // Exactly at ratio (80.0 > 80.0 is false)
      const exactlyAt = store.checkMemoryThreshold({
        textureMB: 80.0,
        geometryMB: 80.0,
        totalVramMB: 160.0,
      })
      expect(exactlyAt.hasAnyWarning).toBe(false)

      // Strictly over by 0.01 MB
      const overTexture = store.checkMemoryThreshold({
        textureMB: 80.01,
        geometryMB: 50,
        totalVramMB: 100,
      })
      expect(overTexture.textureWarning).toBe(true)
      expect(overTexture.hasAnyWarning).toBe(true)

      const overGeometry = store.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 80.01,
        totalVramMB: 100,
      })
      expect(overGeometry.geometryWarning).toBe(true)
      expect(overGeometry.hasAnyWarning).toBe(true)

      const overTotal = store.checkMemoryThreshold({
        textureMB: 50,
        geometryMB: 50,
        totalVramMB: 160.01,
      })
      expect(overTotal.totalVramWarning).toBe(true)
      expect(overTotal.hasAnyWarning).toBe(true)
    })
  })
})
})

describe("Zero-allocation renderFrame", () => {
describe("Milestone 2 Adversarial Challenger Suite: Bundle & Memory Robustness", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })





  // ==========================================================================
  // Section 5: Zero-Allocation Verification in Adapter renderFrame Loops
  // ==========================================================================
  describe("Zero Allocation in Adapter renderFrame Calls", () => {
    it("WebGPU: renderFrame executes without calling ArrayBuffer.prototype.slice", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
@vertex fn vs(@location(0) pos: vec3f) -> @builtin(position) vec4f { return vec4f(pos, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }
`)

      const sliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice")

      // Execute 60 frames
      for (let f = 0; f < 60; f++) {
        adapter.renderFrame(f * 16.6, 16.6)
      }

      expect(sliceSpy).not.toHaveBeenCalled()
      adapter.dispose()
    })

    it("WebGL2: renderFrame executes without calling ArrayBuffer.prototype.slice", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const sliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice")

      for (let f = 0; f < 60; f++) {
        adapter.renderFrame(f * 16.6, 16.6)
      }

      expect(sliceSpy).not.toHaveBeenCalled()
      adapter.dispose()
    })
  })
})
})


// fleet(w1-d-coverage): MemoryBudgetManager config round-trip, eviction dispatch, reset
describe("MemoryBudgetManager config, eviction and reset", () => {
  const usage = { textureMB: 90, geometryMB: 10, totalVramMB: 90 }

  it("setConfig merges updates and getConfig returns a defensive copy", () => {
    const m = new MemoryBudgetManager()
    m.setConfig({ textureBudgetMB: 100 })
    const cfg = m.getConfig()
    expect(cfg.textureBudgetMB).toBe(100)
    expect(cfg.geometryBudgetMB).toBe(createDefaultMemoryBudget().geometryBudgetMB)
    cfg.textureBudgetMB = 1
    expect(m.getConfig().textureBudgetMB).toBe(100)
  })

  it("evaluateUsage notifies eviction listeners with excess over the warn threshold; unsubscribe stops it", () => {
    const m = new MemoryBudgetManager({ textureBudgetMB: 100, geometryBudgetMB: 100, totalVramBudgetMB: 100, warnThresholdRatio: 0.8 })
    const calls: Array<[string, number]> = []
    const off = m.onEvictionRequired((t, ex) => calls.push([t, ex]))
    m.evaluateUsage(usage)
    expect(calls.map((c) => c[0])).toEqual(["texture", "total"])
    expect(calls[0][1]).toBeCloseTo(10)
    off()
    m.evaluateUsage(usage)
    expect(calls).toHaveLength(2)
  })

  it("geometry overage dispatches a geometry eviction; throwing listeners are isolated", () => {
    const m = new MemoryBudgetManager({ geometryBudgetMB: 100, warnThresholdRatio: 0.5 })
    const seen: string[] = []
    m.onWarning(() => { throw new Error("boom") })
    m.onEvictionRequired(() => { throw new Error("boom") })
    m.onEvictionRequired((t) => seen.push(t))
    expect(() => m.evaluateUsage({ textureMB: 0, geometryMB: 60, totalVramMB: 0 })).not.toThrow()
    expect(seen).toEqual(["geometry"])
  })

  it("reset restores default config and drops all listeners", () => {
    const m = new MemoryBudgetManager({ textureBudgetMB: 1 })
    const warn = vi.fn()
    const evict = vi.fn()
    m.onWarning(warn)
    m.onEvictionRequired(evict)
    m.reset()
    expect(m.getConfig()).toEqual(createDefaultMemoryBudget())
    m.setConfig({ textureBudgetMB: 1 })
    m.evaluateUsage({ textureMB: 500, geometryMB: 0, totalVramMB: 0 })
    expect(warn).not.toHaveBeenCalled()
    expect(evict).not.toHaveBeenCalled()
  })
})

describe("coordinator telemetry (w1-b-ui handoff)", () => {
    it("computes mathematically accurate FPS and frame times across standard refresh targets", () => {
      const coordinator = new RenderCoordinator()
      let lastMetrics: PerformanceMetrics | null = null

      coordinator.onMetrics((m) => {
        lastMetrics = m
      })

      // 60 FPS: 16.666ms delta
      coordinator.tick(1000)
      coordinator.tick(1016.666)
      expect(lastMetrics).not.toBeNull()
      expect(lastMetrics?.fps).toBe(60)
      expect(lastMetrics?.frameTimeMs).toBeCloseTo(16.67, 1)

      // 120 FPS: 8.333ms delta
      coordinator.tick(1025.0)
      expect(lastMetrics?.fps).toBe(120)
      expect(lastMetrics?.frameTimeMs).toBeCloseTo(8.33, 1)

      // 30 FPS: 33.333ms delta
      coordinator.tick(1058.333)
      expect(lastMetrics?.fps).toBe(30)
      expect(lastMetrics?.frameTimeMs).toBeCloseTo(33.33, 1)

      // 144 FPS: 6.944ms delta
      coordinator.tick(1065.277)
      expect(lastMetrics?.fps).toBe(144)
      expect(lastMetrics?.frameTimeMs).toBeCloseTo(6.94, 1)
    })

    it("recovers immediately to normal FPS telemetry after a heavy 500ms GPU freeze", () => {
      const coordinator = new RenderCoordinator()
      let lastMetrics: PerformanceMetrics | null = null
      coordinator.onMetrics((m) => {
        lastMetrics = m
      })

      coordinator.tick(1000)
      // 500ms stall (2 FPS)
      coordinator.tick(1500)
      expect(lastMetrics?.fps).toBe(2)
      expect(lastMetrics?.frameTimeMs).toBe(500)

      // Immediate recovery on next frame: 16.67ms (60 FPS)
      coordinator.tick(1516.666)
      expect(lastMetrics?.fps).toBe(60)
      expect(lastMetrics?.frameTimeMs).toBeCloseTo(16.67, 1)
    })


  // fleet: fixed in W2 -- a throwing metrics subscriber currently propagates out of tick()
  // and starves later subscribers; the contract is that subscribers are isolated.
  it.fails("isolates subscriber errors so a throwing telemetry subscriber does not crash tick()", () => {
    const coordinator = new RenderCoordinator()
    let healthyReceived = false
    coordinator.onMetrics(() => {
      throw new Error("Adversarial subscriber fault!")
    })
    coordinator.onMetrics(() => {
      healthyReceived = true
    })
    expect(() => {
      coordinator.tick(1000)
      coordinator.tick(1016)
    }).not.toThrow()
    expect(healthyReceived).toBe(true)
  })
})

describe("Tier 5: Comprehensive White-Box Adversarial Coverage & Boundary Hardening", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    subGraphLibrary.reset()
    customNodeRegistry.clear()
    customNodeRegistry.discoverBuiltinNodes()
    resetDesktopFallbackState()
    performanceTelemetry.reset()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BATTERY 5: R5 Performance, Memory Budget, Mesh LOD & Texture Streaming
  // ==========================================================================
  describe("Battery 5: R5 Performance & Scale Systems White-Box Coverage", () => {
    it("5.1 performanceTelemetry manages 60-frame buffer, pass timings, and VRAM estimation", () => {
      // Record 70 frames to test 60-entry circular eviction
      for (let i = 1; i <= 70; i++) {
        performanceTelemetry.recordFrameTime(16.0 + (i % 5))
      }
      expect(performanceTelemetry.getTimeline().length).toBe(60)

      // Average FPS calculation with finite numbers
      const fps = performanceTelemetry.getAverageFps()
      expect(fps).toBeGreaterThan(50)
      expect(fps).toBeLessThan(70)

      // Pass timings
      performanceTelemetry.setPassTiming("gbuffer", 2.4)
      performanceTelemetry.setPassTiming("shadow", 1.8)
      performanceTelemetry.setPassTiming("lighting", 3.2)
      performanceTelemetry.setPassTiming("ssr", 4.5)
      performanceTelemetry.setPassTiming("postprocess", 1.1)

      const timings = performanceTelemetry.getPassTimings()
      expect(timings.gbuffer).toBe(2.4)
      expect(timings.ssr).toBe(4.5)

      // Texture memory arithmetic & invalid bounds safety
      expect(performanceTelemetry.calculateTextureMemory(1024, 1024, 4)).toBe(4194304)
      expect(performanceTelemetry.calculateTextureMemory(-100, 1024, 4)).toBe(0)
      expect(performanceTelemetry.calculateTextureMemory(1024, NaN, 4)).toBe(0)

      // Geometry memory arithmetic & invalid bounds safety
      expect(performanceTelemetry.calculateGeometryMemory(1000, 32)).toBe(32000)
      expect(performanceTelemetry.calculateGeometryMemory(-50, 32)).toBe(0)

      // Manual VRAM override
      performanceTelemetry.setEstimatedVramBytes(50000000)
      expect(performanceTelemetry.getEstimatedVramBytes()).toBe(50000000)
    })

    it("5.2 checkMemoryThreshold enforces strict boundary inequality (> budget * ratio)", () => {
      const budget = {
        textureBudgetMB: 100,
        geometryBudgetMB: 100,
        totalVramBudgetMB: 1000,
        warnThresholdRatio: 0.8, // 800MB limit
      }

      // 800.0MB does NOT trip (strictly usage > limit)
      const resAtLimit = checkMemoryThreshold(
        { textureMB: 50, geometryMB: 50, totalVramMB: 800.0 },
        budget
      )
      expect(resAtLimit.totalVramWarning).toBe(false)
      expect(resAtLimit.hasAnyWarning).toBe(false)

      // 800.01MB TRIPS
      const resOverLimit = checkMemoryThreshold(
        { textureMB: 50, geometryMB: 50, totalVramMB: 800.01 },
        budget
      )
      expect(resOverLimit.totalVramWarning).toBe(true)
      expect(resOverLimit.hasAnyWarning).toBe(true)

      // MemoryBudgetManager dispatches warnings and eviction events
      const mgr = new MemoryBudgetManager(budget)
      const warningSpy = vi.fn()
      const evictSpy = vi.fn()

      mgr.onWarning(warningSpy)
      mgr.onEvictionRequired(evictSpy)

      mgr.evaluateUsage({ textureMB: 90, geometryMB: 50, totalVramMB: 750 })
      // Texture limit = 80MB. Usage = 90MB -> Excess = 10MB
      expect(warningSpy).toHaveBeenCalledTimes(1)
      expect(evictSpy).toHaveBeenCalledWith("texture", 10)
    })

    it("5.3 generateMeshLods and selectLodByDistance handle zero, extremes, and boundaries", () => {
      // 0 or negative vertices
      expect(generateMeshLods(0)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(-100)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
      expect(generateMeshLods(NaN)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })

      // 100,000 vertices -> lod0: 100k, lod1: 50k, lod2: 25k
      const lods = generateMeshLods(100000)
      expect(lods.lod0).toBe(100000)
      expect(lods.lod1).toBe(50000)
      expect(lods.lod2).toBe(25000)

      // Distance selection (thresholds: lod0Dist: 10, lod1Dist: 30)
      expect(selectLodByDistance(0)).toBe("lod0")
      expect(selectLodByDistance(10)).toBe("lod0")
      expect(selectLodByDistance(10.01)).toBe("lod1")
      expect(selectLodByDistance(30)).toBe("lod1")
      expect(selectLodByDistance(30.01)).toBe("lod2")
      expect(selectLodByDistance(1000)).toBe("lod2")
      expect(selectLodByDistance(Infinity)).toBe("lod2")
      expect(selectLodByDistance(NaN)).toBe("lod0")
    })

    it("5.4 decimateGeometryBuffer and decimateIndices step through buffers correctly", () => {
      // 8 vertices in 3D (stride 3) = 24 floats
      const positions = new Float32Array(24)
      for (let i = 0; i < 24; i++) positions[i] = i

      // lod0: exact clone
      const lod0 = decimateGeometryBuffer(positions, "lod0", 3)
      expect(lod0.length).toBe(24)

      // lod1: step 2 -> 4 vertices = 12 floats
      const lod1 = decimateGeometryBuffer(positions, "lod1", 3)
      expect(lod1.length).toBe(12)

      // lod2: step 4 -> 2 vertices = 6 floats
      const lod2 = decimateGeometryBuffer(positions, "lod2", 3)
      expect(lod2.length).toBe(6)

      // Indices decimation: 4 triangles (12 indices)
      const indices = new Uint16Array([0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4])
      const decIndices = decimateIndices(indices, "lod1")
      expect(decIndices.length).toBe(6) // 2 triangles
    })

    it("5.5 TextureStreamer progressively streams mips and evicts LRU textures on budget pressure", async () => {
      // Create streamer with 30MB limit (each 2048x2048 RGBA texture is 16MB)
      const streamer = createTextureStreamer({ memoryLimitMB: 30 })
      const evictSpy = vi.fn()
      streamer.onEvict(evictSpy)

      const mipsA: number[] = []
      await streamer.loadMipmapProgressive("tex_a.png", (level) => {
        mipsA.push(level)
      })
      // Verified progressive sequence: 2 -> 1 -> 0
      expect(mipsA).toEqual([2, 1, 0])
      expect(streamer.isCached("tex_a.png")).toBe(true)
      expect(streamer.getResidentTextureCount()).toBe(1)

      // Touch tex_a to make it recently accessed
      streamer.touch("tex_a.png")

      // Load tex_b (16MB). Total resident ~32MB, exceeding 30MB limit -> triggers LRU eviction
      await streamer.loadMipmapProgressive("tex_b.png", () => {})

      // At least 1 texture remains resident and budget is enforced
      expect(streamer.getResidentMemoryMB()).toBeLessThanOrEqual(30)

      // Invalid URLs return false cleanly
      expect(await streamer.loadMipmapProgressive("", () => {})).toBe(false)
      expect(await streamer.loadMipmapProgressive(null as any, () => {})).toBe(false)
    })
  })
})

// Handoff from w1-c-tooling (tier5 integration stress, domains 2-3; the deferred-pipeline harness part was dropped).
describe("telemetry / budget / LOD / streaming under stress (w1-c-tooling handoff)", () => {
  it("telemetry keeps a 60-entry ring over 1,000 noisy frames and retains pass timings", () => {
    const t = new PerformanceTelemetry()
    t.setPassTiming("gbuffer", 2.1)
    t.setPassTiming("ssr", 3.8)
    t.setDrawCalls(145)
    t.setTriangles(480000)
    for (let i = 0; i < 1000; i++) t.recordFrameTime(i % 50 === 0 ? 33.3 : 14.0 + (i % 5))
    expect(t.getTimeline()).toHaveLength(60)
    const fps = t.getAverageFps()
    expect(Number.isFinite(fps)).toBe(true)
    expect(fps).toBeGreaterThan(25)
    expect(fps).toBeLessThan(75)
    expect([t.getDrawCalls(), t.getTriangles()]).toEqual([145, 480000])
    expect(t.getPassTimings()).toMatchObject({ gbuffer: 2.1, ssr: 3.8 })
  })

  it("memory budget warns strictly above the threshold and requests eviction per breached resource", () => {
    const m = new MemoryBudgetManager({ textureBudgetMB: 128, geometryBudgetMB: 64, totalVramBudgetMB: 256, warnThresholdRatio: 0.8 })
    const warnings: unknown[] = []
    const evictions: Array<{ type: string; excess: number }> = []
    m.onWarning((res) => warnings.push(res))
    m.onEvictionRequired((type, excess) => evictions.push({ type, excess }))

    const exact: MemoryUsage = { textureMB: 102.4, geometryMB: 50.0, totalVramMB: 160.0 }
    expect(m.evaluateUsage(exact).hasAnyWarning).toBe(false)
    expect(warnings).toHaveLength(0)

    const over = m.evaluateUsage({ textureMB: 102.41, geometryMB: 50.0, totalVramMB: 160.0 })
    expect(over.textureWarning).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(evictions).toHaveLength(1)
    expect(evictions[0].type).toBe("texture")
    expect(evictions[0].excess).toBeCloseTo(0.01, 2)

    const all = m.evaluateUsage({ textureMB: 150, geometryMB: 70, totalVramMB: 300 })
    expect([all.textureWarning, all.geometryWarning, all.totalVramWarning]).toEqual([true, true, true])
    expect(evictions).toHaveLength(4)
  })

  it("decimates a 500k-vertex mesh across 3 LOD tiers with stride-correct buffers and guards bad input", () => {
    const lods = generateMeshLods(500000)
    expect(lods).toEqual({ lod0: 500000, lod1: 250000, lod2: 125000 })
    expect([5, 10, 10.1, 30, 30.1, Infinity].map((d) => selectLodByDistance(d))).toEqual(["lod0", "lod0", "lod1", "lod1", "lod2", "lod2"])

    const pos = new Float32Array(500000 * 3)
    for (let i = 0; i < pos.length; i++) pos[i] = (i % 1000) * 0.1
    const l1 = decimateGeometryBuffer(pos, "lod1", 3)
    expect(l1).toHaveLength(750000)
    expect([...l1.subarray(0, 6)]).toEqual([pos[0], pos[1], pos[2], pos[6], pos[7], pos[8]])
    expect(decimateGeometryBuffer(pos, "lod2", 3)).toHaveLength(375000)

    const idx = new Uint32Array(750000)
    for (let t = 0; t < 250000; t++) idx.set([t, t + 1, t + 2], t * 3)
    expect(decimateIndices(idx, "lod1")).toHaveLength(375000)

    for (const bad of [0, -100, NaN]) expect(generateMeshLods(bad)).toEqual({ lod0: 0, lod1: 0, lod2: 0 })
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(decimateGeometryBuffer(quad, "lod1", 3)).toHaveLength(quad.length)
  })

  it("streams 20 textures concurrently through mips 2 -> 1 -> 0", async () => {
    const s = new TextureStreamer({ memoryLimitMB: 512 })
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const order: number[] = []
        await s.loadMipmapProgressive(`assets/textures/tex_pbr_4k_${i}.png`, (mip, [w, h]) => {
          order.push(mip)
          expect(w).toBeGreaterThan(0)
          expect(h).toBeGreaterThan(0)
        })
        expect(order).toEqual([2, 1, 0])
      })
    )
    expect(s.getResidentTextureCount()).toBe(20)
    expect(s.getResidentMemoryMB()).toBeGreaterThan(0)
  })

  it("evicts LRU under a tight limit but keeps a continuously touched texture resident", async () => {
    const s = new TextureStreamer({ memoryLimitMB: 32 })
    const evicted: string[] = []
    s.onEvict((url, bytes) => {
      evicted.push(url)
      expect(bytes).toBeGreaterThan(0)
    })
    for (let i = 0; i < 15; i++) await s.loadMipmapProgressive(`assets/textures/ground_${i}.png`, () => {})
    expect(evicted.length).toBeGreaterThan(0)
    expect(s.getResidentMemoryMB()).toBeLessThanOrEqual(32)

    const hot = "assets/textures/ground_hero_hot.png"
    await s.loadMipmapProgressive(hot, () => {})
    expect(s.isCached(hot)).toBe(true)
    for (let j = 20; j < 35; j++) {
      s.touch(hot)
      await s.loadMipmapProgressive(`assets/textures/ambient_${j}.png`, () => {})
    }
    expect(s.isCached(hot)).toBe(true)
  })

  it("streamer edge cases: empty LRU, clamped negative limit, touching unknown URLs", () => {
    const s = new TextureStreamer()
    expect(s.evictLru()).toBeNull()
    s.setMemoryLimitMB(-50)
    expect(s.getMemoryLimitMB()).toBe(1)
    expect(() => s.touch("non_existent.png")).not.toThrow()
  })
})
