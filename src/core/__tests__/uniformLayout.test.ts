import { describe, it, expect } from "vitest"
import { computeUniformBufferLayout, packUniformBuffer } from "../uniformLayout"
import type { ParsedUniform } from "@/stores/projectStore"

describe("uniformLayout", () => {
  it("Test 1: calculates layout and packs 6+ field mixed-type struct (Acceptance Criterion R1)", () => {
    const uniforms: ParsedUniform[] = [
      { name: "mvp", type: "mat4x4f", kind: "matrix" },
      { name: "color", type: "vec3f", kind: "color" },
      { name: "speed", type: "f32", kind: "scalar" },
      { name: "scale", type: "vec2f", kind: "vector" },
      { name: "offset", type: "vec4f", kind: "vector" },
      { name: "active", type: "bool", kind: "scalar" },
      { name: "count", type: "u32", kind: "scalar" },
    ]

    const layout = computeUniformBufferLayout(uniforms)

    expect(layout.totalSize).toBe(128)
    expect(layout.fields["mvp"]).toMatchObject({ offset: 0, size: 64, alignment: 16 })
    expect(layout.fields["color"]).toMatchObject({ offset: 64, size: 12, alignment: 16 })
    expect(layout.fields["speed"]).toMatchObject({ offset: 76, size: 4, alignment: 4 })
    expect(layout.fields["scale"]).toMatchObject({ offset: 80, size: 8, alignment: 8 })
    expect(layout.fields["offset"]).toMatchObject({ offset: 96, size: 16, alignment: 16 })
    expect(layout.fields["active"]).toMatchObject({ offset: 112, size: 4, alignment: 4 })
    expect(layout.fields["count"]).toMatchObject({ offset: 116, size: 4, alignment: 4 })

    const identityMat4 = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]

    const values = {
      mvp: identityMat4,
      color: [1.0, 0.5, 0.25],
      speed: 2.5,
      scale: [1.5, 0.75],
      offset: [0.1, 0.2, 0.3, 1.0],
      active: true,
      count: 42,
    }

    const buffer = packUniformBuffer(layout, values)
    expect(buffer.byteLength).toBe(128)

    const view = new DataView(buffer)
    // Check mvp matrix diagonal
    expect(view.getFloat32(0, true)).toBe(1)
    expect(view.getFloat32(20, true)).toBe(1)
    expect(view.getFloat32(40, true)).toBe(1)
    expect(view.getFloat32(60, true)).toBe(1)

    // Check color at offset 64
    expect(view.getFloat32(64, true)).toBeCloseTo(1.0)
    expect(view.getFloat32(68, true)).toBeCloseTo(0.5)
    expect(view.getFloat32(72, true)).toBeCloseTo(0.25)

    // Check speed at offset 76
    expect(view.getFloat32(76, true)).toBeCloseTo(2.5)

    // Check scale at offset 80
    expect(view.getFloat32(80, true)).toBeCloseTo(1.5)
    expect(view.getFloat32(84, true)).toBeCloseTo(0.75)

    // Check padding holes at 88..95 are 0
    expect(view.getUint32(88, true)).toBe(0)
    expect(view.getUint32(92, true)).toBe(0)

    // Check offset at offset 96
    expect(view.getFloat32(96, true)).toBeCloseTo(0.1)
    expect(view.getFloat32(100, true)).toBeCloseTo(0.2)
    expect(view.getFloat32(104, true)).toBeCloseTo(0.3)
    expect(view.getFloat32(108, true)).toBeCloseTo(1.0)

    // Check active (bool = 1) at offset 112
    expect(view.getUint32(112, true)).toBe(1)

    // Check count (u32 = 42) at offset 116
    expect(view.getUint32(116, true)).toBe(42)

    // Check tail padding 120..127 are 0
    expect(view.getUint32(120, true)).toBe(0)
    expect(view.getUint32(124, true)).toBe(0)
  })

  it("Test 2: handles inter-field alignment padding holes", () => {
    const uniforms: ParsedUniform[] = [
      { name: "a", type: "f32", kind: "scalar" },
      { name: "b", type: "vec4f", kind: "vector" },
      { name: "c", type: "f32", kind: "scalar" },
      { name: "d", type: "vec2f", kind: "vector" },
      { name: "e", type: "mat3x3f", kind: "matrix" },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.fields["a"]).toMatchObject({ offset: 0, size: 4, alignment: 4 })
    expect(layout.fields["b"]).toMatchObject({ offset: 16, size: 16, alignment: 16 })
    expect(layout.fields["c"]).toMatchObject({ offset: 32, size: 4, alignment: 4 })
    expect(layout.fields["d"]).toMatchObject({ offset: 40, size: 8, alignment: 8 })
    expect(layout.fields["e"]).toMatchObject({ offset: 48, size: 48, alignment: 16 })
    expect(layout.totalSize).toBe(96)

    const buffer = packUniformBuffer(layout, {
      a: 1.0,
      b: [2, 3, 4, 5],
      c: 6.0,
      d: [7, 8],
      e: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })

    const view = new DataView(buffer)
    // Padding at 4..15 must be 0
    for (let offset = 4; offset < 16; offset += 4) {
      expect(view.getUint32(offset, true)).toBe(0)
    }
    // Padding at 36..39 must be 0
    expect(view.getUint32(36, true)).toBe(0)
  })

  it("Test 3: packs mat3x3f with 16-byte column strides and internal padding", () => {
    const uniforms: ParsedUniform[] = [
      { name: "u_m2", type: "mat2x2f", kind: "matrix" },
      { name: "u_m3", type: "mat3x3f", kind: "matrix" },
      { name: "u_m4", type: "mat4x4f", kind: "matrix" },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.fields["u_m2"]).toMatchObject({ offset: 0, size: 16, alignment: 8 })
    expect(layout.fields["u_m3"]).toMatchObject({ offset: 16, size: 48, alignment: 16 })
    expect(layout.fields["u_m4"]).toMatchObject({ offset: 64, size: 64, alignment: 16 })
    expect(layout.totalSize).toBe(128)

    const mat3Vals = [
      1, 2, 3, // col 0
      4, 5, 6, // col 1
      7, 8, 9, // col 2
    ]

    const buffer = packUniformBuffer(layout, { u_m3: mat3Vals })
    const view = new DataView(buffer)

    // Col 0: floats at 16, 20, 24; pad at 28
    expect(view.getFloat32(16, true)).toBeCloseTo(1)
    expect(view.getFloat32(20, true)).toBeCloseTo(2)
    expect(view.getFloat32(24, true)).toBeCloseTo(3)
    expect(view.getUint32(28, true)).toBe(0)

    // Col 1: floats at 32, 36, 40; pad at 44
    expect(view.getFloat32(32, true)).toBeCloseTo(4)
    expect(view.getFloat32(36, true)).toBeCloseTo(5)
    expect(view.getFloat32(40, true)).toBeCloseTo(6)
    expect(view.getUint32(44, true)).toBe(0)

    // Col 2: floats at 48, 52, 56; pad at 60
    expect(view.getFloat32(48, true)).toBeCloseTo(7)
    expect(view.getFloat32(52, true)).toBeCloseTo(8)
    expect(view.getFloat32(56, true)).toBeCloseTo(9)
    expect(view.getUint32(60, true)).toBe(0)
  })

  it("Test 4: handles consecutive vec3f members with 16-byte alignment", () => {
    const uniforms: ParsedUniform[] = [
      { name: "v1", type: "vec3f", kind: "vector" },
      { name: "v2", type: "vec3f", kind: "vector" },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.fields["v1"]).toMatchObject({ offset: 0, size: 12, alignment: 16 })
    expect(layout.fields["v2"]).toMatchObject({ offset: 16, size: 12, alignment: 16 })
    expect(layout.totalSize).toBe(32)

    const buffer = packUniformBuffer(layout, { v1: [1, 2, 3], v2: [4, 5, 6] })
    const view = new DataView(buffer)
    expect(view.getUint32(12, true)).toBe(0) // pad after v1
    expect(view.getUint32(28, true)).toBe(0) // pad after v2
  })

  it("Test 5: satisfies WebGPU minimum 16-byte buffer boundary", () => {
    // Empty uniforms list
    const emptyLayout = computeUniformBufferLayout([])
    expect(emptyLayout.totalSize).toBe(16)
    expect(Object.keys(emptyLayout.fields)).toHaveLength(0)

    const emptyBuffer = packUniformBuffer(emptyLayout, {})
    expect(emptyBuffer.byteLength).toBe(16)

    // Single scalar uniform
    const singleLayout = computeUniformBufferLayout([{ name: "x", type: "f32", kind: "scalar" }])
    expect(singleLayout.fields["x"]).toMatchObject({ offset: 0, size: 4, alignment: 4 })
    expect(singleLayout.totalSize).toBe(16)
    expect(singleLayout.totalSize % 16).toBe(0)
  })

  it("Test 6: excludes texture uniforms from uniform buffer layout", () => {
    const uniforms: ParsedUniform[] = [
      { name: "u_texture", type: "texture", kind: "texture" },
      { name: "u_color", type: "vec4f", kind: "color" },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.fields["u_texture"]).toBeUndefined()
    expect(layout.fields["u_color"]).toBeDefined()
    expect(layout.fields["u_color"].offset).toBe(0)
    expect(layout.totalSize).toBe(16)
  })

  it("Test 7: handles array uniforms with std140 16-byte element stride", () => {
    const uniforms: ParsedUniform[] = [
      { name: "u_weights", type: "f32", kind: "scalar", arrayLength: 4 },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    expect(layout.fields["u_weights"]).toMatchObject({
      offset: 0,
      arrayCount: 4,
      arrayStride: 16,
      size: 64,
      alignment: 16,
    })
    expect(layout.totalSize).toBe(64)

    const buffer = packUniformBuffer(layout, { u_weights: [1.0, 2.0, 3.0, 4.0] })
    const view = new DataView(buffer)
    expect(view.getFloat32(0, true)).toBeCloseTo(1.0)
    expect(view.getFloat32(16, true)).toBeCloseTo(2.0)
    expect(view.getFloat32(32, true)).toBeCloseTo(3.0)
    expect(view.getFloat32(48, true)).toBeCloseTo(4.0)
  })

  it("Test 8: unwraps UniformValue wrapper objects or accepts raw arrays", () => {
    const uniforms: ParsedUniform[] = [
      { name: "u_val", type: "vec3f", kind: "vector" },
    ]

    const layout = computeUniformBufferLayout(uniforms)

    const bufWrapped = packUniformBuffer(layout, {
      u_val: { type: "vec3", value: [1.0, 2.0, 3.0] },
    })

    const bufRaw = packUniformBuffer(layout, {
      u_val: [1.0, 2.0, 3.0],
    })

    const v1 = new Float32Array(bufWrapped)
    const v2 = new Float32Array(bufRaw)
    expect(Array.from(v1)).toEqual(Array.from(v2))
  })

  it("Test 9: safely zero-fills missing or null uniform values", () => {
    const uniforms: ParsedUniform[] = [
      { name: "u_a", type: "f32", kind: "scalar" },
      { name: "u_b", type: "vec4f", kind: "vector" },
    ]

    const layout = computeUniformBufferLayout(uniforms)
    const buffer = packUniformBuffer(layout, {})
    expect(buffer.byteLength).toBe(32)

    const view = new DataView(buffer)
    expect(view.getFloat32(0, true)).toBe(0)
    expect(view.getFloat32(16, true)).toBe(0)
  })
})
