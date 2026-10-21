import type { ParsedUniform, UniformValue } from "@/stores/projectStore"
import {
  atanRule,
  buildThreeVertexShader,
  collectIdentifiers,
  eatSwizzle,
  escapeTemplate,
  generateR3FComponent,
  generateR3FExport,
  maskNonCode,
  prepareThreeFragment,
  rewriteIdentifiers,
  splitGlsl,
  threeGeometry,
  threeUniformEntries,
  varyingKind,
  type ExportGeometry,
  type GlslSplit,
  type IdentRule,
} from "./r3fExporter"
import { createGltfBundle } from "./gltfExporter"

// NOTE: scripts/mcp-server.js loads this file through Node's type stripping: keep it free of enums, namespaces and
// parameter properties, and keep wasm out of the static import graph (wasmEngine is imported lazily below).

// Re-export modular export systems
export {
  exportGltf2Material,
  createGltfBundle,
  packOrmTexture,
  type GltfExportOptions,
  type GltfMaterialExportResult,
} from "./gltfExporter"

export {
  generateNpmPackage,
  createNpmPackageZip,
  type NpmPackageOptions,
  type NpmPackageResult,
} from "./npmPackageGenerator"

export {
  importShadertoy,
  importShadertoyFromUrl,
  createProjectFromShadertoy,
  type ShadertoyImportResult,
} from "./shadertoyImporter"

export {
  generateR3FExport,
  generateR3FComponent,
  type R3FExportOptions,
} from "./r3fExporter"

export { rewriteIdentifiers, splitGlsl, threeGeometry, type ExportGeometry } from "./r3fExporter"

export interface EngineExportOptions {
  shaderName?: string
  shaderSource: string
  parsedUniforms?: ParsedUniform[]
  uniformValues?: Record<string, UniformValue>
}

export interface UE5Parameter {
  name: string
  type: string
  ue5Type: string
}

export interface UE5TranspileResult {
  customExpressionHLSL: string
  materialFunctionHLSL: string
  parameters: UE5Parameter[]
}

function resolveUniforms(options: EngineExportOptions): ParsedUniform[] {
  if (Array.isArray(options.parsedUniforms)) {
    return options.parsedUniforms
  }
  const synthetic: ParsedUniform[] = []
  for (const [name, val] of Object.entries(options.uniformValues || {})) {
    let type: any = "f32"
    let kind: any = "scalar"
    if (val.type === "color") {
      type = "vec4f"
      kind = "color"
    } else if (val.type === "vec4") {
      type = "vec4f"
      kind = "vector"
    } else if (val.type === "vec3") {
      type = "vec3f"
      kind = "vector"
    } else if (val.type === "vec2") {
      type = "vec2f"
      kind = "vector"
    }
    synthetic.push({ name, type, kind })
  }
  return synthetic
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared helpers for the GLSL-source transpilers
// ---------------------------------------------------------------------------------------------------------------------

/** Provided by every engine, never an exposed property. `time` / `resolution` only count when the shader declares them. */
const ENGINE_BUILTINS = new Set(["u_time", "time", "u_resolution", "resolution", "u_mouse"])

/** `time` / `resolution` the shader declares as ordinary variables (so they are not the engine built-ins). */
function localVariables(code: string, names: string[]): Set<string> {
  const mask = maskNonCode(code)
  const found = new Set<string>()
  const re = new RegExp(String.raw`(?:^|[^\w])(uniform\s+)?(?:const\s+)?(?:float|int|uint|bool|double|[iub]?vec[234]|float[234]|mat[234])\s+(${names.join("|")})\b`, "g")
  for (let m = re.exec(mask); m; m = re.exec(mask)) if (!m[1]) found.add(m[2])
  return found
}

const fmtFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

/** Uniforms to expose: the parsed ones plus any the shader declares that the caller didn't list (matrices/arrays skipped). */
function mergeUniforms(options: EngineExportOptions, sp: GlslSplit): ParsedUniform[] {
  const base = resolveUniforms(options)
  const known = new Set(base.map((u) => u.name))
  const extra: ParsedUniform[] = []
  for (const d of sp.uniforms) {
    if (known.has(d.name) || ENGINE_BUILTINS.has(d.name) || d.array || /^mat/.test(d.type)) continue
    const color = /colou?r|tint|albedo/i.test(d.name)
    let u: ParsedUniform = { name: d.name, type: "f32", kind: "scalar" }
    if (d.type === "vec4") u = { ...u, type: "vec4f", kind: color ? "color" : "vector" }
    else if (d.type === "vec3") u = { ...u, type: "vec3f", kind: color ? "color" : "vector" }
    else if (d.type === "vec2") u = { ...u, type: "vec2f", kind: "vector" }
    else if (/^sampler/.test(d.type)) u = { ...u, type: "texture", kind: "texture" }
    extra.push(u)
  }
  return [...base, ...extra]
}

const GLSL_TO_HLSL_TYPES: Record<string, string> = {}
for (const n of ["2", "3", "4"]) {
  GLSL_TO_HLSL_TYPES["vec" + n] = "float" + n
  GLSL_TO_HLSL_TYPES["ivec" + n] = "int" + n
  GLSL_TO_HLSL_TYPES["uvec" + n] = "uint" + n
  GLSL_TO_HLSL_TYPES["bvec" + n] = "bool" + n
  GLSL_TO_HLSL_TYPES["mat" + n] = `float${n}x${n}`
}

const HLSL_MOD = `// GLSL mod(): x - y * floor(x / y) (HLSL fmod truncates toward zero)
float mod(float x, float y) { return x - y * floor(x / y); }
float2 mod(float2 x, float2 y) { return x - y * floor(x / y); }
float2 mod(float2 x, float y) { return x - y * floor(x / y); }
float3 mod(float3 x, float3 y) { return x - y * floor(x / y); }
float3 mod(float3 x, float y) { return x - y * floor(x / y); }
float4 mod(float4 x, float4 y) { return x - y * floor(x / y); }
float4 mod(float4 x, float y) { return x - y * floor(x / y); }`

/** Legal GLSL identifiers that are reserved words in HLSL (`float line = ...` does not compile there). */
const HLSL_RESERVED = ["line", "lineadj", "point", "triangle", "triangleadj", "sample", "linear", "centroid", "precise", "matrix", "vector", "half", "fixed", "shared", "string", "interface", "class", "sampler", "export", "pass", "technique", "compile", "extern", "inline", "volatile", "typedef", "namespace", "template", "this", "union", "unsigned", "signed", "operator", "private", "public", "protected", "register", "snorm", "unorm", "decl"]

const hlslTypeOf = (glsl: string) => GLSL_TO_HLSL_TYPES[glsl] ?? glsl

/** True when `name` is read by the code but never declared in it (so the wrapper must provide it). */
function needsImplicit(code: string, name: string): boolean {
  if (!collectIdentifiers(code).has(name)) return false
  return !new RegExp(String.raw`\b(?:float2|vec2|float|vec3|vec4|float3|float4)\s+${name}\b`).test(maskNonCode(code))
}

type UniformShape = "vec4" | "vec3" | "vec2" | "tex" | "float"

/** What the uniform is in GLSL: the type the shader declares when it does, else derived from the parsed uniform. */
function uniformShape(u: ParsedUniform, declared: string | undefined): UniformShape {
  if (declared) {
    if (declared === "vec4") return "vec4"
    if (declared === "vec3") return "vec3"
    if (declared === "vec2") return "vec2"
    return /^sampler/.test(declared) ? "tex" : "float"
  }
  if (u.kind === "texture") return "tex"
  if (u.kind === "color" || u.type === "vec4f") return "vec4"
  if (u.type === "vec3f") return "vec3"
  if (u.type === "vec2f") return "vec2"
  return "float"
}

/** Removes the common leading indentation so re-indenting doesn't stack (naga output is already indented). */
function dedent(s: string): string {
  const lines = s.split("\n")
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length), Infinity)
  return Number.isFinite(pad) && pad > 0 ? lines.map((l) => l.slice(Math.min(pad, /^[ \t]*/.exec(l)![0].length))).join("\n") : s
}

const headerLines = (target: string) => `// =====================================================================
// Generated by Shader Studio (https://github.com/Binitpyro/ShaderStudio)
// Target: ${target}
// =====================================================================`

// ---------------------------------------------------------------------------------------------------------------------
// GLSL -> HLSL semantic fixups (run after the identifier rewrite, so types are already floatN / floatNxN):
//  1. `vecN(scalar)` splat constructors are illegal in HLSL -> `((floatN)(scalar))`.
//  2. GLSL matrices are column-major, the emitted `floatNxN(a, b, ...)` fills rows, so the HLSL matrix is the transpose and
//     every GLSL matrix product `L * R` (mat*vec, vec*mat, mat*mat) becomes `mul(R, L)`; `v *= M` -> `v = mul(M, v)`.
//     (mat*vec: mul(v, M) = M*v; vec*mat: mul(M, v) = v*M; mat*mat: (AB)^T = B^T A^T = mul(B, A).)
// All scanning runs on the maskNonCode() view, so comments and strings are never read or rewritten.
// ---------------------------------------------------------------------------------------------------------------------

const isW = (c: string | undefined): boolean => c !== undefined && /\w/.test(c)
const isWs = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)
const MAT_NAME = /^float([234])x\1$/
const NOT_A_CALL = new Set(["return", "else", "if", "while", "for", "switch", "case", "do"])
const SS_MARK = "/*ShaderStudio"

function matchClose(mask: string, open: number): number {
  let depth = 0
  for (let i = open; i < mask.length; i++) {
    const c = mask[i]
    if (c === "(" || c === "[" || c === "{") depth++
    else if ((c === ")" || c === "]" || c === "}") && --depth === 0) return i
  }
  return -1
}

function matchOpen(mask: string, close: number): number {
  let depth = 0
  for (let i = close; i >= 0; i--) {
    const c = mask[i]
    if (c === ")" || c === "]" || c === "}") depth++
    else if ((c === "(" || c === "[" || c === "{") && --depth === 0) return i
  }
  return -1
}

/** Indices in [from, to) of depth-0 characters that are in `chars`. */
function topLevel(mask: string, from: number, to: number, chars: string): number[] {
  const out: number[] = []
  let depth = 0
  for (let i = from; i < to; i++) {
    const c = mask[i]
    if ("([{".includes(c)) depth++
    else if (")]}".includes(c)) depth--
    else if (depth === 0 && chars.includes(c)) out.push(i)
  }
  return out
}

/** `vecN(x)` with exactly one argument: HLSL has no scalar splat constructor, a cast splats (and is fine for an equal-size vector). */
function fixSplats(code: string): string {
  const re = /\b(?:float|int|uint|bool)[234]\s*\(/g
  const first = maskNonCode(code)
  const starts: number[] = []
  for (let m = re.exec(first); m; m = re.exec(first)) starts.push(m.index)
  // innermost (last-starting) first: earlier text never moves, and the mask is rebuilt for every rewrite
  for (let k = starts.length - 1; k >= 0; k--) {
    const mask = maskNonCode(code)
    const open = mask.indexOf("(", starts[k])
    const close = matchClose(mask, open)
    if (close < 0 || topLevel(mask, open + 1, close, ",").length > 0 || !mask.slice(open + 1, close).trim()) continue
    const type = mask.slice(starts[k], open).trim()
    code = `${code.slice(0, starts[k])}((${type})(${code.slice(open + 1, close)}))${code.slice(close + 1)}`
  }
  return code
}

interface MatCtx {
  mats: Set<string>
  funcs: Set<string>
}

type ExprType = "mat" | "num" | "other"

/** Names of variables / parameters declared with a matrix type (handles `mat2 a = ..., b;` lists). */
function declaredMatrices(mask: string): string[] {
  const out: string[] = []
  const re = /\bfloat([234])x\1\s+([A-Za-z_]\w*)/g
  for (let m = re.exec(mask); m; m = re.exec(mask)) {
    let p = m.index + m[0].length
    if (/^\s*\(/.test(mask.slice(p))) continue
    out.push(m[2])
    let depth = 0
    for (; p < mask.length; p++) {
      const c = mask[p]
      if ("([{".includes(c)) depth++
      else if (")]}".includes(c)) {
        if (--depth < 0) break
      } else if (depth === 0 && c === ";") break
      else if (depth === 0 && c === ",") {
        const n = /^\s*([A-Za-z_]\w*)\s*(?=[=,;[])/.exec(mask.slice(p + 1))
        if (!n) break
        out.push(n[1])
      }
    }
  }
  return out
}

function matrixFunctions(mask: string): Set<string> {
  const out = new Set<string>()
  const re = /\bfloat([234])x\1\s+([A-Za-z_]\w*)\s*\(/g
  for (let m = re.exec(mask); m; m = re.exec(mask)) out.add(m[2])
  return out
}

function typeOfPrimary(text: string, cx: MatCtx): ExprType {
  const t = text.trim().replace(/^[-+!~\s]+/, "")
  if (/^[\d.]/.test(t)) return "num"
  const mk = maskNonCode(t)
  if (t[0] === "(") return matchClose(mk, 0) === t.length - 1 ? typeOfExpr(t.slice(1, -1), cx) : "other"
  const m = /^([A-Za-z_]\w*)(\()?/.exec(t)
  if (!m) return "other"
  if (!m[2]) return m[0].length === t.length && cx.mats.has(m[1]) ? "mat" : "other"
  const open = m[0].length - 1
  if (matchClose(mk, open) !== t.length - 1) return "other"
  if (MAT_NAME.test(m[1]) || cx.funcs.has(m[1])) return "mat"
  if (m[1] === "mul") {
    const inner = mk.slice(open + 1, -1)
    const comma = topLevel(inner, 0, inner.length, ",")
    if (comma.length === 1) {
      const a = t.slice(open + 1, open + 1 + comma[0])
      const b = t.slice(open + 2 + comma[0], -1)
      if (typeOfExpr(a, cx) === "mat" && typeOfExpr(b, cx) === "mat") return "mat"
    }
  }
  return "other"
}

/** Type of an operand chain `a * b / c`, folded left to right (mat*mat -> mat, mat*vec -> vec, mat*number -> mat). */
function typeOfTerm(text: string, cx: MatCtx): ExprType {
  const mk = maskNonCode(text)
  const ops = topLevel(mk, 0, text.length, "*/")
  let acc: ExprType = typeOfPrimary(text.slice(0, ops[0] ?? text.length), cx)
  for (let k = 0; k < ops.length; k++) {
    const rhs = typeOfPrimary(text.slice(ops[k] + 1, ops[k + 1] ?? text.length), cx)
    if (acc === "mat") acc = rhs === "mat" || rhs === "num" ? "mat" : "other"
    else if (acc === "num") acc = rhs === "mat" && mk[ops[k]] === "*" ? "mat" : rhs === "num" ? "num" : "other"
    else acc = "other"
  }
  return acc
}

/** Type of an expression: a sum is a matrix when any of its terms is one. */
function typeOfExpr(text: string, cx: MatCtx): ExprType {
  const mk = maskNonCode(text)
  const cuts = topLevel(mk, 0, text.length, "+-").filter((i) => {
    const before = mk.slice(0, i).trimEnd()
    return before !== "" && /[\w)\].]$/.test(before) && !/\d[eE]$/.test(before)
  })
  const bounds = [-1, ...cuts, text.length]
  const kinds: ExprType[] = []
  for (let k = 0; k + 1 < bounds.length; k++) kinds.push(typeOfTerm(text.slice(bounds[k] + 1, bounds[k + 1]), cx))
  if (kinds.includes("mat")) return "mat"
  return kinds.every((x) => x === "num") ? "num" : "other"
}

/** Start of the operand (primary + postfix chain: calls, indexing, members) that ends just before `end`, or -1. */
function operandStart(mask: string, end: number): number {
  let j = end - 1
  while (j >= 0 && isWs(mask[j])) j--
  for (;;) {
    if (j < 0) return -1
    const c = mask[j]
    if (c === "]") {
      const o = matchOpen(mask, j)
      if (o < 1) return -1
      j = o - 1
      continue
    }
    if (c === ")") {
      const o = matchOpen(mask, j)
      if (o < 0) return -1
      let q = o - 1
      while (q >= 0 && isW(mask[q])) q--
      return NOT_A_CALL.has(mask.slice(q + 1, o)) ? o : q + 1
    }
    if (!isW(c) && c !== ".") return -1
    let q = j
    while (q >= 0 && (isW(mask[q]) || mask[q] === ".")) q--
    let s = q + 1
    if ((mask[q] === "-" || mask[q] === "+") && /[eE]/.test(mask[q - 1] ?? "")) {
      let r = q - 2
      while (r >= 0 && (isW(mask[r]) || mask[r] === ".")) r--
      if (/\d/.test(mask[r + 1] ?? "")) s = r + 1
    }
    if (mask[s] === "." && (mask[s - 1] === ")" || mask[s - 1] === "]")) {
      j = s - 1
      continue
    }
    return s
  }
}

/** End (exclusive) of the operand starting at `i` (optional unary prefix, primary, postfix chain), or -1. */
function operandEnd(mask: string, i: number): number {
  const n = mask.length
  let j = i
  while (isWs(mask[j])) j++
  while ("+-!~".includes(mask[j] ?? "x")) {
    j++
    while (isWs(mask[j])) j++
  }
  let callable = false
  if (mask[j] === "(") {
    const c = matchClose(mask, j)
    if (c < 0) return -1
    j = c + 1
  } else if (isW(mask[j]) || (mask[j] === "." && /\d/.test(mask[j + 1] ?? ""))) {
    const num = /[\d.]/.test(mask[j])
    j++
    while (j < n && (isW(mask[j]) || (num && mask[j] === "."))) j++
    if (num && (mask[j] === "-" || mask[j] === "+") && /[eE]/.test(mask[j - 1])) {
      j++
      while (j < n && isW(mask[j])) j++
    }
    callable = !num
  } else return -1
  for (;;) {
    if (mask[j] === "(" && callable) {
      const c = matchClose(mask, j)
      if (c < 0) return -1
      j = c + 1
    } else if (mask[j] === "[") {
      const c = matchClose(mask, j)
      if (c < 0) return -1
      j = c + 1
    } else if (mask[j] === "." && isW(mask[j + 1])) {
      j++
      while (j < n && isW(mask[j])) j++
    } else return j
    callable = false
  }
}

const prevNonWs = (mask: string, i: number): number => {
  let p = i - 1
  while (p >= 0 && isWs(mask[p])) p--
  return p
}

const marked = (code: string, after: number): boolean => code.slice(after).trimStart().startsWith(SS_MARK)

/** True when the statement around `at` mentions a matrix, so an operator we cannot parse deserves a visible note. */
function statementTouchesMatrix(mask: string, at: number, cx: MatCtx): boolean {
  let a = at
  while (a > 0 && !";{}".includes(mask[a - 1])) a--
  let b = at
  while (b < mask.length && mask[b] !== ";") b++
  const stmt = mask.slice(a, b)
  return /\bfloat([234])x\1\s*\(/.test(stmt) || [...cx.mats, ...cx.funcs].some((n) => new RegExp(String.raw`\b${n}\b`).test(stmt))
}

const NOTE = "/*ShaderStudio: matrix multiply not translated, rewrite with mul() (HLSL matrices are the transpose of GLSL's)*/"

/** GLSL `L * R` with a matrix operand -> `mul(R, L)`. Left-associative; the left operand is the whole `a * b` chain before the operator. */
function rewriteMatMul(code: string, cx: MatCtx): string {
  let from = 0
  for (;;) {
    const mask = maskNonCode(code)
    let done = true
    for (let i = from; i < mask.length; i++) {
      if (mask[i] !== "*" || mask[i + 1] === "=" || marked(code, i + 1)) continue
      const leftEnd = prevNonWs(mask, i) + 1
      let ls = leftEnd > 0 ? operandStart(mask, leftEnd) : -1
      const re = operandEnd(mask, i + 1)
      if (ls < 0 || re < 0) {
        if (!statementTouchesMatrix(mask, i, cx)) continue
        code = `${code.slice(0, i + 1)} ${NOTE}${code.slice(i + 1)}`
        done = false
        from = i + 1 + NOTE.length
        break
      }
      // extend over `x * ` / `x / ` to the left (a unary sign in front of the operand belongs to the chain only after an operator)
      for (;;) {
        let p = prevNonWs(mask, ls)
        while (p >= 0 && "+-!~".includes(mask[p])) {
          const q = prevNonWs(mask, p)
          if (q >= 0 && (isW(mask[q]) || ")].".includes(mask[q]))) break
          p = q
        }
        if (p >= 0 && (mask[p] === "/" || (mask[p] === "*" && mask[p + 1] !== "="))) {
          const s2 = operandStart(mask, p)
          if (s2 < 0) break
          ls = s2
        } else break
      }
      const left = code.slice(ls, leftEnd)
      const rs = mask.slice(i + 1).search(/\S/) + i + 1
      const right = code.slice(rs, re)
      const lt = typeOfExpr(left, cx)
      const rt = typeOfExpr(right, cx)
      if ((lt === "mat" || rt === "mat") && lt !== "num" && rt !== "num") {
        code = `${code.slice(0, ls)}mul(${right}, ${left})${code.slice(re)}`
        done = false
        from = ls
        break
      }
    }
    if (done) return code
  }
}

/** `v *= M` -> `v = mul(M, v)` (GLSL `v = v * M`); scalar and matrix-by-scalar forms stay `*=`. */
function rewriteMulAssign(code: string, cx: MatCtx): string {
  let from = 0
  for (;;) {
    const mask = maskNonCode(code)
    const k = mask.indexOf("*=", from)
    if (k < 0) return code
    from = k + 2
    if (marked(code, k + 2)) continue
    let e = k + 2
    let depth = 0
    for (; e < mask.length; e++) {
      const c = mask[e]
      if ("([{".includes(c)) depth++
      else if (")]}".includes(c)) {
        if (--depth < 0) break
      } else if (depth === 0 && (c === ";" || c === ",")) break
    }
    const tail = mask.slice(k + 2, e).trimEnd().length
    const rhs = code.slice(k + 2, k + 2 + tail).trim()
    if (typeOfExpr(rhs, cx) !== "mat") continue
    const le = prevNonWs(mask, k) + 1
    const ls = le > 0 ? operandStart(mask, le) : -1
    if (ls < 0) {
      code = `${code.slice(0, k + 2)} ${NOTE}${code.slice(k + 2)}`
      from = k + 2 + NOTE.length
      continue
    }
    const lhs = code.slice(ls, le)
    code = `${code.slice(0, ls)}${lhs} = mul(${rhs}, ${lhs})${code.slice(k + 2 + tail)}`
    from = ls + 1
  }
}

/** Top-level pieces of GLSL-ish code: each function (signature + body) or each `;`-terminated global statement. */
function topLevelChunks(mask: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = 0
  let depth = 0
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i]
    if (c === "{") depth++
    else if (c === "}" && --depth === 0) {
      out.push([start, i + 1])
      start = i + 1
    } else if (c === ";" && depth === 0) {
      out.push([start, i + 1])
      start = i + 1
    }
  }
  if (start < mask.length) out.push([start, mask.length])
  return out
}

/**
 * Applies the HLSL fixups to a split shader: `prelude` (helper functions, globals; scoped per function) and `body`
 * (the contents of main, one scope that also sees the prelude's global matrices).
 */
export function fixHlslSemantics(prelude: string, body: string): { prelude: string; body: string } {
  const pre = fixSplats(prelude)
  const main = fixSplats(body)
  const funcs = matrixFunctions(maskNonCode(pre))
  const globals = new Set<string>()
  const process = (text: string): string => {
    const cx: MatCtx = { mats: new Set([...globals, ...declaredMatrices(maskNonCode(text))]), funcs }
    return rewriteMulAssign(rewriteMatMul(text, cx), cx)
  }
  let outPre = ""
  const mask = maskNonCode(pre)
  for (const [a, b] of topLevelChunks(mask)) {
    const chunk = pre.slice(a, b)
    const isFunction = mask.slice(a, b).includes("{")
    if (!isFunction) for (const n of declaredMatrices(mask.slice(a, b))) globals.add(n)
    outPre += process(chunk)
  }
  return { prelude: outPre, body: process(main) }
}

/**
 * Transpiles GLSL shader code and active uniforms into a production-ready
 * Unity ShaderLab + HLSL shader compatible with Universal Render Pipeline (URP).
 */
export function transpileToUnityHLSL(options: EngineExportOptions): string {
  const shaderName = options.shaderName || "ShaderStudio/CustomEffect"
  const sp = splitGlsl(options.shaderSource)
  const uniforms = mergeUniforms(options, sp).filter((u) => !ENGINE_BUILTINS.has(u.name))

  // 1. Generate Properties Block
  const propertyLines: string[] = []
  const declared = new Map(sp.uniforms.map((d) => [d.name, d.type]))
  const shapes = new Map(uniforms.map((u) => [u.name, uniformShape(u, declared.get(u.name))]))
  for (const u of uniforms) {
    const val = options.uniformValues?.[u.name]?.value
    const shape = shapes.get(u.name)
    if (shape === "vec4" || (shape === "vec3" && u.kind === "color")) {
      const arr = Array.isArray(val) ? val : [0.4, 0.6, 0.9, 1.0]
      propertyLines.push(`        _${u.name} ("${u.name}", Color) = (${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3] ?? 1.0})`)
    } else if (shape === "vec3") {
      const arr = Array.isArray(val) ? val : [0.4, 0.6, 0.9]
      propertyLines.push(`        _${u.name} ("${u.name}", Vector) = (${arr[0]}, ${arr[1]}, ${arr[2]}, 1.0)`)
    } else if (shape === "vec2") {
      const arr = Array.isArray(val) ? val : [1.0, 1.0]
      propertyLines.push(`        _${u.name} ("${u.name}", Vector) = (${arr[0]}, ${arr[1]}, 0.0, 0.0)`)
    } else if (shape === "tex") {
      propertyLines.push(`        _${u.name} ("${u.name}", 2D) = "white" {}`)
    } else {
      const num = typeof val === "number" ? val : Number(val) || 0
      propertyLines.push(`        _${u.name} ("${u.name}", Float) = ${num}`)
    }
  }

  // u_mouse has no Unity equivalent: expose it as a Vector property (xy = pixels, set from script) when the shader reads it
  const usesMouse = collectIdentifiers(sp.prelude + "\n" + sp.body).has("u_mouse")
  if (usesMouse) propertyLines.push('        _Mouse ("Mouse", Vector) = (0, 0, 0, 0)')

  // 2. Generate CBUFFER Block (textures are declared outside it)
  const cbufferLines: string[] = usesMouse ? ["                float4 _Mouse;"] : []
  const textureLines: string[] = []
  for (const u of uniforms) {
    const shape = shapes.get(u.name)
    if (shape === "vec4") cbufferLines.push(`                float4 _${u.name};`)
    else if (shape === "vec3") cbufferLines.push(`                float3 _${u.name};`)
    else if (shape === "vec2") cbufferLines.push(`                float2 _${u.name};`)
    else if (shape === "tex") textureLines.push(`            sampler2D _${u.name};`)
    else cbufferLines.push(`                float _${u.name};`)
  }

  // 3. GLSL -> HLSL, token-aware (comments, strings, member accesses and longer identifiers are never touched)
  const local = localVariables(sp.prelude + "\n" + sp.body, ["time", "resolution"])
  const rules = new Map<string, IdentRule>()
  rules.set("gl_FragCoord", "i.positionCS")
  rules.set("gl_FragColor", "fragColor")
  if (sp.outName && sp.outName !== "fragColor") rules.set(sp.outName, "fragColor")
  rules.set("u_resolution", eatSwizzle("_ScreenParams.xy"))
  rules.set("u_time", "_Time.y")
  rules.set("u_mouse", eatSwizzle("_Mouse.xy"))
  if (!local.has("resolution")) rules.set("resolution", eatSwizzle("_ScreenParams.xy"))
  if (!local.has("time")) rules.set("time", "_Time.y")
  for (const [glsl, hlsl] of Object.entries(GLSL_TO_HLSL_TYPES)) rules.set(glsl, hlsl)
  rules.set("fract", "frac")
  rules.set("mix", "lerp")
  rules.set("texture2D", "tex2D")
  rules.set("texture", "tex2D")
  rules.set("dFdx", "ddx")
  rules.set("dFdy", "ddy")
  rules.set("inversesqrt", "rsqrt")
  rules.set("atan", atanRule)
  rules.set("return", bareReturn("return fragColor"))
  for (const u of uniforms) rules.set(u.name, `_${u.name}`)
  for (const w of HLSL_RESERVED) if (!rules.has(w)) rules.set(w, `${w}_`)

  const { prelude, body } = fixHlslSemantics(rewriteIdentifiers(sp.prelude, rules), rewriteIdentifiers(sp.body, rules))
  const usesMod = collectIdentifiers(prelude + "\n" + body).has("mod")

  // Varyings the fragment reads become file-scope statics filled from the interpolated vertex output.
  const statics: string[] = []
  const assigns: string[] = []
  for (const v of sp.varyings) {
    statics.push(`static ${hlslTypeOf(v.type)} ${v.name};`)
    const kind = varyingKind(v)
    if (kind === "position") assigns.push(`${v.name} = i.positionOS;`)
    else if (kind === "uv") assigns.push(`${v.name} = i.uv;`)
    else if (kind === "normal") assigns.push(`${v.name} = i.normalWS;`)
  }
  if (!sp.varyings.some((v) => v.name === "uv") && needsImplicit(body, "uv")) assigns.push("float2 uv = i.uv;")

  const preludeBlock = [usesMod ? HLSL_MOD : "", statics.join("\n"), prelude].filter(Boolean).join("\n\n")
  const pad = (s: string, n: number) => s.split("\n").map((l) => (l.trim() ? " ".repeat(n) + l : l)).join("\n")

  return `${headerLines("Unity Universal Render Pipeline (URP) ShaderLab / HLSL")}
Shader "${shaderName}"
{
    Properties
    {
${propertyLines.join("\n") || "        // No exposed properties"}
    }
    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }
        LOD 100

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionOS : TEXCOORD2;
            };

${textureLines.length ? textureLines.join("\n") + "\n\n" : ""}            CBUFFER_START(UnityPerMaterial)
${cbufferLines.join("\n") || "                // Per-material constants"}
            CBUFFER_END
${preludeBlock ? "\n" + pad(preludeBlock, 12) + "\n" : ""}
            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.positionOS = input.positionOS.xyz;
                return output;
            }

            float4 frag(Varyings i) : SV_Target
            {
${assigns.length ? pad(assigns.join("\n"), 16) + "\n" : ""}                float4 fragColor = float4(1.0, 1.0, 1.0, 1.0);

                // --- Shader Studio Translated Body ---
${pad(dedent(body), 16)}

                return fragColor;
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
`
}

/**
 * Transpiles shader code and active uniforms into a Godot 4 Spatial Shader (`.gdshader`).
 */
export function transpileToGodotShader(options: EngineExportOptions): string {
  const sp = splitGlsl(options.shaderSource)
  const uniforms = mergeUniforms(options, sp).filter((u) => !ENGINE_BUILTINS.has(u.name))

  // 1. Generate Godot uniform declarations
  const godotUniforms: string[] = []
  const declared = new Map(sp.uniforms.map((d) => [d.name, d.type]))
  for (const u of uniforms) {
    const val = options.uniformValues?.[u.name]?.value
    const shape = uniformShape(u, declared.get(u.name))
    if (shape === "vec4") {
      const arr = Array.isArray(val) ? val : [0.4, 0.6, 0.9, 1.0]
      godotUniforms.push(`uniform vec4 ${u.name} : source_color = vec4(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3] ?? 1.0});`)
    } else if (shape === "vec3") {
      const arr = Array.isArray(val) ? val : [0.4, 0.6, 0.9]
      godotUniforms.push(`uniform vec3 ${u.name}${u.kind === "color" ? " : source_color" : ""} = vec3(${arr[0]}, ${arr[1]}, ${arr[2]});`)
    } else if (shape === "vec2") {
      const arr = Array.isArray(val) ? val : [1.0, 1.0]
      godotUniforms.push(`uniform vec2 ${u.name} = vec2(${arr[0]}, ${arr[1]});`)
    } else if (shape === "tex") {
      godotUniforms.push(`uniform sampler2D ${u.name} : source_color;`)
    } else {
      const num = typeof val === "number" ? val : Number(val) || 0
      godotUniforms.push(`uniform float ${u.name} = ${num};`)
    }
  }

  // 2. GLSL -> Godot shading language, token-aware. (Godot built-ins such as TIME are only visible inside
  // fragment()/vertex(), so helper functions that read u_time keep working only when they take it as an argument.)
  const local = localVariables(sp.prelude + "\n" + sp.body, ["time", "resolution"])
  const rules = new Map<string, IdentRule>()
  rules.set("gl_FragCoord", "FRAGCOORD")
  rules.set("gl_FragColor", "fragColor")
  if (sp.outName && sp.outName !== "fragColor") rules.set(sp.outName, "fragColor")
  rules.set("u_resolution", eatSwizzle("VIEWPORT_SIZE"))
  rules.set("u_time", "TIME")
  if (!local.has("resolution")) rules.set("resolution", eatSwizzle("VIEWPORT_SIZE"))
  // Godot has no mouse built-in: a vec2 uniform the game script can set
  if (collectIdentifiers(sp.prelude + "\n" + sp.body).has("u_mouse")) godotUniforms.push("uniform vec2 u_mouse = vec2(0.0);")
  if (!local.has("time")) rules.set("time", "TIME")
  rules.set("texture2D", "texture")
  for (const n of ["2", "3", "4"]) rules.set(`mat${n}x${n}`, `mat${n}`)
  const prelude = rewriteIdentifiers(sp.prelude, rules)
  const body = rewriteIdentifiers(sp.body, rules)

  const varyingDecls: string[] = []
  const vertexAssigns: string[] = []
  for (const v of sp.varyings) {
    varyingDecls.push(`varying ${v.type} ${v.name};`)
    const kind = varyingKind(v)
    if (kind === "position") vertexAssigns.push(`${v.name} = VERTEX;`)
    else if (kind === "uv") vertexAssigns.push(`${v.name} = UV;`)
    else if (kind === "normal") vertexAssigns.push(`${v.name} = NORMAL;`)
  }
  const implicitUv = !sp.varyings.some((v) => v.name === "uv") && needsImplicit(body, "uv")

  return `${headerLines("Godot 4 Spatial Shader (.gdshader)")}
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

${godotUniforms.join("\n") || "// No custom uniforms"}
${varyingDecls.length ? "\n" + varyingDecls.join("\n") + "\n" : ""}${prelude ? "\n" + prelude + "\n" : ""}${
    vertexAssigns.length ? `\nvoid vertex() {\n${vertexAssigns.map((l) => "    " + l).join("\n")}\n}\n` : ""
  }
void fragment() {
${implicitUv ? "    vec2 uv = UV;\n" : ""}    vec4 fragColor = vec4(1.0);

    // --- Shader Studio Shader Logic ---
${dedent(body).split("\n").map((l) => (l.trim() ? "    " + l : l)).join("\n")}

    ALBEDO = fragColor.rgb;
    ALPHA = fragColor.a;
    ROUGHNESS = 0.4;
    METALLIC = 0.1;
}
`
}

/** GLSL literal for a uniform default (used where the target has no runtime uniforms, i.e. Shadertoy). */
function glslLiteral(type: string, val: unknown): string {
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0)
  const vec = /^vec([234])$/.exec(type)
  if (vec) {
    const size = Number(vec[1])
    const arr = Array.isArray(val) ? val : []
    const comps = Array.from({ length: size }, (_, i) => fmtFloat(i < arr.length ? n(arr[i]) : i === 3 ? 1 : size === 4 ? 1 : 0))
    return `${type}(${comps.join(", ")})`
  }
  if (type === "int" || type === "uint") return String(Math.round(n(val)))
  if (type === "bool") return val ? "true" : "false"
  return fmtFloat(n(val))
}

/**
 * Wraps shader code into the universal Shadertoy standard `mainImage(...)` format.
 * Shadertoy has no custom uniforms: they become `const` defaults (textures map to iChannelN).
 */
export function transpileToShadertoy(options: EngineExportOptions): string {
  const sp = splitGlsl(options.shaderSource)
  const uniforms = mergeUniforms(options, sp).filter((u) => !ENGINE_BUILTINS.has(u.name))
  const declared = new Map(sp.uniforms.map((d) => [d.name, d.type]))
  const glslType = (u: ParsedUniform) => {
    const d = declared.get(u.name)
    if (d) return d
    const t = String(u.type)
    return t === "vec4f" || t === "vec4" ? "vec4" : t === "vec3f" || t === "vec3" ? "vec3" : t === "vec2f" || t === "vec2" ? "vec2" : "float"
  }

  const local = localVariables(sp.prelude + "\n" + sp.body, ["time", "resolution"])
  const rules = new Map<string, IdentRule>()
  rules.set("gl_FragCoord", ({ src, end }) => (src[end] === "." ? "fragCoord" : "vec4(fragCoord, 0.0, 1.0)"))
  rules.set("gl_FragColor", "fragColor")
  if (sp.outName && sp.outName !== "fragColor") rules.set(sp.outName, "fragColor")
  rules.set("u_time", "iTime")
  rules.set("u_resolution", eatSwizzle("iResolution.xy"))
  rules.set("u_mouse", eatSwizzle("iMouse.xy"))
  if (!local.has("time")) rules.set("time", "iTime")
  if (!local.has("resolution")) rules.set("resolution", eatSwizzle("iResolution.xy"))
  rules.set("texture2D", "texture")
  let channel = 0
  const constants: string[] = []
  for (const u of uniforms) {
    if (u.kind === "texture") rules.set(u.name, `iChannel${Math.min(channel++, 3)}`)
    else {
      const t = glslType(u)
      constants.push(`const ${t} ${u.name} = ${glslLiteral(t, options.uniformValues?.[u.name]?.value)};`)
    }
  }
  const prelude = rewriteIdentifiers(sp.prelude, rules)
  const body = rewriteIdentifiers(sp.body, rules)
  const consts = constants.join("\n")

  // Already a Shadertoy program: only the environment names change.
  if (sp.hasMainImage) {
    return `${headerLines("Shadertoy GLSL ES 3.0")}
${consts ? consts + "\n\n" : ""}${body}
`
  }

  const globals: string[] = []
  const assigns: string[] = []
  for (const v of sp.varyings) {
    globals.push(`${v.type} ${v.name};`)
    const kind = varyingKind(v)
    if (kind === "position") assigns.push(`${v.name} = vec3(fragCoord / iResolution.xy * 2.0 - 1.0, 0.0);`)
    else if (kind === "uv") assigns.push(`${v.name} = fragCoord / iResolution.xy;`)
    else if (kind === "normal") assigns.push(`${v.name} = vec3(0.0, 0.0, 1.0);`)
    else assigns.push(`${v.name} = ${v.type}(0.0);`)
  }
  if (!sp.varyings.some((v) => v.name === "uv") && needsImplicit(body, "uv")) assigns.push("vec2 uv = fragCoord / iResolution.xy;")
  const top = [consts, globals.join("\n"), prelude].filter(Boolean).join("\n\n")

  return `${headerLines("Shadertoy GLSL ES 3.0")}
${top ? "\n" + top + "\n" : ""}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
${assigns.length ? assigns.map((l) => "    " + l).join("\n") + "\n" : ""}    fragColor = vec4(1.0);

    // --- Shader Studio Converted Logic ---
${dedent(body).split("\n").map((l) => (l.trim() ? "    " + l : l)).join("\n")}
}
`
}

/** Body of `void main(...) { ... }` (brace-matched on the code mask, so braces in comments/strings don't count), or null. */
function extractMainBody(source: string): string | null {
  const mask = maskNonCode(source)
  const mainMatch = /\bvoid\s+main\s*\([^)]*\)\s*\{/.exec(mask)
  if (!mainMatch) return null
  const startIdx = mainMatch.index + mainMatch[0].length
  let depth = 1
  let endIdx = startIdx
  for (let i = startIdx; i < mask.length; i++) {
    if (mask[i] === "{") depth++
    else if (mask[i] === "}") {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  return source.slice(startIdx, endIdx)
}

/** `return;` inside a GLSL main() has to hand back the colour once the body lives in a value-returning function. */
const bareReturn = (to: string): IdentRule => ({ src, end }) => (/^\s*;/.test(src.slice(end, end + 8)) ? to : undefined)

/** Rule for a name that can carry a swizzle: `a.xy` -> withSwizzle, bare `a` -> bare. */
const swizzleAware = (withSwizzle: string, bare: string): IdentRule => ({ src, end }) =>
  src.startsWith(".xy", end) ? { to: withSwizzle, end: end + 3 } : bare

/**
 * Transpiles shader code and uniforms into Unreal Engine 5 HLSL:
 * 1. Custom Expression node HLSL block
 * 2. Reusable Material Function HLSL block
 */
export function transpileToUE5(
  shaderSourceOrOptions: string | EngineExportOptions,
  uniformsOrOptions?: ParsedUniform[] | EngineExportOptions
): UE5TranspileResult {
  let source = ""
  let uniforms: ParsedUniform[] = []

  if (typeof shaderSourceOrOptions === "object" && "shaderSource" in shaderSourceOrOptions) {
    source = shaderSourceOrOptions.shaderSource
    uniforms = resolveUniforms(shaderSourceOrOptions)
  } else {
    source = String(shaderSourceOrOptions || "")
    if (Array.isArray(uniformsOrOptions)) {
      uniforms = uniformsOrOptions
    } else if (uniformsOrOptions && typeof uniformsOrOptions === "object" && "shaderSource" in uniformsOrOptions) {
      uniforms = resolveUniforms(uniformsOrOptions)
    }
  }

  const params: UE5Parameter[] = uniforms.map((u) => {
    let ue5Type = "ScalarParameter"
    const t = String(u.type)
    if (
      t === "vec2" ||
      t === "vec2f" ||
      t === "vec3" ||
      t === "vec4" ||
      t === "color" ||
      t === "vec3f" ||
      t === "vec4f" ||
      t.startsWith("mat") ||
      u.kind === "color" ||
      u.kind === "vector"
    ) {
      ue5Type = "VectorParameter"
    } else if (
      t === "sampler2D" ||
      t === "texture" ||
      u.kind === "texture" ||
      t === "samplerCube" ||
      t === "sampler3D"
    ) {
      ue5Type = t === "samplerCube" ? "TextureCube" : "Texture2D"
    }
    return { name: u.name, type: u.type, ue5Type }
  })

  const paramDeclarations = params
    .map((p) => `// UE5 ${p.ue5Type}: ${p.name}`)
    .join("\n")

  // Translate GLSL syntax to HLSL (token-aware)
  const translateGlslToHlsl = (code: string): string => {
    const local = localVariables(code, ["time", "resolution"])
    const rules = new Map<string, IdentRule>()
    rules.set("gl_FragCoord", ({ src, end }) =>
      src.startsWith(".xy", end)
        ? { to: "Parameters.TexCoords[0].xy * View.ViewSizeAndInvSize.xy", end: end + 3 }
        : "float4(Parameters.TexCoords[0].xy * View.ViewSizeAndInvSize.xy, 0.0, 1.0)"
    )
    rules.set("u_resolution", swizzleAware("View.ViewSizeAndInvSize.xy", "float3(View.ViewSizeAndInvSize.xy, 1.0)"))
    rules.set("u_time", "View.GameTime")
    if (!local.has("resolution")) rules.set("resolution", swizzleAware("View.ViewSizeAndInvSize.xy", "float3(View.ViewSizeAndInvSize.xy, 1.0)"))
    if (!local.has("time")) rules.set("time", "View.GameTime")
    for (const n of ["2", "3", "4"]) {
      rules.set("vec" + n, "float" + n)
      rules.set("mat" + n, `float${n}x${n}`)
    }
    rules.set("fract", "frac")
    rules.set("mix", "lerp")
    rules.set("mod", "fmod")
    rules.set("texture2D", "Texture2DSample")
    rules.set("texture", "Texture2DSample")
    // Only 2-argument atan(y, x) becomes atan2(y, x); single-argument atan(x) stays.
    rules.set("atan", atanRule)
    return rewriteIdentifiers(code, rules)
  }

  // Extract body of void main(...) if present, preserving genuine user shader logic
  const rawBody = extractMainBody(source) ?? source

  const hasMain = rawBody !== source
  const hlsl = translateGlslToHlsl(rawBody)
  const fixed = fixHlslSemantics(hasMain ? "" : hlsl, hasMain ? hlsl : "")
  const translatedBody = hasMain ? fixed.body : fixed.prelude

  // For Custom Expression: map fragColor / gl_FragColor to return statement
  let customExprBody = translatedBody
    .replace(/\b(?:out\s+float4\s+)?(?:fragColor|gl_FragColor)\s*=\s*([^;]+);/g, "return $1;")
    .trim()

  if (!/\breturn\b/.test(customExprBody)) {
    customExprBody = customExprBody
      ? `${customExprBody}\nreturn float4(1.0, 1.0, 1.0, 1.0);`
      : "return float4(1.0, 1.0, 1.0, 1.0);"
  }

  const customExpressionHLSL = `
// UE5 Custom Expression HLSL Block
${paramDeclarations}
float3 WorldPosition = GetWorldPosition(Parameters);
float3 ViewDir = GetCameraVector(Parameters);
${customExprBody}
`.trim()

  // Material Function definition
  const mfParamArgs = params.map((p) => {
    let hlslType = "float"
    if (p.ue5Type === "VectorParameter") {
      hlslType = p.type === "vec3" || p.type === "vec3f" || p.type === "color" ? "float3" : "float4"
    } else if (p.ue5Type === "Texture2D" || p.ue5Type === "TextureCube") {
      hlslType = p.ue5Type
    }
    return `  ${hlslType} ${p.name}`
  })
  const mfAllArgs = [...mfParamArgs, "  float3 WorldPosition", "  float3 ViewDir"].join(",\n")

  let mfBody = translatedBody
  if (/\b(?:fragColor|gl_FragColor)\s*=/.test(mfBody)) {
    mfBody = mfBody.replace(
      /\b(?:fragColor|gl_FragColor)\s*=\s*([^;]+);/g,
      "float4 calculatedColor = $1;\n  Out.BaseColor = calculatedColor.rgb;"
    )
  } else {
    mfBody = mfBody.trim()
      ? `${mfBody.trim()}\n  Out.BaseColor = float3(1.0, 1.0, 1.0);`
      : "  Out.BaseColor = float3(1.0, 1.0, 1.0);"
  }

  const roughnessParam = params.find((p) => p.name.includes("roughness"))
  const metallicParam = params.find((p) => p.name.includes("metallic"))
  const roughnessInit = roughnessParam ? roughnessParam.name : "0.5"
  const metallicInit = metallicParam ? metallicParam.name : "0.0"

  const materialFunctionHLSL = `
// UE5 Material Function
${paramDeclarations}
struct MaterialFunctionOutput {
  float3 BaseColor;
  float Roughness;
  float Metallic;
  float3 Normal;
};

MaterialFunctionOutput MaterialFunction_ShaderStudio(
${mfAllArgs}
) {
  MaterialFunctionOutput Out;
  ${mfBody}
  Out.Roughness = ${roughnessInit};
  Out.Metallic = ${metallicInit};
  Out.Normal = float3(0.0, 0.0, 1.0);
  return Out;
}
`.trim()

  return { customExpressionHLSL, materialFunctionHLSL, parameters: params }
}

/**
 * Generates human-readable Unreal Engine 5 HLSL documentation & code for ExportModal.
 */
export function transpileToUnrealHLSL(options: EngineExportOptions): string {
  const result = transpileToUE5(options)
  const shaderName = options.shaderName || "ShaderStudio/CustomEffect"

  return `// =====================================================================
// Generated by Shader Studio (https://github.com/Binitpyro/ShaderStudio)
// Target: Unreal Engine 5 HLSL (Custom Expression & Material Function)
// Shader: ${shaderName}
// =====================================================================

/*
========================================================================
SECTION 1: Custom Expression Node HLSL
Paste the following code into a Custom Expression node in UE5 Material Graph.
Inputs to configure on the node:
${result.parameters.map((p) => `  - Name: ${p.name} (${p.ue5Type})`).join("\n") || "  - (No custom parameters)"}
Output Type: Float 4
========================================================================
*/

${result.customExpressionHLSL}

/*
========================================================================
SECTION 2: Material Function (.ush) HLSL
Include in your project's Shaders directory or Material Function library.
========================================================================
*/

${result.materialFunctionHLSL}
`
}

/**
 * Transpiles shader code and active uniforms into Blender Cycles Open Shading Language (OSL).
 */
export function transpileToBlenderOSL(
  shaderSourceOrOptions: string | EngineExportOptions,
  uniformsOrOptions?: ParsedUniform[] | EngineExportOptions
): string {
  let source = ""
  let uniforms: ParsedUniform[] = []

  if (typeof shaderSourceOrOptions === "object" && "shaderSource" in shaderSourceOrOptions) {
    source = shaderSourceOrOptions.shaderSource
    uniforms = resolveUniforms(shaderSourceOrOptions)
  } else {
    source = String(shaderSourceOrOptions || "")
    if (Array.isArray(uniformsOrOptions)) {
      uniforms = uniformsOrOptions
    } else if (uniformsOrOptions && typeof uniformsOrOptions === "object" && "shaderSource" in uniformsOrOptions) {
      uniforms = resolveUniforms(uniformsOrOptions)
    }
  }

  const paramList = uniforms
    .map((u) => {
      let oslType = "float"
      let defVal = "0.0"
      const t = String(u.type)
      if (t === "vec2" || t === "vec2f") {
        oslType = "point"
        defVal = "point(0.0, 0.0, 0.0)"
      } else if (t === "vec3" || t === "color" || t === "vec3f" || u.kind === "color") {
        oslType = "color"
        defVal = "color(1.0, 1.0, 1.0)"
      } else {
        const val = (u as any).defaultValue
        if (typeof val === "number") {
          defVal = Number.isInteger(val) ? `${val}.0` : String(val)
        }
      }
      return `    ${oslType} ${u.name} = ${defVal}`
    })
    .join(",\n")

  let inlinedBody = ""
  if (source.includes("BSDF =")) {
    inlinedBody = source
  } else {
    // Extract main if present, else translate whole source
    const rawBody = extractMainBody(source) ?? source

    // Translate GLSL types and built-ins to OSL (token-aware)
    const rules = new Map<string, IdentRule>()
    rules.set("gl_FragCoord", eatSwizzle("point(u, v, 0.0)"))
    rules.set("u_resolution", eatSwizzle("point(1.0, 1.0, 0.0)"))
    rules.set("u_time", "time")
    rules.set("vec2", "point")
    rules.set("vec3", "color")
    rules.set("vec4", "color")
    rules.set("mat3", "matrix")
    rules.set("mat4", "matrix")
    rules.set("fract", "fmod")
    rules.set("texture2D", "texture")
    let oslBody = rewriteIdentifiers(rawBody, rules)

    if (/\b(?:fragColor|gl_FragColor)\s*=/.test(oslBody)) {
      oslBody = oslBody
        .replace(
          /\b(?:fragColor|gl_FragColor)\s*=\s*(?:color|vec4)\(([^,]+),\s*([^,]+),\s*([^,]+)[^)]*\);/g,
          "color finalColor = color($1, $2, $3);\n    BSDF = finalColor * diffuse(N);"
        )
        .replace(
          /\b(?:fragColor|gl_FragColor)\s*=\s*([^;]+);/g,
          "color finalColor = color($1);\n    BSDF = finalColor * diffuse(N);"
        )
    } else if (/\bcol\b/.test(oslBody)) {
      oslBody = `${oslBody.trim()}\n    BSDF = col * diffuse(N);`
    } else {
      oslBody = `${oslBody.trim()}\n    BSDF = diffuse(N);`
    }
    inlinedBody = oslBody
  }

  return `
#include <stdosl.h>

shader ShaderStudioMaterial(
${paramList}${paramList.length ? "," : ""}
    output closure color BSDF = 0
) {
    // Blender Cycles Open Shading Language (OSL)
    ${inlinedBody}
}
`.trim()
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML embed
// ---------------------------------------------------------------------------------------------------------------------

export interface HtmlEmbedOptions {
  geometry?: ExportGeometry
  shaderSource: string
  parsedUniforms?: ParsedUniform[]
  uniformValues?: Record<string, UniformValue>
}

/** Standalone HTML / Webflow embed: three.js from a CDN, vertex shader matched to the fragment's varyings. */
export function generateHtmlEmbed(options: HtmlEmbedOptions): string {
  const fragment = prepareThreeFragment(options.shaderSource)
  const vertex = buildThreeVertexShader(fragment)
  const extra = threeUniformEntries(options.parsedUniforms, options.uniformValues)
    .map(([k, v]) => `,\n    ${k}: { value: ${v} }`)
    .join("")
  const indent = (s: string) => s.split("\n").map((l) => "      " + l).join("\n")
  const geo = threeGeometry(options.geometry)

  return `<!-- ===================================================================== -->
<!-- Shader Studio Interactive Canvas Embed (Webflow, Framer, or HTML)      -->
<!-- Paste this code directly into any HTML embed block.                     -->
<!-- ===================================================================== -->
<div id="shader-container" style="width: 100%; height: 400px; position: relative; overflow: hidden; background: #000;">
  <canvas id="shader-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
(function() {
  var container = document.getElementById('shader-container');
  var canvas = document.getElementById('shader-canvas');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.z = 3.5;

  var uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) }${extra}
  };

  var material = new THREE.ShaderMaterial({
    vertexShader: \`
${indent(escapeTemplate(vertex))}
    \`,
    fragmentShader: \`
${indent(escapeTemplate(fragment))}
    \`,
    uniforms: uniforms,
    transparent: true
  });

  ${geo.note ? `// ${geo.note}\n  ` : ""}var mesh = new THREE.Mesh(${geo.js}, material);
  scene.add(mesh);

  function resize() {
    var w = container.clientWidth;
    var h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.u_resolution.value.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  var clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    uniforms.u_time.value = clock.getElapsedTime();
    ${options.geometry === "plane" ? "// flat plane: no spin, it would go edge-on" : "mesh.rotation.y += 0.005;"}
    renderer.render(scene, camera);
  }
  animate();
})();
</script>
`
}

// ---------------------------------------------------------------------------------------------------------------------
// WGSL -> GLSL / HLSL through naga (wasmEngine.transpileWgsl), and the per-target source rule
// ---------------------------------------------------------------------------------------------------------------------

export type ExportTarget = "unity" | "unreal" | "osl" | "godot" | "shadertoy" | "r3f" | "r3f-component" | "html" | "gltf"

export interface ExportProject {
  /** Mesh node geometry; drives the HTML / R3F preview mesh. */
  geometry?: ExportGeometry
  wgslSource?: string
  glslSource?: string
  parsedUniforms?: ParsedUniform[]
  uniformValues?: Record<string, UniformValue>
  shaderName?: string
  /** glTF only: baked PBR maps (data URLs) to embed. */
  bakedMaps?: Record<string, { dataUrl?: string }>
}

export type ExportError = { error: string; line?: number }
/** `via` says where the code came from: the project's GLSL, or WGSL run through naga. */
export type GlslResolution = { code: string; via: "glsl" | "naga" } | ExportError
export type ExportResult = { code: string; via: "glsl" | "naga" | "none" } | ExportError

const hasText = (s: string | undefined): s is string => typeof s === "string" && s.trim().length > 0

async function nagaTranspile(wgsl: string, target: "glsl" | "hlsl"): Promise<{ code: string } | ExportError> {
  // Lazy on purpose: the wasm engine must never enter the startup chunk, nor Node's type-stripped import graph.
  const { wasmEngine } = await import("@/core/wasmEngine")
  const res = await wasmEngine.transpileWgsl(wgsl, target, target === "glsl" ? "fragment" : undefined)
  if ("error" in res) return { error: `WGSL to ${target.toUpperCase()} (naga): ${res.error}${res.line ? ` (line ${res.line})` : ""}`, line: res.line }
  return { code: res.code }
}

/** `@group(g) @binding(b) var<..> name` -> naga's `_group_g_binding_b_<stage>` identifier mapped to the WGSL name. */
function wgslBindings(wgsl: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g
  const mask = maskNonCode(wgsl)
  for (let m = re.exec(mask); m; m = re.exec(mask)) {
    map.set(`_group_${m[1]}_binding_${m[2]}_fs`, m[3])
    map.set(`_group_${m[1]}_binding_${m[2]}_vs`, m[3])
  }
  return map
}

/** Fragment stage inputs by location (`@location(N) name`), from inline params and struct-typed params. */
function wgslFragmentInputs(wgsl: string): Map<number, string> {
  const out = new Map<number, string>()
  const mask = maskNonCode(wgsl)
  const fn = /@fragment\s+fn\s+\w+\s*\(((?:[^()]|\([^()]*\))*)\)/.exec(mask)
  if (!fn) return out
  const grab = (text: string) => {
    for (const m of text.matchAll(/@location\((\d+)\)\s*(\w+)\s*:/g)) out.set(Number(m[1]), m[2])
  }
  grab(fn[1])
  for (const t of fn[1].matchAll(/:\s*([A-Za-z_]\w*)/g)) {
    const st = new RegExp(String.raw`struct\s+${t[1]}\s*\{([^}]*)\}`).exec(mask)
    if (st) grab(st[1])
  }
  return out
}

/**
 * naga emits valid GLSL ES 3.00 but with machine names (`_vs2fs_location0`, one uniform block per binding). This maps it
 * back onto the shape every GLSL target expects: flat `uniform` declarations with the WGSL names, `v_<field>` varyings
 * and an `fragColor` output.
 */
export function adaptNagaGlsl(glsl: string, wgsl: string): string {
  let text = glsl
  const rules = new Map<string, IdentRule>()
  const bindings = wgslBindings(wgsl)
  for (const [k, v] of bindings) rules.set(k, v)

  // Flatten `uniform Block { Struct _group_0_binding_0_fs; };` into one `uniform T name;` per struct field.
  const blockRe = /uniform\s+\w+\s*\{\s*(\w+)\s+(\w+)\s*;\s*\}\s*;[ \t]*\n?/
  for (let guard = 0; guard < 16; guard++) {
    const mask = maskNonCode(text)
    const m = blockRe.exec(mask)
    if (!m) break
    const [, structName, inst] = m
    const st = new RegExp(String.raw`struct\s+${structName}\s*\{([^}]*)\}\s*;[ \t]*\n?`).exec(mask)
    const fields = st ? [...st[1].matchAll(/(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*;/g)] : []
    // engine uniforms follow the GLSL convention (`time` -> u_time, `resolution` -> u_resolution); the app-side mvp matrix is dropped
    const names = new Set(fields.map((f) => f[2]))
    const rename = (n: string) => (n === "time" && !names.has("u_time") ? "u_time" : n === "resolution" && !names.has("u_resolution") ? "u_resolution" : n)
    const kept = fields.filter((f) => f[2] !== "mvp" && f[2] !== "u_mvp")
    const decls = kept.map((f) => `uniform ${f[1]} ${rename(f[2])}${f[3] ?? ""};`).join("\n") + (kept.length ? "\n" : "")
    const structUses = (mask.match(new RegExp(String.raw`\b${structName}\b`, "g")) ?? []).length
    // replace the block, drop the now-unused struct definition
    text = text.slice(0, m.index) + decls + text.slice(m.index + m[0].length)
    if (st && structUses <= 2) {
      const mask2 = maskNonCode(text)
      const st2 = new RegExp(String.raw`struct\s+${structName}\s*\{([^}]*)\}\s*;[ \t]*\n?`).exec(mask2)
      if (st2) text = text.slice(0, st2.index) + text.slice(st2.index + st2[0].length)
    }
    rules.set(inst, ({ src, end }) => {
      const m = /^\.(\w+)/.exec(src.slice(end, end + 64))
      return m ? { to: rename(m[1]), end: end + m[0].length } : undefined
    })
  }

  const inputs = wgslFragmentInputs(wgsl)
  for (const id of collectIdentifiers(text)) {
    const loc = /^_vs2fs_location(\d+)$/.exec(id)
    if (loc) rules.set(id, `v_${inputs.get(Number(loc[1])) ?? "loc" + loc[1]}`)
  }
  rules.set("_fs2p_location0", "fragColor")
  for (const n of ["2", "3", "4"]) rules.set(`mat${n}x${n}`, `mat${n}`)
  return rewriteIdentifiers(text, rules).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}

/**
 * Source for GLSL targets: the project's own GLSL, or, when that slot is empty, the WGSL transpiled by naga and adapted.
 * Never returns code from a failed transpile.
 */
export async function resolveGlslSource(project: ExportProject): Promise<GlslResolution> {
  if (hasText(project.glslSource)) return { code: project.glslSource, via: "glsl" }
  if (hasText(project.wgslSource)) {
    const res = await nagaTranspile(project.wgslSource, "glsl")
    if ("error" in res) return res
    return { code: adaptNagaGlsl(res.code, project.wgslSource), via: "naga" }
  }
  return { error: "No shader source to export. Write a GLSL or WGSL shader first." }
}

const wgslEntry = (wgsl: string, stage: "vertex" | "fragment") => new RegExp(String.raw`@${stage}\s+fn\s+(\w+)`).exec(maskNonCode(wgsl))?.[1]
const hlslField = (type: string) => (type === "float" ? "f32" : type === "float2" ? "vec2f" : type === "float3" ? "vec3f" : type === "float4" ? "vec4f" : "f32")

/**
 * Unity ShaderLab around naga's HLSL: the cbuffer becomes the SRP-batcher `UnityPerMaterial` block with `_name`
 * properties, `mvp` maps to Unity's MVP, `time` to `_Time.y`, and LOCn semantics become POSITION/NORMAL/TEXCOORDn.
 */
export function unityFromNagaHlsl(hlsl: string, wgsl: string, options: { shaderName?: string; uniformValues?: Record<string, UniformValue> } = {}): ExportResult {
  const vs = wgslEntry(wgsl, "vertex")
  const fs = wgslEntry(wgsl, "fragment")
  if (!vs || !fs) return { error: "Unity export from WGSL needs both an @vertex and an @fragment entry point." }

  let code = hlsl
  const mask = maskNonCode(code)
  const cb = /cbuffer\s+(\w+)\s*:\s*register\(b\d+\)\s*\{\s*(\w+)\s+\1\s*;\s*\}[ \t]*\n?/.exec(mask)
  let cbufferBlock = ""
  const rules = new Map<string, IdentRule>()
  const properties: string[] = []
  if (cb) {
    const [whole, inst, structName] = cb
    const st = new RegExp(String.raw`struct\s+${structName}\s*\{([^}]*)\}\s*;[ \t]*\n?`).exec(mask)
    const fields = st ? [...st[1].matchAll(/(?:row_major\s+)?(float(?:[234](?:x[234])?)?|int|uint|bool)\s+(\w+)\s*;/g)] : []
    const lines: string[] = []
    const fieldRules = new Map<string, string>()
    for (const f of fields) {
      const [, type, name] = f
      if (name === "mvp" || name === "u_mvp") fieldRules.set(name, "transpose(mul(UNITY_MATRIX_VP, UNITY_MATRIX_M))")
      else if (name === "time" || name === "u_time") fieldRules.set(name, "_Time.y")
      else if (name === "resolution" || name === "u_resolution") fieldRules.set(name, "_ScreenParams.xy")
      else if (/^float[234]?$/.test(type) || type === "int" || type === "uint" || type === "bool") {
        const val = options.uniformValues?.[name]?.value
        lines.push(`${type === "int" || type === "uint" || type === "bool" ? "float" : type} _${name};`)
        fieldRules.set(name, `_${name}`)
        const ft = hlslField(type)
        if (ft === "vec4f") {
          const a = Array.isArray(val) ? val : [0.4, 0.6, 0.9, 1]
          properties.push(`        _${name} ("${name}", Color) = (${a[0]}, ${a[1]}, ${a[2]}, ${a[3] ?? 1})`)
        } else if (ft === "vec3f") {
          const a = Array.isArray(val) ? val : [0.4, 0.6, 0.9]
          properties.push(`        _${name} ("${name}", Vector) = (${a[0]}, ${a[1]}, ${a[2]}, 1.0)`)
        } else if (ft === "vec2f") {
          const a = Array.isArray(val) ? val : [1, 1]
          properties.push(`        _${name} ("${name}", Vector) = (${a[0]}, ${a[1]}, 0.0, 0.0)`)
        } else {
          properties.push(`        _${name} ("${name}", Float) = ${typeof val === "number" ? val : Number(val) || 0}`)
        }
      }
    }
    cbufferBlock = `CBUFFER_START(UnityPerMaterial)\n${lines.map((l) => "    " + l).join("\n") || "    // Per-material constants"}\nCBUFFER_END\n`
    // drop the struct + cbuffer declarations, then rewrite `uniforms.field` accesses
    code = code.slice(0, cb.index) + "/*__CBUFFER__*/\n" + code.slice(cb.index + whole.length)
    if (st) {
      const m2 = maskNonCode(code)
      const st2 = new RegExp(String.raw`struct\s+${structName}\s*\{([^}]*)\}\s*;[ \t]*\n?`).exec(m2)
      if (st2) code = code.slice(0, st2.index) + code.slice(st2.index + st2[0].length)
    }
    rules.set(inst, ({ src, end }) => {
      const m = /^\.(\w+)/.exec(src.slice(end))
      const to = m && fieldRules.get(m[1])
      return m && to ? { to, end: end + m[0].length } : undefined
    })
  }
  code = rewriteIdentifiers(code, rules)

  // Semantics: the vertex input struct maps to mesh attributes, everything else to TEXCOORDn.
  const vin = new RegExp(String.raw`@vertex\s+fn\s+${vs}\s*\(\s*\w+\s*:\s*(\w+)`).exec(maskNonCode(wgsl))?.[1]
  const attr = ["POSITION", "NORMAL", "TEXCOORD0", "COLOR"]
  const semantic = (n: string) => `TEXCOORD${n}`
  if (vin) {
    const sm = new RegExp(String.raw`(struct\s+${vin}\s*\{)([^}]*)(\})`).exec(code)
    if (sm) code = code.replace(sm[0], sm[1] + sm[2].replace(/\bLOC(\d+)\b/g, (_, n) => attr[Number(n)] ?? semantic(n)) + sm[3])
  }
  code = code.replace(/\bLOC(\d+)\b/g, (_, n) => semantic(n))
  code = code.replace("/*__CBUFFER__*/\n", () => cbufferBlock)

  const shaderName = options.shaderName || "ShaderStudio/CustomEffect"
  const pad = (s: string) => s.split("\n").map((l) => (l.trim() ? "            " + l : l)).join("\n")
  return {
    via: "naga",
    code: `${headerLines("Unity Universal Render Pipeline (URP) ShaderLab / HLSL (WGSL via naga)")}
Shader "${shaderName}"
{
    Properties
    {
${properties.join("\n") || "        // No exposed properties"}
    }
    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }
        LOD 100

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex ${vs}
            #pragma fragment ${fs}

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

${pad(code.trim())}
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
`,
  }
}

/**
 * One entry point for the Export modal and tests: picks the right source for `target` and generates the code.
 *
 * Source rule: GLSL targets (Shadertoy, Godot, R3F, HTML, glTF, Unreal, OSL, npm) use `glslSource`, or WGSL through naga
 * when GLSL is empty. Unity uses naga HLSL when WGSL exists, else the GLSL -> HLSL path. Errors carry the naga line.
 */
export async function generateExport(target: ExportTarget, project: ExportProject): Promise<ExportResult> {
  const common = { parsedUniforms: project.parsedUniforms, uniformValues: project.uniformValues }

  if (target === "unity" && hasText(project.wgslSource)) {
    const res = await nagaTranspile(project.wgslSource, "hlsl")
    if ("error" in res) return res
    const unity = unityFromNagaHlsl(res.code, project.wgslSource, { shaderName: project.shaderName ?? "Custom/ShaderStudioEffect", uniformValues: project.uniformValues })
    // A fragment-only WGSL cannot build a Unity pass: fall back to GLSL when the project has it.
    if (!("error" in unity) || !hasText(project.glslSource)) return unity
  }

  const glsl = await resolveGlslSource(project)
  if ("error" in glsl) {
    // glTF needs no shader: a project with no source at all still exports its plain material. A failed transpile never does.
    if (target === "gltf" && !hasText(project.glslSource) && !hasText(project.wgslSource)) return { code: createGltfFor(project, undefined), via: "none" }
    return glsl
  }
  const shaderSource = glsl.code
  const via = glsl.via
  switch (target) {
    case "unity":
      return { code: transpileToUnityHLSL({ shaderName: project.shaderName ?? "Custom/ShaderStudioEffect", shaderSource, ...common }), via }
    case "unreal":
      return { code: transpileToUnrealHLSL({ shaderName: project.shaderName ?? "Custom/ShaderStudioEffect", shaderSource, ...common }), via }
    case "osl":
      return { code: transpileToBlenderOSL({ shaderSource, ...common }), via }
    case "godot":
      return { code: transpileToGodotShader({ shaderSource, ...common }), via }
    case "shadertoy":
      return { code: transpileToShadertoy({ shaderSource, ...common }), via }
    case "html":
      return { code: generateHtmlEmbed({ shaderSource, geometry: project.geometry, ...common }), via }
    case "r3f":
      return { code: generateR3FExport("CustomShader", { shaderSource, geometry: project.geometry, uniforms: project.parsedUniforms, uniformValues: project.uniformValues }), via }
    case "r3f-component":
      return { code: generateR3FComponent({ shaderSource, geometry: project.geometry, uniforms: project.parsedUniforms, uniformValues: project.uniformValues }), via }
    case "gltf":
      return { code: createGltfFor(project, shaderSource), via }
  }
  return { error: `Unknown export target: ${String(target)}` }
}

function createGltfFor(project: ExportProject, shaderSource: string | undefined): string {
  return createGltfBundle("ShaderStudio_Material", false, {
    shaderSource,
    uniformValues: project.uniformValues,
    bakedMaps: project.bakedMaps,
  })
}
