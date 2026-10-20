// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

vi.mock("@/db", () => ({ saveSnapshot: vi.fn(async () => {}) }))

import { connect, disconnect, bridgeNeedsToken, getBridgeToken, setBridgeToken } from "@/bridge/wsBridgeClient"
import { SyncStatusBanner } from "@/components/SyncStatusBanner"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { viewportCapture } from "@/utils/frameCapture"
import { renderCoordinator } from "@/core/renderCoordinator"

class FakeWS {
  static instances: FakeWS[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: unknown = null
  constructor(public url: string) { FakeWS.instances.push(this) }
  send() {}
  close() {}
}

describe("bridge 4401 token flow", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWS.instances = []
    vi.stubGlobal("WebSocket", FakeWS)
    window.localStorage.clear()
    setBridgeToken(null)
    useFileSystemStore.setState({ syncMode: "local", bridgeConnected: false })
  })
  afterEach(() => {
    disconnect()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("stops retrying on close code 4401 and shows the token prompt", async () => {
    connect()
    expect(FakeWS.instances).toHaveLength(1)
    act(() => FakeWS.instances[0].onclose?.({ code: 4401 }))
    expect(bridgeNeedsToken()).toBe(true)

    await vi.advanceTimersByTimeAsync(120_000) // would have reconnected many times with backoff
    expect(FakeWS.instances).toHaveLength(1)

    render(<SyncStatusBanner />)
    expect(screen.getByText("Bridge needs a token")).toBeTruthy()
  })

  it("pasting a token stores it, reconnects with it and clears the prompt on open", () => {
    connect()
    act(() => FakeWS.instances[0].onclose?.({ code: 4401 }))
    render(<SyncStatusBanner />)

    fireEvent.change(screen.getByLabelText("Bridge token"), { target: { value: "  s3cret  " } })
    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    expect(window.localStorage.getItem("shaderstudio_bridge_token")).toBe("s3cret")
    expect(FakeWS.instances).toHaveLength(2)
    expect(FakeWS.instances[1].url).toContain("token=s3cret")
    act(() => { FakeWS.instances[1].readyState = 1; FakeWS.instances[1].onopen?.() })
    expect(bridgeNeedsToken()).toBe(false)
    expect(screen.queryByText("Bridge needs a token")).toBeNull()
  })

  it("Retry reconnects with the stored token", () => {
    setBridgeToken("saved")
    connect()
    act(() => FakeWS.instances[0].onclose?.({ code: 4401 }))
    render(<SyncStatusBanner />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(FakeWS.instances).toHaveLength(2)
    expect(FakeWS.instances[1].url).toContain("token=saved")
  })

  it("non-auth closes still back off and reconnect", async () => {
    connect()
    act(() => FakeWS.instances[0].onclose?.({ code: 1006 }))
    expect(bridgeNeedsToken()).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(FakeWS.instances).toHaveLength(2)
  })

  it("reads ?token= from the URL, persists it and strips it from the address bar", () => {
    window.history.replaceState(null, "", "/app?token=abc123&keep=1")
    expect(getBridgeToken()).toBe("abc123")
    expect(window.location.search).toBe("?keep=1")
    expect(window.localStorage.getItem("shaderstudio_bridge_token")).toBe("abc123")
  })
})

describe("bridge agent:capture", () => {
  it("answers with a frame from captureFrameBase64, not the raw canvas", async () => {
    vi.stubGlobal("WebSocket", FakeWS)
    FakeWS.instances = []
    connect()
    const sock = FakeWS.instances[0] as FakeWS & { sent: string[] }
    sock.sent = []
    sock.send = (m: string) => { sock.sent.push(m) }
    sock.readyState = 1
    const cap = vi.spyOn(viewportCapture, "captureFrameBase64").mockResolvedValue("data:image/png;base64,QQ==")
    const raw = vi.spyOn(viewportCapture, "captureBase64")
    await (sock.onmessage as (e: { data: string }) => Promise<void>)({ data: JSON.stringify({ type: "agent:capture", id: "c1" }) })
    expect(cap).toHaveBeenCalledTimes(1)
    expect(raw).not.toHaveBeenCalled()
    expect(JSON.parse(sock.sent[0]).screenshotBase64).toBe("data:image/png;base64,QQ==")
    cap.mockRestore()
    raw.mockRestore()
    disconnect()
    vi.unstubAllGlobals()
  })
})

describe("frame capture", () => {
  it("captureFrameBase64 goes through renderCoordinator.captureNextFrame (never the raw canvas)", async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
    const next = vi.spyOn(renderCoordinator, "captureNextFrame").mockResolvedValue(blob)
    const raw = vi.spyOn(viewportCapture, "captureBase64")
    const url = await viewportCapture.captureFrameBase64()
    expect(next).toHaveBeenCalledTimes(1)
    expect(raw).not.toHaveBeenCalled()
    expect(url).toMatch(/^data:image\/png;base64,/)
    next.mockRestore()
  })

  it("resolves null when the capture fails", async () => {
    const next = vi.spyOn(renderCoordinator, "captureNextFrame").mockRejectedValue(new Error("no canvas"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await viewportCapture.captureFrameBase64()).toBeNull()
    next.mockRestore()
  })
})
