import { describe, it, expect } from "vitest"
import type { Node } from "@xyflow/react"
import {
  validateMathExpression,
  compileMathExpressionToWgsl,
} from "@/core/mathExpressionValidator"
import {
  validateCustomNodeManifest,
  type CustomNodeManifest,
  CustomNodeRegistry,
} from "@/core/customNodeSdk"
import {
  flattenGraph,
  type GraphNodeData,
  type SubGraphNodeData,
} from "@/core/graphCompiler"
import { SubGraphLibrary } from "@/core/subGraphLibrary"

describe("Milestone 1 Gate 2: Empirical Boundary Probes", () => {
  // =========================================================================
  // PROBE BATTERY 1: Deeply Nested mod() with Multi-Arg Functions & Mixed Arithmetic
  // =========================================================================
  describe("Probe Battery 1: mod() with Multi-Arg Functions & Mixed Arithmetic", () => {
    it("handles mod() containing mixed arithmetic and 2-arg dot(): mod(sin(x) * dot(uv, uv) + 1.0, 2.0)", () => {
      const expr = "mod(sin(x) * dot(uv, uv) + 1.0, 2.0)"
      const val = validateMathExpression(expr, ["x", "uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((sin(x) * dot(uv, uv) + 1.0) % (2.0));")
      expect(wgsl).not.toContain(", 2.0)")
    })

    it("handles mod() containing 3-arg clamp() and 3-arg mix(): mod(mix(clamp(x, 0.0, 1.0), 5.0, 0.5), 2.0)", () => {
      const expr = "mod(mix(clamp(x, 0.0, 1.0), 5.0, 0.5), 2.0)"
      const val = validateMathExpression(expr, ["x"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((mix(clamp(x, 0.0, 1.0), 5.0, 0.5)) % (2.0));")
    })

    it("handles mod() containing 3-arg smoothstep(): mod(smoothstep(0.0, 1.0, uv.x) * 10.0, 3.0)", () => {
      const expr = "mod(smoothstep(0.0, 1.0, uv.x) * 10.0, 3.0)"
      const val = validateMathExpression(expr, ["uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((smoothstep(0.0, 1.0, uv.x) * 10.0) % (3.0));")
    })

    it("handles 3 levels of nested mod(): mod(mod(mod(x, 2.0) + 1.0, 3.0) * 2.0, 4.0)", () => {
      const expr = "mod(mod(mod(x, 2.0) + 1.0, 3.0) * 2.0, 4.0)"
      const val = validateMathExpression(expr, ["x"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((((((x) % (2.0)) + 1.0) % (3.0)) * 2.0) % (4.0));")
      expect(wgsl).not.toContain("mod(")
    })

    it("handles multiple sibling mod() calls on the same line: mod(uv.x, 2.0) + mod(uv.y, 3.0)", () => {
      const expr = "mod(uv.x, 2.0) + mod(uv.y, 3.0)"
      const val = validateMathExpression(expr, ["uv"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((uv.x) % (2.0)) + ((uv.y) % (3.0));")
      expect(wgsl).not.toContain("mod(")
    })

    it("handles mod() where divisor is another complex expression: mod(x, pow(2.0, y) + 1.0)", () => {
      const expr = "mod(x, pow(2.0, y) + 1.0)"
      const val = validateMathExpression(expr, ["x", "y"])
      expect(val.isValid).toBe(true)

      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((x) % (pow(2.0, y) + 1.0));")
    })
  })

  // =========================================================================
  // PROBE BATTERY 2: Single-Arg atan vs Multi-Arg atan in WGSL Expressions
  // =========================================================================
  describe("Probe Battery 2: Single-Arg atan vs Multi-Arg atan in WGSL Expressions", () => {
    it("preserves single-arg atan(x) as atan(x)", () => {
      const wgsl = compileMathExpressionToWgsl("atan(uv.x)", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(uv.x);")
      expect(wgsl).not.toContain("atan2")
    })

    it("translates 2-arg atan(y, x) to atan2(y, x)", () => {
      const wgsl = compileMathExpressionToWgsl("atan(uv.y, uv.x)", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(uv.y, uv.x);")
    })

    it("handles single-arg atan containing arithmetic and nested functions: atan(sin(uv.x) / cos(uv.y))", () => {
      const wgsl = compileMathExpressionToWgsl("atan(sin(uv.x) / cos(uv.y))", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(sin(uv.x) / cos(uv.y));")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles 2-arg atan containing multi-arg functions: atan(dot(uv, uv), length(uv))", () => {
      const wgsl = compileMathExpressionToWgsl("atan(dot(uv, uv), length(uv))", "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(dot(uv, uv), length(uv));")
    })

    it("handles single-arg atan containing multi-arg dot() with commas: atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)))", () => {
      const expr = "atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(dot(vec2(1.0, 2.0), vec2(3.0, 4.0)));")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles nested atan calls: outer 1-arg atan enclosing inner 2-arg atan: atan(atan(uv.y, uv.x))", () => {
      const expr = "atan(atan(uv.y, uv.x))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan(atan2(uv.y, uv.x));")
    })

    it("handles 2-arg atan where both arguments are 2-arg atans: atan(atan(y1, x1), atan(y2, x2))", () => {
      const expr = "atan(atan(y1, x1), atan(y2, x2))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(atan2(y1, x1), atan2(y2, x2));")
    })

    it("does not mutate atanh(x) into atan2h(x)", () => {
      const expr = "atanh(uv.x)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atanh(uv.x);")
      expect(wgsl).not.toContain("atan2")
    })

    it("handles simultaneous mod() and atan() nesting: mod(atan(uv.y, uv.x), PI)", () => {
      const expr = "mod(atan(uv.y, uv.x), PI)"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = ((atan2(uv.y, uv.x)) % (PI));")
    })

    it("handles 2-arg atan() with mod() in arguments: atan(mod(uv.y, 2.0), mod(uv.x, 2.0))", () => {
      const expr = "atan(mod(uv.y, 2.0), mod(uv.x, 2.0))"
      const wgsl = compileMathExpressionToWgsl(expr, "out", "float")
      expect(wgsl).toBe("let out: f32 = atan2(((uv.y) % (2.0)), ((uv.x) % (2.0)));")
    })
  })

  // =========================================================================
  // PROBE BATTERY 3: Pathological Custom Node Manifests
  // =========================================================================
  describe("Probe Battery 3: Pathological Custom Node Manifests", () => {
    it("rejects empty string and whitespace-only strings for 'id', 'name', 'type', and 'title'", () => {
      const manifests = [
        { id: "", name: "Valid Name", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "  \t  ", name: "Valid Name", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", name: "", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", name: "   ", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "valid-id", title: "   ", inputs: [], outputs: [], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.length).toBeGreaterThan(0)
      }
    })

    it("rejects non-array inputs, outputs, and parameters without throwing exceptions", () => {
      const manifests = [
        { id: "test", name: "Test", inputs: "not-an-array", outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: [], outputs: 12345, parameters: [], glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: [], outputs: [], parameters: { a: 1 }, glsl: "void main() {}" },
        { id: "test", name: "Test", inputs: null, outputs: null, parameters: null, glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        expect(() => {
          const res = validateCustomNodeManifest(m)
          expect(res.valid).toBe(false)
        }).not.toThrow()
      }
    })

    it("rejects inputs array containing null, undefined, primitive, or malformed entries", () => {
      const manifests = [
        { id: "t1", name: "T1", inputs: [null], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t2", name: "T2", inputs: [undefined], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t3", name: "T3", inputs: ["string_port"], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t4", name: "T4", inputs: [{ name: "in" }], outputs: [], parameters: [], glsl: "void main() {}" },
        { id: "t5", name: "T5", inputs: [{ type: "float" }], outputs: [], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.some((e) => e.includes("Input port at index 0"))).toBe(true)
      }
    })

    it("rejects outputs array containing null, undefined, primitive, or malformed entries", () => {
      const manifests = [
        { id: "t1", name: "T1", inputs: [], outputs: [null], parameters: [], glsl: "void main() {}" },
        { id: "t2", name: "T2", inputs: [], outputs: [undefined], parameters: [], glsl: "void main() {}" },
        { id: "t3", name: "T3", inputs: [], outputs: [42], parameters: [], glsl: "void main() {}" },
        { id: "t4", name: "T4", inputs: [], outputs: [{ name: "out" }], parameters: [], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.some((e) => e.includes("Output port at index 0"))).toBe(true)
      }
    })

    it("rejects parameters array containing null, undefined, arrays, or objects with empty name/type", () => {
      const manifests = [
        { id: "p1", name: "P1", inputs: [], outputs: [], parameters: [null], glsl: "void main() {}" },
        { id: "p2", name: "P2", inputs: [], outputs: [], parameters: [undefined], glsl: "void main() {}" },
        { id: "p3", name: "P3", inputs: [], outputs: [], parameters: [[]], glsl: "void main() {}" },
        { id: "p4", name: "P4", inputs: [], outputs: [], parameters: [123], glsl: "void main() {}" },
        { id: "p5", name: "P5", inputs: [], outputs: [], parameters: [{ name: "", type: "float" }], glsl: "void main() {}" },
        { id: "p6", name: "P6", inputs: [], outputs: [], parameters: [{ name: "   ", type: "float" }], glsl: "void main() {}" },
        { id: "p7", name: "P7", inputs: [], outputs: [], parameters: [{ name: "speed", type: "" }], glsl: "void main() {}" },
        { id: "p8", name: "P8", inputs: [], outputs: [], parameters: [{ name: "speed", type: "   " }], glsl: "void main() {}" },
      ]

      for (const m of manifests) {
        const res = validateCustomNodeManifest(m)
        expect(res.valid).toBe(false)
        expect(res.errors.length).toBeGreaterThan(0)
      }
    })

    it("survives circular parameter reference objects without infinite recursion or stack overflow", () => {
      const circularParam: any = {
        name: "recursive_param",
        type: "float",
        default: 1.0,
      }
      circularParam.self = circularParam
      circularParam.options = [{ label: "Self", value: circularParam }]

      const circularManifest: any = {
        id: "circular-param-manifest",
        name: "Circular Param Manifest",
        inputs: [{ name: "in", type: "float" }],
        outputs: [{ name: "out", type: "float" }],
        parameters: [circularParam],
        glsl: "float run(float x) { return x; }",
      }
      circularManifest.self = circularManifest

      expect(() => {
        const res = validateCustomNodeManifest(circularManifest)
        expect(res.valid).toBe(true)
        expect(res.manifest).toBeDefined()
        expect(res.manifest?.parameters[0].name).toBe("recursive_param")
      }).not.toThrow()
    })

    it("CustomNodeRegistry successfully registers valid manifest and rejects malformed manifest without crashing", () => {
      const registry = new CustomNodeRegistry()

      const validManifest: CustomNodeManifest = {
        id: "my-custom-filter",
        name: "My Custom Filter",
        category: "filter",
        inputs: [{ name: "color", type: "vec4" }],
        outputs: [{ name: "result", type: "vec4" }],
        parameters: [{ name: "intensity", type: "float", default: 0.5 }],
        wgsl: "fn run(c: vec4<f32>) -> vec4<f32> { return c; }",
      }

      const registered = registry.register(validManifest)
      expect(registered).toBe(true)
      expect(registry.has("my-custom-filter")).toBe(true)

      const badManifest: any = {
        id: "   ",
        name: "Bad",
        inputs: [],
        outputs: [],
        parameters: [],
      }
      const registeredBad = registry.register(badManifest)
      expect(registeredBad).toBe(false)
      expect(registry.has("   ")).toBe(false)
    })
  })

  // =========================================================================
  // PROBE BATTERY 4: Sub-Graph Uniform Namespacing Hyphen and Punctuation Stress
  // =========================================================================
  describe("Probe Battery 4: Sub-Graph Uniform Namespacing Hyphens and Syntax Safety", () => {
    it("replaces hyphens in node IDs to produce syntactically valid GLSL/WGSL uniform identifiers", () => {
      const lib = new SubGraphLibrary()
      lib.register({
        id: "hyphen-sub",
        name: "Hyphen Sub",
        category: "Utility",
        isBuiltin: false,
        inputs: [],
        outputs: [{ id: "out", name: "Out", type: "float", direction: "output", internalNodeId: "u_val" }],
        nodes: [
          {
            id: "u_val",
            position: { x: 0, y: 0 },
            data: { type: "uniform", name: "speed", uniformId: "u_speed", uniformType: "float", defaultValue: 1.0 },
          },
        ],
        edges: [],
      })

      const rootNodes: Node<GraphNodeData>[] = [
        {
          id: "subgraph-node-999-alpha-beta",
          position: { x: 0, y: 0 },
          data: {
            type: "subgraph",
            subGraphId: "hyphen-sub",
            name: "Hyphen Test",
            uniformValues: { speed: 42.0 },
          } as SubGraphNodeData,
        },
      ]

      const result = flattenGraph(rootNodes, [], lib)
      expect(result.error).toBeNull()

      const uniformNode = result.nodes.find((n) => n.data.type === "uniform")
      expect(uniformNode).toBeDefined()
      if (uniformNode && uniformNode.data.type === "uniform") {
        expect(uniformNode.data.name).not.toContain("-")
        expect(uniformNode.data.name).toBe("u_subgraph_node_999_alpha_beta_speed")
        expect(uniformNode.data.defaultValue).toBe(42.0)
      }
    })
  })
})
