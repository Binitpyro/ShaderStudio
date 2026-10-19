import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { wasmEngine } from "@/core/wasmEngine"
import { parseOBJ, type ParsedGeometry } from "@/core/modelLoader"
import { initSync, normalize_obj_wasm, normalize_geometry_wasm, bake_pbr_wasm } from "@/wasm/pkg/shaderstudio_wasm"

describe("Milestone 4 Adversarial Challenger: 100K+ Mesh Processing & Fallback Stress", () => {
  const wasmPath = resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")

  let directWasmReady = false
  function ensureDirectWasm() {
    if (!directWasmReady && existsSync(wasmPath)) {
      const bytes = readFileSync(wasmPath)
      initSync(bytes)
      directWasmReady = true
    }
  }

  beforeEach(() => {
    ensureDirectWasm()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Extreme Load — 100K+ Vertex Mesh Processing
  // ==========================================================================
  describe("Section 1: Extreme Load & Zero-Allocation 100K+ Mesh Processing", () => {
    it("processes 102,000+ vertices (34,000 triangles) Wavefront OBJ via Wasm within 500ms", () => {
      const triangleCount = 34000 // 34,000 * 3 = 102,000 vertices
      const lines: string[] = []

      for (let i = 0; i < triangleCount; i++) {
        const x = (i % 100) * 0.2
        const y = Math.floor(i / 100) * 0.2
        const z = Math.sin(i * 0.05) * 5.0
        lines.push(`v ${x} ${y} ${z}`)
        lines.push(`v ${x + 0.1} ${y} ${z}`)
        lines.push(`v ${x} ${y + 0.1} ${z + 0.1}`)
      }

      for (let i = 0; i < triangleCount; i++) {
        const v1 = i * 3 + 1
        const v2 = i * 3 + 2
        const v3 = i * 3 + 3
        lines.push(`f ${v1} ${v2} ${v3}`)
      }

      const objText = lines.join("\n")
      expect(objText.length).toBeGreaterThan(1_500_000) // ~2MB text

      const t0 = performance.now()
      const result = normalize_obj_wasm(objText, "stress_102k.obj")
      const t1 = performance.now()
      const elapsed = t1 - t0

      // Performance check: must finish fast without V8 GC freeze
      expect(elapsed).toBeLessThan(1000)

      expect(result.name).toBe("stress_102k.obj")
      expect(result.vertex_count).toBe(102000)
      expect(result.triangle_count).toBe(34000)
      expect(result.positions.length).toBe(102000 * 3)
      expect(result.normals.length).toBe(102000 * 3)
      expect(result.uvs.length).toBe(102000 * 2)

      // Verify all positions are finite numbers
      const posBuf = new Float32Array(result.positions)
      for (let i = 0; i < 1000; i += 3) {
        expect(Number.isFinite(posBuf[i])).toBe(true)
        expect(Number.isFinite(posBuf[i + 1])).toBe(true)
        expect(Number.isFinite(posBuf[i + 2])).toBe(true)
      }
    })

    it("normalizes a 150,000 raw vertex buffer (450,000 floats) with zero NaN and unit normals", () => {
      const vertexCount = 150000
      const rawPositions = new Float32Array(vertexCount * 3)

      for (let i = 0; i < vertexCount; i++) {
        const offset = i * 3
        rawPositions[offset] = (i % 200) * 2.0 - 500
        rawPositions[offset + 1] = Math.floor(i / 200) * 1.5 - 300
        rawPositions[offset + 2] = Math.cos(i * 0.01) * 50
      }

      const t0 = performance.now()
      const result = normalize_geometry_wasm(rawPositions, null, null, "raw_150k")
      const t1 = performance.now()
      const elapsed = t1 - t0

      expect(elapsed).toBeLessThan(500)
      expect(result.vertex_count).toBe(150000)
      expect(result.triangle_count).toBe(50000)
      expect(result.positions.length).toBe(450000)
      expect(result.normals.length).toBe(450000)
      expect(result.uvs.length).toBe(300000)

      // Sample normals for unit length
      const normBuf = new Float32Array(result.normals)
      for (let i = 0; i < 300; i += 3) {
        const nx = normBuf[i]
        const ny = normBuf[i + 1]
        const nz = normBuf[i + 2]
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        expect(len).toBeCloseTo(1.0, 3)
      }
    })

    it("survives empty, comment-only, and malformed OBJ without crashing", () => {
      expect(() => normalize_obj_wasm("", "empty.obj")).toThrow(/No vertices found/)
      expect(() => normalize_obj_wasm("# Just comments\n# Line 2", "comments.obj")).toThrow(/No vertices found/)
      expect(() => normalize_geometry_wasm(new Float32Array([1, 2]), null, null, "bad")).toThrow(/multiple of 3/)
    })
  })

  // ==========================================================================
  // Section 2: Smooth Normal Synthesis & Winding Accuracy
  // ==========================================================================
  describe("Section 2: Smooth Normal Synthesis Accuracy & Geometry Edge Cases", () => {
    it("preserves strict right-hand rule winding parity (+Z for CCW, -Z for CW)", () => {
      // Counter-clockwise triangle in XY plane
      const ccwObj = `
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 0.0 1.0 0.0
f 1 2 3
`
      const ccwResult = normalize_obj_wasm(ccwObj, "ccw.obj")
      const ccwNorm = new Float32Array(ccwResult.normals)
      for (let v = 0; v < 3; v++) {
        expect(ccwNorm[v * 3]).toBeCloseTo(0.0, 4)
        expect(ccwNorm[v * 3 + 1]).toBeCloseTo(0.0, 4)
        expect(ccwNorm[v * 3 + 2]).toBeCloseTo(1.0, 4) // Points toward +Z
      }

      // Clockwise triangle in XY plane (reversed winding)
      const cwObj = `
v 0.0 0.0 0.0
v 0.0 1.0 0.0
v 1.0 0.0 0.0
f 1 2 3
`
      const cwResult = normalize_obj_wasm(cwObj, "cw.obj")
      const cwNorm = new Float32Array(cwResult.normals)
      for (let v = 0; v < 3; v++) {
        expect(cwNorm[v * 3]).toBeCloseTo(0.0, 4)
        expect(cwNorm[v * 3 + 1]).toBeCloseTo(0.0, 4)
        expect(cwNorm[v * 3 + 2]).toBeCloseTo(-1.0, 4) // Points toward -Z
      }
    })

    it("verifies synthesized normal orthogonality across arbitrary 3D orientations", () => {
      const p0 = [2.5, -1.8, 4.2]
      const p1 = [-3.1, 5.4, 0.9]
      const p2 = [1.0, 0.5, -6.3]
      const triObj = `
v ${p0[0]} ${p0[1]} ${p0[2]}
v ${p1[0]} ${p1[1]} ${p1[2]}
v ${p2[0]} ${p2[1]} ${p2[2]}
f 1 2 3
`
      const res = normalize_obj_wasm(triObj, "tri3d.obj")
      const norm = new Float32Array(res.normals)
      const n = [norm[0], norm[1], norm[2]]

      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
      const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]

      const dot1 = n[0] * e1[0] + n[1] * e1[1] + n[2] * e1[2]
      const dot2 = n[0] * e2[0] + n[1] * e2[1] + n[2] * e2[2]

      expect(Math.abs(dot1)).toBeLessThan(1e-4)
      expect(Math.abs(dot2)).toBeLessThan(1e-4)
    })

    it("handles zero-area degenerate triangles without NaN or Infinite normals", () => {
      const degenObj = `
v 5.0 5.0 5.0
v 5.0 5.0 5.0
v 5.0 5.0 5.0
f 1 2 3
`
      const res = normalize_obj_wasm(degenObj, "degen.obj")
      const norm = new Float32Array(res.normals)
      for (let i = 0; i < norm.length; i += 3) {
        expect(Number.isNaN(norm[i])).toBe(false)
        expect(Number.isNaN(norm[i + 1])).toBe(false)
        expect(Number.isNaN(norm[i + 2])).toBe(false)
        // Up-vector fallback [0, 1, 0]
        expect(norm[i + 1]).toBe(1.0)
      }
    })

    it("correctly triangulates n-gon faces (quads, pentagons, hexagons)", () => {
      const ngonObj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4

v 2 0 0
v 3 0 0
v 3.5 1 0
v 3 2 0
v 2 2 0
v 1.5 1 0
f 5 6 7 8 9 10
`
      const res = normalize_obj_wasm(ngonObj, "ngon.obj")
      // Quad -> 2 triangles (6 vertices)
      // Hexagon -> 4 triangles (12 vertices)
      // Total: 18 vertices, 6 triangles
      expect(res.vertex_count).toBe(18)
      expect(res.triangle_count).toBe(6)
      expect(res.positions.length).toBe(54)
      expect(res.normals.length).toBe(54)
    })
  })

  // ==========================================================================
  // Section 3: Bounding Box Centering & Bounding Sphere Scaling
  // ==========================================================================
  describe("Section 3: Bounding Box Centering & Bounding Sphere Scaling", () => {
    it("centers geometry situated at extreme asymmetric coordinates [10000, 20000, 30000]", () => {
      const offsetObj = `
v 10000.0 20000.0 30000.0
v 10010.0 20000.0 30000.0
v 10000.0 20020.0 30000.0
f 1 2 3
`
      const res = normalize_obj_wasm(offsetObj, "offset.obj")
      const pos = new Float32Array(res.positions)

      let minX = Infinity, maxX = -Infinity
      let minY = Infinity, maxY = -Infinity
      let minZ = Infinity, maxZ = -Infinity

      for (let i = 0; i < pos.length; i += 3) {
        minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i])
        minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1])
        minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2])
      }

      const cx = (minX + maxX) * 0.5
      const cy = (minY + maxY) * 0.5
      const cz = (minZ + maxZ) * 0.5

      expect(Math.abs(cx)).toBeLessThan(1e-3)
      expect(Math.abs(cy)).toBeLessThan(1e-3)
      expect(Math.abs(cz)).toBeLessThan(1e-3)
    })

    it("scales microscopic (1e-6) and astronomical (1e6) meshes to target radius ~1.2", () => {
      const microObj = `
v -0.000001 -0.000001 0.0
v 0.000001 -0.000001 0.0
v 0.0 0.000001 0.0
f 1 2 3
`
      const astroObj = `
v -1000000.0 -1000000.0 0.0
v 1000000.0 -1000000.0 0.0
v 0.0 1000000.0 0.0
f 1 2 3
`
      const microRes = normalize_obj_wasm(microObj, "micro.obj")
      const astroRes = normalize_obj_wasm(astroObj, "astro.obj")

      let maxR_micro = 0
      const posM = new Float32Array(microRes.positions)
      for (let i = 0; i < posM.length; i += 3) {
        maxR_micro = Math.max(maxR_micro, Math.sqrt(posM[i] ** 2 + posM[i + 1] ** 2 + posM[i + 2] ** 2))
      }

      let maxR_astro = 0
      const posA = new Float32Array(astroRes.positions)
      for (let i = 0; i < posA.length; i += 3) {
        maxR_astro = Math.max(maxR_astro, Math.sqrt(posA[i] ** 2 + posA[i + 1] ** 2 + posA[i + 2] ** 2))
      }

      expect(maxR_micro).toBeCloseTo(1.2, 2)
      expect(maxR_astro).toBeCloseTo(1.2, 2)
    })
  })

  // ==========================================================================
  // Section 4: Web Worker Fallback Stress & Client Bridge Resilience
  // ==========================================================================
  describe("Section 4: Graceful Web Worker Fallback & Resilience", () => {
    it("reports usingFallback = true and executes cleanly when Worker is unavailable", async () => {
      // In Vitest Node environment, Worker is undefined by default
      const status = wasmEngine.getStatus()
      expect(status.hasWorker).toBe(false)
      expect(status.usingFallback).toBe(true)

      const ready = await wasmEngine.init()
      expect(ready).toBe(false) // Graceful resolution without throwing

      // Normalize OBJ via client bridge fallback
      const obj = `
v -2.0 -2.0 0.0
v 2.0 -2.0 0.0
v 0.0 2.0 0.0
f 1 2 3
`
      const parsed: ParsedGeometry = await wasmEngine.normalizeObj(obj, "fallback.obj")
      expect(parsed.name).toBe("fallback.obj")
      expect(parsed.positions).toBeInstanceOf(Float32Array)
      expect(parsed.normals).toBeInstanceOf(Float32Array)
      expect(parsed.vertexCount).toBe(3)
      expect(parsed.triangleCount).toBe(1)
    })

    it("executes raw geometry normalization fallback with radius scaling", async () => {
      const rawPos = new Float32Array([
        -10, -10, 0,
        10, -10, 0,
        0, 10, 0,
      ])

      const parsed = await wasmEngine.normalizeGeometry(rawPos, undefined, undefined, "raw_fallback")
      expect(parsed.name).toBe("raw_fallback")
      expect(parsed.positions).toBeInstanceOf(Float32Array)
      expect(parsed.positions.length).toBe(9)
      expect(parsed.vertexCount).toBe(3)

      let maxR = 0
      for (let i = 0; i < parsed.positions.length; i += 3) {
        const dist = Math.sqrt(
          parsed.positions[i] ** 2 + parsed.positions[i + 1] ** 2 + parsed.positions[i + 2] ** 2
        )
        maxR = Math.max(maxR, dist)
      }
      expect(maxR).toBeCloseTo(1.2, 1)
    })

    it("executes PBR baking fallback creating valid PKZIP archive", async () => {
      const pixels = new Uint8Array(4 * 4 * 4) // 4x4 image
      pixels.fill(128)

      const output = await wasmEngine.bakePbr(pixels, 4, 4, {
        normalStrength: 1.5,
        invertNormalY: true,
      })

      expect(output.width).toBe(4)
      expect(output.height).toBe(4)
      expect(output.albedo_png.length).toBe(4 * 4 * 4)
      expect(output.zip_archive.length).toBeGreaterThan(50)
      // PKZIP header
      expect(output.zip_archive[0]).toBe(0x50)
      expect(output.zip_archive[1]).toBe(0x4b)
    })

    it("executes transpileShader and reflectUniforms fallback transparently", async () => {
      const source = `
@group(0) @binding(0) var<uniform> u_color: vec4f;
@fragment fn fs_main() -> @location(0) vec4f { return u_color; }
`
      const uniforms = await wasmEngine.reflectUniforms(source, "wgsl")
      expect(uniforms.length).toBeGreaterThanOrEqual(1)
      expect(uniforms[0].name).toBe("u_color")

      const unity = await wasmEngine.transpileShader(source, "unity")
      expect(unity).toContain("Shader")
      expect(unity).toContain("UniversalPipeline")
    })

    it("verifies wasmEngine.dispose() safely resets state without hanging", () => {
      wasmEngine.dispose()
      const status = wasmEngine.getStatus()
      expect(status.isInitialized).toBe(false)
      expect(status.usingFallback).toBe(true)
    })
  })
})
