import { useCallback, useEffect, useRef } from "react"
import { getAudioEngine } from "@/audio/audioRegistry"
import { renderCoordinator } from "@/core/renderCoordinator"

export const CANVAS_HZ = 30
export const GAUGE_HZ = 15

/**
 * Runs `draw` from the render coordinator's frame (no own rAF), throttled to `hz`,
 * only while `active`. On deactivate/unmount it unregisters and runs `draw` once more (final/idle state).
 */
export function useThrottledAudioFrame(id: string, active: boolean, hz: number, draw: () => void) {
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    if (!active) {
      drawRef.current()
      return
    }
    const minMs = 1000 / hz
    let last = -Infinity
    renderCoordinator.registerPreRenderHook(id, () => {
      const now = performance.now()
      if (now - last < minMs) return
      last = now
      drawRef.current()
    })
    return () => {
      renderCoordinator.unregisterPreRenderHook(id)
    }
  }, [id, active, hz])
}

export type GaugeKey = "bass" | "mid" | "treble" | "beat" | "level"
const KEYS: GaugeKey[] = ["bass", "mid", "treble", "beat", "level"]

/** Gauge text/bar elements updated straight from audioEngine.uniforms (no React state). Spread `text(k)` / `bar(k)` into `ref`. */
export function useAudioGauges(id: string, active: boolean) {
  const els = useRef<Record<string, HTMLElement | null>>({})
  const refs = useRef<Record<string, (el: HTMLElement | null) => void>>({})
  const ref = useCallback((name: string) => {
    return (refs.current[name] ??= (el) => {
      els.current[name] = el
    })
  }, [])
  useThrottledAudioFrame(id, active, GAUGE_HZ, () => {
    const u = getAudioEngine()?.uniforms
    if (!u) return
    for (const k of KEYS) {
      const pct = active ? Math.min(100, Math.round(u[k] * 100)) : 0
      const t = els.current[`${k}-text`]
      const b = els.current[`${k}-bar`]
      if (t) t.textContent = `${pct}%`
      if (b) b.style.width = `${pct}%`
    }
  })
  return { text: (k: GaugeKey) => ref(`${k}-text`), bar: (k: GaugeKey) => ref(`${k}-bar`) }
}
