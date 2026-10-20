import type { AudioEngine } from "./audioEngine"
import { renderCoordinator } from "@/core/renderCoordinator"

// The audio engine is a lazy chunk: it calls registerAudioEngine() when first evaluated, which also
// hands it to the render coordinator. Everything else reads it through getAudioEngine()/loadAudioEngine().
let engine: AudioEngine | null = null
let loading: Promise<AudioEngine> | null = null

export function registerAudioEngine(e: AudioEngine): void {
  engine = e
  renderCoordinator.setAudioSource(e)
}

/** The engine if its chunk has already loaded, else null. */
export function getAudioEngine(): AudioEngine | null {
  return engine
}

/** Loads the audio chunk on first use. */
export function loadAudioEngine(): Promise<AudioEngine> {
  return (loading ??= import("./audioEngine").then(
    (m) => m.audioEngine,
    (err) => {
      loading = null // drop the rejected promise so a later call retries the chunk load
      throw err
    },
  ))
}

/** Runs `fn` now if the engine is loaded, otherwise once its chunk arrives. */
export function withAudioEngine(fn: (e: AudioEngine) => void): void {
  const e = engine
  if (e) fn(e)
  else loadAudioEngine().then(fn, (err) => console.error("[audio] engine chunk failed to load", err))
}
