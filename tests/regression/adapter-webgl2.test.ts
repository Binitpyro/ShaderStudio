import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGL2Adapter } from "@/adapters/webgl2"
import { useProjectStore } from "@/stores/projectStore"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import type { RenderQueue } from "@/core/graphCompiler"

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe("WebGL2 adapter (fleet w3)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>
  let adapter: WebGL2Adapter
  let gl: any
  const a = () => adapter as any

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    adapter = new WebGL2Adapter()
    adapter.setExternalLoopDriven(true)
    await adapter.mount(env.createCanvas() as any)
    gl = env.webgl2.getLastContext()!
  })
  afterEach(() => {
    adapter.dispose()
    vi.unstubAllGlobals()
    teardownE2ETestEnvironment()
  })

  const stubTextureLoading = () => {
    useProjectStore.setState({ textureResources: [{ id: "t1", name: "t1", src: "blob:t1" }] })
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"]) })))
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close() {} })))
  }
  const textureQueue: RenderQueue = [
    { type: "mesh", geometry: "cube" },
    { type: "texture", id: "t1", src: "", binding: 0 },
    { type: "postprocess", id: "pp-v", pass: "vignette" },
    { type: "postprocess", id: "pp-b", pass: "bloom" },
  ]

  it("steady-state frames make zero getUniformLocation calls", () => {
    adapter.setRenderQueue(textureQueue)
    adapter.updateUniform("u_custom", { type: "float", value: 1 } as any)
    adapter.renderFrame(0, 16)
    adapter.renderFrame(16, 16)

    const spy = vi.spyOn(gl, "getUniformLocation")
    for (let i = 2; i < 12; i++) adapter.renderFrame(i * 16, 16)
    expect(spy).not.toHaveBeenCalled()
    expect(gl.drawCount).toBeGreaterThan(0)
  })

  it("reports real draw-call and triangle counts each frame", () => {
    const report = vi.spyOn(performanceTelemetry, "reportFrameStats")
    adapter.renderFrame(0, 16) // cube = 12 triangles, no post-process
    expect(report).toHaveBeenLastCalledWith({ drawCalls: 1, triangles: 12 })
  })

  it("a failing compile keeps the previous program and reports the error line", () => {
    adapter.recompileShader("#version 300 es\nvoid main(){}")
    const good = a().program
    expect(useProjectStore.getState().lastCompileError).toBeNull()

    vi.spyOn(gl, "getShaderInfoLog").mockImplementation((s: any) => (s.infoLog ? "ERROR: 0:7: 'x' : syntax error" : ""))
    adapter.recompileShader("SYNTAX_ERROR_TRIGGER")

    expect(a().program).toBe(good)
    expect(good.isDestroyed).toBe(false)
    const err = useProjectStore.getState().lastCompileError
    expect(parseDiagnosticErrors(err)[0]).toMatchObject({ line: 7 })
    gl.drawCount = 0
    adapter.renderFrame(0, 16)
    expect(gl.drawCount).toBeGreaterThan(0)

    adapter.recompileShader("#version 300 es\nvoid main(){ }") // success swaps and deletes the old program
    expect(a().program).not.toBe(good)
    expect(good.isDestroyed).toBe(true)
    expect(useProjectStore.getState().lastCompileError).toBeNull()
  })

  it("dispose releases the context via WEBGL_lose_context", () => {
    const loseContext = vi.fn()
    vi.spyOn(gl, "getExtension").mockImplementation((n: string) => (n === "WEBGL_lose_context" ? { loseContext } : {}))
    adapter.dispose()
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it("context lost + restored rebuilds the user program, queue and textures, then renders", async () => {
    stubTextureLoading()
    adapter.recompileShader("#version 300 es\nprecision highp float; // user\nvoid main(){}")
    adapter.setRenderQueue(textureQueue)
    await flush()
    expect(a().loadedTextures.has("t1")).toBe(true)
    expect(a().postProcessPasses).toHaveLength(2)

    gl.simulateContextLost()
    expect(a().loadedTextures.size).toBe(0)
    expect(a().postProcessPasses).toHaveLength(0)
    gl.simulateContextRestored()
    await flush()

    expect(a().program.shaders[1].source).toContain("// user")
    expect(a().postProcessPasses).toHaveLength(2)
    expect(a().postProcessFramebuffers).toHaveLength(2)
    expect(a().loadedTextures.has("t1")).toBe(true)
    gl.drawCount = 0
    adapter.renderFrame(0, 16)
    expect(gl.drawCount).toBeGreaterThanOrEqual(3) // mesh + 2 post passes
  })

  it("textures removed from the queue are deleted", async () => {
    stubTextureLoading()
    adapter.setRenderQueue(textureQueue)
    await flush()
    const tex = a().loadedTextures.get("t1")
    expect(tex).toBeDefined()

    adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
    expect(a().loadedTextures.has("t1")).toBe(false)
    expect(tex.isDestroyed).toBe(true)
  })

  it("post-process programs are rebuilt only when the chain changes", () => {
    adapter.setRenderQueue(textureQueue)
    const before = gl.createdPrograms.length
    adapter.setRenderQueue(textureQueue)
    expect(gl.createdPrograms.length).toBe(before)
    adapter.setRenderQueue(null)
    expect(a().hasPostProcess).toBe(false)
    expect(a().postProcessPasses).toHaveLength(0)
  })

  it("mesh rotation is a pure function of the time passed to renderFrame", () => {
    const mvp = () => Array.from<number>(gl.uniformValues.get("u_mvp"))
    adapter.renderFrame(1000, 16); const at1s = mvp()
    adapter.renderFrame(5000, 16); const at5s = mvp()
    adapter.renderFrame(1000, 16)
    expect(mvp()).toEqual(at1s)
    expect(at5s).not.toEqual(at1s)
    adapter.renderFrame(1000, 0) // delta is irrelevant
    expect(mvp()).toEqual(at1s)
  })
})
