import { create } from "zustand"
import { renderCoordinator } from "@/core/renderCoordinator"

export type ResolutionScale = 0.5 | 1 | 2 | "native"

export interface TransportState {
  isPlaying: boolean
  playbackTime: number // in seconds
  currentTime: number // alias for playbackTime for harness compatibility
  playbackSpeed: number // 1.0 = normal
  duration: number // default loop timeline duration in seconds
  resolutionScale: ResolutionScale

  // Actions
  togglePlay: () => void
  setIsPlaying: (playing: boolean) => void
  seek: (timeSeconds: number) => void
  resetTime: () => void
  setPlaybackSpeed: (speed: number) => void
  setResolutionScale: (scale: ResolutionScale) => void
  setDuration: (duration: number) => void
  setCurrentTime: (timeSeconds: number) => void
  getEffectiveDpr: (hostDpr?: number) => number
  getFormattedTime: () => string
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  const minsStr = String(mins).padStart(2, "0")
  const secsStr = secs.toFixed(2).padStart(5, "0")
  return `${minsStr}:${secsStr}`
}

function clampResolutionScale(scale: ResolutionScale): ResolutionScale {
  if (scale === 0.5 || scale === 1 || scale === 2 || scale === "native") {
    return scale
  }
  const numeric = Number(scale)
  if (Number.isNaN(numeric)) return 1
  if (numeric <= 0.5) return 0.5
  if (numeric >= 2.0) return 2
  return 1
}

/** Last time value mirrored into the store; see the throttled sync at the bottom of this file. */
let lastSyncedTime = 0

export const useTransportStore = create<TransportState>((set, get, api) => {
  api.getInitialState = () => api.getState()

  return {
    isPlaying: true,
    playbackTime: 0.0,
    currentTime: 0.0,
    playbackSpeed: 1.0,
    duration: 300.0,
    resolutionScale: 1,

    togglePlay: () => {
      get().setIsPlaying(!get().isPlaying)
    },

    setIsPlaying: (playing: boolean) => {
      renderCoordinator.setPlaying(playing)
      // Time is only mirrored (throttled) while playing, so snap the store to the coordinator's clock now.
      const t = renderCoordinator.getPlaybackTime()
      lastSyncedTime = t
      set({ isPlaying: playing, playbackTime: t, currentTime: t })
    },

    seek: (timeSeconds: number) => {
      const duration = get().duration
      const safeTime = Math.max(0.0, Math.min(timeSeconds, duration > 0 ? duration : Infinity))
      lastSyncedTime = safeTime
      set({ playbackTime: safeTime, currentTime: safeTime })
      renderCoordinator.seek(safeTime)
    },

    setCurrentTime: (timeSeconds: number) => {
      get().seek(timeSeconds)
    },

    resetTime: () => {
      lastSyncedTime = 0
      set({ playbackTime: 0.0, currentTime: 0.0 })
      renderCoordinator.resetTime()
    },

    setPlaybackSpeed: (speed: number) => {
      const safeSpeed = Math.max(0.1, Math.min(speed, 10.0))
      set({ playbackSpeed: safeSpeed })
      renderCoordinator.setPlaybackSpeed(safeSpeed)
    },

    setResolutionScale: (scale: ResolutionScale) => {
      const clamped = clampResolutionScale(scale)
      set({ resolutionScale: clamped })
    },

    setDuration: (duration: number) => {
      const safeDuration = Math.max(0.1, duration)
      set({ duration: safeDuration })
      if (get().playbackTime > safeDuration) {
        get().seek(safeDuration)
      }
    },

    getEffectiveDpr: (hostDpr = 1.0) => {
      const scale = get().resolutionScale
      if (scale === "native") {
        return Math.min(hostDpr, 2.0)
      }
      const targetScale = typeof scale === "number" ? scale : 1.0
      return Math.min(targetScale, 2.0)
    },

    getFormattedTime: () => {
      return formatTime(renderCoordinator.getPlaybackTime())
    },
  }
})

// SSR and Test Parity
useTransportStore.getInitialState = () => useTransportStore.getState()

// The coordinator owns the authoritative clock (renderCoordinator.getPlaybackTime()). The store only
// mirrors it ~10Hz (wall-clock equivalent: the threshold scales with playback speed) for UI readers,
// instead of writing zustand state every frame.
renderCoordinator.onTimeUpdate((time: number) => {
  const threshold = 0.1 * renderCoordinator.getPlaybackSpeed()
  if (Math.abs(time - lastSyncedTime) >= threshold || time < lastSyncedTime) {
    lastSyncedTime = time
    useTransportStore.setState({ playbackTime: time, currentTime: time })
  }
})
