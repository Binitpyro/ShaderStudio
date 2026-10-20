// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { ReactFlowProvider } from "@xyflow/react"

// ---- react-resizable-panels: capture group callbacks + panel refs so the shell wiring is testable in happy-dom
const rrp = vi.hoisted(() => ({
  groups: {} as Record<string, (layout: Record<string, number>, meta: { isUserInteraction: boolean }) => void>,
  panels: {} as Record<string, { collapsed: boolean; expand: () => void; collapse: () => void; isCollapsed: () => boolean }>,
}))
vi.mock("react-resizable-panels", async () => {
  const React = await import("react")
  return {
    Group: ({ id, onLayoutChanged, children }: { id: string; onLayoutChanged: (l: Record<string, number>, m: { isUserInteraction: boolean }) => void; children: React.ReactNode }) => {
      rrp.groups[id] = onLayoutChanged
      return <div>{children}</div>
    },
    Panel: ({ id, panelRef, children }: { id: string; panelRef?: { current: unknown }; children: React.ReactNode }) => {
      if (panelRef) {
        const p = rrp.panels[id] ?? (rrp.panels[id] = {
          collapsed: false,
          expand: vi.fn(() => { p.collapsed = false }),
          collapse: vi.fn(() => { p.collapsed = true }),
          isCollapsed: () => p.collapsed,
        })
        panelRef.current = p
      }
      return <div>{children}</div>
    },
    Separator: () => <hr />,
    usePanelRef: () => React.useRef(null),
  }
})
vi.mock("@/components/layout/ActivityBar", () => ({ ActivityBar: () => <div /> }))
vi.mock("@/components/layout/SidebarDock", () => ({ SidebarDock: () => <div /> }))
vi.mock("@/components/layout/CenterStage", () => ({ CenterStage: () => <div /> }))
vi.mock("@/components/layout/RightInspector", () => ({ RightInspector: () => <div /> }))
vi.mock("@/components/layout/StatusBar", () => ({ StatusBar: () => <div /> }))

import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { TextureNode } from "@/components/nodes/TextureNode"
import { RenderSection } from "@/components/inspector/RenderSection"
import { useLayoutStore } from "@/stores/layoutStore"
import { useProjectStore } from "@/stores/projectStore"
import { useRenderSettingsStore } from "@/stores/renderSettingsStore"

beforeEach(() => {
  rrp.panels = {}
  rrp.groups = {}
  window.localStorage.clear()
  useLayoutStore.setState({ isLeftSidebarOpen: true, isRightInspectorOpen: true, isConsoleOpen: false, maximizedPanel: "none", jumpTarget: null })
  useProjectStore.getState().resetProject()
})

describe("WorkspaceLayout panel sync", () => {
  it("collapses/expands panels from the store flags", () => {
    render(<WorkspaceLayout />)
    act(() => useLayoutStore.getState().setLeftSidebarOpen(false))
    expect(rrp.panels["left-sidebar"].collapse).toHaveBeenCalled()
    act(() => useLayoutStore.getState().setLeftSidebarOpen(true))
    expect(rrp.panels["left-sidebar"].expand).toHaveBeenCalled()
  })

  it("mirrors a user drag-shut / drag-open back into the store", () => {
    render(<WorkspaceLayout />)
    act(() => rrp.groups["shell-horizontal"]({ "left-sidebar": 0, "inspector-panel": 0 }, { isUserInteraction: true }))
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)
    act(() => rrp.groups["shell-horizontal"]({ "left-sidebar": 22, "inspector-panel": 20 }, { isUserInteraction: true }))
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(true)

    act(() => rrp.groups["shell-vertical"]({ "console-drawer-panel": 25 }, { isUserInteraction: true }))
    expect(useLayoutStore.getState().isConsoleOpen).toBe(true)
    act(() => rrp.groups["shell-vertical"]({ "console-drawer-panel": 0 }, { isUserInteraction: true }))
    expect(useLayoutStore.getState().isConsoleOpen).toBe(false)
  })

  it("ignores programmatic layout changes", () => {
    render(<WorkspaceLayout />)
    act(() => rrp.groups["shell-horizontal"]({ "left-sidebar": 0 }, { isUserInteraction: false }))
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
  })
})

describe("layoutStore persistence", () => {
  it("clearStorage goes through the safe storage wrapper", () => {
    useLayoutStore.getState().setLeftSidebarOpen(false)
    window.localStorage.setItem("shaderstudio-layout", "{}")
    useLayoutStore.persist.clearStorage()
    expect(window.localStorage.getItem("shaderstudio-layout")).toBeNull()
  })
})

describe("ConsoleDrawer interactions", () => {
  it("Jump switches to the tab named in the error and requests the line", () => {
    useProjectStore.getState().setActiveBackend("webgl2")
    useProjectStore.getState().setActiveEditorTab("fragment")
    useProjectStore.getState().setLastCompileError("Vertex shader error: ERROR: 0:5: bad thing")
    render(<ConsoleDrawer />)
    fireEvent.click(screen.getByTestId("jump-to-line-btn"))
    expect(useProjectStore.getState().activeEditorTab).toBe("vertex")
    expect(useLayoutStore.getState().jumpTarget?.line).toBe(5)
  })

  it("clicking a compute diagnostic card jumps to the compute tab; Clear empties the console", () => {
    useProjectStore.getState().setActiveBackend("webgpu")
    useProjectStore.getState().setActiveEditorTab("render")
    useProjectStore.getState().setLastCompileError("Compute shader error: 3:2 error: nope")
    render(<ConsoleDrawer />)
    fireEvent.click(screen.getByTestId("diagnostic-card-0"))
    expect(useProjectStore.getState().activeEditorTab).toBe("compute")
    fireEvent.click(screen.getByTestId("clear-diagnostics-btn"))
    expect(useProjectStore.getState().lastCompileError).toBeNull()
  })

  it("counts a warning line", () => {
    useProjectStore.getState().setLastCompileError("WARNING: 0:2: unused")
    render(<ConsoleDrawer />)
    expect(screen.getByTestId("console-warning-badge").textContent).toContain("1 Warning")
  })
})

describe("TextureNode", () => {
  const props = { id: "t1", data: { type: "texture", textureId: "tex_t1", name: "foo.png" }, selected: false } as never

  it("loads a dropped or selected image into the texture store and shows a preview", () => {
    class FR {
      onload: ((e: { target: { result: string } }) => void) | null = null
      readAsDataURL() { this.onload?.({ target: { result: "data:image/png;base64,AA==" } }) }
    }
    vi.stubGlobal("FileReader", FR)
    const added = vi.fn()
    const loaded = vi.fn()
    document.addEventListener("textureLoaded", loaded)
    useProjectStore.setState({ addTextureResource: added })
    const { container } = render(<ReactFlowProvider><TextureNode {...props} /></ReactFlowProvider>)
    expect(screen.getByText("foo.png")).toBeTruthy()
    const zone = screen.getByText("Drop image").parentElement!
    fireEvent.dragOver(zone)
    expect(zone.className).toContain("border-brand")
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain("bg-brand-soft")
    const file = new File(["x"], "pic.png", { type: "image/png" })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(added).toHaveBeenCalledWith({ id: "tex_t1", name: "pic.png", src: "data:image/png;base64,AA==" })
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(screen.getByAltText("Texture preview")).toBeTruthy()
    // non-image drops are ignored
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } })
    expect(added).toHaveBeenCalledTimes(1)
    // file picker path
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } })
    expect(added).toHaveBeenCalledTimes(2)
    fireEvent.click(zone)
    document.removeEventListener("textureLoaded", loaded)
    vi.unstubAllGlobals()
  })
})

describe("RenderSection deferred hint", () => {
  const HINT = /Deferred shading uses the material.s base colour/

  it("shows the hint only for Deferred on WebGPU", () => {
    useProjectStore.getState().setActiveBackend("webgpu")
    useRenderSettingsStore.getState().setRenderMode("forward")
    const { unmount } = render(<RenderSection />)
    expect(screen.queryByText(HINT)).toBeNull()
    act(() => useRenderSettingsStore.getState().setRenderMode("deferred"))
    expect(screen.getByText(HINT)).toBeTruthy()
    unmount()

    useProjectStore.getState().setActiveBackend("webgl2")
    render(<RenderSection />)
    expect(screen.queryByText(HINT)).toBeNull()
  })
})
