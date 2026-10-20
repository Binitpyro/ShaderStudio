import { generatePbrPixelBuffers, type BakeOptions } from "@/core/textureBaker"
import { createZipArchive, type ZipFileInput } from "@/utils/zipBuilder"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
  type EngineExportOptions,
} from "@/core/engineTranspiler"
import type { ParsedGeometry } from "@/core/modelLoader"
import type { ParsedUniform } from "@/stores/projectStore"

// NOTE: this module (and the worker + wasm pkg it spawns) must only ever be reached through
// dynamic `import()` from startup code, so none of it lands in the entry chunk.

export interface ReflectedUniform {
  name: string
  type_name: string
  kind: string
  offset: number
  size: number
  array_length?: number
  group: number
  binding: number
}

export interface PbrBakeOutput {
  albedo_png: Uint8Array
  normal_png: Uint8Array
  roughness_png: Uint8Array
  height_png: Uint8Array
  metallic_png: Uint8Array
  ao_png: Uint8Array
  zip_archive: Uint8Array
  width: number
  height: number
}

export interface WasmEngineStatus {
  hasWebAssembly: boolean
  hasWorker: boolean
  isInitialized: boolean
  usingFallback: boolean
}

export type WgslTarget = "glsl" | "glsl330" | "hlsl"
export type WgslStage = "vertex" | "fragment" | "compute"
export type WgslTranspileResult = { code: string } | { error: string; line?: number }

export interface WasmTimeouts {
  /** worker + wasm startup (ms) */
  init: number
  /** PBR bake + PNG/ZIP encode (ms) */
  bake: number
  /** OBJ parse / geometry normalize / reflect / transpile (ms) */
  parse: number
}

export const DEFAULT_WASM_TIMEOUTS: WasmTimeouts = { init: 3000, bake: 15000, parse: 5000 }

/** After this many consecutive worker crashes/timeouts the engine stays on the TS fallback. */
const MAX_CONSECUTIVE_FAILURES = 3

export interface CallOptions {
  /** Override the per-request timeout (ms). */
  timeoutMs?: number
  /** Abort a pending request: the promise rejects with an AbortError and the late result is dropped. */
  signal?: AbortSignal
}

type Pending = {
  resolve: (val: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

const toMesh = (res: any, name: string): ParsedGeometry => ({
  name: res.name || name,
  positions: res.positions instanceof Float32Array ? res.positions : new Float32Array(res.positions),
  normals: res.normals instanceof Float32Array ? res.normals : new Float32Array(res.normals),
  uvs: res.uvs instanceof Float32Array ? res.uvs : new Float32Array(res.uvs),
  vertexCount: res.vertex_count ?? res.vertexCount,
  triangleCount: res.triangle_count ?? res.triangleCount,
})

const toBytes = (pixels: Uint8Array | ImageData): Uint8Array => {
  const d: any = pixels instanceof Uint8Array ? pixels : (pixels as ImageData).data
  if (d instanceof Uint8Array) return d
  return d && d.buffer ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)
}

class WasmEngine {
  private worker: Worker | null = null
  private initPromise: Promise<boolean> | null = null
  private isInitialized = false
  private pendingRequests = new Map<string, Pending>()
  private reqCounter = 0
  private failures = 0
  public timeouts: WasmTimeouts = { ...DEFAULT_WASM_TIMEOUTS }

  /** Overrides request timeouts (ms); unspecified keys keep their current value. */
  public configure(timeouts: Partial<WasmTimeouts>): void {
    this.timeouts = { ...this.timeouts, ...timeouts }
  }

  /**
   * Returns environment diagnostic status.
   */
  public getStatus(): WasmEngineStatus {
    const hasWebAssembly = typeof WebAssembly !== "undefined"
    const hasWorker = typeof Worker !== "undefined"
    return {
      hasWebAssembly,
      hasWorker,
      isInitialized: this.isInitialized,
      usingFallback: !this.isInitialized || !hasWebAssembly || !hasWorker,
    }
  }

  /** Rejects every in-flight request and kills the worker; the next call respawns it. */
  private teardown(reason: string): void {
    const w = this.worker
    this.worker = null
    this.isInitialized = false
    this.initPromise = null
    w?.terminate()
    this.failures++
    const pending = [...this.pendingRequests.values()]
    this.pendingRequests.clear()
    for (const p of pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
  }

  private settle(id: string): Pending | undefined {
    const p = this.pendingRequests.get(id)
    if (!p) return undefined
    this.pendingRequests.delete(id)
    if (p.timer) clearTimeout(p.timer)
    return p
  }

  /**
   * Initializes the Web Worker and Wasm engine.
   * Resolves with false if WebAssembly/Worker is unsupported, startup fails or times out, or the
   * worker crashed too many times in a row. Safe to call again after a crash (it respawns).
   */
  public async init(): Promise<boolean> {
    if (this.isInitialized) return true
    if (this.initPromise) return this.initPromise
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) return false

    this.initPromise = (async () => {
      if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") return false

      let instance: Worker
      try {
        instance = new Worker(new URL("../workers/wasmWorker.ts", import.meta.url), { type: "module" })
      } catch (e) {
        console.warn("[WasmEngine] Web Worker failed to initialize, using TypeScript fallback:", e)
        return false
      }

      instance.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (!msg || !msg.id) return
        const pending = this.settle(msg.id)
        if (!pending) return
        if (msg.type === "ERROR") pending.reject(new Error(msg.error || "Wasm worker error"))
        else pending.resolve(msg.data !== undefined ? msg.data : msg)
      }
      const crashed = (what: string) => () => {
        if (this.worker === instance) this.teardown(`Wasm worker ${what}`)
      }
      instance.onerror = crashed("crashed")
      instance.onmessageerror = crashed("sent an unreadable message")

      this.worker = instance
      try {
        await this.rawRequest("INIT", undefined, undefined, this.timeouts.init)
        this.isInitialized = true
        this.failures = 0
        return true
      } catch {
        if (this.worker === instance) this.teardown("Wasm worker failed to start")
        return false
      }
    })()

    return this.initPromise
  }

  private rawRequest<T>(
    type: string,
    payload: unknown,
    transferables: Transferable[] | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error("Worker not available"))
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))

    const id = `req_${++this.reqCounter}_${Date.now()}`
    return new Promise<T>((resolve, reject) => {
      // A hung worker can't be trusted with more work: reject everything, respawn lazily.
      const timer = setTimeout(
        () => this.teardown(`Wasm request ${type} timed out after ${timeoutMs}ms`),
        timeoutMs
      )
      this.pendingRequests.set(id, { resolve, reject, timer })
      signal?.addEventListener("abort", () => this.settle(id)?.reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      })
      try {
        worker.postMessage({ id, type, payload }, transferables || [])
      } catch (err) {
        this.settle(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * Runs a request on the wasm worker (spawning it if needed).
   * Resolves null when the engine is unavailable; rejects if the worker fails, times out or is aborted.
   */
  private async call<T>(
    type: string,
    payload: unknown,
    kind: "bake" | "parse",
    transferables?: Transferable[],
    opts: CallOptions = {}
  ): Promise<T | null> {
    if (!(await this.init()) || !this.worker) return null
    return this.rawRequest<T>(type, payload, transferables, opts.timeoutMs ?? this.timeouts[kind], opts.signal)
  }

  /**
   * Fast path only: PBR bake on the Rust engine (PNG maps + ZIP). Resolves null if the engine is
   * unavailable and rejects on worker failure/timeout/abort, so callers can run their own fallback.
   * The input is copied before transfer, so the caller's buffer stays valid.
   */
  public async bakePbrNative(
    pixels: Uint8Array | ImageData,
    width: number,
    height: number,
    options: BakeOptions = {},
    opts?: CallOptions
  ): Promise<PbrBakeOutput | null> {
    const copy = new Uint8Array(toBytes(pixels))
    const { canvas: _canvas, ...bakeOptions } = options
    const res = await this.call<PbrBakeOutput>("BAKE_PBR", { pixels: copy, width, height, options: bakeOptions }, "bake", [copy.buffer], opts)
    return res ? { ...res, width: res.width || width, height: res.height || height } : null
  }

  /**
   * PBR Texture Baker:
   * Offloads to Rust Wasm Worker if available, otherwise executes TS reference implementation.
   */
  public async bakePbr(
    pixels: Uint8Array | ImageData,
    width: number,
    height: number,
    options: BakeOptions = {}
  ): Promise<PbrBakeOutput> {
    try {
      const native = await this.bakePbrNative(pixels, width, height, options)
      if (native) return native
    } catch (err) {
      console.warn("[WasmEngine] Worker bakePbr failed, falling back to TS:", err)
    }

    // TypeScript Fallback
    const rawPixels = toBytes(pixels)
    const data = new Uint8ClampedArray(rawPixels.buffer as ArrayBuffer, rawPixels.byteOffset, rawPixels.byteLength)
    const imgData = { data, width, height } as unknown as ImageData

    const pixelBuffers = generatePbrPixelBuffers(imgData, {
      normalStrength: options.normalStrength,
      invertNormalY: options.invertNormalY,
      aoStrength: options.aoStrength,
      metallicMode: options.metallicMode,
    })

    const files: ZipFileInput[] = [
      { name: "albedo.raw", data: new Uint8Array(pixelBuffers.albedo.buffer) },
      { name: "normal.raw", data: new Uint8Array(pixelBuffers.normal.buffer) },
      { name: "roughness.raw", data: new Uint8Array(pixelBuffers.roughness.buffer) },
      { name: "height.raw", data: new Uint8Array(pixelBuffers.heightMap.buffer) },
      { name: "metallic.raw", data: new Uint8Array(pixelBuffers.metallic.buffer) },
      { name: "ao.raw", data: new Uint8Array(pixelBuffers.ao.buffer) },
      {
        name: "material_manifest.json",
        data: new TextEncoder().encode(
          JSON.stringify(
            {
              generator: "Shader Studio PBR Baker (TS Fallback)",
              resolution: `${width}x${height}`,
              timestamp: new Date().toISOString(),
            },
            null,
            2
          )
        ),
      },
    ]

    return {
      albedo_png: new Uint8Array(pixelBuffers.albedo.buffer),
      normal_png: new Uint8Array(pixelBuffers.normal.buffer),
      roughness_png: new Uint8Array(pixelBuffers.roughness.buffer),
      height_png: new Uint8Array(pixelBuffers.heightMap.buffer),
      metallic_png: new Uint8Array(pixelBuffers.metallic.buffer),
      ao_png: new Uint8Array(pixelBuffers.ao.buffer),
      zip_archive: createZipArchive(files),
      width,
      height,
    }
  }

  /**
   * Reflects uniforms from shader source.
   */
  public async reflectUniforms(source: string, lang: "wgsl" | "glsl" = "wgsl"): Promise<ReflectedUniform[]> {
    try {
      const res = await this.call<any>("REFLECT_UNIFORMS", { source, lang }, "parse")
      if (res) return Array.isArray(res) ? res : res.data || []
    } catch (err) {
      console.warn("[WasmEngine] Worker reflectUniforms failed, falling back to TS:", err)
    }

    // TypeScript Fallback
    const tsUniforms: ParsedUniform[] = lang === "wgsl" ? parseWgslUniforms(source) : parseGlslUniforms(source)

    return tsUniforms.map((u, idx) => ({
      name: u.name,
      type_name: u.type,
      kind: u.kind,
      offset: idx * 16,
      size: 16,
      array_length: undefined,
      group: 0,
      binding: idx,
    }))
  }

  /**
   * Cross-compiles shader to Unity HLSL, Godot 4, or Shadertoy.
   */
  public async transpileShader(
    source: string,
    target: "unity" | "godot" | "shadertoy",
    options: Partial<EngineExportOptions> = {}
  ): Promise<string> {
    try {
      const res = await this.call<any>(
        "TRANSPILE_SHADER",
        { source, target, shaderName: options.shaderName, sourceLang: "wgsl" },
        "parse"
      )
      if (res !== null) return typeof res === "string" ? res : res.code || ""
    } catch (err) {
      console.warn("[WasmEngine] Worker transpileShader failed, falling back to TS:", err)
    }

    // TypeScript Fallback
    const exportOptions: EngineExportOptions = {
      shaderSource: source,
      shaderName: options.shaderName,
      parsedUniforms: options.parsedUniforms,
      uniformValues: options.uniformValues,
    }

    switch (target) {
      case "godot":
        return transpileToGodotShader(exportOptions)
      case "shadertoy":
        return transpileToShadertoy(exportOptions)
      default:
        return transpileToUnityHLSL(exportOptions)
    }
  }

  /**
   * Real WGSL -> GLSL/HLSL cross-compilation through naga (Rust).
   *
   * @param source WGSL source.
   * @param target `"glsl"` = GLSL ES 3.00 (Shadertoy / HTML / Godot conversion),
   *   `"glsl330"` = desktop GLSL 3.30 core, `"hlsl"` = HLSL SM 5.1 (Unity).
   * @param stage GLSL only: which entry point to emit (`"vertex"` | `"fragment"` | `"compute"`).
   *   Defaults to the fragment entry point, or the first entry point if there is none.
   * @returns `{ code }` on success, or `{ error, line? }` (1-based WGSL line when naga reports one)
   *   for parse / validation / backend errors, an unsupported target, or an unavailable engine.
   *   Never rejects. There is no TS fallback: without WebAssembly the result is `{ error }`.
   *
   * @example
   * const r = await wasmEngine.transpileWgsl(wgsl, "glsl")
   * if ("code" in r) useGlsl(r.code); else showError(r.error, r.line)
   */
  public async transpileWgsl(source: string, target: WgslTarget = "glsl", stage?: WgslStage): Promise<WgslTranspileResult> {
    try {
      const res = await this.call<WgslTranspileResult>("TRANSPILE_WGSL", { source, target, stage }, "parse")
      if (res) return res
    } catch (err) {
      console.warn("[WasmEngine] Worker transpileWgsl failed, running in-process:", err)
    }

    // No worker (headless / unsupported): run the same wasm module on this thread.
    try {
      const mod = await import("@/wasm/pkg/shaderstudio_wasm")
      try {
        return mod.transpile_wgsl_wasm(source, target, stage ?? null) as WgslTranspileResult
      } catch {
        await mod.default() // module not instantiated yet
        return mod.transpile_wgsl_wasm(source, target, stage ?? null) as WgslTranspileResult
      }
    } catch (err) {
      return { error: `WASM engine unavailable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Fast path only: parse + normals + normalization of an OBJ on the Rust engine.
   * Resolves null if the engine is unavailable; rejects on worker failure/timeout/abort.
   */
  public async normalizeObjNative(objText: string, name = "model.obj", opts?: CallOptions): Promise<ParsedGeometry | null> {
    const res = await this.call<any>("NORMALIZE_OBJ", { text: objText, name }, "parse", undefined, opts)
    return res ? toMesh(res, name) : null
  }

  /**
   * Parses and normalizes a Wavefront OBJ asset.
   */
  public async normalizeObj(objText: string, name = "model.obj"): Promise<ParsedGeometry> {
    try {
      const native = await this.normalizeObjNative(objText, name)
      if (native) return native
    } catch (err) {
      console.warn("[WasmEngine] Worker normalizeObj failed, falling back to TS:", err)
    }

    // TypeScript Fallback
    const { parseOBJ } = await import("@/core/modelLoader")
    return parseOBJ(objText, name)
  }

  /**
   * Normalizes raw 3D geometry buffers. Inputs are copied; the caller's arrays stay valid.
   */
  public async normalizeGeometry(
    positions: Float32Array,
    normals?: Float32Array,
    uvs?: Float32Array,
    name = "geometry"
  ): Promise<ParsedGeometry> {
    try {
      const p = new Float32Array(positions)
      const n = normals ? new Float32Array(normals) : undefined
      const u = uvs ? new Float32Array(uvs) : undefined
      const transfer = [p.buffer, n?.buffer, u?.buffer].filter((b): b is ArrayBuffer => !!b)
      const res = await this.call<any>("NORMALIZE_GEOMETRY", { positions: p, normals: n, uvs: u, name }, "parse", transfer)
      if (res) return toMesh(res, name)
    } catch (err) {
      console.warn("[WasmEngine] Worker normalizeGeometry failed, falling back to TS:", err)
    }

    // TypeScript Fallback (minimal in-place centering and sphere radius normalization)
    const pos = new Float32Array(positions)
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i])
      maxX = Math.max(maxX, pos[i])
      minY = Math.min(minY, pos[i + 1])
      maxY = Math.max(maxY, pos[i + 1])
      minZ = Math.min(minZ, pos[i + 2])
      maxZ = Math.max(maxZ, pos[i + 2])
    }

    const cx = (minX + maxX) * 0.5
    const cy = (minY + maxY) * 0.5
    const cz = (minZ + maxZ) * 0.5

    let maxRadius = 0
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= cx
      pos[i + 1] -= cy
      pos[i + 2] -= cz
      const dist = Math.sqrt(pos[i] ** 2 + pos[i + 1] ** 2 + pos[i + 2] ** 2)
      maxRadius = Math.max(maxRadius, dist)
    }

    if (maxRadius > 1e-6) {
      const scale = 1.2 / maxRadius
      for (let i = 0; i < pos.length; i++) pos[i] *= scale
    }

    const norm = normals ? new Float32Array(normals) : new Float32Array(pos.length).fill(1)
    const uv = uvs ? new Float32Array(uvs) : new Float32Array((pos.length / 3) * 2).fill(0)
    const vertexCount = pos.length / 3

    return { name, positions: pos, normals: norm, uvs: uv, vertexCount, triangleCount: vertexCount / 3 }
  }

  /**
   * Terminates the worker if active and rejects anything in flight.
   */
  public dispose(): void {
    const w = this.worker
    this.worker = null
    this.isInitialized = false
    this.initPromise = null
    this.failures = 0
    w?.terminate()
    const pending = [...this.pendingRequests.values()]
    this.pendingRequests.clear()
    for (const p of pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error("WasmEngine disposed"))
    }
  }
}

export const wasmEngine = new WasmEngine()
