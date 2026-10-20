import { audioEngine } from "@/audio/audioEngine"
import type { RenderAdapter } from "@/adapters/types"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { viewportCapture } from "@/utils/frameCapture"

/** Largest simulated delta per frame; background-tab resumes would otherwise explode time/particles. */
export const MAX_DELTA_MS = 100
const LOG_CAPACITY = 300
/** Frames drawn after `requestRender()` so async pipeline/uniform work lands before the loop idles. */
const ON_DEMAND_FRAMES = 2

export type FramePhase = "clock" | "audio" | "modulation" | "draw" | "telemetry"

export interface PerformanceMetrics {
  fps: number
  frameTimeMs: number
  activeCallbacks: number
  drawCalls: number
  currentTime?: number
  isPlaying?: boolean
}

export interface RenderAdapterContract {
  renderFrame(time: number, delta: number): void
  dispose(): void
  setExternalLoopDriven?(external: boolean): void
}

/**
 * RenderCoordinator — Single Authoritative requestAnimationFrame Loop
 *
 * Implements strict 5-phase execution order:
 * Phase 1: Clock (delta time calculation & virtual time accumulation)
 * Phase 2: Audio (audioEngine.update)
 * Phase 3: Modulation (pre-render hooks for audio uniforms)
 * Phase 4: Draw (active adapter renderFrame with virtual time)
 * Phase 5: Telemetry (metrics computation & subscriber notification)
 *
 * While playing it draws every frame. While paused it renders on demand: the rAF chain stops
 * entirely until `requestRender()` (or play/seek/continuous-render) wakes it.
 */
/** Handle for an in-flight or completed `mountAdapter` call. */
export interface AdapterMountSession {
  /** Resolves true once the adapter is mounted AND driving the coordinator; false if it failed or was cancelled. */
  done: Promise<boolean>
  /** Releases everything this session owns. Safe at any time, including while the mount is still pending. */
  cancel(): void
}

export class RenderCoordinator {
  private mountChain: Promise<void> = Promise.resolve()
  private activeAdapter: RenderAdapterContract | RenderAdapter | null = null
  private preRenderHooks = new Map<string, (time: number, delta: number) => void>()
  private metricsSubscribers = new Set<(metrics: PerformanceMetrics) => void>()
  private timeSubscribers = new Set<(time: number) => void>()
  private renderFrameSubscribers = new Set<(time: number, isSeek: boolean) => void>()
  private isRunning = false
  private rafId: number | null = null
  private lastTime = 0
  private frameCount = 0
  private executedPhases: FramePhase[] = []
  // Preallocated ring buffer for the phase log (no per-frame allocation or shift()).
  private logRing: Array<{ phase: FramePhase; timestamp: number }> = Array.from(
    { length: LOG_CAPACITY },
    () => ({ phase: "clock" as FramePhase, timestamp: 0 }),
  )
  private logHead = 0
  private logCount = 0
  private warnedLabels = new Set<string>()
  private lastDelta = 0
  private resumedFromIdle = false
  private inFrame = false
  private dirtyFrames = 0
  private continuousKeys = new Set<string>()
  private captureQueue: Array<{ resolve: (b: Blob) => void; reject: (e: Error) => void }> = []

  // Virtual Playback Clock (Decoupled from wall-clock performance.now())
  private playbackTime = 0.0 // in seconds
  private isPlaying = true
  private playbackSpeed = 1.0
  private singleFrameRenderCount = 0

  /**
   * Mounts `adapter` and makes this coordinator its sole loop driver.
   *
   * - The adapter is marked externally driven BEFORE `mount`, so it never starts its own rAF loop.
   * - Mounts are serialized: adapters are singletons, so two overlapping mounts (StrictMode
   *   double-effect, rapid backend switching) would otherwise interleave on the same GPU device.
   * - Generation guard: if `cancel()` runs while the mount is pending, the mount continuation
   *   disposes the resources it just created instead of leaking a device and a stray loop.
   */
  mountAdapter(
    adapter: RenderAdapter,
    canvas: HTMLCanvasElement,
    afterMount?: (adapter: RenderAdapter) => void,
  ): AdapterMountSession {
    let cancelled = false
    let live = false
    const disposeQuietly = () => this.guard("adapter.dispose", () => adapter.dispose())
    const done = this.mountChain.then(async (): Promise<boolean> => {
      if (cancelled) return false
      adapter.setExternalLoopDriven?.(true)
      let ok = false
      try {
        ok = await adapter.mount(canvas)
      } catch (err) {
        console.warn("[RenderCoordinator] adapter mount failed:", err)
      }
      if (cancelled || !ok) {
        disposeQuietly() // we own whatever the mount created; nobody else mounts concurrently
        return false
      }
      live = true
      this.guard("afterMount", () => afterMount?.(adapter))
      this.setActiveAdapter(adapter)
      this.start()
      return true
    })
    this.mountChain = done.then(() => undefined, () => undefined)
    return {
      done,
      cancel: () => {
        if (cancelled) return
        cancelled = true
        if (!live) return // pending mount disposes its own resources when it settles
        live = false
        this.stop()
        disposeQuietly()
        if (this.activeAdapter === adapter) this.setActiveAdapter(null)
      },
    }
  }

  setActiveAdapter(adapter: RenderAdapterContract | RenderAdapter | null): void {
    if (this.activeAdapter && typeof (this.activeAdapter as any).setExternalLoopDriven === "function") {
      (this.activeAdapter as any).setExternalLoopDriven(false)
    }
    this.activeAdapter = adapter
    performanceTelemetry.resetFrameStats()
    if (adapter && typeof (adapter as any).setExternalLoopDriven === "function") {
      (adapter as any).setExternalLoopDriven(true)
    }
    if (adapter) this.requestRender()
  }

  getActiveAdapter(): RenderAdapterContract | RenderAdapter | null {
    return this.activeAdapter
  }

  registerPreRenderHook(id: string, fn: (time: number, delta: number) => void): void {
    this.preRenderHooks.set(id, fn)
  }

  unregisterPreRenderHook(id: string): void {
    this.preRenderHooks.delete(id)
  }

  onMetrics(fn: (metrics: PerformanceMetrics) => void): () => void {
    this.metricsSubscribers.add(fn)
    return () => this.metricsSubscribers.delete(fn)
  }

  onTimeUpdate(fn: (time: number) => void): () => void {
    this.timeSubscribers.add(fn)
    return () => this.timeSubscribers.delete(fn)
  }

  onRenderFrame(fn: (time: number, isSeek: boolean) => void): () => void {
    this.renderFrameSubscribers.add(fn)
    return () => this.renderFrameSubscribers.delete(fn)
  }

  setPlaying(playing: boolean): void {
    if (playing && !this.isPlaying) {
      this.lastTime = performance.now()
    }
    this.isPlaying = playing
    // Playing resumes the loop; pausing draws the final frame(s) and then lets the loop idle.
    this.requestRender()
  }

  setIsPlaying(playing: boolean): void {
    this.setPlaying(playing)
  }

  getIsPlaying(): boolean {
    return this.isPlaying
  }

  getPlaybackTime(): number {
    return this.playbackTime
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed
  }

  getSingleFrameRenderCount(): number {
    return this.singleFrameRenderCount
  }

  /** Delta (ms) given to adapters on the last frame: 0 while paused, capped at MAX_DELTA_MS. */
  getLastDelta(): number {
    return this.lastDelta
  }

  /**
   * Schedules a redraw. While paused the loop idles (no rAF at all) until something calls this:
   * uniform updates, resize, recompile, camera interaction, render-settings changes.
   */
  requestRender(): void {
    if (this.inFrame) return // changes made during a frame (hooks) are consumed by that frame's draw
    this.dirtyFrames = ON_DEMAND_FRAMES
    if (this.isRunning && this.rafId === null) this.scheduleTick()
  }

  /** Keeps the loop drawing every frame even when paused (e.g. live audio modulation). */
  setContinuousRender(key: string, on: boolean): void {
    if (on) {
      this.continuousKeys.add(key)
      this.requestRender()
    } else {
      this.continuousKeys.delete(key)
    }
  }

  /**
   * Resolves with a PNG of the NEXT drawn frame, captured immediately after the draw call in the
   * same task. WebGL2/Three lack preserveDrawingBuffer, so capturing outside the loop is blank.
   */
  captureNextFrame(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.captureQueue.push({ resolve, reject })
      if (this.isRunning) this.requestRender()
      else this.renderImmediate()
    })
  }

  private flushCaptures(): void {
    if (this.captureQueue.length === 0) return
    const pending = this.captureQueue
    this.captureQueue = []
    // toBlob snapshots the canvas synchronously, i.e. before the drawing buffer is cleared.
    void viewportCapture.captureBlob().then(
      (blob) => {
        for (const p of pending) {
          if (blob) p.resolve(blob)
          else p.reject(new Error("Frame capture failed: no canvas or empty frame"))
        }
      },
      (e) => {
        for (const p of pending) p.reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  }

  private needsFrame(): boolean {
    return this.isPlaying || this.dirtyFrames > 0 || this.continuousKeys.size > 0 || this.captureQueue.length > 0
  }

  /** Runs a hook/subscriber so one failure never skips the draw or starves later subscribers. */
  private guard(label: string, fn: () => void): void {
    try {
      fn()
    } catch (e) {
      this.warnOnce(label, e)
    }
  }

  /** Logs the first failure per label; the per-frame paths call this from an inline catch (no closure per frame). */
  private warnOnce(label: string, e: unknown): void {
    if (this.warnedLabels.has(label)) return
    this.warnedLabels.add(label)
    console.warn(`[RenderCoordinator] ${label} threw (further errors from it suppressed):`, e)
  }

  // Hot-path helpers: bound once so a frame allocates no closures or Map iterators.
  private hookTimeMs = 0
  private hookDeltaMs = 0
  private readonly runHook = (hook: (time: number, delta: number) => void, id: string): void => {
    try {
      hook(this.hookTimeMs, this.hookDeltaMs)
    } catch (e) {
      this.warnOnce(`pre-render hook "${id}"`, e)
    }
  }

  private runPreRenderHooks(timeMs: number, deltaMs: number): void {
    this.hookTimeMs = timeMs
    this.hookDeltaMs = deltaMs
    this.preRenderHooks.forEach(this.runHook)
  }

  private drawActive(timeMs: number, deltaMs: number): void {
    const a = this.activeAdapter as any
    if (!a || typeof a.renderFrame !== "function") return
    try {
      a.renderFrame(timeMs, deltaMs)
    } catch (e) {
      this.warnOnce("adapter.renderFrame", e)
    }
  }

  seek(timeInSeconds: number): void {
    this.playbackTime = Math.max(0, timeInSeconds)
    this.singleFrameRenderCount++
    this.notifyTimeSubscribers()
    this.renderImmediate()
  }

  resetTime(): void {
    this.lastTime = 0
    this.seek(0)
  }

  renderImmediate(): void {
    const wasInFrame = this.inFrame
    this.inFrame = true
    try {
      this.renderImmediateInner()
    } finally {
      this.inFrame = wasInFrame
    }
  }

  private renderImmediateInner(): void {
    const virtualTimeMs = this.playbackTime * 1000
    this.runPreRenderHooks(virtualTimeMs, 0)
    this.drawActive(virtualTimeMs, 0)
    this.broadcastRenderFrame(this.playbackTime, true)
    this.flushCaptures()
  }

  private notifyTimeSubscribers(): void {
    for (const sub of this.timeSubscribers) {
      this.guard("time subscriber", () => sub(this.playbackTime))
    }
  }

  private broadcastRenderFrame(time: number, isSeek: boolean): void {
    for (const sub of this.renderFrameSubscribers) {
      this.guard("render-frame subscriber", () => sub(time, isSeek))
    }
  }

  start(): void {
    if (this.isRunning && this.rafId !== null) return
    this.isRunning = true
    this.lastTime = performance.now()
    this.dirtyFrames = ON_DEMAND_FRAMES // always draw a first frame
    this.scheduleTick()
  }

  stop(): void {
    this.isRunning = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private scheduleTick(): void {
    if (!this.isRunning || this.rafId !== null) return
    this.rafId = requestAnimationFrame(this.onRaf)
  }

  private readonly onRaf = (now: number): void => {
    this.rafId = null
    try {
      this.tick(now)
    } finally {
      if (this.isRunning && this.rafId === null) {
        if (this.needsFrame()) this.scheduleTick()
        else {
          this.lastTime = 0 // loop idles; the next frame must not see the idle gap as a delta
          this.resumedFromIdle = true
        }
      }
    }
  }

  /**
   * Authoritative 5-phase frame execution
   */
  tick(now: number): void {
    this.inFrame = true
    try {
      this.runFrame(now)
    } finally {
      this.inFrame = false
    }
  }

  private runFrame(now: number): void {
    const rawDelta = Math.max(1, now - (this.lastTime || now))
    this.lastTime = now
    if (!this.needsFrame()) return // paused and nothing changed: render on demand only
    if (!this.isPlaying && this.dirtyFrames > 0) this.dirtyFrames--
    const delta = Math.min(rawDelta, MAX_DELTA_MS)
    const effectiveDelta = this.isPlaying ? delta : 0
    this.lastDelta = effectiveDelta
    this.frameCount++
    this.executedPhases.length = 0

    // Phase 1: Frame Timing (Clock)
    this.recordPhase("clock", now)
    if (this.isPlaying) {
      this.playbackTime += (delta / 1000) * this.playbackSpeed
    }
    const virtualTimeMs = this.playbackTime * 1000

    // Phase 2: Audio Engine Update
    this.recordPhase("audio", now)
    try {
      if (typeof audioEngine !== "undefined" && audioEngine?.update) {
        const audioData = audioEngine.update()
        if (this.activeAdapter && typeof (this.activeAdapter as any).updateAudioData === "function") {
          (this.activeAdapter as any).updateAudioData(audioData.textureBuffer, audioData.uniforms)
        }
      }
    } catch (e) {
      // Audio engine update may fail in headless/uninitialized environments: log once, never skip the draw.
      this.warnOnce("audio engine update", e)
    }

    // Phase 3: Pre-Render Hooks (Audio Uniform Modulation)
    this.recordPhase("modulation", now)
    this.runPreRenderHooks(virtualTimeMs, effectiveDelta)

    // Phase 4: Active Adapter Render
    this.recordPhase("draw", now)
    this.drawActive(virtualTimeMs, effectiveDelta)
    this.broadcastRenderFrame(this.playbackTime, false)
    this.flushCaptures()

    // Phase 5: Post-Render Metrics & Telemetry
    this.recordPhase("telemetry", now)
    // Telemetry reports the real frame interval; only the simulation clock is capped.
    // The first frame after the loop idled would report the whole idle gap, so it is not recorded.
    if (this.resumedFromIdle) this.resumedFromIdle = false
    else performanceTelemetry.recordFrameTime(rawDelta)
    if (this.activeAdapter && !performanceTelemetry.hasReportedFrameStats()) {
      performanceTelemetry.setDrawCalls(1) // fallback until the adapter reports real stats (W4)
    }
    performanceTelemetry.notifySubscribers()

    if (this.metricsSubscribers.size > 0) {
      const metrics: PerformanceMetrics = {
        fps: Math.round(1000 / rawDelta),
        frameTimeMs: Number(rawDelta.toFixed(2)),
        activeCallbacks: 1,
        drawCalls: this.activeAdapter ? performanceTelemetry.getDrawCalls() : 0,
        currentTime: this.playbackTime,
        isPlaying: this.isPlaying,
      }
      for (const sub of this.metricsSubscribers) {
        try {
          sub(metrics)
        } catch (e) {
          this.warnOnce("metrics subscriber", e)
        }
      }
    }

    if (this.isPlaying) {
      this.notifyTimeSubscribers()
    }
  }

  private recordPhase(phase: FramePhase, timestamp: number): void {
    this.executedPhases.push(phase)
    const slot = this.logRing[this.logHead]
    slot.phase = phase
    slot.timestamp = timestamp
    this.logHead = (this.logHead + 1) % LOG_CAPACITY
    if (this.logCount < LOG_CAPACITY) this.logCount++
  }

  getLastFramePhases(): FramePhase[] {
    return [...this.executedPhases]
  }

  getExecutionLog(): Array<{ phase: FramePhase; timestamp: number }> {
    const out: Array<{ phase: FramePhase; timestamp: number }> = []
    const start = (this.logHead - this.logCount + LOG_CAPACITY) % LOG_CAPACITY
    for (let i = 0; i < this.logCount; i++) {
      const e = this.logRing[(start + i) % LOG_CAPACITY]
      out.push({ phase: e.phase, timestamp: e.timestamp })
    }
    return out
  }

  clearLog(): void {
    this.logHead = 0
    this.logCount = 0
    this.executedPhases = []
  }

  getIsRunning(): boolean {
    return this.isRunning
  }
}

export const renderCoordinator = new RenderCoordinator()
