import { createZipArchive, type ZipFileInput } from "@/utils/zipBuilder"

export type PbrResolution = 512 | 1024 | 2048 | 4096

export interface BakeOptions {
  resolution?: PbrResolution
  normalStrength?: number
  invertNormalY?: boolean
  aoStrength?: number
  metallicMode?: "auto" | "metal" | "dielectric"
  canvas?: HTMLCanvasElement | null
}

export interface PbrMapItem {
  id: "albedo" | "normal" | "roughness" | "height" | "metallic" | "ao"
  title: string
  description: string
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export interface PbrBakeResult {
  resolution: number
  maps: Record<string, PbrMapItem>
  createZip: () => Uint8Array
}

/**
 * Pure algorithmic processor that generates PBR map buffers from raw RGBA ImageData.
 */
export function generatePbrPixelBuffers(
  sourceData: ImageData,
  options: {
    normalStrength?: number
    invertNormalY?: boolean
    aoStrength?: number
    metallicMode?: "auto" | "metal" | "dielectric"
  } = {}
) {
  const width = sourceData.width
  const height = sourceData.height
  const totalPixels = width * height
  const src = sourceData.data

  const normalStrength = options.normalStrength ?? 2.0
  const invertNormalY = options.invertNormalY ?? false
  const aoStrength = options.aoStrength ?? 1.0
  const metallicMode = options.metallicMode ?? "auto"

  // 1. Compute Grayscale Height / Luminance buffer
  const heights = new Float32Array(totalPixels)
  for (let i = 0; i < totalPixels; i++) {
    const r = src[i * 4]
    const g = src[i * 4 + 1]
    const b = src[i * 4 + 2]
    // Perceptual luminance formula (ITU-R BT.601)
    heights[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
  }

  const getHeight = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(width - 1, x))
    const cy = Math.max(0, Math.min(height - 1, y))
    return heights[cy * width + cx]
  }

  // 2. Allocate output buffers
  const albedoBuffer = new Uint8ClampedArray(src)
  const heightBuffer = new Uint8ClampedArray(totalPixels * 4)
  const normalBuffer = new Uint8ClampedArray(totalPixels * 4)
  const roughnessBuffer = new Uint8ClampedArray(totalPixels * 4)
  const metallicBuffer = new Uint8ClampedArray(totalPixels * 4)
  const aoBuffer = new Uint8ClampedArray(totalPixels * 4)

  const dZ = 1.0 / Math.max(0.01, normalStrength)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const hCenter = heights[y * width + x]
      const hByte = Math.round(hCenter * 255)

      // --- Height Map ---
      heightBuffer[idx] = hByte
      heightBuffer[idx + 1] = hByte
      heightBuffer[idx + 2] = hByte
      heightBuffer[idx + 3] = 255

      // --- Normal Map (Sobel Filter) ---
      const tl = getHeight(x - 1, y - 1)
      const t = getHeight(x, y - 1)
      const tr = getHeight(x + 1, y - 1)
      const l = getHeight(x - 1, y)
      const r = getHeight(x + 1, y)
      const bl = getHeight(x - 1, y + 1)
      const b = getHeight(x, y + 1)
      const br = getHeight(x + 1, y + 1)

      const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl)
      let dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr)
      if (invertNormalY) dY = -dY

      const len = Math.sqrt(dX * dX + dY * dY + dZ * dZ)
      const nx = -dX / len
      const ny = -dY / len
      const nz = dZ / len

      normalBuffer[idx] = Math.round((nx * 0.5 + 0.5) * 255)
      normalBuffer[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      normalBuffer[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      normalBuffer[idx + 3] = 255

      // --- Roughness Map ---
      // Derived from inverted luminance + surface normal deviation
      const normalDeviation = Math.abs(nx) + Math.abs(ny)
      const roughVal = Math.max(0, Math.min(255, Math.round((1.0 - hCenter) * 200 + normalDeviation * 55)))
      roughnessBuffer[idx] = roughVal
      roughnessBuffer[idx + 1] = roughVal
      roughnessBuffer[idx + 2] = roughVal
      roughnessBuffer[idx + 3] = 255

      // --- Metallic Map ---
      const rVal = src[idx]
      const gVal = src[idx + 1]
      const bVal = src[idx + 2]
      const sat = Math.max(rVal, gVal, bVal) - Math.min(rVal, gVal, bVal)
      let metalVal = 0
      if (metallicMode === "metal") {
        metalVal = 255
      } else if (metallicMode === "dielectric") {
        metalVal = 0
      } else {
        // Auto heuristic: saturated regions or very bright specular spots
        metalVal = sat > 50 || (hCenter > 0.85 && sat > 20) ? 255 : 0
      }
      metallicBuffer[idx] = metalVal
      metallicBuffer[idx + 1] = metalVal
      metallicBuffer[idx + 2] = metalVal
      metallicBuffer[idx + 3] = 255

      // --- Ambient Occlusion (AO) Map ---
      // Local curvature / cavity darkening
      const avgNeighbors = (tl + t + tr + l + r + bl + b + br) / 8.0
      const cavity = Math.max(0, avgNeighbors - hCenter)
      const aoVal = Math.max(0, Math.min(255, Math.round(255 - cavity * 400 * aoStrength)))
      aoBuffer[idx] = aoVal
      aoBuffer[idx + 1] = aoVal
      aoBuffer[idx + 2] = aoVal
      aoBuffer[idx + 3] = 255
    }
  }

  return {
    albedo: albedoBuffer,
    heightMap: heightBuffer,
    normal: normalBuffer,
    roughness: roughnessBuffer,
    metallic: metallicBuffer,
    ao: aoBuffer,
    width,
    height,
  }
}

/**
 * Converts a raw pixel buffer to a canvas, Blob, and data URL.
 */
async function bufferToImageItem(
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
  id: PbrMapItem["id"],
  title: string,
  description: string
): Promise<PbrMapItem> {
  if (typeof document === "undefined") {
    // Node / non-DOM mock
    const fakeBlob = new Blob([buffer as unknown as BlobPart], { type: "image/png" })
    return {
      id,
      title,
      description,
      blob: fakeBlob,
      dataUrl: "",
      width,
      height,
    }
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not create 2D canvas context for baking")

  const imgData = new ImageData(buffer as any, width, height)
  ctx.putImageData(imgData, 0, 0)

  const dataUrl = canvas.toDataURL("image/png")
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), "image/png")
  })

  return {
    id,
    title,
    description,
    blob,
    dataUrl,
    width,
    height,
  }
}

const MAP_META: Record<PbrMapItem["id"], [title: string, description: string]> = {
  albedo: ["Albedo / Base Color", "Diffuse color texture"],
  normal: ["Tangent Normal Map", "DirectX/OpenGL tangent-space normal vectors"],
  roughness: ["Roughness Map", "Surface microfacet scattering / smoothness"],
  height: ["Height / Displacement", "Grayscale geometric displacement elevation"],
  metallic: ["Metallic Map", "Conductive metal vs dielectric mask"],
  ao: ["Ambient Occlusion", "Micro-cavity ambient light shadowing"],
}

function bytesToDataUrl(png: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(bin)}`
}

/**
 * WASM fast path. Returns null (-> TS fallback) when the engine is unavailable, the worker fails or
 * times out. Maps are PNG-encoded by Rust; the ZIP comes straight from the Rust packager.
 * Tolerance vs the TS path: every channel within +-1 (f32 vs f64 rounding), see wasm-engine tests.
 */
async function bakeNative(src: ImageData, options: BakeOptions): Promise<PbrBakeResult | null> {
  try {
    const { wasmEngine } = await import("@/core/wasmEngine")
    const out = await wasmEngine.bakePbrNative(src, src.width, src.height, options)
    if (!out) return null
    const png: Record<PbrMapItem["id"], Uint8Array> = {
      albedo: out.albedo_png,
      normal: out.normal_png,
      roughness: out.roughness_png,
      height: out.height_png,
      metallic: out.metallic_png,
      ao: out.ao_png,
    }
    const maps: Record<string, PbrMapItem> = {}
    for (const id of Object.keys(png) as PbrMapItem["id"][]) {
      maps[id] = {
        id,
        title: MAP_META[id][0],
        description: MAP_META[id][1],
        blob: new Blob([png[id] as BlobPart], { type: "image/png" }),
        dataUrl: bytesToDataUrl(png[id]),
        width: out.width,
        height: out.height,
      }
    }
    return { resolution: src.width, maps, createZip: () => out.zip_archive }
  } catch (err) {
    console.warn("[textureBaker] WASM bake failed, using TS fallback:", err)
    return null
  }
}

/**
 * High-level baker: extracts source image from canvas at target resolution,
 * computes all 6 PBR maps, and provides one-click ZIP packaging.
 */
export async function bakePbrMaps(options: BakeOptions = {}): Promise<PbrBakeResult> {
  const resolution = options.resolution ?? 2048
  const width = resolution
  const height = resolution

  let sourceData: ImageData

  if (options.canvas && typeof document !== "undefined") {
    const offscreen = document.createElement("canvas")
    offscreen.width = width
    offscreen.height = height
    const ctx = offscreen.getContext("2d")
    if (!ctx) throw new Error("Failed to get 2d context for baking")

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(options.canvas, 0, 0, width, height)
    sourceData = ctx.getImageData(0, 0, width, height)
  } else {
    // Generate synthetic test pattern if canvas not present
    const dummy = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        dummy[i] = Math.round((x / width) * 255)
        dummy[i + 1] = Math.round((y / height) * 255)
        dummy[i + 2] = 180
        dummy[i + 3] = 255
      }
    }
    sourceData = {
      data: dummy,
      width,
      height,
      colorSpace: "srgb",
    } as unknown as ImageData
  }

  // Fast path: Rust/WASM bake (Sobel maps + PNG + ZIP) in a worker; TS below is the fallback.
  const native = await bakeNative(sourceData, options)
  if (native) return native

  const pixelBuffers = generatePbrPixelBuffers(sourceData, {
    normalStrength: options.normalStrength,
    invertNormalY: options.invertNormalY,
    aoStrength: options.aoStrength,
    metallicMode: options.metallicMode,
  })

  const [albedo, normal, roughness, heightMap, metallic, ao] = await Promise.all([
    bufferToImageItem(pixelBuffers.albedo, width, height, "albedo", ...MAP_META.albedo),
    bufferToImageItem(pixelBuffers.normal, width, height, "normal", ...MAP_META.normal),
    bufferToImageItem(pixelBuffers.roughness, width, height, "roughness", ...MAP_META.roughness),
    bufferToImageItem(pixelBuffers.heightMap, width, height, "height", ...MAP_META.height),
    bufferToImageItem(pixelBuffers.metallic, width, height, "metallic", ...MAP_META.metallic),
    bufferToImageItem(pixelBuffers.ao, width, height, "ao", ...MAP_META.ao),
  ])

  const maps: Record<string, PbrMapItem> = {
    albedo,
    normal,
    roughness,
    height: heightMap,
    metallic,
    ao,
  }

  const createZip = () => {
    const files: ZipFileInput[] = []

    const manifest = {
      generator: "Shader Studio PBR Baker",
      resolution: `${width}x${height}`,
      timestamp: new Date().toISOString(),
      maps: {
        albedo: "albedo.png",
        normal: "normal.png",
        roughness: "roughness.png",
        height: "height.png",
        metallic: "metallic.png",
        ao: "ao.png",
      },
      instructions: {
        blender: "Plug Albedo into Base Color, Normal into Normal Map node, Roughness into Roughness, Height into Displacement.",
        unrealEngine: "Connect Albedo to Base Color, Normal to Normal, Roughness to Roughness, Metallic to Metallic, AO to Ambient Occlusion.",
        unity: "Use Standard/Lit shader. Assign Albedo, Metallic/Smoothness, and Normal Map.",
      },
    }

    const encoder = new TextEncoder()
    files.push({
      name: "material_manifest.json",
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
    })

    for (const [key, item] of Object.entries(maps)) {
      // In browser, item.dataUrl is standard base64 data URL
      if (item.dataUrl.startsWith("data:image/png;base64,")) {
        const base64 = item.dataUrl.split(",")[1]
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        files.push({ name: `${key}.png`, data: bytes })
      }
    }

    return createZipArchive(files)
  }

  return {
    resolution,
    maps,
    createZip,
  }
}
