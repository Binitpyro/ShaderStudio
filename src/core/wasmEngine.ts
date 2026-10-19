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
import { parseOBJ, type ParsedGeometry } from "@/core/modelLoader"
import type { ParsedUniform } from "@/stores/projectStore"

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

class WasmEngine {
  private worker: Worker | null = null
  private initPromise: Promise<boolean> | null = null
  private isInitialized = false
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >()
  private reqCounter = 0

  constructor() {
    // Lazy worker creation when in browser environment
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

  /**
   * Initializes the Web Worker and Wasm engine.
   * Resolves immediately with false if WebAssembly or Worker is unsupported.
   */
  public async init(): Promise<boolean> {
    if (this.isInitialized) return true
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
        this.isInitialized = false
        return false
      }

      try {
        const workerInstance = new Worker(
          new URL("../workers/wasmWorker.ts", import.meta.url),
          { type: "module" }
        )

        workerInstance.onmessage = (e: MessageEvent) => {
          const msg = e.data
          if (!msg || !msg.id) return

          const pending = this.pendingRequests.get(msg.id)
          if (!pending) return
          this.pendingRequests.delete(msg.id)

          if (msg.type === "ERROR") {
            pending.reject(new Error(msg.error || "Wasm worker error"))
          } else {
            pending.resolve(msg.data !== undefined ? msg.data : msg)
          }
        }

        workerInstance.onerror = (err) => {
          console.warn("[WasmEngine] Worker error event:", err)
        }

        // Send INIT ping
        const id = `init_${++this.reqCounter}`
        const initPing = new Promise<boolean>((resolve) => {
          this.pendingRequests.set(id, {
            resolve: () => resolve(true),
            reject: () => resolve(false), // Fall back gracefully on failure
          })
          workerInstance.postMessage({ id, type: "INIT" })

          // 3 second timeout for init in case of worker block
          setTimeout(() => {
            if (this.pendingRequests.has(id)) {
              this.pendingRequests.delete(id)
              resolve(false)
            }
          }, 3000)
        })

        const success = await initPing
        if (success) {
          this.worker = workerInstance
          this.isInitialized = true
          return true
        } else {
          workerInstance.terminate()
          this.isInitialized = false
          return false
        }
      } catch (e) {
        console.warn("[WasmEngine] Web Worker failed to initialize, using TypeScript fallback:", e)
        this.isInitialized = false
        return false
      }
    })()

    return this.initPromise
  }

  private sendRequest<T>(type: string, payload: any, transferables?: Transferable[]): Promise<T> {
    if (!this.worker) {
      throw new Error("Worker not available")
    }

    const id = `req_${++this.reqCounter}_${Date.now()}`
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.worker!.postMessage({ id, type, payload }, transferables || [])
    })
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
    const ready = await this.init()

    const rawPixels =
      pixels instanceof Uint8Array
        ? pixels
        : (pixels as ImageData).data instanceof Uint8ClampedArray
        ? new Uint8Array((pixels as ImageData).data)
        : new Uint8Array((pixels as any).data)

    if (ready && this.worker) {
      try {
        const transferCopy = new Uint8Array(rawPixels)
        const res: any = await this.sendRequest(
          "BAKE_PBR",
          {
            pixels: transferCopy,
            width,
            height,
            options,
          },
          [transferCopy.buffer]
        )

        return {
          albedo_png: new Uint8Array(res.albedo_png),
          normal_png: new Uint8Array(res.normal_png),
          roughness_png: new Uint8Array(res.roughness_png),
          height_png: new Uint8Array(res.height_png),
          metallic_png: new Uint8Array(res.metallic_png),
          ao_png: new Uint8Array(res.ao_png),
          zip_archive: new Uint8Array(res.zip_archive),
          width: res.width || width,
          height: res.height || height,
        }
      } catch (err) {
        console.warn("[WasmEngine] Worker bakePbr failed, falling back to TS:", err)
      }
    }

    // TypeScript Fallback
    const imgData = {
      data: rawPixels as any,
      width,
      height,
    } as unknown as ImageData

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

    const zipArchive = createZipArchive(files)

    return {
      albedo_png: new Uint8Array(pixelBuffers.albedo.buffer),
      normal_png: new Uint8Array(pixelBuffers.normal.buffer),
      roughness_png: new Uint8Array(pixelBuffers.roughness.buffer),
      height_png: new Uint8Array(pixelBuffers.heightMap.buffer),
      metallic_png: new Uint8Array(pixelBuffers.metallic.buffer),
      ao_png: new Uint8Array(pixelBuffers.ao.buffer),
      zip_archive: zipArchive,
      width,
      height,
    }
  }

  /**
   * Reflects uniforms from shader source.
   */
  public async reflectUniforms(
    source: string,
    lang: "wgsl" | "glsl" = "wgsl"
  ): Promise<ReflectedUniform[]> {
    const ready = await this.init()

    if (ready && this.worker) {
      try {
        const res: any = await this.sendRequest("REFLECT_UNIFORMS", { source, lang })
        return Array.isArray(res) ? res : res.data || []
      } catch (err) {
        console.warn("[WasmEngine] Worker reflectUniforms failed, falling back to TS:", err)
      }
    }

    // TypeScript Fallback
    const tsUniforms: ParsedUniform[] =
      lang === "wgsl" ? parseWgslUniforms(source) : parseGlslUniforms(source)

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
    const ready = await this.init()

    if (ready && this.worker) {
      try {
        const res: any = await this.sendRequest("TRANSPILE_SHADER", {
          source,
          target,
          shaderName: options.shaderName,
          sourceLang: "wgsl",
        })
        return typeof res === "string" ? res : res.code || ""
      } catch (err) {
        console.warn("[WasmEngine] Worker transpileShader failed, falling back to TS:", err)
      }
    }

    // TypeScript Fallback
    const exportOptions: EngineExportOptions = {
      shaderSource: source,
      shaderName: options.shaderName,
      parsedUniforms: options.parsedUniforms,
      uniformValues: options.uniformValues,
    }

    switch (target) {
      case "unity":
        return transpileToUnityHLSL(exportOptions)
      case "godot":
        return transpileToGodotShader(exportOptions)
      case "shadertoy":
        return transpileToShadertoy(exportOptions)
      default:
        return transpileToUnityHLSL(exportOptions)
    }
  }

  /**
   * Parses and normalizes a Wavefront OBJ asset.
   */
  public async normalizeObj(objText: string, name = "model.obj"): Promise<ParsedGeometry> {
    const ready = await this.init()

    if (ready && this.worker) {
      try {
        const res: any = await this.sendRequest("NORMALIZE_OBJ", { text: objText, name })
        return {
          name: res.name || name,
          positions: res.positions instanceof Float32Array ? res.positions : new Float32Array(res.positions),
          normals: res.normals instanceof Float32Array ? res.normals : new Float32Array(res.normals),
          uvs: res.uvs instanceof Float32Array ? res.uvs : new Float32Array(res.uvs),
          vertexCount: res.vertex_count || res.vertexCount,
          triangleCount: res.triangle_count || res.triangleCount,
        }
      } catch (err) {
        console.warn("[WasmEngine] Worker normalizeObj failed, falling back to TS:", err)
      }
    }

    // TypeScript Fallback
    return parseOBJ(objText, name)
  }

  /**
   * Normalizes raw 3D geometry buffers.
   */
  public async normalizeGeometry(
    positions: Float32Array,
    normals?: Float32Array,
    uvs?: Float32Array,
    name = "geometry"
  ): Promise<ParsedGeometry> {
    const ready = await this.init()

    if (ready && this.worker) {
      try {
        const res: any = await this.sendRequest("NORMALIZE_GEOMETRY", {
          positions,
          normals,
          uvs,
          name,
        })
        return {
          name: res.name || name,
          positions: res.positions instanceof Float32Array ? res.positions : new Float32Array(res.positions),
          normals: res.normals instanceof Float32Array ? res.normals : new Float32Array(res.normals),
          uvs: res.uvs instanceof Float32Array ? res.uvs : new Float32Array(res.uvs),
          vertexCount: res.vertex_count || res.vertexCount,
          triangleCount: res.triangle_count || res.triangleCount,
        }
      } catch (err) {
        console.warn("[WasmEngine] Worker normalizeGeometry failed, falling back to TS:", err)
      }
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
      for (let i = 0; i < pos.length; i++) {
        pos[i] *= scale
      }
    }

    const norm = normals ? new Float32Array(normals) : new Float32Array(pos.length).fill(1)
    const uv = uvs ? new Float32Array(uvs) : new Float32Array((pos.length / 3) * 2).fill(0)
    const vertexCount = pos.length / 3
    const triangleCount = vertexCount / 3

    return {
      name,
      positions: pos,
      normals: norm,
      uvs: uv,
      vertexCount,
      triangleCount,
    }
  }

  /**
   * Terminates the worker if active.
   */
  public dispose(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.isInitialized = false
    this.initPromise = null
    this.pendingRequests.clear()
  }
}

export const wasmEngine = new WasmEngine()
