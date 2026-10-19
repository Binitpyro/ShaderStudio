/**
 * ShaderStudio - Signed Distance Field (SDF) Operators
 * High-performance Boolean & Domain deformation operators
 * Compatible with GLSL, WGSL, and CPU verification.
 */

export type SdfOperatorType =
  | "smooth_union"
  | "union"
  | "subtraction"
  | "intersection"
  | "smooth_subtraction"
  | "smooth_intersection"
  | "repetition"
  | "twist"

export interface SdfOperatorParams {
  type: SdfOperatorType
  smoothness?: number                   // k for smooth operations (default: 0.2)
  repetitionSpacing?: [number, number, number] // c for repetition (default: [3, 3, 3])
  twistRate?: number                    // k for twist (default: 1.0)
}

export const DEFAULT_OPERATOR_PARAMS: Record<SdfOperatorType, SdfOperatorParams> = {
  smooth_union: { type: "smooth_union", smoothness: 0.2 },
  union: { type: "union" },
  subtraction: { type: "subtraction" },
  intersection: { type: "intersection" },
  smooth_subtraction: { type: "smooth_subtraction", smoothness: 0.2 },
  smooth_intersection: { type: "smooth_intersection", smoothness: 0.2 },
  repetition: { type: "repetition", repetitionSpacing: [3, 3, 3] },
  twist: { type: "twist", twistRate: 1.0 },
}

/**
 * Polynomial smooth minimum (Inigo Quilez smin).
 */
export function smin(a: number, b: number, k: number = 0.2): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k))
  return (b * (1 - h) + a * h) - k * h * (1 - h)
}

/**
 * Polynomial smooth maximum / subtraction / intersection.
 */
export function smax(a: number, b: number, k: number = 0.2): number {
  if (k <= 0) return Math.max(a, b)
  const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (b - a) / k))
  return (b * (1 - h) + a * h) + k * h * (1 - h)
}

/**
 * CPU distance evaluation for boolean operators.
 */
export function evaluateBooleanOperator(
  op: SdfOperatorType,
  d1: number,
  d2: number,
  smoothness: number = 0.2
): number {
  switch (op) {
    case "union":
      return Math.min(d1, d2)

    case "smooth_union":
      return smin(d1, d2, smoothness)

    case "subtraction":
      return Math.max(-d1, d2)

    case "smooth_subtraction":
      return smax(-d1, d2, smoothness)

    case "intersection":
      return Math.max(d1, d2)

    case "smooth_intersection":
      return smax(d1, d2, smoothness)

    default:
      return Math.min(d1, d2)
  }
}

/**
 * CPU domain deformation operator for coordinates.
 */
export function evaluateDomainOperator(
  op: "repetition" | "twist",
  p: [number, number, number],
  params: SdfOperatorParams
): [number, number, number] {
  switch (op) {
    case "repetition": {
      const c = params.repetitionSpacing ?? [3, 3, 3]
      const mod = (val: number, period: number) => {
        const half = 0.5 * period
        return ((val + half) % period + period) % period - half
      }
      return [mod(p[0], c[0]), mod(p[1], c[1]), mod(p[2], c[2])]
    }

    case "twist": {
      const k = params.twistRate ?? 1.0
      const angle = k * p[1]
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const rx = cos * p[0] - sin * p[2]
      const rz = sin * p[0] + cos * p[2]
      return [rx, p[1], rz]
    }

    default:
      return [p[0], p[1], p[2]]
  }
}

/**
 * GLSL helper library definitions for operators.
 */
export const GLSL_SDF_OPERATORS_LIB = `
// Signed Distance Field Operators
float opUnion(float d1, float d2) {
  return min(d1, d2);
}

float opSubtraction(float d1, float d2) {
  return max(-d1, d2);
}

float opIntersection(float d1, float d2) {
  return max(d1, d2);
}

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float opSmoothSubtraction(float d1, float d2, float k) {
  float h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
  return mix(d2, -d1, h) + k * h * (1.0 - h);
}

float opSmoothIntersection(float d1, float d2, float k) {
  float h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) + k * h * (1.0 - h);
}

vec3 opRepetition(vec3 p, vec3 c) {
  return mod(p + 0.5 * c, c) - 0.5 * c;
}

vec3 opTwist(vec3 p, float k) {
  float c = cos(k * p.y);
  float s = sin(k * p.y);
  mat2 m = mat2(c, -s, s, c);
  return vec3(m * p.xz, p.y).xzy;
}
`

/**
 * WGSL helper library definitions for operators.
 */
export const WGSL_SDF_OPERATORS_LIB = `
// Signed Distance Field Operators in WGSL
fn opUnion(d1: f32, d2: f32) -> f32 {
  return min(d1, d2);
}

fn opSubtraction(d1: f32, d2: f32) -> f32 {
  return max(-d1, d2);
}

fn opIntersection(d1: f32, d2: f32) -> f32 {
  return max(d1, d2);
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

fn opSmoothSubtraction(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
  return mix(d2, -d1, h) + k * h * (1.0 - h);
}

fn opSmoothIntersection(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) + k * h * (1.0 - h);
}

fn opRepetition(p: vec3f, c: vec3f) -> vec3f {
  let halfC = 0.5 * c;
  return ((p + halfC) % c + c) % c - halfC;
}

fn opTwist(p: vec3f, k: f32) -> vec3f {
  let c = cos(k * p.y);
  let s = sin(k * p.y);
  let rx = c * p.x - s * p.z;
  let rz = s * p.x + c * p.z;
  return vec3f(rx, p.y, rz);
}
`
