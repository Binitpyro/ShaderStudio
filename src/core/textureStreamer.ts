export interface ResidentTexture {
  url: string
  resolution: [number, number]
  sizeBytes: number
  lastAccessed: number
  mipLevel: number
}

export interface TextureStreamerOptions {
  memoryLimitMB?: number
  bytesPerPixel?: number
}

export type EvictionCallback = (url: string, freedBytes: number) => void

/**
 * Progressive Texture Streamer with LRU Texture Cache.
 * Streams mipmaps from low-res thumbnail (mip 2) -> medium (mip 1) -> full-res (mip 0),
 * tracking resident texture memory and evicting least-recently-used textures when budget is reached.
 */
export class TextureStreamer {
  private memoryLimitMB: number
  private bytesPerPixel: number
  private cache = new Map<string, ResidentTexture>()
  private evictionSubscribers = new Set<EvictionCallback>()
  private accessCounter = 0

  constructor(options: TextureStreamerOptions = {}) {
    this.memoryLimitMB = options.memoryLimitMB ?? 512
    this.bytesPerPixel = options.bytesPerPixel ?? 4
  }

  getMemoryLimitMB(): number {
    return this.memoryLimitMB
  }

  setMemoryLimitMB(limitMB: number): void {
    this.memoryLimitMB = Math.max(1, limitMB)
    this.enforceBudget()
  }

  getResidentMemoryBytes(): number {
    let total = 0
    for (const item of this.cache.values()) {
      total += item.sizeBytes
    }
    return total
  }

  getResidentMemoryMB(): number {
    return Number((this.getResidentMemoryBytes() / (1024 * 1024)).toFixed(2))
  }

  getResidentTextureCount(): number {
    return this.cache.size
  }

  isCached(url: string): boolean {
    return this.cache.has(url)
  }

  getResidentTextures(): ResidentTexture[] {
    return Array.from(this.cache.values())
  }

  touch(url: string): void {
    const entry = this.cache.get(url)
    if (entry) {
      entry.lastAccessed = Date.now() * 1000 + (++this.accessCounter)
    }
  }

  onEvict(callback: EvictionCallback): () => void {
    this.evictionSubscribers.add(callback)
    return () => this.evictionSubscribers.delete(callback)
  }

  /**
   * Evicts the single least-recently-used texture from the resident cache.
   * Returns the URL of the evicted texture, or null if cache is empty.
   */
  evictLru(): string | null {
    if (this.cache.size === 0) return null

    let oldestUrl: string | null = null
    let oldestTime = Infinity

    for (const [url, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed
        oldestUrl = url
      }
    }

    if (!oldestUrl) return null

    const evictedItem = this.cache.get(oldestUrl)!
    this.cache.delete(oldestUrl)

    for (const cb of this.evictionSubscribers) {
      try {
        cb(oldestUrl, evictedItem.sizeBytes)
      } catch {}
    }

    return oldestUrl
  }

  /**
   * Enforces that current resident memory does not exceed configured memory limit.
   */
  private enforceBudget(requiredAdditionalBytes = 0): void {
    const maxBytes = this.memoryLimitMB * 1024 * 1024
    while (this.cache.size > 0 && this.getResidentMemoryBytes() + requiredAdditionalBytes > maxBytes) {
      const evicted = this.evictLru()
      if (!evicted) break
    }
  }

  private registerResident(url: string, resolution: [number, number], mipLevel: number): void {
    const sizeBytes = resolution[0] * resolution[1] * this.bytesPerPixel
    const existing = this.cache.get(url)
    const existingBytes = existing ? existing.sizeBytes : 0
    const netAdditionalBytes = Math.max(0, sizeBytes - existingBytes)

    this.enforceBudget(netAdditionalBytes)

    this.cache.set(url, {
      url,
      resolution,
      sizeBytes,
      lastAccessed: Date.now() * 1000 + (++this.accessCounter),
      mipLevel,
    })
  }

  /**
   * Progressively loads a texture yielding:
   * 1. Low-res thumbnail/mip 2 ([128, 128]) immediately
   * 2. Medium mip 1 ([512, 512])
   * 3. Full-res mip 0 ([2048, 2048])
   */
  async loadMipmapProgressive(
    url: string,
    onMipLoaded: (level: number, resolution: [number, number]) => void
  ): Promise<boolean> {
    if (!url || typeof url !== "string") {
      return false
    }

    // Step 1: Low-res thumbnail (mip 2, 128x128) immediately
    const mip2Res: [number, number] = [128, 128]
    this.registerResident(url, mip2Res, 2)
    onMipLoaded(2, mip2Res)

    // Step 2: Medium resolution (mip 1, 512x512)
    const mip1Res: [number, number] = [512, 512]
    this.registerResident(url, mip1Res, 1)
    onMipLoaded(1, mip1Res)

    // Step 3: Full-resolution master (mip 0, 2048x2048)
    const mip0Res: [number, number] = [2048, 2048]
    this.registerResident(url, mip0Res, 0)
    onMipLoaded(0, mip0Res)

    return true
  }

  clear(): void {
    this.cache.clear()
  }
}

export function createTextureStreamer(options?: TextureStreamerOptions): TextureStreamer {
  return new TextureStreamer(options)
}

export const textureStreamer = new TextureStreamer()
