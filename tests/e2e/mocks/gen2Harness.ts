/**
 * Gen 2 Test Harness & Specification Contract Validators
 *
 * Provides authoritative reference implementations and verification contracts
 * for Requirements R1-R4:
 * - R1: Wasm PBR Baker & ZIP Packager, Naga AST Transpiler & Reflection, 3D Mesh Normalizer
 * - R2: Bundle Architecture & Manual Chunking, Zero-Allocation Memory Optimization, Single RenderCoordinator
 * - R3: UI Resilience ErrorBoundary, Live Monaco Diagnostics, WebGPU Device Lost Auto-Recovery
 * - R4: Local Bridge RPC Security (CORS Whitelist, Path Traversal Sanitization, Ephemeral Auth Token)
 */

import { resolve, normalize, sep } from "path"
import { timingSafeEqual } from "crypto"

// ============================================================================
// 1. Bridge Security Contracts (R4)
// ============================================================================

export const ALLOWED_CORS_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
])

const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Validates HTTP/WS request origin against strict whitelist.
 * Returns true if allowed, false if rejected.
 */
export function validateCorsOrigin(origin: string | undefined | null): boolean {
  if (!origin) {
    // Non-browser clients (curl, CLI, MCP server) do not send Origin header
    return true
  }
  try {
    const parsed = new URL(origin)
    // Disallow null origins or non-http protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }
    // Check exact whitelist
    if (ALLOWED_CORS_ORIGINS.has(origin)) {
      return true
    }
    // Check localhost on custom ports
    return LOCAL_ORIGIN_REGEX.test(origin)
  } catch {
    return false
  }
}

/**
 * Sanitizes target filesystem path to prevent path traversal outside root directory.
 * Disallows null bytes, escaping sequences (..), and un-normalized paths.
 */
export function isSafePath(targetPath: string | null | undefined, rootDir: string): boolean {
  if (!targetPath || typeof targetPath !== "string") return false
  if (targetPath.includes("\0")) return false // Null byte attack

  // Decode URI components to catch URL-encoded (%2e%2e, %2f) and double-encoded traversal
  let decoded = targetPath
  try {
    while (decoded.includes("%")) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    return false // Malformed URI encoding
  }

  if (decoded.includes("\0")) return false

  try {
    const resolvedRoot = resolve(rootDir)
    const resolvedTarget = resolve(resolvedRoot, decoded)

    const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootPrefix)
  } catch {
    return false
  }
}

/**
 * Constant-time comparison for authentication token verification.
 */
export function verifyAuthToken(
  providedToken: string | null | undefined,
  expectedToken: string
): { valid: boolean; statusCode: number; error?: string } {
  if (!providedToken) {
    return {
      valid: false,
      statusCode: 401,
      error: "Unauthorized: Missing authentication token",
    }
  }

  const cleanProvided = providedToken.startsWith("Bearer ")
    ? providedToken.slice(7).trim()
    : providedToken.trim()

  const providedBuf = Buffer.from(cleanProvided, "utf8")
  const expectedBuf = Buffer.from(expectedToken, "utf8")

  if (providedBuf.length !== expectedBuf.length) {
    return {
      valid: false,
      statusCode: 403,
      error: "Forbidden: Invalid authentication token",
    }
  }

  const matches = timingSafeEqual(providedBuf, expectedBuf)
  if (!matches) {
    return {
      valid: false,
      statusCode: 403,
      error: "Forbidden: Invalid authentication token",
    }
  }

  return { valid: true, statusCode: 200 }
}

// ============================================================================
// 2. RenderCoordinator Architecture Contract (R2)
// ============================================================================

export type FramePhase = "clock" | "audio" | "modulation" | "draw" | "telemetry"

export interface PerformanceMetrics {
  fps: number
  frameTimeMs: number
  activeCallbacks: number
  drawCalls: number
}

export interface RenderAdapterContract {
  renderFrame(time: number, delta: number): void
  dispose(): void
}

export class RenderCoordinatorHarness {
  private activeAdapter: RenderAdapterContract | null = null
  private preRenderHooks = new Map<string, (time: number, delta: number) => void>()
  private metricsSubscribers = new Set<(metrics: PerformanceMetrics) => void>()
  private isRunning = false
  private rafId: number | null = null
  private lastTime = 0
  private frameCount = 0
  private executedPhases: FramePhase[] = []
  private executionLog: Array<{ phase: FramePhase; timestamp: number }> = []

  setActiveAdapter(adapter: RenderAdapterContract | null): void {
    this.activeAdapter = adapter
  }

  getActiveAdapter(): RenderAdapterContract | null {
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
   * Executes explicit 5-phase frame cycle
   */
  tick(now: number): void {
    const delta = Math.max(1, now - (this.lastTime || now))
    this.lastTime = now
    this.frameCount++
    this.executedPhases = []

    // Phase 1: Frame Timing (Clock)
    this.recordPhase("clock", now)

    // Phase 2: Audio Engine Update
    this.recordPhase("audio", now)

    // Phase 3: Pre-Render Hooks (Audio Uniform Modulation)
    this.recordPhase("modulation", now)
    for (const hook of this.preRenderHooks.values()) {
      hook(now, delta)
    }

    // Phase 4: Active Adapter Render
    this.recordPhase("draw", now)
    if (this.activeAdapter) {
      this.activeAdapter.renderFrame(now, delta)
    }

    // Phase 5: Post-Render Metrics & Telemetry
    this.recordPhase("telemetry", now)
    const metrics: PerformanceMetrics = {
      fps: Math.round(1000 / delta),
      frameTimeMs: Number(delta.toFixed(2)),
      activeCallbacks: 1,
      drawCalls: this.activeAdapter ? 1 : 0,
    }
    for (const sub of this.metricsSubscribers) {
      sub(metrics)
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

// ============================================================================
// 3. Rollup Manual Chunking Contract (R2)
// ============================================================================

/**
 * Validates the manualChunks splitting logic specified in Survey R2
 */
export function resolveRollupManualChunk(id: string): string | undefined {
  if (id.includes("node_modules")) {
    if (id.includes("@monaco-editor") || id.includes("monaco-editor")) {
      return "vendor-monaco"
    }
    if (id.includes("three")) {
      return "vendor-three"
    }
    if (id.includes("@xyflow") || id.includes("reactflow")) {
      return "vendor-reactflow"
    }
    if (id.includes("@radix-ui")) {
      return "vendor-radix"
    }
    return "vendor"
  }
  return undefined
}

// ============================================================================
// 4. React Error Boundary Contract (R3)
// ============================================================================

export interface ErrorBoundaryContractProps {
  fallbackTitle?: string
  fallbackMessage?: string
  onReset?: () => void
  onError?: (error: Error) => void
}

export class MockErrorBoundaryHarness {
  hasError = false
  capturedError: Error | null = null
  title: string
  message: string
  onReset?: () => void
  onError?: (error: Error) => void

  constructor(props: ErrorBoundaryContractProps = {}) {
    this.title = props.fallbackTitle || "Application Error"
    this.message = props.fallbackMessage || "An unexpected error occurred"
    this.onReset = props.onReset
    this.onError = props.onError
  }

  catchError(error: Error): void {
    this.hasError = true
    this.capturedError = error
    if (this.onError) {
      this.onError(error)
    }
  }

  reset(): void {
    this.hasError = false
    this.capturedError = null
    if (this.onReset) {
      this.onReset()
    }
  }

  getRenderedView(childrenOutput: string): { type: "children" | "fallback"; content: string } {
    if (this.hasError) {
      return {
        type: "fallback",
        content: `[Fallback Card: ${this.title}] ${this.capturedError?.message || this.message}`,
      }
    }
    return {
      type: "children",
      content: childrenOutput,
    }
  }
}
