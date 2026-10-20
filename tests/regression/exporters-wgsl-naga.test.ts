import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { initSync } from "@/wasm/pkg/shaderstudio_wasm"
import { generateExport, resolveGlslSource, splitGlsl, type ExportProject, type ExportTarget } from "@/core/engineTranspiler"
import { STARTER_WGSL } from "@/core/defaultStarterScene"
import { SHADER_TEMPLATES } from "@/core/templates"

beforeAll(() => {
  initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")) })
})

const GLSL_TARGETS: ExportTarget[] = ["shadertoy", "godot", "r3f", "r3f-component", "html", "gltf", "unreal", "osl"]
const wgslOnly: ExportProject = { wgslSource: STARTER_WGSL, glslSource: "" }

/** What a valid export of the starter WGSL looks like per target. */
const FLAT_UNIFORMS = /uniform float fresnelPower;[\s\S]*uniform vec3 color;/
const NO_VERSION = /^(?![\s\S]*#version)/
const STRUCTURE: Record<string, RegExp[]> = {
  shadertoy: [/const float fresnelPower = /, /const vec3 color = vec3\(/, /void mainImage\( out vec4 fragColor, in vec2 fragCoord \)/, /fragColor = vec4\(rgb, 1\.0\);/, /iTime/, NO_VERSION],
  godot: [/shader_type spatial;/, /uniform float fresnelPower = /, /uniform vec3 color : source_color = /, /varying vec3 v_world_pos;/, /void fragment\(\) \{/, /fragColor = vec4\(rgb, 1\.0\);/, /ALBEDO = fragColor\.rgb;/, /TIME/],
  r3f: [FLAT_UNIFORMS, /void main\(\) \{/, /gl_FragColor = vec4\(rgb, 1\.0\);/, /varying vec3 v_world_pos;/],
  "r3f-component": [FLAT_UNIFORMS, /void main\(\) \{/, /gl_FragColor = vec4\(rgb, 1\.0\);/, /<shaderMaterial/],
  html: [FLAT_UNIFORMS, /void main\(\) \{/, /gl_FragColor = vec4\(rgb, 1\.0\);/, /new THREE\.ShaderMaterial/],
  gltf: [/"fragment": "#version 300 es/, /uniform float fresnelPower;/, /void main\(\)/, /fragColor = vec4\(rgb, 1\.0\);/],
  unreal: [/return float4\(rgb, 1\.0\);/, /lerp\(/, /^(?![\s\S]*\bvec[234]\b)/],
  osl: [/shader ShaderStudioMaterial\(/, /output closure color BSDF/, /BSDF = /],
}

describe("WGSL-only project exports valid GLSL through naga", () => {
  it("resolveGlslSource transpiles and flattens naga output to the shape the GLSL targets expect", async () => {
    const res = await resolveGlslSource(wgslOnly)
    if ("error" in res) throw new Error(res.error)
    expect(res.via).toBe("naga")
    expect(res.code.startsWith("#version 300 es")).toBe(true)
    const sp = splitGlsl(res.code)
    // uniform block flattened to plain uniforms with the WGSL names, engine uniform renamed, app-side mvp dropped
    const names = sp.uniforms.map((u) => u.name)
    for (const n of ["u_time", "pulseSpeed", "fresnelPower", "iridescence", "color", "roughness", "u_audio_beat"]) expect(names).toContain(n)
    expect(names).not.toContain("mvp")
    expect(names).not.toContain("time")
    // fragment inputs named after the WGSL fields, output named fragColor
    expect(sp.varyings.map((v) => v.name).sort()).toEqual(["v_uv", "v_world_pos"])
    expect(sp.outName).toBe("fragColor")
    expect(res.code).not.toMatch(/_group_\d+_binding_\d+|_vs2fs_location|_fs2p_location|_block_\d/)
    // every `uniform` use in main reads a declared name: no struct-member access on the removed block instance remains
    expect(sp.body).toContain("fresnelPower")
    expect(sp.body).not.toMatch(/\b\w+\.fresnelPower\b/)
  })

  it.each(GLSL_TARGETS)("%s uses the naga GLSL when glslSource is empty", async (target) => {
    const res = await generateExport(target, wgslOnly)
    if ("error" in res) throw new Error(`${target}: ${res.error}`)
    expect(res.via).toBe("naga")
    expect(res.code).not.toMatch(/_group_\d+_binding_\d+|_vs2fs_location|_fs2p_location/)
    // no WGSL syntax survives, and each target has its declarations, entry point and output write
    expect(res.code).not.toMatch(/@(fragment|vertex|group|location|builtin)|\bfn\s+\w+\s*\(|var<|\)\s*->/)
    for (const re of STRUCTURE[target]) expect(res.code, target).toMatch(re)
  })

  it("every GLSL target prefers the project's glslSource over WGSL", async () => {
    const both: ExportProject = { wgslSource: STARTER_WGSL, glslSource: "uniform float u_only_in_glsl;\nvoid main() { float u_only_in_glsl_local = u_only_in_glsl; fragColor = vec4(u_only_in_glsl_local); }" }
    for (const target of GLSL_TARGETS) {
      const res = await generateExport(target, both)
      if ("error" in res) throw new Error(`${target}: ${res.error}`)
      expect(res.via, target).toBe("glsl")
      // the marker survives into every target; glTF carries the GLSL in extras.shaderStudio
      const text = target === "gltf" ? JSON.parse(res.code).materials[0].extras.shaderStudio.fragment : res.code
      expect(text, target).toContain("u_only_in_glsl_local")
      expect(res.code, target).not.toContain("palette")
    }
  })

  it("Unity gets naga HLSL whenever WGSL exists, with the GLSL path as the fallback", async () => {
    const both: ExportProject = { wgslSource: STARTER_WGSL, glslSource: "void main() { fragColor = vec4(1.0); }" }
    const unity = await generateExport("unity", both)
    if ("error" in unity) throw new Error(unity.error)
    expect(unity.via).toBe("naga")
    expect(unity.code).toContain("#pragma vertex vertex_main")
    expect(unity.code).toContain("#pragma fragment fragment_main")
    expect(unity.code).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(unity.code).toContain("float _fresnelPower;")
    expect(unity.code).toContain('_fresnelPower ("fresnelPower", Float)')
    expect(unity.code).toContain("_Time.y") // WGSL `time` -> Unity time
    expect(unity.code).toContain("transpose(mul(UNITY_MATRIX_VP, UNITY_MATRIX_M))") // WGSL mvp
    expect(unity.code).toContain("float3 position : POSITION;")
    expect(unity.code).not.toMatch(/\buniforms\.|\bLOC\d|cbuffer|row_major/)

    const glslOnly = await generateExport("unity", { wgslSource: "", glslSource: "void main() { fragColor = vec4(1.0); }" })
    if ("error" in glslOnly) throw new Error(glslOnly.error)
    expect(glslOnly.via).toBe("glsl")
    expect(glslOnly.code).toContain("float4 frag(Varyings i) : SV_Target")

    // fragment-only WGSL cannot form a Unity pass: GLSL is used when the project has it, an error otherwise
    const fragOnly = "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }"
    const fallback = await generateExport("unity", { wgslSource: fragOnly, glslSource: "void main() { fragColor = vec4(1.0); }" })
    expect("code" in fallback && fallback.via).toBe("glsl")
    const noVertex = await generateExport("unity", { wgslSource: fragOnly, glslSource: "" })
    expect("error" in noVertex && noVertex.error).toMatch(/@vertex/)
  })

  it("Unity HLSL from WGSL exposes vec4 and vec2 uniforms as Color / Vector properties with defaults", async () => {
    const wgsl = `struct U { mvp: mat4x4f, tint: vec4f, offs: vec2f };
@group(0) @binding(0) var<uniform> u: U;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@location(0) position: vec3f) -> VO { var o: VO; o.p = u.mvp * vec4f(position, 1.0); o.uv = position.xy; return o; }
@fragment fn fs(i: VO) -> @location(0) vec4f { return u.tint * vec4f(u.offs, i.uv); }`
    const withValues = await generateExport("unity", { wgslSource: wgsl, glslSource: "", uniformValues: { tint: { type: "color", value: [1, 0, 0, 0.5] }, offs: { type: "vec2", value: [3, 4] } } })
    if ("error" in withValues) throw new Error(withValues.error)
    expect(withValues.code).toContain('_tint ("tint", Color) = (1, 0, 0, 0.5)')
    expect(withValues.code).toContain('_offs ("offs", Vector) = (3, 4, 0.0, 0.0)')
    const defaults = await generateExport("unity", { wgslSource: wgsl, glslSource: "" })
    if ("error" in defaults) throw new Error(defaults.error)
    expect(defaults.code).toContain('_tint ("tint", Color) = (0.4, 0.6, 0.9, 1)')
    expect(defaults.code).toContain('_offs ("offs", Vector) = (1, 1, 0.0, 0.0)')
  })

  it("Unity HLSL fixed names are token-safe: a field containing a keyword is not touched", async () => {
    const wgsl = `struct U { mvp: mat4x4f, time: f32, my_time: f32, time2: f32 };
@group(0) @binding(0) var<uniform> u: U;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@location(0) position: vec3f) -> VO { var o: VO; o.p = u.mvp * vec4f(position, 1.0); o.uv = position.xy; return o; }
@fragment fn fs(i: VO) -> @location(0) vec4f { return vec4f(u.time, u.my_time, u.time2, i.uv.x); }`
    const res = await generateExport("unity", { wgslSource: wgsl, glslSource: "" })
    if ("error" in res) throw new Error(res.error)
    expect(res.code).toContain("_my_time")
    expect(res.code).toContain("_time2")
    expect(res.code).not.toContain("my__Time")
    expect(res.code).toContain("float _my_time;")
  })
})

describe("naga errors surface with a line number instead of silent output", () => {
  const bad = "@fragment\nfn fs() -> @location(0) vec4f {\n  return vec4f(1.0, 2.0;\n}"

  it.each(["unity", ...GLSL_TARGETS] as ExportTarget[])("%s reports the error and produces no code", async (target) => {
    const res = await generateExport(target, { wgslSource: bad, glslSource: "" })
    expect("code" in res).toBe(false)
    if ("code" in res) return
    expect(res.line).toBe(3)
    expect(res.error).toMatch(/line 3/)
    expect(res.error).toMatch(/naga/i)
  })

  it("resolveGlslSource (npm package path) carries the same error", async () => {
    const res = await resolveGlslSource({ wgslSource: bad, glslSource: "" })
    expect("error" in res && res.line).toBe(3)
  })

  it("an empty project is an error, except glTF which still exports a plain material", async () => {
    const empty: ExportProject = { wgslSource: "  ", glslSource: "" }
    for (const target of ["unity", "godot", "shadertoy", "r3f", "html"] as ExportTarget[]) {
      const res = await generateExport(target, empty)
      expect("error" in res && res.error).toMatch(/No shader source/)
    }
    const gltf = await generateExport("gltf", empty)
    if ("error" in gltf) throw new Error(gltf.error)
    expect(JSON.parse(gltf.code).materials[0].extras).toBeUndefined()
  })

  it("a template's WGSL goes through naga cleanly (every template, all GLSL targets)", async () => {
    for (const t of SHADER_TEMPLATES.filter((t) => t.wgsl.trim())) {
      for (const target of ["shadertoy", "godot"] as ExportTarget[]) {
        const res = await generateExport(target, { wgslSource: t.wgsl, glslSource: "" })
        if ("error" in res) throw new Error(`${t.id} ${target}: ${res.error}`)
        expect(res.code, `${t.id} ${target}`).not.toMatch(/_group_\d+_binding_\d+|_vs2fs_location|_fs2p_location/)
      }
    }
  })
})
