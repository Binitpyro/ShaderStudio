import { describe, it, expect } from "vitest"
import { parseGlslUniforms } from "../glslUniforms"
import { parseWgslUniforms } from "../wgslUniforms"

describe("parseGlslUniforms", () => {
  it("parses standard GLSL uniforms", () => {
    const glsl = `
      uniform mat4 u_mvp;
      uniform vec3 u_color;
      uniform float u_speed;
      uniform bool u_active;
    `
    const uniforms = parseGlslUniforms(glsl)
    const names = uniforms.map((u) => u.name)
    expect(names).toContain("u_color")
    expect(names).toContain("u_speed")
    expect(names).toContain("u_active")

    const color = uniforms.find((u) => u.name === "u_color")
    expect(color?.kind).toBe("color")
    expect(color?.type).toBe("vec3f")

    const speed = uniforms.find((u) => u.name === "u_speed")
    expect(speed?.kind).toBe("scalar")
    expect(speed?.type).toBe("f32")

    // Matrix reflection test
    const mvp = uniforms.find((u) => u.name === "u_mvp")
    expect(mvp).toBeDefined()
    expect(mvp?.kind).toBe("matrix")
    expect(mvp?.type).toBe("mat4x4f")
  })

  it("parses GLSL uniforms with precision qualifiers (highp, mediump, lowp)", () => {
    const glsl = `
      #version 300 es
      precision highp float;
      uniform mediump vec3 u_color;
      uniform highp float u_roughness;
      uniform lowp sampler2D u_albedo;
    `
    const uniforms = parseGlslUniforms(glsl)
    const names = uniforms.map((u) => u.name)
    expect(names).toContain("u_color")
    expect(names).toContain("u_roughness")
    expect(names).toContain("u_albedo")

    const albedo = uniforms.find((u) => u.name === "u_albedo")
    expect(albedo?.kind).toBe("texture")
  })

  it("parses GLSL matrix types (mat4, mat3, mat2)", () => {
    const glsl = `
      uniform mat4 u_modelViewProj;
      uniform mat3 u_normalMatrix;
      uniform mat2 u_rotation2d;
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms).toHaveLength(3)
    expect(uniforms[0]).toMatchObject({ name: "u_modelViewProj", type: "mat4x4f", kind: "matrix" })
    expect(uniforms[1]).toMatchObject({ name: "u_normalMatrix", type: "mat3x3f", kind: "matrix" })
    expect(uniforms[2]).toMatchObject({ name: "u_rotation2d", type: "mat2x2f", kind: "matrix" })
  })

  it("parses GLSL uniform blocks with anonymous and named instances", () => {
    const glsl = `
      layout(std140) uniform CameraBlock {
        mat4 viewMatrix;
        mat4 projMatrix;
      };

      uniform LightBlock {
        vec3 lightPos;
        vec4 lightColor;
      } u_light;
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms.find((u) => u.name === "viewMatrix")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "projMatrix")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "u_light.lightPos")).toMatchObject({ type: "vec3f", kind: "vector" })
    expect(uniforms.find((u) => u.name === "u_light.lightColor")).toMatchObject({ type: "vec4f", kind: "color" })
  })

  it("parses GLSL structs declared and used as uniforms", () => {
    const glsl = `
      struct Material {
        vec3 albedo;
        float roughness;
      };
      uniform Material u_mat;
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms.find((u) => u.name === "u_mat.albedo")).toMatchObject({ type: "vec3f", kind: "color" })
    expect(uniforms.find((u) => u.name === "u_mat.roughness")).toMatchObject({ type: "f32", kind: "scalar" })
  })

  it("strips comments in GLSL without breaking uniform reflection", () => {
    const glsl = `
      /* Multi-line comment
         uniform float ignored;
      */
      uniform float u_valid; // Inline comment with ; uniform vec3 fake;
      // uniform float commentedOut;
      uniform vec2 u_offset;
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms.map((u) => u.name)).toEqual(["u_valid", "u_offset"])
  })

  it("parses GLSL shader with 6+ mixed fields (Acceptance Criterion R1)", () => {
    const glsl = `
      uniform float u_speed;
      uniform vec2 u_scale;
      uniform vec3 u_color;
      uniform vec4 u_offset;
      uniform mat4 u_mvp;
      uniform bool u_enabled;
      uniform int u_count;
    `
    const uniforms = parseGlslUniforms(glsl)
    expect(uniforms).toHaveLength(7)
    expect(uniforms.find((u) => u.name === "u_speed")).toMatchObject({ type: "f32", kind: "scalar" })
    expect(uniforms.find((u) => u.name === "u_scale")).toMatchObject({ type: "vec2f", kind: "vector" })
    expect(uniforms.find((u) => u.name === "u_color")).toMatchObject({ type: "vec3f", kind: "color" })
    expect(uniforms.find((u) => u.name === "u_offset")).toMatchObject({ type: "vec4f", kind: "vector" })
    expect(uniforms.find((u) => u.name === "u_mvp")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "u_enabled")).toMatchObject({ type: "bool", kind: "scalar" })
    expect(uniforms.find((u) => u.name === "u_count")).toMatchObject({ type: "i32", kind: "scalar" })
  })
})

describe("parseWgslUniforms", () => {
  it("parses structs containing WGSL uniform members", () => {
    const wgsl = `
      struct Uniforms {
        mvp: mat4x4<f32>,
        color: vec3<f32>,
        speed: f32,
        active: bool,
      };
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    `
    const uniforms = parseWgslUniforms(wgsl)
    const names = uniforms.map((u) => u.name)
    expect(names).toContain("color")
    expect(names).toContain("speed")
    expect(names).toContain("active")

    const color = uniforms.find((u) => u.name === "color")
    expect(color?.kind).toBe("color")
    expect(color?.type).toBe("vec3f")

    const speed = uniforms.find((u) => u.name === "speed")
    expect(speed?.kind).toBe("scalar")
    expect(speed?.type).toBe("f32")

    // Matrix reflection test
    const mvp = uniforms.find((u) => u.name === "mvp")
    expect(mvp).toBeDefined()
    expect(mvp?.kind).toBe("matrix")
    expect(mvp?.type).toBe("mat4x4f")
  })

  it("parses top-level module var uniform declarations", () => {
    const wgsl = `
      @group(0) @binding(0) var<uniform> u_color: vec3f;
      @group(0) @binding(1) var<uniform> u_scale: f32;
      @group(0) @binding(2) var u_tex: texture_2d<f32>;
    `
    const uniforms = parseWgslUniforms(wgsl)
    const names = uniforms.map((u) => u.name)
    expect(names).toContain("u_color")
    expect(names).toContain("u_scale")
    expect(names).toContain("u_tex")
  })

  it("parses WGSL matrices in both shorthand and template syntax", () => {
    const wgsl = `
      struct Transform {
        m4: mat4x4<f32>,
        m4_short: mat4x4f,
        m3: mat3x3<f32>,
        m3_short: mat3x3f,
        m2: mat2x2<f32>,
        m2_short: mat2x2f,
      };
    `
    const uniforms = parseWgslUniforms(wgsl)
    expect(uniforms).toHaveLength(6)
    expect(uniforms.find((u) => u.name === "m4")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "m4_short")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "m3")).toMatchObject({ type: "mat3x3f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "m3_short")).toMatchObject({ type: "mat3x3f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "m2")).toMatchObject({ type: "mat2x2f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "m2_short")).toMatchObject({ type: "mat2x2f", kind: "matrix" })
  })

  it("strips comments in WGSL source", () => {
    const wgsl = `
      /* Multi-line comment
         struct Ignored { val: f32, };
      */
      struct Params {
        speed: f32, // inline comment
        // count: i32,
        scale: vec2f,
      };
    `
    const uniforms = parseWgslUniforms(wgsl)
    expect(uniforms.map((u) => u.name)).toEqual(["speed", "scale"])
  })

  it("parses WGSL struct with 6+ mixed fields (Acceptance Criterion R1)", () => {
    const wgsl = `
      struct MixedUniforms {
        mvp: mat4x4f,
        color: vec3f,
        speed: f32,
        scale: vec2f,
        offset: vec4f,
        active: bool,
        count: u32,
      };
      @group(0) @binding(0) var<uniform> u: MixedUniforms;
    `
    const uniforms = parseWgslUniforms(wgsl)
    expect(uniforms).toHaveLength(7)
    expect(uniforms.find((u) => u.name === "mvp")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
    expect(uniforms.find((u) => u.name === "color")).toMatchObject({ type: "vec3f", kind: "color" })
    expect(uniforms.find((u) => u.name === "speed")).toMatchObject({ type: "f32", kind: "scalar" })
    expect(uniforms.find((u) => u.name === "scale")).toMatchObject({ type: "vec2f", kind: "vector" })
    expect(uniforms.find((u) => u.name === "offset")).toMatchObject({ type: "vec4f", kind: "vector" })
    expect(uniforms.find((u) => u.name === "active")).toMatchObject({ type: "bool", kind: "scalar" })
    expect(uniforms.find((u) => u.name === "count")).toMatchObject({ type: "u32", kind: "scalar" })
  })
})
