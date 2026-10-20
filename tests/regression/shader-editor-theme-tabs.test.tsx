// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { useEffect } from "react"

const spy = vi.hoisted(() => ({ mounts: 0, themes: [] as string[], onMount: null as null | ((e: unknown, m: unknown) => void) }))

vi.mock("@/components/LazyMonaco", () => ({
  LazyMonaco: ({ theme, onMount }: { theme: string; onMount: (e: unknown, m: unknown) => void }) => {
    spy.themes.push(theme)
    spy.onMount = onMount
    useEffect(() => { spy.mounts++ }, [])
    return <div data-testid="mock-monaco" data-theme={theme} />
  },
}))
vi.mock("@/components/SyncStatusBanner", () => ({ SyncStatusBanner: () => <div /> }))

import { ShaderEditor } from "@/components/ShaderEditor"
import { ThemeProvider, useTheme } from "@/components/theme-provider"
import { useProjectStore } from "@/stores/projectStore"

let setThemeFn: (t: "light" | "dark") => void = () => {}
function Grab() {
  setThemeFn = useTheme().setTheme
  return null
}

beforeEach(() => {
  window.localStorage.clear()
  spy.mounts = 0
  spy.themes = []
  useProjectStore.getState().resetProject()
})

describe("ShaderEditor Monaco theme", () => {
  it("follows the app theme live without remounting the editor", () => {
    render(<ThemeProvider defaultTheme="dark"><Grab /><ShaderEditor /></ThemeProvider>)
    expect(screen.getByTestId("mock-monaco").getAttribute("data-theme")).toBe("vs-dark")
    act(() => setThemeFn("light"))
    expect(screen.getByTestId("mock-monaco").getAttribute("data-theme")).toBe("vs")
    act(() => setThemeFn("dark"))
    expect(screen.getByTestId("mock-monaco").getAttribute("data-theme")).toBe("vs-dark")
    expect(spy.mounts).toBe(1)
  })
})

describe("ShaderEditor tabs and markers (RTL)", () => {
  it("webgpu tab buttons switch render/compute", () => {
    useProjectStore.getState().setActiveBackend("webgpu")
    render(<ThemeProvider><ShaderEditor /></ThemeProvider>)
    fireEvent.click(screen.getByTestId("tab-compute"))
    expect(useProjectStore.getState().activeEditorTab).toBe("compute")
    fireEvent.click(screen.getByTestId("tab-render"))
    expect(useProjectStore.getState().activeEditorTab).toBe("render")
  })

  it("webgl2 tab buttons switch fragment/vertex", () => {
    useProjectStore.getState().setActiveBackend("webgl2")
    render(<ThemeProvider><ShaderEditor /></ThemeProvider>)
    fireEvent.click(screen.getByTestId("tab-vertex"))
    expect(useProjectStore.getState().activeEditorTab).toBe("vertex")
    fireEvent.click(screen.getByTestId("tab-fragment"))
    expect(useProjectStore.getState().activeEditorTab).toBe("fragment")
  })

  it("clears compiler markers on unmount and tracks error then no-error", () => {
    useProjectStore.getState().setActiveBackend("webgl2")
    const model = { uri: "u", getLineCount: () => 10, getLineMaxColumn: () => 40 }
    const setModelMarkers = vi.fn()
    const monaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { Enter: 2 }, MarkerSeverity: { Error: 8, Warning: 4 }, editor: { setModelMarkers } }
    const editor = { addCommand: vi.fn(), getModel: () => model, getAction: vi.fn() }
    const { unmount } = render(<ThemeProvider><ShaderEditor /></ThemeProvider>)
    act(() => spy.onMount!(editor, monaco))
    act(() => useProjectStore.getState().setLastCompileError("Fragment shader error: ERROR: 0:3: bad"))
    act(() => useProjectStore.getState().setLastCompileError(null))
    setModelMarkers.mockClear()
    unmount()
    expect(setModelMarkers).toHaveBeenCalledWith(model, "shaderstudio-compiler", [])
  })
})
