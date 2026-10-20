import { describe, it, expect } from "vitest"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
  transpileToUE5,
  transpileToBlenderOSL,
  generateHtmlEmbed,
  generateR3FExport,
  generateR3FComponent,
  generateNpmPackage,
  rewriteIdentifiers,
  threeGeometry,
  generateExport,
} from "@/core/engineTranspiler"
import { buildThreeVertexShader, varyingKind, atanRule } from "@/core/r3fExporter"
import type { ParsedUniform } from "@/stores/projectStore"

const VARYING_SRC = `#version 300 es
precision highp float;
in vec3 v_world_pos;
in vec2 v_uv;
in vec3 v_normal;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = vec4(v_world_pos * v_normal, v_uv.x) + v_color; }`

describe("u_mouse", () => {
  const src = "void main() { vec2 m = u_mouse.xy / u_resolution.xy; fragColor = vec4(m, 0.0, 1.0); }"

  it("Unity exposes it as a _Mouse Vector property + cbuffer float4, with no undefined identifier left", () => {
    const hlsl = transpileToUnityHLSL({ shaderSource: src })
    expect(hlsl).toContain('_Mouse ("Mouse", Vector) = (0, 0, 0, 0)')
    expect(hlsl).toContain("float4 _Mouse;")
    expect(hlsl).toContain("float2 m = _Mouse.xy / _ScreenParams.xy;")
    expect(hlsl).not.toContain("u_mouse")
  })

  it("Unity declares nothing when the shader does not read it", () => {
    expect(transpileToUnityHLSL({ shaderSource: "void main() { fragColor = vec4(1.0); }" })).not.toContain("_Mouse")
  })

  it("Godot declares a vec2 uniform for it; Shadertoy maps it to iMouse", () => {
    const g = transpileToGodotShader({ shaderSource: src })
    expect(g).toContain("uniform vec2 u_mouse = vec2(0.0);")
    expect(transpileToGodotShader({ shaderSource: "void main() {}" })).not.toContain("u_mouse")
    expect(transpileToShadertoy({ shaderSource: src })).toContain("iMouse.xy / iResolution.xy")
  })
})

describe("varyings map per target", () => {
  it("classifies varyings by name and type", () => {
    expect(varyingKind({ type: "vec3", name: "v_world_pos" })).toBe("position")
    expect(varyingKind({ type: "vec2", name: "v_uv" })).toBe("uv")
    expect(varyingKind({ type: "vec3", name: "v_normal" })).toBe("normal")
    expect(varyingKind({ type: "vec4", name: "v_color" })).toBe("other")
    expect(varyingKind({ type: "vec3", name: "uv" })).toBe("other")
  })

  it("Unity fills statics from the interpolated vertex output (unknown varyings stay zero)", () => {
    const h = transpileToUnityHLSL({ shaderSource: VARYING_SRC })
    for (const s of ["static float3 v_world_pos;", "static float4 v_color;", "v_world_pos = i.positionOS;", "v_uv = i.uv;", "v_normal = i.normalWS;"]) expect(h).toContain(s)
    expect(h).not.toContain("v_color = i.")
  })

  it("Godot assigns them in vertex()", () => {
    const g = transpileToGodotShader({ shaderSource: VARYING_SRC })
    for (const s of ["varying vec4 v_color;", "v_world_pos = VERTEX;", "v_uv = UV;", "v_normal = NORMAL;"]) expect(g).toContain(s)
    expect(g).not.toContain("v_color =")
  })

  it("Shadertoy derives them from fragCoord, zero-initialising unknown ones", () => {
    const t = transpileToShadertoy({ shaderSource: VARYING_SRC })
    for (const s of ["vec3 v_normal;", "v_normal = vec3(0.0, 0.0, 1.0);", "v_color = vec4(0.0);", "v_uv = fragCoord / iResolution.xy;"]) expect(t).toContain(s)
  })

  it("the three.js vertex shader writes every varying the fragment reads", () => {
    const v = buildThreeVertexShader(VARYING_SRC)
    for (const s of ["varying vec3 v_world_pos;", "v_world_pos = position;", "v_uv = uv;", "v_normal = normal;", "v_color = vec4(0.0);"]) expect(v).toContain(s)
    expect(buildThreeVertexShader("void main() {}")).toContain("vUv = uv;")
  })
})

describe("uniform declarations the caller did not list", () => {
  it("Unity/Godot/Shadertoy pick up declared textures, vectors and colours", () => {
    const src = "uniform sampler2D u_tex;\nuniform vec4 u_tint;\nuniform vec2 u_off;\nuniform float u_k[2];\nuniform mat4 u_m;\nvoid main() { fragColor = texture(u_tex, u_off) * u_tint; }"
    const h = transpileToUnityHLSL({ shaderSource: src })
    for (const s of ['_u_tex ("u_tex", 2D)', "sampler2D _u_tex;", "float4 _u_tint;", "float2 _u_off;", "tex2D(_u_tex, _u_off)"]) expect(h).toContain(s)
    expect(h).not.toContain("_u_k")
    expect(h).not.toContain("_u_m")
    expect(transpileToGodotShader({ shaderSource: src })).toContain("uniform sampler2D u_tex : source_color;")
    expect(transpileToShadertoy({ shaderSource: src })).toContain("iChannel0")
  })
})

describe("geometry", () => {
  it.each([
    ["cube", "BoxGeometry(2, 2, 2)", "<boxGeometry"],
    ["sphere", "SphereGeometry(1, 32, 32)", "<sphereGeometry"],
    ["plane", "PlaneGeometry(2, 2)", "<planeGeometry"],
    ["torus_knot", "TorusKnotGeometry(", "<torusKnotGeometry"],
  ] as const)("%s reaches the HTML embed, R3F component and drei module", (g, js, jsx) => {
    expect(threeGeometry(g).note).toBe("")
    const src = "void main() { gl_FragColor = vec4(1.0); }"
    expect(generateHtmlEmbed({ shaderSource: src, geometry: g })).toContain(js)
    expect(generateR3FComponent({ shaderSource: src, geometry: g })).toContain(jsx)
    expect(generateR3FExport("G", { shaderSource: src, geometry: g })).toContain(jsx)
  })

  it("a plane embed does not spin; others do", () => {
    const src = "void main() { gl_FragColor = vec4(1.0); }"
    expect(generateHtmlEmbed({ shaderSource: src, geometry: "plane" })).not.toContain("mesh.rotation.y")
    expect(generateHtmlEmbed({ shaderSource: src, geometry: "cube" })).toContain("mesh.rotation.y")
    expect(generateHtmlEmbed({ shaderSource: src })).toContain("TorusKnotGeometry")
  })

  it("a custom model falls back to a torus knot with an explanatory comment", () => {
    const src = "void main() { gl_FragColor = vec4(1.0); }"
    expect(generateHtmlEmbed({ shaderSource: src, geometry: "custom" })).toMatch(/\/\/ custom model: not embedded[^\n]*\n\s*var mesh = new THREE\.Mesh\(new THREE\.TorusKnotGeometry/)
    expect(generateR3FComponent({ shaderSource: src, geometry: "custom" })).toContain("{/* custom model: not embedded")
  })

  it("flows from the project through generateExport", async () => {
    const res = await generateExport("html", { glslSource: "void main() { gl_FragColor = vec4(1.0); }", geometry: "sphere" })
    expect("code" in res && res.code).toContain("SphereGeometry(1, 32, 32)")
    const comp = await generateExport("r3f-component", { glslSource: "void main() { gl_FragColor = vec4(1.0); }", geometry: "cube" })
    expect("code" in comp && comp.code).toContain("<boxGeometry")
  })
})

describe("R3F component and npm package uniforms", () => {
  const uniforms: ParsedUniform[] = [
    { name: "u_tint", type: "vec4f", kind: "vector" },
    { name: "u_off", type: "vec2f", kind: "vector" },
    { name: "u_on", type: "bool", kind: "scalar" },
    { name: "u_k", type: "f32", kind: "scalar" },
    { name: "u_col", type: "vec3f", kind: "color" },
  ]
  const uniformValues = { u_k: { type: "float" as const, value: 2 }, u_on: { type: "bool" as const, value: true } }

  it("component: typed props and initial values", () => {
    const c = generateR3FComponent({ shaderSource: "void main() { gl_FragColor = vec4(1.0); }", uniforms, uniformValues })
    for (const s of ["u_tint?: [number, number, number, number]", "u_off?: [number, number]", "u_on?: boolean", "u_k?: number", "u_col?: THREE.ColorRepresentation", "u_k: { value: 2 },", "u_on: { value: 1 },"]) expect(c).toContain(s)
  })

  it("npm package initialises extra uniforms on the material", () => {
    const pkg = generateNpmPackage("@s/x", "void main() { gl_FragColor = vec4(1.0); }", { uniforms, uniformValues })
    expect(pkg.indexTs).toContain("u_k: { value: 2 },")
    expect(pkg.indexTs).toContain("u_tint: { value: new THREE.Vector4(0, 0, 0, 1) },")
  })

  it("npm package: GLSL ES 3.00 output is converted and its vertex shader feeds the varyings", () => {
    const pkg = generateNpmPackage("@s/x", VARYING_SRC)
    expect(pkg.indexTs).not.toContain("#version")
    expect(pkg.indexTs).toContain("gl_FragColor")
    expect(pkg.indexTs).toContain("v_world_pos = position;")
  })
})

describe("remaining transpiler branches", () => {
  it("UE5 and OSL accept (source, options) and options-only forms", () => {
    const options = { shaderSource: "float a = 1.0;", uniformValues: { u_x: { type: "float" as const, value: 1 } } }
    expect(transpileToUE5("float a = 1.0;", options).parameters.map((p) => p.name)).toEqual(["u_x"])
    expect(transpileToBlenderOSL("float a = 1.0;", options)).toContain("float u_x")
  })

  it("OSL closes a `col` variable into BSDF", () => {
    expect(transpileToBlenderOSL("vec3 col = vec3(1.0, 0.0, 0.0);", [])).toContain("BSDF = col * diffuse(N);")
  })

  it("atan rule leaves a bare `atan` identifier and unbalanced calls alone", () => {
    expect(rewriteIdentifiers("float atan = 1.0; atan(1.0", { atan: atanRule })).toBe("float atan = 1.0; atan(1.0")
  })

  it("unknown export targets are an error", async () => {
    const res = await generateExport("nope" as never, { glslSource: "void main() {}" })
    expect("error" in res && res.error).toMatch(/Unknown export target/)
  })
})
