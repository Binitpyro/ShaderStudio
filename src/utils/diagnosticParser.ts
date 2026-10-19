import type { DiagnosticError } from "@/bridge/bridgeProtocol"

/**
 * Parses raw error messages from WebGPU, WebGL2, or Three.js compilers
 * into structured diagnostic objects with line and column numbers.
 */
export function parseDiagnosticErrors(rawError: string | null): DiagnosticError[] {
  if (!rawError || !rawError.trim()) return []

  const lines = rawError.split("\n").map((l) => l.trim()).filter(Boolean)
  const results: DiagnosticError[] = []

  for (const line of lines) {
    // WebGL format: ERROR: 0:14: 'x' : undeclared identifier or WARNING: 0:7: ...
    const webglMatch = line.match(/(?:ERROR|WARNING):\s*\d+:(\d+)(?::(\d+))?:\s*(.+)/i)
    if (webglMatch) {
      results.push({
        line: parseInt(webglMatch[1], 10),
        column: webglMatch[2] ? parseInt(webglMatch[2], 10) : null,
        message: webglMatch[3].trim(),
      })
      continue
    }

    // WebGPU format: :12:15 error: ... or 12:15 error: ...
    const webgpuMatch = line.match(/(?::)?(\d+):(\d+)\s*(?:error|warning)?:\s*(.+)/i)
    if (webgpuMatch) {
      results.push({
        line: parseInt(webgpuMatch[1], 10),
        column: parseInt(webgpuMatch[2], 10),
        message: webgpuMatch[3].trim(),
      })
      continue
    }

    // Generic line format: error at line 14: ... or line 14, column 5: ...
    const genericMatch = line.match(/line\s*(\d+)(?:,?\s*col(?:umn)?\s*(\d+))?[:\s]+(.+)/i)
    if (genericMatch) {
      results.push({
        line: parseInt(genericMatch[1], 10),
        column: genericMatch[2] ? parseInt(genericMatch[2], 10) : null,
        message: genericMatch[3].trim(),
      })
      continue
    }

    // Single line regex fallback
    const fallbackMatch = line.match(/(\d+):(\d+)/)
    if (fallbackMatch && line.toLowerCase().includes("error")) {
      results.push({
        line: parseInt(fallbackMatch[1], 10),
        column: parseInt(fallbackMatch[2], 10),
        message: line,
      })
      continue
    }
  }

  // If we couldn't parse line-by-line structured errors, return the raw message as a single diagnostic
  if (results.length === 0) {
    const singleLineMatch = rawError.match(/line\s*(\d+)/i) || rawError.match(/:(\d+):/)
    results.push({
      line: singleLineMatch ? parseInt(singleLineMatch[1], 10) : null,
      column: null,
      message: rawError.trim(),
    })
  }

  return results
}
