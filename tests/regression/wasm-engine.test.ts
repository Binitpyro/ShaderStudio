import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { wasmEngine } from "@/core/wasmEngine"
import { generatePbrPixelBuffers, bakePbrMaps } from "@/core/textureBaker"
import { parseOBJ, type ParsedGeometry } from "@/core/modelLoader"
import { customModelRegistry } from "@/core/customModelRegistry"
import { createZipArchive } from "@/utils/zipBuilder"
import {
  initSync,
  bake_pbr_wasm,
  reflect_uniforms_wasm,
  transpile_shader_wasm,
  normalize_obj_wasm,
  normalize_geometry_wasm,
} from "@/wasm/pkg/shaderstudio_wasm"

const asImage = (data: Uint8ClampedArray, width: number, height: number) => ({ data, width, height, colorSpace: "srgb" }) as unknown as ImageData
const wasmCfg = (width: number, height: number, extra: Record<string, unknown> = {}) => ({
  width,
  height,
  normal_strength: 2.0,
  invert_normal_y: false,
  ao_strength: 1.0,
  metallic_mode: "auto",
  ...extra,
})
const maxRadius = (pos: ArrayLike<number>) => {
  let r = 0
  for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i], pos[i + 1], pos[i + 2]))
  return r
}
const PK = [0x50, 0x4b, 0x03, 0x04]

function gradientPixels(w: number, h: number, blue = 160) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px[i] = Math.round((x / Math.max(1, w - 1)) * 255)
      px[i + 1] = Math.round((y / Math.max(1, h - 1)) * 255)
      px[i + 2] = blue
      px[i + 3] = 255
    }
  }
  return px
}
function pattern(w: number, h: number, kind: "horizontal_gradient" | "vertical_step" | "checkerboard") {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v =
        kind === "horizontal_gradient" ? Math.round((x / Math.max(1, w - 1)) * 255) : kind === "vertical_step" ? (y < h / 2 ? 0 : 255) : (x + y) % 2 === 0 ? 0 : 255
      px[i] = px[i + 1] = px[i + 2] = v
      px[i + 3] = 255
    }
  }
  return asImage(px, w, h)
}

describe("WASM engine, PBR baker and mesh normalizer", () => {
  beforeAll(() => {
    initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")) })
  })

  describe("TS PBR baker (textureBaker)", () => {
    it("derives the height map from ITU-R BT.601 luminance", () => {
      const px = new Uint8ClampedArray(64)
      px.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
      const r = generatePbrPixelBuffers(asImage(px, 4, 4))
      expect(r.heightMap[0]).toBeCloseTo(76, -1)
      expect(r.heightMap[4]).toBeCloseTo(150, -1)
      expect(r.heightMap[8]).toBeCloseTo(29, -1)
    })

    it("builds a unit-length Sobel normal map that faces the camera", () => {
      const r = generatePbrPixelBuffers(pattern(8, 8, "horizontal_gradient"), { normalStrength: 2.0 })
      expect(r.normal.length).toBe(8 * 8 * 4)
      const c = (4 * 8 + 4) * 4
      const n = [0, 1, 2].map((k) => (r.normal[c + k] - 128) / 127)
      const len = Math.hypot(n[0], n[1], n[2])
      expect(len).toBeGreaterThan(0.9)
      expect(len).toBeLessThan(1.1)
      expect(r.normal[c + 2]).toBeGreaterThan(128)
    })

    it("invertNormalY flips only the green channel around 128 (DirectX vs OpenGL)", () => {
      const img = pattern(8, 8, "vertical_step")
      const ogl = generatePbrPixelBuffers(img, { normalStrength: 2.0, invertNormalY: false })
      const dx = generatePbrPixelBuffers(img, { normalStrength: 2.0, invertNormalY: true })
      let sawSlope = false
      for (let y = 1; y < 7; y++) {
        for (let x = 1; x < 7; x++) {
          const i = (y * 8 + x) * 4
          expect(ogl.normal[i]).toBe(dx.normal[i])
          expect(ogl.normal[i + 2]).toBe(dx.normal[i + 2])
          expect(Math.abs(ogl.normal[i + 1] + dx.normal[i + 1] - 255)).toBeLessThanOrEqual(1)
          if (ogl.normal[i + 1] !== dx.normal[i + 1]) sawSlope = true
        }
      }
      expect(sawSlope).toBe(true)

      // exact mirror on every pixel for a two-axis gradient
      const grad = new Uint8ClampedArray(8 * 8 * 4)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) grad.set([x * 32, y * 32, 128, 255], (y * 8 + x) * 4)
      const gi = asImage(grad, 8, 8)
      const a = generatePbrPixelBuffers(gi, { normalStrength: 2.0, invertNormalY: false })
      const b = generatePbrPixelBuffers(gi, { normalStrength: 2.0, invertNormalY: true })
      for (let i = 1; i < a.normal.length; i += 4) expect(b.normal[i]).toBe(255 - a.normal[i])
    })

    it("aoStrength darkens cavities and roughness stays grayscale with full alpha", () => {
      const img = pattern(8, 8, "checkerboard")
      const low = generatePbrPixelBuffers(img, { aoStrength: 0.5 }).ao
      const high = generatePbrPixelBuffers(img, { aoStrength: 2.0 }).ao
      const v = (1 * 8 + 0) * 4
      expect(low[v]).toBeGreaterThanOrEqual(0)
      expect(high[v]).toBeLessThanOrEqual(low[v])

      const rough = generatePbrPixelBuffers(pattern(8, 8, "horizontal_gradient")).roughness
      expect(rough.length).toBe(8 * 8 * 4)
      for (let i = 0; i < rough.length; i += 4) {
        expect(rough[i]).toBe(rough[i + 1])
        expect(rough[i + 1]).toBe(rough[i + 2])
        expect(rough[i + 3]).toBe(255)
      }
    })

    it("metallic modes: dielectric = 0, metal = 255, auto thresholds on saturation / highlights", () => {
      const px = new Uint8ClampedArray(64)
      px.set([128, 128, 128, 255, 200, 50, 50, 255, 250, 225, 225, 255, 80, 60, 60, 255])
      const img = asImage(px, 4, 4)
      const d = generatePbrPixelBuffers(img, { metallicMode: "dielectric" })
      const m = generatePbrPixelBuffers(img, { metallicMode: "metal" })
      const a = generatePbrPixelBuffers(img, { metallicMode: "auto" })
      for (const i of [0, 4, 8, 12]) {
        expect(d.metallic[i]).toBe(0)
        expect(m.metallic[i]).toBe(255)
      }
      expect([a.metallic[0], a.metallic[4], a.metallic[8], a.metallic[12]]).toEqual([0, 255, 255, 0])
      expect(a.metallic.length).toBe(64)
    })

    it("bakePbrMaps (no DOM) yields six maps and a PKZIP archive", async () => {
      const prevDoc = (globalThis as any).document
      try {
        delete (globalThis as any).document
        const bake = await bakePbrMaps({ resolution: 512, metallicMode: "dielectric" })
        expect(bake.resolution).toBe(512)
        expect(Object.keys(bake.maps).sort()).toEqual(["albedo", "ao", "height", "metallic", "normal", "roughness"])
        const zip = bake.createZip()
        expect(zip.length).toBeGreaterThan(100)
        expect([...zip.subarray(0, 4)]).toEqual(PK)
      } finally {
        if (prevDoc !== undefined) (globalThis as any).document = prevDoc
      }
    })

    it("createZipArchive writes a local-header signature for custom file lists", () => {
      const zip = createZipArchive([
        { name: "test_albedo.png", data: new Uint8Array([1, 2, 3, 4]) },
        { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({ format: "pbr-v1" })) },
      ] as never)
      expect(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true)).toBe(0x04034b50)
    })
  })

  describe("Rust WASM PBR baker (bake_pbr_wasm)", () => {
    it("handles 1x1, 16x2 and 3x17 images without panics", () => {
      const o1 = bake_pbr_wasm(new Uint8Array([128, 128, 128, 255]), wasmCfg(1, 1))
      expect([o1.width, o1.height]).toEqual([1, 1])
      expect(o1.zip_archive.length).toBeGreaterThan(50)

      const p = new Uint8Array(16 * 2 * 4)
      for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) p.set([x * 15, y * 120, 80, 255], (y * 16 + x) * 4)
      const o2 = bake_pbr_wasm(p, wasmCfg(16, 2))
      expect([o2.width, o2.height]).toEqual([16, 2])
      expect(o2.normal_png.length).toBeGreaterThan(0)

      const o3 = bake_pbr_wasm(new Uint8Array(3 * 17 * 4).fill(160), wasmCfg(3, 17, { normal_strength: 1.5, invert_normal_y: true, ao_strength: 0.5, metallic_mode: "metal" }))
      expect([o3.width, o3.height]).toEqual([3, 17])
      expect(o3.zip_archive[0]).toBe(0x50)
    })

    it("produces all maps and a PKZIP archive, for both Y conventions", () => {
      const w = 8
      const h = 8
      const px = new Uint8Array(gradientPixels(w, h, 200))
      for (const invert of [false, true]) {
        const out = bake_pbr_wasm(px, wasmCfg(w, h, { invert_normal_y: invert, metallic_mode: "dielectric" }))
        expect([out.width, out.height]).toEqual([w, h])
        expect(Array.from(out.zip_archive).slice(0, 4)).toEqual(PK)
        expect(out.zip_archive.length).toBeGreaterThan(100)
        expect(out.normal_png.length).toBeGreaterThan(0)
        expect(out.metallic_png).toBeDefined()
      }
    })

    it("rejects a pixel buffer that does not match width*height*4", () => {
      expect(() => bake_pbr_wasm(new Uint8Array(10), wasmCfg(4, 4))).toThrow()
    })
  })

  describe("Naga uniform reflection (reflect_uniforms_wasm)", () => {
    it("reflects flat WGSL structs with kinds and type names", () => {
      const u = reflect_uniforms_wasm(
        `struct Material { baseColor: vec4f, metallic: f32, roughness: f32, transform: mat4x4f, };
         @group(0) @binding(0) var<uniform> u_material: Material;`,
        "wgsl"
      )
      const names = u.map((x: any) => x.name)
      for (const n of ["baseColor", "metallic", "roughness", "transform"]) expect(names).toContain(n)
      const t = u.find((x: any) => x.name === "transform")
      expect([t.type_name, t.kind]).toEqual(["mat4x4f", "matrix"])
    })

    it("flattens 2- and 3-tier nested structs and classifies matrix/color kinds", () => {
      const u = reflect_uniforms_wasm(
        `struct TransformData { model: mat4x4f, normalMatrix: mat3x3f, };
         struct LightSource { position: vec3f, range: f32, color: vec4f, };
         struct GlobalUniforms { transform: TransformData, sunLight: LightSource, ambientLight: vec3f, roughnessScale: f32, };
         @group(0) @binding(0) var<uniform> u_globals: GlobalUniforms;
         @group(0) @binding(1) var u_albedoTexture: texture_2d<f32>;
         @group(0) @binding(2) var u_sampler: sampler;
         @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f { return u_globals.sunLight.color; }`,
        "wgsl"
      )
      expect(u.length).toBeGreaterThanOrEqual(6)
      const names = u.map((x: any) => x.name)
      for (const n of ["transform", "sunLight", "ambientLight", "roughnessScale", "model", "normalMatrix", "position", "range", "color"]) {
        expect(names).toContain(n)
      }
      const model = u.find((x: any) => x.name === "model")
      expect([model.type_name, model.kind]).toEqual(["mat4x4f", "matrix"])
      const color = u.find((x: any) => x.name === "color")
      expect([color.type_name, color.kind]).toEqual(["vec4f", "color"])
    })

    it("falls back to struct parsing for snippets without entry points or bindings", () => {
      const u = reflect_uniforms_wasm("struct Settings { speed: f32, tint: vec4f, offset: vec2f, };", "wgsl")
      expect(u.map((x: any) => x.name)).toEqual(["speed", "tint", "offset"])
      const tint = u.find((x: any) => x.name === "tint")
      expect([tint.kind, tint.type_name]).toEqual(["color", "vec4f"])
    })

    it("reflects plain GLSL uniforms", () => {
      const u = reflect_uniforms_wasm(
        `uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_eye;
uniform float u_near;
uniform sampler2D u_tex;

out vec4 fragColor;

void main() {
    fragColor = vec4(u_eye, 1.0);
}
`,
        "glsl"
      )
      expect(u.length).toBeGreaterThanOrEqual(5)
      for (const n of ["u_view", "u_proj", "u_eye", "u_near", "u_tex"]) expect(u.map((x: any) => x.name)).toContain(n)
    })
  })

  describe("Naga cross-compiler (transpile_shader_wasm)", () => {
    const base = `
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_tint.rgb * sin(u_time * u_speed);
    fragColor = vec4(col, 1.0);
}
`
    const run = (target: string, extra: Record<string, unknown> = {}, source = base) =>
      transpile_shader_wasm({ shader_source: source, target, source_lang: "glsl", ...extra }) as string

    it("Unity URP ShaderLab", () => {
      const res = run("unity", { shader_name: "Custom/ParityTest" })
      for (const s of [
        'Shader "Custom/ParityTest"',
        '"RenderPipeline" = "UniversalPipeline"',
        '"LightMode" = "UniversalForward"',
        "TransformObjectToHClip(input.positionOS.xyz);",
        "TransformObjectToWorldNormal(input.normalOS);",
        "float4 frag(Varyings i) : SV_Target",
        "i.positionCS.xy",
        "_ScreenParams.xy",
        "_Time.y",
      ]) {
        expect(res).toContain(s)
      }
    })

    it("Godot 4 spatial shader", () => {
      const res = run("godot")
      for (const s of [
        "shader_type spatial;",
        "render_mode cull_back, diffuse_burley, specular_schlick_ggx;",
        "void fragment() {",
        "FRAGCOORD.xy",
        "VIEWPORT_SIZE",
        "TIME",
        "ALBEDO = fragColor.rgb;",
        "ALPHA = fragColor.a;",
      ]) {
        expect(res).toContain(s)
      }
    })

    it("Shadertoy GLSL ES 3.0", () => {
      const res = run("shadertoy")
      for (const s of ["void mainImage( out vec4 fragColor, in vec2 fragCoord )", "iResolution.xy", "fragCoord.xy", "iTime"]) {
        expect(res).toContain(s)
      }
    })

    it("keeps user identifiers that merely contain a keyword (token-boundary isolation)", () => {
      const shader = `
void main() {
    float custom_u_resolution = 1920.0;
    float my_u_time = 42.0;
    float super_gl_FragCoord = 1.0;
    float speed_resolution = 2.0;
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = vec3(sin(u_time * 2.0));
    fragColor = vec4(col, 1.0);
}
`
      const unity = run("unity", { shader_name: "TokenBoundaryTest" }, shader)
      for (const keep of ["custom_u_resolution", "my_u_time", "super_gl_FragCoord", "speed_resolution"]) expect(unity).toContain(keep)
      for (const bad of ["custom__ScreenParams.xy", "my__Time.y", "super_i.positionCS", "speed__ScreenParams.xy"]) expect(unity).not.toContain(bad)
      for (const real of ["_ScreenParams.xy", "_Time.y", "i.positionCS.xy"]) expect(unity).toContain(real)
      expect(run("godot", {}, shader)).toContain("FRAGCOORD.xy")
      expect(run("shadertoy", {}, shader)).toContain("iResolution.xy")
    })
  })

  describe("mesh normalizer (TS parseOBJ and normalize_*_wasm)", () => {
    const pyramid = `
v 0.0 1.0 0.0
v -1.0 -1.0 1.0
v 1.0 -1.0 1.0
v 1.0 -1.0 -1.0
v -1.0 -1.0 -1.0
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 2 5 4
f 2 4 3
`
    beforeEach(() => customModelRegistry.clearActiveModel())

    it("parseOBJ returns contiguous typed buffers with consistent counts and unit synthesized normals", () => {
      const p: ParsedGeometry = parseOBJ(pyramid, "pyramid.obj")
      expect(p.name).toBe("pyramid.obj")
      expect(p.positions).toBeInstanceOf(Float32Array)
      expect(p.normals).toBeInstanceOf(Float32Array)
      expect(p.uvs).toBeInstanceOf(Float32Array)
      expect(p.positions.length % 3).toBe(0)
      expect(p.uvs.length % 2).toBe(0)
      expect(p.vertexCount).toBe(p.positions.length / 3)
      expect(p.triangleCount).toBe(p.vertexCount / 3)
      expect(p.normals.length).toBe(p.positions.length)
      for (let i = 0; i < p.normals.length; i += 3) expect(Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2])).toBeCloseTo(1, 1)
    })

    it("parseOBJ centers on the origin and scales to radius ~1.2", () => {
      const cube = parseOBJ(
        `v 10 10 10\nv 12 10 10\nv 12 12 10\nv 10 12 10\nv 10 10 12\nv 12 10 12\nv 12 12 12\nv 10 12 12\nf 1 2 3\nf 1 3 4\nf 5 6 7\nf 5 7 8`,
        "cube.obj"
      )
      for (let axis = 0; axis < 3; axis++) {
        let mn = Infinity
        let mx = -Infinity
        for (let i = axis; i < cube.positions.length; i += 3) {
          mn = Math.min(mn, cube.positions[i])
          mx = Math.max(mx, cube.positions[i])
        }
        expect(Math.abs((mn + mx) / 2)).toBeLessThan(0.01)
      }
      expect(maxRadius(parseOBJ("v -1000 -1000 0\nv 1000 -1000 0\nv 0 1000 0\nf 1 2 3", "huge.obj").positions)).toBeCloseTo(1.2, 1)
    })

    it("customModelRegistry notifies subscribers on set/clear", () => {
      expect(customModelRegistry.getActiveModel()).toBeNull()
      expect(customModelRegistry.hasCustomModel()).toBe(false)
      const events: Array<string | null> = []
      const unsub = customModelRegistry.subscribe((m) => events.push(m ? m.name : null))
      customModelRegistry.setActiveModel(parseOBJ(pyramid, "pyramid.obj"))
      expect(customModelRegistry.hasCustomModel()).toBe(true)
      expect(customModelRegistry.getActiveModel()?.name).toBe("pyramid.obj")
      customModelRegistry.clearActiveModel()
      expect(customModelRegistry.getActiveModel()).toBeNull()
      unsub()
      expect(events).toEqual(["pyramid.obj", null])
    })

    it("WASM and TS agree on buffer sizes and both center offset meshes", () => {
      const obj = "v 10 10 10\nv 12 10 10\nv 12 12 10\nf 1 2 3"
      const ts = parseOBJ(obj, "offset.obj")
      const w = normalize_obj_wasm(obj, "offset.obj")
      expect(w.name).toBe("offset.obj")
      expect(w.positions.length).toBe(ts.positions.length)
      expect(w.normals.length).toBe(ts.normals.length)
      let mn = Infinity
      let mx = -Infinity
      for (let i = 0; i < w.positions.length; i += 3) {
        mn = Math.min(mn, w.positions[i])
        mx = Math.max(mx, w.positions[i])
      }
      expect(Math.abs((mn + mx) / 2)).toBeLessThan(0.01)
    })

    it("fan-triangulates n-gons (quad -> 2, hexagon -> 4 triangles) and centers them", () => {
      const hex = normalize_obj_wasm("v 0 0 0\nv 1 0 0\nv 1.5 0.866 0\nv 1 1.732 0\nv 0 1.732 0\nv -0.5 0.866 0\nf 1 2 3 4 5 6", "hexagon.obj")
      expect([hex.triangle_count, hex.vertex_count, hex.positions.length, hex.normals.length]).toEqual([4, 12, 36, 36])
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0
        for (let i = axis; i < hex.positions.length; i += 3) sum += hex.positions[i]
        expect(Math.abs(sum / hex.vertex_count)).toBeLessThan(0.1)
      }

      const two = normalize_obj_wasm(
        "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\nv 2 0 0\nv 3 0 0\nv 3.5 1 0\nv 3 2 0\nv 2 2 0\nv 1.5 1 0\nf 5 6 7 8 9 10",
        "ngon.obj"
      )
      expect([two.vertex_count, two.triangle_count, two.positions.length]).toEqual([18, 6, 54])
    })

    it("keeps right-hand winding (+Z for CCW, -Z for CW) and orthogonal normals", () => {
      const ccw = new Float32Array(normalize_obj_wasm("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3", "ccw.obj").normals)
      const cw = new Float32Array(normalize_obj_wasm("v 0 0 0\nv 0 1 0\nv 1 0 0\nf 1 2 3", "cw.obj").normals)
      for (let v = 0; v < 3; v++) {
        expect([ccw[v * 3], ccw[v * 3 + 1]].map((x) => Math.abs(x))).toEqual([0, 0].map(() => expect.closeTo(0, 4)))
        expect(ccw[v * 3 + 2]).toBeCloseTo(1, 4)
        expect(cw[v * 3 + 2]).toBeCloseTo(-1, 4)
      }

      const p0 = [2.5, -1.8, 4.2]
      const p1 = [-3.1, 5.4, 0.9]
      const p2 = [1.0, 0.5, -6.3]
      const res = normalize_obj_wasm(`v ${p0.join(" ")}\nv ${p1.join(" ")}\nv ${p2.join(" ")}\nf 1 2 3`, "tri3d.obj")
      const n = new Float32Array(res.normals)
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      expect(Math.abs(dot([n[0], n[1], n[2]], sub(p1, p0)))).toBeLessThan(1e-4)
      expect(Math.abs(dot([n[0], n[1], n[2]], sub(p2, p0)))).toBeLessThan(1e-4)
    })

    it("falls back to an up-vector normal for zero-area triangles", () => {
      const norm = new Float32Array(normalize_obj_wasm("v 5 5 5\nv 5 5 5\nv 5 5 5\nf 1 2 3", "degen.obj").normals)
      for (let i = 0; i < norm.length; i += 3) {
        expect(norm.slice(i, i + 3).every(Number.isFinite)).toBe(true)
        expect(norm[i + 1]).toBe(1.0)
      }
    })

    it("centers extreme offsets and rescales micro / astronomical meshes to radius ~1.2", () => {
      const pos = new Float32Array(normalize_obj_wasm("v 10000 20000 30000\nv 10010 20000 30000\nv 10000 20020 30000\nf 1 2 3", "offset.obj").positions)
      for (let axis = 0; axis < 3; axis++) {
        let mn = Infinity
        let mx = -Infinity
        for (let i = axis; i < pos.length; i += 3) {
          mn = Math.min(mn, pos[i])
          mx = Math.max(mx, pos[i])
        }
        expect(Math.abs((mn + mx) / 2)).toBeLessThan(1e-3)
      }
      const micro = normalize_obj_wasm("v -0.000001 -0.000001 0\nv 0.000001 -0.000001 0\nv 0 0.000001 0\nf 1 2 3", "micro.obj")
      const astro = normalize_obj_wasm("v -1000000 -1000000 0\nv 1000000 -1000000 0\nv 0 1000000 0\nf 1 2 3", "astro.obj")
      expect(maxRadius(new Float32Array(micro.positions))).toBeCloseTo(1.2, 2)
      expect(maxRadius(new Float32Array(astro.positions))).toBeCloseTo(1.2, 2)
    })

    it("normalize_geometry_wasm takes raw Float32Arrays and rejects bad input", () => {
      const r = normalize_geometry_wasm(new Float32Array([-100, -100, 0, 100, -100, 0, 0, 100, 0]), null, null, "triangle")
      expect(r.name).toBe("triangle")
      expect([r.positions.length, r.normals.length, r.uvs.length]).toEqual([9, 9, 6])
      expect(maxRadius(r.positions)).toBeCloseTo(1.2, 1)

      expect(() => normalize_obj_wasm("", "empty.obj")).toThrow(/No vertices found/)
      expect(() => normalize_obj_wasm("# Just comments\n# Line 2", "comments.obj")).toThrow(/No vertices found/)
      expect(() => normalize_geometry_wasm(new Float32Array([1, 2]), null, null, "bad")).toThrow(/multiple of 3/)
    })

    it("processes ~105k-vertex OBJ and 150k raw vertices fast, with unit normals and finite positions", () => {
      const lines: string[] = []
      const tris = 35000
      for (let i = 0; i < tris; i++) {
        const x = (i % 100) * 0.1
        const y = Math.floor(i / 100) * 0.1
        const z = Math.sin(i * 0.02) * 4.0
        lines.push(`v ${x} ${y} ${z}`, `v ${x + 0.1} ${y} ${z}`, `v ${x} ${y + 0.1} ${z + 0.05}`)
      }
      for (let i = 0; i < tris; i++) lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`)

      const t0 = performance.now()
      const r = normalize_obj_wasm(lines.join("\n"), "stress.obj")
      expect(performance.now() - t0).toBeLessThan(1000)
      expect([r.vertex_count, r.triangle_count, r.positions.length, r.normals.length, r.uvs.length]).toEqual([105000, 35000, 315000, 315000, 210000])
      const nb = new Float32Array(r.normals)
      for (let i = 0; i < 300; i += 3) expect(Math.hypot(nb[i], nb[i + 1], nb[i + 2])).toBeCloseTo(1, 3)
      expect(new Float32Array(r.positions).subarray(0, 300).every(Number.isFinite)).toBe(true)

      const raw = new Float32Array(150000 * 3)
      for (let i = 0; i < 150000; i++) {
        raw[i * 3] = (i % 200) * 2 - 500
        raw[i * 3 + 1] = Math.floor(i / 200) * 1.5 - 300
        raw[i * 3 + 2] = Math.cos(i * 0.01) * 50
      }
      const g = normalize_geometry_wasm(raw, null, null, "raw_150k")
      expect([g.vertex_count, g.triangle_count, g.positions.length, g.uvs.length]).toEqual([150000, 50000, 450000, 300000])
      const gn = new Float32Array(g.normals)
      for (let i = 0; i < 300; i += 3) expect(Math.hypot(gn[i], gn[i + 1], gn[i + 2])).toBeCloseTo(1, 3)
    })
  })

  describe("wasmEngine client bridge (headless fallback)", () => {
    it("reports status and runs without a Worker", async () => {
      const s = wasmEngine.getStatus()
      expect(typeof s.hasWebAssembly).toBe("boolean")
      expect(s.hasWorker).toBe(false)
      expect(s.usingFallback).toBe(true)
      expect(await wasmEngine.init()).toBe(false)
    })

    it("bakes PBR maps through the fallback and returns a PKZIP archive", async () => {
      const w = 8
      const h = 8
      const res = await wasmEngine.bakePbr(new Uint8Array(gradientPixels(w, h)), w, h, {
        normalStrength: 2.0,
        invertNormalY: true,
        metallicMode: "auto",
        aoStrength: 1.0,
      })
      expect([res.width, res.height]).toEqual([w, h])
      for (const k of ["albedo_png", "normal_png", "roughness_png", "height_png", "metallic_png", "ao_png"] as const) {
        expect(res[k].length).toBe(w * h * 4)
      }
      expect([...res.zip_archive.subarray(0, 4)]).toEqual(PK)
      expect(res.zip_archive.length).toBeGreaterThan(50)
    })

    it("transpiles to unity / godot / shadertoy", async () => {
      const src = "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; vec3 col = u_color.rgb * sin(u_time); fragColor = vec4(col, 1.0); }"
      const unity = await wasmEngine.transpileShader(src, "unity", { shaderName: "Custom/EngineTest" })
      expect(unity).toContain('Shader "Custom/EngineTest"')
      expect(unity).toContain("UniversalPipeline")
      const godot = await wasmEngine.transpileShader(src, "godot")
      expect(godot).toContain("shader_type spatial;")
      expect(godot).toContain("TIME")
      const st = await wasmEngine.transpileShader(src, "shadertoy")
      expect(st).toContain("void mainImage(")
      expect(st).toContain("iTime")
    })

    it("reflects uniforms and normalizes meshes through the fallback", async () => {
      const u = await wasmEngine.reflectUniforms(
        "@group(0) @binding(0) var<uniform> u_color: vec4f;\n@fragment fn fs_main() -> @location(0) vec4f { return u_color; }",
        "wgsl"
      )
      expect(u[0].name).toBe("u_color")

      const obj = await wasmEngine.normalizeObj("v -5 -5 0\nv 5 -5 0\nv 0 5 0\nf 1 2 3", "test.obj")
      expect(obj.name).toBe("test.obj")
      expect(obj.positions).toBeInstanceOf(Float32Array)
      expect([obj.positions.length, obj.normals.length, obj.vertexCount, obj.triangleCount]).toEqual([9, 9, 3, 1])

      const geo = await wasmEngine.normalizeGeometry(new Float32Array([-10, -10, 0, 10, -10, 0, 0, 10, 0]), undefined, undefined, "raw_fallback")
      expect(geo.name).toBe("raw_fallback")
      expect(geo.vertexCount).toBe(3)
      expect(maxRadius(geo.positions)).toBeCloseTo(1.2, 1)
    })

    it("dispose() resets state without hanging", () => {
      wasmEngine.dispose()
      const s = wasmEngine.getStatus()
      expect(s.isInitialized).toBe(false)
      expect(s.usingFallback).toBe(true)
    })
  })
})
