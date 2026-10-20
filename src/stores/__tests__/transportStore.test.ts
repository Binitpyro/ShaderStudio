import { describe, it, expect, beforeEach } from "vitest"
import { useTransportStore, formatTime } from "../transportStore"
import { renderCoordinator } from "@/core/renderCoordinator"

describe("transportStore (Requirement R2)", () => {
  beforeEach(() => {
    useTransportStore.setState({
      isPlaying: true,
      playbackTime: 0.0,
      currentTime: 0.0,
      playbackSpeed: 1.0,
      duration: 300.0,
      resolutionScale: 1,
    })
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.setPlaybackSpeed(1.0)
  })

  it("initializes with default transport state", () => {
    const state = useTransportStore.getState()
    expect(state.isPlaying).toBe(true)
    expect(state.playbackTime).toBe(0.0)
    expect(state.currentTime).toBe(0.0)
    expect(state.playbackSpeed).toBe(1.0)
    expect(state.duration).toBe(300.0)
    expect(state.resolutionScale).toBe(1)
  })

  it("exposes getInitialState for SSR/test parity", () => {
    expect(typeof useTransportStore.getInitialState).toBe("function")
    const initial = useTransportStore.getInitialState()
    expect(initial.playbackTime).toBe(0.0)
    expect(initial.isPlaying).toBe(true)
  })

  it("toggles play/pause and synchronizes with renderCoordinator", () => {
    const { togglePlay } = useTransportStore.getState()

    // Toggle to pause
    togglePlay()
    expect(useTransportStore.getState().isPlaying).toBe(false)
    expect(renderCoordinator.getIsPlaying()).toBe(false)

    // Toggle back to play
    togglePlay()
    expect(useTransportStore.getState().isPlaying).toBe(true)
    expect(renderCoordinator.getIsPlaying()).toBe(true)
  })

  it("sets isPlaying explicitly and updates coordinator", () => {
    const { setIsPlaying } = useTransportStore.getState()

    setIsPlaying(false)
    expect(useTransportStore.getState().isPlaying).toBe(false)
    expect(renderCoordinator.getIsPlaying()).toBe(false)

    setIsPlaying(true)
    expect(useTransportStore.getState().isPlaying).toBe(true)
    expect(renderCoordinator.getIsPlaying()).toBe(true)
  })

  it("seeks timeline to specified time in seconds and syncs with coordinator", () => {
    const { seek } = useTransportStore.getState()

    seek(15.5)
    expect(useTransportStore.getState().playbackTime).toBe(15.5)
    expect(useTransportStore.getState().currentTime).toBe(15.5)
    expect(renderCoordinator.getPlaybackTime()).toBe(15.5)
  })

  it("clamps negative time scrub values to 0.00s", () => {
    const { seek } = useTransportStore.getState()

    seek(-25.0)
    expect(useTransportStore.getState().playbackTime).toBe(0.0)
    expect(useTransportStore.getState().currentTime).toBe(0.0)
    expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
  })

  it("clamps forward scrub values beyond duration to timeline end", () => {
    const { seek, setDuration } = useTransportStore.getState()

    setDuration(60.0)
    seek(120.0)
    expect(useTransportStore.getState().playbackTime).toBe(60.0)
    expect(useTransportStore.getState().currentTime).toBe(60.0)
    expect(renderCoordinator.getPlaybackTime()).toBe(60.0)
  })

  it("seeking while paused does not accidentally restart playback", () => {
    const { setIsPlaying, seek } = useTransportStore.getState()

    setIsPlaying(false)
    expect(useTransportStore.getState().isPlaying).toBe(false)

    seek(42.0)
    expect(useTransportStore.getState().playbackTime).toBe(42.0)
    expect(useTransportStore.getState().isPlaying).toBe(false)
    expect(renderCoordinator.getIsPlaying()).toBe(false)
  })

  it("resets time (t=0) and triggers immediate redraw", () => {
    const { seek, resetTime } = useTransportStore.getState()

    seek(88.5)
    expect(useTransportStore.getState().playbackTime).toBe(88.5)

    let redrawCalled = false
    let redrawTime = -1
    const unsub = renderCoordinator.onRenderFrame((time, isSeek) => {
      redrawCalled = true
      redrawTime = time
      expect(isSeek).toBe(true)
    })

    resetTime()
    expect(useTransportStore.getState().playbackTime).toBe(0.0)
    expect(useTransportStore.getState().currentTime).toBe(0.0)
    expect(renderCoordinator.getPlaybackTime()).toBe(0.0)
    expect(redrawCalled).toBe(true)
    expect(redrawTime).toBe(0.0)

    unsub()
  })

  it("sets playbackSpeed within safe boundaries [0.1, 10.0]", () => {
    const { setPlaybackSpeed } = useTransportStore.getState()

    setPlaybackSpeed(2.5)
    expect(useTransportStore.getState().playbackSpeed).toBe(2.5)
    expect(renderCoordinator.getPlaybackSpeed()).toBe(2.5)

    // Clamps below 0.1
    setPlaybackSpeed(-5.0)
    expect(useTransportStore.getState().playbackSpeed).toBe(0.1)

    // Clamps above 10.0
    setPlaybackSpeed(50.0)
    expect(useTransportStore.getState().playbackSpeed).toBe(10.0)
  })

  it("sets resolutionScale and sanitizes unexpected inputs", () => {
    const { setResolutionScale } = useTransportStore.getState()

    // 0.5x scale
    setResolutionScale(0.5)
    expect(useTransportStore.getState().resolutionScale).toBe(0.5)

    // 2x scale
    setResolutionScale(2)
    expect(useTransportStore.getState().resolutionScale).toBe(2)

    // Native scale
    setResolutionScale("native")
    expect(useTransportStore.getState().resolutionScale).toBe("native")

    // Out of bounds inputs
    setResolutionScale(-10 as any)
    expect(useTransportStore.getState().resolutionScale).toBe(0.5)

    setResolutionScale(100 as any)
    expect(useTransportStore.getState().resolutionScale).toBe(2)
  })

  it("calculates effective DPR multiplier with 2.0 guardrail on high-DPI screens", () => {
    const { setResolutionScale, getEffectiveDpr } = useTransportStore.getState()

    // 1x scale
    setResolutionScale(1)
    expect(getEffectiveDpr(1.0)).toBe(1.0)
    expect(getEffectiveDpr(2.0)).toBe(1.0)

    // 0.5x scale
    setResolutionScale(0.5)
    expect(getEffectiveDpr(1.0)).toBe(0.5)

    // 2x scale
    setResolutionScale(2)
    expect(getEffectiveDpr(1.0)).toBe(2.0)

    // Native scale on standard display (1.5 DPR)
    setResolutionScale("native")
    expect(getEffectiveDpr(1.5)).toBe(1.5)

    // Native scale on ultra-dense display (3.5 DPR capped to 2.0)
    expect(getEffectiveDpr(3.5)).toBe(2.0)
  })

  it("formats time into digital MM:SS.ss display", () => {
    expect(formatTime(0)).toBe("00:00.00")
    expect(formatTime(5.32)).toBe("00:05.32")
    expect(formatTime(65.42)).toBe("01:05.42")
    expect(formatTime(125.0)).toBe("02:05.00")
    expect(formatTime(-10)).toBe("00:00.00")
  })

  it("synchronizes live virtual time ticks from renderCoordinator", () => {
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)

    // Step coordinator
    renderCoordinator.tick(1000)
    renderCoordinator.tick(1100) // delta = 100ms (the per-frame cap) -> virtual time ~= 0.1s

    const state = useTransportStore.getState()
    expect(state.playbackTime).toBeCloseTo(0.1, 2)
    expect(state.currentTime).toBeCloseTo(0.1, 2)
  })

  it("does not write the store every frame: ~10Hz mirror, coordinator holds the authoritative clock", () => {
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    let writes = 0
    const unsub = useTransportStore.subscribe(() => { writes++ })
    renderCoordinator.tick(1000)
    for (let i = 1; i <= 120; i++) renderCoordinator.tick(1000 + i * 16.667) // 2s at 60fps
    unsub()

    expect(renderCoordinator.getPlaybackTime()).toBeGreaterThan(1.9) // authoritative time advances every frame
    expect(writes).toBeLessThanOrEqual(22) // ~10 writes/s, not 120
    expect(writes).toBeGreaterThanOrEqual(15)
    expect(Math.abs(useTransportStore.getState().playbackTime - renderCoordinator.getPlaybackTime())).toBeLessThan(0.11)
    expect(useTransportStore.getState().getFormattedTime()).toBe(formatTime(renderCoordinator.getPlaybackTime()))
  })

  it("snaps the store to the coordinator clock when playback pauses", () => {
    renderCoordinator.resetTime()
    renderCoordinator.setPlaying(true)
    renderCoordinator.tick(1000)
    renderCoordinator.tick(1050) // 50ms: below the 100ms mirror threshold
    useTransportStore.getState().setIsPlaying(false)
    expect(useTransportStore.getState().playbackTime).toBeCloseTo(renderCoordinator.getPlaybackTime(), 6)
  })
})
