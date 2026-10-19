import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"

export interface ParsedGeometry {
  name: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  vertexCount: number
  triangleCount: number
}

const gltfLoader = new GLTFLoader()
const objLoader = new OBJLoader()

/**
 * Extracts, unifies, and normalizes geometries from a Three.js Object3D hierarchy.
 */
function extractAndNormalizeGeometry(rootObject: THREE.Object3D, modelName: string): ParsedGeometry {
  const geometries: THREE.BufferGeometry[] = []

  rootObject.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) {
        geometries.push(mesh.geometry.clone())
      }
    }
  })

  if (geometries.length === 0) {
    throw new Error("No 3D meshes found in the loaded model.")
  }

  // Combine geometries into a single non-indexed geometry
  const posArrays: number[] = []
  const normArrays: number[] = []
  const uvArrays: number[] = []

  for (const geom of geometries) {
    // Ensure non-indexed for direct triangle rendering across all adapters
    const nonIndexed = geom.index ? geom.toNonIndexed() : geom
    nonIndexed.computeVertexNormals()

    const posAttr = nonIndexed.getAttribute("position")
    const normAttr = nonIndexed.getAttribute("normal")
    const uvAttr = nonIndexed.getAttribute("uv")

    if (posAttr) {
      for (let i = 0; i < posAttr.count; i++) {
        posArrays.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))

        if (normAttr) {
          normArrays.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
        } else {
          normArrays.push(0, 1, 0)
        }

        if (uvAttr) {
          uvArrays.push(uvAttr.getX(i), uvAttr.getY(i))
        } else {
          uvArrays.push(0, 0)
        }
      }
    }
    geom.dispose()
    if (nonIndexed !== geom) nonIndexed.dispose()
  }

  const mergedGeometry = new THREE.BufferGeometry()
  const positions = new Float32Array(posArrays)
  const normals = new Float32Array(normArrays)
  const uvs = new Float32Array(uvArrays)

  mergedGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  mergedGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
  mergedGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))

  // Center around origin
  mergedGeometry.computeBoundingBox()
  mergedGeometry.center()

  // Normalize scale to fit nicely in the viewport (radius ~1.2)
  mergedGeometry.computeBoundingSphere()
  const radius = mergedGeometry.boundingSphere?.radius || 1
  if (radius > 0) {
    const scaleFactor = 1.2 / radius
    mergedGeometry.scale(scaleFactor, scaleFactor, scaleFactor)
  }

  const finalPositions = mergedGeometry.getAttribute("position").array as Float32Array
  const finalNormals = mergedGeometry.getAttribute("normal").array as Float32Array
  const finalUvs = mergedGeometry.getAttribute("uv").array as Float32Array

  const vertexCount = finalPositions.length / 3
  const triangleCount = vertexCount / 3

  mergedGeometry.dispose()

  return {
    name: modelName,
    positions: finalPositions,
    normals: finalNormals,
    uvs: finalUvs,
    vertexCount,
    triangleCount,
  }
}

/**
 * Parses GLTF / GLB binary or JSON from an ArrayBuffer or URL.
 */
export async function parseGLTF(data: ArrayBuffer, name = "model.glb"): Promise<ParsedGeometry> {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(
      data,
      "",
      (gltf) => {
        try {
          const parsed = extractAndNormalizeGeometry(gltf.scene || gltf.scenes[0], name)
          resolve(parsed)
        } catch (e) {
          reject(e)
        }
      },
      (error) => {
        reject(new Error(`Failed to parse GLTF/GLB: ${error.message || String(error)}`))
      }
    )
  })
}

/**
 * Parses Wavefront OBJ from text.
 */
export function parseOBJ(text: string, name = "model.obj"): ParsedGeometry {
  const obj = objLoader.parse(text)
  return extractAndNormalizeGeometry(obj, name)
}

/**
 * High-level parser that inspects file extension / mime type and extracts 3D geometry.
 */
export async function loadModelFile(file: File): Promise<ParsedGeometry> {
  const ext = file.name.split(".").pop()?.toLowerCase()

  if (ext === "glb" || ext === "gltf") {
    const buffer = await file.arrayBuffer()
    return parseGLTF(buffer, file.name)
  }

  if (ext === "obj") {
    const text = await file.text()
    return parseOBJ(text, file.name)
  }

  throw new Error(`Unsupported 3D model format ".${ext}". Please use .glb, .gltf, or .obj.`)
}
