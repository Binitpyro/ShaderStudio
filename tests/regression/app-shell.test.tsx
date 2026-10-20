// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"

const m = vi.hoisted(() => ({ connect: vi.fn(), play: vi.fn(async () => {}) }))
vi.mock("@/bridge/wsBridgeClient", () => ({ connect: m.connect }))
vi.mock("@/components/Toolbar", () => ({ Toolbar: ({ onOpenExport }: { onOpenExport: () => void }) => <button onClick={onOpenExport}>open-export</button> }))
vi.mock("@/components/layout/WorkspaceLayout", () => ({ WorkspaceLayout: () => <div data-testid="workspace" /> }))
vi.mock("@/components/ExportModal", () => ({ ExportModal: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>export-modal</button> }))
vi.mock("@/audio/audioEngine", () => ({ audioEngine: { play: m.play } }))

import App, { syncParsedUniforms } from "@/App"
import { useProjectStore } from "@/stores/projectStore"

beforeEach(() => {
  m.connect.mockClear()
  m.play.mockClear()
  useProjectStore.getState().resetProject()
})

describe("App shell", () => {
  it("connects the bridge, loads the starter scene into an empty project and renders the workspace", () => {
    const load = vi.spyOn(useProjectStore.getState(), "loadStarterScene")
    useProjectStore.setState({ shaderSource: "", _graphNodes: [], loadStarterScene: load })
    render(<App />)
    expect(m.connect).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalled()
    expect(screen.getByTestId("workspace")).toBeTruthy()
  })

  it("does not reload the starter scene when the project already has a shader", () => {
    const load = vi.fn()
    useProjectStore.setState({ shaderSource: "void main(){}", loadStarterScene: load })
    render(<App />)
    expect(load).not.toHaveBeenCalled()
  })

  it("opens and closes the lazily loaded export modal", async () => {
    render(<App />)
    expect(screen.queryByText("export-modal")).toBeNull()
    fireEvent.click(screen.getByText("open-export"))
    fireEvent.click(await screen.findByText("export-modal"))
    await waitFor(() => expect(screen.queryByText("export-modal")).toBeNull())
  })

  it("starts audio on the first user gesture, once", async () => {
    useProjectStore.setState({ isAudioPlaying: false })
    render(<App />)
    await act(async () => { window.dispatchEvent(new Event("pointerdown")) })
    await waitFor(() => expect(m.play).toHaveBeenCalledTimes(1))
    expect(useProjectStore.getState().isAudioPlaying).toBe(true)
    await act(async () => { window.dispatchEvent(new Event("keydown")) })
    expect(m.play).toHaveBeenCalledTimes(1)
  })

  it("swallows an audio autoplay failure", async () => {
    m.play.mockRejectedValueOnce(new Error("blocked"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    useProjectStore.setState({ isAudioPlaying: false })
    render(<App />)
    await act(async () => { window.dispatchEvent(new Event("keydown")) })
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(useProjectStore.getState().isAudioPlaying).toBe(false)
    warn.mockRestore()
  })

  it("removes the gesture listeners on unmount", () => {
    const { unmount } = render(<App />)
    unmount()
    window.dispatchEvent(new Event("pointerdown"))
    expect(m.play).not.toHaveBeenCalled()
  })
})

describe("syncParsedUniforms", () => {
  it("parses WGSL for webgpu, GLSL otherwise, and clears for an empty source", () => {
    syncParsedUniforms("struct Uniforms { time: f32, };\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;", "webgpu")
    expect(useProjectStore.getState().parsedUniforms.map((u) => u.name)).toContain("time")
    syncParsedUniforms("uniform float u_glow;\nvoid main(){}", "webgl2")
    expect(useProjectStore.getState().parsedUniforms.map((u) => u.name)).toContain("u_glow")
    syncParsedUniforms("", "webgl2")
    expect(useProjectStore.getState().parsedUniforms).toEqual([])
  })
})
