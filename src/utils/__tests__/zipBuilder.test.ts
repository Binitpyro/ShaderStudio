import { describe, it, expect } from "vitest"
import { createZipArchive, calculateCrc32 } from "../zipBuilder"

describe("ZipBuilder (PKZIP 2.0)", () => {
  it("computes accurate CRC32 checksums", () => {
    const text = new TextEncoder().encode("Hello World")
    const crc = calculateCrc32(text)
    expect(crc).toBe(0x4a17b156)
  })

  it("builds a valid PKZIP file structure with local and central headers", () => {
    const file1Data = new TextEncoder().encode("Albedo Map Data")
    const file2Data = new TextEncoder().encode("Normal Map Data")

    const zipBytes = createZipArchive([
      { name: "albedo.png", data: file1Data },
      { name: "normal.png", data: file2Data },
    ])

    expect(zipBytes.length).toBeGreaterThan(0)

    const view = new DataView(zipBytes.buffer)
    // Check first local header signature: 0x04034b50
    expect(view.getUint32(0, true)).toBe(0x04034b50)

    // Check EOCD signature at the end (22 bytes before EOF): 0x06054b50
    const eocdOffset = zipBytes.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)

    // Check total records = 2
    expect(view.getUint16(eocdOffset + 10, true)).toBe(2)
  })
})
