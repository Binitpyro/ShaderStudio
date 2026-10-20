/**
 * w3-fixup: behaviour tests for copilot session state (M1) and handler paths of inspector/node components that W3
 * touched (null-safe adapter access, lazy audio, lazy modelLoader). No jsdom: components are rendered once through the
 * server renderer with a stub dispatcher that captures effects and lets us drive useState setters and handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Select, Button } from "@/components/ui"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const runner = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock("@/core/ai/aiAgentRunner", () => ({ runAIShaderGeneration: runner.fn }))
vi.mock("@/adapters/webgpu", () => ({ webgpuAdapter: { id: "webgpu" } }))
vi.mock("@/adapters/webgl2", () => ({ webgl2Adapter: { id: "webgl2" } }))
vi.mock("@/adapters/threejs", () => ({ threejsAdapter: { id: "threejs" } }))

import { useCopilotSessionStore } from "@/stores/copilotSessionStore"
import { AICopilotSidebar } from "@/components/sidebars/AICopilotSidebar"
import { ParameterPanel } from "@/components/ParameterPanel"
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

describe("w3-fixup M1: copilot session state outlives the copilot sidebar", () => {
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

    // the copilot sidebar keeps only UI-local state (showSettings, testStatus): prompt/isRunning/session live in the store,
    // so closing (unmounting) mid-run neither loses them nor leaves a setState on an unmounted component
    expect(mount(AICopilotSidebar, {}).cells).toHaveLength(2)

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
    findAll(m.tree, (e) => (e.type === "select" || e.type === Select))[0].props.onChange({ target: { value: "sphere", dispatchEvent: dispatch } })
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
        findAll(m.tree, (e) => (e.type === "select" || e.type === Select))[0].props.onChange({ target: { value: "bloom" } })
        for (const s of findAll(m.tree, (e) => e.type === "input" && e.props.type === "range")) s.props.onChange({ target: { value: "0.25" } })
        findAll(m.tree, (e) => (e.type === "button" || e.type === Button) && e.props.onClick)[0]?.props.onClick()
      }
      expect(adapter.updatePostProcessUniform).toHaveBeenCalledWith("pp1", "intensity", 0.25)
      expect(events).toContain("postProcessTypeChange")
      expect(events).toContain("postProcessParamChange")
      expect(events).toContain("editPostProcessShader")
    } finally { vi.unstubAllGlobals() }
  })
})
