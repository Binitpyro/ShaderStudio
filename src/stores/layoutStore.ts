import { create } from "zustand"
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware"

export type ActivityTab = "graph" | "project" | "templates" | "copilot"
export type SplitOrientation = "vertical" | "horizontal"
export type MaximizedPanel = "none" | "viewport" | "editor"
/** react-resizable-panels layout: panel id -> percentage. */
export type PanelLayout = Record<string, number>

export interface JumpTarget {
  line: number
  column?: number
  timestamp: number
}

export interface LayoutState {
  activeActivityTab: ActivityTab | null
  isLeftSidebarOpen: boolean
  toggleActivityTab: (tab: ActivityTab) => void
  /** Open the sidebar on `tab` (never collapses, unlike toggleActivityTab). */
  openActivityTab: (tab: ActivityTab) => void
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

  /** Bumped by focusCopilot(); the copilot prompt focuses itself when it changes. */
  copilotFocusNonce: number
  /** Show the copilot tab in the sidebar and ask it to focus its prompt. */
  focusCopilot: () => void

  /** Persisted panel sizes keyed by resizable group id. */
  panelLayouts: Record<string, PanelLayout>
  setPanelLayout: (groupId: string, layout: PanelLayout) => void
}

/** localStorage that never throws (blocked storage, SSR, node tests) so persistence silently degrades to in-memory. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try { return window.localStorage.getItem(name) } catch { return null }
  },
  setItem: (name, value) => {
    try { window.localStorage.setItem(name, value) } catch { /* quota or blocked */ }
  },
  removeItem: (name) => {
    try { window.localStorage.removeItem(name) } catch { /* blocked */ }
  },
}

export const LAYOUT_STORAGE_KEY = "shaderstudio-layout"

/** persist() installs its own getInitialState; the SSR/test snapshot must follow live state, so re-point it afterwards. */
const withLiveSnapshot: typeof persist = ((config: never, options: never) => (set: never, get: never, api: never) => {
  const result = (persist as any)(config, options)(set, get, api)
  ;(api as any).getInitialState = () => (api as any).getState()
  return result
}) as never

export const useLayoutStore = create<LayoutState>()(
  withLiveSnapshot(
    (set, get) => {
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

        openActivityTab: (tab: ActivityTab) => set({ activeActivityTab: tab, isLeftSidebarOpen: true }),

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

        copilotFocusNonce: 0,
        focusCopilot: () =>
          set((state) => ({ activeActivityTab: "copilot", isLeftSidebarOpen: true, copilotFocusNonce: state.copilotFocusNonce + 1 })),

        panelLayouts: {},
        setPanelLayout: (groupId, layout) =>
          set((state) => ({ panelLayouts: { ...state.panelLayouts, [groupId]: layout } })),
      }
    },
    {
      name: LAYOUT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // Per-user view state only: never maximize/jump/focus (transient).
      partialize: (s) => ({
        activeActivityTab: s.activeActivityTab,
        isLeftSidebarOpen: s.isLeftSidebarOpen,
        isRightInspectorOpen: s.isRightInspectorOpen,
        isConsoleOpen: s.isConsoleOpen,
        splitOrientation: s.splitOrientation,
        editorMinimap: s.editorMinimap,
        panelLayouts: s.panelLayouts,
      }),
    },
  ),
)

// Ensure SSR / renderToStaticMarkup snapshots reflect current state
useLayoutStore.getInitialState = () => useLayoutStore.getState()
