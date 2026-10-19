export type LodLevel = "lod0" | "lod1" | "lod2"

export interface MeshLodCounts {
  lod0: number
  lod1: number
  lod2: number
}

export interface LodDistanceThresholds {
  lod0Dist: number
  lod1Dist: number
}

export const DEFAULT_LOD_THRESHOLDS: LodDistanceThresholds = {
  lod0Dist: 10,
  lod1Dist: 30,
}

/**
 * Calculates vertex/polygon counts for 3 levels of detail:
 * - LOD 0: 100% detail (vertexCount)
 * - LOD 1: 50% detail (floor(vertexCount * 0.5))
 * - LOD 2: 25% detail (floor(vertexCount * 0.25))
 */
export function generateMeshLods(vertexCount: number): MeshLodCounts {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(vertexCount) ? vertexCount : 0))
  return {
    lod0: safeCount,
    lod1: Math.floor(safeCount * 0.5),
    lod2: Math.floor(safeCount * 0.25),
  }
}

/**
 * Selects an appropriate LOD level based on distance from the camera:
 * - distance <= thresholds.lod0Dist: "lod0"
 * - distance <= thresholds.lod1Dist: "lod1"
 * - distance > thresholds.lod1Dist: "lod2"
 */
export function selectLodByDistance(
  distance: number,
  thresholds: LodDistanceThresholds = DEFAULT_LOD_THRESHOLDS
): LodLevel {
  if (distance === Infinity || distance > thresholds.lod1Dist) {
    return "lod2"
  }
  const safeDist = Math.max(0, Number.isNaN(distance) ? 0 : distance)
  if (safeDist <= thresholds.lod0Dist) {
    return "lod0"
  }
  return "lod1"
}

/**
 * Decimates vertex positions Float32Array buffer according to the requested LOD level.
 * @param positions Interleaved or contiguous vertex position coordinates (e.g. [x, y, z])
 * @param targetLod The target level of detail
 * @param stride Number of floats per vertex (default 3: x, y, z)
 */
export function decimateGeometryBuffer(
  positions: Float32Array,
  targetLod: LodLevel,
  stride = 3
): Float32Array {
  if (targetLod === "lod0" || stride <= 0) {
    return new Float32Array(positions)
  }

  const totalVertices = Math.floor(positions.length / stride)
  if (totalVertices <= 4) {
    return new Float32Array(positions)
  }

  const step = targetLod === "lod1" ? 2 : 4
  const targetVertices = Math.max(1, Math.floor(totalVertices / step))
  const decimated = new Float32Array(targetVertices * stride)

  for (let i = 0; i < targetVertices; i++) {
    const srcIndex = i * step * stride
    const dstIndex = i * stride
    for (let s = 0; s < stride; s++) {
      decimated[dstIndex + s] = positions[srcIndex + s]
    }
  }

  return decimated
}

/**
 * Decimates indexed triangle buffer according to requested LOD level.
 */
export function decimateIndices(
  indices: Uint16Array | Uint32Array,
  targetLod: LodLevel
): Uint16Array | Uint32Array {
  if (targetLod === "lod0") {
    return indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices)
  }

  const totalTriangles = Math.floor(indices.length / 3)
  if (totalTriangles <= 2) {
    return indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices)
  }

  const step = targetLod === "lod1" ? 2 : 4
  const targetTriangles = Math.max(1, Math.floor(totalTriangles / step))
  const decimated = indices instanceof Uint16Array
    ? new Uint16Array(targetTriangles * 3)
    : new Uint32Array(targetTriangles * 3)

  for (let t = 0; t < targetTriangles; t++) {
    const src = t * step * 3
    const dst = t * 3
    decimated[dst] = indices[src]
    decimated[dst + 1] = indices[src + 1]
    decimated[dst + 2] = indices[src + 2]
  }

  return decimated
}
