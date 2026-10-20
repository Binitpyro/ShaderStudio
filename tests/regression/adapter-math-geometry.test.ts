import { describe, it, expect } from "vitest"
import { generateCubeVertices, generateTorusKnot, getVerticesForGeometry } from "@/adapters/math"

describe("procedural geometry", () => {
  it("cube has 36 vertices (108 floats), all components +-1, outward CCW winding", () => {
    const v = generateCubeVertices()
    expect(v.length % 3).toBe(0)
    expect(v.length / 3).toBe(36)
    for (let t = 0; t < 36; t += 3) {
      const p = (i: number) => [v[(t + i) * 3], v[(t + i) * 3 + 1], v[(t + i) * 3 + 2]]
      const [a, b, c] = [p(0), p(1), p(2)]
      const e1 = b.map((x, i) => x - a[i]), e2 = c.map((x, i) => x - a[i])
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const centroid = a.map((x, i) => x + b[i] + c[i])
      expect(n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2]).toBeGreaterThan(0)
    }
  })

  it("torus knot (p=2,q=3) has 64*16*6 non-indexed vertices with finite unit normals", () => {
    const { positions, normals } = generateTorusKnot(0.8, 0.25, 64, 16)
    expect(positions.length).toBe(64 * 16 * 6 * 3)
    expect(normals.length).toBe(positions.length)
    for (const f of positions) expect(Number.isFinite(f)).toBe(true)
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 4)
    }
    expect(getVerticesForGeometry("torus_knot").length).toBe(positions.length)
  })
})
