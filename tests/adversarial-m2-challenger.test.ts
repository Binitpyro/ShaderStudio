import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import * as THREE from "three"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { ThreeJSAdapter } from "@/adapters/threejs"
import { RenderCoordinator } from "@/core/renderCoordinator"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("./e2e/mocks/mockThreeJS")
  return {
    ...actual,
    WebGLRenderer: MockThreeRenderer,
  }
})

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
  // Section 1: Production Bundle Architecture & Manual Chunks Verification
  // ==========================================================================
  describe("Adversarial Bundle Chunking & Budget Verification", () => {
    const distAssetsDir = path.resolve(__dirname, "../dist/assets")

    it("verifies production build output directory dist/assets exists and contains required chunks", () => {
      expect(fs.existsSync(distAssetsDir)).toBe(true)
      const files = fs.readdirSync(distAssetsDir)
      expect(files.length).toBeGreaterThan(0)
    })

    it("verifies entry chunk index-*.js is strictly under 300 kB un-gzipped and under 90 kB gzipped", () => {
      const files = fs.readdirSync(distAssetsDir)
      const entryFiles = files.filter(f => /^index-[A-Za-z0-9_-]+\.js$/.test(f))
      expect(entryFiles.length).toBe(1)

      const entryFile = entryFiles[0]
      const entryPath = path.join(distAssetsDir, entryFile)
      const stat = fs.statSync(entryPath)
      const uncompressedBytes = stat.size

      // Strict limit: 300 kB (307,200 bytes)
      expect(uncompressedBytes).toBeLessThan(300 * 1024)
      // Even under strict decimal 300,000 bytes
      expect(uncompressedBytes).toBeLessThan(300000)

      // Gzipped check: < 90 kB (92,160 bytes)
      const content = fs.readFileSync(entryPath)
      const gzippedBytes = zlib.gzipSync(content).length
      expect(gzippedBytes).toBeLessThan(90 * 1024)
    })

    it("verifies vendor-monaco, vendor-three, vendor-reactflow, vendor-radix, and vendor exist as separate chunks", () => {
      const files = fs.readdirSync(distAssetsDir)

      const hasVendorMonaco = files.some(f => /^vendor-monaco-.*\.js$/.test(f))
      const hasVendorThree = files.some(f => /^vendor-three-.*\.js$/.test(f))
      const hasVendorReactFlow = files.some(f => /^vendor-reactflow-.*\.js$/.test(f))
      const hasVendorRadix = files.some(f => /^vendor-radix-.*\.js$/.test(f))
      const hasVendorShared = files.some(f => /^vendor-[A-Za-z0-9_-]+\.js$/.test(f) && !f.includes("vendor-monaco") && !f.includes("vendor-three") && !f.includes("vendor-reactflow") && !f.includes("vendor-radix"))

      expect(hasVendorMonaco).toBe(true)
      expect(hasVendorThree).toBe(true)
      expect(hasVendorReactFlow).toBe(true)
      expect(hasVendorRadix).toBe(true)
      expect(hasVendorShared).toBe(true)

      // Verify code-split modal chunks exist as well
      const hasCopilot = files.some(f => /^AICopilotDrawer-.*\.js$/.test(f))
      const hasExport = files.some(f => /^ExportModal-.*\.js$/.test(f))
      const hasTemplates = files.some(f => /^TemplatesModal-.*\.js$/.test(f))
      expect(hasCopilot).toBe(true)
      expect(hasExport).toBe(true)
      expect(hasTemplates).toBe(true)
    })

    it("verifies Three.js and Monaco code are quarantined from the index entry chunk", () => {
      const files = fs.readdirSync(distAssetsDir)
      const entryFile = files.find(f => /^index-[A-Za-z0-9_-]+\.js$/.test(f))!
      const content = fs.readFileSync(path.join(distAssetsDir, entryFile), "utf-8")

      // Three.js build marker should not be in the index chunk
      expect(content).not.toContain("THREE.WebGLRenderer: ")
      // Monaco standalone editor markers should not be in the index chunk
      expect(content).not.toContain("monaco.editor.create")
    })
  })

  // ==========================================================================
  // Section 2: High-Frequency WebGPU updateUniform & Zero Allocation Stress Test
  // ==========================================================================
  describe("WebGPU updateUniform High-Frequency & Zero-Allocation Stress Test", () => {
    it("executes 10,000 rapid uniform updates with strictly 0 ArrayBuffer/TypedArray slice allocations", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_time: f32,
    u_speed: f32,
    u_resolution: vec2f,
    u_color: vec4f,
    u_matrix: mat4x4f,
    u_count: u32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return u_data.u_color; }
`)

      const device = env.webgpu.getDevice()
      expect(device).not.toBeNull()

      // Track slice calls on ArrayBuffer and TypedArrays
      const arrayBufferSliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice")
      const uint8SliceSpy = vi.spyOn(Uint8Array.prototype, "slice")
      const float32SliceSpy = vi.spyOn(Float32Array.prototype, "slice")

      const initialWrites = device!.queue.writeBufferCalls.length

      // 10,000 high-frequency mixed uniform updates
      const ITERATIONS = 10000
      for (let i = 0; i < ITERATIONS; i++) {
        const mod = i % 5
        if (mod === 0) {
          adapter.updateUniform("u_time", { type: "float", value: i * 0.016 })
        } else if (mod === 1) {
          adapter.updateUniform("u_speed", { type: "float", value: 1.0 + (i % 10) })
        } else if (mod === 2) {
          adapter.updateUniform("u_resolution", { type: "vec2", value: [1920, 1080] })
        } else if (mod === 3) {
          adapter.updateUniform("u_color", { type: "color", value: [1.0, 0.5, 0.25, 1.0] })
        } else {
          adapter.updateUniform("u_count", { type: "uint", value: i })
        }
      }

      // Assert ABSOLUTELY ZERO slice calls
      expect(arrayBufferSliceSpy).not.toHaveBeenCalled()
      expect(uint8SliceSpy).not.toHaveBeenCalled()
      expect(float32SliceSpy).not.toHaveBeenCalled()

      // Verify device queue received exactly 10,000 writeBuffer dispatches
      expect(device!.queue.writeBufferCalls.length).toBe(initialWrites + ITERATIONS)

      // Verify the last write for u_count wrote correct data
      const lastWrite = device!.queue.writeBufferCalls[device!.queue.writeBufferCalls.length - 1]
      expect(lastWrite.byteLength).toBe(4)

      adapter.dispose()
    })

    it("verifies uniform updates write exact float and color bit patterns into GPU buffer without distortion", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_tint: vec4f,
    u_aspect: f32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return u_data.u_tint; }
`)

      const device = env.webgpu.getDevice()!
      adapter.updateUniform("u_tint", { type: "vec4", value: [0.125, 0.25, 0.5, 1.0] })
      adapter.updateUniform("u_aspect", { type: "float", value: 1.777 })

      const uniformBuffer = (adapter as any).uniformBuffer
      expect(uniformBuffer).toBeDefined()
      const gpuData = new Float32Array(uniformBuffer.data.buffer)

      // u_tint is vec4f at offset 0
      expect(gpuData[0]).toBeCloseTo(0.125)
      expect(gpuData[1]).toBeCloseTo(0.25)
      expect(gpuData[2]).toBeCloseTo(0.5)
      expect(gpuData[3]).toBeCloseTo(1.0)

      // u_aspect is f32 at offset 16 (index 4)
      expect(gpuData[4]).toBeCloseTo(1.777)

      adapter.dispose()
    })

    it("resiliently handles invalid uniform names, null values, and disposed adapter without crashing", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      adapter.recompileShader(`
struct Uniforms {
    u_val: f32,
};
@group(0) @binding(0) var<uniform> u_data: Uniforms;
@fragment fn fs() -> @location(0) vec4f { return vec4f(u_data.u_val); }
`)

      // Unknown uniform: should safely no-op
      expect(() => {
        adapter.updateUniform("u_nonexistent", { type: "float", value: 42 })
      }).not.toThrow()

      // Null/undefined values
      expect(() => {
        adapter.updateUniform("u_val", { type: "float", value: null as any })
      }).not.toThrow()

      // After dispose
      adapter.dispose()
      expect(() => {
        adapter.updateUniform("u_val", { type: "float", value: 10 })
      }).not.toThrow()
    })
  })

  // ==========================================================================
  // Section 3: TorusKnot / Geometry Creation & Disposal Cycles Across Adapters
  // ==========================================================================
  describe("Geometry Creation & Disposal Cycles Across Adapters", () => {
    it("WebGPU: caches TorusKnot vertices and cleans up temporary Three.js geometries", async () => {
      const adapter = new WebGPUAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      // Spying on TorusKnotGeometry to ensure zero allocations during repeated switches
      const torusKnotSpy = vi.spyOn(THREE, "TorusKnotGeometry")

      // Queue 200 cycles of mesh geometry switches
      for (let i = 0; i < 200; i++) {
        const geom = i % 2 === 0 ? "torus_knot" : "cube"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Torus knot geometry caching ensures we don't recreate or leak Three.js geometry objects
      expect(torusKnotSpy).not.toHaveBeenCalled()

      // After adapter disposal, vertex buffers are destroyed cleanly
      adapter.dispose()
      expect((adapter as any).vertexBuffers.size).toBe(0)
    })

    it("WebGL2: cycles through geometries and cleans up WebGL buffers without leaks", async () => {
      const adapter = new WebGL2Adapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const gl = env.webgl2.getLastContext()!
      const deleteBufferSpy = vi.spyOn(gl, "deleteBuffer")
      const deleteProgramSpy = vi.spyOn(gl, "deleteProgram")

      // Rapidly switch geometries 100 times
      for (let i = 0; i < 100; i++) {
        const geom = i % 4 === 0 ? "torus_knot" : i % 4 === 1 ? "sphere" : i % 4 === 2 ? "cube" : "plane"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Clean dispose
      adapter.dispose()

      expect(deleteBufferSpy).toHaveBeenCalled()
      expect(deleteProgramSpy).toHaveBeenCalled()
      expect((adapter as any).initialized).toBe(false)
      expect((adapter as any).gl).toBeNull()
    })

    it("Three.js: caches buffer geometries, prevents redundant mesh rebuilds, and disposes on teardown", async () => {
      const adapter = new ThreeJSAdapter()
      const canvas = env.createCanvas()
      await adapter.mount(canvas as any)

      const geomDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose")
      const matDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose")

      // Switch geometries 200 times
      for (let i = 0; i < 200; i++) {
        const geom = i % 4 === 0 ? "torus_knot" : i % 4 === 1 ? "sphere" : i % 4 === 2 ? "cube" : "plane"
        adapter.setRenderQueue([{ type: "mesh", geometry: geom as any }])
      }

      // Geometries should be cached in geometryCache (at most 4 cached geometries)
      const cache = (adapter as any).geometryCache as Map<string, THREE.BufferGeometry>
      expect(cache.size).toBeLessThanOrEqual(4)

      // Repeating the same geometry does not rebuild the mesh or re-allocate
      const meshBefore = (adapter as any).mesh
      adapter.setRenderQueue([{ type: "mesh", geometry: "plane" }])
      const meshAfter = (adapter as any).mesh
      expect(meshAfter).toBe(meshBefore)

      // On dispose, all cached geometries and materials are disposed
      adapter.dispose()

      expect(geomDisposeSpy).toHaveBeenCalled()
      expect(matDisposeSpy).toHaveBeenCalled()
      expect((adapter as any).geometryCache.size).toBe(0)
      expect((adapter as any).mesh).toBeNull()
      expect((adapter as any).scene).toBeNull()
      expect((adapter as any).renderer).toBeNull()
    })
  })

  // ==========================================================================
  // Section 4: RenderCoordinator 5-Phase Loop & Lifecycle Robustness
  // ==========================================================================
  describe("RenderCoordinator Adversarial Verification", () => {
    it("enforces strict 5-phase execution order on every frame tick", () => {
      const coordinator = new RenderCoordinator()
      coordinator.clearLog()

      coordinator.tick(100.0)

      const phases = coordinator.getLastFramePhases()
      expect(phases).toEqual(["clock", "audio", "modulation", "draw", "telemetry"])
    })

    it("manages pre-render hooks registration, execution, and unregistration under high churn", () => {
      const coordinator = new RenderCoordinator()
      const hookCalls: string[] = []

      for (let i = 0; i < 50; i++) {
        coordinator.registerPreRenderHook(`hook-${i}`, () => {
          hookCalls.push(`hook-${i}`)
        })
      }

      coordinator.tick(16.6)
      expect(hookCalls.length).toBe(50)

      // Unregister 25 hooks
      for (let i = 0; i < 25; i++) {
        coordinator.unregisterPreRenderHook(`hook-${i}`)
      }
      hookCalls.length = 0

      coordinator.tick(33.3)
      expect(hookCalls.length).toBe(25)
      expect(hookCalls[0]).toBe("hook-25")
    })

    it("switches activeAdapter seamlessly and updates setExternalLoopDriven state", () => {
      const coordinator = new RenderCoordinator()

      let adapter1Driven = false
      let adapter1RenderCalls = 0
      const mockAdapter1 = {
        renderFrame: () => { adapter1RenderCalls++ },
        setExternalLoopDriven: (v: boolean) => { adapter1Driven = v },
        dispose: () => {},
      }

      let adapter2Driven = false
      let adapter2RenderCalls = 0
      const mockAdapter2 = {
        renderFrame: () => { adapter2RenderCalls++ },
        setExternalLoopDriven: (v: boolean) => { adapter2Driven = v },
        dispose: () => {},
      }

      // Activate adapter 1
      coordinator.setActiveAdapter(mockAdapter1 as any)
      expect(adapter1Driven).toBe(true)

      coordinator.tick(16.6)
      expect(adapter1RenderCalls).toBe(1)
      expect(adapter2RenderCalls).toBe(0)

      // Switch to adapter 2
      coordinator.setActiveAdapter(mockAdapter2 as any)
      expect(adapter1Driven).toBe(false)
      expect(adapter2Driven).toBe(true)

      coordinator.tick(33.2)
      expect(adapter1RenderCalls).toBe(1)
      expect(adapter2RenderCalls).toBe(1)

      // Detach adapter
      coordinator.setActiveAdapter(null)
      expect(adapter2Driven).toBe(false)
      expect(coordinator.getActiveAdapter()).toBeNull()

      // Ticking with null adapter does not crash
      expect(() => coordinator.tick(49.8)).not.toThrow()
    })

    it("survives rapid start and stop toggling without leaving orphaned rAF timers", () => {
      const coordinator = new RenderCoordinator()

      for (let i = 0; i < 100; i++) {
        coordinator.start()
        expect(coordinator.getIsRunning()).toBe(true)
        coordinator.stop()
        expect(coordinator.getIsRunning()).toBe(false)
      }

      expect(env.clock.activeCallbackCount).toBe(0)
    })
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
