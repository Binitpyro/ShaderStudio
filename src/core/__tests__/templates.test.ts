import { describe, it, expect } from "vitest"
import { SHADER_TEMPLATES } from "../templates"

describe("SHADER_TEMPLATES", () => {
  it("contains at least 6 production-grade curated templates", () => {
    expect(SHADER_TEMPLATES.length).toBeGreaterThanOrEqual(6)
  })

  it("has unique IDs for every template", () => {
    const ids = SHADER_TEMPLATES.map((t) => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it("verifies every template has required fields and non-empty shaders", () => {
    const validCategories = ["Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized", "Raymarching & SDF"]
    const validGeometries = ["sphere", "torus_knot", "plane", "cube"]

    for (const tmpl of SHADER_TEMPLATES) {
      expect(tmpl.id).toBeTruthy()
      expect(tmpl.name).toBeTruthy()
      expect(validCategories).toContain(tmpl.category)
      expect(tmpl.description).toBeTruthy()
      expect(["threejs", "webgl2", "webgpu"]).toContain(tmpl.backend)
      expect(validGeometries).toContain(tmpl.geometry)
      expect(tmpl.shaderSource.trim().length).toBeGreaterThan(100)
      expect(typeof tmpl.uniforms).toBe("object")
    }
  })

  it("ensures each template includes valid uniform values", () => {
    for (const tmpl of SHADER_TEMPLATES) {
      for (const [key, val] of Object.entries(tmpl.uniforms)) {
        expect(key.startsWith("u_")).toBe(true)
        if (typeof val === "number") {
          expect(Number.isFinite(val)).toBe(true)
        } else if (Array.isArray(val)) {
          expect(val.length).toBeGreaterThanOrEqual(2)
          val.forEach((n) => expect(typeof n).toBe("number"))
        } else if (typeof val === "boolean") {
          expect(typeof val).toBe("boolean")
        }
      }
    }
  })

  it("includes specific iconic presets: holographic shield, solar plasma, synthwave, liquid metal, caustics, nebula", () => {
    const ids = SHADER_TEMPLATES.map((t) => t.id)
    expect(ids).toContain("holographic-shield")
    expect(ids).toContain("solar-plasma-orb")
    expect(ids).toContain("synthwave-grid")
    expect(ids).toContain("liquid-metal-iridescence")
    expect(ids).toContain("ocean-caustics")
    expect(ids).toContain("cosmic-nebula")
  })
})
