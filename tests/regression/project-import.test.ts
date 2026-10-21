import { describe, it, expect, vi } from "vitest"
import {
  validateProjectImport,
  validateStoredProject,
  parseProjectJson,
  resolveOpenedProject,
  loadProjectFrom,
  deleteProjectFrom,
  type ProjectRwTable,
  type SavedProject,
} from "@/db"

const good = () => ({
  name: "Mine",
  version: "1.0",
  backend: "webgl2",
  graphNodes: [
    { id: "n1", type: "output", position: { x: 1, y: 2 }, data: { type: "output" } },
    { id: "n2", type: "uniform", position: { x: 3, y: 4 }, data: { type: "uniform", uniformId: "u", name: "a", uniformType: "float", defaultValue: 0.5 } },
  ],
  graphEdges: [{ id: "e1", source: "n2", target: "n1", sourceHandle: null, targetHandle: "in" }],
  uniformValues: { u_a: { type: "float", value: 1 }, u_c: { type: "color", value: [1, 0, 0] } },
  graphUniforms: [{ id: "u", name: "a", type: "float", defaultValue: 0.5 }],
  shaderSources: { glsl: "void main(){}" },
  audioSettings: { sourceType: "mic", volume: 0.5, gain: 1, smoothing: 0.3 },
  audioBindings: { u_a: { band: "bass", amount: 0.4 } },
  variations: [{ id: "v1", name: "V", uniformValues: { u_a: { type: "float", value: 2 } }, createdAt: 1 }],
  environmentSettings: { preset: "studio_warm", exposure: 1, rotation: 0, backgroundBlur: 0, showSkybox: true, rayleighScattering: [1, 2, 3], customTextureSrc: "https://example.com/a.hdr" },
  memoryBudget: { textureBudgetMB: 512, geometryBudgetMB: 256, totalVramBudgetMB: 1024, warnThresholdRatio: 0.8 },
})

function ok(raw: unknown) {
  const r = validateProjectImport(raw)
  if (!r.ok) throw new Error(r.error)
  return r
}

describe("project import validation", () => {
  it("a valid project round-trips unchanged (fresh id, no warnings)", () => {
    const src = good()
    const r = ok(JSON.parse(JSON.stringify(src)))
    expect(r.warnings).toEqual([])
    expect(r.data.projectId).toBeTruthy()
    const { projectId: _p, createdAt: _c, updatedAt: _u, ...rest } = r.data as any
    expect(rest).toEqual(src)
  })

  it.each([
    ["javascript:alert(1)"],
    ["http://insecure.example/x.png"],
    ["file:///C:/secrets.png"],
    ["//evil.example/x.png"],
    ["data:text/html;base64,PGh0bWw+"],
  ])("drops malicious customTextureSrc %s with a warning", (src) => {
    const raw = good()
    raw.environmentSettings.customTextureSrc = src
    const r = ok(raw)
    expect(r.data.environmentSettings).not.toHaveProperty("customTextureSrc")
    expect(r.warnings.join(" ")).toContain("customTextureSrc")
  })

  it("keeps data:image, blob: and https: texture sources", () => {
    for (const src of ["data:image/png;base64,AAAA", "blob:https://x/1", "https://x/y.png"]) {
      const raw = good()
      raw.environmentSettings.customTextureSrc = src
      expect(ok(raw).data.environmentSettings?.customTextureSrc).toBe(src)
    }
  })

  it("rejects bad environment / audio / memory shapes", () => {
    const accepted = (f: (g: any) => void) => { const g: any = good(); f(g); return validateProjectImport(g).ok }
    expect(accepted((g) => { g.environmentSettings.exposure = Infinity })).toBe(false)
    expect(accepted((g) => { g.environmentSettings.exposure = "1" })).toBe(false)
    expect(accepted((g) => { g.environmentSettings.showSkybox = "yes" })).toBe(false)
    expect(accepted((g) => { g.environmentSettings.rayleighScattering = [1, 2] })).toBe(false)
    expect(accepted((g) => { g.audioSettings.sourceType = "rm -rf" })).toBe(false)
    expect(accepted((g) => { g.audioBindings.u_a.band = "nope" })).toBe(false)
    expect(accepted((g) => { g.audioBindings.u_a.amount = NaN })).toBe(false)
    expect(accepted((g) => { g.memoryBudget.textureBudgetMB = -1 })).toBe(false)
    expect(accepted((g) => { g.memoryBudget.textureBudgetMB = "512" })).toBe(false)
  })

  it("strips __proto__ / constructor / prototype at every nesting level without touching prototypes", () => {
    const text = `{
      "name":"x","backend":"webgl2","__proto__":{"polluted":1},
      "uniformValues":{"__proto__":{"type":"float","value":1},"u":{"type":"float","value":1,"constructor":{"x":1}}},
      "variations":[{"id":"v","name":"v","uniformValues":{"__proto__":{"type":"float","value":1}},"prototype":{}}],
      "graphUniforms":[{"id":"g","name":"g","type":"float","__proto__":{"evil":true}}],
      "graphNodes":[{"id":"n","position":{"x":0,"y":0},"data":{"type":"output","__proto__":{"evil":true},"deep":{"a":{"constructor":{"prototype":{"evil":1}}}}}}],
      "audioBindings":{"__proto__":{"band":"bass","amount":1},"ok":{"band":"mid","amount":2}},
      "environmentSettings":{"preset":"studio_warm","__proto__":{"evil":1}}
    }`
    const r = parseProjectJson(text)
    if (!r.ok) throw new Error(r.error)
    expect(r.warnings.join(" ")).toContain("unsafe key")
    const d: any = r.data
    expect(Object.getPrototypeOf(d)).toBe(Object.prototype)
    expect(({} as any).polluted).toBeUndefined()
    expect(({} as any).evil).toBeUndefined()
    const targets = [d.uniformValues, d.uniformValues.u, d.variations[0], d.variations[0].uniformValues, d.graphUniforms[0], d.graphNodes[0].data, d.graphNodes[0].data.deep.a, d.audioBindings, d.environmentSettings]
    for (const o of targets) {
      expect(Object.getPrototypeOf(o)).toBe(Object.prototype)
      for (const k of ["__proto__", "constructor", "prototype"]) expect(Object.prototype.hasOwnProperty.call(o, k)).toBe(false)
    }
    expect(Object.keys(d.uniformValues)).toEqual(["u"])
    expect(Object.keys(d.audioBindings)).toEqual(["ok"])
    expect(d.graphNodes[0].data.deep.a).toEqual({})
  })

  it("rejects malformed nested graph elements", () => {
    const accepted = (f: (g: any) => void) => { const g: any = good(); f(g); return validateProjectImport(g).ok }
    expect(accepted((g) => { g.graphNodes[0].id = 5 })).toBe(false)
    expect(accepted((g) => { g.graphNodes[1].id = "n1" })).toBe(false) // duplicate
    expect(accepted((g) => { g.graphNodes[0].type = {} })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0].position.x = NaN })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0].position = null })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0].data = [] })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0].data = { type: 3 } })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0].width = "wide" })).toBe(false)
    expect(accepted((g) => { g.graphEdges[0].source = 1 })).toBe(false)
    expect(accepted((g) => { g.graphEdges[0].sourceHandle = 7 })).toBe(false)
    expect(accepted((g) => { g.graphNodes = "nope" })).toBe(false)
    expect(accepted((g) => { g.graphNodes[0] = null })).toBe(false)
    // absurdly deep nesting is refused instead of blowing the stack
    let deep: any = {}
    for (let i = 0; i < 200; i++) deep = { x: deep }
    expect(accepted((g) => { g.graphNodes[0].data.deep = deep })).toBe(false)
  })

  it("stored rows are re-validated but keep identity and timestamps", () => {
    const row: any = { ...good(), projectId: "id-1", createdAt: 11, updatedAt: 22, id: 3 }
    row.environmentSettings.customTextureSrc = "javascript:1"
    const r = validateStoredProject(row)
    if (!r.ok) throw new Error(r.error)
    expect(r.data.projectId).toBe("id-1")
    expect(r.data.createdAt).toBe(11)
    expect(r.data.updatedAt).toBe(22)
    expect(r.data.environmentSettings).not.toHaveProperty("customTextureSrc")
    expect(validateStoredProject({ ...row, backend: "nope" }).ok).toBe(false)
  })
})

describe("db load/delete address projects by projectId", () => {
  function table(rows: SavedProject[]): ProjectRwTable & { rows: SavedProject[] } {
    return {
      rows,
      where: (index: string) => ({ equals: (v: unknown) => ({ first: async () => rows.find((r) => (r as any)[index] === v) }) }),
      update: async (id, changes) => { Object.assign(rows.find((r) => r.id === id)!, changes) },
      add: async (row) => { rows.push(row); return rows.length },
      delete: async (id) => { rows.splice(rows.findIndex((r) => r.id === id), 1) },
    }
  }
  const row = (id: number, name: string, projectId: string | undefined, backend = "webgl2"): SavedProject =>
    ({ id, name, projectId, backend, shaderSources: {}, graphNodes: [], graphEdges: [], uniformValues: {}, graphUniforms: [], version: "1.0", createdAt: 1, updatedAt: 1 }) as any

  it("two same-named projects: load and delete hit the right one", async () => {
    const t = table([row(1, "Same", "id-A", "webgl2"), row(2, "Same", "id-B", "webgpu")])
    expect((await loadProjectFrom(t, "id-B"))?.backend).toBe("webgpu")
    expect((await loadProjectFrom(t, "id-A"))?.backend).toBe("webgl2")
    expect(await loadProjectFrom(t, "Same")).toBeNull() // a name never resolves a stamped row
    await deleteProjectFrom(t, "id-B")
    expect(t.rows.map((r) => r.projectId)).toEqual(["id-A"])
    await deleteProjectFrom(t, "Same")
    expect(t.rows).toHaveLength(1)
  })

  it("a legacy row without projectId is reachable by name and gets stamped", async () => {
    const t = table([row(1, "Old", undefined)])
    const data = await loadProjectFrom(t, "Old")
    expect(data?.name).toBe("Old")
    expect(t.rows[0].projectId).toBeTruthy()
    await deleteProjectFrom(t, t.rows[0].projectId!)
    expect(t.rows).toHaveLength(0)
  })
})

describe("stored rows are repaired, imports stay strict", () => {
  const broken = (): any => {
    const row: any = { ...good(), projectId: "id-9", createdAt: 1, updatedAt: 2 }
    const n0 = row.graphNodes[0]
    row.graphNodes = [n0, { ...n0, position: { x: 5, y: 5 } }, { ...n0, id: "far", position: { x: 5e9, y: -5e9 } }]
    row.uniformValues = { u_bad: { type: "float", value: null }, u_ok: { type: "float", value: 2 } }
    return row
  }

  it("repairs null uniforms, duplicate node ids and out-of-range positions, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = validateStoredProject(broken())
    if (!r.ok) throw new Error(r.error)
    expect(r.data.uniformValues).toEqual({ u_ok: { type: "float", value: 2 } })
    const ids = (r.data.graphNodes as any[]).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(2)
    const far = (r.data.graphNodes as any[]).find((n) => n.id === "far")
    expect(far.position).toEqual({ x: 1e6, y: -1e6 })
    expect(r.data.projectId).toBe("id-9")
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("the same data is still rejected as an untrusted import", () => {
    expect(validateProjectImport(broken()).ok).toBe(false)
    const dup = broken()
    delete dup.uniformValues.u_bad
    dup.graphNodes = dup.graphNodes.slice(0, 2)
    expect(validateProjectImport(dup).ok).toBe(false)
  })
})

describe("opening a .shaderstudio file keeps identity", () => {
  const file = () => ({ ...good(), projectId: "file-id", name: "Saved" })
  const parse = () => {
    const r = parseProjectJson(JSON.stringify(file()))
    if (!r.ok) throw new Error(r.error)
    return r
  }

  it("keeps id and name when the id is unknown", () => {
    const r = parse()
    const out = resolveOpenedProject(r.data, r.fileProjectId, [{ name: "Saved", projectId: "other" }], () => true)
    expect(out.projectId).toBe("file-id")
    expect(out.name).toBe("Saved")
  })

  it("updates in place when the id exists and the user agrees", () => {
    const r = parse()
    const out = resolveOpenedProject(r.data, r.fileProjectId, [{ name: "Saved", projectId: "file-id" }], () => true)
    expect(out.projectId).toBe("file-id")
    expect(out.name).toBe("Saved")
  })

  it("opens a renamed copy under a fresh id when the user declines", () => {
    const r = parse()
    const out = resolveOpenedProject(r.data, r.fileProjectId, [{ name: "Saved", projectId: "file-id" }], () => false)
    expect(out.projectId).not.toBe("file-id")
    expect(out.name).toBe("Saved (imported)")
  })

  it("a file without an id is a plain import", () => {
    const r = parseProjectJson(JSON.stringify(good()))
    if (!r.ok) throw new Error(r.error)
    expect(r.fileProjectId).toBeUndefined()
    expect(resolveOpenedProject(r.data, r.fileProjectId, [{ name: "Mine" }], () => true).name).toBe("Mine (imported)")
  })
})
