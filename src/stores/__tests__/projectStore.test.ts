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

  it("setGraphNodes / setGraphEdges replace the graph SNAPSHOT: dirty by default, not dirty with markDirty:false", () => {
    const s = useProjectStore.getState()
    s.setHasUnsavedChanges(false)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    // snapshot echo from NodeGraph (load / external sync / publish) must not dirty the project
    s.setGraphNodes([], { markDirty: false })
    expect(useProjectStore.getState()._graphNodes).toEqual([])
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    const edges: any[] = [{ id: "e1", source: "a", target: "b" }]
    s.setGraphEdges(edges, { markDirty: false })
    expect(useProjectStore.getState()._graphEdges).toEqual(edges)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
    // a real edit (default) marks dirty
    s.setGraphNodes([])
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    s.setHasUnsavedChanges(false)
    s.setGraphEdges(edges)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    s.setHasUnsavedChanges(false)
    expect(useProjectStore.getState().hasUnsavedChanges).toBe(false)
  })

  it("getInitialState reflects the live state (SSR snapshot contract)", () => {
    useProjectStore.getState().setSelectedNodeId("zzz")
    expect(useProjectStore.getInitialState().selectedNodeId).toBe("zzz")
  })
})

// fleet(w2-a-state): per-backend sources, legacy migration, export of both languages
describe("projectStore: per-backend shader sources", () => {
  const WGSL = "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); } // user wgsl"
  const GLSL = "#version 300 es\nvoid main() {} // user glsl"
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useProjectStore.getState().setActiveBackend("webgpu")
  })

  it("switching backend never overwrites either source; shaderSource derives from the active backend", () => {
    const s = useProjectStore.getState()
    s.setShaderSource(WGSL) // active = webgpu -> wgsl slot
    s.setActiveBackend("webgl2")
    expect(useProjectStore.getState().wgslSource).toBe(WGSL)
    s.setShaderSource(GLSL) // active = webgl2 -> glsl slot
    expect(useProjectStore.getState().shaderSource).toBe(GLSL)
    s.setActiveBackend("threejs")
    expect(useProjectStore.getState().shaderSource).toBe(GLSL)
    s.setActiveBackend("webgpu")
    expect(useProjectStore.getState().shaderSource).toBe(WGSL)
    s.setActiveBackend("webgl2")
    const st = useProjectStore.getState()
    expect(st.wgslSource).toBe(WGSL)
    expect(st.glslSource).toBe(GLSL)
  })

  it("an explicit language writes the other slot without disturbing the active source", () => {
    const s = useProjectStore.getState()
    s.setShaderSource(WGSL)
    s.setShaderSource(GLSL, "glsl")
    expect(useProjectStore.getState().shaderSource).toBe(WGSL)
    expect(useProjectStore.getState().glslSource).toBe(GLSL)
  })

  it("export contains both languages and round-trips through loadProjectData", () => {
    const s = useProjectStore.getState()
    s.setShaderSource(WGSL)
    s.setShaderSource(GLSL, "glsl")
    const exported = useProjectStore.getState().exportProjectData()
    expect(exported.shaderSources.wgsl).toBe(WGSL)
    expect(exported.shaderSources.glsl).toBe(GLSL)
    useProjectStore.getState().resetProject()
    useProjectStore.getState().loadProjectData(JSON.parse(JSON.stringify({ ...exported, backend: "webgl2" })))
    const st = useProjectStore.getState()
    expect(st.wgslSource).toBe(WGSL)
    expect(st.glslSource).toBe(GLSL)
    expect(st.shaderSource).toBe(GLSL)
  })

  it("migrates legacy single-language projects without losing the code", () => {
    const s = useProjectStore.getState()
    s.loadProjectData({ name: "old-gpu", backend: "webgpu", shaderSources: { wgsl: WGSL } } as any)
    expect(useProjectStore.getState().shaderSource).toBe(WGSL)
    s.loadProjectData({ name: "old-gl", backend: "webgl2", shaderSources: { glsl: GLSL } } as any)
    expect(useProjectStore.getState().shaderSource).toBe(GLSL)
    // a bare legacy "shaderSource" string lands in the slot of the saved backend
    s.loadProjectData({ name: "older", backend: "threejs", shaderSource: GLSL } as any)
    expect(useProjectStore.getState().glslSource).toBe(GLSL)
    // switching to the empty language of a project that has code seeds a starter, keeping the user's code
    s.setActiveBackend("webgpu")
    const st = useProjectStore.getState()
    expect(st.glslSource).toBe(GLSL)
    expect(st.wgslSource.length).toBeGreaterThan(0)
    expect(st.shaderSource).toBe(st.wgslSource)
  })

  it("setGeneratedSources sets both languages without dirtying the project", () => {
    const s = useProjectStore.getState()
    s.setHasUnsavedChanges(false)
    s.setGeneratedSources({ wgsl: "W", glsl: "G" })
    const st = useProjectStore.getState()
    expect([st.wgslSource, st.glslSource, st.shaderSource]).toEqual(["W", "G", "W"])
    expect(st.hasUnsavedChanges).toBe(false)
  })

  it("addGraphUniform is idempotent per id (project load + uniform node mount)", () => {
    const s = useProjectStore.getState()
    s.addGraphUniform({ id: "g", name: "a", type: "float", defaultValue: 1 })
    s.addGraphUniform({ id: "g", name: "b", type: "float", defaultValue: 1 })
    expect(useProjectStore.getState().graphUniforms).toEqual([{ id: "g", name: "b", type: "float", defaultValue: 1 }])
  })
})

// fleet(w2-a-state): debounce cancel/flush
import { debounce } from "@/utils/throttle"
import { vi, afterEach } from "vitest"

describe("debounce cancel / flush", () => {
  afterEach(() => vi.useRealTimers())

  it("cancel drops the pending call; flush runs it immediately and only once", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 400)
    d("a")
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()

    d("b")
    d("c")
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith("c")
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    d.flush() // nothing pending: no-op
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("a pending editor write cannot clobber a project loaded inside the debounce window", () => {
    vi.useFakeTimers()
    const write = debounce((v: string) => useProjectStore.getState().setShaderSource(v), 400)
    write("stale edit")
    useProjectStore.getState().loadProjectData({ name: "loaded", backend: "webgpu", shaderSources: { wgsl: "LOADED" } } as any)
    write.cancel() // ShaderEditor does this when the project changes
    vi.advanceTimersByTime(1000)
    expect(useProjectStore.getState().shaderSource).toBe("LOADED")
  })
})

// fleet(w2-a-state): import validation + id-based upsert
import {
  validateProjectImport,
  parseProjectJson,
  uniqueImportName,
  upsertProject,
  MAX_PROJECT_IMPORT_BYTES,
  type ProjectTable,
  type SavedProject,
} from "@/db"
import { syncParsedUniforms } from "@/App"

describe(".shaderstudio import validation", () => {
  const good = () => ({
    name: "Mine",
    version: "1.0",
    backend: "webgl2",
    graphNodes: [{ id: "n1", position: { x: 1, y: 2 }, data: { type: "output" } }],
    graphEdges: [{ id: "e1", source: "n1", target: "n1" }],
    uniformValues: { u_a: { type: "float", value: 1 }, u_c: { type: "color", value: [1, 0, 0] } },
    graphUniforms: [],
    shaderSources: { glsl: "void main(){}" },
  })

  it("accepts a well-formed project, drops unknown fields and assigns a fresh projectId", () => {
    const a = validateProjectImport({ ...good(), projectId: "attacker-chosen", evil: { x: 1 } })
    const b = validateProjectImport(good())
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data.projectId).toBeTruthy()
      expect(a.data.projectId).not.toBe("attacker-chosen")
      expect(a.data.projectId).not.toBe(b.data.projectId)
      expect((a.data as any).evil).toBeUndefined()
    }
  })

  it.each([
    ["non-object", 42, /not an object/],
    ["array", [], /not an object/],
    ["missing backend", { ...good(), backend: undefined }, /backend must be one of/],
    ["unknown backend", { ...good(), backend: "vulkan" }, /backend must be one of/],
    ["non-string name", { ...good(), name: 5 }, /name must be a string/],
    ["non-string source", { ...good(), shaderSources: { glsl: 5 } }, /shaderSources\.glsl must be a string/],
    ["graphNodes not array", { ...good(), graphNodes: {} }, /graphNodes must be an array/],
    ["node without id", { ...good(), graphNodes: [{ position: { x: 0, y: 0 }, data: { type: "x" } }] }, /graphNodes\[0\] needs a string id/],
    ["node with NaN position", { ...good(), graphNodes: [{ id: "n", position: { x: "a", y: 0 }, data: { type: "x" } }] }, /position needs finite/],
    ["edge without target", { ...good(), graphEdges: [{ id: "e", source: "a" }] }, /graphEdges\[0\]/],
    ["uniform array with strings", { ...good(), uniformValues: { u: { type: "vec3", value: [1, "x", 3] } } }, /finite numbers/],
    ["uniform without type", { ...good(), uniformValues: { u: { value: 1 } } }, /\.type must be a string/],
    ["too many nodes", { ...good(), graphNodes: Array.from({ length: 5001 }, (_, i) => ({ id: "n" + i, position: { x: 0, y: 0 }, data: { type: "mesh" } })) }, /limit/],
    ["bad audio setting", { ...good(), audioSettings: { volume: "loud" } }, /audioSettings\.volume/],
  ])("rejects %s with a clear message and never throws", (_label, input, pattern) => {
    let res: ReturnType<typeof validateProjectImport> | undefined
    expect(() => { res = validateProjectImport(input) }).not.toThrow()
    expect(res!.ok).toBe(false)
    if (!res!.ok) expect(res!.error).toMatch(pattern)
  })

  it("rejects non-finite numbers in uniform values", () => {
    const res = validateProjectImport({ ...good(), uniformValues: { u: { type: "float", value: Infinity } } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/finite number/)
  })

  it("parseProjectJson reports invalid JSON, empty and oversized files without throwing", () => {
    expect(parseProjectJson("{not json")).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) })
    expect(parseProjectJson("")).toMatchObject({ ok: false })
    expect(parseProjectJson("x".repeat(MAX_PROJECT_IMPORT_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/larger than/) })
    expect(parseProjectJson(JSON.stringify(good()))).toMatchObject({ ok: true })
  })

  it("uniqueImportName suffixes collisions (case-insensitive) and increments", () => {
    expect(uniqueImportName("A", ["B"])).toBe("A")
    expect(uniqueImportName("A", ["a"])).toBe("A (imported)")
    expect(uniqueImportName("A", ["A", "A (imported)"])).toBe("A (imported 2)")
  })
})

describe("db upsertProject: identity is projectId, not the non-unique name", () => {
  function memoryTable(): ProjectTable & { rows: SavedProject[] } {
    const rows: SavedProject[] = []
    let nextId = 1
    return {
      rows,
      where: (index: string) => ({
        equals: (value: unknown) => ({ first: async () => rows.find((r) => (r as any)[index] === value) }),
      }),
      update: async (id, changes) => { Object.assign(rows.find((r) => r.id === id)!, changes) },
      add: async (row) => { const id = nextId++; rows.push({ ...row, id }); return id },
    }
  }
  const proj = (name: string, projectId?: string): any => ({ name, backend: "webgl2", projectId, shaderSources: {}, createdAt: 1, updatedAt: 1 })

  it("two different projects with the same name coexist; each id updates only itself", async () => {
    const t = memoryTable()
    await upsertProject(t, proj("Same", "id-A"))
    await upsertProject(t, proj("Same", "id-B")) // e.g. an import with a colliding name: must NOT overwrite id-A
    expect(t.rows.map((r) => r.projectId)).toEqual(["id-A", "id-B"])
    await upsertProject(t, { ...proj("Same", "id-A"), backend: "webgpu" } as any)
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0].backend).toBe("webgpu")
    expect(t.rows[1].backend).toBe("webgl2")
  })

  it("legacy data without projectId falls back to the name once and is stamped with an id", async () => {
    const t = memoryTable()
    await upsertProject(t, proj("Legacy"))
    expect(t.rows[0].projectId).toBeTruthy()
    await upsertProject(t, { ...proj("Legacy"), backend: "threejs" } as any)
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0].backend).toBe("threejs")
  })
})

describe("inspector uniforms follow the active shader (App.syncParsedUniforms)", () => {
  it("clears the previous shader's uniforms when the new shader has none", () => {
    syncParsedUniforms("uniform float u_a;\nvoid main() {}", "webgl2")
    expect(useProjectStore.getState().parsedUniforms.map((u) => u.name)).toContain("u_a")
    syncParsedUniforms("void main() {}", "webgl2")
    expect(useProjectStore.getState().parsedUniforms).toEqual([])
    syncParsedUniforms("uniform float u_a;\nvoid main() {}", "webgl2")
    syncParsedUniforms("", "webgl2") // new/empty project
    expect(useProjectStore.getState().parsedUniforms).toEqual([])
  })
})

describe("projectStore: legacy single-source load and project id", () => {
  beforeEach(() => useProjectStore.getState().resetProject())

  it("a legacy webgpu project with only a bare shaderSource loads it as the WGSL source", () => {
    useProjectStore.getState().loadProjectData({ name: "Old", backend: "webgpu", shaderSource: "// legacy wgsl" } as any)
    const st = useProjectStore.getState()
    expect(st.activeBackend).toBe("webgpu")
    expect(st.wgslSource).toBe("// legacy wgsl")
    expect(st.glslSource).toBe("")
  })

  it("a legacy webgl2 project with only a bare shaderSource loads it as the GLSL source", () => {
    useProjectStore.getState().loadProjectData({ name: "Old", backend: "webgl2", shaderSource: "// legacy glsl" } as any)
    const st = useProjectStore.getState()
    expect(st.glslSource).toBe("// legacy glsl")
    expect(st.wgslSource).toBe("")
  })

  it("setCurrentProjectId stores the id used when saving", () => {
    useProjectStore.getState().setCurrentProjectId("proj-1")
    expect(useProjectStore.getState().currentProjectId).toBe("proj-1")
    expect(useProjectStore.getState().exportProjectData().projectId).toBe("proj-1")
  })
})

describe("render queue publication without NodeGraph mounted", () => {
  it("loadProjectData compiles the loaded graph into renderQueue", async () => {
    const { STARTER_NODES, STARTER_EDGES } = await import("@/core/defaultStarterScene")
    const s = useProjectStore.getState()
    s.setRenderQueue(null)
    s.loadProjectData({ name: "G", backend: "webgl2", graphNodes: STARTER_NODES, graphEdges: STARTER_EDGES } as any)
    const q = useProjectStore.getState().renderQueue
    expect(q).not.toBeNull()
    expect(q!.length).toBeGreaterThan(0)
  })

  it("resetProject clears the previous project's renderQueue", () => {
    useProjectStore.getState().loadStarterScene()
    expect(useProjectStore.getState().renderQueue).not.toBeNull()
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().renderQueue).toBeNull()
  })
})
