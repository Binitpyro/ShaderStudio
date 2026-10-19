import { describe, it, expect, beforeEach } from "vitest"
import { parseOBJ, type ParsedGeometry } from "@/core/modelLoader"
import { customModelRegistry } from "@/core/customModelRegistry"

describe("Tier 1: Feature Coverage — 3D Mesh Normalizer", () => {
  beforeEach(() => {
    customModelRegistry.clearActiveModel()
  })

  // Sample pyramid / tetrahedron OBJ
  const samplePyramidObj = `
v 0.0 1.0 0.0
v -1.0 -1.0 1.0
v 1.0 -1.0 1.0
v 1.0 -1.0 -1.0
v -1.0 -1.0 -1.0
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 2 5 4
f 2 4 3
`

  it("parses Wavefront OBJ and returns contiguous Float32Array typed buffers", () => {
    const parsed: ParsedGeometry = parseOBJ(samplePyramidObj, "pyramid.obj")

    expect(parsed.name).toBe("pyramid.obj")
    expect(parsed.positions).toBeInstanceOf(Float32Array)
    expect(parsed.normals).toBeInstanceOf(Float32Array)
    expect(parsed.uvs).toBeInstanceOf(Float32Array)

    expect(parsed.positions.length % 3).toBe(0)
    expect(parsed.normals.length % 3).toBe(0)
    expect(parsed.uvs.length % 2).toBe(0)

    expect(parsed.vertexCount).toBe(parsed.positions.length / 3)
    expect(parsed.triangleCount).toBe(parsed.vertexCount / 3)
  })

  it("centers geometry bounding box around origin (0, 0, 0)", () => {
    // Offset cube far from origin
    const offsetCubeObj = `
v 10.0 10.0 10.0
v 12.0 10.0 10.0
v 12.0 12.0 10.0
v 10.0 12.0 10.0
v 10.0 10.0 12.0
v 12.0 10.0 12.0
v 12.0 12.0 12.0
v 10.0 12.0 12.0
f 1 2 3
f 1 3 4
f 5 6 7
f 5 7 8
`
    const parsed = parseOBJ(offsetCubeObj, "offset_cube.obj")

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (let i = 0; i < parsed.positions.length; i += 3) {
      const x = parsed.positions[i]
      const y = parsed.positions[i + 1]
      const z = parsed.positions[i + 2]

      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    }

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const centerZ = (minZ + maxZ) / 2

    expect(Math.abs(centerX)).toBeLessThan(0.01)
    expect(Math.abs(centerY)).toBeLessThan(0.01)
    expect(Math.abs(centerZ)).toBeLessThan(0.01)
  })

  it("normalizes bounding dimensions to fit viewport target radius (~1.2)", () => {
    const hugeMeshObj = `
v -1000.0 -1000.0 0.0
v 1000.0 -1000.0 0.0
v 0.0 1000.0 0.0
f 1 2 3
`
    const parsed = parseOBJ(hugeMeshObj, "huge.obj")

    let maxRadius = 0
    for (let i = 0; i < parsed.positions.length; i += 3) {
      const x = parsed.positions[i]
      const y = parsed.positions[i + 1]
      const z = parsed.positions[i + 2]
      const dist = Math.sqrt(x * x + y * y + z * z)
      maxRadius = Math.max(maxRadius, dist)
    }

    // Target normalized radius is ~1.2
    expect(maxRadius).toBeCloseTo(1.2, 1)
  })

  it("synthesizes smooth vertex normals when OBJ lacks explicit normal vectors", () => {
    const parsed = parseOBJ(samplePyramidObj, "pyramid.obj")

    expect(parsed.normals.length).toBe(parsed.positions.length)

    // Check that synthesized normals are non-zero unit vectors
    for (let i = 0; i < parsed.normals.length; i += 3) {
      const nx = parsed.normals[i]
      const ny = parsed.normals[i + 1]
      const nz = parsed.normals[i + 2]
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      expect(len).toBeCloseTo(1.0, 1)
    }
  })

  it("registers and propagates custom model through CustomModelRegistry", () => {
    expect(customModelRegistry.getActiveModel()).toBeNull()
    expect(customModelRegistry.hasCustomModel()).toBe(false)

    const parsed = parseOBJ(samplePyramidObj, "pyramid.obj")
    const events: Array<string | null> = []

    const unsubscribe = customModelRegistry.subscribe((model) => {
      events.push(model ? model.name : null)
    })

    customModelRegistry.setActiveModel(parsed)
    expect(customModelRegistry.hasCustomModel()).toBe(true)
    expect(customModelRegistry.getActiveModel()?.name).toBe("pyramid.obj")

    customModelRegistry.clearActiveModel()
    expect(customModelRegistry.hasCustomModel()).toBe(false)
    expect(customModelRegistry.getActiveModel()).toBeNull()

    unsubscribe()
    expect(events).toEqual(["pyramid.obj", null])
  })
})
