import type { DetailedGpuMetrics, FrameStats } from "@/adapters/types"

export type { DetailedGpuMetrics }

export interface TextureMemoryEntry {
  id: string
  width: number
  height: number
  bytesPerPixel: number
}

export interface GeometryMemoryEntry {
  id: string
  vertexCount: number
  strideBytes: number
}

export class PerformanceTelemetry {
  // Preallocated ring buffer: recordFrameTime never allocates or shifts.
  private readonly maxTimelineEntries = 60
  private ring = new Float64Array(60)
  private ringHead = 0 // next write index
  private ringCount = 0
  private passTimings: DetailedGpuMetrics["passTimings"] = {}
  private drawCalls = 0
  private triangles = 0
  private registeredTextures = new Map<string, TextureMemoryEntry>()
  private registeredGeometries = new Map<string, GeometryMemoryEntry>()
  private manualVramBytes: number | null = null
  private warnedSubscribers = new WeakSet<object>()
  private subscribers = new Map<(metrics: DetailedGpuMetrics) => void, { intervalMs: number; last: number }>()
  private recompileCount = 0
  private frameStatsReported = false

  /**
   * Pushes frame duration in ms into the preallocated 60-entry ring buffer (oldest entry is overwritten).
   */
  recordFrameTime(ms: number): void {
    this.ring[this.ringHead] = Number.isFinite(ms) ? Math.max(0, ms) : 16.67
    this.ringHead = (this.ringHead + 1) % this.maxTimelineEntries
    if (this.ringCount < this.maxTimelineEntries) this.ringCount++
  }

  /**
   * Returns the timeline, oldest first, as a fresh array (allocates; call at UI cadence only).
   */
  getTimeline(): number[] {
    const out = new Array<number>(this.ringCount)
    const start = (this.ringHead - this.ringCount + this.maxTimelineEntries) % this.maxTimelineEntries
    for (let i = 0; i < this.ringCount; i++) out[i] = this.ring[(start + i) % this.maxTimelineEntries]
    return out
  }

  /** Most recent frame time in ms (16.67 when nothing recorded). Allocation-free. */
  getLastFrameTime(): number {
    if (this.ringCount === 0) return 16.67
    return this.ring[(this.ringHead - 1 + this.maxTimelineEntries) % this.maxTimelineEntries]
  }

  /**
   * Computes average FPS from the timeline buffer.
   * Returns 60 if timeline is empty or average time <= 0.
   */
  getAverageFps(): number {
    if (this.ringCount === 0) return 60
    let sum = 0
    for (let i = 0; i < this.ringCount; i++) sum += this.ring[i] // order is irrelevant for the mean
    const avgMs = sum / this.ringCount
    if (avgMs <= 0 || !Number.isFinite(avgMs)) return 60
    return 1000 / avgMs
  }

  /**
   * Records execution timing for an individual GPU render pass in milliseconds.
   */
  setPassTiming(pass: keyof DetailedGpuMetrics["passTimings"], durationMs: number): void {
    this.passTimings[pass] = Math.max(0, durationMs)
  }

  getPassTimings(): DetailedGpuMetrics["passTimings"] {
    return { ...this.passTimings }
  }

  clearPassTimings(): void {
    this.passTimings = {}
  }

  setDrawCalls(count: number): void {
    this.drawCalls = Math.max(0, Math.floor(count))
  }

  getDrawCalls(): number {
    return this.drawCalls
  }

  setTriangles(count: number): void {
    this.triangles = Math.max(0, Math.floor(count))
  }

  getTriangles(): number {
    return this.triangles
  }

  /**
   * Adapters call this once per frame after drawing with the real draw-call/triangle counts and
   * optional per-pass GPU timings. Until an adapter reports, the coordinator falls back to 1 draw call.
   */
  reportFrameStats(stats: FrameStats): void {
    this.drawCalls = Math.max(0, Math.floor(stats.drawCalls))
    this.triangles = Math.max(0, Math.floor(stats.triangles))
    if (stats.passTimings) {
      for (const key of Object.keys(stats.passTimings) as Array<keyof DetailedGpuMetrics["passTimings"]>) {
        const v = stats.passTimings[key]
        if (v !== undefined) this.passTimings[key] = Math.max(0, v)
      }
    }
    this.frameStatsReported = true
  }

  hasReportedFrameStats(): boolean {
    return this.frameStatsReported
  }

  /** Forgets reported stats (call when the active adapter changes). */
  resetFrameStats(): void {
    this.frameStatsReported = false
    this.drawCalls = 0
    this.triangles = 0
    this.passTimings = {}
  }

  /** Dev counter: how many shader recompiles were triggered (detects recompile storms). */
  recordRecompile(): void {
    this.recompileCount++
  }

  getRecompileCount(): number {
    return this.recompileCount
  }

  /**
   * Calculate VRAM consumption of a 2D texture given dimensions and bytes per pixel (default 4 for RGBA8).
   */
  calculateTextureMemory(width: number, height: number, bytesPerPixel = 4): number {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(bytesPerPixel) ||
      width <= 0 ||
      height <= 0 ||
      bytesPerPixel <= 0
    ) {
      return 0
    }
    return Math.floor(width) * Math.floor(height) * Math.floor(bytesPerPixel)
  }

  /**
   * Calculate VRAM consumption of geometry buffers given vertex count and stride in bytes (default 32 bytes).
   */
  calculateGeometryMemory(vertexCount: number, strideBytes = 32): number {
    if (
      !Number.isFinite(vertexCount) ||
      !Number.isFinite(strideBytes) ||
      vertexCount <= 0 ||
      strideBytes <= 0
    ) {
      return 0
    }
    return Math.floor(vertexCount) * Math.floor(strideBytes)
  }

  /**
   * Estimates total VRAM bytes across texture and geometry collections.
   */
  estimateVramBytes(
    textures: Array<{ width: number; height: number; bytesPerPixel?: number }>,
    geometries: Array<{ vertexCount: number; strideBytes?: number }>
  ): number {
    let total = 0
    for (const tex of textures) {
      total += this.calculateTextureMemory(tex.width, tex.height, tex.bytesPerPixel ?? 4)
    }
    for (const geom of geometries) {
      total += this.calculateGeometryMemory(geom.vertexCount, geom.strideBytes ?? 32)
    }
    return total
  }

  registerTexture(id: string, width: number, height: number, bytesPerPixel = 4): void {
    this.registeredTextures.set(id, { id, width, height, bytesPerPixel })
  }

  unregisterTexture(id: string): void {
    this.registeredTextures.delete(id)
  }

  registerGeometry(id: string, vertexCount: number, strideBytes = 32): void {
    this.registeredGeometries.set(id, { id, vertexCount, strideBytes })
  }

  unregisterGeometry(id: string): void {
    this.registeredGeometries.delete(id)
  }

  setEstimatedVramBytes(bytes: number): void {
    this.manualVramBytes = Math.max(0, bytes)
  }

  getEstimatedVramBytes(): number {
    if (this.manualVramBytes !== null) {
      return this.manualVramBytes
    }
    let total = 0
    for (const tex of this.registeredTextures.values()) {
      total += this.calculateTextureMemory(tex.width, tex.height, tex.bytesPerPixel)
    }
    for (const geom of this.registeredGeometries.values()) {
      total += this.calculateGeometryMemory(geom.vertexCount, geom.strideBytes)
    }
    return total
  }

  getMetrics(): DetailedGpuMetrics {
    const lastFrame = this.getLastFrameTime()
    return {
      fps: Math.round(this.getAverageFps()),
      frameTime: Number(lastFrame.toFixed(2)),
      passTimings: this.getPassTimings(),
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      estimatedVramBytes: this.getEstimatedVramBytes(),
      frameTimeline: this.getTimeline(),
    }
  }

  /**
   * Subscribes to metrics. `intervalMs` throttles this subscriber (0 = every frame); the metrics
   * object (with its timeline copy) is only built when at least one subscriber is due.
   */
  subscribe(callback: (metrics: DetailedGpuMetrics) => void, intervalMs = 0): () => void {
    this.subscribers.set(callback, { intervalMs, last: -Infinity })
    return () => this.subscribers.delete(callback)
  }

  getSubscriberCount(): number {
    return this.subscribers.size
  }

  notifySubscribers(): void {
    if (this.subscribers.size === 0) return
    const now = performance.now()
    let metrics: DetailedGpuMetrics | null = null
    for (const [sub, state] of this.subscribers) {
      if (state.intervalMs > 0 && now - state.last < state.intervalMs) continue
      state.last = now
      metrics ??= this.getMetrics()
      try {
        sub(metrics)
      } catch (e) {
        if (!this.warnedSubscribers.has(sub)) {
          this.warnedSubscribers.add(sub)
          console.warn("[PerformanceTelemetry] metrics subscriber threw (further errors from it suppressed):", e)
        }
      }
    }
  }

  reset(): void {
    this.ringHead = 0
    this.ringCount = 0
    this.passTimings = {}
    this.drawCalls = 0
    this.triangles = 0
    this.frameStatsReported = false
    this.recompileCount = 0
    this.registeredTextures.clear()
    this.registeredGeometries.clear()
    this.manualVramBytes = null
  }
}

export const performanceTelemetry = new PerformanceTelemetry()
