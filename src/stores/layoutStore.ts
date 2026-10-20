import { create } from "zustand"

export type ActivityTab = "graph" | "project" | "templates" | "copilot"
export type SplitOrientation = "vertical" | "horizontal"
export type MaximizedPanel = "none" | "viewport" | "editor"

export interface JumpTarget {
  line: number
  column?: number
  timestamp: number
}

export interface LayoutState {
  activeActivityTab: ActivityTab | null
  isLeftSidebarOpen: boolean
  toggleActivityTab: (tab: ActivityTab) => void
  setLeftSidebarOpen: (open: boolean) => void
  toggleLeftSidebar: () => void

  isRightInspectorOpen: boolean
  toggleRightInspector: () => void
  setRightInspectorOpen: (open: boolean) => void

  isConsoleOpen: boolean
  toggleConsole: () => void
  setConsoleOpen: (open: boolean) => void

  splitOrientation: SplitOrientation
  toggleSplitOrientation: () => void

  maximizedPanel: MaximizedPanel
  setMaximizedPanel: (panel: MaximizedPanel) => void
  toggleMaximizeViewport: () => void
  toggleMaximizeEditor: () => void

  editorMinimap: boolean
  toggleEditorMinimap: () => void

  jumpTarget: JumpTarget | null
  jumpToLine: (line: number, column?: number) => void
}

export const useLayoutStore = create<LayoutState>((set, get, api) => {
  api.getInitialState = () => api.getState()
  return {
  activeActivityTab: "graph",
  isLeftSidebarOpen: true,

  toggleActivityTab: (tab: ActivityTab) => {
    const current = get().activeActivityTab
    const isOpen = get().isLeftSidebarOpen

    if (current === tab && isOpen) {
      set({ isLeftSidebarOpen: false, activeActivityTab: null })
    } else {
      set({ activeActivityTab: tab, isLeftSidebarOpen: true })
    }
  },

  setLeftSidebarOpen: (open: boolean) => {
    if (open) {
      const activeTab = get().activeActivityTab ?? "graph"
      set({ isLeftSidebarOpen: true, activeActivityTab: activeTab })
    } else {
      set({ isLeftSidebarOpen: false, activeActivityTab: null })
    }
  },

  toggleLeftSidebar: () => {
    const isOpen = get().isLeftSidebarOpen
    get().setLeftSidebarOpen(!isOpen)
  },

  isRightInspectorOpen: true,
  toggleRightInspector: () => set((state) => ({ isRightInspectorOpen: !state.isRightInspectorOpen })),
  setRightInspectorOpen: (open: boolean) => set({ isRightInspectorOpen: open }),

  isConsoleOpen: false,
  toggleConsole: () => set((state) => ({ isConsoleOpen: !state.isConsoleOpen })),
  setConsoleOpen: (open: boolean) => set({ isConsoleOpen: open }),

  splitOrientation: "vertical",
  toggleSplitOrientation: () =>
    set((state) => ({
      splitOrientation: state.splitOrientation === "vertical" ? "horizontal" : "vertical",
    })),

  maximizedPanel: "none",
  setMaximizedPanel: (panel: MaximizedPanel) => set({ maximizedPanel: panel }),

  toggleMaximizeViewport: () =>
    set((state) => ({
      maximizedPanel: state.maximizedPanel === "viewport" ? "none" : "viewport",
    })),

  toggleMaximizeEditor: () =>
    set((state) => ({
      maximizedPanel: state.maximizedPanel === "editor" ? "none" : "editor",
    })),

  editorMinimap: false,
  toggleEditorMinimap: () => set((state) => ({ editorMinimap: !state.editorMinimap })),

  jumpTarget: null,
  jumpToLine: (line: number, column?: number) => {
    // Contract: integers >= 1 (Monaco cannot reveal anything else)
    const toPos = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1)
    line = toPos(line)
    if (column !== undefined) column = toPos(column)
    // If Viewport is maximized, un-maximize so Editor is visible
    if (get().maximizedPanel === "viewport") {
      set({ maximizedPanel: "none" })
    }
    set({
      jumpTarget: {
        line,
        column,
        timestamp: Date.now(),
      },
    })
  },
} })

// Ensure SSR / renderToStaticMarkup snapshots reflect current state
useLayoutStore.getInitialState = () => useLayoutStore.getState()
