/**
 * w3-fixup: behaviour tests for copilot session state (M1) and handler paths of inspector/node components that W3
 * touched (null-safe adapter access, lazy audio, lazy modelLoader). No jsdom: components are rendered once through the
 * server renderer with a stub dispatcher that captures effects and lets us drive useState setters and handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const runner = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock("@/core/ai/aiAgentRunner", () => ({ runAIShaderGeneration: runner.fn }))
vi.mock("@/adapters/webgpu", () => ({ webgpuAdapter: { id: "webgpu" } }))
vi.mock("@/adapters/webgl2", () => ({ webgl2Adapter: { id: "webgl2" } }))
vi.mock("@/adapters/threejs", () => ({ threejsAdapter: { id: "threejs" } }))

import { useCopilotSessionStore } from "@/stores/copilotSessionStore"
import { AICopilotDrawer } from "@/components/AICopilotDrawer"
import { ParameterPanel } from "@/components/ParameterPanel"
import { VariationsSection } from "@/components/inspector/VariationsSection"
import { AudioDynamicsSection } from "@/components/inspector/AudioDynamicsSection"
import { MeshNode } from "@/components/nodes/MeshNode"
import { PostProcessNode } from "@/components/nodes/PostProcessNode"
import { useProjectStore } from "@/stores/projectStore"
import { loadAdapter } from "@/adapters/activeAdapter"
import { audioEngine } from "@/audio/audioEngine"
import { customModelRegistry } from "@/core/customModelRegistry"
import type { GenerationSession } from "@/core/ai/types"

type Effect = () => void | (() => void)
const internals = () => (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/** Renders once; useState is a plain cell (functional updaters applied), effects are captured not run. */
function mount(component: unknown, props: Record<string, unknown> = {}) {
  const effects: Effect[] = []
  const cells: { v: unknown }[] = []
  let tree: any = null
  const fn = ((component as any).type ?? component) as (p: unknown) => unknown
  const render = () => {
    effects.length = 0
    renderToStaticMarkup(React.createElement(Interceptor))
    return tree
  }
  function Interceptor() {
    const original = internals().H
    let n = 0
    internals().H = {
      ...original,
      useEffect: (e: Effect) => void effects.push(e),
      useState: (init: unknown) => {
        const cell = (cells[n] ??= { v: typeof init === "function" ? (init as () => unknown)() : init })
        n++
        return [cell.v, (u: unknown) => { cell.v = typeof u === "function" ? (u as (p: unknown) => unknown)(cell.v) : u }]
      },
    }
    try { tree = fn(props) } finally { internals().H = original }
    return null
  }
  render()
  return { get tree() { return tree }, cells, render, run: () => effects.map((e) => e()) }
}

function findAll(node: any, pred: (el: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) { node.forEach((c) => findAll(c, pred, out)); return out }
  if (node.props) { if (pred(node)) out.push(node); findAll(node.props.children, pred, out) }
  return out
}
const text = (n: any): string => (n == null || typeof n === "boolean" ? "" : typeof n !== "object" ? String(n) : Array.isArray(n) ? n.map(text).join("") : text(n.props?.children))

const deferred = () => { let resolve!: (s: GenerationSession) => void; const p = new Promise<GenerationSession>((r) => (resolve = r)); return { p, resolve } }
const session = (status: GenerationSession["status"]): GenerationSession =>
  ({ id: "s", userPrompt: "x", backend: "webgpu", provider: "gemini", model: "m", startedAt: 0, steps: [], status }) as GenerationSession

describe("w3-fixup M1: copilot session state outlives the drawer", () => {
  beforeEach(() => {
    runner.fn.mockReset()
    useCopilotSessionStore.setState({ prompt: "", isRunning: false, currentSession: null })
  })

  it("keeps running state across unmount and blocks a concurrent second run", async () => {
    const d = deferred()
    runner.fn.mockImplementation(() => d.p)
    useCopilotSessionStore.getState().setPrompt("glowing orb")
    const first = useCopilotSessionStore.getState().run()
    expect(useCopilotSessionStore.getState().isRunning).toBe(true)

    // the drawer keeps only UI-local state (showSettings, testStatus): prompt/isRunning/session live in the store,
    // so closing (unmounting) mid-run neither loses them nor leaves a setState on an unmounted component
    expect(mount(AICopilotDrawer, { isOpen: true, onClose: () => {} }).cells).toHaveLength(2)

    await useCopilotSessionStore.getState().run("another prompt")
    expect(runner.fn).toHaveBeenCalledTimes(1)

    runner.fn.mock.calls[0][2].onComplete(session("success"))
    d.resolve(session("success"))
    await first
    expect(useCopilotSessionStore.getState().isRunning).toBe(false)
    expect(useCopilotSessionStore.getState().currentSession?.status).toBe("success")
  })

  it("applies step updates and resets isRunning when the runner throws", async () => {
    runner.fn.mockImplementation(async () => { throw new Error("boom") })
    await useCopilotSessionStore.getState().run("p")
    expect(useCopilotSessionStore.getState().isRunning).toBe(false)

    runner.fn.mockImplementation(async (_p: string, _s: unknown, cb: any) => {
      useCopilotSessionStore.setState({ currentSession: session("running") })
      cb.onStepUpdate({ stepNumber: 1, status: "a" })
      cb.onStepUpdate({ stepNumber: 1, status: "b" })
      cb.onStepUpdate({ stepNumber: 2, status: "c" })
    })
    await useCopilotSessionStore.getState().run("p")
    expect(useCopilotSessionStore.getState().currentSession?.steps.map((s: any) => s.status)).toEqual(["b", "c"])
  })

  it("ignores empty prompts", async () => {
    await useCopilotSessionStore.getState().run("   ")
    expect(runner.fn).not.toHaveBeenCalled()
  })
})

describe("ParameterPanel accordion behaviour", () => {
  afterEach(() => useProjectStore.setState({ selectedNodeId: null }))

  it.each([["audio1", "audio"], ["mat1", "uniforms"], ["comp1", "compute"]])("selecting %s opens the %s section", (id, section) => {
    useProjectStore.setState({ selectedNodeId: id })
    const m = mount(ParameterPanel)
    m.run()
    expect((m.cells[0].v as Set<string>).has(section)).toBe(true)
  })

  it("toggles one section and expands/collapses all", () => {
    useProjectStore.setState({ selectedNodeId: null })
    const m = mount(ParameterPanel)
    const sectionEl = findAll(m.tree, (e) => e.props.id === "variations")[0]
    sectionEl.props.onToggle()
    expect((m.cells[0].v as Set<string>).has("variations")).toBe(true)
    sectionEl.props.onToggle()
    expect((m.cells[0].v as Set<string>).has("variations")).toBe(false)

    const toggleAll = findAll(m.tree, (e) => e.type === "button" && /Collapse All|Expand All/.test(text(e)))[0]
    toggleAll.props.onClick()
    expect((m.cells[0].v as Set<string>).size).toBe(0)
    m.render()
    findAll(m.tree, (e) => e.type === "button" && /Expand All/.test(text(e)))[0].props.onClick()
    expect((m.cells[0].v as Set<string>).size).toBe(5)
  })
})

describe("VariationsSection handlers", () => {
  it("creates a variation on Enter and applies one, null-safe without an adapter", async () => {
    const m = mount(VariationsSection)
    const input = findAll(m.tree, (e) => e.type === "input" && e.props.type === "text")[0]
    const before = useProjectStore.getState().variations.length
    input.props.onKeyDown({ key: "x", preventDefault() {} })
    expect(useProjectStore.getState().variations.length).toBe(before)
    input.props.onKeyDown({ key: "Enter", preventDefault() {} })
    expect(useProjectStore.getState().variations.length).toBe(before + 1)

    const v = useProjectStore.getState().variations
    useProjectStore.setState({ variations: [...v.slice(0, -1), { ...v[v.length - 1], uniformValues: { u_a: 1 } }] })
    const m2 = mount(VariationsSection)
    const applyBtn = () => findAll(m2.tree, (e) => e.props.onClick && String(e.props.onClick).includes("handleApply")).at(-1)
    useProjectStore.setState({ activeBackend: "webgl2" }) // nothing loaded for this backend yet
    applyBtn().props.onClick()
    const adapter = (await loadAdapter("webgpu")) as any
    adapter.updateUniform = vi.fn()
    useProjectStore.setState({ activeBackend: "webgpu" })
    applyBtn().props.onClick()
    expect(adapter.updateUniform).toHaveBeenCalledWith("u_a", 1)
  })
})

describe("AudioDynamicsSection handlers", () => {
  let spies: { mockRestore: () => void }[]
  beforeEach(() => {
    spies = [
      vi.spyOn(audioEngine, "togglePlay").mockReturnValue(true),
      vi.spyOn(audioEngine, "setSourceType").mockResolvedValue(undefined as never),
      vi.spyOn(audioEngine, "getIsPlaying").mockReturnValue(true),
      vi.spyOn(audioEngine, "startMicrophone").mockResolvedValue(undefined as never),
      vi.spyOn(audioEngine, "loadCustomAudioFile").mockResolvedValue(true as never),
      vi.spyOn(audioEngine, "setGainMultiplier").mockImplementation(() => {}),
      vi.spyOn(audioEngine, "setSmoothing").mockImplementation(() => {}),
    ]
  })
  afterEach(() => spies.forEach((s) => s.mockRestore()))

  it("drives play, source switch, mic, upload, gain/smoothing and binding removal through the lazy engine", async () => {
    useProjectStore.setState({ audioBindings: { u_pulse: { band: "bass", amount: 1 } as any }, audioSourceType: "builtin", isAudioPlaying: false })
    const m = mount(AudioDynamicsSection)
    m.run()
    await findAll(m.tree, (e) => e.props.onClick && text(e).includes("Play Audio"))[0].props.onClick()
    expect(useProjectStore.getState().isAudioPlaying).toBe(true)

    await findAll(m.tree, (e) => e.type === "button" && text(e).trim() === "Built-in")[0].props.onClick()
    expect(audioEngine.setSourceType).toHaveBeenCalledWith("builtin")
    await findAll(m.tree, (e) => e.props.onClick && String(e.props.onClick).includes("handleStartMic"))[0]?.props.onClick()

    const file = new File(["x"], "a.wav")
    await findAll(m.tree, (e) => e.type === "input" && e.props.type === "file")[0].props.onChange({ target: { files: [file] } })
    expect(audioEngine.loadCustomAudioFile).toHaveBeenCalledWith(file)
    expect(useProjectStore.getState().audioSourceType).toBe("file")

    const sliders = findAll(m.tree, (e) => typeof e.props.onValueChange === "function")
    sliders[0].props.onValueChange([1.5])
    sliders[1].props.onValueChange([0.4])
    expect(audioEngine.setGainMultiplier).toHaveBeenCalledWith(1.5)
    expect(audioEngine.setSmoothing).toHaveBeenCalledWith(0.4)

    findAll(m.tree, (e) => e.props.onClick && String(e.props.onClick).includes("setAudioBinding"))[0].props.onClick()
    expect(useProjectStore.getState().audioBindings.u_pulse).toBeUndefined()
  })
})

describe("MeshNode handlers", () => {
  afterEach(() => customModelRegistry.setActiveModel(null as never))

  it("subscribes to the model registry, reacts to the geometry select and surfaces load errors", async () => {
    const m = mount(MeshNode, { data: { geometry: "custom" }, selected: false })
    const cleanup = m.run()[0] as () => void
    customModelRegistry.setActiveModel({ name: "m.glb", triangleCount: 12 } as never)
    expect(m.cells[0].v).toMatchObject({ name: "m.glb" })
    cleanup()

    const heard: string[] = []
    const dispatch = vi.fn((ev: CustomEvent) => heard.push(ev.detail.geometry))
    findAll(m.tree, (e) => e.type === "select")[0].props.onChange({ target: { value: "sphere", dispatchEvent: dispatch } })
    expect(heard).toEqual(["sphere"])

    // bad file: lazy modelLoader rejects -> error state set, loading cleared
    const input = findAll(m.tree, (e) => e.type === "input" && e.props.type === "file")[0]
    input.props.onChange({ target: { files: [new File(["not a model"], "bad.xyz")] } })
    await vi.waitFor(() => expect(typeof m.cells[2].v).toBe("string"))
    expect(m.cells[1].v).toBe(false)
    input.props.onChange({ target: { files: [] } }) // no file: no-op

    // drop zone and drag state
    const zone = findAll(m.tree, (e) => e.props.onDrop)[0]
    if (zone) {
      zone.props.onDragOver({ preventDefault() {} })
      expect(m.cells[3].v).toBe(true)
      zone.props.onDragLeave()
      zone.props.onDrop({ preventDefault() {}, dataTransfer: { files: [] } })
    }
  })
})

describe("PostProcessNode handlers", () => {
  it("syncs params from node data, forwards slider edits to the loaded adapter and emits events", async () => {
    const events: string[] = []
    vi.stubGlobal("document", { dispatchEvent: (e: Event) => { events.push(e.type); return true } })
    const adapter = (await loadAdapter("webgpu")) as any
    adapter.updatePostProcessUniform = vi.fn()
    useProjectStore.setState({ activeBackend: "webgpu" })
    try {
      for (const passType of ["vignette", "blur", "chromatic_aberration", "bloom", "custom"]) {
        const m = mount(PostProcessNode, { id: "pp1", data: { passType, params: { intensity: 0.9, junk: "x" }, customSource: "src" }, selected: true })
        m.run()
        expect((m.cells[0].v as any).intensity).toBe(0.9)
        findAll(m.tree, (e) => e.type === "select")[0].props.onChange({ target: { value: "bloom" } })
        for (const s of findAll(m.tree, (e) => e.type === "input" && e.props.type === "range")) s.props.onChange({ target: { value: "0.25" } })
        findAll(m.tree, (e) => e.type === "button" && e.props.onClick)[0]?.props.onClick()
      }
      expect(adapter.updatePostProcessUniform).toHaveBeenCalledWith("pp1", "intensity", 0.25)
      expect(events).toContain("postProcessTypeChange")
      expect(events).toContain("postProcessParamChange")
      expect(events).toContain("editPostProcessShader")
    } finally { vi.unstubAllGlobals() }
  })
})
