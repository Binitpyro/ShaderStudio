import { describe, it, expect, beforeEach } from "vitest"
import { useProjectStore } from "../projectStore"

describe("Project Store Persistence & Default Merging", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  it("merges partial environmentSettings with full defaults when loading legacy project data", () => {
    const legacyProjectData: any = {
      name: "Legacy Project",
      backend: "webgl2",
      shaderSources: { glsl: "void main() {}" },
      // Legacy data missing backgroundBlur and showSkybox
      environmentSettings: {
        preset: "cyberpunk_neon",
        exposure: 1.5,
      },
    }

    useProjectStore.getState().loadProjectData(legacyProjectData)
    const env = useProjectStore.getState().environmentSettings

    expect(env.preset).toBe("cyberpunk_neon")
    expect(env.exposure).toBe(1.5)
    expect(env.rotation).toBe(0.0)
    expect(env.backgroundBlur).toBe(0.0)
    expect(env.showSkybox).toBe(false)
  })

  it("falls back cleanly to default environment settings when environmentSettings is omitted", () => {
    const minimalProjectData: any = {
      name: "Minimal Project",
      backend: "webgpu",
      shaderSources: { wgsl: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }" },
    }

    useProjectStore.getState().loadProjectData(minimalProjectData)
    const env = useProjectStore.getState().environmentSettings

    expect(env.preset).toBe("studio_warm")
    expect(env.exposure).toBe(1.0)
    expect(env.rotation).toBe(0.0)
    expect(env.backgroundBlur).toBe(0.0)
    expect(env.showSkybox).toBe(false)
  })
})

// fleet(w1-d-coverage): behaviour tests for default uniform values and simple setters
import { getDefaultUniformValue } from "../projectStore"

describe("projectStore: default uniform values for non-vector kinds", () => {
  const u = (kind: string, type = "f32"): any => ({ name: "u", kind, type })

  it("struct -> empty struct, array/unknown -> float 0", () => {
    expect(getDefaultUniformValue(u("struct"))).toEqual({ type: "struct", value: {} })
    expect(getDefaultUniformValue(u("array"))).toEqual({ type: "float", value: 0 })
    expect(getDefaultUniformValue(u("bogus"))).toEqual({ type: "float", value: 0 })
  })
})

describe("projectStore: simple setters", () => {
  beforeEach(() => useProjectStore.getState().resetProject())

  it("setActiveShaderPath / setAutoCompile / setSelectedNodeId store values", () => {
    const s = useProjectStore.getState()
    s.setActiveShaderPath("shaders/a.wgsl")
    s.setAutoCompile(false)
    s.setSelectedNodeId("n1")
    const st = useProjectStore.getState()
    expect(st.activeShaderPath).toBe("shaders/a.wgsl")
    expect(st.autoCompile).toBe(false)
    expect(st.selectedNodeId).toBe("n1")
  })

  it("setGraphNodes / setGraphEdges replace graph and mark project dirty; setHasUnsavedChanges clears it", () => {
    const s = useProjectStore.getState()
    s.setHasUnsavedChanges(false)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    s.setGraphNodes([])
    expect(useProjectStore.getState()._graphNodes).toEqual([])
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    s.setHasUnsavedChanges(false)
    const edges: any[] = [{ id: "e1", source: "a", target: "b" }]
    s.setGraphEdges(edges)
    expect(useProjectStore.getState()._graphEdges).toEqual(edges)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
  })

  it("getInitialState reflects the live state (SSR snapshot contract)", () => {
    useProjectStore.getState().setSelectedNodeId("zzz")
    expect(useProjectStore.getInitialState().selectedNodeId).toBe("zzz")
  })
})
