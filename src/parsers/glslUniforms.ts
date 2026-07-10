import type { ParsedUniform } from "@/stores/projectStore"

const UNIFORM_REGEX = /^\s*uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;\s*$/gm
const COLOR_NAMES = /color|tint|albedo/i

export function parseGlslUniforms(source: string): ParsedUniform[] {
  const uniforms: ParsedUniform[] = []
  let match
  while ((match = UNIFORM_REGEX.exec(source)) !== null) {
    const typeStr = match[1]
    const name = match[2]
    const arraySize = match[3] ? parseInt(match[3], 10) : null
    if (arraySize) {
      for (let i = 0; i < arraySize; i++) {
        const parsed = parseType(typeStr, `${name}[${i}]`, name)
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
  const normalizedType = normalizeGlslType(typeStr)
  if (!normalizedType) return null
  const isColor = COLOR_NAMES.test(originalName) && (normalizedType === "vec3f" || normalizedType === "vec4f")
  if (normalizedType === "sampler2D") return { name: fieldName, type: "texture", kind: "texture" }
  if (isColor) return { name: fieldName, type: normalizedType as "vec3f" | "vec4f", kind: "color" }
  if (normalizedType.startsWith("vec")) return { name: fieldName, type: normalizedType as "vec2f" | "vec3f" | "vec4f", kind: "vector" }
  return { name: fieldName, type: normalizedType as "f32" | "i32" | "u32" | "bool", kind: "scalar" }
}

function normalizeGlslType(typeStr: string): string | null {
  const t = typeStr.trim()
  if (t === "float") return "f32"
  if (t === "int") return "i32"
  if (t === "uint") return "u32"
  if (t === "bool") return "bool"
  if (t === "vec2") return "vec2f"
  if (t === "vec3") return "vec3f"
  if (t === "vec4") return "vec4f"
  if (t === "sampler2D") return "sampler2D"
  return null
}
