import { describe, it, expect } from "vitest"
import { parseDiagnosticErrors } from "../diagnosticParser"

describe("Diagnostic Error Parser", () => {
  it("returns empty array for empty or null error", () => {
    expect(parseDiagnosticErrors(null)).toEqual([])
    expect(parseDiagnosticErrors("")).toEqual([])
    expect(parseDiagnosticErrors("   ")).toEqual([])
  })

  it("parses WebGL syntax error format", () => {
    const raw = "ERROR: 0:14: 'u_intensity' : undeclared identifier\nERROR: 0:15: '=' : cannot convert"
    const parsed = parseDiagnosticErrors(raw)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      line: 14,
      column: null,
      message: "'u_intensity' : undeclared identifier",
    })
    expect(parsed[1]).toEqual({
      line: 15,
      column: null,
      message: "'=' : cannot convert",
    })
  })

  it("parses WebGPU WGSL syntax error format", () => {
    const raw = ":12:15 error: expected ';' for statement\n:25:4 error: unresolved type 'vec5f'"
    const parsed = parseDiagnosticErrors(raw)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      line: 12,
      column: 15,
      message: "expected ';' for statement",
    })
    expect(parsed[1]).toEqual({
      line: 25,
      column: 4,
      message: "unresolved type 'vec5f'",
    })
  })

  it("parses generic error with line and column", () => {
    const raw = "Error at line 42, col 10: missing semicolon"
    const parsed = parseDiagnosticErrors(raw)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].line).toBe(42)
    expect(parsed[0].column).toBe(10)
    expect(parsed[0].message).toContain("missing semicolon")
  })

  it("extracts line from phrase with error message", () => {
    const raw = "Failed to compile shader on line 77 due to invalid uniform struct"
    const parsed = parseDiagnosticErrors(raw)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].line).toBe(77)
    expect(parsed[0].message).toContain("due to invalid uniform struct")
  })

  it("falls back to full raw message when no line pattern exists", () => {
    const raw = "Unknown catastrophic failure in GPU driver"
    const parsed = parseDiagnosticErrors(raw)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].line).toBeNull()
    expect(parsed[0].message).toBe(raw)
  })
})
