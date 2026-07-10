import { create } from "zustand"
import type { SyncMode } from "./projectStore"

let isIframe = false
try { isIframe = window.self !== window.top } catch { isIframe = true }

export interface FileHandleEntry { handle: FileSystemFileHandle; lastModified: number; path: string }

interface FileSystemState {
  syncMode: SyncMode
  activeFilePath: string | null
  fileHandles: Map<string, FileHandleEntry>
  isIframe: boolean
  bridgeConnected: boolean
  setSyncMode: (mode: SyncMode) => void
  setActiveFilePath: (path: string | null) => void
  setFileHandle: (path: string, entry: FileHandleEntry) => void
  removeFileHandle: (path: string) => void
  clearFileHandles: () => void
  setBridgeConnected: (connected: boolean) => void
}

export const useFileSystemStore = create<FileSystemState>((set) => ({
  syncMode: "local",
  activeFilePath: null,
  fileHandles: new Map(),
  isIframe,
  bridgeConnected: false,
  setSyncMode: (mode) => set({ syncMode: mode }),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
  setFileHandle: (path, entry) => set((state) => {
    const newHandles = new Map(state.fileHandles)
    newHandles.set(path, entry)
    return { fileHandles: newHandles }
  }),
  removeFileHandle: (path) => set((state) => {
    const newHandles = new Map(state.fileHandles)
    newHandles.delete(path)
    return { fileHandles: newHandles }
  }),
  clearFileHandles: () => set({ fileHandles: new Map() }),
  setBridgeConnected: (connected) => set({ bridgeConnected: connected }),
}))

export { isIframe }
