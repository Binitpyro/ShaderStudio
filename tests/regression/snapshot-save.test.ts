import { describe, it, expect, vi, afterEach } from "vitest"

const saveSnapshot = vi.fn()
vi.mock("@/db", () => ({ saveSnapshot: (...a: unknown[]) => saveSnapshot(...a) }))

import { saveSnapshot as bridgeSave } from "@/bridge/wsBridgeClient"
import { scheduleFolderSnapshot } from "@/services/folderSync"

afterEach(() => { saveSnapshot.mockReset(); vi.restoreAllMocks(); vi.useRealTimers() })

describe("snapshot save never rejects unhandled", () => {
  it("bridge: a rejected save warns and resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    saveSnapshot.mockRejectedValue(new Error("quota"))
    await expect(bridgeSave("a.wgsl", "x")).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith("[snapshot] save failed", expect.any(Error))
  })

  it("bridge: a successful save passes path and content through without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    saveSnapshot.mockResolvedValue(undefined)
    await bridgeSave("a.wgsl", "x")
    expect(saveSnapshot).toHaveBeenCalledWith("a.wgsl", "x")
    expect(warn).not.toHaveBeenCalled()
  })

  it("folderSync: a rejected save warns and does not leave an unhandled rejection", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    saveSnapshot.mockRejectedValue(new Error("idb closed"))
    scheduleFolderSnapshot("b.wgsl", "y")
    await vi.advanceTimersByTimeAsync(6000)
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 10))
    process.off("unhandledRejection", unhandled)
    expect(warn).toHaveBeenCalledWith("[snapshot] save failed", expect.any(Error))
    expect(unhandled).not.toHaveBeenCalled()
  })
})
