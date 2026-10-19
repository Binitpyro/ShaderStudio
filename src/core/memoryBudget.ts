import type { MemoryBudgetConfig } from "@/adapters/types"

export type { MemoryBudgetConfig }

export interface MemoryUsage {
  textureMB: number
  geometryMB: number
  totalVramMB: number
}

export interface MemoryThresholdResult {
  textureWarning: boolean
  geometryWarning: boolean
  totalVramWarning: boolean
  hasAnyWarning: boolean
}

export function createDefaultMemoryBudget(): MemoryBudgetConfig {
  return {
    textureBudgetMB: 512,
    geometryBudgetMB: 256,
    totalVramBudgetMB: 1024,
    warnThresholdRatio: 0.8,
  }
}

/**
 * Checks if memory usage strictly exceeds the configured threshold.
 * Tripping condition is strictly `usage > budget * warnThresholdRatio`.
 * For example: with budget 100MB and ratio 0.8, 80.0MB does not trip, 80.01MB trips.
 */
export function checkMemoryThreshold(
  usage: MemoryUsage,
  budget: MemoryBudgetConfig
): MemoryThresholdResult {
  const textureLimit = budget.textureBudgetMB * budget.warnThresholdRatio
  const geometryLimit = budget.geometryBudgetMB * budget.warnThresholdRatio
  const totalLimit = budget.totalVramBudgetMB * budget.warnThresholdRatio

  const textureWarning = usage.textureMB > textureLimit
  const geometryWarning = usage.geometryMB > geometryLimit
  const totalVramWarning = usage.totalVramMB > totalLimit

  return {
    textureWarning,
    geometryWarning,
    totalVramWarning,
    hasAnyWarning: textureWarning || geometryWarning || totalVramWarning,
  }
}

export type MemoryWarningListener = (
  result: MemoryThresholdResult,
  usage: MemoryUsage,
  budget: MemoryBudgetConfig
) => void

export type EvictionListener = (
  type: "texture" | "geometry" | "total",
  excessMB: number
) => void

export class MemoryBudgetManager {
  private config: MemoryBudgetConfig
  private warningListeners = new Set<MemoryWarningListener>()
  private evictionListeners = new Set<EvictionListener>()

  constructor(initialConfig?: Partial<MemoryBudgetConfig>) {
    this.config = {
      ...createDefaultMemoryBudget(),
      ...initialConfig,
    }
  }

  getConfig(): MemoryBudgetConfig {
    return { ...this.config }
  }

  setConfig(updates: Partial<MemoryBudgetConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    }
  }

  checkMemoryThreshold(usage: MemoryUsage): MemoryThresholdResult {
    return checkMemoryThreshold(usage, this.config)
  }

  /**
   * Evaluates memory usage, and if any threshold is exceeded, dispatches notifications
   * to registered warning and eviction listeners.
   */
  evaluateUsage(usage: MemoryUsage): MemoryThresholdResult {
    const result = this.checkMemoryThreshold(usage)
    if (result.hasAnyWarning) {
      for (const listener of this.warningListeners) {
        try {
          listener(result, usage, this.config)
        } catch {}
      }

      if (result.textureWarning) {
        const excess = usage.textureMB - (this.config.textureBudgetMB * this.config.warnThresholdRatio)
        this.notifyEviction("texture", excess)
      }
      if (result.geometryWarning) {
        const excess = usage.geometryMB - (this.config.geometryBudgetMB * this.config.warnThresholdRatio)
        this.notifyEviction("geometry", excess)
      }
      if (result.totalVramWarning) {
        const excess = usage.totalVramMB - (this.config.totalVramBudgetMB * this.config.warnThresholdRatio)
        this.notifyEviction("total", excess)
      }
    }
    return result
  }

  private notifyEviction(type: "texture" | "geometry" | "total", excessMB: number): void {
    for (const listener of this.evictionListeners) {
      try {
        listener(type, Math.max(0, excessMB))
      } catch {}
    }
  }

  onWarning(listener: MemoryWarningListener): () => void {
    this.warningListeners.add(listener)
    return () => this.warningListeners.delete(listener)
  }

  onEvictionRequired(listener: EvictionListener): () => void {
    this.evictionListeners.add(listener)
    return () => this.evictionListeners.delete(listener)
  }

  reset(): void {
    this.config = createDefaultMemoryBudget()
    this.warningListeners.clear()
    this.evictionListeners.clear()
  }
}

export const memoryBudgetManager = new MemoryBudgetManager()
