import { describe, it, expect } from "vitest"
import {
  uvToDirection,
  evaluateEnvironmentRadiance,
  generateEnvironmentRGBA,
  ENVIRONMENT_PRESETS,
  type EnvironmentPreset,
} from "../environmentGenerator"

describe("In-Memory Procedural HDR Environment Generator", () => {
  it("maps equirectangular UVs to normalized 3D spherical direction vectors", () => {
    // Top pole (zenith) v = 0 -> [0, 1, 0]
    const top = uvToDirection(0.5, 0.0)
    expect(top[0]).toBeCloseTo(0, 4)
    expect(top[1]).toBeCloseTo(1, 4)
    expect(top[2]).toBeCloseTo(0, 4)

    // Bottom pole (nadir) v = 1 -> [0, -1, 0]
    const bottom = uvToDirection(0.5, 1.0)
    expect(bottom[0]).toBeCloseTo(0, 4)
    expect(bottom[1]).toBeCloseTo(-1, 4)
    expect(bottom[2]).toBeCloseTo(0, 4)

    // Equator v = 0.5, u = 0.5 -> [0, 0, 1] (+Z)
    const front = uvToDirection(0.5, 0.5)
    expect(front[0]).toBeCloseTo(0, 4)
    expect(front[1]).toBeCloseTo(0, 4)
    expect(front[2]).toBeCloseTo(1, 4)

    // Check unit length
    const len = Math.hypot(front[0], front[1], front[2])
    expect(len).toBeCloseTo(1.0, 5)
  })

  it("evaluates non-negative HDR radiance for all 5 presets across various directions", () => {
    const presets: EnvironmentPreset[] = [
      "studio_warm",
      "cyberpunk_neon",
      "sunset",
      "nebula",
      "clean_neutral",
    ]

    const directions: [number, number, number][] = [
      [0, 1, 0],   // Zenith
      [0, -1, 0],  // Nadir
      [0, 0, 1],   // Front
      [1, 0, 0],   // Right
      [-1, 0, 0],  // Left
      [0.577, 0.577, 0.577], // Diagonal
    ]

    for (const preset of presets) {
      for (const dir of directions) {
        const rad = evaluateEnvironmentRadiance(dir, preset)
        expect(rad.r).toBeGreaterThanOrEqual(0)
        expect(rad.g).toBeGreaterThanOrEqual(0)
        expect(rad.b).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(rad.r)).toBe(true)
        expect(Number.isFinite(rad.g)).toBe(true)
        expect(Number.isFinite(rad.b)).toBe(true)
      }
    }
  })

  it("produces valid RGBA byte buffers with proper dimensions and alpha 255", () => {
    const width = 64
    const height = 32
    const rgba = generateEnvironmentRGBA("studio_warm", width, height)

    expect(rgba.length).toBe(width * height * 4)

    // Verify all alpha channels are 255 and color values are within [0, 255]
    for (let i = 0; i < rgba.length; i += 4) {
      expect(rgba[i]).toBeGreaterThanOrEqual(0)
      expect(rgba[i]).toBeLessThanOrEqual(255)
      expect(rgba[i + 1]).toBeGreaterThanOrEqual(0)
      expect(rgba[i + 1]).toBeLessThanOrEqual(255)
      expect(rgba[i + 2]).toBeGreaterThanOrEqual(0)
      expect(rgba[i + 2]).toBeLessThanOrEqual(255)
      expect(rgba[i + 3]).toBe(255)
    }
  })

  it("contains complete metadata definitions for all standard presets", () => {
    expect(ENVIRONMENT_PRESETS.length).toBe(7)
    const ids = ENVIRONMENT_PRESETS.map((p) => p.id)
    expect(ids).toContain("studio_warm")
    expect(ids).toContain("cyberpunk_neon")
    expect(ids).toContain("sunset")
    expect(ids).toContain("nebula")
    expect(ids).toContain("clean_neutral")
    expect(ids).toContain("daylight")
    expect(ids).toContain("atmosphere")

    for (const p of ENVIRONMENT_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.keyColor.startsWith("#")).toBe(true)
    }
  })
})
