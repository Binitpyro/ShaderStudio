import { describe, it, expect } from "vitest"
import { NODE_PALETTE_ITEMS } from "../NodePaletteModal"

describe("NodePaletteModal Catalog & Definitions", () => {
  it("contains rich node definitions across all key categories", () => {
    expect(NODE_PALETTE_ITEMS.length).toBeGreaterThanOrEqual(14)

    const categories = new Set(NODE_PALETTE_ITEMS.map((item) => item.category))
    expect(categories.has("Geometry")).toBe(true)
    expect(categories.has("Shading")).toBe(true)
    expect(categories.has("Post-Processing")).toBe(true)
    expect(categories.has("Dynamics & Audio")).toBe(true)
    expect(categories.has("Output")).toBe(true)
  })

  it("ensures every palette node has unique id and valid default data", () => {
    const ids = NODE_PALETTE_ITEMS.map((item) => item.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)

    for (const item of NODE_PALETTE_ITEMS) {
      expect(item.label).toBeTruthy()
      expect(item.description).toBeTruthy()
      expect(item.type).toBeTruthy()
      expect(item.defaultData.type).toBe(item.type)
      expect(item.icon).toBeDefined()
    }
  })

  it("includes specific creative nodes: bloom, chromatic aberration, compute particles, audio dsp, custom 3D model", () => {
    const ids = NODE_PALETTE_ITEMS.map((item) => item.id)
    expect(ids).toContain("postprocess-bloom")
    expect(ids).toContain("postprocess-aberration")
    expect(ids).toContain("compute-particles")
    expect(ids).toContain("audio-dsp")
    expect(ids).toContain("mesh-custom")
  })
})
