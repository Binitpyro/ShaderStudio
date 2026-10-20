import { customModelRegistry } from "@/core/customModelRegistry"

export type GeometryKey = "cube" | "sphere" | "plane" | "torus_knot" | "custom"

// 6 faces x 2 tris x 3 verts = 36 vertices (108 floats), CCW when viewed from outside.
const CUBE_FACES: number[][] = [
  [-1,-1,1, 1,-1,1, 1,1,1, -1,1,1],     // +Z
  [1,-1,-1, -1,-1,-1, -1,1,-1, 1,1,-1], // -Z
  [1,-1,1, 1,-1,-1, 1,1,-1, 1,1,1],     // +X
  [-1,-1,-1, -1,-1,1, -1,1,1, -1,1,-1], // -X
  [-1,1,1, 1,1,1, 1,1,-1, -1,1,-1],     // +Y
  [-1,-1,-1, 1,-1,-1, 1,-1,1, -1,-1,1], // -Y
]
export function generateCubeVertices(): Float32Array {
  const out: number[] = []
  for (const f of CUBE_FACES) for (const k of [0, 1, 2, 0, 2, 3]) out.push(f[k * 3], f[k * 3 + 1], f[k * 3 + 2])
  return new Float32Array(out)
}
function generatePlaneVertices(): Float32Array { return new Float32Array([-1,0,-1,1,0,-1,1,0,1,-1,0,-1,1,0,1,-1,0,1]) }
function generateSphereVertices(segments: number = 16): Float32Array {
  const vertices: number[] = []
  for (let lat = 0; lat < segments; lat++) {
    const theta1 = (lat / segments) * Math.PI, theta2 = ((lat + 1) / segments) * Math.PI
    for (let lon = 0; lon < segments; lon++) {
      const phi1 = (lon / segments) * 2 * Math.PI, phi2 = ((lon + 1) / segments) * 2 * Math.PI
      const p1 = spherePoint(theta1, phi1), p2 = spherePoint(theta1, phi2), p3 = spherePoint(theta2, phi2), p4 = spherePoint(theta2, phi1)
      vertices.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4)
    }
  }
  return new Float32Array(vertices)
}
let cachedTorusKnotVertices: Float32Array | null = null
/** Non-indexed torus knot (same construction as three's TorusKnotGeometry): positions + normals, 3 floats/vertex. */
export function generateTorusKnot(radius = 0.8, tube = 0.25, tubularSegments = 64, radialSegments = 16, p = 2, q = 3): { positions: Float32Array; normals: Float32Array } {
  const curve = (u: number): [number, number, number] => {
    const qp = (q / p) * u, cs = Math.cos(qp)
    return [radius * (2 + cs) * 0.5 * Math.cos(u), radius * (2 + cs) * Math.sin(u) * 0.5, radius * Math.sin(qp) * 0.5]
  }
  const nrm = (v: number[]): number[] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
  const crs = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const vp: number[] = [], vn: number[] = []
  for (let i = 0; i <= tubularSegments; i++) {
    const u = (i / tubularSegments) * p * Math.PI * 2
    const P1 = curve(u), P2 = curve(u + 0.01)
    const T = [P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]]
    const B = nrm(crs(T, [P2[0] + P1[0], P2[1] + P1[1], P2[2] + P1[2]]))
    const N = nrm(crs(B, T))
    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2, cx = -tube * Math.cos(v), cy = tube * Math.sin(v)
      const x = P1[0] + cx * N[0] + cy * B[0], y = P1[1] + cx * N[1] + cy * B[1], z = P1[2] + cx * N[2] + cy * B[2]
      vp.push(x, y, z)
      const n = nrm([x - P1[0], y - P1[1], z - P1[2]])
      vn.push(n[0], n[1], n[2])
    }
  }
  const positions: number[] = [], normals: number[] = []
  const w = radialSegments + 1
  const push = (idx: number) => { positions.push(vp[idx * 3], vp[idx * 3 + 1], vp[idx * 3 + 2]); normals.push(vn[idx * 3], vn[idx * 3 + 1], vn[idx * 3 + 2]) }
  for (let j = 1; j <= tubularSegments; j++) for (let i = 1; i <= radialSegments; i++) {
    const a = w * (j - 1) + (i - 1), b = w * j + (i - 1), c = w * j + i, d = w * (j - 1) + i
    push(a); push(b); push(d); push(b); push(c); push(d)
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}
function generateTorusKnotVertices(): Float32Array {
  return (cachedTorusKnotVertices ??= generateTorusKnot().positions)
}
function spherePoint(theta: number, phi: number): [number, number, number] { return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)] }
export function getVerticesForGeometry(geometry: GeometryKey): Float32Array {
  switch (geometry) {
    case "cube": return generateCubeVertices()
    case "sphere": return generateSphereVertices()
    case "plane": return generatePlaneVertices()
    case "torus_knot": return generateTorusKnotVertices()
    case "custom": {
      const custom = customModelRegistry.getActiveModel()
      return custom ? custom.positions : generateTorusKnotVertices()
    }
  }
}
export function setLookAtMatrix(out: Float32Array, eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  const zAxis = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]), xAxis = normalize(cross(up, zAxis)), yAxis = cross(zAxis, xAxis)
  out[0] = xAxis[0]; out[1] = yAxis[0]; out[2] = zAxis[0]; out[3] = 0
  out[4] = xAxis[1]; out[5] = yAxis[1]; out[6] = zAxis[1]; out[7] = 0
  out[8] = xAxis[2]; out[9] = yAxis[2]; out[10] = zAxis[2]; out[11] = 0
  out[12] = -dot(xAxis, eye); out[13] = -dot(yAxis, eye); out[14] = -dot(zAxis, eye); out[15] = 1
  return out
}
export function createLookAtMatrix(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  return setLookAtMatrix(new Float32Array(16), eye, target, up)
}
export function setRotationMatrix(out: Float32Array, angleX: number, angleY: number): Float32Array {
  const cx = Math.cos(angleX), sx = Math.sin(angleX), cy = Math.cos(angleY), sy = Math.sin(angleY)
  out[0] = cy; out[1] = sy * sx; out[2] = -sy * cx; out[3] = 0
  out[4] = 0; out[5] = cx; out[6] = sx; out[7] = 0
  out[8] = sy; out[9] = -cy * sx; out[10] = cy * cx; out[11] = 0
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1
  return out
}
export function createRotationMatrix(angleX: number, angleY: number): Float32Array {
  return setRotationMatrix(new Float32Array(16), angleX, angleY)
}
export function multiplyMatricesInto(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  const a00 = a[0], a01 = a[4], a02 = a[8], a03 = a[12]
  const a10 = a[1], a11 = a[5], a12 = a[9], a13 = a[13]
  const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14]
  const a30 = a[3], a31 = a[7], a32 = a[11], a33 = a[15]

  const b00 = b[0], b01 = b[4], b02 = b[8], b03 = b[12]
  const b10 = b[1], b11 = b[5], b12 = b[9], b13 = b[13]
  const b20 = b[2], b21 = b[6], b22 = b[10], b23 = b[14]
  const b30 = b[3], b31 = b[7], b32 = b[11], b33 = b[15]

  out[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30
  out[1] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30
  out[2] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30
  out[3] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30

  out[4] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31
  out[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31
  out[6] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31
  out[7] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31

  out[8] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32
  out[9] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32
  out[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32
  out[11] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32

  out[12] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33
  out[13] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33
  out[14] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33
  out[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33

  return out
}
export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16)
  return multiplyMatricesInto(result, a, b)
}
function normalize(v: number[]): number[] { const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0] }
function cross(a: number[], b: number[]): number[] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

// ---------------------------------------------------------------------------
// Shared helpers extracted from the adapters (adapters adopt these in W3).
// ---------------------------------------------------------------------------

/** Halton low-discrepancy sequence value in [0, 1) (radical inverse of `index` in `base`). */
export function halton(index: number, base: number): number {
  let result = 0
  let f = 1 / base
  let i = index
  while (i > 0) {
    result += f * (i % base)
    i = Math.floor(i / base)
    f /= base
  }
  return result
}

/** Tags a texture-like object with format/width/height (best effort, tolerates frozen/getter-only objects). */
export function setTexMeta(tex: any, format: string, width: number, height: number): void {
  if (!tex) return
  const define = (key: string, value: unknown) => {
    try {
      Object.defineProperty(tex, key, { value, configurable: true, writable: true })
    } catch {
      try { tex[key] = value } catch { /* read-only */ }
    }
  }
  define("format", format)
  define("width", width)
  define("height", height)
}

/** Right-handed perspective projection, GL clip space (z in [-1, 1]). Used by WebGL2/Three. */
export function setPerspectiveMatrixGL(out: Float32Array, fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far)
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0
  return out
}

/** Right-handed perspective projection, WebGPU clip space (z in [0, 1]). */
export function setPerspectiveMatrixWebGPU(out: Float32Array, fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far)
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
  out[8] = 0; out[9] = 0; out[10] = far * nf; out[11] = -1
  out[12] = 0; out[13] = 0; out[14] = far * near * nf; out[15] = 0
  return out
}
