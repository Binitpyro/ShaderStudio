// @vitest-environment happy-dom
import "../setup/rtl"
/**
 * Real per-node GPU previews (fleet w6): the partial-graph compile (compileNodePreview) and the NodePreviewViewport that
 * requests renderToTarget for it. The adapter is a fake: what is asserted is WHAT is requested and HOW OFTEN.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest"
import React from "react"
import { render, screen, act, fireEvent } from "@testing-library/react"
import type { Node, Edge } from "@xyflow/react"

type PreviewReq = { width: number; height: number; uniforms: Record<string, unknown>; textures?: Array<{ name: string; textureId: string; version?: string }> }
type FakeAdapter = { backendType: string; renderToTarget: Mock<(req: PreviewReq) => Promise<unknown>> }
const h = vi.hoisted(() => ({ adapter: null as unknown as FakeAdapter }))
vi.mock("@/adapters/activeAdapter", () => ({ getActiveAdapter: () => h.adapter, loadAdapter: vi.fn() }))

import type { GraphNodeData } from "@/core/graphCompiler"
import { compileNodePreview } from "@/core/nodePreviewCompiler"
import { DEFAULT_PRIMITIVE_PARAMS } from "@/core/sdf/sdfPrimitives"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { NodePreviewViewport, PREVIEW_MAX_HZ } from "@/components/inspector/NodePreviewViewport"
import { renderCoordinator } from "@/core/renderCoordinator"
import { TEXTURE_LOADING } from "@/adapters/types"
import { useProjectStore } from "@/stores/projectStore"

type N = Node<GraphNodeData>
const node = (id: string, data: Record<string, unknown>): N => ({ id, position: { x: 0, y: 0 }, data: data as GraphNodeData })
const edge = (source: string, target: string, targetHandle?: string): Edge => ({ id: `${source}-${target}`, source, target, targetHandle })

const MATH = node("m1", { type: "math_expression", expression: "sin(uv.x * 10.0) * 0.5 + 0.5", outputType: "float", inputNames: [] })
const UNIFORM = node("u1", { type: "uniform", uniformId: "uid", name: "gain", uniformType: "float", defaultValue: 0.5 })
const MATH_IN = node("m2", { type: "math_expression", expression: "a * uv.x", outputType: "float", inputNames: ["a"] })

describe("compileNodePreview (partial-graph compile)", () => {
  it("compiles a math node to WGSL and GLSL that evaluate its expression over the quad", () => {
    const r = compileNodePreview("m1", [MATH], [])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.source.glsl).toContain("sin(uv.x * 10.0) * 0.5 + 0.5")
    expect(r.source.glsl).toContain("in vec2 v_uv;")
    expect(r.source.glsl).toContain("fragColor = vec4(n_m1, n_m1, n_m1, 1.0);")
    expect(r.source.wgsl).toContain("n_m1 = sin(uv.x * 10.0) * 0.5 + 0.5;")
    expect(r.source.wgsl).toContain("@fragment fn fragment_main")
    // the WebGPU preview picks the fullscreen-quad pipeline for this vertex stage
    expect(r.source.wgsl).toMatch(/vec4f\(\s*\w+\.position\.xy\s*,/)
    expect(r.source.wgsl).not.toMatch(/vertex_index/)
  })

  it("is deterministic: identical graphs give byte-identical sources (cache key stable)", () => {
    const nodes = [UNIFORM, MATH_IN]
    const edges = [edge("u1", "m2", "a")]
    expect(compileNodePreview("m2", nodes, edges)).toEqual(compileNodePreview("m2", [...nodes], [...edges]))
    expect(compileNodePreview("m1", [MATH], [])).toEqual(compileNodePreview("m1", [{ ...MATH }], []))
  })

  it("feeds upstream uniform values into math inputs as shader uniforms (values are never baked into the source)", () => {
    const r = compileNodePreview("m2", [UNIFORM, MATH_IN], [edge("u1", "m2", "a")])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.uniforms).toEqual([{ field: "pu_gain", sourceName: "gain", type: "float", defaultValue: 0.5 }])
    expect(r.source.glsl).toContain("uniform float pu_gain;")
    expect(r.source.glsl).toContain("float a = pu_gain;")
    expect(r.source.wgsl).toContain("pu_gain: f32,")
    expect(r.source.wgsl).toContain("let a: f32 = uniforms.pu_gain;")
    expect(r.source.glsl).not.toContain("0.5;") // default value stays out of the text

    const changed = compileNodePreview("m2", [{ ...UNIFORM, data: { ...UNIFORM.data, defaultValue: 0.9 } as GraphNodeData }, MATH_IN], [edge("u1", "m2", "a")])
    if (changed.status !== "ok") throw new Error("expected ok")
    expect(changed.source).toEqual(r.source)
  })

  it("declared uniforms are visible to the project's own uniform parsers (layout the adapters build)", () => {
    const r = compileNodePreview("m2", [UNIFORM, MATH_IN], [edge("u1", "m2", "a")])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(parseWgslUniforms(r.source.wgsl).map((u) => u.name)).toEqual(expect.arrayContaining(["time", "pu_gain"]))
    expect(parseGlslUniforms(r.source.glsl).map((u) => u.name)).toEqual(expect.arrayContaining(["u_time", "pu_gain"]))
  })

  it("previews uniform nodes (colour, bool as float), time nodes, and follows an output node to what feeds it", () => {
    const color = compileNodePreview("c", [node("c", { type: "uniform", uniformId: "c", name: "tint", uniformType: "color", defaultValue: [1, 0, 0] })], [])
    if (color.status !== "ok") throw new Error("expected ok")
    expect(color.uniforms[0]).toMatchObject({ field: "pu_tint", type: "vec3", defaultValue: [1, 0, 0] })
    expect(color.source.glsl).toContain("fragColor = vec4(pu_tint, 1.0);")

    const flag = compileNodePreview("f", [node("f", { type: "uniform", uniformId: "f", name: "on", uniformType: "bool", defaultValue: true })], [])
    if (flag.status !== "ok") throw new Error("expected ok")
    expect(flag.uniforms[0]).toMatchObject({ type: "float", defaultValue: 1, bool: true })

    const time = compileNodePreview("t", [node("t", { type: "time" })], [])
    if (time.status !== "ok") throw new Error("expected ok")
    expect(time.source.wgsl).toContain("fract(time)")

    const viaOutput = compileNodePreview("out", [MATH, node("out", { type: "output" })], [edge("m1", "out")])
    expect(viaOutput).toEqual(compileNodePreview("m1", [MATH], []))
  })

  it("previews SDF primitives/operators and raymarch nodes with their current values as uniforms", () => {
    const prim = node("s1", { type: "sdf_primitive", primitiveType: "sphere", params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, radius: 1.25 } })
    const r = compileNodePreview("s1", [prim], [])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.source.glsl).toContain("float map(vec3 p)")
    expect(r.source.wgsl).toContain("fn map(p: vec3f)")
    expect(r.uniforms.length).toBeGreaterThan(0)
    expect(r.uniforms.some((u) => u.field.startsWith("u_sdf_s1_") && u.defaultValue === 1.25)).toBe(true)
    // value changes do not change the source (pipeline cache hit), only the uniform values
    const moved = compileNodePreview("s1", [{ ...prim, data: { ...prim.data, params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, radius: 0.5 } } as GraphNodeData }], [])
    if (moved.status !== "ok") throw new Error("expected ok")
    expect(moved.source).toEqual(r.source)

    const rm = compileNodePreview("rm", [prim, node("rm", { type: "raymarch" })], [edge("s1", "rm")])
    expect(rm.status).toBe("ok")
  })

  it("previews a texture node as its sampled image: WGSL texture+sampler bindings and a GLSL sampler2D", () => {
    const tex = node("t1", { type: "texture", textureId: "tex-a", name: "albedo" })
    const r = compileNodePreview("t1", [tex], [])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.textures).toEqual([{ name: "ptex_tex_a", textureId: "tex-a" }])
    expect(compileNodePreview("t1", [tex], [], { textureSrc: () => "blob:v1" })).toMatchObject({ status: "ok", textures: [{ name: "ptex_tex_a", textureId: "tex-a", version: "blob:v1" }] })
    expect(compileNodePreview("t1", [tex], [], { textureSrc: () => undefined })).toMatchObject({ status: "error", error: expect.stringContaining("Texture not found") })
    expect(r.source.glsl).toContain("uniform sampler2D ptex_tex_a;")
    expect(r.source.glsl).toContain("vec4 n_t1 = texture(ptex_tex_a, uv);")
    expect(r.source.glsl).toContain("fragColor = n_t1;")
    expect(r.source.glslThree).toContain("uniform sampler2D ptex_tex_a;")
    // sampler at binding 1, textures from binding 2: the layout the adapters bind by variable name
    expect(r.source.wgsl).toContain("@group(0) @binding(1) var ptex_sampler: sampler;")
    expect(r.source.wgsl).toContain("@group(0) @binding(2) var ptex_tex_a: texture_2d<f32>;")
    expect(r.source.wgsl).toContain("textureSampleLevel(ptex_tex_a, ptex_sampler, uv, 0.0)")
    expect(r.source.wgsl).toContain("return n_t1;")
    // deterministic, and the texture list is part of the (stable) result
    expect(compileNodePreview("t1", [{ ...tex }], [])).toEqual(r)
    // an unassigned texture node has nothing to show
    expect(compileNodePreview("t0", [node("t0", { type: "texture", textureId: null, name: "x" })], [])).toEqual({ status: "none" })
  })

  it("previews nodes downstream of a texture (math on a texture sample) with the texture bound", () => {
    const tex = node("t1", { type: "texture", textureId: "tex-a", name: "albedo" })
    const m = node("m3", { type: "math_expression", expression: "c * 0.5", outputType: "vec4", inputNames: ["c"] })
    const r = compileNodePreview("m3", [tex, m], [edge("t1", "m3", "c")])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.textures).toEqual([{ name: "ptex_tex_a", textureId: "tex-a" }])
    expect(r.source.glsl).toContain("vec4 c = n_t1;")
    expect(r.source.wgsl).toContain("let c: vec4f = n_t1;")
  })

  it("three-js GLSL drops the declarations the ShaderMaterial prefix owns and reads uv from gl_FragCoord", () => {
    const r = compileNodePreview("m1", [MATH], [])
    if (r.status !== "ok") throw new Error("expected ok")
    expect(r.source.glslThree).not.toMatch(/^in vec2 v_uv;/m)
    expect(r.source.glslThree).not.toMatch(/^out vec4 fragColor;/m)
    expect(r.source.glslThree).toContain("gl_FragColor =")
    expect(r.source.glslThree).toContain("#define v_uv (gl_FragCoord.xy / u_resolution)")
    expect(r.source.glslThree).toContain("#version 300 es") // flags GLSL3 for the preview material
  })

  it("material nodes preview the project's shader; nodes without visual output are 'none'", () => {
    const mat = node("mat", { type: "material", shaderPath: "x.wgsl" })
    expect(compileNodePreview("mat", [mat], [], { material: { wgsl: "W", glsl: "G" } })).toEqual({ status: "ok", source: { wgsl: "W", glsl: "G", glslThree: "G" }, uniforms: [] })
    expect(compileNodePreview("mat", [mat], [])).toMatchObject({ status: "error" })
    for (const data of [{ type: "mesh", geometry: "cube" }, { type: "compute" }, { type: "audio" }, { type: "texture", textureId: null, name: "t" }, { type: "postprocess" }, { type: "comment", text: "x" }, { type: "frame", label: "f" }]) {
      expect(compileNodePreview("n", [node("n", data)], [])).toEqual({ status: "none" })
    }
    expect(compileNodePreview("missing", [], [])).toEqual({ status: "none" })
  })

  it("reports invalid expressions and cycles as errors instead of throwing", () => {
    expect(compileNodePreview("e", [node("e", { type: "math_expression", expression: "sin(", inputNames: [] })], [])).toMatchObject({ status: "error" })
    const a = node("a", { type: "math_expression", expression: "p", inputNames: ["p"] })
    const b = node("b", { type: "math_expression", expression: "q", inputNames: ["q"] })
    const r = compileNodePreview("a", [a, b], [edge("b", "a", "p"), edge("a", "b", "q")])
    expect(r).toMatchObject({ status: "error" })
    expect((r as { error: string }).error).toMatch(/Cycle/)
  })
})

// ------------------------------------------------------------------------------------------------
// Component
// ------------------------------------------------------------------------------------------------
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

function fakeAdapter(impl?: (req: PreviewReq) => Promise<unknown>): FakeAdapter {
  return {
    backendType: "webgpu",
    renderToTarget: vi.fn(impl ?? (async (req: PreviewReq) => ({ width: req.width, height: req.height, data: new Uint8ClampedArray(req.width * req.height * 4).fill(200) }))),
  }
}

let nowMs = 0
let hooks: Map<string, (t: number, d: number) => void>
let playing: ReturnType<typeof vi.spyOn>
let putImageData: ReturnType<typeof vi.fn>
let raf: ReturnType<typeof vi.fn>

beforeEach(() => {
  nowMs = 1000
  vi.spyOn(performance, "now").mockImplementation(() => nowMs)
  hooks = new Map()
  vi.spyOn(renderCoordinator, "registerPreRenderHook").mockImplementation((id, fn) => void hooks.set(id, fn as never))
  vi.spyOn(renderCoordinator, "unregisterPreRenderHook").mockImplementation((id) => void hooks.delete(id))
  playing = vi.spyOn(renderCoordinator, "getIsPlaying").mockReturnValue(true)
  vi.spyOn(renderCoordinator, "getPlaybackTime").mockReturnValue(3.5)
  raf = vi.fn()
  vi.stubGlobal("requestAnimationFrame", raf)
  putImageData = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    putImageData, drawImage: vi.fn(), getImageData: vi.fn(), createImageData: (w: number, hh: number) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) }),
  })) as never)
  h.adapter = fakeAdapter()
  useProjectStore.setState({ _graphNodes: [], _graphEdges: [], uniformValues: {}, wgslSource: "// wgsl", glslSource: "// glsl", activeBackend: "webgpu" })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  h.adapter = null as unknown as FakeAdapter
})

/** Runs `frames` coordinator frames of `stepMs` each, letting promises settle between frames. */
async function runFrames(frames: number, stepMs = 5) {
  const hook = [...hooks.values()][0]
  for (let i = 0; i < frames; i++) {
    nowMs += stepMs
    hook(nowMs, stepMs)
    await flush()
  }
}

describe("NodePreviewViewport (real GPU preview)", () => {
  it("requests the node's partial shader once on selection at 160px and draws the returned pixels", async () => {
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
    const req = h.adapter.renderToTarget.mock.calls[0][0]
    expect(req).toMatchObject({ nodeId: "m1", width: 160, height: 160 })
    expect(req.source.wgsl).toContain("sin(uv.x * 10.0) * 0.5 + 0.5")
    expect(req.uniforms.time).toEqual({ type: "float", value: 3.5 })
    expect(putImageData).toHaveBeenCalled()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("ok")
    expect(screen.getByText("160×160")).toBeTruthy()
    expect(raf).not.toHaveBeenCalled()
  })

  it("renders at devicePixelRatio but never beyond 2x", async () => {
    vi.stubGlobal("devicePixelRatio", 3)
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(h.adapter.renderToTarget.mock.calls[0][0]).toMatchObject({ width: 320, height: 320 })
  })

  it("sends current store uniform values (and node defaults when the store has none)", async () => {
    useProjectStore.setState({ _graphNodes: [UNIFORM, MATH_IN], _graphEdges: [edge("u1", "m2", "a")], uniformValues: { gain: { type: "float", value: 0.8 } } })
    const { unmount } = render(<NodePreviewViewport node={MATH_IN} />)
    await flush()
    expect(h.adapter.renderToTarget.mock.calls[0][0].uniforms.pu_gain).toEqual({ type: "float", value: 0.8 })
    unmount()

    useProjectStore.setState({ uniformValues: {} })
    h.adapter.renderToTarget.mockClear()
    render(<NodePreviewViewport node={MATH_IN} />)
    await flush()
    expect(h.adapter.renderToTarget.mock.calls[0][0].uniforms.pu_gain).toEqual({ type: "float", value: 0.5 })
  })

  it("picks the GLSL variant for the active backend (three.js gets the prefix-safe fragment)", async () => {
    h.adapter = { ...fakeAdapter(), backendType: "threejs" }
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    const src = h.adapter.renderToTarget.mock.calls[0][0].source
    expect(Object.keys(src)).toEqual(["glsl"])
    expect(src.glsl).toContain("gl_FragColor")
  })

  it("sends the texture binding (name, id, version = resource src) with the request and caches by it", async () => {
    const tex = node("t1", { type: "texture", textureId: "tex-a", name: "albedo" })
    useProjectStore.setState({ textureResources: [{ id: "tex-a", name: "albedo", src: "blob:a-v1" }] })
    render(<NodePreviewViewport node={tex} />)
    await flush()
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
    expect(h.adapter.renderToTarget.mock.calls[0][0].textures).toEqual([{ name: "ptex_tex_a", textureId: "tex-a", version: "blob:a-v1" }])
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("ok")
    // same texture version: a "change" that would render the same image is skipped
    act(() => { useProjectStore.setState({ glslSource: "// glsl 2" }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
  })

  it("shows 'Loading texture…' (not an error) while the adapter is still uploading, then the image", async () => {
    vi.useFakeTimers()
    const tex = node("t1", { type: "texture", textureId: "tex-a", name: "albedo" })
    useProjectStore.setState({ textureResources: [{ id: "tex-a", name: "albedo", src: "blob:a-v1" }] })
    let ready = false
    h.adapter = fakeAdapter(async (req) => {
      if (!ready) throw new Error(TEXTURE_LOADING)
      return { width: req.width, height: req.height, data: new Uint8ClampedArray(req.width * req.height * 4).fill(200) }
    })
    render(<NodePreviewViewport node={tex} />)
    await flush()
    expect(screen.getByText("Loading texture…")).toBeTruthy()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("loading")
    ready = true
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("ok")
    expect(screen.queryByText("Loading texture…")).toBeNull()
  })

  it("reports a texture that is missing from the project as an error without touching the GPU", async () => {
    useProjectStore.setState({ textureResources: [] })
    render(<NodePreviewViewport node={node("t1", { type: "texture", textureId: "gone", name: "x" })} />)
    await flush()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("error")
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
  })

  it("shows 'No preview' without a request for nodes that have no visual output", async () => {
    render(<NodePreviewViewport node={node("mesh-1", { type: "mesh", geometry: "cube" })} />)
    await flush()
    expect(screen.getByText("No preview")).toBeTruthy()
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("none")
  })

  it("shows a compact error when the node cannot compile, without touching the GPU", async () => {
    render(<NodePreviewViewport node={node("bad", { type: "math_expression", expression: "sin(", inputNames: [] })} />)
    await flush()
    expect(screen.getByText("Preview failed")).toBeTruthy()
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
  })

  it("shows the error state when the adapter cannot compile the shader (null result)", async () => {
    h.adapter = fakeAdapter(async () => null)
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(screen.getByText("Preview failed")).toBeTruthy()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("error")
  })

  it("surfaces the renderToTarget error message in the 'Preview failed' state instead of discarding it", async () => {
    h.adapter = fakeAdapter(async () => { throw new Error("Line 7: undeclared identifier 'foo'") })
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(screen.getByText("Preview failed")).toBeTruthy()
    expect(screen.getByText("Line 7: undeclared identifier 'foo'")).toBeTruthy()
    expect(screen.getByTestId("node-preview").getAttribute("data-preview-status")).toBe("error")
  })

  it("shows 'Preview unavailable' when no adapter is loaded", async () => {
    h.adapter = null as unknown as FakeAdapter
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(screen.getByText("Preview unavailable")).toBeTruthy()
  })

  it("re-requests once when the node's data changes, and not when the shader source is unchanged", async () => {
    const { rerender } = render(<NodePreviewViewport node={MATH} />)
    await flush()
    rerender(<NodePreviewViewport node={{ ...MATH, data: { ...MATH.data } as GraphNodeData }} />) // new object, same shader: skipped
    await flush()
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
    rerender(<NodePreviewViewport node={{ ...MATH, data: { ...MATH.data, expression: "uv.x" , outputType: "float" } as GraphNodeData }} />)
    await flush()
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(2)
    expect(h.adapter.renderToTarget.mock.calls[1][0].source.wgsl).toContain("n_m1 = uv.x;")
  })

  it("refreshes once, debounced, when a uniform value changes while paused", async () => {
    vi.useFakeTimers()
    useProjectStore.setState({ _graphNodes: [UNIFORM, MATH_IN], _graphEdges: [edge("u1", "m2", "a")] })
    render(<NodePreviewViewport node={MATH_IN} />)
    await flush()
    playing.mockReturnValue(false)
    h.adapter.renderToTarget.mockClear()
    act(() => { for (let i = 1; i <= 5; i++) useProjectStore.setState({ uniformValues: { gain: { type: "float", value: (i + 5) / 10 } } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
    expect(h.adapter.renderToTarget.mock.calls[0][0].uniforms.pu_gain.value).toBe(1)
  })

  it("channel buttons re-filter the last result without another GPU request", async () => {
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    putImageData.mockClear()
    fireEvent.click(screen.getByText("r"))
    expect(putImageData).toHaveBeenCalledTimes(1)
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
  })

  it("never has more than one request in flight", async () => {
    let resolve!: (v: unknown) => void
    h.adapter = fakeAdapter(() => new Promise((r) => { resolve = r }))
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    await runFrames(60, 70)
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(1)
    resolve({ width: 160, height: 160, data: new Uint8ClampedArray(160 * 160 * 4) })
    await flush()
    await runFrames(2, 70)
    expect(h.adapter.renderToTarget).toHaveBeenCalledTimes(2)
  })

  it("steady state while playing: <= 15 requests per second, driven by the coordinator hook, no rAF", async () => {
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    expect(hooks.size).toBe(1)
    h.adapter.renderToTarget.mockClear()
    await runFrames(200, 5) // 1s of 5ms coordinator frames (200Hz, far above display rate)
    const n = h.adapter.renderToTarget.mock.calls.length
    expect(PREVIEW_MAX_HZ).toBeLessThanOrEqual(15)
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThanOrEqual(15)
    expect(raf).not.toHaveBeenCalled()
  })

  it("issues zero requests while playback is paused, locally paused, hidden, or off-screen", async () => {
    let onIntersect!: (e: Array<{ isIntersecting: boolean }>) => void
    vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof onIntersect) { onIntersect = cb } observe() {} disconnect() {} })
    render(<NodePreviewViewport node={MATH} />)
    await flush()
    h.adapter.renderToTarget.mockClear()

    playing.mockReturnValue(false) // global playback paused
    await runFrames(100, 20)
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
    playing.mockReturnValue(true)

    act(() => onIntersect([{ isIntersecting: false }])) // scrolled out of view
    await runFrames(100, 20)
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
    act(() => onIntersect([{ isIntersecting: true }])) // back in view: one refresh (unchanged shader is skipped, so none)
    await flush()
    h.adapter.renderToTarget.mockClear()

    vi.spyOn(document, "hidden", "get").mockReturnValue(true) // tab hidden
    await runFrames(100, 20)
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
    vi.spyOn(document, "hidden", "get").mockReturnValue(false)

    fireEvent.click(screen.getByTitle("Pause preview")) // preview's own pause: hook unregistered
    expect(hooks.size).toBe(0)
  })

  it("unregisters its hook on unmount and drops a late result without touching state", async () => {
    let resolve!: (v: unknown) => void
    h.adapter = fakeAdapter(() => new Promise((r) => { resolve = r }))
    const { unmount } = render(<NodePreviewViewport node={MATH} />)
    await flush()
    unmount()
    expect(hooks.size).toBe(0)
    resolve({ width: 160, height: 160, data: new Uint8ClampedArray(160 * 160 * 4) })
    await flush()
    expect(putImageData).not.toHaveBeenCalled()
  })

  it("annotation nodes get the neutral notice and no request", async () => {
    render(<NodePreviewViewport node={node("c1", { type: "comment", text: "hi" })} />)
    await flush()
    expect(screen.getByText("Annotation node — no isolated shader output.")).toBeTruthy()
    expect(h.adapter.renderToTarget).not.toHaveBeenCalled()
    expect(hooks.size).toBe(0)
  })
})

void React
