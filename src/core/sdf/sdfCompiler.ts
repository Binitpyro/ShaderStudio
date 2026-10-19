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

/**
 * Generate recursive GLSL distance expression for an SDF tree node.
 */
function buildGlslDistanceExpr(node: SdfTreeNode, pVar: string = "p"): string {
  if (node.kind === "primitive") {
    const off = node.params.offset ?? [0, 0, 0]
    const hasOffset = off[0] !== 0 || off[1] !== 0 || off[2] !== 0
    const localP = hasOffset
      ? `(${pVar} - vec3(${off[0].toFixed(4)}, ${off[1].toFixed(4)}, ${off[2].toFixed(4)}))`
      : pVar

    switch (node.type) {
      case "sphere":
        return `sdSphere(${localP}, ${(node.params.radius ?? 1.0).toFixed(4)})`

      case "box": {
        const b = node.params.size ?? [0.8, 0.8, 0.8]
        return `sdBox(${localP}, vec3(${b[0].toFixed(4)}, ${b[1].toFixed(4)}, ${b[2].toFixed(4)}))`
      }

      case "torus": {
        const R = (node.params.majorRadius ?? 1.0).toFixed(4)
        const r = (node.params.minorRadius ?? 0.35).toFixed(4)
        return `sdTorus(${localP}, vec2(${R}, ${r}))`
      }

      case "cylinder": {
        const r = (node.params.radius ?? 0.7).toFixed(4)
        const h = (node.params.height ?? 1.0).toFixed(4)
        return `sdCylinder(${localP}, vec2(${r}, ${h}))`
      }

      case "capsule": {
        const a = node.params.capsuleA ?? [0, -0.6, 0]
        const b = node.params.capsuleB ?? [0, 0.6, 0]
        const r = (node.params.radius ?? 0.4).toFixed(4)
        const aStr = `vec3(${a[0].toFixed(4)}, ${a[1].toFixed(4)}, ${a[2].toFixed(4)})`
        const bStr = `vec3(${b[0].toFixed(4)}, ${b[1].toFixed(4)}, ${b[2].toFixed(4)})`
        return `sdCapsule(${localP}, ${aStr}, ${bStr}, ${r})`
      }

      case "plane": {
        const n = node.params.planeNormal ?? [0, 1, 0]
        const h = (node.params.planeDistance ?? 0.0).toFixed(4)
        const nStr = `vec3(${n[0].toFixed(4)}, ${n[1].toFixed(4)}, ${n[2].toFixed(4)})`
        return `sdPlane(${localP}, ${nStr}, ${h})`
      }

      default:
        return `sdSphere(${localP}, 1.0)`
    }
  }

  // Operator
  const k = (node.params.smoothness ?? 0.2).toFixed(4)
  const childA = node.children[0]
  const childB = node.children[1]

  if (node.type === "repetition") {
    const c = node.params.repetitionSpacing ?? [3.0, 3.0, 3.0]
    const repVar = `opRep(${pVar}, vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)}))`
    return childA ? buildGlslDistanceExpr(childA, repVar) : `sdSphere(${repVar}, 0.5)`
  }

  if (node.type === "twist") {
    const rate = (node.params.twistRate ?? 1.0).toFixed(4)
    const twistVar = `opTwist(${pVar}, ${rate})`
    return childA ? buildGlslDistanceExpr(childA, twistVar) : `sdSphere(${twistVar}, 0.5)`
  }

  const exprA = childA ? buildGlslDistanceExpr(childA, pVar) : "100.0"
  const exprB = childB ? buildGlslDistanceExpr(childB, pVar) : "100.0"

  switch (node.type) {
    case "union":
      return `opUnion(${exprA}, ${exprB})`
    case "smooth_union":
      return `opSmoothUnion(${exprA}, ${exprB}, ${k})`
    case "subtraction":
      return `opSubtraction(${exprA}, ${exprB})`
    case "smooth_subtraction":
      return `opSmoothSubtraction(${exprA}, ${exprB}, ${k})`
    case "intersection":
      return `opIntersection(${exprA}, ${exprB})`
    case "smooth_intersection":
      return `opSmoothIntersection(${exprA}, ${exprB}, ${k})`
    default:
      return `opUnion(${exprA}, ${exprB})`
  }
}

/**
 * Generate recursive WGSL distance expression for an SDF tree node.
 */
function buildWgslDistanceExpr(node: SdfTreeNode, pVar: string = "p"): string {
  if (node.kind === "primitive") {
    const off = node.params.offset ?? [0, 0, 0]
    const hasOffset = off[0] !== 0 || off[1] !== 0 || off[2] !== 0
    const localP = hasOffset
      ? `(${pVar} - vec3f(${off[0].toFixed(4)}, ${off[1].toFixed(4)}, ${off[2].toFixed(4)}))`
      : pVar

    switch (node.type) {
      case "sphere":
        return `sdSphere(${localP}, ${(node.params.radius ?? 1.0).toFixed(4)})`

      case "box": {
        const b = node.params.size ?? [0.8, 0.8, 0.8]
        return `sdBox(${localP}, vec3f(${b[0].toFixed(4)}, ${b[1].toFixed(4)}, ${b[2].toFixed(4)}))`
      }

      case "torus": {
        const R = (node.params.majorRadius ?? 1.0).toFixed(4)
        const r = (node.params.minorRadius ?? 0.35).toFixed(4)
        return `sdTorus(${localP}, vec2f(${R}, ${r}))`
      }

      case "cylinder": {
        const r = (node.params.radius ?? 0.7).toFixed(4)
        const h = (node.params.height ?? 1.0).toFixed(4)
        return `sdCylinder(${localP}, vec2f(${r}, ${h}))`
      }

      case "capsule": {
        const a = node.params.capsuleA ?? [0, -0.6, 0]
        const b = node.params.capsuleB ?? [0, 0.6, 0]
        const r = (node.params.radius ?? 0.4).toFixed(4)
        const aStr = `vec3f(${a[0].toFixed(4)}, ${a[1].toFixed(4)}, ${a[2].toFixed(4)})`
        const bStr = `vec3f(${b[0].toFixed(4)}, ${b[1].toFixed(4)}, ${b[2].toFixed(4)})`
        return `sdCapsule(${localP}, ${aStr}, ${bStr}, ${r})`
      }

      case "plane": {
        const n = node.params.planeNormal ?? [0, 1, 0]
        const h = (node.params.planeDistance ?? 0.0).toFixed(4)
        const nStr = `vec3f(${n[0].toFixed(4)}, ${n[1].toFixed(4)}, ${n[2].toFixed(4)})`
        return `sdPlane(${localP}, ${nStr}, ${h})`
      }

      default:
        return `sdSphere(${localP}, 1.0)`
    }
  }

  // Operator
  const k = (node.params.smoothness ?? 0.2).toFixed(4)
  const childA = node.children[0]
  const childB = node.children[1]

  if (node.type === "repetition") {
    const c = node.params.repetitionSpacing ?? [3.0, 3.0, 3.0]
    const repVar = `opRep(${pVar}, vec3f(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)}))`
    return childA ? buildWgslDistanceExpr(childA, repVar) : `sdSphere(${repVar}, 0.5)`
  }

  if (node.type === "twist") {
    const rate = (node.params.twistRate ?? 1.0).toFixed(4)
    const twistVar = `opTwist(${pVar}, ${rate})`
    return childA ? buildWgslDistanceExpr(childA, twistVar) : `sdSphere(${twistVar}, 0.5)`
  }

  const exprA = childA ? buildWgslDistanceExpr(childA, pVar) : "100.0"
  const exprB = childB ? buildWgslDistanceExpr(childB, pVar) : "100.0"

  switch (node.type) {
    case "union":
      return `opUnion(${exprA}, ${exprB})`
    case "smooth_union":
      return `opSmoothUnion(${exprA}, ${exprB}, ${k})`
    case "subtraction":
      return `opSubtraction(${exprA}, ${exprB})`
    case "smooth_subtraction":
      return `opSmoothSubtraction(${exprA}, ${exprB}, ${k})`
    case "intersection":
      return `opIntersection(${exprA}, ${exprB})`
    case "smooth_intersection":
      return `opSmoothIntersection(${exprA}, ${exprB}, ${k})`
    default:
      return `opUnion(${exprA}, ${exprB})`
  }
}

/**
 * Compile SDF tree to full production GLSL 300 es raymarching fragment shader.
 */
export function compileSdfToGlsl(root: SdfTreeNode, options: SdfCompileOptions = {}): string {
  const maxSteps = options.maxSteps ?? 128
  const maxDist = (options.maxDistance ?? 40.0).toFixed(1)
  const hitEps = (options.hitEpsilon ?? 0.001).toFixed(4)
  const color = options.baseColor ?? [0.35, 0.65, 1.0]
  const mapExpr = buildGlslDistanceExpr(root, "p")

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
  const mapExpr = buildWgslDistanceExpr(root, "p")

  return `// ShaderStudio - Visual SDF Procedural Raymarching WGSL Shader
struct Uniforms {
  mvp: mat4x4f,
  time: f32,
  color: vec3f,
  resolution: vec2f,
  padding: vec2f,
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
