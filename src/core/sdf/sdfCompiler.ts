/**
 * ShaderStudio - Signed Distance Field (SDF) Compiler
 * Compiles visual SDF node trees into real-time GLSL and WGSL raymarching fragment shaders.
 * Supports soft shadows, ambient occlusion, normal estimation, and environment reflections.
 */

import {
  type SdfPrimitiveType,
  type SdfPrimitiveParams,
  GLSL_SDF_PRIMITIVES_LIB,
  WGSL_SDF_PRIMITIVES_LIB,
} from "./sdfPrimitives"

import {
  type SdfOperatorType,
  type SdfOperatorParams,
  GLSL_SDF_OPERATORS_LIB,
  WGSL_SDF_OPERATORS_LIB,
} from "./sdfOperators"

export type SdfTreeNode =
  | {
      kind: "primitive"
      id: string
      type: SdfPrimitiveType
      params: SdfPrimitiveParams
    }
  | {
      kind: "operator"
      id: string
      type: SdfOperatorType
      params: SdfOperatorParams
      children: SdfTreeNode[]
    }

export interface SdfCompileOptions {
  maxSteps?: number
  maxDistance?: number
  hitEpsilon?: number
  enableSoftShadows?: boolean
  enableAmbientOcclusion?: boolean
  enableEnvReflection?: boolean
  baseColor?: [number, number, number]
}

/** Collected SDF parameter uniforms: stable name -> current value. */
export type SdfUniformMap = Record<string, number>

/** Stable uniform name per node + param component (value-independent, so slider drags never change the source). */
export function sdfUniformName(nodeId: string, key: string): string {
  return `u_sdf_${nodeId.replace(/[^A-Za-z0-9]/g, "_")}_${key}`
}

type Lang = "glsl" | "wgsl"
const VEC3 = { glsl: "vec3", wgsl: "vec3f" } as const
const VEC2 = { glsl: "vec2", wgsl: "vec2f" } as const

/**
 * Generate recursive distance expression for an SDF tree node. Parameters are emitted as uniform
 * references (registered into `uni`) instead of baked literals, so only graph structure affects the source.
 */
function buildDistanceExpr(lang: Lang, node: SdfTreeNode, uni: SdfUniformMap, pVar: string = "p"): string {
  const ref = (name: string) => (lang === "wgsl" ? `uniforms.${name}` : name)
  const scalar = (key: string, value: number): string => {
    const name = sdfUniformName(node.id, key)
    uni[name] = value
    return ref(name)
  }
  const vec3 = (key: string, v: readonly number[]): string =>
    `${VEC3[lang]}(${scalar(`${key}_x`, v[0])}, ${scalar(`${key}_y`, v[1])}, ${scalar(`${key}_z`, v[2])})`
  const vec2 = (key: string, a: number, b: number): string =>
    `${VEC2[lang]}(${scalar(`${key}_x`, a)}, ${scalar(`${key}_y`, b)})`

  if (node.kind === "primitive") {
    const localP = `(${pVar} - ${vec3("offset", node.params.offset ?? [0, 0, 0])})`

    switch (node.type) {
      case "sphere":
        return `sdSphere(${localP}, ${scalar("radius", node.params.radius ?? 1.0)})`
      case "box":
        return `sdBox(${localP}, ${vec3("size", node.params.size ?? [0.8, 0.8, 0.8])})`
      case "torus":
        return `sdTorus(${localP}, ${vec2("torus", node.params.majorRadius ?? 1.0, node.params.minorRadius ?? 0.35)})`
      case "cylinder":
        return `sdCylinder(${localP}, ${vec2("cyl", node.params.radius ?? 0.7, node.params.height ?? 1.0)})`
      case "capsule":
        return `sdCapsule(${localP}, ${vec3("capA", node.params.capsuleA ?? [0, -0.6, 0])}, ${vec3("capB", node.params.capsuleB ?? [0, 0.6, 0])}, ${scalar("radius", node.params.radius ?? 0.4)})`
      case "plane":
        return `sdPlane(${localP}, ${vec3("normal", node.params.planeNormal ?? [0, 1, 0])}, ${scalar("planeDistance", node.params.planeDistance ?? 0.0)})`
      default:
        return `sdSphere(${localP}, 1.0)`
    }
  }

  // Operator
  const k = () => scalar("smoothness", node.params.smoothness ?? 0.2)
  const childA = node.children[0]
  const childB = node.children[1]

  if (node.type === "repetition") {
    const repVar = `opRep(${pVar}, ${vec3("spacing", node.params.repetitionSpacing ?? [3.0, 3.0, 3.0])})`
    return childA ? buildDistanceExpr(lang, childA, uni, repVar) : `sdSphere(${repVar}, 0.5)`
  }

  if (node.type === "twist") {
    const twistVar = `opTwist(${pVar}, ${scalar("twistRate", node.params.twistRate ?? 1.0)})`
    return childA ? buildDistanceExpr(lang, childA, uni, twistVar) : `sdSphere(${twistVar}, 0.5)`
  }

  const exprA = childA ? buildDistanceExpr(lang, childA, uni, pVar) : "100.0"
  const exprB = childB ? buildDistanceExpr(lang, childB, uni, pVar) : "100.0"

  switch (node.type) {
    case "smooth_union":
      return `opSmoothUnion(${exprA}, ${exprB}, ${k()})`
    case "subtraction":
      return `opSubtraction(${exprA}, ${exprB})`
    case "smooth_subtraction":
      return `opSmoothSubtraction(${exprA}, ${exprB}, ${k()})`
    case "intersection":
      return `opIntersection(${exprA}, ${exprB})`
    case "smooth_intersection":
      return `opSmoothIntersection(${exprA}, ${exprB}, ${k()})`
    case "union":
    default:
      return `opUnion(${exprA}, ${exprB})`
  }
}

/** Current uniform values for an SDF tree (name -> value). Independent of the generated source text. */
export function collectSdfUniforms(root: SdfTreeNode): SdfUniformMap {
  const uni: SdfUniformMap = {}
  buildDistanceExpr("glsl", root, uni)
  return uni
}

/**
 * Compile SDF tree to full production GLSL 300 es raymarching fragment shader.
 */
export function compileSdfToGlsl(root: SdfTreeNode, options: SdfCompileOptions = {}): string {
  const maxSteps = options.maxSteps ?? 128
  const maxDist = (options.maxDistance ?? 40.0).toFixed(1)
  const hitEps = (options.hitEpsilon ?? 0.001).toFixed(4)
  const color = options.baseColor ?? [0.35, 0.65, 1.0]
  const sdfUni: SdfUniformMap = {}
  const mapExpr = buildDistanceExpr("glsl", root, sdfUni, "p")
  const sdfDecls = Object.keys(sdfUni).map((n) => `uniform float ${n};`).join("\n")

  return `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_color;
uniform float u_audio_bass;
uniform float u_audio_mid;
uniform float u_audio_treble;
uniform float u_audio_beat;
${sdfDecls}

${GLSL_SDF_PRIMITIVES_LIB}
${GLSL_SDF_OPERATORS_LIB}

float map(vec3 p) {
  return ${mapExpr};
}

vec3 calcNormal(vec3 p) {
  const float h = 0.0005;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * h) +
    k.yyx * map(p + k.yyx * h) +
    k.yxy * map(p + k.yxy * h) +
    k.xxx * map(p + k.xxx * h)
  );
}

float calcSoftShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 32 && t < maxt; i++) {
    float h = map(ro + rd * t);
    if (h < ${hitEps}) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.2);
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 pos, vec3 nor) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = map(pos + h * nor);
    occ += (h - d) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  // Orbit camera around scene
  float camDist = 3.8;
  float camAngle = u_time * 0.4;
  vec3 ro = vec3(camDist * sin(camAngle), 1.8, camDist * cos(camAngle));
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

  // Raymarching
  float t = 0.01;
  float d = 0.0;
  bool hit = false;
  for (int i = 0; i < ${maxSteps}; i++) {
    vec3 p = ro + rd * t;
    d = map(p);
    if (d < ${hitEps}) {
      hit = true;
      break;
    }
    if (t > ${maxDist}) break;
    t += d;
  }

  // Shading
  vec3 col = vec3(0.06, 0.07, 0.1); // Deep background
  if (hit) {
    vec3 pos = ro + rd * t;
    vec3 nor = calcNormal(pos);
    vec3 ref = reflect(rd, nor);

    vec3 lightDir = normalize(vec3(0.8, 1.2, 0.9));
    float diff = max(dot(nor, lightDir), 0.0);
    float spec = pow(max(dot(ref, lightDir), 0.0), 32.0);
    float fre = clamp(1.0 + dot(rd, nor), 0.0, 1.0);
    float shadow = calcSoftShadow(pos + nor * 0.01, lightDir, 0.02, 10.0, 16.0);
    float ao = calcAO(pos, nor);

    vec3 baseCol = (length(u_color) > 0.01) ? u_color : vec3(${color[0].toFixed(3)}, ${color[1].toFixed(3)}, ${color[2].toFixed(3)});
    vec3 ambient = vec3(0.08, 0.10, 0.14) * ao;
    vec3 diffuse = baseCol * diff * shadow;
    vec3 specular = vec3(1.0, 0.95, 0.9) * spec * shadow;
    vec3 rim = vec3(0.4, 0.7, 1.0) * pow(fre, 3.0) * ao;

    col = ambient + diffuse + specular + rim;
  }

  // Gamma correction
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`
}

/**
 * Compile SDF tree to full production WGSL raymarching shader.
 */
export function compileSdfToWgsl(root: SdfTreeNode, options: SdfCompileOptions = {}): string {
  const maxSteps = options.maxSteps ?? 128
  const maxDist = (options.maxDistance ?? 40.0).toFixed(1)
  const hitEps = (options.hitEpsilon ?? 0.001).toFixed(4)
  const color = options.baseColor ?? [0.35, 0.65, 1.0]
  const sdfUni: SdfUniformMap = {}
  const mapExpr = buildDistanceExpr("wgsl", root, sdfUni, "p")
  const sdfFields = Object.keys(sdfUni).map((n) => `  ${n}: f32,`).join("\n")

  return `// ShaderStudio - Visual SDF Procedural Raymarching WGSL Shader
struct Uniforms {
  mvp: mat4x4f,
  time: f32,
  color: vec3f,
  resolution: vec2f,
  padding: vec2f,
${sdfFields}
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(input.position.xy, 0.0, 1.0);
  output.uv = input.position.xy * 0.5 + 0.5;
  return output;
}

${WGSL_SDF_PRIMITIVES_LIB}
${WGSL_SDF_OPERATORS_LIB}

fn map(p: vec3f) -> f32 {
  return ${mapExpr};
}

fn calcNormal(p: vec3f) -> vec3f {
  let h = 0.0005;
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * h) +
    k.yyx * map(p + k.yyx * h) +
    k.yxy * map(p + k.yxy * h) +
    k.xxx * map(p + k.xxx * h)
  );
}

fn calcSoftShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32) -> f32 {
  var res: f32 = 1.0;
  var t: f32 = mint;
  for (var i = 0; i < 32 && t < maxt; i++) {
    let h = map(ro + rd * t);
    if (h < ${hitEps}) { return 0.0; }
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.2);
  }
  return clamp(res, 0.0, 1.0);
}

fn calcAO(pos: vec3f, nor: vec3f) -> f32 {
  var occ: f32 = 0.0;
  var sca: f32 = 1.0;
  for (var i = 0; i < 5; i++) {
    let h = 0.01 + 0.12 * f32(i) / 4.0;
    let d = map(pos + h * nor);
    occ += (h - d) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let uv = (input.uv - 0.5) * 2.0;

  // Orbit camera around target
  let camDist = 3.8;
  let camAngle = uniforms.time * 0.4;
  let ro = vec3f(camDist * sin(camAngle), 1.8, camDist * cos(camAngle));
  let ta = vec3f(0.0, 0.0, 0.0);
  let ww = normalize(ta - ro);
  let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
  let vv = cross(uu, ww);
  let rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

  var t: f32 = 0.01;
  var hit: bool = false;
  for (var i = 0; i < ${maxSteps}; i++) {
    let p = ro + rd * t;
    let d = map(p);
    if (d < ${hitEps}) {
      hit = true;
      break;
    }
    if (t > ${maxDist}) { break; }
    t += d;
  }

  var col = vec3f(0.06, 0.07, 0.1);
  if (hit) {
    let pos = ro + rd * t;
    let nor = calcNormal(pos);
    let ref = reflect(rd, nor);

    let lightDir = normalize(vec3f(0.8, 1.2, 0.9));
    let diff = max(dot(nor, lightDir), 0.0);
    let spec = pow(max(dot(ref, lightDir), 0.0), 32.0);
    let fre = clamp(1.0 + dot(rd, nor), 0.0, 1.0);
    let shadow = calcSoftShadow(pos + nor * 0.01, lightDir, 0.02, 10.0, 16.0);
    let ao = calcAO(pos, nor);

    let baseCol = select(vec3f(${color[0].toFixed(3)}, ${color[1].toFixed(3)}, ${color[2].toFixed(3)}), uniforms.color, length(uniforms.color) > 0.01);
    let ambient = vec3f(0.08, 0.10, 0.14) * ao;
    let diffuse = baseCol * diff * shadow;
    let specular = vec3f(1.0, 0.95, 0.9) * spec * shadow;
    let rim = vec3f(0.4, 0.7, 1.0) * pow(fre, 3.0) * ao;

    col = ambient + diffuse + specular + rim;
  }

  return vec4f(pow(col, vec3f(0.4545)), 1.0);
}
`
}
