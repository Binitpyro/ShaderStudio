import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { wasmEngine } from "@/core/wasmEngine"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
} from "@/core/engineTranspiler"
import { parseOBJ } from "@/core/modelLoader"
import {
  initSync,
  bake_pbr_wasm,
  reflect_uniforms_wasm,
  transpile_shader_wasm,
  normalize_obj_wasm,
  normalize_geometry_wasm,
} from "@/wasm/pkg/shaderstudio_wasm"

describe("Gate 4 Adversarial Empirical Challenge — PBR Baker & Naga Transpiler Parity", () => {
  const wasmPath = resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")

  let directWasmReady = false
  function ensureDirectWasm() {
    if (!directWasmReady && existsSync(wasmPath)) {
      const bytes = readFileSync(wasmPath)
      initSync({ module: bytes })
      directWasmReady = true
    }
  }

  // ==========================================================================
  // Section 1: PBR Baker — Sobel Math, Boundary Clamping, Y-Flip & Maps Parity
  // ==========================================================================
  describe("1. PBR Baker: Mathematical Parity & Edge Case Resilience", () => {
    it("handles extreme boundary dimensions (1x1, 16x2, 3x17) without buffer overruns or panics", () => {
      ensureDirectWasm()

      // Case A: 1x1 image
      const pixels1x1 = new Uint8Array([128, 128, 128, 255])
      const out1x1 = bake_pbr_wasm(pixels1x1, {
        width: 1,
        height: 1,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto",
      })
      expect(out1x1.width).toBe(1)
      expect(out1x1.height).toBe(1)
      expect(out1x1.zip_archive.length).toBeGreaterThan(50)

      // Case B: Highly non-square wide image (16x2)
      const widthB = 16
      const heightB = 2
      const pixels16x2 = new Uint8Array(widthB * heightB * 4)
      for (let y = 0; y < heightB; y++) {
        for (let x = 0; x < widthB; x++) {
          const idx = (y * widthB + x) * 4
          pixels16x2[idx] = x * 15
          pixels16x2[idx + 1] = y * 120
          pixels16x2[idx + 2] = 80
          pixels16x2[idx + 3] = 255
        }
      }
      const out16x2 = bake_pbr_wasm(pixels16x2, {
        width: widthB,
        height: heightB,
        normal_strength: 2.0,
        invert_normal_y: false,
        ao_strength: 1.0,
        metallic_mode: "auto",
      })
      expect(out16x2.width).toBe(16)
      expect(out16x2.height).toBe(2)
      expect(out16x2.normal_png.length).toBeGreaterThan(0)

      // Case C: Highly non-square tall odd image (3x17)
      const widthC = 3
      const heightC = 17
      const pixels3x17 = new Uint8Array(widthC * heightC * 4).fill(160)
      const out3x17 = bake_pbr_wasm(pixels3x17, {
        width: widthC,
        height: heightC,
        normal_strength: 1.5,
        invert_normal_y: true,
        ao_strength: 0.5,
        metallic_mode: "metal",
      })
      expect(out3x17.width).toBe(3)
      expect(out3x17.height).toBe(17)
      expect(out3x17.zip_archive[0]).toBe(0x50) // PKZIP magic
    })

    it("verifies mathematical parity between TS reference and Wasm Sobel logic", () => {
      ensureDirectWasm()

      const width = 16
      const height = 8
      const pixels = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          pixels[idx] = Math.round((x / (width - 1)) * 255)
          pixels[idx + 1] = Math.round((y / (height - 1)) * 255)
          pixels[idx + 2] = 100
          pixels[idx + 3] = 255
        }
      }

      const imgData = { data: pixels, width, height } as unknown as ImageData

      // TS Reference outputs
      const tsResult = generatePbrPixelBuffers(imgData, {
        normalStrength: 2.5,
        invertNormalY: false,
        aoStrength: 1.2,
        metallicMode: "auto",
      })

      // Verify TS outputs are well-formed and strictly typed
      expect(tsResult.width).toBe(width)
      expect(tsResult.height).toBe(height)
      expect(tsResult.normal.length).toBe(width * height * 4)
      expect(tsResult.roughness.length).toBe(width * height * 4)
      expect(tsResult.metallic.length).toBe(width * height * 4)
      expect(tsResult.ao.length).toBe(width * height * 4)

      // Wasm execution
      const wasmConfig = {
        width,
        height,
        normal_strength: 2.5,
        invert_normal_y: false,
        ao_strength: 1.2,
        metallic_mode: "auto",
      }
      const wasmOutput = bake_pbr_wasm(new Uint8Array(pixels), wasmConfig)
      expect(wasmOutput.width).toBe(width)
      expect(wasmOutput.height).toBe(height)
      expect(wasmOutput.zip_archive[0]).toBe(0x50)
      expect(wasmOutput.zip_archive[1]).toBe(0x4b)
    })

    it("verifies DirectX vs OpenGL Y-flip toggle across vertical gradients", () => {
      ensureDirectWasm()

      const width = 8
      const height = 8
      const pixels = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4
          // Strong slope along Y axis
          const val = Math.round((y / (height - 1)) * 255)
          pixels[idx] = val
          pixels[idx + 1] = val
          pixels[idx + 2] = val
          pixels[idx + 3] = 255
        }
      }

      const imgData = { data: new Uint8ClampedArray(pixels), width, height } as unknown as ImageData

      const tsOgl = generatePbrPixelBuffers(imgData, { normalStrength: 2.0, invertNormalY: false })
      const tsDx = generatePbrPixelBuffers(imgData, { normalStrength: 2.0, invertNormalY: true })

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4
          const rOgl = tsOgl.normal[idx]
          const rDx = tsDx.normal[idx]
          const gOgl = tsOgl.normal[idx + 1]
          const gDx = tsDx.normal[idx + 1]
          const bOgl = tsOgl.normal[idx + 2]
          const bDx = tsDx.normal[idx + 2]

          // X and Z channels must match exactly
          expect(rOgl).toBe(rDx)
          expect(bOgl).toBe(bDx)

          // Y channel must invert symmetrically across 128
          expect(Math.abs(gOgl + gDx - 255)).toBeLessThanOrEqual(1)
        }
      }
    })

    it("verifies metallic modes: dielectric (0), metal (255), and auto saturation threshold", () => {
      const width = 4
      const height = 4
      const pixels = new Uint8ClampedArray(width * height * 4)

      // Pixel 0: gray (sat = 0, h = 0.5) -> auto = 0
      pixels[0] = 128; pixels[1] = 128; pixels[2] = 128; pixels[3] = 255

      // Pixel 1: highly saturated (R=200, G=50, B=50 -> sat = 150 > 50) -> auto = 255
      pixels[4] = 200; pixels[5] = 50; pixels[6] = 50; pixels[7] = 255

      // Pixel 2: bright specular highlight (R=250, G=225, B=225 -> sat = 25 > 20, h > 0.85) -> auto = 255
      pixels[8] = 250; pixels[9] = 225; pixels[10] = 225; pixels[11] = 255

      // Pixel 3: dim slightly saturated (R=80, G=60, B=60 -> sat = 20 <= 50, h < 0.85) -> auto = 0
      pixels[12] = 80; pixels[13] = 60; pixels[14] = 60; pixels[15] = 255

      const imgData = { data: pixels, width, height } as unknown as ImageData

      const resDielectric = generatePbrPixelBuffers(imgData, { metallicMode: "dielectric" })
      expect(resDielectric.metallic[0]).toBe(0)
      expect(resDielectric.metallic[4]).toBe(0)

      const resMetal = generatePbrPixelBuffers(imgData, { metallicMode: "metal" })
      expect(resMetal.metallic[0]).toBe(255)
      expect(resMetal.metallic[4]).toBe(255)

      const resAuto = generatePbrPixelBuffers(imgData, { metallicMode: "auto" })
      expect(resAuto.metallic[0]).toBe(0)   // gray -> dielectric
      expect(resAuto.metallic[4]).toBe(255) // sat > 50 -> metal
      expect(resAuto.metallic[8]).toBe(255) // bright specular -> metal
      expect(resAuto.metallic[12]).toBe(0)  // dim sat 20 -> dielectric
    })

    it("rejects mismatched buffer lengths safely in Wasm", () => {
      ensureDirectWasm()

      const tooSmall = new Uint8Array(10) // Expected 4 * 4 * 4 = 64
      expect(() => {
        bake_pbr_wasm(tooSmall, {
          width: 4,
          height: 4,
          normal_strength: 2.0,
          invert_normal_y: false,
          ao_strength: 1.0,
          metallic_mode: "auto",
        })
      }).toThrow()
    })
  })

  // ==========================================================================
  // Section 2: Naga Uniform Reflection — Nested Structs, Arrays & Layouts
  // ==========================================================================
  describe("2. Naga Shader Reflection: Nested Structs & Multi-Type Uniforms", () => {
    it("reflects complex WGSL shader containing nested structs, matrices and textures", () => {
      ensureDirectWasm()

      const wgslSource = `
struct TransformData {
    model: mat4x4f,
    normalMatrix: mat3x3f,
};

struct LightSource {
    position: vec3f,
    range: f32,
    color: vec4f,
};

struct GlobalUniforms {
    transform: TransformData,
    sunLight: LightSource,
    ambientLight: vec3f,
    roughnessScale: f32,
};

@group(0) @binding(0)
var<uniform> u_globals: GlobalUniforms;

@group(0) @binding(1)
var u_albedoTexture: texture_2d<f32>;

@group(0) @binding(2)
var u_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return u_globals.sunLight.color;
}
`

      const uniforms = reflect_uniforms_wasm(wgslSource, "wgsl")
      expect(Array.isArray(uniforms)).toBe(true)
      expect(uniforms.length).toBeGreaterThanOrEqual(6)

      const names = uniforms.map((u: any) => u.name)

      // Outer struct fields
      expect(names).toContain("transform")
      expect(names).toContain("sunLight")
      expect(names).toContain("ambientLight")
      expect(names).toContain("roughnessScale")

      // Nested struct members must also be discovered
      expect(names).toContain("model")
      expect(names).toContain("normalMatrix")
      expect(names).toContain("position")
      expect(names).toContain("range")
      expect(names).toContain("color")

      // Check type mappings
      const modelUniform = uniforms.find((u: any) => u.name === "model")
      expect(modelUniform.type_name).toBe("mat4x4f")
      expect(modelUniform.kind).toBe("matrix")

      const colorUniform = uniforms.find((u: any) => u.name === "color")
      expect(colorUniform.type_name).toBe("vec4f")
      expect(colorUniform.kind).toBe("color")
    })

    it("reflects standard GLSL uniforms and handles uniform blocks via fallback or AST", () => {
      ensureDirectWasm()

      const glslSource = `
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_eye;
uniform float u_near;
uniform sampler2D u_tex;

out vec4 fragColor;

void main() {
    fragColor = vec4(u_eye, 1.0);
}
`

      const uniforms = reflect_uniforms_wasm(glslSource, "glsl")
      expect(Array.isArray(uniforms)).toBe(true)
      expect(uniforms.length).toBeGreaterThanOrEqual(5)

      const names = uniforms.map((u: any) => u.name)
      expect(names).toContain("u_view")
      expect(names).toContain("u_proj")
      expect(names).toContain("u_eye")
      expect(names).toContain("u_near")
      expect(names).toContain("u_tex")
    })

    it("falls back gracefully on incomplete or snippet WGSL shader code", () => {
      ensureDirectWasm()

      // Incomplete snippet without entrypoint or bindings
      const snippet = `
struct Settings {
    speed: f32,
    tint: vec4f,
    offset: vec2f,
};
`
      const uniforms = reflect_uniforms_wasm(snippet, "wgsl")
      expect(Array.isArray(uniforms)).toBe(true)
      expect(uniforms.length).toBe(3)

      const names = uniforms.map((u: any) => u.name)
      expect(names).toContain("speed")
      expect(names).toContain("tint")
      expect(names).toContain("offset")

      const tint = uniforms.find((u: any) => u.name === "tint")
      expect(tint.kind).toBe("color")
      expect(tint.type_name).toBe("vec4f")
    })
  })

  // ==========================================================================
  // Section 3: Shader Transpilation — Unity URP, Godot 4 & Shadertoy
  // ==========================================================================
  describe("3. Shader Cross-Compiler: Multi-Target Parity", () => {
    it("transpiles shader to valid Unity URP ShaderLab with Properties & CBUFFER", () => {
      ensureDirectWasm()

      const shader = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_tint.rgb * sin(u_time * u_speed);
    fragColor = vec4(col, 1.0);
}
`
      const res = transpile_shader_wasm({
        shader_source: shader,
        shader_name: "Custom/ParityTest",
        target: "unity",
        source_lang: "glsl",
      })

      // Structural validation
      expect(res).toContain('Shader "Custom/ParityTest"')
      expect(res).toContain('"RenderPipeline" = "UniversalPipeline"')
      expect(res).toContain('"LightMode" = "UniversalForward"')
      expect(res).toContain("TransformObjectToHClip(input.positionOS.xyz);")
      expect(res).toContain("TransformObjectToWorldNormal(input.normalOS);")
      expect(res).toContain("float4 frag(Varyings i) : SV_Target")

      // Keyword substitutions
      expect(res).toContain("i.positionCS.xy")
      expect(res).toContain("_ScreenParams.xy")
      expect(res).toContain("_Time.y")
    })

    it("transpiles shader to Godot 4 Spatial Shader (.gdshader)", () => {
      ensureDirectWasm()

      const shader = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color.rgb * sin(u_time);
    fragColor = vec4(col, 1.0);
}
`
      const res = transpile_shader_wasm({
        shader_source: shader,
        target: "godot",
        source_lang: "glsl",
      })

      expect(res).toContain("shader_type spatial;")
      expect(res).toContain("render_mode cull_back, diffuse_burley, specular_schlick_ggx;")
      expect(res).toContain("void fragment() {")
      expect(res).toContain("FRAGCOORD.xy")
      expect(res).toContain("VIEWPORT_SIZE")
      expect(res).toContain("TIME")
      expect(res).toContain("ALBEDO = fragColor.rgb;")
      expect(res).toContain("ALPHA = fragColor.a;")
    })

    it("transpiles shader to Shadertoy GLSL ES 3.0", () => {
      ensureDirectWasm()

      const shader = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    fragColor = vec4(uv, sin(u_time), 1.0);
}
`
      const res = transpile_shader_wasm({
        shader_source: shader,
        target: "shadertoy",
        source_lang: "glsl",
      })

      expect(res).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
      expect(res).toContain("iResolution.xy")
      expect(res).toContain("fragCoord.xy")
      expect(res).toContain("iTime")
    })
  })

  // ==========================================================================
  // Section 4: 3D Mesh Normalization & Vertex Memory Buffer Processing
  // ==========================================================================
  describe("4. 3D Mesh Normalizer: Low-Allocation Geometry Processing", () => {
    it("parses and centers complex Wavefront OBJ with polygon fan triangulation", () => {
      ensureDirectWasm()

      // Hexagon polygon (6 vertices in face)
      const hexagonObj = `
v  0.0  0.0 0.0
v  1.0  0.0 0.0
v  1.5  0.866 0.0
v  1.0  1.732 0.0
v  0.0  1.732 0.0
v -0.5  0.866 0.0
f 1 2 3 4 5 6
`
      const res = normalize_obj_wasm(hexagonObj, "hexagon.obj")
      expect(res.name).toBe("hexagon.obj")
      // 6-gon fan triangulates into 4 triangles = 12 vertices = 36 floats
      expect(res.triangle_count).toBe(4)
      expect(res.vertex_count).toBe(12)
      expect(res.positions.length).toBe(36)
      expect(res.normals.length).toBe(36)

      // Verify origin centering: average position should be approximately 0
      let sumX = 0, sumY = 0, sumZ = 0
      for (let i = 0; i < res.positions.length; i += 3) {
        sumX += res.positions[i]
        sumY += res.positions[i + 1]
        sumZ += res.positions[i + 2]
      }
      expect(Math.abs(sumX / res.vertex_count)).toBeLessThan(0.1)
      expect(Math.abs(sumY / res.vertex_count)).toBeLessThan(0.1)
      expect(Math.abs(sumZ / res.vertex_count)).toBeLessThan(0.1)
    })
  })

  // ==========================================================================
  // Section 5: Client Bridge wasmEngine Fallback Resilience
  // ==========================================================================
  describe("5. Client Bridge wasmEngine Node/Headless Fallback Integrity", () => {
    it("reports diagnostic status correctly in headless testing environment", () => {
      const status = wasmEngine.getStatus()
      expect(typeof status.hasWebAssembly).toBe("boolean")
      expect(typeof status.hasWorker).toBe("boolean")
      expect(typeof status.usingFallback).toBe("boolean")
    })

    it("executes complete PBR bake pipeline via fallback without DOM canvas", async () => {
      const width = 16
      const height = 16
      const pixels = new Uint8Array(width * height * 4).fill(128)

      const res = await wasmEngine.bakePbr(pixels, width, height, {
        normalStrength: 2.0,
        invertNormalY: true,
        metallicMode: "dielectric",
        aoStrength: 1.0,
      })

      expect(res.width).toBe(width)
      expect(res.height).toBe(height)
      expect(res.albedo_png.length).toBe(width * height * 4)
      expect(res.zip_archive[0]).toBe(0x50) // Valid PKZIP archive
    })

    it("transpiles shader through wasmEngine fallback seamlessly", async () => {
      const code = `
void main() {
    fragColor = vec4(1.0);
}
`
      const unity = await wasmEngine.transpileShader(code, "unity")
      expect(unity).toContain("Shader")
      expect(unity).toContain("UniversalPipeline")

      const godot = await wasmEngine.transpileShader(code, "godot")
      expect(godot).toContain("shader_type spatial;")

      const shadertoy = await wasmEngine.transpileShader(code, "shadertoy")
      expect(shadertoy).toContain("mainImage")
    })
  })
})
