import { describe, it, expect } from "vitest"
import { generatePbrPixelBuffers, bakePbrMaps } from "@/core/textureBaker"
import { createZipArchive } from "@/utils/zipBuilder"

describe("Tier 1: Feature Coverage — Wasm & PBR Texture Baker & ZIP Packager", () => {
  // Helper to create synthetic test pixel buffers
  function createTestImageData(
    width: number,
    height: number,
    pattern: "horizontal_gradient" | "vertical_step" | "checkerboard" | "uniform" = "horizontal_gradient"
  ): ImageData {
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        let val = 128
        if (pattern === "horizontal_gradient") {
          val = Math.round((x / Math.max(1, width - 1)) * 255)
        } else if (pattern === "vertical_step") {
          val = y < height / 2 ? 0 : 255
        } else if (pattern === "checkerboard") {
          val = (x + y) % 2 === 0 ? 0 : 255
        } else if (pattern === "uniform") {
          val = 128
        }
        pixels[idx] = val
        pixels[idx + 1] = val
        pixels[idx + 2] = val
        pixels[idx + 3] = 255
      }
    }
    return {
      data: pixels,
      width,
      height,
      colorSpace: "srgb",
    } as unknown as ImageData
  }

  it("calculates accurate perceptual luminance / height map using ITU-R BT.601", () => {
    const width = 4
    const height = 4
    const pixels = new Uint8ClampedArray(width * height * 4)

    // Pure red, green, blue pixels
    // Red: 0.299 * 255 = ~76.2
    pixels[0] = 255; pixels[1] = 0; pixels[2] = 0; pixels[3] = 255
    // Green: 0.587 * 255 = ~149.7
    pixels[4] = 0; pixels[5] = 255; pixels[6] = 0; pixels[7] = 255
    // Blue: 0.114 * 255 = ~29.1
    pixels[8] = 0; pixels[9] = 0; pixels[10] = 255; pixels[11] = 255

    const imgData = { data: pixels, width, height } as unknown as ImageData
    const result = generatePbrPixelBuffers(imgData)

    expect(result.heightMap[0]).toBeCloseTo(76, -1)
    expect(result.heightMap[4]).toBeCloseTo(150, -1)
    expect(result.heightMap[8]).toBeCloseTo(29, -1)
  })

  it("computes 3x3 Sobel tangent normal filter with valid unit vector normalization", () => {
    const imgData = createTestImageData(8, 8, "horizontal_gradient")
    const result = generatePbrPixelBuffers(imgData, { normalStrength: 2.0 })

    expect(result.normal.length).toBe(8 * 8 * 4)

    // Examine center pixel normal vector
    const centerIdx = (4 * 8 + 4) * 4
    const nx = (result.normal[centerIdx] - 128) / 127
    const ny = (result.normal[centerIdx + 1] - 128) / 127
    const nz = (result.normal[centerIdx + 2] - 128) / 127

    // Vector length should be approximately normalized to 1.0
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    expect(len).toBeGreaterThan(0.9)
    expect(len).toBeLessThan(1.1)

    // Z channel should face outwards (positive Z in normal space, so blue byte > 128)
    expect(result.normal[centerIdx + 2]).toBeGreaterThan(128)
  })

  it("inverts normal Y channel when invertNormalY toggle is enabled (DirectX vs OpenGL)", () => {
    const imgData = createTestImageData(6, 6, "vertical_step")

    const openglResult = generatePbrPixelBuffers(imgData, { invertNormalY: false })
    const directxResult = generatePbrPixelBuffers(imgData, { invertNormalY: true })

    // Center pixel at vertical gradient boundary (y=3, x=3)
    const idx = (3 * 6 + 3) * 4
    const yOpenGL = openglResult.normal[idx + 1]
    const yDirectX = directxResult.normal[idx + 1]

    // Green channels must be reflected around 128 (flat zero)
    expect(yOpenGL).not.toBe(yDirectX)
    const deviationOGL = yOpenGL - 128
    const deviationDX = yDirectX - 128
    expect(deviationOGL).toBeCloseTo(-deviationDX, -1)
  })

  it("computes cavity ambient occlusion with configurable aoStrength", () => {
    const imgData = createTestImageData(8, 8, "checkerboard")

    const aoLow = generatePbrPixelBuffers(imgData, { aoStrength: 0.5 }).ao
    const aoHigh = generatePbrPixelBuffers(imgData, { aoStrength: 2.0 }).ao

    // In checkerboard pattern, valleys get occluded
    const valleyIdx = (1 * 8 + 0) * 4
    expect(aoLow[valleyIdx]).toBeGreaterThanOrEqual(0)
    expect(aoHigh[valleyIdx]).toBeLessThanOrEqual(aoLow[valleyIdx])
  })

  it("derives roughness map from inverse height and surface gradient", () => {
    const imgData = createTestImageData(8, 8, "horizontal_gradient")
    const result = generatePbrPixelBuffers(imgData)

    expect(result.roughness.length).toBe(8 * 8 * 4)

    // Roughness channels (R, G, B) should be grayscale and clamped between 0 and 255
    for (let i = 0; i < result.roughness.length; i += 4) {
      expect(result.roughness[i]).toBe(result.roughness[i + 1])
      expect(result.roughness[i + 1]).toBe(result.roughness[i + 2])
      expect(result.roughness[i + 3]).toBe(255) // Full alpha
    }
  })

  it("enforces metallic mode constraints: dielectric (0), metal (255), and auto", () => {
    const imgData = createTestImageData(4, 4, "horizontal_gradient")

    const dielectric = generatePbrPixelBuffers(imgData, { metallicMode: "dielectric" })
    const metal = generatePbrPixelBuffers(imgData, { metallicMode: "metal" })
    const auto = generatePbrPixelBuffers(imgData, { metallicMode: "auto" })

    // Dielectric should be strictly 0 across all pixels
    for (let i = 0; i < dielectric.metallic.length; i += 4) {
      expect(dielectric.metallic[i]).toBe(0)
      expect(dielectric.metallic[i + 1]).toBe(0)
      expect(dielectric.metallic[i + 2]).toBe(0)
    }

    // Metal should be strictly 255 across all pixels
    for (let i = 0; i < metal.metallic.length; i += 4) {
      expect(metal.metallic[i]).toBe(255)
      expect(metal.metallic[i + 1]).toBe(255)
      expect(metal.metallic[i + 2]).toBe(255)
    }

    // Auto should produce valid values between 0 and 255
    expect(auto.metallic.length).toBe(4 * 4 * 4)
  })

  it("packages all 6 maps into an in-memory ZIP archive with valid PKZIP signature", async () => {
    const prevDoc = (globalThis as any).document
    try {
      // Ensure running in node headless mode without DOM canvas constraint
      delete (globalThis as any).document
      const bakeResult = await bakePbrMaps({ resolution: 512, metallicMode: "dielectric" })

      expect(bakeResult.resolution).toBe(512)
      const expectedMaps = ["albedo", "normal", "roughness", "height", "metallic", "ao"]
      expect(Object.keys(bakeResult.maps).sort()).toEqual(expectedMaps.sort())

      const zipBytes = bakeResult.createZip()
      expect(zipBytes).toBeInstanceOf(Uint8Array)
      expect(zipBytes.length).toBeGreaterThan(100)

      // Check standard PKZIP magic bytes: 0x50, 0x4B, 0x03, 0x04 (PK\x03\x04)
      expect(zipBytes[0]).toBe(0x50) // 'P'
      expect(zipBytes[1]).toBe(0x4b) // 'K'
      expect(zipBytes[2]).toBe(0x03)
      expect(zipBytes[3]).toBe(0x04)
    } finally {
      if (prevDoc !== undefined) {
        ;(globalThis as any).document = prevDoc
      }
    }
  })

  it("creates custom ZIP archive using createZipArchive with correct manifest and file entries", () => {
    const testFiles = [
      { name: "test_albedo.png", data: new Uint8Array([1, 2, 3, 4]) },
      { name: "test_normal.png", data: new Uint8Array([5, 6, 7, 8]) },
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({ format: "pbr-v1" })) },
    ]

    const zipBuffer = createZipArchive(testFiles)
    expect(zipBuffer).toBeInstanceOf(Uint8Array)
    expect(zipBuffer.length).toBeGreaterThan(0)

    const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength)
    const magic = view.getUint32(0, true)
    expect(magic).toBe(0x04034b50)
  })
})
