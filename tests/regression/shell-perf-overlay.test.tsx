// @vitest-environment happy-dom
import "../setup/rtl"
import { describe, it, expect, beforeEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { PerfOverlay } from "@/components/PerfOverlay"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { useTransportStore } from "@/stores/transportStore"

describe("PerfOverlay", () => {
  beforeEach(() => performanceTelemetry.reset())

  it("shows live FPS while playing and Paused (no stale number) while stopped", () => {
    useTransportStore.setState({ isPlaying: true })
    render(<PerfOverlay />)
    expect(screen.getByText("FPS")).toBeTruthy()
    expect(screen.queryByText("Paused")).toBeNull()
    act(() => useTransportStore.setState({ isPlaying: false }))
    expect(screen.getByText("Paused")).toBeTruthy()
    expect(screen.queryByText("FPS")).toBeNull()
  })

  it("holds a single throttled telemetry subscription and releases it on unmount", () => {
    const { unmount } = render(<PerfOverlay />)
    expect(performanceTelemetry.getSubscriberCount()).toBe(1)
    unmount()
    expect(performanceTelemetry.getSubscriberCount()).toBe(0)
  })
})
