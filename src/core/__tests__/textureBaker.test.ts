import { describe, it, expect } from "vitest"
import { generatePbrPixelBuffers, bakePbrMaps } from "../textureBaker"

describe("PBR Texture Baker", () => {
  it("computes accurate height, normal, roughness, metallic, and AO maps from pixel data", () => {
    const width = 4
    const height = 4
    const pixels = new Uint8ClampedArray(width * height * 4)

    // Fill with a horizontal gradient: black on left, white on right
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const val = Math.round((x / (width - 1)) * 255)
        pixels[idx] = val
        pixels[idx + 1] = val
        pixels[idx + 2] = val
        pixels[idx + 3] = 255
      }
    }

    const sourceData = {
      data: pixels,
      width,
      height,
      colorSpace: "srgb",
    } as unknown as ImageData

    const result = generatePbrPixelBuffers(sourceData, {
      normalStrength: 2.0,
      invertNormalY: false,
      metallicMode: "dielectric",
    })

    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
    expect(result.albedo.length).toBe(64)
    expect(result.heightMap.length).toBe(64)
    expect(result.normal.length).toBe(64)
    expect(result.roughness.length).toBe(64)
    expect(result.metallic.length).toBe(64)
    expect(result.ao.length).toBe(64)

    // Leftmost pixel height should be ~0, rightmost should be ~255
    expect(result.heightMap[0]).toBe(0)
    expect(result.heightMap[12]).toBe(255)

    // With horizontal gradient, normal map X channel should deviate from 128 (flat normal)
    // Blue channel (Z) should be positive facing (> 128)
    const midNormalZ = result.normal[2] // Blue channel of pixel (0,0)
    expect(midNormalZ).toBeGreaterThan(128)

    // Dielectric metallic should be strictly 0
    expect(result.metallic[0]).toBe(0)
    expect(result.metallic[12]).toBe(0)
  })

  it("handles invertNormalY flag properly", () => {
    const width = 3
    const height = 3
    const pixels = new Uint8ClampedArray(width * height * 4)

    // Vertical step: top row black, bottom row white
    for (let x = 0; x < width; x++) {
      pixels[(0 * width + x) * 4] = 0
      pixels[(2 * width + x) * 4] = 255
    }

    const sourceData = { data: pixels, width, height } as unknown as ImageData

    const normalOpenGL = generatePbrPixelBuffers(sourceData, { invertNormalY: false }).normal
    const normalDirectX = generatePbrPixelBuffers(sourceData, { invertNormalY: true }).normal

    // The Y component (green channel, idx 1) of the center pixel should invert
    const centerIdx = (1 * width + 1) * 4 + 1
    const yOGL = normalOpenGL[centerIdx]
    const yDX = normalDirectX[centerIdx]
    expect(yOGL).not.toEqual(yDX)
  })

  it("bakes high-level PBR package and generates manifest zip", async () => {
    const bakeResult = await bakePbrMaps({ resolution: 512, metallicMode: "metal" })
    expect(bakeResult.resolution).toBe(512)
    expect(Object.keys(bakeResult.maps)).toEqual([
      "albedo",
      "normal",
      "roughness",
      "height",
      "metallic",
      "ao",
    ])

    const zipBytes = bakeResult.createZip()
    expect(zipBytes.length).toBeGreaterThan(0)
    // Check PKZIP signature
    const view = new DataView(zipBytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
  })
})
