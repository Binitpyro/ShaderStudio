import { describe, it, expect } from "vitest"
import {
  evaluateSdfPrimitive,
  DEFAULT_PRIMITIVE_PARAMS,
  type SdfPrimitiveParams,
} from "../sdfPrimitives"
import {
  smin,
  smax,
  evaluateBooleanOperator,
  evaluateDomainOperator,
} from "../sdfOperators"
import {
  compileSdfToGlsl,
  compileSdfToWgsl,
  type SdfTreeNode,
} from "../sdfCompiler"

describe("Visual Raymarching & SDF Core Math", () => {
  describe("SDF Primitives", () => {
    it("evaluates sphere signed distance correctly", () => {
      expect(DEFAULT_PRIMITIVE_PARAMS.sphere.radius).toBe(1.0)
      const params: SdfPrimitiveParams = {
        type: "sphere",
        offset: [0, 0, 0],
        radius: 1.0,
      }

      // Center: -1.0
      expect(evaluateSdfPrimitive([0, 0, 0], params)).toBeCloseTo(-1.0, 4)
      // Surface: 0.0
      expect(evaluateSdfPrimitive([1, 0, 0], params)).toBeCloseTo(0.0, 4)
      expect(evaluateSdfPrimitive([0, 1, 0], params)).toBeCloseTo(0.0, 4)
      // Outside: 1.0
      expect(evaluateSdfPrimitive([2, 0, 0], params)).toBeCloseTo(1.0, 4)
    })

    it("evaluates box signed distance correctly", () => {
      const params: SdfPrimitiveParams = {
        type: "box",
        offset: [0, 0, 0],
        size: [1, 1, 1],
      }

      // Center is inside
      expect(evaluateSdfPrimitive([0, 0, 0], params)).toBeLessThan(0)
      // On face
      expect(evaluateSdfPrimitive([1, 0, 0], params)).toBeCloseTo(0.0, 4)
      // Outside
      expect(evaluateSdfPrimitive([2, 0, 0], params)).toBeCloseTo(1.0, 4)
    })

    it("evaluates torus, cylinder, capsule, and plane distances", () => {
      const torusParams: SdfPrimitiveParams = {
        type: "torus",
        offset: [0, 0, 0],
        majorRadius: 1.0,
        minorRadius: 0.25,
      }
      expect(evaluateSdfPrimitive([1.0, 0.25, 0.0], torusParams)).toBeCloseTo(0.0, 4)

      const cylParams: SdfPrimitiveParams = {
        type: "cylinder",
        offset: [0, 0, 0],
        radius: 0.5,
        height: 1.0,
      }
      expect(evaluateSdfPrimitive([0.5, 0.0, 0.0], cylParams)).toBeCloseTo(0.0, 4)

      const capParams: SdfPrimitiveParams = {
        type: "capsule",
        offset: [0, 0, 0],
        capsuleA: [0, -1, 0],
        capsuleB: [0, 1, 0],
        radius: 0.3,
      }
      expect(evaluateSdfPrimitive([0.3, 0.0, 0.0], capParams)).toBeCloseTo(0.0, 4)

      const planeParams: SdfPrimitiveParams = {
        type: "plane",
        offset: [0, 0, 0],
        planeNormal: [0, 1, 0],
        planeDistance: 0.0,
      }
      expect(evaluateSdfPrimitive([0, 2.5, 0], planeParams)).toBeCloseTo(2.5, 4)
    })
  })

  describe("SDF Operators", () => {
    it("evaluates boolean union, subtraction, and intersection", () => {
      expect(evaluateBooleanOperator("union", 1.5, 2.5)).toBeCloseTo(1.5, 4)
      expect(evaluateBooleanOperator("subtraction", 1.0, 3.0)).toBeCloseTo(3.0, 4)
      expect(evaluateBooleanOperator("intersection", 1.5, 2.5)).toBeCloseTo(2.5, 4)
    })

    it("evaluates polynomial smin smoothly blend two distances", () => {
      const d1 = 1.0
      const d2 = 1.0
      const smooth = smin(d1, d2, 0.2)
      // smin of two identical values is strictly less than either value by k/4 = 0.2/4 = 0.05
      expect(smooth).toBeLessThan(1.0)
      expect(smooth).toBeCloseTo(0.95, 3)

      const smoothMax = smax(d1, d2, 0.2)
      expect(smoothMax).toBeGreaterThan(1.0)
      expect(smoothMax).toBeCloseTo(1.05, 3)
    })

    it("evaluates repetition domain deformation operator", () => {
      const p: [number, number, number] = [3.5, 0.0, 0.0]
      const modP = evaluateDomainOperator("repetition", p, {
        type: "repetition",
        repetitionSpacing: [3.0, 3.0, 3.0],
      })
      expect(modP[0]).toBeCloseTo(0.5, 3)
    })

    it("evaluates twist domain deformation operator", () => {
      const p: [number, number, number] = [1.0, 0.0, 0.0]
      const twisted = evaluateDomainOperator("twist", p, {
        type: "twist",
        twistRate: 1.0,
      })
      expect(twisted[0]).toBeCloseTo(1.0, 3)
      expect(twisted[1]).toBeCloseTo(0.0, 3)
    })
  })

  describe("SDF Compiler", () => {
    const sceneTree: SdfTreeNode = {
      kind: "operator",
      id: "smooth_union_1",
      type: "smooth_union",
      params: { type: "smooth_union", smoothness: 0.25 },
      children: [
        {
          kind: "primitive",
          id: "sphere_a",
          type: "sphere",
          params: { type: "sphere", offset: [-0.6, 0, 0], radius: 0.8 },
        },
        {
          kind: "primitive",
          id: "sphere_b",
          type: "sphere",
          params: { type: "sphere", offset: [0.6, 0, 0], radius: 0.8 },
        },
      ],
    }

    it("compiles SDF scene tree into complete GLSL 300 es raymarching shader", () => {
      const glsl = compileSdfToGlsl(sceneTree)
      expect(glsl).toContain("#version 300 es")
      expect(glsl).toContain("float map(vec3 p)")
      expect(glsl).toContain("opSmoothUnion")
      expect(glsl).toContain("sdSphere")
      expect(glsl).toContain("calcNormal")
      expect(glsl).toContain("calcSoftShadow")
      expect(glsl).toContain("calcAO")
      expect(glsl).toContain("fragColor =")
    })

    it("compiles SDF scene tree into complete WGSL raymarching shader", () => {
      const wgsl = compileSdfToWgsl(sceneTree)
      expect(wgsl).toContain("fn vertex_main")
      expect(wgsl).toContain("fn fragment_main")
      expect(wgsl).toContain("fn map(p: vec3f) -> f32")
      expect(wgsl).toContain("opSmoothUnion")
      expect(wgsl).toContain("sdSphere")
      expect(wgsl).toContain("calcNormal")
      expect(wgsl).toContain("calcSoftShadow")
      expect(wgsl).toContain("calcAO")
      expect(wgsl).toContain("@location(0) vec4f")
    })
  })
})
