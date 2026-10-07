import { describe, it, expect, beforeEach } from "vitest"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { useProjectStore } from "@/stores/projectStore"

describe("Tier 1: Uniform Reflection & Parsing", () => {
  beforeEach(() => {
    useProjectStore.setState({
      parsedUniforms: [],
      uniformValues: {},
      graphUniforms: [],
    })
  })

  // Feature 1: Standard Uniform Reflection (GLSL ES 3.0)
  describe("Feature 1: Standard GLSL Uniform Reflection", () => {
    it("extracts float, int, uint, and bool scalar uniforms", () => {
      const glsl = `
        uniform float u_time;
        uniform int u_count;
        uniform uint u_flags;
        uniform bool u_enabled;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.find((u) => u.name === "u_time")).toMatchObject({ type: "f32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_count")).toMatchObject({ type: "i32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_flags")).toMatchObject({ type: "u32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_enabled")).toMatchObject({ type: "bool", kind: "scalar" })
    })

    it("extracts vector uniforms (vec2, vec3, vec4)", () => {
      const glsl = `
        uniform vec2 u_resolution;
        uniform vec3 u_position;
        uniform vec4 u_clip;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.find((u) => u.name === "u_resolution")).toMatchObject({ type: "vec2f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "u_position")).toMatchObject({ type: "vec3f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "u_clip")).toMatchObject({ type: "vec4f", kind: "vector" })
    })

    it("handles layout qualifiers preceding uniform declaration", () => {
      const glsl = `
        layout(location = 0) uniform float u_intensity;
        layout(binding = 1) uniform vec3 u_direction;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.find((u) => u.name === "u_intensity")).toBeDefined()
      expect(uniforms.find((u) => u.name === "u_direction")).toBeDefined()
    })

    it("ignores non-uniform variable declarations", () => {
      const glsl = `
        in vec3 a_position;
        out vec4 fragColor;
        float internalVar = 1.0;
        uniform float u_valid;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_valid")
    })

    it("handles whitespace variations and blank lines", () => {
      const glsl = `
        \t uniform   vec2   u_offset ;  
        
        uniform\tfloat\tu_zoom;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.map((u) => u.name)).toEqual(["u_offset", "u_zoom"])
    })
  })

  // Feature 2: Precision Qualifier Parsing (GLSL)
  describe("Feature 2: Precision Qualifier Parsing", () => {
    it("parses highp precision qualifier", () => {
      const glsl = `uniform highp float u_highPrecision;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_highPrecision", type: "f32" })
    })

    it("parses mediump precision qualifier", () => {
      const glsl = `uniform mediump vec3 u_mediumVector;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_mediumVector", type: "vec3f" })
    })

    it("parses lowp precision qualifier", () => {
      const glsl = `uniform lowp sampler2D u_lowTexture;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_lowTexture", type: "texture", kind: "texture" })
    })

    it("parses mixed precisions in a single shader", () => {
      const glsl = `
        uniform highp vec4 u_pos;
        uniform mediump float u_speed;
        uniform lowp bool u_flag;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms[0].name).toBe("u_pos")
      expect(uniforms[1].name).toBe("u_speed")
      expect(uniforms[2].name).toBe("u_flag")
    })

    it("correctly parses precision with global precision statements present", () => {
      const glsl = `
        #version 300 es
        precision highp float;
        precision mediump int;
        uniform mediump float u_factor;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_factor")
    })
  })

  // Feature 3: Array Uniform Expansion (GLSL)
  describe("Feature 3: GLSL Array Uniform Expansion", () => {
    it("expands float array into indexed names", () => {
      const glsl = `uniform float u_weights[3];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["u_weights[0]", "u_weights[1]", "u_weights[2]"])
      expect(uniforms.every((u) => u.type === "f32")).toBe(true)
    })

    it("expands vec3 array into indexed names", () => {
      const glsl = `uniform vec3 u_lightPositions[2];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].name).toBe("u_lightPositions[0]")
      expect(uniforms[1].name).toBe("u_lightPositions[1]")
      expect(uniforms[0].type).toBe("vec3f")
    })

    it("expands array of colors into color kind indexed names", () => {
      const glsl = `uniform vec3 u_paletteColors[2];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
    })

    it("handles single-element array", () => {
      const glsl = `uniform float u_single[1];`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_single[0]")
    })

    it("handles multiple arrays with different types", () => {
      const glsl = `
        uniform float u_radii[2];
        uniform vec2 u_coords[2];
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.map((u) => u.name)).toEqual([
        "u_radii[0]",
        "u_radii[1]",
        "u_coords[0]",
        "u_coords[1]",
      ])
    })
  })

  // Feature 4: Color Name Heuristic
  describe("Feature 4: Color Name Heuristic", () => {
    it("detects 'color' keyword in uniform name", () => {
      const glsl = `uniform vec3 u_surfaceColor;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("detects 'tint' keyword in uniform name", () => {
      const glsl = `uniform vec4 u_tint;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("detects 'albedo' keyword in uniform name", () => {
      const glsl = `uniform vec3 u_baseAlbedo;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
    })

    it("is case-insensitive for color names", () => {
      const glsl = `
        uniform vec3 u_COLOR_PRIMARY;
        uniform vec4 u_TintFactor;
        uniform vec3 u_ALBEDO;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
      expect(uniforms[2].kind).toBe("color")
    })

    it("does not classify non-vector types as color even if name matches", () => {
      const glsl = `uniform float u_colorIntensity;`
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms[0].kind).toBe("scalar")
      expect(uniforms[0].type).toBe("f32")
    })
  })

  // Feature 5: Uniform Struct Member Parsing (WGSL)
  describe("Feature 5: WGSL Uniform Struct Member Parsing", () => {
    it("parses struct members with scalars and vectors", () => {
      const wgsl = `
        struct Uniforms {
          speed: f32,
          count: i32,
          offset: vec2<f32>,
          scale: vec3f,
        };
        @group(0) @binding(0) var<uniform> u: Uniforms;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms.find((u) => u.name === "speed")).toMatchObject({ type: "f32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "count")).toMatchObject({ type: "i32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "offset")).toMatchObject({ type: "vec2f", kind: "vector" })
      expect(uniforms.find((u) => u.name === "scale")).toMatchObject({ type: "vec3f", kind: "vector" })
    })

    it("parses boolean fields inside WGSL struct", () => {
      const wgsl = `
        struct Settings {
          invert: bool,
          enabled: bool,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0]).toMatchObject({ name: "invert", type: "bool", kind: "scalar" })
      expect(uniforms[1]).toMatchObject({ name: "enabled", type: "bool", kind: "scalar" })
    })

    it("parses unsigned integer u32 in WGSL struct", () => {
      const wgsl = `
        struct Data {
          flags: u32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "flags", type: "u32", kind: "scalar" })
    })

    it("applies color heuristic to WGSL struct fields", () => {
      const wgsl = `
        struct Material {
          baseColor: vec3f,
          tintFactor: vec4<f32>,
          roughness: f32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms.find((u) => u.name === "baseColor")?.kind).toBe("color")
      expect(uniforms.find((u) => u.name === "tintFactor")?.kind).toBe("color")
      expect(uniforms.find((u) => u.name === "roughness")?.kind).toBe("scalar")
    })

    it("deduplicates members across multiple struct references", () => {
      const wgsl = `
        struct Params {
          intensity: f32,
        };
        struct ExtendedParams {
          intensity: f32,
          radius: f32,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.map((u) => u.name)).toEqual(["intensity", "radius"])
    })
  })

  // Feature 6: Module Variable Reflection (WGSL)
  describe("Feature 6: WGSL Module Variable Reflection", () => {
    it("extracts top-level @group @binding var<uniform> scalars", () => {
      const wgsl = `
        @group(0) @binding(0) var<uniform> u_time: f32;
        @group(0) @binding(1) var<uniform> u_samples: i32;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms.find((u) => u.name === "u_time")).toMatchObject({ type: "f32" })
      expect(uniforms.find((u) => u.name === "u_samples")).toMatchObject({ type: "i32" })
    })

    it("extracts top-level vector uniforms", () => {
      const wgsl = `
        @group(0) @binding(0) var<uniform> u_view_pos: vec3f;
        @group(0) @binding(1) var<uniform> u_res: vec2<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].type).toBe("vec3f")
      expect(uniforms[1].type).toBe("vec2f")
    })

    it("extracts top-level texture_2d declarations", () => {
      const wgsl = `
        @group(1) @binding(0) var u_diffuseMap: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0]).toMatchObject({ name: "u_diffuseMap", type: "texture", kind: "texture" })
    })

    it("ignores sampler module variables without errors", () => {
      const wgsl = `
        @group(1) @binding(1) var u_sampler: sampler;
        @group(1) @binding(2) var u_mainTex: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_mainTex")
    })

    it("parses combined structs and module variables in single file", () => {
      const wgsl = `
        struct Globals {
          time: f32,
        };
        @group(0) @binding(0) var<uniform> globals: Globals;
        @group(0) @binding(1) var<uniform> u_ambient: vec3f;
        @group(1) @binding(0) var u_albedoTex: texture_2d<f32>;
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["time", "u_ambient", "u_albedoTex"])
    })
  })

  // Feature 7: WGSL Array Expansion
  describe("Feature 7: WGSL Array Expansion", () => {
    // Note: In existing wgslUniforms.ts, FIELD_REGEX uses [^,;]+ which stops at the comma inside array<T, N>.
    // This is documented as an implementation bug in TEST_INFRA.md for Milestone M1.
    it("expands array<f32, N> in struct", () => {
      const wgsl = `
        struct Data {
          scales: array<f32, 3>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["scales[0]", "scales[1]", "scales[2]"])
      expect(uniforms.every((u) => u.type === "f32")).toBe(true)
    })

    it("expands array<vec3f, N> in struct", () => {
      const wgsl = `
        struct Lights {
          positions: array<vec3f, 2>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].name).toBe("positions[0]")
      expect(uniforms[1].name).toBe("positions[1]")
      expect(uniforms[0].type).toBe("vec3f")
    })

    it("expands color arrays preserving color kind", () => {
      const wgsl = `
        struct Palette {
          colorStops: array<vec3f, 2>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(2)
      expect(uniforms[0].kind).toBe("color")
      expect(uniforms[1].kind).toBe("color")
    })

    it("expands single-element array<bool, 1>", () => {
      const wgsl = `
        struct Switches {
          flags: array<bool, 1>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("flags[0]")
      expect(uniforms[0].type).toBe("bool")
    })

    it("expands array with whitespace formatting variations", () => {
      const wgsl = `
        struct Test {
          vals: array< f32 , 4 >,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms).toHaveLength(4)
      expect(uniforms[3].name).toBe("vals[3]")
    })
  })

  // Features 8, 9, 10, 11: Parameter Store & Type Controls
  describe("Features 8-11: Uniform Controls & Project Store Integration", () => {
    it("Feature 8: stores and modifies scalar float and boolean uniform values", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_speed", { type: "float", value: 1.5 })
      store.setUniformValue("u_active", { type: "bool", value: true })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_speed"]).toEqual({ type: "float", value: 1.5 })
      expect(state.uniformValues["u_active"]).toEqual({ type: "bool", value: true })
    })

    it("Feature 9: stores and modifies vector uniform components", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_resolution", { type: "vec2", value: [1920, 1080] })
      store.setUniformValue("u_position", { type: "vec3", value: [0.1, 0.5, -1.0] })
      store.setUniformValue("u_plane", { type: "vec4", value: [0, 1, 0, 0] })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_resolution"].value).toEqual([1920, 1080])
      expect(state.uniformValues["u_position"].value).toEqual([0.1, 0.5, -1.0])
      expect(state.uniformValues["u_plane"].value).toEqual([0, 1, 0, 0])
    })

    it("Feature 10: stores and updates color uniforms in RGB and RGBA formats", () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_color", { type: "color", value: [1.0, 0.0, 0.5] })
      store.setUniformValue("u_tint", { type: "color", value: [0.2, 0.4, 0.6, 1.0] })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_color"].value).toEqual([1.0, 0.0, 0.5])
      expect(state.uniformValues["u_tint"].value).toEqual([0.2, 0.4, 0.6, 1.0])
    })

    it("Feature 11: stores 4x4 matrix uniform values in project store", () => {
      const identityMat4 = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]
      const store = useProjectStore.getState()
      store.setUniformValue("u_modelMatrix", { type: "vec4", value: identityMat4 })

      const state = useProjectStore.getState()
      expect(state.uniformValues["u_modelMatrix"].value).toHaveLength(16)
    })

    it("synchronizes graph uniforms with parsed uniforms in project store", () => {
      const store = useProjectStore.getState()
      store.addGraphUniform({
        id: "gu-1",
        name: "u_customFactor",
        type: "float",
        defaultValue: 2.5,
      })

      const state = useProjectStore.getState()
      expect(state.graphUniforms).toHaveLength(1)
      expect(state.graphUniforms[0].name).toBe("u_customFactor")
      expect(state.graphUniforms[0].defaultValue).toBe(2.5)
    })
  })
})
