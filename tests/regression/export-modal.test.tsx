// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"

const gen = vi.hoisted(() => ({ generateExport: vi.fn() }))
vi.mock("@/core/engineTranspiler", async (orig) => {
  const real = await orig<typeof import("@/core/engineTranspiler")>()
  return { ...real, generateExport: gen.generateExport }
})

import { ExportModal } from "@/components/ExportModal"
import { useProjectStore } from "@/stores/projectStore"

const flush = async (ms = 400) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  useProjectStore.getState().resetProject()
  gen.generateExport.mockReset()
  gen.generateExport.mockImplementation(async (target: string) => ({ code: `// generated ${target}`, via: "glsl" }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const targets = () => gen.generateExport.mock.calls.map((c) => c[0])

describe("ExportModal laziness", () => {
  it("does no work while closed, even when the project changes", async () => {
    render(<ExportModal isOpen={false} onClose={() => {}} />)
    await flush()
    act(() => useProjectStore.setState({ uniformValues: { u_x: { type: "float", value: 1 } } }))
    await flush()
    expect(gen.generateExport).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("generates only the selected target, and re-selecting a seen target is served from the cache", async () => {
    render(<ExportModal isOpen onClose={() => {}} />)
    await flush()
    expect(targets()).toEqual(["r3f"])
    expect(screen.getByText("// generated r3f")).toBeTruthy()

    fireEvent.click(screen.getByText(/Game Engines/))
    await flush()
    expect(targets()).toEqual(["r3f", "unity"])
    expect(screen.getByText("// generated unity")).toBeTruthy()

    fireEvent.click(screen.getByText(/React Three Fiber/))
    await flush()
    fireEvent.click(screen.getByText(/Game Engines/))
    await flush()
    expect(targets()).toEqual(["r3f", "unity"]) // memoized by source hash: no recompute
    expect(screen.getByText("// generated unity")).toBeTruthy()

    fireEvent.click(screen.getByText(/Godot 4 Spatial/))
    await flush()
    expect(targets()).toEqual(["r3f", "unity", "godot"])
  })

  it("debounces a slider drag into a single regeneration of the selected target", async () => {
    render(<ExportModal isOpen onClose={() => {}} />)
    await flush()
    expect(gen.generateExport).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 8; i++) {
      act(() => useProjectStore.setState({ uniformValues: { u_x: { type: "float", value: i } } }))
      await flush(30)
    }
    expect(gen.generateExport).toHaveBeenCalledTimes(1) // still inside the debounce window
    await flush()
    expect(gen.generateExport).toHaveBeenCalledTimes(2)
    expect(gen.generateExport.mock.calls[1][1].uniformValues.u_x.value).toBe(8)
  })

  it("passes both per-language sources, never the active backend's merged shaderSource", async () => {
    act(() => useProjectStore.setState({ wgslSource: "// wgsl body", glslSource: "// glsl body" }))
    render(<ExportModal isOpen onClose={() => {}} />)
    await flush()
    const project = gen.generateExport.mock.calls[0][1]
    expect(project.wgslSource).toBe("// wgsl body")
    expect(project.glslSource).toBe("// glsl body")
  })

  it("shows a naga error with its line number instead of code", async () => {
    gen.generateExport.mockResolvedValue({ error: "WGSL to GLSL (naga): expected identifier (line 3)", line: 3 })
    render(<ExportModal isOpen onClose={() => {}} />)
    await flush()
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Export failed")
    expect(alert.textContent).toContain("line 3")
    expect(screen.queryByText(/generated/)).toBeNull()
  })

  it("the raw tab needs no generation", async () => {
    render(<ExportModal isOpen onClose={() => {}} />)
    await flush()
    gen.generateExport.mockClear()
    fireEvent.click(screen.getByText(/Raw Shader/))
    await flush()
    expect(gen.generateExport).not.toHaveBeenCalled()
  })
})
