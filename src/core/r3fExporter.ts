import type { ParsedUniform, UniformValue } from "@/stores/projectStore"

// NOTE: this file is also loaded by Node's type stripping (scripts/mcp-server.js via engineTranspiler.ts):
// no enums, namespaces or parameter properties.

// ---------------------------------------------------------------------------------------------------------------------
// GLSL token utilities. Every identifier rewrite in the exporters goes through these so that comments, strings,
// member accesses (`u.time`) and longer identifiers (`user_u_time`, `u_time2`) are never touched.
// ---------------------------------------------------------------------------------------------------------------------

export type IdentMatch = { id: string; src: string; end: number }
/** A replacement string, or a function that may consume extra text after the identifier (return `{ to, end }`). */
export type IdentRule = string | ((m: IdentMatch) => string | { to: string; end: number } | undefined)

const isIdStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
const isDigit = (c: string) => c >= "0" && c <= "9"
const isIdPart = (c: string) => isIdStart(c) || isDigit(c)

/** Index just past the comment / string literal starting at `i`, or -1 when `src[i]` doesn't start one. */
function skipNonCode(src: string, i: number): number {
  const n = src.length
  const c = src[i]
  if (c === "/" && src[i + 1] === "/") {
    const j = src.indexOf("\n", i)
    return j < 0 ? n : j
  }
  if (c === "/" && src[i + 1] === "*") {
    const j = src.indexOf("*/", i + 2)
    return j < 0 ? n : j + 2
  }
  if (c === '"' || c === "'") {
    let j = i + 1
    while (j < n && src[j] !== c && src[j] !== "\n") {
      if (src[j] === "\\") j++
      j++
    }
    return Math.min(j + 1, n)
  }
  return -1
}

type IdentFn = (id: string, end: number) => string | { to: string; end: number } | undefined

/** Walks `src` as code and lets `fn` replace identifier tokens. Member names (`a.b` -> `b`) are never offered. */
function transformIdentifiers(src: string, fn: IdentFn): string {
  let out = ""
  let i = 0
  const n = src.length
  while (i < n) {
    const skip = skipNonCode(src, i)
    if (skip >= 0) {
      out += src.slice(i, skip)
      i = skip
      continue
    }
    const c = src[i]
    if (isDigit(c)) {
      let j = i + 1
      while (j < n && (isIdPart(src[j]) || src[j] === ".")) j++
      out += src.slice(i, j)
      i = j
      continue
    }
    if (isIdStart(c)) {
      let j = i + 1
      while (j < n && isIdPart(src[j])) j++
      const id = src.slice(i, j)
      let p = i - 1
      while (p >= 0 && (src[p] === " " || src[p] === "\t")) p--
      const member = p >= 0 && src[p] === "." && !(p > 0 && isDigit(src[p - 1]))
      const res = member ? undefined : fn(id, j)
      if (res === undefined) {
        out += id
        i = j
      } else if (typeof res === "string") {
        out += res
        i = j
      } else {
        out += res.to
        i = res.end
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** Whole-identifier, comment/string/member-access aware replacement. */
export function rewriteIdentifiers(src: string, rules: Record<string, IdentRule> | Map<string, IdentRule>): string {
  const map = rules instanceof Map ? rules : new Map(Object.entries(rules))
  return transformIdentifiers(src, (id, end) => {
    const rule = map.get(id)
    return typeof rule === "function" ? rule({ id, src, end }) : rule
  })
}

/** Every identifier used as code in `src` (comments, strings and member names excluded). */
export function collectIdentifiers(src: string): Set<string> {
  const ids = new Set<string>()
  transformIdentifiers(src, (id) => {
    ids.add(id)
    return undefined
  })
  return ids
}

/** Same length as `src`, with comments and string contents blanked (newlines kept), so regexes only see code. */
export function maskNonCode(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const skip = skipNonCode(src, i)
    if (skip >= 0) {
      out += src.slice(i, skip).replace(/[^\n]/g, " ")
      i = skip
    } else {
      out += src[i++]
    }
  }
  return out
}

/** Rule helper: `name.xy` and `name` both become `to` (drops a swizzle that the replacement already carries). */
export const eatSwizzle =
  (to: string, swizzle = ".xy"): IdentRule =>
  ({ src, end }) =>
    src.startsWith(swizzle, end) ? { to, end: end + swizzle.length } : to

/** Rule helper: GLSL 2-argument `atan(y, x)` -> `atan2`, 1-argument stays `atan`. */
export const atanRule: IdentRule = ({ src, end }) => {
  let k = end
  while (src[k] === " " || src[k] === "\t") k++
  if (src[k] !== "(") return undefined
  let depth = 0
  for (let i = k; i < src.length; i++) {
    const ch = src[i]
    if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") {
      depth--
      if (depth === 0) return "atan"
    } else if (ch === "," && depth === 1) return "atan2"
  }
  return undefined
}

export interface GlslDecl {
  type: string
  name: string
  array?: string
}

export interface GlslSplit {
  /** Everything outside `main` (helper functions, consts, structs) minus version/precision/in/out/uniform declarations. */
  prelude: string
  /** Contents of `void main() { ... }`; the whole stripped source when there is no `main`. */
  body: string
  hasMain: boolean
  hasMainImage: boolean
  varyings: GlslDecl[]
  uniforms: GlslDecl[]
  /** Name of the fragment output (`out vec4 fragColor;`), if declared. */
  outName?: string
}

const DECL_TYPE = String.raw`(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)`
const QUAL = String.raw`(?:(?:flat|smooth|noperspective|centroid)\s+)*`
const LAYOUT = String.raw`(?:layout\s*\([^)]*\)\s*)?`
const IN_RE = new RegExp(String.raw`^[ \t]*${LAYOUT}${QUAL}in\s+${DECL_TYPE}\s+(\w+)\s*;[ \t]*\n?`, "gm")
const OUT_RE = new RegExp(String.raw`^[ \t]*${LAYOUT}${QUAL}out\s+${DECL_TYPE}\s+(\w+)\s*;[ \t]*\n?`, "gm")
const VARYING_RE = new RegExp(String.raw`^[ \t]*varying\s+${DECL_TYPE}\s+(\w+)\s*;[ \t]*\n?`, "gm")
const UNIFORM_RE = new RegExp(String.raw`^[ \t]*${LAYOUT}uniform\s+${DECL_TYPE}\s+(\w+)\s*(\[[^\]]*\])?\s*(?:=[^;]*)?;[ \t]*\n?`, "gm")
const HEADER_RE = /^[ \t]*(?:#version[^\n]*|precision\s+\w+\s+\w+\s*;)[ \t]*\n?/gm

/** Removes the declarations matched by `re` (matched on the code mask) from `text`, returning what was removed. */
function stripDecls(text: string, re: RegExp): { text: string; found: GlslDecl[] } {
  const mask = maskNonCode(text)
  const found: GlslDecl[] = []
  let out = ""
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(mask); m; m = re.exec(mask)) {
    found.push({ type: m[1], name: m[2], array: m[3] })
    out += text.slice(last, m.index)
    last = m.index + m[0].length
  }
  return { text: out + text.slice(last), found }
}

/** Splits a GLSL fragment into reusable pieces. Token-aware: comments and strings never confuse the scanners. */
export function splitGlsl(source: string): GlslSplit {
  const mask = maskNonCode(source)
  const mm = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(mask)
  let before = source
  let after = ""
  let body = ""
  if (mm) {
    const open = mm.index + mm[0].length
    let depth = 1
    let close = open
    for (; close < mask.length; close++) {
      if (mask[close] === "{") depth++
      else if (mask[close] === "}" && --depth === 0) break
    }
    before = source.slice(0, mm.index)
    body = source.slice(open, close)
    after = source.slice(close + 1)
  }
  let rest = before + (after.trim() ? "\n" + after : "")
  rest = stripDecls(rest, HEADER_RE).text
  const varyings: GlslDecl[] = []
  const uniforms: GlslDecl[] = []
  for (const re of [IN_RE, VARYING_RE]) {
    const r = stripDecls(rest, re)
    rest = r.text
    varyings.push(...r.found)
  }
  const outs = stripDecls(rest, OUT_RE)
  rest = outs.text
  const outName = outs.found.find((d) => d.type === "vec4")?.name
  const us = stripDecls(rest, UNIFORM_RE)
  rest = us.text
  uniforms.push(...us.found)
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(maskNonCode(rest))
  if (!mm) return { prelude: "", body: rest.trim(), hasMain: false, hasMainImage, varyings, uniforms, outName }
  return {
    prelude: rest.replace(/\n{3,}/g, "\n\n").trim(),
    body: body.replace(/^\n+|\s+$/g, ""),
    hasMain: true,
    hasMainImage: false,
    varyings,
    uniforms,
    outName,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// three.js shared pieces (R3F, HTML embed, npm package)
// ---------------------------------------------------------------------------------------------------------------------

/** What a fragment varying carries, judged from its name and type. */
export type VaryingKind = "position" | "uv" | "normal" | "other"
export function varyingKind(d: GlslDecl): VaryingKind {
  const n = d.name.toLowerCase().replace(/^v_?/, "")
  if (d.type === "vec2" && /uv|texcoord/.test(n)) return "uv"
  if (d.type === "vec3" && /norm/.test(n)) return "normal"
  if (d.type === "vec3" && /pos/.test(n)) return "position"
  return "other"
}

const DEFAULT_VERT = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

/**
 * Vertex shader whose outputs match the varyings the fragment shader reads (`v_world_pos`, `v_uv`, `v_normal`, `vUv`...),
 * so the program links. Falls back to the plain `vUv` pass-through.
 */
export function buildThreeVertexShader(fragmentSource: string): string {
  const { varyings } = splitGlsl(fragmentSource || "")
  if (varyings.length === 0) return DEFAULT_VERT
  const decls: string[] = []
  const assigns: string[] = []
  for (const v of varyings) {
    decls.push(`varying ${v.type} ${v.name};`)
    const kind = varyingKind(v)
    assigns.push(`  ${v.name} = ${kind === "position" ? "position" : kind === "uv" ? "uv" : kind === "normal" ? "normal" : `${v.type}(0.0)`};`)
  }
  return `${decls.join("\n")}\nvoid main() {\n${assigns.join("\n")}\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}`
}

/**
 * three.js ShaderMaterial wants no `#version` line and (without glslVersion) `gl_FragColor`: drop the GLSL ES 3.00 header
 * and the `out vec4` declaration and rename that output token-aware.
 */
export function prepareThreeFragment(source: string): string {
  const { outName } = splitGlsl(source)
  if (!outName) return source
  const mask = maskNonCode(source)
  const decl = /^[ \t]*(?:layout\s*\([^)]*\)\s*)?out\s+(?:(?:highp|mediump|lowp)\s+)?vec4\s+\w+\s*;[ \t]*\n?/gm
  let stripped = ""
  let last = 0
  for (let m = decl.exec(mask); m; m = decl.exec(mask)) {
    stripped += source.slice(last, m.index)
    last = m.index + m[0].length
  }
  stripped += source.slice(last)
  stripped = stripped.replace(/^[ \t]*#version[^\n]*\n?/m, "")
  return rewriteIdentifiers(stripped, { [outName]: "gl_FragColor" }).replace(/^\s+/, "")
}

const isColorish = (u: ParsedUniform) => ["vec3f", "vec3", "color"].includes(String(u.type)) || u.kind === "color"

/** `[name, JS expression]` for each non-builtin uniform, in the shape three.js expects for a uniform value. */
export function threeUniformEntries(uniforms: ParsedUniform[] | undefined, values?: Record<string, UniformValue>): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const u of uniforms ?? []) {
    if (u.name === "u_time" || u.name === "u_resolution" || u.name === "time" || u.name === "resolution") continue
    const val = values?.[u.name]?.value
    const t = String(u.type)
    if (isColorish(u)) {
      const arr = Array.isArray(val) ? val : [1, 1, 1]
      entries.push([u.name, `new THREE.Color(${arr[0]}, ${arr[1]}, ${arr[2]})`])
    } else if (t === "vec2f" || t === "vec2") {
      const arr = Array.isArray(val) ? val : [1, 1]
      entries.push([u.name, `new THREE.Vector2(${arr[0]}, ${arr[1]})`])
    } else if (t === "vec4f" || t === "vec4") {
      const arr = Array.isArray(val) ? val : [0, 0, 0, 1]
      entries.push([u.name, `new THREE.Vector4(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]})`])
    } else if (t === "sampler2D" || t === "texture" || u.kind === "texture") {
      entries.push([u.name, "null"])
    } else {
      entries.push([u.name, String(typeof val === "number" ? val : typeof val === "boolean" ? Number(val) : 0)])
    }
  }
  return entries
}

export type ExportGeometry = "cube" | "sphere" | "plane" | "torus_knot" | "custom"

/** The project's mesh as three.js code (imperative and JSX). Custom models can't travel in a shader export: torus knot stands in. */
export function threeGeometry(g: ExportGeometry | undefined): { js: string; jsx: string; note: string } {
  switch (g) {
    case "cube":
      return { js: "new THREE.BoxGeometry(2, 2, 2)", jsx: "<boxGeometry args={[2, 2, 2]} />", note: "" }
    case "sphere":
      return { js: "new THREE.SphereGeometry(1, 32, 32)", jsx: "<sphereGeometry args={[1, 32, 32]} />", note: "" }
    case "plane":
      return { js: "new THREE.PlaneGeometry(2, 2)", jsx: "<planeGeometry args={[2, 2]} />", note: "" }
    default:
      return {
        js: "new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16)",
        jsx: "<torusKnotGeometry args={[0.8, 0.25, 100, 16]} />",
        note: g === "custom" ? "custom model: not embedded in the export, a torus knot stands in (swap in your own geometry)" : "",
      }
  }
}

export interface R3FExportOptions {
  geometry?: ExportGeometry
  shaderSource?: string
  vertexShader?: string
  uniforms?: ParsedUniform[]
  uniformValues?: Record<string, UniformValue>
}

const FALLBACK_FRAGMENT = `uniform float u_time;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(vUv, sin(u_time), 1.0);
}`

const indent = (s: string, pad: string) => s.split("\n").map((l) => pad + l).join("\n")
export const escapeTemplate = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")

/**
 * Generates a React Three Fiber module using `@react-three/drei`'s `shaderMaterial`,
 * `@react-three/fiber`'s `extend`, and an exportable `StorybookPreview` component.
 */
export function generateR3FExport(materialName: string, options?: R3FExportOptions): string {
  const safeName = materialName.replace(/[^a-zA-Z0-9_]/g, "") || "Custom"
  const fragmentShader = options?.shaderSource ? prepareThreeFragment(options.shaderSource) : FALLBACK_FRAGMENT
  const vertexShader = options?.vertexShader || buildThreeVertexShader(fragmentShader)

  const uniformProps = ["u_time: 0", "u_resolution: new THREE.Vector2()", ...threeUniformEntries(options?.uniforms, options?.uniformValues).map(([k, v]) => `${k}: ${v}`)]

  return `
import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

export const ${safeName}Material = shaderMaterial(
  { ${uniformProps.join(", ")} },
  /* vertex */ \`
${indent(escapeTemplate(vertexShader), "    ")}
  \`,
  /* fragment */ \`
${indent(escapeTemplate(fragmentShader), "    ")}
  \`
);

extend({ ${safeName}Material });

export const StorybookPreview = () => (
  <mesh>
    ${options?.geometry ? threeGeometry(options.geometry).jsx : "<planeGeometry args={[2, 2]} />"}
    <${safeName}Material />
  </mesh>
);
`.trim()
}

/** Plain R3F component (`<shaderMaterial>` + useFrame) for the "Standard R3F Component" preset. */
export function generateR3FComponent(options?: R3FExportOptions): string {
  const fragment = prepareThreeFragment(options?.shaderSource || "void main() { gl_FragColor = vec4(1.0); }")
  const vertex = options?.vertexShader || buildThreeVertexShader(fragment)
  const geo = threeGeometry(options?.geometry)
  const uniforms = (options?.uniforms ?? []).filter((u) => u.name !== "u_time" && u.name !== "u_resolution")
  const propTypes = uniforms
    .map((u) => `  ${u.name}?: ${isColorish(u) ? "THREE.ColorRepresentation" : u.type === "vec2f" ? "[number, number]" : u.type === "vec4f" ? "[number, number, number, number]" : u.type === "bool" ? "boolean" : "number"}`)
    .join("\n")
  const inits = threeUniformEntries(uniforms, options?.uniformValues)
    .map(([k, v]) => `      ${k}: { value: ${v} },`)
    .join("\n")

  return `// =====================================================================
// Generated by Shader Studio (https://github.com/Binitpyro/ShaderStudio)
// React Three Fiber (R3F) Component
// =====================================================================
import { useRef, useMemo, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

export interface CustomShaderMeshProps {
${propTypes || "  // No custom uniforms"}
  [key: string]: any
}

const VERTEX_SHADER = \`${escapeTemplate(vertex.trim())}\`

const FRAGMENT_SHADER = \`${escapeTemplate(fragment.trim())}\`

export function CustomShaderMesh(props: CustomShaderMeshProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
${inits}
    }),
    []
  )

  // Update uniforms when props change
  useEffect(() => {
    if (!materialRef.current) return
    Object.entries(props).forEach(([key, val]) => {
      const u = materialRef.current?.uniforms[key]
      if (u) u.value = val
    })
  }, [props])

  // Real-time animation loop
  useFrame((_, delta) => {
    if (materialRef.current?.uniforms.u_time) {
      materialRef.current.uniforms.u_time.value += delta
    }
  })

  return (
    <mesh {...props}>
      ${geo.note ? `{/* ${geo.note} */}\n      ` : ""}${geo.jsx}
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  )
}

export default CustomShaderMesh
`
}
