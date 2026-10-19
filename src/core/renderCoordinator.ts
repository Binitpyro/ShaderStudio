import { audioEngine } from "@/audio/audioEngine"
import type { RenderAdapter } from "@/adapters/types"
import { performanceTelemetry } from "@/core/performanceTelemetry"

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
 */
export class RenderCoordinator {
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
  private executionLog: Array<{ phase: FramePhase; timestamp: number }> = []

  // Virtual Playback Clock (Decoupled from wall-clock performance.now())
  private playbackTime = 0.0 // in seconds
  private isPlaying = true
  private playbackSpeed = 1.0
  private singleFrameRenderCount = 0

  setActiveAdapter(adapter: RenderAdapterContract | RenderAdapter | null): void {
    if (this.activeAdapter && typeof (this.activeAdapter as any).setExternalLoopDriven === "function") {
      (this.activeAdapter as any).setExternalLoopDriven(false)
    }
    this.activeAdapter = adapter
    if (adapter && typeof (adapter as any).setExternalLoopDriven === "function") {
      (adapter as any).setExternalLoopDriven(true)
    }
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
    const virtualTimeMs = this.playbackTime * 1000
    for (const hook of this.preRenderHooks.values()) {
      try {
        hook(virtualTimeMs, 0)
      } catch {}
    }
    if (this.activeAdapter && typeof (this.activeAdapter as any).renderFrame === "function") {
      try {
        (this.activeAdapter as any).renderFrame(virtualTimeMs, 0)
      } catch {}
    }
    this.broadcastRenderFrame(this.playbackTime, true)
  }

  private notifyTimeSubscribers(): void {
    for (const sub of this.timeSubscribers) {
      try {
        sub(this.playbackTime)
      } catch {}
    }
  }

  private broadcastRenderFrame(time: number, isSeek: boolean): void {
    for (const sub of this.renderFrameSubscribers) {
      try {
        sub(time, isSeek)
      } catch {}
    }
  }

  start(): void {
    if (this.isRunning && this.rafId !== null) return
    this.isRunning = true
    this.lastTime = performance.now()
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
    this.rafId = requestAnimationFrame((now) => {
      this.rafId = null
      try {
        this.tick(now)
      } finally {
        if (this.isRunning && this.rafId === null) {
          this.scheduleTick()
        }
      }
    })
  }

  /**
   * Authoritative 5-phase frame execution
   */
  tick(now: number): void {
    const delta = Math.max(1, now - (this.lastTime || now))
    this.lastTime = now
    this.frameCount++
    this.executedPhases = []

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
    } catch {
      // Audio engine update may fail in headless/uninitialized environments
    }

    // Phase 3: Pre-Render Hooks (Audio Uniform Modulation)
    this.recordPhase("modulation", now)
    for (const hook of this.preRenderHooks.values()) {
      hook(virtualTimeMs, delta)
    }

    // Phase 4: Active Adapter Render
    this.recordPhase("draw", now)
    if (this.activeAdapter && typeof (this.activeAdapter as any).renderFrame === "function") {
      (this.activeAdapter as any).renderFrame(virtualTimeMs, this.isPlaying ? delta : 0)
    }
    this.broadcastRenderFrame(this.playbackTime, false)

    // Phase 5: Post-Render Metrics & Telemetry
    this.recordPhase("telemetry", now)
    performanceTelemetry.recordFrameTime(delta)
    if (this.activeAdapter) {
      performanceTelemetry.setDrawCalls(1)
    }
    performanceTelemetry.notifySubscribers()

    const metrics: PerformanceMetrics = {
      fps: Math.round(1000 / delta),
      frameTimeMs: Number(delta.toFixed(2)),
      activeCallbacks: 1,
      drawCalls: this.activeAdapter ? 1 : 0,
      currentTime: this.playbackTime,
      isPlaying: this.isPlaying,
    }
    for (const sub of this.metricsSubscribers) {
      sub(metrics)
    }

    if (this.isPlaying) {
      this.notifyTimeSubscribers()
    }
  }

  private recordPhase(phase: FramePhase, timestamp: number): void {
    this.executedPhases.push(phase)
    this.executionLog.push({ phase, timestamp })
    if (this.executionLog.length > 300) {
      this.executionLog.shift()
    }
  }

  getLastFramePhases(): FramePhase[] {
    return [...this.executedPhases]
  }

  getExecutionLog(): Array<{ phase: FramePhase; timestamp: number }> {
    return [...this.executionLog]
  }

  clearLog(): void {
    this.executionLog = []
    this.executedPhases = []
  }

  getIsRunning(): boolean {
    return this.isRunning
  }
}

export const renderCoordinator = new RenderCoordinator()
