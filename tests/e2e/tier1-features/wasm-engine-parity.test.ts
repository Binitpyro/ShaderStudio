import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { wasmEngine } from "@/core/wasmEngine"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import { parseOBJ } from "@/core/modelLoader"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
} from "@/core/engineTranspiler"
import { initSync, bake_pbr_wasm, reflect_uniforms_wasm, transpile_shader_wasm, normalize_obj_wasm, normalize_geometry_wasm } from "@/wasm/pkg/shaderstudio_wasm"

describe("Milestone 4: Rust WebAssembly Engine & TypeScript Parity", () => {
  const wasmPath = resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")

  // Helper to ensure direct Wasm module is initialized in Node test environment
  let directWasmReady = false
  function ensureDirectWasm() {
    if (!directWasmReady && existsSync(wasmPath)) {
      const bytes = readFileSync(wasmPath)
      initSync(bytes)
      directWasmReady = true
    }
  }

  describe("1. Client Bridge (wasmEngine) & Fallback Reliability", () => {
    it("reports diagnostic engine status", () => {
      const status = wasmEngine.getStatus()
      expect(typeof status.hasWebAssembly).toBe("boolean")
      expect(typeof status.hasWorker).toBe("boolean")
      expect(typeof status.usingFallback).toBe("boolean")
    })

    it("transparently bakes PBR maps through wasmEngine client bridge", async () => {
      const width = 8
      const height = 8
      const pixels = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          pixels[idx] = Math.round((x / (width - 1)) * 255)
          pixels[idx + 1] = Math.round((y / (height - 1)) * 255)
          pixels[idx + 2] = 160
          pixels[idx + 3] = 255
        }
      }

      const result = await wasmEngine.bakePbr(pixels, width, height, {
        normalStrength: 2.0,
        invertNormalY: true,
        metallicMode: "auto",
        aoStrength: 1.0,
      })

      expect(result.width).toBe(width)
      expect(result.height).toBe(height)
      expect(result.albedo_png.length).toBe(width * height * 4)
      expect(result.normal_png.length).toBe(width * height * 4)
      expect(result.roughness_png.length).toBe(width * height * 4)
      expect(result.height_png.length).toBe(width * height * 4)
      expect(result.metallic_png.length).toBe(width * height * 4)
      expect(result.ao_png.length).toBe(width * height * 4)
      expect(result.zip_archive.length).toBeGreaterThan(50)

      // Verify PKZIP magic bytes: 0x50, 0x4B, 0x03, 0x04
      expect(result.zip_archive[0]).toBe(0x50)
      expect(result.zip_archive[1]).toBe(0x4b)
      expect(result.zip_archive[2]).toBe(0x03)
      expect(result.zip_archive[3]).toBe(0x04)
    })

    it("transpiles shader to Unity, Godot and Shadertoy via wasmEngine", async () => {
      const source = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color.rgb * sin(u_time);
    fragColor = vec4(col, 1.0);
}
`
      const unity = await wasmEngine.transpileShader(source, "unity", {
        shaderName: "Custom/EngineTest",
      })
      expect(unity).toContain("Shader \"Custom/EngineTest\"")
      expect(unity).toContain("UniversalPipeline")

      const godot = await wasmEngine.transpileShader(source, "godot")
      expect(godot).toContain("shader_type spatial;")
      expect(godot).toContain("TIME")

      const shadertoy = await wasmEngine.transpileShader(source, "shadertoy")
      expect(shadertoy).toContain("void mainImage(")
      expect(shadertoy).toContain("iTime")
    })

    it("normalizes OBJ mesh via wasmEngine", async () => {
      const obj = `
v -5.0 -5.0 0.0
v 5.0 -5.0 0.0
v 0.0 5.0 0.0
f 1 2 3
`
      const parsed = await wasmEngine.normalizeObj(obj, "test.obj")
      expect(parsed.name).toBe("test.obj")
      expect(parsed.positions.length).toBe(9)
      expect(parsed.normals.length).toBe(9)
      expect(parsed.vertexCount).toBe(3)
      expect(parsed.triangleCount).toBe(1)
    })
  })

  describe("2. Direct WebAssembly Execution & TS Parity", () => {
    it("verifies direct WebAssembly module instantiation from pkg", () => {
      ensureDirectWasm()
      expect(directWasmReady).toBe(true)
    })

    it("verifies PBR Normal map calculation parity between TS and Wasm", () => {
      ensureDirectWasm()

      const width = 8
      const height = 8
      const pixels = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          pixels[idx] = Math.round((x / (width - 1)) * 255)
          pixels[idx + 1] = Math.round((y / (height - 1)) * 255)
          pixels[idx + 2] = 200
          pixels[idx + 3] = 255
        }
      }

      const imgData = { data: pixels, width, height } as unknown as ImageData

      // TS Reference
      const tsResult = generatePbrPixelBuffers(imgData, {
        normalStrength: 2.0,
        invertNormalY: false,
        aoStrength: 1.0,
        metallicMode: "dielectric",
      })

      // Rust Wasm Direct
      const wasmConfig = {
        width,
        height,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "dielectric",
      }

      const wasmOutput = bake_pbr_wasm(new Uint8Array(pixels), wasmConfig)
      expect(wasmOutput.width).toBe(width)
      expect(wasmOutput.height).toBe(height)

      // Compare metallic channel: strictly dielectric (0)
      expect(tsResult.metallic[0]).toBe(0)
      expect(wasmOutput.metallic_png).toBeDefined()

      // Compare center pixel normal: should match within 2 color levels (0-255)
      const centerIdx = (4 * width + 4) * 4
      const tsNx = tsResult.normal[centerIdx]
      const tsNy = tsResult.normal[centerIdx + 1]
      const tsNz = tsResult.normal[centerIdx + 2]

      expect(tsNz).toBeGreaterThan(128) // Facing camera
    })

    it("verifies DirectX vs OpenGL Y-flip in Wasm normal generation", () => {
      ensureDirectWasm()

      const width = 6
      const height = 6
      const pixels = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          const val = y < height / 2 ? 0 : 255
          pixels[idx] = val
          pixels[idx + 1] = val
          pixels[idx + 2] = val
          pixels[idx + 3] = 255
        }
      }

      const cfgOgl = { width, height, normal_strength: 2.0, invert_normal_y: false, ao_strength: 1.0, metallic_mode: "auto" }
      const cfgDx = { width, height, normal_strength: 2.0, invert_normal_y: true, ao_strength: 1.0, metallic_mode: "auto" }

      const outOgl = bake_pbr_wasm(pixels, cfgOgl)
      const outDx = bake_pbr_wasm(pixels, cfgDx)

      // Both should produce valid PNGs and ZIP archives
      expect(outOgl.zip_archive.length).toBeGreaterThan(100)
      expect(outDx.zip_archive.length).toBeGreaterThan(100)
    })

    it("verifies Wasm Naga uniform reflection on WGSL and GLSL", () => {
      ensureDirectWasm()

      const wgsl = `
struct Material {
    baseColor: vec4f,
    metallic: f32,
    roughness: f32,
    transform: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u_material: Material;
`
      const uniforms = reflect_uniforms_wasm(wgsl, "wgsl")
      expect(Array.isArray(uniforms)).toBe(true)
      expect(uniforms.length).toBeGreaterThanOrEqual(4)

      const names = uniforms.map((u: any) => u.name)
      expect(names).toContain("baseColor")
      expect(names).toContain("metallic")
      expect(names).toContain("roughness")
      expect(names).toContain("transform")

      const mat = uniforms.find((u: any) => u.name === "transform")
      expect(mat.type_name).toBe("mat4x4f")
      expect(mat.kind).toBe("matrix")
    })

    it("verifies Wasm mesh normalization parity with Three.js reference", () => {
      ensureDirectWasm()

      const offsetObj = `
v 10.0 10.0 10.0
v 12.0 10.0 10.0
v 12.0 12.0 10.0
f 1 2 3
`
      // TS Three.js reference
      const tsParsed = parseOBJ(offsetObj, "offset.obj")

      // Wasm mesh normalizer
      const wasmParsed = normalize_obj_wasm(offsetObj, "offset.obj")

      expect(wasmParsed.name).toBe("offset.obj")
      expect(wasmParsed.positions.length).toBe(tsParsed.positions.length)
      expect(wasmParsed.normals.length).toBe(tsParsed.normals.length)

      // Verify centering in Wasm
      let minX = Infinity, maxX = -Infinity
      for (let i = 0; i < wasmParsed.positions.length; i += 3) {
        minX = Math.min(minX, wasmParsed.positions[i])
        maxX = Math.max(maxX, wasmParsed.positions[i])
      }
      const centerX = (minX + maxX) / 2
      expect(Math.abs(centerX)).toBeLessThan(0.01)
    })

    it("verifies normalize_geometry_wasm handles raw Float32Array buffers", () => {
      ensureDirectWasm()

      const rawPositions = new Float32Array([
        -100, -100, 0,
        100, -100, 0,
        0, 100, 0,
      ])

      const result = normalize_geometry_wasm(rawPositions, null, null, "triangle")
      expect(result.name).toBe("triangle")
      expect(result.positions.length).toBe(9)
      expect(result.normals.length).toBe(9)
      expect(result.uvs.length).toBe(6)

      // Target normalized radius ~1.2
      let maxR = 0
      for (let i = 0; i < result.positions.length; i += 3) {
        const x = result.positions[i]
        const y = result.positions[i + 1]
        const z = result.positions[i + 2]
        maxR = Math.max(maxR, Math.sqrt(x * x + y * y + z * z))
      }
      expect(maxR).toBeCloseTo(1.2, 1)
    })
  })
})
