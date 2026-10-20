/**
 * React render-perf guards (fleet w3-react): audio widgets are coordinator-driven + throttled, preview stops when paused,
 * one shared getActiveAdapter, templates write GLSL. No jsdom: components are rendered once with effects captured.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/adapters/webgpu", () => ({ webgpuAdapter: { id: "webgpu" } }))
vi.mock("@/adapters/webgl2", () => ({ webgl2Adapter: { id: "webgl2" } }))
vi.mock("@/adapters/threejs", () => ({ threejsAdapter: { id: "threejs" } }))

import { AudioNode } from "@/components/nodes/AudioNode"
import { NodePreviewViewport } from "@/components/inspector/NodePreviewViewport"
import { TemplatesModal } from "@/components/TemplatesModal"
import { getActiveAdapter, loadAdapter } from "@/adapters/activeAdapter"
import "@/audio/audioEngine" // lazy chunk in the app; the engine registers itself on load
import { renderCoordinator } from "@/core/renderCoordinator"
import { useProjectStore } from "@/stores/projectStore"
import { SHADER_TEMPLATES } from "@/core/templates"
import { CANVAS_HZ, GAUGE_HZ } from "@/components/nodes/useAudioFrame"

type Effect = () => void | (() => void)
const internals = () => (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/** Renders a component function once, capturing effects; `firstUseState` optionally forces the first useState value. */
function mount(component: unknown, props: Record<string, unknown>, firstUseState?: unknown) {
  const effects: Effect[] = []
  let tree: any = null
  const fn = ((component as any).type ?? component) as (p: unknown) => unknown
  function Interceptor() {
    const original = internals().H
    let n = 0
    internals().H = {
      ...original,
      useEffect: (e: Effect) => void effects.push(e),
      useState: (init: unknown) => (n++ === 0 && firstUseState !== undefined ? [firstUseState, () => {}] : original.useState(init)),
    }
    try { tree = fn(props) } finally { internals().H = original }
    return null
  }
  renderToStaticMarkup(React.createElement(Interceptor))
  return { tree, run: () => effects.map((e) => e()) }
}

function findAll(node: any, pred: (el: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) { node.forEach((c) => findAll(c, pred, out)); return out }
  if (node.props) { if (pred(node)) out.push(node); findAll(node.props.children, pred, out) }
  return out
}
const textOf = (n: any): string => (typeof n === "string" ? n : Array.isArray(n) ? n.map(textOf).join("") : n?.props ? textOf(n.props.children) : "")

function fakeCtx() {
  const calls = { fillRect: 0, createImageData: 0 }
  const ctx: any = new Proxy({}, {
    get: (t: any, k: string) => {
      if (k === "fillRect") return () => { calls.fillRect++ }
      if (k === "createImageData") return (w: number, h: number) => { calls.createImageData++; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } }
      if (k in t) return t[k]
      return () => ({ addColorStop() {} })
    },
    set: (t: any, k: string, v: unknown) => { t[k] = v; return true },
  })
  return { ctx, calls }
}

let nowMs = 0
beforeEach(() => {
  nowMs = 1000
  vi.spyOn(performance, "now").mockImplementation(() => nowMs)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("AudioNode spectrum + gauges are coordinator-driven and throttled", () => {
  const audioProps = (selected: boolean) => ({ id: "audio1", selected, data: { type: "audio" } })

  it("paused: no rAF and no frame hook registered", () => {
    useProjectStore.setState({ isAudioPlaying: false })
    const raf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    const reg = vi.spyOn(renderCoordinator, "registerPreRenderHook")
    mount(AudioNode, audioProps(true)).run()
    expect(raf).not.toHaveBeenCalled()
    expect(reg).not.toHaveBeenCalled()
  })

  it("playing: draws only from the coordinator hook, at most CANVAS_HZ, and unregisters on cleanup (never own rAF)", () => {
    useProjectStore.setState({ isAudioPlaying: true })
    const raf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    const hooks = new Map<string, () => void>()
    vi.spyOn(renderCoordinator, "registerPreRenderHook").mockImplementation((id, fn) => void hooks.set(id, fn as () => void))
    const unreg = vi.spyOn(renderCoordinator, "unregisterPreRenderHook").mockImplementation((id) => void hooks.delete(id))

    const m = mount(AudioNode, audioProps(false))
    const { ctx, calls } = fakeCtx()
    findAll(m.tree, (el) => el.type === "canvas")[0].ref.current = { width: 190, height: 38, getContext: () => ctx }
    const cleanups = m.run()
    const spectrum = hooks.get("audio-spectrum:audio1")!
    expect(spectrum).toBeTypeOf("function")

    for (let i = 0; i < 200; i++) { nowMs += 5; spectrum(0 as never) } // 1s of 5ms coordinator frames
    const draws = calls.fillRect / 25 // background + 24 bars per draw (beat bar is silent here)
    expect(draws).toBeGreaterThan(1)
    expect(draws).toBeLessThanOrEqual(CANVAS_HZ + 1)
    expect(raf).not.toHaveBeenCalled()

    cleanups.forEach((c) => typeof c === "function" && c())
    expect(unreg).toHaveBeenCalledWith("audio-spectrum:audio1")
  })

  it("gauge updates write to DOM refs at <= GAUGE_HZ with no React state churn", () => {
    useProjectStore.setState({ isAudioPlaying: true })
    const hooks = new Map<string, () => void>()
    vi.spyOn(renderCoordinator, "registerPreRenderHook").mockImplementation((id, fn) => void hooks.set(id, fn as () => void))
    const setState = vi.spyOn(useProjectStore, "setState")

    const m = mount(AudioNode, audioProps(true))
    const bassText = findAll(m.tree, (el) => el.type === "span" && typeof el.props.ref === "function" && textOf(el) === "0%")[0]
    let writes = 0
    const el: any = { style: {} }
    Object.defineProperty(el, "textContent", { set() { writes++ }, get: () => "" })
    bassText.props.ref(el)
    m.run()
    const gauge = hooks.get("audio-gauges:audio1")!
    expect(gauge).toBeTypeOf("function")
    for (let i = 0; i < 200; i++) { nowMs += 5; gauge(0 as never) }
    expect(writes).toBeGreaterThan(1)
    expect(writes).toBeLessThanOrEqual(GAUGE_HZ + 1)
    expect(setState).not.toHaveBeenCalled()
  })
})

describe("NodePreviewViewport scheduling", () => {
  const node = { id: "t1", position: { x: 0, y: 0 }, data: { type: "texture" } }

  it("paused: renders one frame, schedules no rAF and no timer", () => {
    const raf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    const setIv = vi.spyOn(globalThis, "setInterval")
    const m = mount(NodePreviewViewport, { node }, false)
    const { ctx, calls } = fakeCtx()
    findAll(m.tree, (el) => el.type === "canvas")[0].props.ref.current = { width: 240, height: 180, getContext: () => ctx }
    m.run()
    expect(calls.createImageData).toBe(1)
    expect(raf).not.toHaveBeenCalled()
    expect(setIv).not.toHaveBeenCalled()
  })

  it("playing: ~10Hz timer (no rAF), single reused ImageData, stops on cleanup", () => {
    vi.useFakeTimers()
    vi.stubGlobal("document", { hidden: false })
    const raf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    const m = mount(NodePreviewViewport, { node })
    const { ctx, calls } = fakeCtx()
    findAll(m.tree, (el) => el.type === "canvas")[0].props.ref.current = { width: 240, height: 180, getContext: () => ctx }
    const cleanups = m.run()
    vi.advanceTimersByTime(1000)
    expect(calls.createImageData).toBe(1)
    expect(raf).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    cleanups.forEach((c) => typeof c === "function" && c())
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("getActiveAdapter", () => {
  it.each([["webgpu"], ["webgl2"], ["threejs"]] as const)("returns the %s adapter", async (backend) => {
    await loadAdapter(backend) // webgl2/threejs adapters register once lazily loaded
    useProjectStore.setState({ activeBackend: backend })
    expect((getActiveAdapter() as unknown as { id: string }).id).toBe(backend)
  })
})

describe("template apply writes GLSL into the glsl slot", () => {
  it("keeps WGSL intact, never leaves WebGPU active, and recompiles", () => {
    vi.useFakeTimers()
    const tpl = SHADER_TEMPLATES[0]
    const original = tpl.backend
    ;(tpl as { backend: string }).backend = "webgpu"
    try {
      useProjectStore.setState({ activeBackend: "webgpu", wgslSource: "// wgsl", glslSource: "// old" })
      const before = useProjectStore.getState().recompileTrigger
      const m = mount(TemplatesModal, { isOpen: true, onClose: () => {} })
      const btn = findAll(m.tree, (el) => typeof el.props.onClick === "function" && textOf(el).includes("Load Shader"))[0] // first card = SHADER_TEMPLATES[0]
      btn.props.onClick()
      const s = useProjectStore.getState()
      expect(s.glslSource).toBe(tpl.shaderSource)
      expect(s.wgslSource).toBe("// wgsl")
      expect(s.activeBackend).toBe("webgl2")
      expect(s.shaderSource).toBe(tpl.shaderSource)
      expect(s.recompileTrigger).toBeGreaterThan(before)
    } finally {
      ;(tpl as { backend: string }).backend = original
    }
  })
})
