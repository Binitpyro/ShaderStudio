import { describe, it, expect } from "vitest"
import {
  validateMathExpression,
  compileMathExpressionToGlsl,
  compileMathExpressionToWgsl,
  MATH_FUNCTIONS_WHITELIST,
  MATH_GLOBALS_WHITELIST,
} from "@/core/mathExpressionValidator"

describe("R1c: Math Expression Validator & Shader Codegen", () => {
  describe("Whitelists Verification", () => {
    it("contains essential math functions and shader intrinsics", () => {
      const essentials = ["sin", "cos", "tan", "pow", "exp", "sqrt", "abs", "floor", "ceil", "fract", "mod", "min", "max", "clamp", "mix", "step", "smoothstep", "length", "dot", "cross", "normalize"]
      for (const fn of essentials) {
        expect(MATH_FUNCTIONS_WHITELIST.has(fn)).toBe(true)
      }
    })

    it("contains standard shader globals and constants", () => {
      expect(MATH_GLOBALS_WHITELIST.has("uv")).toBe(true)
      expect(MATH_GLOBALS_WHITELIST.has("time")).toBe(true)
      expect(MATH_GLOBALS_WHITELIST.has("resolution")).toBe(true)
      expect(MATH_GLOBALS_WHITELIST.has("PI")).toBe(true)
      expect(MATH_GLOBALS_WHITELIST.has("TAU")).toBe(true)
    })
  })

  describe("Parenthesis Balance & Empty Checks", () => {
    it("rejects empty or whitespace-only expressions", () => {
      const res1 = validateMathExpression("")
      expect(res1.isValid).toBe(false)
      expect(res1.error).toContain("cannot be empty")

      const res2 = validateMathExpression("   ")
      expect(res2.isValid).toBe(false)
      expect(res2.error).toContain("cannot be empty")
    })

    it("detects premature closing parenthesis", () => {
      const res = validateMathExpression("sin(uv.x)) + 1.0")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unexpected closing parenthesis")
    })

    it("detects unclosed opening parenthesis", () => {
      const res = validateMathExpression("sin(uv.x * 2.0 + (cos(time)")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unmatched opening parenthesis")
      expect(res.error).toContain("missing 2 closing parenthesis")
    })
  })

  describe("Operator & Token Syntax Checking", () => {
    it("flags expressions ending with binary operator", () => {
      const res = validateMathExpression("sin(uv.x) +")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("cannot end with an operator '+'")
    })

    it("flags expressions starting with binary operators", () => {
      expect(validateMathExpression("* 2.0").isValid).toBe(false)
      expect(validateMathExpression("/ 4.0").isValid).toBe(false)
      expect(validateMathExpression("% 3.0").isValid).toBe(false)
    })

    it("flags trailing dots and illegal characters", () => {
      expect(validateMathExpression("uv.").isValid).toBe(false)
      expect(validateMathExpression("sin(uv.x);").isValid).toBe(false)
      expect(validateMathExpression("uv.x = 1.0").isValid).toBe(false)
      expect(validateMathExpression("uv[0]").isValid).toBe(false)
    })

    it("flags consecutive binary operators", () => {
      const res = validateMathExpression("uv.x * * 2.0")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unexpected consecutive operator '* *'")
    })

    it("validates valid numeric literals and decimals", () => {
      const res = validateMathExpression(".5 + 0.25 * 100.0 - 42")
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
    })

    it("validates vec component swizzles", () => {
      const res1 = validateMathExpression("uv.x + uv.y")
      expect(res1.isValid).toBe(true)

      const res2 = validateMathExpression("uv.invalidSwizzle")
      expect(res2.isValid).toBe(false)
      expect(res2.error).toContain("Invalid swizzle component '.invalidSwizzle'")
    })
  })

  describe("Function Whitelist & Variable Resolution", () => {
    it("allows whitelisted math functions", () => {
      const res = validateMathExpression("sin(uv.x * PI) * cos(time) + sqrt(abs(uv.y))")
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
    })

    it("rejects unauthorized and malicious function calls", () => {
      const forbidden = ["eval", "alert", "fetch", "require", "System", "window", "document"]
      for (const fn of forbidden) {
        const res = validateMathExpression(`${fn}(42)`)
        expect(res.isValid).toBe(false)
        expect(res.error).toContain(`Function '${fn}()' is not permitted`)
      }
    })

    it("rejects undeclared variable identifiers", () => {
      const res = validateMathExpression("sin(unknownVar * 2.0)")
      expect(res.isValid).toBe(false)
      expect(res.error).toContain("Unknown identifier 'unknownVar'")
    })

    it("resolves declared custom input ports and tracks referenced inputs", () => {
      const declared = ["frequency", "amplitude", "offset"]
      const res = validateMathExpression("sin(uv.x * frequency) * amplitude + offset", declared)
      expect(res.isValid).toBe(true)
      expect(res.error).toBeNull()
      expect(res.referencedInputs).toEqual(["frequency", "amplitude", "offset"])
    })
  })

  describe("Output Type Inference", () => {
    it("infers float type for scalar arithmetic", () => {
      const res = validateMathExpression("sin(uv.x * 10.0) * 0.5 + 0.5")
      expect(res.isValid).toBe(true)
      expect(res.outputType).toBe("float")
    })

    it("infers vec2 type when constructor or swizzle is used", () => {
      const res1 = validateMathExpression("vec2(uv.x, uv.y * 2.0)")
      expect(res1.outputType).toBe("vec2")

      const res2 = validateMathExpression("uv")
      expect(res2.outputType).toBe("vec2")
    })

    it("infers vec3 type when vec3 constructor or cross product is used", () => {
      const res1 = validateMathExpression("vec3(uv.x, uv.y, 1.0)")
      expect(res1.outputType).toBe("vec3")

      const res2 = validateMathExpression("cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))")
      expect(res2.outputType).toBe("vec3")
    })

    it("infers vec4 type when vec4 constructor or rgba swizzle is used", () => {
      const res = validateMathExpression("vec4(uv.x, uv.y, 0.0, 1.0)")
      expect(res.outputType).toBe("vec4")
    })
  })

  describe("GLSL & WGSL Codegen", () => {
    it("compiles valid expressions into GLSL variable assignment", () => {
      const glslFloat = compileMathExpressionToGlsl("sin(uv.x * 6.28) * 0.5 + 0.5", "my_val", "float")
      expect(glslFloat).toBe("float my_val = sin(uv.x * 6.28) * 0.5 + 0.5;")

      const glslVec3 = compileMathExpressionToGlsl("vec3(1.0, 0.5, 0.2)", "my_color", "vec3")
      expect(glslVec3).toBe("vec3 my_color = vec3(1.0, 0.5, 0.2);")
    })

    it("compiles valid expressions into WGSL let statements with type mapping", () => {
      const wgslFloat = compileMathExpressionToWgsl("sin(uv.x * 6.28) * 0.5 + 0.5", "my_val", "float")
      expect(wgslFloat).toBe("let my_val: f32 = sin(uv.x * 6.28) * 0.5 + 0.5;")

      const wgslVec2 = compileMathExpressionToWgsl("vec2(uv.x, uv.y)", "my_uv", "vec2")
      expect(wgslVec2).toBe("let my_uv: vec2<f32> = vec2(uv.x, uv.y);")

      const wgslVec3 = compileMathExpressionToWgsl("vec3(1.0, 0.5, 0.2)", "my_color", "vec3")
      expect(wgslVec3).toBe("let my_color: vec3<f32> = vec3(1.0, 0.5, 0.2);")

      const wgslVec4 = compileMathExpressionToWgsl("vec4(1.0, 0.5, 0.2, 1.0)", "my_rgba", "vec4")
      expect(wgslVec4).toBe("let my_rgba: vec4<f32> = vec4(1.0, 0.5, 0.2, 1.0);")
    })

    it("translates mod(a, b) and atan() functions appropriately in WGSL", () => {
      const wgslMod = compileMathExpressionToWgsl("mod(uv.x * 10.0, 2.0)", "pattern", "float")
      expect(wgslMod).toContain("((uv.x * 10.0) % (2.0))")

      const wgslNestedMod = compileMathExpressionToWgsl("mod(dot(uv, uv), 2.0)", "pattern", "float")
      expect(wgslNestedMod).toContain("((dot(uv, uv)) % (2.0))")
      expect(wgslNestedMod).not.toContain(", 2.0)")

      const wgslModPow = compileMathExpressionToWgsl("mod(pow(uv.x, 2.0), 1.0)", "pattern", "float")
      expect(wgslModPow).toContain("((pow(uv.x, 2.0)) % (1.0))")

      // Single-argument atan(x) is preserved in WGSL
      const wgslAtan1 = compileMathExpressionToWgsl("atan(uv.x)", "angle", "float")
      expect(wgslAtan1).toBe("let angle: f32 = atan(uv.x);")
      expect(wgslAtan1).not.toContain("atan2")

      // Two-argument atan(y, x) translates to atan2(y, x) in WGSL
      const wgslAtan2 = compileMathExpressionToWgsl("atan(uv.y, uv.x)", "angle", "float")
      expect(wgslAtan2).toContain("atan2(uv.y, uv.x)")
    })
  })
})
