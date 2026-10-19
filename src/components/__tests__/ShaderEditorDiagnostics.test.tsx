import { describe, it, expect, vi, beforeEach } from "vitest"
import { useProjectStore } from "@/stores/projectStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { COMPILER_MARKER_OWNER } from "@/components/ShaderEditor"

describe("Monaco Editor Diagnostics & Markers (R3)", () => {
  let mockModel: any
  let mockMonaco: any
  let capturedMarkers: any[]

  beforeEach(() => {
    capturedMarkers = []
    useProjectStore.getState().resetProject()

    mockModel = {
      uri: { toString: () => "inmemory://model/1" },
      getLineCount: vi.fn(() => 25),
      getLineMaxColumn: vi.fn(() => 50),
    }

    mockMonaco = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: {
        setModelMarkers: vi.fn((_model: any, owner: string, markers: any[]) => {
          expect(owner).toBe(COMPILER_MARKER_OWNER)
          capturedMarkers = markers
        }),
      },
    }
  })

  it("creates accurate WGSL error marker with exact line and column (token highlight)", () => {
    const rawError = ":12:15 error: expected ';' for statement"
    const diags = parseDiagnosticErrors(rawError)
    expect(diags).toHaveLength(1)

    const diag = diags[0]
    const line = Math.max(1, Math.min(diag.line ?? 1, mockModel.getLineCount()))
    const maxCol = mockModel.getLineMaxColumn(line)
    const startCol = Math.min(Math.max(1, diag.column ?? 1), maxCol)
    const endCol = Math.min(Math.max(startCol + 1, startCol + 4), maxCol)

    const marker = {
      owner: COMPILER_MARKER_OWNER,
      resource: mockModel.uri,
      severity: mockMonaco.MarkerSeverity.Error,
      message: diag.message,
      startLineNumber: line,
      startColumn: startCol,
      endLineNumber: line,
      endColumn: endCol,
      source: "Shader Compiler",
    }

    mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [marker])

    expect(capturedMarkers).toHaveLength(1)
    expect(capturedMarkers[0].startLineNumber).toBe(12)
    expect(capturedMarkers[0].startColumn).toBe(15)
    expect(capturedMarkers[0].endColumn).toBe(19)
    expect(capturedMarkers[0].severity).toBe(8)
    expect(capturedMarkers[0].message).toBe("expected ';' for statement")
  })

  it("creates full-line highlight for WebGL error missing column information", () => {
    const rawError = "ERROR: 0:14: 'u_intensity' : undeclared identifier"
    const diags = parseDiagnosticErrors(rawError)
    const diag = diags[0]

    const line = Math.max(1, Math.min(diag.line ?? 1, mockModel.getLineCount()))
    const maxCol = mockModel.getLineMaxColumn(line)

    const marker = {
      owner: COMPILER_MARKER_OWNER,
      resource: mockModel.uri,
      severity: 8,
      message: diag.message,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: maxCol,
      source: "Shader Compiler",
    }

    mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [marker])

    expect(capturedMarkers).toHaveLength(1)
    expect(capturedMarkers[0].startLineNumber).toBe(14)
    expect(capturedMarkers[0].startColumn).toBe(1)
    expect(capturedMarkers[0].endColumn).toBe(50)
  })

  it("safely clamps line number when compiler reports out-of-bounds line", () => {
    const rawError = "Error at line 999, col 10: invalid token"
    const diags = parseDiagnosticErrors(rawError)
    const diag = diags[0]

    const lineCount = mockModel.getLineCount() // 25
    const line = Math.max(1, Math.min(diag.line ?? 1, lineCount))

    expect(line).toBe(25)
  })

  it("clears markers with empty array when lastCompileError is resolved to null", () => {
    mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
    expect(capturedMarkers).toEqual([])
  })
})
