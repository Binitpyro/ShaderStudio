/**
 * glTF 2.0 Material Exporter with support for KHR_materials_unlit,
 * KHR_materials_pbrSpecularGlossiness, and ORM channel packing.
 */

export interface GltfExportOptions {
  unlit?: boolean
  diffuseFactor?: [number, number, number, number]
  specularFactor?: [number, number, number]
  glossinessFactor?: number
  baseColorFactor?: [number, number, number, number]
  metallicFactor?: number
  roughnessFactor?: number
  bakedMaps?: Record<string, { dataUrl?: string; blob?: Blob; buffer?: Uint8ClampedArray }>
  width?: number
  height?: number
  /**
   * GLSL fragment the material was authored with. glTF has no shader slot, so it travels in `extras.shaderStudio`
   * (readable by importers that want the procedural source) and drives the PBR factors below when not set explicitly.
   */
  shaderSource?: string
  uniformValues?: Record<string, { type?: string; value: unknown }>
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const channel = (n: unknown): number => Math.min(1, Math.max(0, num(n) ?? 1))

/** PBR factors guessed from conventionally named uniforms (u_color / u_albedo / u_baseColor, u_roughness, u_metallic). */
function factorsFromUniforms(values: NonNullable<GltfExportOptions["uniformValues"]>) {
  const find = (re: RegExp) => Object.entries(values).find(([k]) => re.test(k))?.[1]?.value
  const color = find(/^(u_)?(base_?color|albedo|color)$/i)
  const rough = num(find(/^(u_)?roughness$/i))
  const metal = num(find(/^(u_)?metallic$/i))
  return {
    baseColorFactor: Array.isArray(color) && color.length >= 3 ? ([channel(color[0]), channel(color[1]), channel(color[2]), channel(color[3] ?? 1)] as [number, number, number, number]) : undefined,
    roughnessFactor: rough === undefined ? undefined : Math.min(1, Math.max(0, rough)),
    metallicFactor: metal === undefined ? undefined : Math.min(1, Math.max(0, metal)),
  }
}

export interface GltfMaterialExportResult {
  gltfJson: Record<string, any>
  extensionsUsed: string[]
}

/**
 * Channel-packs separate Ambient Occlusion (AO), Roughness, and Metallic buffers
 * into a single unified glTF ORM texture buffer:
 *   Red   = Ambient Occlusion (AO)
 *   Green = Roughness
 *   Blue  = Metallic
 *   Alpha = 255 (Opaque)
 */
export function packOrmTexture(
  ao: Uint8ClampedArray,
  roughness: Uint8ClampedArray,
  metallic: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const totalPixels = width * height
  const ormBuffer = new Uint8ClampedArray(totalPixels * 4)

  const isAo1Channel = ao.length === totalPixels
  const isRoughness1Channel = roughness.length === totalPixels
  const isMetallic1Channel = metallic.length === totalPixels

  for (let i = 0; i < totalPixels; i++) {
    const destIdx = i * 4

    const aoIdx = isAo1Channel ? i : destIdx
    const roughIdx = isRoughness1Channel ? i : destIdx
    const metalIdx = isMetallic1Channel ? i : destIdx

    // R: Ambient Occlusion
    ormBuffer[destIdx] = ao.length > 0 && ao[aoIdx] !== undefined ? ao[aoIdx] : 255
    // G: Roughness
    ormBuffer[destIdx + 1] = roughness.length > 0 && roughness[roughIdx] !== undefined ? roughness[roughIdx] : 128
    // B: Metallic
    ormBuffer[destIdx + 2] = metallic.length > 0 && metallic[metalIdx] !== undefined ? metallic[metalIdx] : 0
    // A: Full Alpha
    ormBuffer[destIdx + 3] = 255
  }

  return ormBuffer
}

/**
 * Exports a ShaderStudio material as a glTF 2.0 JSON structure.
 */
export function exportGltf2Material(
  materialName: string,
  unlit = false,
  options?: GltfExportOptions
): GltfMaterialExportResult {
  const extensionsUsed: string[] = []
  const guess = options?.uniformValues ? factorsFromUniforms(options.uniformValues) : undefined
  const material: Record<string, any> = {
    name: materialName,
    pbrMetallicRoughness: {
      baseColorFactor: options?.baseColorFactor ?? guess?.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: options?.metallicFactor ?? guess?.metallicFactor ?? 0.0,
      roughnessFactor: options?.roughnessFactor ?? guess?.roughnessFactor ?? 0.5,
    },
  }
  if (options?.shaderSource?.trim()) {
    material.extras = { shaderStudio: { language: "glsl", fragment: options.shaderSource } }
  }

  if (unlit) {
    extensionsUsed.push("KHR_materials_unlit")
    material.extensions = { KHR_materials_unlit: {} }
  } else {
    extensionsUsed.push("KHR_materials_pbrSpecularGlossiness")
    material.extensions = {
      KHR_materials_pbrSpecularGlossiness: {
        diffuseFactor: options?.diffuseFactor ?? [1, 1, 1, 1],
        specularFactor: options?.specularFactor ?? [1, 1, 1],
        glossinessFactor: options?.glossinessFactor ?? 0.5,
      },
    }
  }

  const gltfJson: Record<string, any> = {
    asset: { version: "2.0", generator: "ShaderStudio-glTF-Exporter" },
    extensionsUsed,
    materials: [material],
  }

  // If baked texture maps are provided, embed image references
  if (options?.bakedMaps && Object.keys(options.bakedMaps).length > 0) {
    const images: Array<{ uri: string; name: string }> = []
    const textures: Array<{ source: number; sampler: number }> = []

    for (const [mapType, item] of Object.entries(options.bakedMaps)) {
      if (item.dataUrl) {
        const imageIndex = images.length
        images.push({ uri: item.dataUrl, name: `${materialName}_${mapType}` })
        textures.push({ source: imageIndex, sampler: 0 })

        if (mapType === "albedo" || mapType === "diffuse") {
          material.pbrMetallicRoughness.baseColorTexture = { index: imageIndex }
        } else if (mapType === "normal") {
          material.normalTexture = { index: imageIndex }
        } else if (mapType === "ao" || mapType === "occlusion") {
          material.occlusionTexture = { index: imageIndex }
        } else if (mapType === "orm" || mapType === "metallicRoughness") {
          material.pbrMetallicRoughness.metallicRoughnessTexture = { index: imageIndex }
        }
      }
    }

    if (images.length > 0) {
      gltfJson.images = images
      gltfJson.textures = textures
      gltfJson.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    }
  }

  return { gltfJson, extensionsUsed }
}

/**
 * Bundles the glTF material into a downloadable JSON string.
 */
export function createGltfBundle(
  materialName: string,
  unlit = false,
  options?: GltfExportOptions
): string {
  const result = exportGltf2Material(materialName, unlit, options)
  return JSON.stringify(result.gltfJson, null, 2)
}
