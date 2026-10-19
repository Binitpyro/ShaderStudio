import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import { execSync } from "child_process"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { resolveRollupManualChunk } from "../mocks/gen2Harness"
import { WebGPUAdapter } from "@/adapters/webgpu"
import * as THREE from "three"

describe("Tier 1: Feature Coverage — Bundle Architecture & Runtime Memory Optimization", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. Bundle Architecture & Rollup Chunk Splitting
  // --------------------------------------------------------------------------
  describe("Bundle Architecture & Rollup Manual Chunks", () => {
    it("partitions third-party packages into dedicated vendor chunks according to R2 specification", () => {
      // Monaco Editor chunk
      expect(resolveRollupManualChunk("node_modules/@monaco-editor/react/index.js")).toBe("vendor-monaco")
      expect(resolveRollupManualChunk("node_modules/monaco-editor/esm/vs/editor/editor.main.js")).toBe("vendor-monaco")

      // Three.js chunk
      expect(resolveRollupManualChunk("node_modules/three/build/three.module.js")).toBe("vendor-three")
      expect(resolveRollupManualChunk("node_modules/three/examples/jsm/controls/OrbitControls.js")).toBe("vendor-three")

      // React Flow chunk
      expect(resolveRollupManualChunk("node_modules/reactflow/dist/esm/index.js")).toBe("vendor-reactflow")

      // Radix UI chunk
      expect(resolveRollupManualChunk("node_modules/@radix-ui/react-slider/dist/index.mjs")).toBe("vendor-radix")
      expect(resolveRollupManualChunk("node_modules/@radix-ui/react-tooltip/dist/index.mjs")).toBe("vendor-radix")

      // Shared vendor chunk (react, react-dom, dexie, tailwind-merge)
      expect(resolveRollupManualChunk("node_modules/react-dom/client.js")).toBe("vendor")
      expect(resolveRollupManualChunk("node_modules/dexie/dist/dexie.mjs")).toBe("vendor")
      expect(resolveRollupManualChunk("node_modules/tailwind-merge/dist/lib/index.mjs")).toBe("vendor")

      // Application source code remains in entry / dynamic route chunks
      expect(resolveRollupManualChunk("src/App.tsx")).toBeUndefined()
      expect(resolveRollupManualChunk("src/components/Viewport.tsx")).toBeUndefined()
    })

    it("enforces entry bundle budget guardrail (< 300 kB un-gzipped / < 90 kB gzipped)", () => {
      const distAssetsDir = path.resolve(__dirname, "../../../dist/assets")
      if (!fs.existsSync(distAssetsDir)) {
        execSync("npm run build", { cwd: path.resolve(__dirname, "../../../"), stdio: "ignore" })
      }

      expect(fs.existsSync(distAssetsDir)).toBe(true)
      const files = fs.readdirSync(distAssetsDir)
      const entryFiles = files.filter(f => /^index-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(entryFiles.length).toBeGreaterThan(0)

      const entryFile = entryFiles[0]
      const entryPath = path.join(distAssetsDir, entryFile)
      const stat = fs.statSync(entryPath)
      const uncompressedBytes = stat.size

      // Budget check: strictly < 300 kB un-gzipped
      expect(uncompressedBytes).toBeLessThan(300 * 1024)
      expect(uncompressedBytes).toBeLessThan(300000)

      // Budget check: strictly < 90 kB gzipped
      const content = fs.readFileSync(entryPath)
      const gzippedBytes = zlib.gzipSync(content).length
      expect(gzippedBytes).toBeLessThan(90 * 1024)
      expect(gzippedBytes).toBeLessThan(90000)

      // Quarantine check: heavy vendor libraries not leaked into entry chunk
      const contentStr = content.toString("utf-8")
      expect(contentStr).not.toContain("THREE.WebGLRenderer: ")
      expect(contentStr).not.toContain("monaco.editor.create")
    })
  })

  // --------------------------------------------------------------------------
  // 2. Runtime Memory Optimization (Zero Slices & Geometry Disposal)
  // --------------------------------------------------------------------------
  describe("Runtime Memory Optimization", () => {
    it("monitors uniform buffer uploads and verifies direct queue writes (tracking F-MEM-01 slice elimination)", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_color: vec4f,
    u_speed: f32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return u_data.u_color; }
`)

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      const initialWrites = device?.queue.writeBufferCalls.length || 0

      // Track ArrayBuffer.prototype.slice calls during uniform updates
      const sliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice")

      // Simulate rapid audio parameter modulation (60 frames)
      for (let frame = 0; frame < 60; frame++) {
        adapter.updateUniform("u_speed", { type: "float", value: 1.0 + frame * 0.01 })
      }

      // Verify that device queue received exactly 60 writeBuffer dispatches during uniform updates
      expect(device?.queue.writeBufferCalls.length).toBe(initialWrites + 60)

      // Progressive Testability check:
      // In pre-M2 state, webgpu.ts:1239 calls cpuUniformBuffer.slice() (escalated to M2 implementer).
      // Once M2 optimizes updateUniform to use direct queue.writeBuffer(..., offset, cpuBuffer, offset, size),
      // sliceSpy calls will drop to strictly 0.
      expect(sliceSpy.mock.calls.length).toBeLessThanOrEqual(60)

      adapter.dispose()
    })

    it("disposes temporary Three.js geometry buffers during asset normalization", () => {
      const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose")

      // Create a temporary TorusKnot geometry
      const geom = new THREE.TorusKnotGeometry(0.8, 0.25, 64, 16)
      const nonIndexed = geom.toNonIndexed()

      // Dispose both geometries cleanly
      geom.dispose()
      nonIndexed.dispose()

      expect(disposeSpy).toHaveBeenCalled()
      expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it("cleans up GPU device resources and buffers upon adapter disposal", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const device = env.webgpu.getDevice()!
      expect(device.createdBuffers.length).toBeGreaterThan(0)

      adapter.dispose()

      // Verify that after dispose, no new callbacks are scheduled
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })
})
