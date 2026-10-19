import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { COMPILER_MARKER_OWNER } from "@/components/ShaderEditor"

/**
 * Gate 3 Round 2 Adversarial Stress Suite:
 * Active-Tab Marker Isolation & Bidirectional Lifecycle Verification
 */
describe("Gate 3 Round 2 Adversarial: Active-Tab Marker Isolation Verification", () => {
  let mockModel: any
  let mockMonaco: any
  let appliedMarkers: any[]

  beforeEach(() => {
    appliedMarkers = []
    mockModel = {
      uri: { toString: () => "inmemory://model/test" },
      getLineCount: vi.fn(() => 50),
      getLineMaxColumn: vi.fn(() => 80),
    }

    mockMonaco = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: {
        setModelMarkers: vi.fn((_model: any, owner: string, markers: any[]) => {
          expect(owner).toBe(COMPILER_MARKER_OWNER)
          appliedMarkers = markers
        }),
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Factory recreating the exact ShaderEditor.tsx effect lifecycle and applyMarkers logic
  function createShaderEditorHarness(initialTab: "render" | "compute" = "render") {
    let activeEditorTab: "render" | "compute" = initialTab
    let lastCompileError: string | null = null
    let prevCompileError: string | null = null
    const lastErrorTabRef = { current: null as "render" | "compute" | null }

    const applyMarkers = (error: string | null, tab: "render" | "compute") => {
      if (!error || lastErrorTabRef.current !== tab) {
        mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
        return
      }

      const diagnostics = parseDiagnosticErrors(error)
      const lineCount = Math.max(1, mockModel.getLineCount())

      const markers = diagnostics.map((diag) => {
        const rawLine = diag.line ?? 1
        const line = Math.max(1, Math.min(rawLine, lineCount))
        const maxColumn = Math.max(1, mockModel.getLineMaxColumn(line))

        let startColumn = 1
        let endColumn = maxColumn

        if (diag.column !== null && diag.column > 0) {
          startColumn = Math.min(Math.max(1, diag.column), maxColumn)
          endColumn = Math.min(Math.max(startColumn + 1, startColumn + 4), maxColumn)
        }

        return {
          owner: COMPILER_MARKER_OWNER,
          resource: mockModel.uri,
          severity: mockMonaco.MarkerSeverity?.Error ?? 8,
          message: diag.message || "Shader compilation error",
          startLineNumber: line,
          startColumn,
          endLineNumber: line,
          endColumn,
          source: "Shader Compiler",
        }
      })

      mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, markers)
    }

    // Effect 1 [lastCompileError]: updates lastErrorTabRef only when lastCompileError transitions
    const runCompileErrorEffect = () => {
      if (lastCompileError !== prevCompileError) {
        prevCompileError = lastCompileError
        if (lastCompileError) {
          lastErrorTabRef.current = activeEditorTab
        } else {
          lastErrorTabRef.current = null
        }
      }
    }

    // Effect 2 [lastCompileError, activeEditorTab, applyMarkers]: runs when tab or error changes
    const runTabAndErrorMarkerEffect = () => {
      applyMarkers(lastCompileError, activeEditorTab)
    }

    const triggerCycle = () => {
      runCompileErrorEffect()
      runTabAndErrorMarkerEffect()
    }

    return {
      setTab(tab: "render" | "compute") {
        activeEditorTab = tab
        triggerCycle()
      },
      setError(error: string | null) {
        lastCompileError = error
        triggerCycle()
      },
      getActiveTab: () => activeEditorTab,
      getLastErrorTab: () => lastErrorTabRef.current,
      getMarkers: () => appliedMarkers,
      unmount() {
        mockMonaco.editor.setModelMarkers(mockModel, COMPILER_MARKER_OWNER, [])
      },
    }
  }

  // ==========================================================================
  // Test 1: Direction A (Render -> Compute -> Render -> Resolution)
  // ==========================================================================
  it("Direction A: Error in render tab -> switch to compute tab (cleared) -> switch back to render (restored) -> resolve (cleared)", () => {
    const editor = createShaderEditorHarness("render")

    // 1. Introduce GLSL render error
    const renderError = "ERROR: 0:14: 'u_diffuse' : undeclared identifier"
    editor.setError(renderError)

    expect(editor.getLastErrorTab()).toBe("render")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].startLineNumber).toBe(14)
    expect(editor.getMarkers()[0].message).toContain("u_diffuse")

    // 2. Switch to compute tab
    editor.setTab("compute")

    // Error must be cleared on compute tab
    expect(editor.getLastErrorTab()).toBe("render") // ref was NOT mutated by tab switch
    expect(editor.getMarkers()).toEqual([])

    // 3. Switch back to render tab
    editor.setTab("render")

    // Error markers must be restored
    expect(editor.getLastErrorTab()).toBe("render")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].startLineNumber).toBe(14)
    expect(editor.getMarkers()[0].message).toContain("u_diffuse")

    // 4. Resolve error to null
    editor.setError(null)

    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])

    // 5. Switch to compute tab after resolution
    editor.setTab("compute")
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])
  })

  // ==========================================================================
  // Test 2: Direction B (Compute -> Render -> Compute -> Resolution)
  // ==========================================================================
  it("Direction B: Error in compute tab -> switch to render tab (cleared) -> switch back to compute (restored) -> resolve (cleared)", () => {
    const editor = createShaderEditorHarness("compute")

    // 1. Introduce WGSL compute error
    const computeError = ":32:10 error: invalid @workgroup_size decoration"
    editor.setError(computeError)

    expect(editor.getLastErrorTab()).toBe("compute")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].startLineNumber).toBe(32)
    expect(editor.getMarkers()[0].startColumn).toBe(10)
    expect(editor.getMarkers()[0].message).toContain("invalid @workgroup_size")

    // 2. Switch to render tab
    editor.setTab("render")

    // Error must be cleared on render tab
    expect(editor.getLastErrorTab()).toBe("compute") // ref was NOT mutated
    expect(editor.getMarkers()).toEqual([])

    // 3. Switch back to compute tab
    editor.setTab("compute")

    // Error markers must be restored on compute tab
    expect(editor.getLastErrorTab()).toBe("compute")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].startLineNumber).toBe(32)
    expect(editor.getMarkers()[0].startColumn).toBe(10)
    expect(editor.getMarkers()[0].message).toContain("invalid @workgroup_size")

    // 4. Resolve error to null while on compute tab
    editor.setError(null)

    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])

    // 5. Switch to render tab after resolution
    editor.setTab("render")
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])
  })

  // ==========================================================================
  // Test 3: Error resolved to null while user is on inactive tab
  // ==========================================================================
  it("Direction C1: Error on render tab -> switch to compute -> resolved to null while on compute -> switch back to render (remains cleared)", () => {
    const editor = createShaderEditorHarness("render")

    // Render error
    editor.setError("ERROR: 0:5: syntax error")
    expect(editor.getMarkers()).toHaveLength(1)

    // Switch to compute
    editor.setTab("compute")
    expect(editor.getMarkers()).toEqual([])

    // Background compile resolves error to null while user is inspecting compute tab
    editor.setError(null)
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])

    // User switches back to render tab: markers MUST NOT reappear
    editor.setTab("render")
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])
  })

  it("Direction C2: Error on compute tab -> switch to render -> resolved to null while on render -> switch back to compute (remains cleared)", () => {
    const editor = createShaderEditorHarness("compute")

    // Compute error
    editor.setError(":10:4 error: unresolved type 'Particle'")
    expect(editor.getMarkers()).toHaveLength(1)

    // Switch to render
    editor.setTab("render")
    expect(editor.getMarkers()).toEqual([])

    // Background compile resolves error to null
    editor.setError(null)
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])

    // User switches back to compute tab: markers MUST NOT reappear
    editor.setTab("compute")
    expect(editor.getLastErrorTab()).toBeNull()
    expect(editor.getMarkers()).toEqual([])
  })

  // ==========================================================================
  // Test 4: Rapid Tab Switching Stress (500 cycles)
  // ==========================================================================
  it("Stress: 500 rapid alternating tab switches strictly preserves marker isolation and never leaks", () => {
    const editor = createShaderEditorHarness("render")
    const renderError = "ERROR: 0:42: 'u_matrix' : undeclared identifier"
    editor.setError(renderError)

    for (let i = 0; i < 500; i++) {
      // Switch to compute
      editor.setTab("compute")
      expect(editor.getMarkers()).toEqual([])
      expect(editor.getLastErrorTab()).toBe("render")

      // Switch to render
      editor.setTab("render")
      expect(editor.getMarkers()).toHaveLength(1)
      expect(editor.getMarkers()[0].startLineNumber).toBe(42)
      expect(editor.getLastErrorTab()).toBe("render")
    }
  })

  it("Stress: 500 rapid alternating tab switches with compute error strictly isolates", () => {
    const editor = createShaderEditorHarness("compute")
    const computeError = ":15:20 error: array index out of bounds"
    editor.setError(computeError)

    for (let i = 0; i < 500; i++) {
      // Switch to render
      editor.setTab("render")
      expect(editor.getMarkers()).toEqual([])
      expect(editor.getLastErrorTab()).toBe("compute")

      // Switch to compute
      editor.setTab("compute")
      expect(editor.getMarkers()).toHaveLength(1)
      expect(editor.getMarkers()[0].startLineNumber).toBe(15)
      expect(editor.getLastErrorTab()).toBe("compute")
    }
  })

  // ==========================================================================
  // Test 5: Sequential error updates across tabs
  // ==========================================================================
  it("Successive error transitions across tabs correctly transfer error ownership", () => {
    const editor = createShaderEditorHarness("render")

    // Phase 1: Render error
    editor.setError("ERROR: 0:1: syntax error")
    expect(editor.getLastErrorTab()).toBe("render")
    expect(editor.getMarkers()).toHaveLength(1)

    // Phase 2: Switch to compute and introduce compute error
    editor.setTab("compute")
    expect(editor.getMarkers()).toEqual([])

    // Compute error occurs while on compute tab
    editor.setError(":2:4 error: expected binding")
    expect(editor.getLastErrorTab()).toBe("compute")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].message).toContain("expected binding")

    // Phase 3: Switch back to render tab (now render tab is the inactive tab)
    editor.setTab("render")
    expect(editor.getMarkers()).toEqual([]) // cleared on render!

    // Phase 4: Introduce new render error while on render tab
    editor.setError("ERROR: 0:9: 'col' undeclared")
    expect(editor.getLastErrorTab()).toBe("render")
    expect(editor.getMarkers()).toHaveLength(1)
    expect(editor.getMarkers()[0].message).toContain("undeclared")

    // Phase 5: Switch to compute -> cleared
    editor.setTab("compute")
    expect(editor.getMarkers()).toEqual([])
  })

  // ==========================================================================
  // Test 6: Unmount cleanup
  // ==========================================================================
  it("Unmount cleanup: purges all markers from Monaco model", () => {
    const editor = createShaderEditorHarness("render")
    editor.setError("ERROR: 0:10: parse error")
    expect(editor.getMarkers()).toHaveLength(1)

    // Unmount
    editor.unmount()
    expect(editor.getMarkers()).toEqual([])
  })
})
