import type { ParsedUniform, UniformType } from "@/stores/projectStore"

const COLOR_NAMES = /color|tint|albedo/i

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

export function parseGlslUniforms(source: string): ParsedUniform[] {
  const clean = stripComments(source)
  const uniforms: ParsedUniform[] = []
  const seen = new Set<string>()

  // 1. Collect struct definitions
  interface StructField {
    type: string
    name: string
    arraySize?: number
  }
  const structMap = new Map<string, StructField[]>()
  const STRUCT_DEF_REGEX = /struct\s+(\w+)\s*\{([^}]+)\}\s*;/g
  let sMatch: RegExpExecArray | null
  while ((sMatch = STRUCT_DEF_REGEX.exec(clean)) !== null) {
    const structName = sMatch[1]
    const body = sMatch[2]
    const fields: StructField[] = []
    const FIELD_REGEX = /(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)(?:\s*\[\s*(\d+)\s*\])?\s*;/g
    let fMatch: RegExpExecArray | null
    while ((fMatch = FIELD_REGEX.exec(body)) !== null) {
      fields.push({
        type: fMatch[1],
        name: fMatch[2],
        arraySize: fMatch[3] ? parseInt(fMatch[3], 10) : undefined,
      })
    }
    structMap.set(structName, fields)
  }

  // 2. Parse uniform blocks (anonymous or named instances)
  const BLOCK_REGEX = /(?:layout\s*\([^)]*\)\s*)?uniform\s+(\w+)\s*\{([^}]+)\}(?:\s*(\w+)(?:\s*\[\s*(\d+)\s*\])?)?\s*;/g
  let bMatch: RegExpExecArray | null
  while ((bMatch = BLOCK_REGEX.exec(clean)) !== null) {
    const blockBody = bMatch[2]
    const instanceName = bMatch[3]
    const blockArraySize = bMatch[4] ? parseInt(bMatch[4], 10) : null

    const FIELD_REGEX = /(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)(?:\s*\[\s*(\d+)\s*\])?\s*;/g
    let bfMatch: RegExpExecArray | null
    while ((bfMatch = FIELD_REGEX.exec(blockBody)) !== null) {
      const typeStr = bfMatch[1]
      const memberName = bfMatch[2]
      const memberArraySize = bfMatch[3] ? parseInt(bfMatch[3], 10) : null

      const addField = (name: string, orig: string) => {
        if (seen.has(name)) return
        seen.add(name)
        const parsed = parseType(typeStr, name, orig)
        if (parsed) uniforms.push(parsed)
      }

      if (blockArraySize !== null && instanceName) {
        for (let bi = 0; bi < blockArraySize; bi++) {
          if (memberArraySize !== null) {
            for (let mi = 0; mi < memberArraySize; mi++) {
              addField(`${instanceName}[${bi}].${memberName}[${mi}]`, memberName)
            }
          } else {
            addField(`${instanceName}[${bi}].${memberName}`, memberName)
          }
        }
      } else if (instanceName) {
        if (memberArraySize !== null) {
          for (let mi = 0; mi < memberArraySize; mi++) {
            addField(`${instanceName}.${memberName}[${mi}]`, memberName)
          }
        } else {
          addField(`${instanceName}.${memberName}`, memberName)
        }
      } else {
        // Anonymous uniform block
        if (memberArraySize !== null) {
          for (let mi = 0; mi < memberArraySize; mi++) {
            addField(`${memberName}[${mi}]`, memberName)
          }
        } else {
          addField(memberName, memberName)
        }
      }
    }
  }

  // 3. Parse standard uniform declarations
  const UNIFORM_REGEX = /(?:layout\s*\([^)]*\)\s*)?uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)(?:\s*\[\s*(\d+)\s*\])?\s*;/g
  let match: RegExpExecArray | null
  while ((match = UNIFORM_REGEX.exec(clean)) !== null) {
    const typeStr = match[1]
    const name = match[2]
    const arraySize = match[3] ? parseInt(match[3], 10) : null

    // If typeStr is a struct defined in the shader
    if (structMap.has(typeStr)) {
      const fields = structMap.get(typeStr)!
      const expandStruct = (prefix: string) => {
        for (const f of fields) {
          if (f.arraySize) {
            for (let i = 0; i < f.arraySize; i++) {
              const fullName = `${prefix}.${f.name}[${i}]`
              if (!seen.has(fullName)) {
                seen.add(fullName)
                const parsed = parseType(f.type, fullName, f.name)
                if (parsed) uniforms.push(parsed)
              }
            }
          } else {
            const fullName = `${prefix}.${f.name}`
            if (!seen.has(fullName)) {
              seen.add(fullName)
              const parsed = parseType(f.type, fullName, f.name)
              if (parsed) uniforms.push(parsed)
            }
          }
        }
      }

      if (arraySize !== null) {
        for (let i = 0; i < arraySize; i++) {
          expandStruct(`${name}[${i}]`)
        }
      } else {
        expandStruct(name)
      }
      continue
    }

    if (arraySize !== null) {
      for (let i = 0; i < arraySize; i++) {
        const fieldName = `${name}[${i}]`
        if (!seen.has(fieldName)) {
          seen.add(fieldName)
          const parsed = parseType(typeStr, fieldName, name)
          if (parsed) uniforms.push(parsed)
        }
      }
      continue
    }

    if (!seen.has(name)) {
      seen.add(name)
      const parsed = parseType(typeStr, name, name)
      if (parsed) uniforms.push(parsed)
    }
  }

  return uniforms
}

function parseType(typeStr: string, fieldName: string, originalName: string): ParsedUniform | null {
  const normalizedType = normalizeGlslType(typeStr)
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

function normalizeGlslType(typeStr: string): UniformType | null {
  const t = typeStr.trim()
  if (t === "float") return "f32"
  if (t === "int") return "i32"
  if (t === "uint") return "u32"
  if (t === "bool") return "bool"

  // Vectors
  if (t === "vec2") return "vec2f"
  if (t === "vec3") return "vec3f"
  if (t === "vec4") return "vec4f"

  // Matrices
  if (t === "mat2" || t === "mat2x2") return "mat2x2f"
  if (t === "mat3" || t === "mat3x3") return "mat3x3f"
  if (t === "mat4" || t === "mat4x4") return "mat4x4f"

  // Textures
  if (t.startsWith("sampler")) return "texture"

  return null
}
