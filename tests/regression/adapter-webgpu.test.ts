import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { computeUniformBufferLayout } from "@/core/uniformLayout"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { useProjectStore } from "@/stores/projectStore"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import defaultShader from "../../src/shaders/default.wgsl?raw"

// WebGPU shader compilation resolves via device error scope + getCompilationInfo (async): flush before asserting.
const flushGpu = () => new Promise<void>((r) => setTimeout(r, 0))

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe("WebGPUAdapter (fleet w3)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let adapter: WebGPUAdapter
  let a: any
  let device: any

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    adapter = new WebGPUAdapter()
    adapter.setExternalLoopDriven(true) // the coordinator is the only loop: drive frames by hand
    await adapter.mount(env.createCanvas() as any)
    a = adapter
    device = env.webgpu.getDevice()!
  })
  afterEach(() => {
    adapter.dispose()
    teardownE2ETestEnvironment()
  })

  const uniformWrites = () => device.queue.writeBufferCalls.filter((c: any) => c.buffer === a.uniformBuffer)
  const mvp = () => {
    const off = (a.uniformLayout.fields["mvp"] ?? a.uniformLayout.fields["u_mvp"]).offset
    return Array.from(new Float32Array(a.uniformBuffer.data.slice(off, off + 64).buffer))
  }

  it("never schedules its own rAF while externally driven", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame")
    adapter.renderFrame(16, 16)
    adapter.setExternalLoopDriven(true)
    expect(a.rafId).toBeNull()
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })

  describe("(a) steady-state frames are allocation-free and write the uniform block once", () => {
    it("no Float32Array constructed and exactly one uniform writeBuffer per frame", () => {
      adapter.renderFrame(16, 16) // warm-up (first-use lazies)
      const Orig = globalThis.Float32Array
      let constructed = 0
      globalThis.Float32Array = new Proxy(Orig, {
        construct(target, args, newTarget) { constructed++; return Reflect.construct(target, args, newTarget) },
      }) as any
      try {
        for (let i = 2; i < 12; i++) {
          const before = uniformWrites().length
          adapter.renderFrame(i * 16, 16)
          expect(uniformWrites().length - before).toBe(1)
        }
      } finally {
        globalThis.Float32Array = Orig
      }
      expect(constructed).toBe(0)
    })

    it("reports real draw-call and triangle counts to telemetry every frame", () => {
      const spy = vi.spyOn(performanceTelemetry, "reportFrameStats")
      adapter.renderFrame(32, 16)
      expect(spy).toHaveBeenCalledTimes(1)
      const stats = spy.mock.calls[0][0]
      expect(stats.drawCalls).toBeGreaterThanOrEqual(1)
      expect(stats.triangles).toBeGreaterThan(0)
      spy.mockRestore()
    })

    it("skips the audio texture upload when the spectrum did not change", () => {
      const write = vi.fn() // the shared mock queue has no writeTexture
      device.queue.writeTexture = write
      const uniforms = { bass: 0.1, mid: 0.2, treble: 0.3, level: 0.4, beat: 0 }
      const tex = new Uint8Array(1024).fill(7)
      adapter.updateAudioData(tex, uniforms)
      adapter.updateAudioData(tex, uniforms)
      adapter.updateAudioData(tex, uniforms)
      expect(write).toHaveBeenCalledTimes(1)
      tex[3] = 9
      adapter.updateAudioData(tex, uniforms)
      expect(write).toHaveBeenCalledTimes(2)
    })
  })

  describe("(b) compile errors keep the last good frame", () => {
    const broken = `${defaultShader}\n// BROKEN`

    beforeEach(() => {
      const create = device.createShaderModule.bind(device)
      device.pushErrorScope = vi.fn()
      device.popErrorScope = vi.fn(async () => null)
      device.createShaderModule = (d: any) => {
        const m = create(d)
        const bad = d.code.includes("BROKEN")
        m.getCompilationInfo = async () => ({
          messages: bad ? [{ type: "error", message: "unexpected token", lineNum: 7, linePos: 3 }] : [],
        })
        return m
      }
    })

    it("retains the previous pipeline/buffers, reports line:col, then recovers on a valid compile", async () => {
      const goodPipeline = a.pipeline
      const goodBuffer = a.uniformBuffer
      const goodBindGroup = a.bindGroup

      adapter.recompileShader(broken)
      expect(a.pipeline).toBe(goodPipeline) // nothing swapped before validation lands
      await flush()

      expect(a.pipeline).toBe(goodPipeline)
      expect(a.bindGroup).toBe(goodBindGroup)
      expect(a.uniformBuffer).toBe(goodBuffer)
      expect(goodBuffer.isDestroyed).toBe(false)
      const err = useProjectStore.getState().lastCompileError
      expect(err).toBeTruthy()
      expect(parseDiagnosticErrors(err)[0]).toMatchObject({ line: 7, column: 3, message: "unexpected token" })
      // the viewport still draws with the old pipeline
      const draws = () => device.queue.submittedCommands.length
      const n = draws()
      adapter.renderFrame(48, 16)
      expect(draws()).toBe(n + 1)
      expect(device.queue.submittedCommands.at(-1).renderPasses.at(-1).drawCalls[0].pipeline).toBe(goodPipeline)

      adapter.recompileShader(`${defaultShader}\n// fine`)
      await flush()
      expect(a.pipeline).not.toBe(goodPipeline)
      expect(goodBuffer.isDestroyed).toBe(true) // old block released only after the new shader validated
      expect(useProjectStore.getState().lastCompileError).toBeNull()
    })

    it("a stale (superseded) compile never overwrites the newer result", async () => {
      adapter.recompileShader(broken)
      adapter.recompileShader(`${defaultShader}\n// newest`)
      await flush()
      expect(useProjectStore.getState().lastCompileError).toBeNull()
      expect(a.currentShaderSource).toContain("newest")
    })

    it("a synchronous module failure also leaves the previous pipeline in place", () => {
      const goodPipeline = a.pipeline
      adapter.recompileShader("SYNTAX_ERROR_TRIGGER")
      expect(a.pipeline).toBe(goodPipeline)
      expect(useProjectStore.getState().lastCompileError).toContain("WGSL Parse error")
    })
  })

  describe("(c) paused frames do not step the simulation", () => {
    it("dispatches compute only when delta > 0", async () => {
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "compute", id: "c1", preset: "curl_noise", particleCount: 128 },
      ] as any)
      await flushGpu()
      expect(a.hasCompute).toBe(true)
      const dispatches = () => device.queue.submittedCommands.at(-1).computePasses.flatMap((p: any) => p.dispatches).length

      adapter.renderFrame(100, 16)
      expect(dispatches()).toBe(1)
      adapter.renderFrame(100, 0)
      expect(dispatches()).toBe(0)
      // particles are still drawn while paused
      expect(device.queue.submittedCommands.at(-1).renderPasses.flatMap((p: any) => p.drawCalls).length).toBeGreaterThan(0)
    })

    it("an empty queue resets the compute flag", () => {
      adapter.setRenderQueue([{ type: "compute", id: "c1", preset: "curl_noise", particleCount: 64 }] as any)
      expect(a.hasCompute).toBe(true)
      adapter.setRenderQueue([])
      expect(a.hasCompute).toBe(false)
      expect(a.hasPostProcess).toBe(false)
    })
  })

  describe("(d) resources leaving the graph are released", () => {
    it("destroys textures no longer in the render queue and keeps the ones still referenced", () => {
      const keep = device.createTexture({ size: [2, 2], format: "rgba8unorm", usage: 0 })
      const drop = device.createTexture({ size: [2, 2], format: "rgba8unorm", usage: 0 })
      a.textureResources.set("keep", keep)
      a.textureResources.set("drop", drop)
      adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }, { type: "texture", id: "keep", src: "k.png", binding: 1 }] as any)
      expect(drop.isDestroyed).toBe(true)
      expect(keep.isDestroyed).toBe(false)
      expect(a.textureResources.has("drop")).toBe(false)
      adapter.setRenderQueue([])
      expect(keep.isDestroyed).toBe(true)
    })

    it("rebuilds post-process pipelines only when the chain changes", () => {
      const chain = (amount: number) => [
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "p1", pass: "blur", uniforms: { amount } },
        { type: "postprocess", id: "p2", pass: "vignette", uniforms: {} },
      ] as any
      adapter.setRenderQueue(chain(2))
      const created = device.createdPipelines.length
      const firstPasses = [...a.postProcessPasses]
      adapter.setRenderQueue(chain(2))
      expect(device.createdPipelines.length).toBe(created)
      adapter.setRenderQueue(chain(5)) // value change: uniform rewrite, no rebuild
      expect(device.createdPipelines.length).toBe(created)
      expect(a.postProcessPasses[0]).toBe(firstPasses[0])
      const blurBuf = a.postProcessPasses[0].uniformBuffer
      expect(new Float32Array(blurBuf.data.slice(0, 16).buffer)[2]).toBe(5)
      adapter.setRenderQueue(chain(5).slice(0, 2)) // structure change: rebuild
      expect(device.createdPipelines.length).toBeGreaterThan(created)
    })

    it("refreshes the baked canvas-size uniforms of blur/fxaa on resize", () => {
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", id: "b", pass: "blur", uniforms: { amount: 3 } },
        { type: "postprocess", id: "f", pass: "fxaa", uniforms: {} },
      ] as any)
      adapter.resize(320, 200, 1)
      const read = (id: string) => new Float32Array(a.postProcessPasses.find((p: any) => p.id === id).uniformBuffer.data.slice(0, 16).buffer)
      expect(Array.from(read("b").slice(0, 3))).toEqual([320, 200, 3])
      expect(read("f")[0]).toBeCloseTo(1 / 320)
      expect(read("f")[1]).toBeCloseTo(1 / 200)
    })

    it("dispose destroys the device last", () => {
      const order: string[] = []
      const buf = a.uniformBuffer
      const bufDestroy = buf.destroy.bind(buf)
      buf.destroy = () => { order.push("buffer"); bufDestroy() }
      const devDestroy = device.destroy.bind(device)
      device.destroy = () => { order.push("device"); devDestroy() }
      adapter.dispose()
      expect(order[order.length - 1]).toBe("device")
      expect(order).toContain("buffer")
    })
  })

  describe("(e) animation is a function of playback time", () => {
    it("same time => same MVP (pause/seek deterministic); different time => different MVP", () => {
      adapter.renderFrame(1000, 16)
      const at1 = mvp()
      adapter.renderFrame(2500, 16)
      const at2 = mvp()
      adapter.renderFrame(1000, 0) // seek back, paused
      expect(mvp()).toEqual(at1)
      adapter.renderFrame(1000, 0) // repeated paused draws are static and cost no uniform write
      const before = uniformWrites().length
      adapter.renderFrame(1000, 0)
      expect(uniformWrites().length).toBe(before)
      expect(at2).not.toEqual(at1)
      expect(at1.every(Number.isFinite) && at1.some((v) => v !== 0)).toBe(true)
    })
  })

  describe("shadow pass", () => {
    it("encodes the depth-only shadow pass only when shadows are enabled", () => {
      adapter.updateShadowSettings({ enabled: false })
      adapter.renderFrame(16, 16)
      let labels = device.queue.submittedCommands.at(-1).renderPasses.map((p: any) => p.descriptor.label)
      expect(labels).not.toContain("ShadowDepthPass")

      adapter.updateShadowSettings({ enabled: true })
      adapter.renderFrame(32, 16)
      labels = device.queue.submittedCommands.at(-1).renderPasses.map((p: any) => p.descriptor.label)
      expect(labels).toContain("ShadowDepthPass")
    })
  })
})

describe("(f) wgslUniforms: integer vectors and arrays", () => {
  it("parses vec3<i32> / vec2u / vec4<u32> / vec3i spellings with the right types", () => {
    const src = `
      struct U {
        a: vec3<i32>,
        b: vec2u,
        c: vec4<u32>,
        d: vec3i,
        e: vec2<f32>,
      };
      @group(0) @binding(0) var<uniform> u: U;`
    const parsed = parseWgslUniforms(src)
    expect(Object.fromEntries(parsed.map((p) => [p.name, p.type]))).toEqual({
      a: "vec3i", b: "vec2u", c: "vec4u", d: "vec3i", e: "vec2f",
    })
    expect(parsed.every((p) => p.kind === "vector")).toBe(true)
    const layout = computeUniformBufferLayout(parsed)
    expect(layout.fields.a).toMatchObject({ type: "vec3i", offset: 0, size: 12 })
    expect(layout.fields.b).toMatchObject({ type: "vec2u", offset: 16 })
  })

  it("expands arrays of integer vectors, including standalone uniform vars", () => {
    const src = `
      struct U { ids: array<vec2<i32>, 3>, w: array<f32, 2> };
      @group(0) @binding(0) var<uniform> u: U;
      @group(0) @binding(1) var<uniform> extra: array<vec4<f32>, 2>;`
    const names = parseWgslUniforms(src).map((p) => `${p.name}:${p.type}`)
    expect(names).toEqual([
      "ids[0]:vec2i", "ids[1]:vec2i", "ids[2]:vec2i", "w[0]:f32", "w[1]:f32", "extra[0]:vec4f", "extra[1]:vec4f",
    ])
  })
})
