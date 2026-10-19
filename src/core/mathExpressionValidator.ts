export const MATH_FUNCTIONS_WHITELIST = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
  "abs", "sign", "floor", "ceil", "round", "trunc", "fract", "mod",
  "min", "max", "clamp", "mix", "step", "smoothstep",
  "length", "distance", "dot", "cross", "normalize", "reflect", "refract",
  "dFdx", "dFdy", "fwidth", "radians", "degrees",
  "vec2", "vec3", "vec4", "float"
])

export const MATH_GLOBALS_WHITELIST = new Set([
  "uv", "time", "u_time", "resolution", "u_resolution",
  "a", "b", "c", "d", "x", "y", "z", "w",
  "PI", "TAU", "E"
])

export interface MathValidationResult {
  isValid: boolean
  error: string | null
  tokens?: string[]
  outputType?: "float" | "vec2" | "vec3" | "vec4"
  referencedInputs?: string[]
}

export function validateMathExpression(
  expression: string,
  declaredInputs: string[] = []
): MathValidationResult {
  const trimmed = expression.trim()
  if (!trimmed) {
    return {
      isValid: false,
      error: "Expression cannot be empty.",
      referencedInputs: [],
    }
  }

  // 1. Check Parenthesis Balance
  let parenDepth = 0
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === "(") {
      parenDepth++
    } else if (ch === ")") {
      parenDepth--
      if (parenDepth < 0) {
        return {
          isValid: false,
          error: `Unexpected closing parenthesis ')' at column ${i + 1}.`,
          referencedInputs: [],
        }
      }
    }
  }
  if (parenDepth > 0) {
    return {
      isValid: false,
      error: `Unmatched opening parenthesis '(' (missing ${parenDepth} closing parenthesis).`,
      referencedInputs: [],
    }
  }

  // 2. Tokenize expression
  // Operators: +, -, *, /, %, (, ), ,, .
  // Numbers: digits with optional decimals
  // Identifiers: [a-zA-Z_][a-zA-Z0-9_]*
  const tokenRegex = /\s*([0-9]+\.?[0-9]*|\.[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*|\+\+|--|[-+*/%,()]|\.|\S)\s*/g
  const tokens: string[] = []
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(trimmed)) !== null) {
    tokens.push(match[1])
  }

  // 3. Operator syntax checks
  const binaryOps = new Set(["+", "-", "*", "/", "%"])
  const allowedPunctuation = new Set(["(", ")", ",", "."])
  const referencedInputs: string[] = []
  const inputSet = new Set([...MATH_GLOBALS_WHITELIST, ...declaredInputs])

  // Check starting with binary operator
  if (tokens.length > 0) {
    const first = tokens[0]
    if (first === "*" || first === "/" || first === "%") {
      return {
        isValid: false,
        error: `Expression cannot start with operator '${first}'.`,
        tokens,
        referencedInputs: [],
      }
    }
    const last = tokens[tokens.length - 1]
    if (binaryOps.has(last)) {
      return {
        isValid: false,
        error: `Expression cannot end with an operator '${last}'.`,
        tokens,
        referencedInputs: [],
      }
    }
    if (last === ".") {
      return {
        isValid: false,
        error: "Expression cannot end with a dot '.'.",
        tokens,
        referencedInputs: [],
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const nextTok = tokens[i + 1]

    // Check for illegal characters or unhandled tokens
    if (
      !binaryOps.has(tok) &&
      !allowedPunctuation.has(tok) &&
      !(/^[0-9]/.test(tok) || /^\.[0-9]/.test(tok)) &&
      !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tok)
    ) {
      return {
        isValid: false,
        error: `Unexpected character or token '${tok}'.`,
        tokens,
        referencedInputs: [],
      }
    }

    // Dot checks (swizzle accessor)
    if (tok === ".") {
      if (i === tokens.length - 1) {
        return {
          isValid: false,
          error: "Expression cannot end with a dot '.'.",
          tokens,
          referencedInputs: [],
        }
      }
      if (i === 0 || (!/^[a-zA-Z_]/.test(tokens[i - 1]) && tokens[i - 1] !== ")")) {
        return {
          isValid: false,
          error: "Invalid placement of dot '.'.",
          tokens,
          referencedInputs: [],
        }
      }
      if (!nextTok || !/^[xyzwrgba]{1,4}$/.test(nextTok)) {
        return {
          isValid: false,
          error: `Invalid swizzle component '.${nextTok || ""}'.`,
          tokens,
          referencedInputs: [],
        }
      }
      continue
    }

    // Consecutive binary operators like * *, / /, * +, etc. (except unary +/-)
    if (binaryOps.has(tok)) {
      if (nextTok && (nextTok === "*" || nextTok === "/" || nextTok === "%")) {
        return {
          isValid: false,
          error: `Unexpected consecutive operator '${tok} ${nextTok}'.`,
          tokens,
          referencedInputs: [],
        }
      }
    }

    // Number literal
    if (/^[0-9]/.test(tok) || /^\.[0-9]/.test(tok)) {
      if (isNaN(Number(tok))) {
        return {
          isValid: false,
          error: `Invalid numeric literal '${tok}'.`,
          tokens,
          referencedInputs: [],
        }
      }
      continue
    }

    // Identifiers and functions
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tok)) {
      // Check if this token is a swizzle following a dot (e.g. uv.x)
      if (i > 0 && tokens[i - 1] === ".") {
        if (!/^[xyzwrgba]{1,4}$/.test(tok)) {
          return {
            isValid: false,
            error: `Invalid swizzle component '.${tok}'.`,
            tokens,
            referencedInputs: [],
          }
        }
        continue
      }

      // Check if function call
      if (nextTok === "(") {
        if (!MATH_FUNCTIONS_WHITELIST.has(tok)) {
          return {
            isValid: false,
            error: `Function '${tok}()' is not permitted. Only whitelisted GLSL/WGSL math functions are allowed.`,
            tokens,
            referencedInputs: [],
          }
        }
      } else {
        // Variable / identifier
        if (!inputSet.has(tok)) {
          return {
            isValid: false,
            error: `Unknown identifier '${tok}'. Declare it as an input port or use a standard variable (uv, time, resolution).`,
            tokens,
            referencedInputs: [],
          }
        }
        if (declaredInputs.includes(tok) && !referencedInputs.includes(tok)) {
          referencedInputs.push(tok)
        }
      }
    }
  }

  // 4. Infer output type
  let inferredType: "float" | "vec2" | "vec3" | "vec4" = "float"
  if (trimmed.startsWith("vec4(") || trimmed.includes(".xyzw") || trimmed.includes(".rgba")) {
    inferredType = "vec4"
  } else if (trimmed.startsWith("vec3(") || trimmed.includes(".xyz") || trimmed.includes(".rgb") || trimmed.includes("cross(")) {
    inferredType = "vec3"
  } else if (trimmed.startsWith("vec2(") || trimmed.includes(".xy") || trimmed.includes(".rg") || trimmed === "uv") {
    inferredType = "vec2"
  }

  return {
    isValid: true,
    error: null,
    tokens,
    outputType: inferredType,
    referencedInputs,
  }
}

export function compileMathExpressionToGlsl(
  expression: string,
  varName = "expr_out",
  type: "float" | "vec2" | "vec3" | "vec4" = "float"
): string {
  // Translate expression if needed
  return `${type} ${varName} = ${expression};`
}

function replaceAtanFunctions(str: string): string {
  const matches = [...str.matchAll(/\batan\b\s*\(/g)]
  if (matches.length === 0) return str

  let result = str
  // Iterate right-to-left so string indices remain valid
  for (let m = matches.length - 1; m >= 0; m--) {
    const match = matches[m]
    const startIndex = match.index!
    const openParenIndex = startIndex + match[0].length - 1

    let depth = 0
    let topLevelCommas = 0
    let closeParenIndex = -1

    for (let i = openParenIndex + 1; i < result.length; i++) {
      const char = result[i]
      if (char === "(") {
        depth++
      } else if (char === ")") {
        if (depth === 0) {
          closeParenIndex = i
          break
        }
        depth--
      } else if (char === "," && depth === 0) {
        topLevelCommas++
      }
    }

    if (closeParenIndex !== -1 && topLevelCommas === 1) {
      result = result.slice(0, startIndex) + "atan2" + result.slice(startIndex + 4)
    }
  }
  return result
}

function replaceModFunctions(str: string): string {
  let result = str
  let safetyLimit = 100
  while (safetyLimit-- > 0) {
    const modMatches = [...result.matchAll(/\bmod\b\s*\(/g)]
    if (modMatches.length === 0) break

    const lastMatch = modMatches[modMatches.length - 1]
    const startIndex = lastMatch.index!
    const openParenIndex = startIndex + lastMatch[0].length - 1

    let depth = 0
    let commaIndex = -1
    let closeParenIndex = -1

    for (let i = openParenIndex + 1; i < result.length; i++) {
      const char = result[i]
      if (char === "(") {
        depth++
      } else if (char === ")") {
        if (depth === 0) {
          closeParenIndex = i
          break
        }
        depth--
      } else if (char === "," && depth === 0) {
        if (commaIndex === -1) {
          commaIndex = i
        }
      }
    }

    if (commaIndex !== -1 && closeParenIndex !== -1) {
      const arg1 = result.slice(openParenIndex + 1, commaIndex).trim()
      const arg2 = result.slice(commaIndex + 1, closeParenIndex).trim()
      const replacement = `((${arg1}) % (${arg2}))`
      result = result.slice(0, startIndex) + replacement + result.slice(closeParenIndex + 1)
    } else {
      break
    }
  }
  return result
}

export function compileMathExpressionToWgsl(
  expression: string,
  varName = "expr_out",
  type: "float" | "vec2" | "vec3" | "vec4" = "float"
): string {
  let translated = expression

  // Convert 2-argument atan(y, x) to atan2(y, x), while preserving 1-argument atan(x)
  translated = replaceAtanFunctions(translated)

  // Convert mod(a, b) to ((a) % (b)) supporting nested function calls
  translated = replaceModFunctions(translated)

  const wgslType =
    type === "float"
      ? "f32"
      : type === "vec2"
      ? "vec2<f32>"
      : type === "vec3"
      ? "vec3<f32>"
      : "vec4<f32>"

  return `let ${varName}: ${wgslType} = ${translated};`
}
