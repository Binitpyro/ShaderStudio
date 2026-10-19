import { describe, it, expect, beforeEach } from "vitest"
import { customModelRegistry } from "../customModelRegistry"
import { parseOBJ } from "../modelLoader"

describe("Custom Model & Registry", () => {
  beforeEach(() => {
    customModelRegistry.clearActiveModel()
  })

  it("stores and clears active custom model in registry", () => {
    expect(customModelRegistry.getActiveModel()).toBeNull()
    expect(customModelRegistry.hasCustomModel()).toBe(false)

    const sampleModel = {
      name: "test.obj",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      vertexCount: 3,
      triangleCount: 1,
    }

    customModelRegistry.setActiveModel(sampleModel)
    expect(customModelRegistry.getActiveModel()).toEqual(sampleModel)
    expect(customModelRegistry.hasCustomModel()).toBe(true)

    customModelRegistry.clearActiveModel()
    expect(customModelRegistry.getActiveModel()).toBeNull()
    expect(customModelRegistry.hasCustomModel()).toBe(false)
  })

  it("notifies subscribers when active model changes", () => {
    const received: Array<string | null> = []
    const unsubscribe = customModelRegistry.subscribe((m) => {
      received.push(m ? m.name : null)
    })

    const modelA = {
      name: "modelA.obj",
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      uvs: new Float32Array(6),
      vertexCount: 3,
      triangleCount: 1,
    }

    customModelRegistry.setActiveModel(modelA)
    customModelRegistry.clearActiveModel()
    unsubscribe()

    customModelRegistry.setActiveModel({
      ...modelA,
      name: "modelB.obj",
    })

    expect(received).toEqual(["modelA.obj", null])
  })

  it("parses wavefront OBJ text, computes normals, and normalizes scale and center", () => {
    const simpleObj = `
v -1.0 -1.0 0.0
v 1.0 -1.0 0.0
v 0.0 1.0 0.0
f 1 2 3
`
    const parsed = parseOBJ(simpleObj, "triangle.obj")
    expect(parsed.name).toBe("triangle.obj")
    expect(parsed.vertexCount).toBe(3)
    expect(parsed.triangleCount).toBe(1)
    expect(parsed.positions.length).toBe(9)
    expect(parsed.normals.length).toBe(9)
    expect(parsed.uvs.length).toBe(6)

    // Center check: Y coordinates should be centered around origin
    const yValues = [parsed.positions[1], parsed.positions[4], parsed.positions[7]]
    const minY = Math.min(...yValues)
    const maxY = Math.max(...yValues)
    expect(Math.abs((minY + maxY) / 2)).toBeLessThan(0.01)
  })
})
