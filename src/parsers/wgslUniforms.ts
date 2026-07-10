import type { ParsedUniform } from "@/stores/projectStore"

const UNIFORM_STRUCT_REGEX = /struct\s+Uniforms\s*\{([^}]+)\}/
const FIELD_REGEX = /^\s*(\w+)\s*:\s*([^,]+)\s*,?\s*$/gm
const ARRAY_REGEX = /^array<([^,]+),\s*(\d+)>$/
const COLOR_NAMES = /color|tint|albedo/i

export function parseWgslUniforms(source: string): ParsedUniform[] {
  const uniforms: ParsedUniform[] = []
  const structMatch = source.match(UNIFORM_STRUCT_REGEX)
  if (!structMatch) return uniforms
  const structBody = structMatch[1]
  let match
  while ((match = FIELD_REGEX.exec(structBody)) !== null) {
    const name = match[1]
    let typeStr = match[2].trim()
    const arrayMatch = typeStr.match(ARRAY_REGEX)
    if (arrayMatch) {
      const baseType = arrayMatch[1]
      const arrayLength = parseInt(arrayMatch[2], 10)
      for (let i = 0; i < arrayLength; i++) {
        const parsed = parseType(baseType, `${name}[${i}]`, name)
        if (parsed) uniforms.push(parsed)
      }
      continue
    }
    const parsed = parseType(typeStr, name, name)
    if (parsed) uniforms.push(parsed)
  }
  return uniforms
}

function parseType(typeStr: string, fieldName: string, originalName: string): ParsedUniform | null {
  const normalizedType = normalizeWgslType(typeStr)
  if (!normalizedType) return null
  const isColor = COLOR_NAMES.test(originalName) && (normalizedType === "vec3f" || normalizedType === "vec4f")
  if (normalizedType === "texture_2d") return { name: fieldName, type: "texture", kind: "texture" }
  if (isColor) return { name: fieldName, type: normalizedType as "vec3f" | "vec4f", kind: "color" }
  if (normalizedType.startsWith("vec")) return { name: fieldName, type: normalizedType as "vec2f" | "vec3f" | "vec4f", kind: "vector" }
  return { name: fieldName, type: normalizedType as "f32" | "i32" | "u32" | "bool", kind: "scalar" }
}

function normalizeWgslType(typeStr: string): string | null {
  const t = typeStr.trim()
  if (t === "f32") return "f32"
  if (t === "i32") return "i32"
  if (t === "u32") return "u32"
  if (t === "bool") return "bool"
  if (t === "vec2<f32>" || t === "vec2f") return "vec2f"
  if (t === "vec3<f32>" || t === "vec3f") return "vec3f"
  if (t === "vec4<f32>" || t === "vec4f") return "vec4f"
  if (t.startsWith("texture_2d")) return "texture_2d"
  if (t === "sampler") return null
  return null
}
