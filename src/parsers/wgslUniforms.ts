import type { ParsedUniform, UniformType } from "@/stores/projectStore"

const STRUCT_REGEX = /struct\s+(\w+)\s*\{([^}]+)\}/g
const ARRAY_REGEX = /^array<\s*([^,]+)\s*,\s*(\d+)\s*>$/
const COLOR_NAMES = /color|tint|albedo/i
const TOP_LEVEL_VAR_REGEX = /(?:@group\s*\(\s*\d+\s*\)\s*@binding\s*\(\s*\d+\s*\)|@binding\s*\(\s*\d+\s*\)\s*@group\s*\(\s*\d+\s*\))\s*var(?:\s*<[^>]+>)?\s+(\w+)\s*:\s*([^;]+);/g

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

function extractStructFields(structBody: string): Array<{ name: string; typeStr: string }> {
  const fields: Array<{ name: string; typeStr: string }> = []
  const regex = /(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:\s*/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(structBody)) !== null) {
    const name = match[1]
    const startIndex = regex.lastIndex
    let depth = 0
    let endIndex = startIndex
    while (endIndex < structBody.length) {
      const ch = structBody[endIndex]
      if (ch === "<") {
        depth++
      } else if (ch === ">") {
        depth = Math.max(0, depth - 1)
      } else if (depth === 0 && (ch === "," || ch === ";" || ch === "\n" || ch === "}")) {
        break
      }
      endIndex++
    }
    const typeStr = structBody.slice(startIndex, endIndex).trim()
    fields.push({ name, typeStr })
    regex.lastIndex = endIndex + 1
  }
  return fields
}

export function parseWgslUniforms(source: string): ParsedUniform[] {
  const clean = stripComments(source)
  const uniforms: ParsedUniform[] = []
  const seen = new Set<string>()

  // 1. Parse top-level structs
  let structMatch: RegExpExecArray | null
  STRUCT_REGEX.lastIndex = 0
  while ((structMatch = STRUCT_REGEX.exec(clean)) !== null) {
    const structBody = structMatch[2]
    // Skip IO structs (vertex input/output, stage interface structs)
    if (/@(?:location|builtin|interpolate|invariant)\b/.test(structBody)) continue

    const fields = extractStructFields(structBody)
    for (const { name, typeStr } of fields) {
      if (seen.has(name)) continue

      const arrayMatch = typeStr.match(ARRAY_REGEX)
      if (arrayMatch) {
        const baseType = arrayMatch[1].trim()
        const arrayLength = parseInt(arrayMatch[2], 10)
        for (let i = 0; i < arrayLength; i++) {
          const fieldName = `${name}[${i}]`
          if (!seen.has(fieldName)) {
            seen.add(fieldName)
            const parsed = parseType(baseType, fieldName, name)
            if (parsed) uniforms.push(parsed)
          }
        }
        continue
      }

      seen.add(name)
      const parsed = parseType(typeStr, name, name)
      if (parsed) uniforms.push(parsed)
    }
  }

  // 2. Parse top-level module vars (e.g. texture_2d, standalone uniform vars)
  let varMatch: RegExpExecArray | null
  TOP_LEVEL_VAR_REGEX.lastIndex = 0
  while ((varMatch = TOP_LEVEL_VAR_REGEX.exec(clean)) !== null) {
    const name = varMatch[1]
    const typeStr = varMatch[2].trim()
    if (!seen.has(name)) {
      const parsed = parseType(typeStr, name, name)
      if (parsed) {
        seen.add(name)
        uniforms.push(parsed)
      }
    }
  }

  return uniforms
}

function parseType(typeStr: string, fieldName: string, originalName: string): ParsedUniform | null {
  const normalizedType = normalizeWgslType(typeStr)
  if (!normalizedType) return null

  const isColor = COLOR_NAMES.test(originalName) && (normalizedType === "vec3f" || normalizedType === "vec4f")

  if (normalizedType === "texture") {
    return { name: fieldName, type: "texture", kind: "texture" }
  }
  if (isColor) {
    return { name: fieldName, type: normalizedType as "vec3f" | "vec4f", kind: "color" }
  }
  if (normalizedType.startsWith("mat")) {
    return { name: fieldName, type: normalizedType as "mat2x2f" | "mat3x3f" | "mat4x4f", kind: "matrix" }
  }
  if (normalizedType.startsWith("vec")) {
    return { name: fieldName, type: normalizedType as "vec2f" | "vec3f" | "vec4f", kind: "vector" }
  }
  return { name: fieldName, type: normalizedType as "f32" | "i32" | "u32" | "bool", kind: "scalar" }
}

function normalizeWgslType(typeStr: string): UniformType | null {
  const t = typeStr.replace(/\s+/g, "")
  if (t === "f32") return "f32"
  if (t === "i32") return "i32"
  if (t === "u32") return "u32"
  if (t === "bool") return "bool"

  // Vectors
  if (t === "vec2<f32>" || t === "vec2f" || t === "vec2") return "vec2f"
  if (t === "vec3<f32>" || t === "vec3f" || t === "vec3") return "vec3f"
  if (t === "vec4<f32>" || t === "vec4f" || t === "vec4") return "vec4f"

  // Matrices
  if (t === "mat2x2<f32>" || t === "mat2x2f" || t === "mat2x2") return "mat2x2f"
  if (t === "mat3x3<f32>" || t === "mat3x3f" || t === "mat3x3") return "mat3x3f"
  if (t === "mat4x4<f32>" || t === "mat4x4f" || t === "mat4x4") return "mat4x4f"

  // Textures and samplers
  if (t.startsWith("texture_2d")) return "texture"
  if (t === "sampler" || t === "sampler_comparison") return null

  return null
}
