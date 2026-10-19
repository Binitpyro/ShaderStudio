/**
 * Lightweight, zero-dependency ZIP archive generator adhering to the standard
 * PKZIP 2.0 format (STORE method).
 * Perfectly suited for packaging already-compressed PNG texture maps and JSON manifests.
 */

// Precomputed CRC32 table
const crcTable: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

export function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipFileInput {
  name: string
  data: Uint8Array
}

export function createZipArchive(files: ZipFileInput[]): Uint8Array {
  const fileEntries: Array<{
    nameBytes: Uint8Array
    data: Uint8Array
    crc: number
    offset: number
  }> = []

  let totalSize = 0

  // 1. Calculate Local Headers and offsets
  for (const file of files) {
    const encoder = new TextEncoder()
    const nameBytes = encoder.encode(file.name)
    const crc = calculateCrc32(file.data)
    const offset = totalSize
    fileEntries.push({ nameBytes, data: file.data, crc, offset })

    // Local Header: 30 bytes + nameBytes.length + file.data.length
    totalSize += 30 + nameBytes.length + file.data.length
  }

  const centralDirStartOffset = totalSize
  let centralDirSize = 0

  // Central Directory: 46 bytes + nameBytes.length per file
  for (const entry of fileEntries) {
    centralDirSize += 46 + entry.nameBytes.length
  }

  // End of Central Directory (EOCD): 22 bytes
  totalSize += centralDirSize + 22

  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  let cursor = 0

  // 2. Write Local File Headers & Data
  for (const entry of fileEntries) {
    // Signature 0x04034b50
    view.setUint32(cursor, 0x04034b50, true); cursor += 4
    view.setUint16(cursor, 20, true); cursor += 2 // Version needed (2.0)
    view.setUint16(cursor, 0, true); cursor += 2  // General purpose flag
    view.setUint16(cursor, 0, true); cursor += 2  // Compression method (0 = STORE)
    view.setUint16(cursor, 0, true); cursor += 2  // File mod time
    view.setUint16(cursor, 0, true); cursor += 2  // File mod date
    view.setUint32(cursor, entry.crc, true); cursor += 4
    view.setUint32(cursor, entry.data.length, true); cursor += 4 // Compressed size
    view.setUint32(cursor, entry.data.length, true); cursor += 4 // Uncompressed size
    view.setUint16(cursor, entry.nameBytes.length, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2  // Extra field length

    out.set(entry.nameBytes, cursor); cursor += entry.nameBytes.length
    out.set(entry.data, cursor); cursor += entry.data.length
  }

  // 3. Write Central Directory Headers
  for (const entry of fileEntries) {
    // Signature 0x02014b50
    view.setUint32(cursor, 0x02014b50, true); cursor += 4
    view.setUint16(cursor, 20, true); cursor += 2 // Version made by
    view.setUint16(cursor, 20, true); cursor += 2 // Version needed
    view.setUint16(cursor, 0, true); cursor += 2  // Flag
    view.setUint16(cursor, 0, true); cursor += 2  // Compression method (STORE)
    view.setUint16(cursor, 0, true); cursor += 2  // Mod time
    view.setUint16(cursor, 0, true); cursor += 2  // Mod date
    view.setUint32(cursor, entry.crc, true); cursor += 4
    view.setUint32(cursor, entry.data.length, true); cursor += 4
    view.setUint32(cursor, entry.data.length, true); cursor += 4
    view.setUint16(cursor, entry.nameBytes.length, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2  // Extra field length
    view.setUint16(cursor, 0, true); cursor += 2  // Comment length
    view.setUint16(cursor, 0, true); cursor += 2  // Disk start
    view.setUint16(cursor, 0, true); cursor += 2  // Internal attributes
    view.setUint32(cursor, 0, true); cursor += 4  // External attributes
    view.setUint32(cursor, entry.offset, true); cursor += 4 // Relative offset of local header

    out.set(entry.nameBytes, cursor); cursor += entry.nameBytes.length
  }

  // 4. Write End of Central Directory Record (EOCD)
  // Signature 0x06054b50
  view.setUint32(cursor, 0x06054b50, true); cursor += 4
  view.setUint16(cursor, 0, true); cursor += 2 // Disk number
  view.setUint16(cursor, 0, true); cursor += 2 // Central dir start disk
  view.setUint16(cursor, files.length, true); cursor += 2 // Records on this disk
  view.setUint16(cursor, files.length, true); cursor += 2 // Total records
  view.setUint32(cursor, centralDirSize, true); cursor += 4 // Central dir size
  view.setUint32(cursor, centralDirStartOffset, true); cursor += 4 // Central dir offset
  view.setUint16(cursor, 0, true); cursor += 2 // Comment length

  return out
}
