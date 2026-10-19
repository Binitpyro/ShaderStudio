import type { DetailedGpuMetrics } from "@/adapters/types"

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
  private timeline: number[] = []
  private readonly maxTimelineEntries = 60
  private passTimings: DetailedGpuMetrics["passTimings"] = {}
  private drawCalls = 0
  private triangles = 0
  private registeredTextures = new Map<string, TextureMemoryEntry>()
  private registeredGeometries = new Map<string, GeometryMemoryEntry>()
  private manualVramBytes: number | null = null
  private subscribers = new Set<(metrics: DetailedGpuMetrics) => void>()

  /**
   * Pushes frame duration in ms into the circular 60-frame buffer.
   * Evicts the oldest entry when length exceeds 60.
   */
  recordFrameTime(ms: number): void {
    const validMs = Number.isFinite(ms) ? Math.max(0, ms) : 16.67
    this.timeline.push(validMs)
    if (this.timeline.length > this.maxTimelineEntries) {
      this.timeline.shift()
    }
  }

  /**
   * Returns a copy of the circular 60-frame timeline array.
   */
  getTimeline(): number[] {
    return [...this.timeline]
  }

  /**
   * Computes average FPS from the timeline buffer.
   * Returns 60 if timeline is empty or average time <= 0.
   */
  getAverageFps(): number {
    if (this.timeline.length === 0) return 60
    const sum = this.timeline.reduce((acc, val) => acc + val, 0)
    const avgMs = sum / this.timeline.length
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
    const lastFrame = this.timeline.length > 0 ? this.timeline[this.timeline.length - 1] : 16.67
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

  subscribe(callback: (metrics: DetailedGpuMetrics) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  notifySubscribers(): void {
    if (this.subscribers.size === 0) return
    const metrics = this.getMetrics()
    for (const sub of this.subscribers) {
      try {
        sub(metrics)
      } catch {}
    }
  }

  reset(): void {
    this.timeline = []
    this.passTimings = {}
    this.drawCalls = 0
    this.triangles = 0
    this.registeredTextures.clear()
    this.registeredGeometries.clear()
    this.manualVramBytes = null
  }
}

export const performanceTelemetry = new PerformanceTelemetry()
