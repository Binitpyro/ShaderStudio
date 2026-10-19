import { describe, it, expect, beforeEach } from "vitest"
import { useLayoutStore } from "../layoutStore"

describe("layoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      activeActivityTab: "graph",
      isLeftSidebarOpen: true,
      isRightInspectorOpen: true,
      isConsoleOpen: false,
      splitOrientation: "vertical",
      maximizedPanel: "none",
      editorMinimap: false,
      jumpTarget: null,
    })
  })

  it("initializes with default layout state", () => {
    const state = useLayoutStore.getState()
    expect(state.activeActivityTab).toBe("graph")
    expect(state.isLeftSidebarOpen).toBe(true)
    expect(state.isRightInspectorOpen).toBe(true)
    expect(state.isConsoleOpen).toBe(false)
    expect(state.splitOrientation).toBe("vertical")
    expect(state.maximizedPanel).toBe("none")
    expect(state.editorMinimap).toBe(false)
    expect(state.jumpTarget).toBeNull()
  })

  it("toggles activity tab and collapses sidebar on active tab re-click", () => {
    const { toggleActivityTab } = useLayoutStore.getState()

    // Re-clicking currently active tab collapses dock
    toggleActivityTab("graph")
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
    expect(useLayoutStore.getState().activeActivityTab).toBeNull()

    // Clicking a tab when closed opens it
    toggleActivityTab("project")
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().activeActivityTab).toBe("project")

    // Switching to another tab keeps dock open and updates active tab
    toggleActivityTab("templates")
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().activeActivityTab).toBe("templates")

    toggleActivityTab("copilot")
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().activeActivityTab).toBe("copilot")
  })

  it("sets left sidebar open state explicitly", () => {
    const { setLeftSidebarOpen } = useLayoutStore.getState()

    setLeftSidebarOpen(false)
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
    expect(useLayoutStore.getState().activeActivityTab).toBeNull()

    setLeftSidebarOpen(true)
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().activeActivityTab).toBe("graph")
  })

  it("toggles left sidebar open and closed cleanly", () => {
    const { toggleLeftSidebar, setLeftSidebarOpen } = useLayoutStore.getState()

    setLeftSidebarOpen(true)
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)

    // Toggle closed
    toggleLeftSidebar()
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(false)
    expect(useLayoutStore.getState().activeActivityTab).toBeNull()

    // Toggle open
    toggleLeftSidebar()
    expect(useLayoutStore.getState().isLeftSidebarOpen).toBe(true)
    expect(useLayoutStore.getState().activeActivityTab).toBe("graph")
  })

  it("toggles right inspector and sets its open state", () => {
    const { toggleRightInspector, setRightInspectorOpen } = useLayoutStore.getState()

    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(true)
    toggleRightInspector()
    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)

    toggleRightInspector()
    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(true)

    setRightInspectorOpen(false)
    expect(useLayoutStore.getState().isRightInspectorOpen).toBe(false)
  })

  it("toggles bottom console drawer and sets its open state", () => {
    const { toggleConsole, setConsoleOpen } = useLayoutStore.getState()

    expect(useLayoutStore.getState().isConsoleOpen).toBe(false)
    toggleConsole()
    expect(useLayoutStore.getState().isConsoleOpen).toBe(true)

    toggleConsole()
    expect(useLayoutStore.getState().isConsoleOpen).toBe(false)

    setConsoleOpen(true)
    expect(useLayoutStore.getState().isConsoleOpen).toBe(true)
  })

  it("toggles center stage split orientation", () => {
    const { toggleSplitOrientation } = useLayoutStore.getState()

    expect(useLayoutStore.getState().splitOrientation).toBe("vertical")
    toggleSplitOrientation()
    expect(useLayoutStore.getState().splitOrientation).toBe("horizontal")

    toggleSplitOrientation()
    expect(useLayoutStore.getState().splitOrientation).toBe("vertical")
  })

  it("toggles maximize viewport and restore", () => {
    const { toggleMaximizeViewport, setMaximizedPanel } = useLayoutStore.getState()

    expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    toggleMaximizeViewport()
    expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

    toggleMaximizeViewport()
    expect(useLayoutStore.getState().maximizedPanel).toBe("none")

    setMaximizedPanel("viewport")
    expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")
  })

  it("toggles maximize editor and restore", () => {
    const { toggleMaximizeEditor, setMaximizedPanel } = useLayoutStore.getState()

    expect(useLayoutStore.getState().maximizedPanel).toBe("none")
    toggleMaximizeEditor()
    expect(useLayoutStore.getState().maximizedPanel).toBe("editor")

    toggleMaximizeEditor()
    expect(useLayoutStore.getState().maximizedPanel).toBe("none")

    setMaximizedPanel("editor")
    expect(useLayoutStore.getState().maximizedPanel).toBe("editor")
  })

  it("toggles editor minimap option", () => {
    const { toggleEditorMinimap } = useLayoutStore.getState()

    expect(useLayoutStore.getState().editorMinimap).toBe(false)
    toggleEditorMinimap()
    expect(useLayoutStore.getState().editorMinimap).toBe(true)

    toggleEditorMinimap()
    expect(useLayoutStore.getState().editorMinimap).toBe(false)
  })

  it("sets jumpTarget and un-maximizes Viewport if Viewport was maximized", () => {
    const { jumpToLine, setMaximizedPanel } = useLayoutStore.getState()

    setMaximizedPanel("viewport")
    expect(useLayoutStore.getState().maximizedPanel).toBe("viewport")

    jumpToLine(24, 8)

    const state = useLayoutStore.getState()
    expect(state.maximizedPanel).toBe("none")
    expect(state.jumpTarget).not.toBeNull()
    expect(state.jumpTarget?.line).toBe(24)
    expect(state.jumpTarget?.column).toBe(8)
    expect(state.jumpTarget?.timestamp).toBeGreaterThan(0)
  })
})
