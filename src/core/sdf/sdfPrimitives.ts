/**
 * ShaderStudio - Signed Distance Field (SDF) Primitives
 * High-performance, mathematically rigorous 3D Signed Distance Functions
 * Compatible with GLSL, WGSL, and CPU verification.
 */

export type SdfPrimitiveType = "sphere" | "box" | "torus" | "cylinder" | "capsule" | "plane"

export interface SdfPrimitiveParams {
  type: SdfPrimitiveType
  offset: [number, number, number]
  // Dimensions according to primitive type
  radius?: number                    // Sphere, Cylinder, Capsule
  size?: [number, number, number]    // Box (half-extents)
  majorRadius?: number             // Torus (R)
  minorRadius?: number             // Torus (r)
  height?: number                  // Cylinder (half-height)
  capsuleA?: [number, number, number] // Capsule endpoint A
  capsuleB?: [number, number, number] // Capsule endpoint B
  planeNormal?: [number, number, number] // Plane normal
  planeDistance?: number           // Plane offset
}

export const DEFAULT_PRIMITIVE_PARAMS: Record<SdfPrimitiveType, SdfPrimitiveParams> = {
  sphere: {
    type: "sphere",
    offset: [0, 0, 0],
    radius: 1.0,
  },
  box: {
    type: "box",
    offset: [0, 0, 0],
    size: [0.8, 0.8, 0.8],
  },
  torus: {
    type: "torus",
    offset: [0, 0, 0],
    majorRadius: 1.0,
    minorRadius: 0.35,
  },
  cylinder: {
    type: "cylinder",
    offset: [0, 0, 0],
    radius: 0.7,
    height: 1.0,
  },
  capsule: {
    type: "capsule",
    offset: [0, 0, 0],
    capsuleA: [0, -0.6, 0],
    capsuleB: [0, 0.6, 0],
    radius: 0.4,
  },
  plane: {
    type: "plane",
    offset: [0, -1.0, 0],
    planeNormal: [0, 1, 0],
    planeDistance: 0.0,
  },
}

/**
 * CPU distance evaluator for testing, unit-tests, and live software preview.
 */
export function evaluateSdfPrimitive(
  p: [number, number, number],
  params: SdfPrimitiveParams
): number {
  // Apply translation offset
  const q: [number, number, number] = [
    p[0] - params.offset[0],
    p[1] - params.offset[1],
    p[2] - params.offset[2],
  ]

  switch (params.type) {
    case "sphere": {
      const r = params.radius ?? 1.0
      return Math.hypot(q[0], q[1], q[2]) - r
    }

    case "box": {
      const b = params.size ?? [0.8, 0.8, 0.8]
      const dx = Math.abs(q[0]) - b[0]
      const dy = Math.abs(q[1]) - b[1]
      const dz = Math.abs(q[2]) - b[2]
      const outsideDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0))
      const insideDist = Math.min(Math.max(dx, Math.max(dy, dz)), 0)
      return outsideDist + insideDist
    }

    case "torus": {
      const R = params.majorRadius ?? 1.0
      const r = params.minorRadius ?? 0.35
      const qXZDist = Math.hypot(q[0], q[2]) - R
      return Math.hypot(qXZDist, q[1]) - r
    }

    case "cylinder": {
      const r = params.radius ?? 0.7
      const h = params.height ?? 1.0
      const dRadial = Math.hypot(q[0], q[2]) - r
      const dAxial = Math.abs(q[1]) - h
      const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0))
      const inside = Math.min(Math.max(dRadial, dAxial), 0)
      return outside + inside
    }

    case "capsule": {
      const a = params.capsuleA ?? [0, -0.6, 0]
      const b = params.capsuleB ?? [0, 0.6, 0]
      const r = params.radius ?? 0.4
      const pa: [number, number, number] = [q[0] - a[0], q[1] - a[1], q[2] - a[2]]
      const ba: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const baDotBa = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]
      const paDotBa = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]
      const h = Math.max(0, Math.min(1, baDotBa > 0 ? paDotBa / baDotBa : 0))
      const proj: [number, number, number] = [
        pa[0] - ba[0] * h,
        pa[1] - ba[1] * h,
        pa[2] - ba[2] * h,
      ]
      return Math.hypot(proj[0], proj[1], proj[2]) - r
    }

    case "plane": {
      const n = params.planeNormal ?? [0, 1, 0]
      const len = Math.hypot(n[0], n[1], n[2]) || 1
      const nx = n[0] / len
      const ny = n[1] / len
      const nz = n[2] / len
      const h = params.planeDistance ?? 0.0
      return q[0] * nx + q[1] * ny + q[2] * nz + h
    }

    default:
      return Math.hypot(q[0], q[1], q[2]) - 1.0
  }
}

/**
 * GLSL helper library definitions for primitives.
 */
export const GLSL_SDF_PRIMITIVES_LIB = `
// Signed Distance Field Primitives (Inigo Quilez standard formulations)
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdCylinder(vec3 p, vec2 h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - h;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdPlane(vec3 p, vec3 n, float h) {
  return dot(p, normalize(n)) + h;
}
`

/**
 * WGSL helper library definitions for primitives.
 */
export const WGSL_SDF_PRIMITIVES_LIB = `
// Signed Distance Field Primitives in WGSL
fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sdCylinder(p: vec3f, h: vec2f) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - h;
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn sdPlane(p: vec3f, n: vec3f, h: f32) -> f32 {
  return dot(p, normalize(n)) + h;
}
`
