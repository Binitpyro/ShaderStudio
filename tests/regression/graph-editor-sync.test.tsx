// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

vi.mock("@/db", () => ({ saveSnapshot: vi.fn(async () => {}) }))

import { useFileSystemStore } from "@/stores/fileSystemStore"
import { useProjectStore } from "@/stores/projectStore"
import { startFolderSync, stopFolderSync, isFolderSyncRunning, FOLDER_POLL_MS } from "@/services/folderSync"
import { FileImporter } from "@/components/FileImporter"

function handle(initial: { text: string; lastModified: number }) {
  const state = { ...initial }
  return {
    state,
    handle: { getFile: async () => ({ lastModified: state.lastModified, text: async () => state.text }) } as unknown as FileSystemFileHandle,
  }
}

describe("folder sync service", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stopFolderSync()
    useFileSystemStore.setState({ syncMode: "local", activeFilePath: null, fileHandles: new Map() })
  })
  afterEach(() => {
    stopFolderSync()
    vi.useRealTimers()
  })

  it("polls only while syncMode is folder and stops when the mode changes", () => {
    startFolderSync()
    expect(isFolderSyncRunning()).toBe(false)
    useFileSystemStore.getState().setSyncMode("folder")
    expect(isFolderSyncRunning()).toBe(true)
    useFileSystemStore.getState().setSyncMode("local")
    expect(isFolderSyncRunning()).toBe(false)
  })

  it("reads the LIVE handle map each tick (handles added after start are picked up) and applies changes to the active file", async () => {
    startFolderSync()
    useFileSystemStore.getState().setSyncMode("folder")
    const f = handle({ text: "v1", lastModified: 10 })
    useFileSystemStore.getState().setFileHandle("a.wgsl", { handle: f.handle, lastModified: 10, path: "a.wgsl" })
    useFileSystemStore.getState().setActiveFilePath("a.wgsl")
    const before = useProjectStore.getState().recompileTrigger

    f.state.text = "v2"
    f.state.lastModified = 20
    await vi.advanceTimersByTimeAsync(FOLDER_POLL_MS + 5)

    expect(useProjectStore.getState().shaderSource).toBe("v2")
    expect(useProjectStore.getState().recompileTrigger).toBe(before + 1)
    expect(useFileSystemStore.getState().fileHandles.get("a.wgsl")!.lastModified).toBe(20)

    // unchanged mtime: no further recompiles
    await vi.advanceTimersByTimeAsync(FOLDER_POLL_MS * 3)
    expect(useProjectStore.getState().recompileTrigger).toBe(before + 1)
  })

  it("keeps polling after the importer UI unmounts (folder mode survives the Project tab)", async () => {
    const { unmount } = render(<FileImporter />)
    useFileSystemStore.getState().setSyncMode("folder") // connect flow ends with folder mode + startFolderSync()
    startFolderSync()
    unmount()
    expect(isFolderSyncRunning()).toBe(true)

    const f = handle({ text: "x", lastModified: 1 })
    useFileSystemStore.getState().setFileHandle("m.wgsl", { handle: f.handle, lastModified: 1, path: "m.wgsl" })
    useFileSystemStore.getState().setActiveFilePath("m.wgsl")
    f.state.text = "after-unmount"
    f.state.lastModified = 2
    await vi.advanceTimersByTimeAsync(FOLDER_POLL_MS + 5)
    expect(useProjectStore.getState().shaderSource).toBe("after-unmount")
  })

  it("Disconnect stops polling, clears handles and returns to local mode", () => {
    useFileSystemStore.setState({ syncMode: "folder" })
    render(<FileImporter />)
    expect(isFolderSyncRunning()).toBe(true) // remount in folder mode restarts the service
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/ }))
    expect(isFolderSyncRunning()).toBe(false)
    expect(useFileSystemStore.getState().syncMode).toBe("local")
    expect(useFileSystemStore.getState().fileHandles.size).toBe(0)
  })
})
