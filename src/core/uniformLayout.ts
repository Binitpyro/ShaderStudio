import type { ParsedUniform } from "@/stores/projectStore"

export type UniformFieldType =
  | "f32" | "i32" | "u32" | "bool"
  | "vec2f" | "vec3f" | "vec4f"
  | "mat2x2f" | "mat3x3f" | "mat4x4f"
  | "texture_2d"

export interface UniformFieldLayout {
  name: string
  type: UniformFieldType
  offset: number      // byte offset in uniform buffer (std140 / WGSL host-shareable)
  size: number        // byte size
  alignment: number   // alignment requirement (4, 8, 16)
  arrayCount?: number
  arrayStride?: number
}

export interface UniformBufferLayout {
  totalSize: number   // padded total size (multiple of 16 bytes, minimum 16 bytes)
  fields: Record<string, UniformFieldLayout>
}

export function alignTo(offset: number, alignment: number): number {
  if (alignment <= 1) return offset
  return (offset + alignment - 1) & ~(alignment - 1)
}

export function normalizeFieldType(typeStr: string): UniformFieldType {
  const t = typeStr.trim()
  if (t === "texture" || t.startsWith("texture_2d") || t.startsWith("sampler")) return "texture_2d"
  if (t === "float" || t === "f32") return "f32"
  if (t === "int" || t === "i32") return "i32"
  if (t === "uint" || t === "u32") return "u32"
  if (t === "bool") return "bool"
  if (t === "vec2" || t === "vec2<f32>" || t === "vec2f") return "vec2f"
  if (t === "vec3" || t === "vec3<f32>" || t === "vec3f") return "vec3f"
  if (t === "vec4" || t === "vec4<f32>" || t === "vec4f") return "vec4f"
  if (t === "mat2" || t === "mat2x2" || t === "mat2x2<f32>" || t === "mat2x2f") return "mat2x2f"
  if (t === "mat3" || t === "mat3x3" || t === "mat3x3<f32>" || t === "mat3x3f") return "mat3x3f"
  if (t === "mat4" || t === "mat4x4" || t === "mat4x4<f32>" || t === "mat4x4f") return "mat4x4f"
  return "f32"
}

export function getTypeMetrics(type: UniformFieldType): { size: number; alignment: number } {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
    case "bool":
      return { size: 4, alignment: 4 }
    case "vec2f":
      return { size: 8, alignment: 8 }
    case "vec3f":
      return { size: 12, alignment: 16 }
    case "vec4f":
      return { size: 16, alignment: 16 }
    case "mat2x2f":
      return { size: 16, alignment: 8 }
    case "mat3x3f":
      return { size: 48, alignment: 16 }
    case "mat4x4f":
      return { size: 64, alignment: 16 }
    case "texture_2d":
      return { size: 0, alignment: 0 }
    default:
      return { size: 4, alignment: 4 }
  }
}

export function computeUniformBufferLayout(uniforms: ParsedUniform[]): UniformBufferLayout {
  // Normalize and group indexed array members if any (e.g. weights[0]..weights[3] -> weights arrayLength: 4)
  const normalizedUniforms: ParsedUniform[] = []
  const seenArray = new Set<string>()

  for (const u of uniforms) {
    const m = u.name.match(/^(.+)\[(\d+)\]$/)
    if (m) {
      const baseName = m[1]
      if (!seenArray.has(baseName)) {
        seenArray.add(baseName)
        let maxCount = 0
        for (const other of uniforms) {
          const om = other.name.match(/^(.+)\[(\d+)\]$/)
          if (om && om[1] === baseName) {
            maxCount = Math.max(maxCount, parseInt(om[2], 10) + 1)
          }
        }
        normalizedUniforms.push({
          name: baseName,
          type: u.type,
          kind: u.kind,
          arrayLength: maxCount,
        })
      }
    } else {
      normalizedUniforms.push(u)
    }
  }

  const fields: Record<string, UniformFieldLayout> = {}
  let currentOffset = 0
  let maxAlignment = 16 // Uniform buffer minimum alignment is 16

  for (const uniform of normalizedUniforms) {
    const canonicalType = normalizeFieldType(uniform.type)
    if (canonicalType === "texture_2d") continue

    const { size: baseSize, alignment: baseAlign } = getTypeMetrics(canonicalType)
    maxAlignment = Math.max(maxAlignment, baseAlign)

    let size = baseSize
    let alignment = baseAlign
    let arrayCount: number | undefined
    let arrayStride: number | undefined

    if (uniform.arrayLength && uniform.arrayLength > 0) {
      arrayCount = uniform.arrayLength
      arrayStride = alignTo(baseSize, 16)
      size = arrayCount * arrayStride
      alignment = Math.max(16, baseAlign)
      maxAlignment = Math.max(maxAlignment, alignment)
    }

    const offset = alignTo(currentOffset, alignment)
    fields[uniform.name] = {
      name: uniform.name,
      type: canonicalType,
      offset,
      size,
      alignment,
      ...(arrayCount !== undefined ? { arrayCount, arrayStride } : {}),
    }

    currentOffset = offset + size
  }

  const totalSize = Math.max(16, alignTo(currentOffset, maxAlignment))

  return {
    totalSize,
    fields,
  }
}

export function packUniformBuffer(
  layout: UniformBufferLayout,
  values: Record<string, any>
): ArrayBuffer {
  const buffer = new ArrayBuffer(layout.totalSize)
  const view = new DataView(buffer)

  for (const field of Object.values(layout.fields)) {
    if (field.type === "texture_2d") continue

    let rawInput = values[field.name]
    if (rawInput === undefined && field.name.startsWith("u_")) {
      rawInput = values[field.name.slice(2)]
    }
    if (rawInput === undefined && !field.name.startsWith("u_")) {
      rawInput = values[`u_${field.name}`]
    }

    const val = (rawInput !== null && typeof rawInput === "object" && "value" in rawInput)
      ? rawInput.value
      : rawInput

    writeFieldData(view, field, val)
  }

  return buffer
}

export function writeFieldData(view: DataView, field: UniformFieldLayout, val: any) {
  const offset = field.offset

  if (field.arrayCount && field.arrayCount > 0 && field.arrayStride) {
    const arr = Array.isArray(val) ? val : []
    for (let i = 0; i < field.arrayCount; i++) {
      const elemOffset = offset + i * field.arrayStride
      writeScalarOrVector(view, field.type, elemOffset, arr[i])
    }
    return
  }

  writeScalarOrVector(view, field.type, offset, val)
}

function writeScalarOrVector(view: DataView, type: UniformFieldType, offset: number, val: any) {
  switch (type) {
    case "f32": {
      const num = Number(val)
      view.setFloat32(offset, isNaN(num) ? 0 : num, true)
      break
    }
    case "i32": {
      const num = Number(val)
      view.setInt32(offset, isNaN(num) ? 0 : (num | 0), true)
      break
    }
    case "u32": {
      const num = Number(val)
      view.setUint32(offset, isNaN(num) ? 0 : Math.max(0, num >>> 0), true)
      break
    }
    case "bool": {
      view.setUint32(offset, val ? 1 : 0, true)
      break
    }
    case "vec2f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      view.setFloat32(offset + 0, Number(arr[0] ?? 0) || 0, true)
      view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
      break
    }
    case "vec3f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      view.setFloat32(offset + 0, Number(arr[0] ?? 0) || 0, true)
      view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
      view.setFloat32(offset + 8, Number(arr[2] ?? 0) || 0, true)
      break
    }
    case "vec4f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      view.setFloat32(offset + 0, Number(arr[0] ?? 0) || 0, true)
      view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
      view.setFloat32(offset + 8, Number(arr[2] ?? 0) || 0, true)
      view.setFloat32(offset + 12, Number(arr[3] ?? 0) || 0, true)
      break
    }
    case "mat2x2f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      for (let i = 0; i < 4; i++) {
        view.setFloat32(offset + i * 4, Number(arr[i] ?? (i % 3 === 0 ? 1 : 0)) || 0, true)
      }
      break
    }
    case "mat3x3f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      if (arr.length >= 12) {
        for (let col = 0; col < 3; col++) {
          for (let row = 0; row < 3; row++) {
            view.setFloat32(offset + col * 16 + row * 4, Number(arr[col * 4 + row] ?? 0) || 0, true)
          }
        }
      } else {
        for (let col = 0; col < 3; col++) {
          for (let row = 0; row < 3; row++) {
            const idx = col * 3 + row
            const defaultVal = col === row ? 1 : 0
            view.setFloat32(offset + col * 16 + row * 4, Number(arr[idx] ?? defaultVal) || 0, true)
          }
        }
      }
      break
    }
    case "mat4x4f": {
      const arr = Array.isArray(val) || val instanceof Float32Array ? val : []
      for (let i = 0; i < 16; i++) {
        const defaultVal = i % 5 === 0 ? 1 : 0
        view.setFloat32(offset + i * 4, Number(arr[i] ?? defaultVal) || 0, true)
      }
      break
    }
  }
}
