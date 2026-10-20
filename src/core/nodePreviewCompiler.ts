import type { Node, Edge } from "@xyflow/react"
import { buildSdfTree, type GraphNodeData, type RaymarchNodeData } from "./graphCompiler"
import { compileSdfToGlsl, compileSdfToWgsl, collectSdfUniforms, type SdfTreeNode, type SdfCompileOptions } from "./sdf/sdfCompiler"
import { validateMathExpression, compileMathExpressionToWgsl } from "./mathExpressionValidator"

// Kept out of graphCompiler.ts so the lazy inspector owns this code instead of the entry chunk.
// ---------------------------------------------------------------------------------------------
// Partial-graph compile: the shader that renders ONE node's output (per-node GPU previews)
// ---------------------------------------------------------------------------------------------

type PreviewValueType = "float" | "vec2" | "vec3" | "vec4"

/** A uniform the preview shader declares. `field` is the declared name; `sourceName` the project-store key to read its value from. */
export interface PreviewUniform {
  field: string
  sourceName: string
  type: PreviewValueType
  /** Value used when the store has no value for `sourceName`. */
  defaultValue: number | number[]
  /** Source value is a bool: the shader declares a float, so send 0/1. */
  bool?: boolean
}

export interface NodePreviewSource {
  /** WGSL (WebGPU): fullscreen-quad vertex stage + fragment_main. */
  wgsl: string
  /** GLSL 300 es for the WebGL2 backend (`in v_uv`, `out fragColor`). */
  glsl: string
  /** GLSL for the Three.js backend: same fragment without the varying/output declarations the ShaderMaterial prefix owns. */
  glslThree: string
}

export type NodePreviewResult =
  | { status: "ok"; source: NodePreviewSource; uniforms: PreviewUniform[] }
  /** The node has no visual output (mesh, compute, audio, annotation, ...). */
  | { status: "none" }
  | { status: "error"; error: string }

export interface NodePreviewOptions {
  /** The project's own shader source; a material node previews exactly this. */
  material?: { wgsl?: string; glsl?: string }
}

class PreviewError extends Error {}

const WGSL_VEC: Record<PreviewValueType, string> = { float: "f32", vec2: "vec2f", vec3: "vec3f", vec4: "vec4f" }
const PREVIEW_DIM: Record<PreviewValueType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 }
const PREVIEW_GLOBAL_INPUTS = ["a", "b", "c", "d", "x", "y", "z", "w"]
const ident = (s: string) => (s.replace(/[^A-Za-z0-9_]/g, "_") || "param")

function toThreeGlsl(glsl: string): string {
  return glsl
    .replace(/^in vec2 v_uv;\n/m, "")
    .replace(/^out vec4 fragColor;\n/m, "")
    .replace(/\bfragColor\b/g, "gl_FragColor")
    .replace("precision highp float;\n", "precision highp float;\n#define v_uv (gl_FragCoord.xy / u_resolution)\n")
}

function wrapPreviewColor(ref: string, type: PreviewValueType, lang: "glsl" | "wgsl"): string {
  const v4 = lang === "glsl" ? "vec4" : "vec4f"
  switch (type) {
    case "float": return `${v4}(${ref}, ${ref}, ${ref}, 1.0)`
    case "vec2": return `${v4}(${ref}, 0.0, 1.0)`
    case "vec3": return `${v4}(${ref}, 1.0)`
    default: return ref
  }
}

interface PreviewRef { glsl: string; wgsl: string; type: PreviewValueType }

interface PreviewCtx {
  nodes: Map<string, Node<GraphNodeData>>
  edges: Edge[]
  uniforms: Map<string, PreviewUniform>
  glsl: string[]
  wgsl: string[]
  done: Map<string, PreviewRef>
  visiting: Set<string>
}

function normalizeUniformDefault(value: unknown, type: PreviewValueType): number | number[] {
  if (type === "float") return typeof value === "boolean" ? (value ? 1 : 0) : Number(Array.isArray(value) ? value[0] : value) || 0
  const arr = Array.isArray(value) ? value : []
  return Array.from({ length: PREVIEW_DIM[type] }, (_, i) => Number(arr[i] ?? (type === "vec4" && i === 3 ? 1 : 0)) || 0)
}

/** Emits (memoised) the statements computing a value node and returns the expression naming its result. */
function emitPreviewValue(ctx: PreviewCtx, id: string): PreviewRef {
  const cached = ctx.done.get(id)
  if (cached) return cached
  const node = ctx.nodes.get(id)
  const zero: PreviewRef = { glsl: "0.0", wgsl: "0.0", type: "float" }
  if (!node) return zero
  if (ctx.visiting.has(id)) throw new PreviewError(`Cycle detected in node graph involving node "${id}".`)
  ctx.visiting.add(id)
  let out: PreviewRef = zero
  const data = node.data
  if (data.type === "time") {
    out = { glsl: "time", wgsl: "time", type: "float" }
  } else if (data.type === "uniform") {
    const type: PreviewValueType = data.uniformType === "color" ? "vec3" : data.uniformType === "bool" ? "float" : (data.uniformType as PreviewValueType) || "float"
    const name = data.name || "param"
    const field = `pu_${ident(name)}`
    if (!ctx.uniforms.has(field)) {
      ctx.uniforms.set(field, { field, sourceName: name, type, defaultValue: normalizeUniformDefault(data.defaultValue, type), ...(data.uniformType === "bool" ? { bool: true } : {}) })
    }
    out = { glsl: field, wgsl: `uniforms.${field}`, type }
  } else if (data.type === "math_expression") {
    const expr = data.expression ?? ""
    const declared = data.inputNames ?? []
    const check = validateMathExpression(expr, declared)
    if (!check.isValid) throw new PreviewError(check.error ?? "Invalid expression.")
    const type: PreviewValueType = data.outputType ?? check.outputType ?? "float"
    const inEdges = ctx.edges.filter((e) => e.target === id)
    const unmatched = inEdges.filter((e) => !declared.includes(e.targetHandle ?? ""))
    let nextUnmatched = 0
    const glslIn: string[] = []
    const wgslIn: string[] = []
    for (const name of declared) {
      const edge = inEdges.find((e) => e.targetHandle === name) ?? unmatched[nextUnmatched++]
      const ref = edge ? emitPreviewValue(ctx, edge.source) : zero
      glslIn.push(`${ref.type} ${ident(name)} = ${ref.glsl};`)
      wgslIn.push(`let ${ident(name)}: ${WGSL_VEC[ref.type]} = ${ref.wgsl};`)
    }
    for (const g of PREVIEW_GLOBAL_INPUTS) {
      if (declared.includes(g) || !new RegExp(`\\b${g}\\b`).test(expr)) continue
      glslIn.push(`float ${g} = 0.0;`)
      wgslIn.push(`let ${g}: f32 = 0.0;`)
    }
    const stmt = compileMathExpressionToWgsl(expr, "__e", type)
    const rhs = stmt.slice(stmt.indexOf("=") + 1).trim().replace(/;$/, "")
    const v = `n_${ident(id)}`
    ctx.glsl.push(`${type} ${v}; { ${glslIn.join(" ")} ${v} = ${expr}; }`)
    ctx.wgsl.push(`var ${v}: ${WGSL_VEC[type]}; { ${wgslIn.join(" ")} ${v} = ${rhs}; }`)
    out = { glsl: v, wgsl: v, type }
  }
  ctx.visiting.delete(id)
  ctx.done.set(id, out)
  return out
}

function raymarchPreview(data: RaymarchNodeData | null, root: SdfTreeNode): { source: NodePreviewSource; uniforms: PreviewUniform[] } {
  const opts: SdfCompileOptions = data
    ? {
        maxSteps: data.maxSteps ?? 128, maxDistance: data.maxDistance ?? 40.0, hitEpsilon: data.hitEpsilon ?? 0.001,
        enableSoftShadows: data.enableShadows ?? true, enableAmbientOcclusion: data.enableAo ?? true, baseColor: data.baseColor ?? [0.35, 0.65, 1.0],
      }
    : { maxSteps: 64, enableSoftShadows: false, enableAmbientOcclusion: false } // bare SDF primitives/operators: cheap preview
  const glsl = compileSdfToGlsl(root, opts)
  const uniforms = Object.entries(collectSdfUniforms(root))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([field, v]): PreviewUniform => ({ field, sourceName: field, type: "float", defaultValue: v }))
  return { source: { wgsl: compileSdfToWgsl(root, opts), glsl, glslThree: toThreeGlsl(glsl) }, uniforms }
}

/**
 * Compiles the shader that renders `nodeId`'s output on a fullscreen quad (both WGSL and GLSL), reusing the SDF / math
 * compilers. Pure and deterministic: the same graph always yields the same source text, and values that change at
 * runtime (uniforms, time) are uniforms of the shader, never baked in, so callers can cache pipelines by source.
 *
 * - material -> the project's own shader (`options.material`)
 * - uniform / time / math_expression -> the value as colour (float = grey, vec2 = rg, vec3 = rgb, vec4 = rgba)
 * - raymarch / sdf_primitive / sdf_operator -> the raymarched SDF
 * - output -> whatever feeds it
 * - everything else (mesh, compute, audio, texture, post-process, annotations, ...) -> `{ status: "none" }`
 */
export function compileNodePreview(
  nodeId: string,
  rawNodes: Node<GraphNodeData>[],
  edges: Edge[],
  options: NodePreviewOptions = {},
): NodePreviewResult {
  const nodes = new Map(rawNodes.map((n) => [n.id, n]))
  let node = nodes.get(nodeId)
  for (let hops = 0; node?.data.type === "output" && hops <= nodes.size; hops++) {
    const feed = edges.find((e) => e.target === node!.id)
    node = feed ? nodes.get(feed.source) : undefined
  }
  if (!node) return { status: "none" }
  const data = node.data

  try {
    switch (data.type) {
      case "material": {
        const wgsl = options.material?.wgsl ?? ""
        const glsl = options.material?.glsl ?? ""
        if (!wgsl && !glsl) return { status: "error", error: "No shader source to preview." }
        return { status: "ok", source: { wgsl, glsl, glslThree: glsl }, uniforms: [] }
      }
      case "raymarch": {
        const input = edges.find((e) => e.target === node!.id)
        const root: SdfTreeNode = input
          ? buildSdfTree(input.source, rawNodes, edges)
          : {
              kind: "operator", id: "default_metaball", type: "smooth_union", params: { type: "smooth_union", smoothness: 0.25 },
              children: [
                { kind: "primitive", id: "sphere_a", type: "sphere", params: { type: "sphere", offset: [-0.6, 0, 0], radius: 0.8 } },
                { kind: "primitive", id: "sphere_b", type: "sphere", params: { type: "sphere", offset: [0.6, 0, 0], radius: 0.8 } },
              ],
            }
        return { status: "ok", ...raymarchPreview(data, root) }
      }
      case "sdf_primitive":
      case "sdf_operator":
        return { status: "ok", ...raymarchPreview(null, buildSdfTree(node.id, rawNodes, edges)) }
      case "uniform":
      case "time":
      case "math_expression": {
        const ctx: PreviewCtx = { nodes, edges, uniforms: new Map(), glsl: [], wgsl: [], done: new Map(), visiting: new Set() }
        const v = emitPreviewValue(ctx, node.id)
        const shown: PreviewRef = data.type === "time" ? { glsl: "fract(time)", wgsl: "fract(time)", type: "float" } : v
        const uniforms = [...ctx.uniforms.values()].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
        const glsl = [
          "#version 300 es", "precision highp float;", "in vec2 v_uv;", "out vec4 fragColor;",
          "uniform float u_time;", "uniform vec2 u_resolution;",
          ...uniforms.map((u) => `uniform ${u.type} ${u.field};`),
          "const float PI = 3.14159265359;", "const float TAU = 6.28318530718;", "const float E = 2.71828182846;",
          "void main() {", "  vec2 uv = v_uv;", "  float time = u_time;", "  vec2 resolution = u_resolution;",
          ...ctx.glsl.map((s) => `  ${s}`),
          `  fragColor = ${wrapPreviewColor(shown.glsl, shown.type, "glsl")};`, "}", "",
        ].join("\n")
        const wgsl = [
          "// ShaderStudio - node preview", "struct Uniforms {", "  mvp: mat4x4f,", "  time: f32,", "  color: vec3f,", "  resolution: vec2f,", "  padding: vec2f,",
          ...uniforms.map((u) => `  ${u.field}: ${WGSL_VEC[u.type]},`),
          "};", "@group(0) @binding(0) var<uniform> uniforms: Uniforms;",
          "struct VertexInput { @location(0) position: vec3f, };",
          "struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f, };",
          "@vertex fn vertex_main(input: VertexInput) -> VertexOutput {",
          "  var output: VertexOutput;", "  output.position = vec4f(input.position.xy, 0.0, 1.0);", "  output.uv = input.position.xy * 0.5 + 0.5;", "  return output;", "}",
          "const PI: f32 = 3.14159265359;", "const TAU: f32 = 6.28318530718;", "const E: f32 = 2.71828182846;",
          "@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4f {",
          "  let uv = input.uv;", "  let time = uniforms.time;", "  let resolution = uniforms.resolution;",
          ...ctx.wgsl.map((s) => `  ${s}`),
          `  return ${wrapPreviewColor(shown.wgsl, shown.type, "wgsl")};`, "}", "",
        ].join("\n")
        return { status: "ok", source: { wgsl, glsl, glslThree: toThreeGlsl(glsl) }, uniforms }
      }
      default:
        return { status: "none" }
    }
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) }
  }
}
