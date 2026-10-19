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
      const next = !get().isPlaying
      set({ isPlaying: next })
      renderCoordinator.setPlaying(next)
    },

    setIsPlaying: (playing: boolean) => {
      set({ isPlaying: playing })
      renderCoordinator.setPlaying(playing)
    },

    seek: (timeSeconds: number) => {
      const duration = get().duration
      const safeTime = Math.max(0.0, Math.min(timeSeconds, duration > 0 ? duration : Infinity))
      set({ playbackTime: safeTime, currentTime: safeTime })
      renderCoordinator.seek(safeTime)
    },

    setCurrentTime: (timeSeconds: number) => {
      get().seek(timeSeconds)
    },

    resetTime: () => {
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
      return formatTime(get().playbackTime)
    },
  }
})

// SSR and Test Parity
useTransportStore.getInitialState = () => useTransportStore.getState()

// Sync virtual playback clock from renderCoordinator to transportStore
renderCoordinator.onTimeUpdate((time: number) => {
  const current = useTransportStore.getState().playbackTime
  // Avoid redundant state sets if time is identical
  if (Math.abs(current - time) > 0.0001) {
    useTransportStore.setState({ playbackTime: time, currentTime: time })
  }
})
