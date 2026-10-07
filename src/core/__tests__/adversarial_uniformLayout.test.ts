import { describe, it, expect } from "vitest"
import {
  computeUniformBufferLayout,
  packUniformBuffer,
  alignTo,
  normalizeFieldType,
  getTypeMetrics,
} from "../uniformLayout"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import type { ParsedUniform } from "@/stores/projectStore"

describe("Adversarial Uniform Layout & Memory Packing Engine", () => {
  // =========================================================================
  // Challenge 1: Complex Struct with 10+ Mixed Fields & Alignment Strides
  // =========================================================================
  describe("Challenge 1: Complex struct with 12 mixed fields & nested alignments", () => {
    const mixed12Uniforms: ParsedUniform[] = [
      { name: "f1_scalar", type: "f32", kind: "scalar" },       // 0..3 (align 4)
      { name: "f2_mat2", type: "mat2x2f", kind: "matrix" },     // align 8 -> 8..23 (size 16)
      { name: "f3_scalar", type: "f32", kind: "scalar" },       // align 4 -> 24..27 (size 4)
      { name: "f4_vec3", type: "vec3f", kind: "vector" },       // align 16 -> 32..43 (size 12)
      { name: "f5_bool", type: "bool", kind: "scalar" },        // align 4 -> 44..47 (size 4)
      { name: "f6_mat3", type: "mat3x3f", kind: "matrix" },     // align 16 -> 48..95 (size 48)
      { name: "f7_int", type: "i32", kind: "scalar" },          // align 4 -> 96..99 (size 4)
      { name: "f8_uint", type: "u32", kind: "scalar" },         // align 4 -> 100..103 (size 4)
      { name: "f9_vec2", type: "vec2f", kind: "vector" },       // align 8 -> 104..111 (size 8)
      { name: "f10_vec4", type: "vec4f", kind: "vector" },      // align 16 -> 112..127 (size 16)
      { name: "f11_mat4", type: "mat4x4f", kind: "matrix" },    // align 16 -> 128..191 (size 64)
      { name: "f12_scalar", type: "f32", kind: "scalar" },      // align 4 -> 192..195 (size 4)
    ]

    it("computes mathematically exact offsets and padded total size for 12 mixed fields", () => {
      const layout = computeUniformBufferLayout(mixed12Uniforms)

      expect(layout.fields["f1_scalar"]).toMatchObject({ offset: 0, size: 4, alignment: 4 })
      expect(layout.fields["f2_mat2"]).toMatchObject({ offset: 8, size: 16, alignment: 8 })
      expect(layout.fields["f3_scalar"]).toMatchObject({ offset: 24, size: 4, alignment: 4 })
      expect(layout.fields["f4_vec3"]).toMatchObject({ offset: 32, size: 12, alignment: 16 })
      expect(layout.fields["f5_bool"]).toMatchObject({ offset: 44, size: 4, alignment: 4 })
      expect(layout.fields["f6_mat3"]).toMatchObject({ offset: 48, size: 48, alignment: 16 })
      expect(layout.fields["f7_int"]).toMatchObject({ offset: 96, size: 4, alignment: 4 })
      expect(layout.fields["f8_uint"]).toMatchObject({ offset: 100, size: 4, alignment: 4 })
      expect(layout.fields["f9_vec2"]).toMatchObject({ offset: 104, size: 8, alignment: 8 })
      expect(layout.fields["f10_vec4"]).toMatchObject({ offset: 112, size: 16, alignment: 16 })
      expect(layout.fields["f11_mat4"]).toMatchObject({ offset: 128, size: 64, alignment: 16 })
      expect(layout.fields["f12_scalar"]).toMatchObject({ offset: 192, size: 4, alignment: 4 })

      // Total size: 196 aligned up to 16 = 208
      expect(layout.totalSize).toBe(208)
    })

    it("packs 12 mixed fields and verifies zero-filled internal padding holes", () => {
      const layout = computeUniformBufferLayout(mixed12Uniforms)
      const values = {
        f1_scalar: 1.25,
        f2_mat2: [2, 0, 0, 3],
        f3_scalar: 4.5,
        f4_vec3: [5, 6, 7],
        f5_bool: true,
        f6_mat3: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        f7_int: -42,
        f8_uint: 100,
        f9_vec2: [10, 11],
        f10_vec4: [12, 13, 14, 15],
        f11_mat4: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        f12_scalar: 99.0,
      }

      const buffer = packUniformBuffer(layout, values)
      expect(buffer.byteLength).toBe(208)

      const view = new DataView(buffer)

      // f1_scalar at offset 0
      expect(view.getFloat32(0, true)).toBeCloseTo(1.25)

      // Hole at 4..7 must be 0
      expect(view.getUint32(4, true)).toBe(0)

      // f2_mat2 at offset 8 (col 0: 2, 0; col 1: 0, 3)
      expect(view.getFloat32(8, true)).toBeCloseTo(2)
      expect(view.getFloat32(12, true)).toBeCloseTo(0)
      expect(view.getFloat32(16, true)).toBeCloseTo(0)
      expect(view.getFloat32(20, true)).toBeCloseTo(3)

      // f3_scalar at offset 24
      expect(view.getFloat32(24, true)).toBeCloseTo(4.5)

      // Hole at 28..31 must be 0
      expect(view.getUint32(28, true)).toBe(0)

      // f4_vec3 at offset 32 (5, 6, 7)
      expect(view.getFloat32(32, true)).toBeCloseTo(5)
      expect(view.getFloat32(36, true)).toBeCloseTo(6)
      expect(view.getFloat32(40, true)).toBeCloseTo(7)

      // f5_bool at offset 44 (1)
      expect(view.getUint32(44, true)).toBe(1)

      // f6_mat3 at offset 48 (16-byte column strides with padding at 60, 76, 92)
      expect(view.getFloat32(48, true)).toBeCloseTo(1)
      expect(view.getFloat32(52, true)).toBeCloseTo(2)
      expect(view.getFloat32(56, true)).toBeCloseTo(3)
      expect(view.getUint32(60, true)).toBe(0) // pad col 0

      expect(view.getFloat32(64, true)).toBeCloseTo(4)
      expect(view.getFloat32(68, true)).toBeCloseTo(5)
      expect(view.getFloat32(72, true)).toBeCloseTo(6)
      expect(view.getUint32(76, true)).toBe(0) // pad col 1

      expect(view.getFloat32(80, true)).toBeCloseTo(7)
      expect(view.getFloat32(84, true)).toBeCloseTo(8)
      expect(view.getFloat32(88, true)).toBeCloseTo(9)
      expect(view.getUint32(92, true)).toBe(0) // pad col 2

      // f7_int at offset 96 (-42)
      expect(view.getInt32(96, true)).toBe(-42)

      // f8_uint at offset 100 (100)
      expect(view.getUint32(100, true)).toBe(100)

      // f9_vec2 at offset 104 (10, 11)
      expect(view.getFloat32(104, true)).toBeCloseTo(10)
      expect(view.getFloat32(108, true)).toBeCloseTo(11)

      // f10_vec4 at offset 112 (12, 13, 14, 15)
      expect(view.getFloat32(112, true)).toBeCloseTo(12)
      expect(view.getFloat32(116, true)).toBeCloseTo(13)
      expect(view.getFloat32(120, true)).toBeCloseTo(14)
      expect(view.getFloat32(124, true)).toBeCloseTo(15)

      // f11_mat4 at offset 128 (identity)
      expect(view.getFloat32(128, true)).toBeCloseTo(1)
      expect(view.getFloat32(148, true)).toBeCloseTo(1)
      expect(view.getFloat32(168, true)).toBeCloseTo(1)
      expect(view.getFloat32(188, true)).toBeCloseTo(1)

      // f12_scalar at offset 192 (99.0)
      expect(view.getFloat32(192, true)).toBeCloseTo(99.0)

      // Tail padding 196..207 must be 0
      for (let offset = 196; offset < 208; offset += 4) {
        expect(view.getUint32(offset, true)).toBe(0)
      }
    })
  })

  // =========================================================================
  // Challenge 2: mat3x3 Column Padding & mat2x2 Alignment Stress Test
  // =========================================================================
  describe("Challenge 2: mat3x3f column stride padding and mat2x2f alignment", () => {
    it("strictly pads each mat3x3 column to 16 bytes when provided 9-element array", () => {
      const uniforms: ParsedUniform[] = [
        { name: "m3", type: "mat3x3f", kind: "matrix" },
      ]
      const layout = computeUniformBufferLayout(uniforms)
      expect(layout.totalSize).toBe(48)

      const values = {
        m3: [
          10, 20, 30, // Col 0
          40, 50, 60, // Col 1
          70, 80, 90, // Col 2
        ],
      }
      const buffer = packUniformBuffer(layout, values)
      const view = new DataView(buffer)

      // Col 0
      expect(view.getFloat32(0, true)).toBeCloseTo(10)
      expect(view.getFloat32(4, true)).toBeCloseTo(20)
      expect(view.getFloat32(8, true)).toBeCloseTo(30)
      expect(view.getUint32(12, true)).toBe(0) // Column 0 padding slot

      // Col 1
      expect(view.getFloat32(16, true)).toBeCloseTo(40)
      expect(view.getFloat32(20, true)).toBeCloseTo(50)
      expect(view.getFloat32(24, true)).toBeCloseTo(60)
      expect(view.getUint32(28, true)).toBe(0) // Column 1 padding slot

      // Col 2
      expect(view.getFloat32(32, true)).toBeCloseTo(70)
      expect(view.getFloat32(36, true)).toBeCloseTo(80)
      expect(view.getFloat32(40, true)).toBeCloseTo(90)
      expect(view.getUint32(44, true)).toBe(0) // Column 2 padding slot
    })

    it("handles 12-element pre-strided mat3x3 array without data corruption", () => {
      const uniforms: ParsedUniform[] = [
        { name: "m3", type: "mat3x3f", kind: "matrix" },
      ]
      const layout = computeUniformBufferLayout(uniforms)

      const values = {
        m3: [
          11, 22, 33, 999, // col 0 (4th is dummy pad)
          44, 55, 66, 999, // col 1
          77, 88, 99, 999, // col 2
        ],
      }
      const buffer = packUniformBuffer(layout, values)
      const view = new DataView(buffer)

      expect(view.getFloat32(0, true)).toBeCloseTo(11)
      expect(view.getFloat32(4, true)).toBeCloseTo(22)
      expect(view.getFloat32(8, true)).toBeCloseTo(33)
      expect(view.getUint32(12, true)).toBe(0) // Must stay 0 or not corrupt

      expect(view.getFloat32(16, true)).toBeCloseTo(44)
      expect(view.getFloat32(20, true)).toBeCloseTo(55)
      expect(view.getFloat32(24, true)).toBeCloseTo(66)
      expect(view.getUint32(28, true)).toBe(0)

      expect(view.getFloat32(32, true)).toBeCloseTo(77)
      expect(view.getFloat32(36, true)).toBeCloseTo(88)
      expect(view.getFloat32(40, true)).toBeCloseTo(99)
      expect(view.getUint32(44, true)).toBe(0)
    })

    it("verifies mat2x2f 8-byte alignment does not waste 16 bytes when preceded by scalar", () => {
      const uniforms: ParsedUniform[] = [
        { name: "s", type: "f32", kind: "scalar" },
        { name: "m2", type: "mat2x2f", kind: "matrix" },
      ]
      const layout = computeUniformBufferLayout(uniforms)
      // s is at 0 (size 4). m2 alignment is 8 -> offset 8! (NOT 16!)
      expect(layout.fields["s"].offset).toBe(0)
      expect(layout.fields["m2"].offset).toBe(8)
      expect(layout.fields["m2"].size).toBe(16)
      expect(layout.totalSize).toBe(32) // 8 + 16 = 24 rounded up to 16 = 32

      const buffer = packUniformBuffer(layout, {
        s: 7.5,
        m2: [1, 2, 3, 4],
      })
      const view = new DataView(buffer)
      expect(view.getFloat32(0, true)).toBeCloseTo(7.5)
      expect(view.getUint32(4, true)).toBe(0) // 4-byte pad between scalar and mat2
      expect(view.getFloat32(8, true)).toBeCloseTo(1)
      expect(view.getFloat32(12, true)).toBeCloseTo(2)
      expect(view.getFloat32(16, true)).toBeCloseTo(3)
      expect(view.getFloat32(20, true)).toBeCloseTo(4)
      // Tail padding 24..31
      expect(view.getUint32(24, true)).toBe(0)
      expect(view.getUint32(28, true)).toBe(0)
    })
  })

  // =========================================================================
  // Challenge 3: Arrays of vec3f & std140/WGSL Strides
  // =========================================================================
  describe("Challenge 3: Arrays of vec3f with 16-byte std140 stride", () => {
    it("allocates 16-byte stride per vec3f array element and zeroes the 4-byte tail of each element", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_lights", type: "vec3f", kind: "vector", arrayLength: 3 },
      ]
      const layout = computeUniformBufferLayout(uniforms)

      expect(layout.fields["u_lights"]).toMatchObject({
        offset: 0,
        size: 48, // 3 * 16 bytes
        arrayCount: 3,
        arrayStride: 16,
        alignment: 16,
      })
      expect(layout.totalSize).toBe(48)

      const values = {
        u_lights: [
          [1.0, 2.0, 3.0],
          [4.0, 5.0, 6.0],
          [7.0, 8.0, 9.0],
        ],
      }
      const buffer = packUniformBuffer(layout, values)
      expect(buffer.byteLength).toBe(48)

      const view = new DataView(buffer)

      // Element 0 (offset 0..15)
      expect(view.getFloat32(0, true)).toBeCloseTo(1.0)
      expect(view.getFloat32(4, true)).toBeCloseTo(2.0)
      expect(view.getFloat32(8, true)).toBeCloseTo(3.0)
      expect(view.getUint32(12, true)).toBe(0) // 4-byte padding at end of element 0

      // Element 1 (offset 16..31)
      expect(view.getFloat32(16, true)).toBeCloseTo(4.0)
      expect(view.getFloat32(20, true)).toBeCloseTo(5.0)
      expect(view.getFloat32(24, true)).toBeCloseTo(6.0)
      expect(view.getUint32(28, true)).toBe(0) // 4-byte padding at end of element 1

      // Element 2 (offset 32..47)
      expect(view.getFloat32(32, true)).toBeCloseTo(7.0)
      expect(view.getFloat32(36, true)).toBeCloseTo(8.0)
      expect(view.getFloat32(40, true)).toBeCloseTo(9.0)
      expect(view.getUint32(44, true)).toBe(0) // 4-byte padding at end of element 2
    })
  })

  // =========================================================================
  // Challenge 4: Little-Endian Binary Serialization of DataView in packUniformBuffer
  // =========================================================================
  describe("Challenge 4: Little-endian binary byte-level verification", () => {
    it("serializes IEEE 754 floats, 32-bit signed/unsigned ints, and booleans in strict little-endian order", () => {
      const uniforms: ParsedUniform[] = [
        { name: "f_one", type: "f32", kind: "scalar" },
        { name: "f_neg_two", type: "f32", kind: "scalar" },
        { name: "i_val", type: "i32", kind: "scalar" },
        { name: "u_val", type: "u32", kind: "scalar" },
        { name: "b_true", type: "bool", kind: "scalar" },
        { name: "b_false", type: "bool", kind: "scalar" },
      ]
      const layout = computeUniformBufferLayout(uniforms)
      expect(layout.totalSize).toBe(32)

      const values = {
        f_one: 1.0,           // 0x3F800000 -> little endian: [0x00, 0x00, 0x80, 0x3F]
        f_neg_two: -2.0,      // 0xC0000000 -> little endian: [0x00, 0x00, 0x00, 0xC0]
        i_val: 0x12345678,    // little endian: [0x78, 0x56, 0x34, 0x12]
        u_val: 0xDEADBEEF,    // little endian: [0xEF, 0xBE, 0xAD, 0xDE]
        b_true: true,         // little endian: [0x01, 0x00, 0x00, 0x00]
        b_false: false,       // little endian: [0x00, 0x00, 0x00, 0x00]
      }

      const buffer = packUniformBuffer(layout, values)
      const bytes = new Uint8Array(buffer)

      // f_one at offset 0
      expect(bytes[0]).toBe(0x00)
      expect(bytes[1]).toBe(0x00)
      expect(bytes[2]).toBe(0x80)
      expect(bytes[3]).toBe(0x3f)

      // f_neg_two at offset 4
      expect(bytes[4]).toBe(0x00)
      expect(bytes[5]).toBe(0x00)
      expect(bytes[6]).toBe(0x00)
      expect(bytes[7]).toBe(0xc0)

      // i_val at offset 8 (0x12345678)
      expect(bytes[8]).toBe(0x78)
      expect(bytes[9]).toBe(0x56)
      expect(bytes[10]).toBe(0x34)
      expect(bytes[11]).toBe(0x12)

      // u_val at offset 12 (0xDEADBEEF)
      expect(bytes[12]).toBe(0xef)
      expect(bytes[13]).toBe(0xbe)
      expect(bytes[14]).toBe(0xad)
      expect(bytes[15]).toBe(0xde)

      // b_true at offset 16 (0x00000001)
      expect(bytes[16]).toBe(0x01)
      expect(bytes[17]).toBe(0x00)
      expect(bytes[18]).toBe(0x00)
      expect(bytes[19]).toBe(0x00)

      // b_false at offset 20 (0x00000000)
      expect(bytes[20]).toBe(0x00)
      expect(bytes[21]).toBe(0x00)
      expect(bytes[22]).toBe(0x00)
      expect(bytes[23]).toBe(0x00)

      // Tail padding at 24..31
      for (let i = 24; i < 32; i++) {
        expect(bytes[i]).toBe(0x00)
      }
    })
  })

  // =========================================================================
  // Challenge 5: GLSL Parser Adversarial Reflection
  // =========================================================================
  describe("Challenge 5: GLSL Parser under adversarial formatting and syntax", () => {
    it("handles trailing spaces, Windows CRLF, and irregular whitespace in GLSL declarations", () => {
      const glsl = "\r\n\t  layout ( std140 )   uniform   CameraBlock  \r\n  {\r\n" +
        "   \t  highp   mat4   u_viewMatrix  ;  \r\n" +
        "     mediump   vec3   u_camPos   ;   \r\n" +
        "  }   u_cam  ;  \r\n\r\n" +
        "uniform   \t  float   u_blurRadius   ;   \r\n"

      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms.find((u) => u.name === "u_cam.u_viewMatrix")).toMatchObject({
        type: "mat4x4f",
        kind: "matrix",
      })
      expect(uniforms.find((u) => u.name === "u_cam.u_camPos")).toMatchObject({
        type: "vec3f",
        kind: "vector",
      })
      expect(uniforms.find((u) => u.name === "u_blurRadius")).toMatchObject({
        type: "f32",
        kind: "scalar",
      })
    })

    it("survives heavily nested comments, dummy fake uniform keywords, and URL comments", () => {
      const glsl = `
        /*
          uniform mat4 u_fake1;
          /* nested looking comment uniform vec3 fake2; */
          http://example.com/shader?param=uniform
        */
        uniform float u_realScalar; // inline comment with ; uniform vec4 fake3;
        // uniform float u_commentedOut;
        /* multiline on single line */ uniform mat3 u_realMat3; /* trailing comment */
        /*
         * Multi-line block with asterisks
         * uniform sampler2D fakeTex;
         */
        uniform sampler2D u_realTex;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms).toHaveLength(3)
      expect(uniforms.map((u) => u.name)).toEqual(["u_realScalar", "u_realMat3", "u_realTex"])
      expect(uniforms.find((u) => u.name === "u_realMat3")?.kind).toBe("matrix")
      expect(uniforms.find((u) => u.name === "u_realTex")?.kind).toBe("texture")
    })

    it("parses GLSL struct with array members and expands them with proper indexing", () => {
      const glsl = `
        struct Light {
          vec3 position;
          vec4 color;
        };
        uniform Light u_light;
      `
      const uniforms = parseGlslUniforms(glsl)
      expect(uniforms.find((u) => u.name === "u_light.position")).toMatchObject({
        type: "vec3f",
        kind: "vector",
      })
      expect(uniforms.find((u) => u.name === "u_light.color")).toMatchObject({
        type: "vec4f",
        kind: "color",
      })
    })

    it("correctly parses GLSL array declarations with spaces around brackets", () => {
      const glsl = "uniform vec3 u_colors[ 4 ];\nuniform vec3 u_offsets [4];"
      const uniforms = parseGlslUniforms(glsl)
      // UNIFORM_REGEX supports whitespace around array brackets and expands all 8 elements
      expect(uniforms).toHaveLength(8)
      expect(uniforms[0].name).toBe("u_colors[0]")
      expect(uniforms[7].name).toBe("u_offsets[3]")
    })
  })

  // =========================================================================
  // Challenge 6: WGSL Parser Adversarial Reflection & Bug Proof
  // =========================================================================
  describe("Challenge 6: WGSL Parser adversarial reflection & empirical bug verification", () => {
    it("handles trailing spaces, tabs, Windows CRLF, and irregular whitespace in WGSL structs", () => {
      const wgsl = "\r\n  struct   MyUniforms   {\r\n" +
        "  \t  mvp   :   mat4x4<f32>   ,  \r\n" +
        "     color  :  vec3f  , \r\n" +
        "  \t  speed  :  f32  ;\r\n" +
        "     active :  bool\r\n" +
        "  }  ;\r\n\r\n" +
        "@group(0) @binding(1) var<uniform> u_extra: vec2f; \r\n"

      const uniforms = parseWgslUniforms(wgsl)
      expect(uniforms.find((u) => u.name === "mvp")).toMatchObject({ type: "mat4x4f", kind: "matrix" })
      expect(uniforms.find((u) => u.name === "color")).toMatchObject({ type: "vec3f", kind: "color" })
      expect(uniforms.find((u) => u.name === "speed")).toMatchObject({ type: "f32", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "active")).toMatchObject({ type: "bool", kind: "scalar" })
      expect(uniforms.find((u) => u.name === "u_extra")).toMatchObject({ type: "vec2f", kind: "vector" })
    })

    it("handles multiple comments and ignores fake uniforms inside comments in WGSL", () => {
      const wgsl = `
        /*
          struct FakeStruct {
            fake1: mat4x4f,
          };
          @group(0) @binding(0) var<uniform> fakeVar: f32;
        */
        // @group(0) @binding(0) var<uniform> fakeVar2: vec3f;
        struct RealParams {
          zoom: f32, // inline comment with var<uniform> fakeVar3: f32;
          offset: vec2f,
        };
        // Another comment
        @group(0) @binding(0) var<uniform> realTime: f32;
      `
      const uniforms = parseWgslUniforms(wgsl)
      const names = uniforms.map((u) => u.name)
      expect(names).toContain("zoom")
      expect(names).toContain("offset")
      expect(names).toContain("realTime")
      expect(names).not.toContain("fake1")
      expect(names).not.toContain("fakeVar")
      expect(names).not.toContain("fakeVar2")
      expect(names).not.toContain("fakeVar3")
    })

    it("correctly parses WGSL array declarations without truncation at comma inside <...>", () => {
      const wgsl = `
        struct ArrayHolder {
          positions: array<vec3f, 3>,
          radii: array<f32, 2>,
        };
      `
      const uniforms = parseWgslUniforms(wgsl)
      // Corrected: FIELD_REGEX previously truncated "array<vec3f, 3>" at the comma into "array<vec3f".
      // Now fixed: 5 expanded elements are returned.
      expect(uniforms).toHaveLength(5)
    })

    it("correctly parses WGSL @group and @binding with whitespace before parentheses", () => {
      const wgsl = `@group ( 0 ) @binding ( 1 ) var<uniform> u_extra: vec2f;`
      const uniforms = parseWgslUniforms(wgsl)
      // TOP_LEVEL_VAR_REGEX allows optional whitespace and captures u_extra
      expect(uniforms).toHaveLength(1)
      expect(uniforms[0].name).toBe("u_extra")
      expect(uniforms[0].type).toBe("vec2f")
    })
  })

  // =========================================================================
  // Challenge 7: Boundary Robustness, Fuzzing & Malformed Values
  // =========================================================================
  describe("Challenge 7: packUniformBuffer boundary robustness & malformed input handling", () => {
    it("safely handles undefined, null, partial, string, and NaN inputs without throwing", () => {
      const uniforms: ParsedUniform[] = [
        { name: "f_nan", type: "f32", kind: "scalar" },
        { name: "f_str", type: "f32", kind: "scalar" },
        { name: "v_short", type: "vec4f", kind: "vector" },
        { name: "m_empty", type: "mat4x4f", kind: "matrix" },
      ]
      const layout = computeUniformBufferLayout(uniforms)

      expect(() => {
        const buffer = packUniformBuffer(layout, {
          f_nan: NaN,
          f_str: "123.456",
          v_short: [1.0, 2.0], // only 2 components provided for vec4
          m_empty: [],         // empty array for mat4 -> should default to identity
        })

        const view = new DataView(buffer)
        expect(view.getFloat32(0, true)).toBe(0) // NaN converted to 0
        expect(view.getFloat32(4, true)).toBeCloseTo(123.456) // "123.456" parsed to number
        // vec4 at offset 16
        expect(view.getFloat32(16, true)).toBeCloseTo(1.0)
        expect(view.getFloat32(20, true)).toBeCloseTo(2.0)
        expect(view.getFloat32(24, true)).toBe(0) // missing component 2
        expect(view.getFloat32(28, true)).toBe(0) // missing component 3
        // mat4 at offset 32 (identity matrix fallback)
        expect(view.getFloat32(32, true)).toBe(1)
        expect(view.getFloat32(52, true)).toBe(1)
        expect(view.getFloat32(72, true)).toBe(1)
        expect(view.getFloat32(92, true)).toBe(1)
      }).not.toThrow()
    })

    it("resolves uniform names with or without 'u_' prefix interchangeably", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_speed", type: "f32", kind: "scalar" },
        { name: "color", type: "vec3f", kind: "color" },
      ]
      const layout = computeUniformBufferLayout(uniforms)

      // Provide values with inverted prefixes: "speed" instead of "u_speed", and "u_color" instead of "color"
      const buffer = packUniformBuffer(layout, {
        speed: 8.5,
        u_color: [0.1, 0.2, 0.3],
      })

      const view = new DataView(buffer)
      expect(view.getFloat32(0, true)).toBeCloseTo(8.5)
      expect(view.getFloat32(16, true)).toBeCloseTo(0.1)
      expect(view.getFloat32(20, true)).toBeCloseTo(0.2)
      expect(view.getFloat32(24, true)).toBeCloseTo(0.3)
    })
  })

  // =========================================================================
  // Challenge 8: Direct validation of layout helper functions
  // =========================================================================
  describe("Challenge 8: Direct validation of layout math and type helpers", () => {
    it("tests alignTo with edge values", () => {
      expect(alignTo(0, 4)).toBe(0)
      expect(alignTo(1, 1)).toBe(1)
      expect(alignTo(5, 4)).toBe(8)
      expect(alignTo(12, 16)).toBe(16)
      expect(alignTo(16, 16)).toBe(16)
      expect(alignTo(17, 16)).toBe(32)
      expect(alignTo(3, 8)).toBe(8)
      expect(alignTo(0, 0)).toBe(0)
    })

    it("tests normalizeFieldType conversions", () => {
      expect(normalizeFieldType("float")).toBe("f32")
      expect(normalizeFieldType("f32")).toBe("f32")
      expect(normalizeFieldType("int")).toBe("i32")
      expect(normalizeFieldType("uint")).toBe("u32")
      expect(normalizeFieldType("bool")).toBe("bool")
      expect(normalizeFieldType("vec2<f32>")).toBe("vec2f")
      expect(normalizeFieldType("vec3<f32>")).toBe("vec3f")
      expect(normalizeFieldType("vec4<f32>")).toBe("vec4f")
      expect(normalizeFieldType("mat2")).toBe("mat2x2f")
      expect(normalizeFieldType("mat3")).toBe("mat3x3f")
      expect(normalizeFieldType("mat4")).toBe("mat4x4f")
      expect(normalizeFieldType("texture_2d<f32>")).toBe("texture_2d")
      expect(normalizeFieldType("sampler")).toBe("texture_2d")
      expect(normalizeFieldType("unknown_custom")).toBe("f32")
    })

    it("tests getTypeMetrics accuracy against W3C WGSL spec", () => {
      expect(getTypeMetrics("f32")).toEqual({ size: 4, alignment: 4 })
      expect(getTypeMetrics("i32")).toEqual({ size: 4, alignment: 4 })
      expect(getTypeMetrics("u32")).toEqual({ size: 4, alignment: 4 })
      expect(getTypeMetrics("bool")).toEqual({ size: 4, alignment: 4 })
      expect(getTypeMetrics("vec2f")).toEqual({ size: 8, alignment: 8 })
      expect(getTypeMetrics("vec3f")).toEqual({ size: 12, alignment: 16 })
      expect(getTypeMetrics("vec4f")).toEqual({ size: 16, alignment: 16 })
      expect(getTypeMetrics("mat2x2f")).toEqual({ size: 16, alignment: 8 })
      expect(getTypeMetrics("mat3x3f")).toEqual({ size: 48, alignment: 16 })
      expect(getTypeMetrics("mat4x4f")).toEqual({ size: 64, alignment: 16 })
      expect(getTypeMetrics("texture_2d")).toEqual({ size: 0, alignment: 0 })
    })
  })
})
