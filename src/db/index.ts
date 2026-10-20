import Dexie, { type EntityTable } from "dexie"
import type { ProjectData, BackendType, UniformValue } from "@/stores/projectStore"

export interface ShaderSnapshot {
  id?: number
  path: string
  content: string
  timestamp: number
}

export interface SavedProject extends ProjectData {
  id?: number
}

function newProjectId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

class ShaderStudioDB extends Dexie {
  snapshots!: EntityTable<ShaderSnapshot, "id">
  projects!: EntityTable<SavedProject, "id">
  constructor() {
    super("ShaderStudioDB")
    this.version(2).stores({
      snapshots: "++id, path, timestamp, [path+timestamp]",
      projects: "++id, name, updatedAt",
    })
    // v3: projects get a stable string identity (projectId). `name` is NOT unique, so identity-by-name
    // silently overwrote same-named projects; saves/imports now upsert by projectId.
    this.version(3)
      .stores({
        snapshots: "++id, path, timestamp, [path+timestamp]",
        projects: "++id, projectId, name, updatedAt",
      })
      .upgrade((tx) =>
        tx
          .table("projects")
          .toCollection()
          .modify((project: SavedProject) => {
            if (!project.projectId) project.projectId = newProjectId()
          })
      )
  }
}

export const db = new ShaderStudioDB()

export async function saveSnapshot(path: string, content: string) {
  await db.snapshots.add({ path, content, timestamp: Date.now() })
}

export async function getLatestSnapshot(path: string) {
  return db.snapshots.where("path").equals(path).reverse().sortBy("timestamp").then((results) => results[0] ?? null)
}

/** The slice of a Dexie table that upsertProject needs (lets tests run against an in-memory table). */
export interface ProjectTable {
  where(index: string): { equals(value: unknown): { first(): Promise<SavedProject | undefined> } }
  update(id: number, changes: Partial<SavedProject>): Promise<unknown>
  add(row: SavedProject): Promise<unknown>
}

/**
 * Upsert by projectId. Data without a projectId (legacy callers / pre-v3 rows) falls back to the old
 * name match once, and is stamped with a projectId so it is id-addressed from then on.
 */
export async function upsertProject(table: ProjectTable, data: ProjectData): Promise<number> {
  const now = Date.now()
  let existing: SavedProject | undefined
  if (data.projectId) existing = await table.where("projectId").equals(data.projectId).first()
  else existing = await table.where("name").equals(data.name).first()

  if (existing && existing.id !== undefined) {
    await table.update(existing.id, {
      ...data,
      projectId: existing.projectId ?? data.projectId ?? newProjectId(),
      updatedAt: now,
    })
    return existing.id
  }
  const id = await table.add({ ...data, projectId: data.projectId ?? newProjectId(), createdAt: now, updatedAt: now })
  return id as number
}

export async function saveProject(data: ProjectData): Promise<number> {
  return upsertProject(db.projects as unknown as ProjectTable, data)
}

/** ProjectTable plus delete (lets tests run load/delete against an in-memory table). */
export interface ProjectRwTable extends ProjectTable {
  delete(id: number): Promise<unknown>
}

/**
 * Find a row by projectId. A legacy row (no projectId) is still reachable through its name (the key
 * handed out by listProjects for such rows) and is stamped with a projectId on first touch.
 */
async function findProjectRow(table: ProjectRwTable, key: string): Promise<SavedProject | undefined> {
  const byId = await table.where("projectId").equals(key).first()
  if (byId) return byId
  const legacy = await table.where("name").equals(key).first()
  if (!legacy || legacy.projectId) return undefined
  if (legacy.id !== undefined) {
    legacy.projectId = newProjectId()
    await table.update(legacy.id, { projectId: legacy.projectId })
  }
  return legacy
}

export async function loadProjectFrom(table: ProjectRwTable, key: string): Promise<ProjectData | null> {
  const project = await findProjectRow(table, key)
  if (!project) return null
  const { id: _id, ...data } = project
  return data as ProjectData
}

export async function deleteProjectFrom(table: ProjectRwTable, key: string) {
  const project = await findProjectRow(table, key)
  if (project && project.id !== undefined) await table.delete(project.id)
}

/** Load by projectId (or, for legacy rows without one, by name). Rows are re-validated: they may predate this version. */
export async function loadProject(projectIdOrLegacyName: string): Promise<ProjectData | null> {
  const data = await loadProjectFrom(db.projects as unknown as ProjectRwTable, projectIdOrLegacyName)
  if (!data) return null
  const checked = validateStoredProject(data)
  return checked.ok ? checked.data : null
}

export async function listProjects(): Promise<Array<{ name: string; updatedAt: number; projectId?: string }>> {
  const projects = await db.projects.toArray()
  return projects.map((p) => ({ name: p.name, updatedAt: p.updatedAt, projectId: p.projectId }))
}

export async function deleteProject(projectIdOrLegacyName: string) {
  await deleteProjectFrom(db.projects as unknown as ProjectRwTable, projectIdOrLegacyName)
}

// ---------------------------------------------------------------------------
// .shaderstudio / .json import validation
// ---------------------------------------------------------------------------

export const MAX_PROJECT_IMPORT_BYTES = 25 * 1024 * 1024
const MAX_GRAPH_ITEMS = 5000
const MAX_DEPTH = 64
const BACKENDS: readonly BackendType[] = ["webgpu", "webgl2", "threejs"]
const AUDIO_BANDS = ["bass", "mid", "treble", "beat", "level"]
const AUDIO_SOURCES = ["builtin", "file", "mic"]
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])
const SAFE_TEXTURE_SRC = /^(data:image\/|blob:|https:\/\/)/i
const NUM_LIMIT = 1e6

export type ProjectImportResult =
  | { ok: true; data: ProjectData; warnings: string[] }
  | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= NUM_LIMIT

function fail(error: string): ProjectImportResult {
  return { ok: false, error: `Invalid project file: ${error}` }
}

/**
 * Deep-copy JSON-like data into fresh plain objects, dropping __proto__ / constructor / prototype keys at
 * every level (JSON.parse creates __proto__ as an own key; copying it with out[k] = v would re-parent the copy).
 * Throws when nesting exceeds MAX_DEPTH. stripped.count reports how many keys were dropped.
 */
function cleanDeep(v: unknown, stripped: { count: number }, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error("nesting too deep")
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x, stripped, depth + 1))
  if (isObj(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k)) { stripped.count++; continue }
      out[k] = cleanDeep(x, stripped, depth + 1)
    }
    return out
  }
  return v
}

function checkUniformValue(path: string, v: unknown): string | null {
  if (!isObj(v)) return `${path} must be an object with "type" and "value"`
  if (typeof v.type !== "string") return `${path}.type must be a string`
  const val = v.value
  if (typeof val === "number") return Number.isFinite(val) ? null : `${path}.value must be a finite number`
  if (typeof val === "boolean" || typeof val === "string" || isObj(val)) return null
  if (Array.isArray(val)) return val.every((x) => typeof x === "number" && Number.isFinite(x)) ? null : `${path}.value must contain only finite numbers`
  return `${path}.value must be a number, boolean, string, array of numbers or object`
}

function checkUniformMap(path: string, v: unknown): string | null {
  if (!isObj(v)) return `${path} must be an object`
  for (const [name, entry] of Object.entries(v)) {
    const err = checkUniformValue(`${path}.${name}`, entry)
    if (err) return err
  }
  return null
}

const ENV_NUMBERS = ["exposure", "rotation", "backgroundBlur", "timeOfDay", "mieScattering", "mieTurbidity", "sunIntensity", "sunDiscSize"] as const

/** Known fields only, typed and range-checked. customTextureSrc is dropped (with a warning) unless data:image/*, blob: or https:. */
function sanitizeEnvironment(raw: unknown, warnings: string[]): { value?: Record<string, unknown>; error?: string } {
  if (!isObj(raw)) return { error: "environmentSettings must be an object" }
  const out: Record<string, unknown> = {}
  if (raw.preset !== undefined) {
    if (typeof raw.preset !== "string" || raw.preset.length > 64) return { error: "environmentSettings.preset must be a short string" }
    out.preset = raw.preset
  }
  for (const key of ENV_NUMBERS) {
    if (raw[key] === undefined) continue
    if (!isFiniteNum(raw[key])) return { error: `environmentSettings.${key} must be a finite number` }
    out[key] = raw[key]
  }
  if (raw.showSkybox !== undefined) {
    if (typeof raw.showSkybox !== "boolean") return { error: "environmentSettings.showSkybox must be a boolean" }
    out.showSkybox = raw.showSkybox
  }
  if (raw.rayleighScattering !== undefined) {
    const r = raw.rayleighScattering
    if (!Array.isArray(r) || r.length !== 3 || !r.every(isFiniteNum)) return { error: "environmentSettings.rayleighScattering must be 3 finite numbers" }
    out.rayleighScattering = [r[0], r[1], r[2]]
  }
  if (raw.customTextureSrc !== undefined && raw.customTextureSrc !== "") {
    if (typeof raw.customTextureSrc === "string" && SAFE_TEXTURE_SRC.test(raw.customTextureSrc)) out.customTextureSrc = raw.customTextureSrc
    else warnings.push("environmentSettings.customTextureSrc was removed: only data:image/*, blob: and https: URLs are allowed")
  }
  return { value: out }
}

function checkGraph(nodes: unknown[], edges: unknown[]): string | null {
  const ids = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!isObj(n) || typeof n.id !== "string" || n.id === "") return `graphNodes[${i}] needs a string id`
    if (ids.has(n.id)) return `graphNodes[${i}] duplicates id "${n.id}"`
    ids.add(n.id)
    if (n.type !== undefined && typeof n.type !== "string") return `graphNodes[${i}].type must be a string`
    const pos = n.position
    if (!isObj(pos) || !isFiniteNum(pos.x) || !isFiniteNum(pos.y)) return `graphNodes[${i}].position needs finite x and y`
    if (!isObj(n.data) || typeof n.data.type !== "string") return `graphNodes[${i}].data needs a string type`
    for (const k of ["width", "height"]) if (n[k] !== undefined && !isFiniteNum(n[k])) return `graphNodes[${i}].${k} must be a finite number`
    if (n.parentId !== undefined && typeof n.parentId !== "string") return `graphNodes[${i}].parentId must be a string`
  }
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!isObj(e) || typeof e.id !== "string" || typeof e.source !== "string" || typeof e.target !== "string") {
      return `graphEdges[${i}] needs string id, source and target`
    }
    for (const k of ["sourceHandle", "targetHandle"]) {
      if (e[k] !== undefined && e[k] !== null && typeof e[k] !== "string") return `graphEdges[${i}].${k} must be a string or null`
    }
  }
  return null
}

function validateProject(rawInput: unknown, mode: "import" | "stored"): ProjectImportResult {
  if (!isObj(rawInput)) return fail("not an object")
  const stripped = { count: 0 }
  let raw: Record<string, unknown>
  try {
    raw = cleanDeep(rawInput, stripped) as Record<string, unknown>
  } catch {
    return fail("data is nested too deeply")
  }
  const warnings: string[] = []
  if (stripped.count > 0) warnings.push(`${stripped.count} unsafe key(s) (__proto__, constructor, prototype) were removed`)

  if (typeof raw.backend !== "string" || !BACKENDS.includes(raw.backend as BackendType)) {
    return fail(`backend must be one of ${BACKENDS.join(", ")}`)
  }
  const backend = raw.backend as BackendType

  let name = mode === "stored" ? "Untitled" : "Imported Project"
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") return fail("name must be a string")
    name = raw.name.trim().slice(0, 200) || name
  }

  const rawSources = raw.shaderSources ?? {}
  if (!isObj(rawSources)) return fail("shaderSources must be an object")
  const shaderSources: ProjectData["shaderSources"] = {}
  for (const key of ["wgsl", "glsl", "compute", "vertex"] as const) {
    const v = rawSources[key]
    if (v === undefined) continue
    if (typeof v !== "string") return fail(`shaderSources.${key} must be a string`)
    shaderSources[key] = v
  }

  const graphNodes = raw.graphNodes ?? []
  if (!Array.isArray(graphNodes)) return fail("graphNodes must be an array")
  if (graphNodes.length > MAX_GRAPH_ITEMS) return fail(`graphNodes exceeds the ${MAX_GRAPH_ITEMS} node limit`)
  const graphEdges = raw.graphEdges ?? []
  if (!Array.isArray(graphEdges)) return fail("graphEdges must be an array")
  if (graphEdges.length > MAX_GRAPH_ITEMS) return fail(`graphEdges exceeds the ${MAX_GRAPH_ITEMS} edge limit`)
  const graphErr = checkGraph(graphNodes, graphEdges)
  if (graphErr) return fail(graphErr)

  const uniformValues = raw.uniformValues ?? {}
  const uvErr = checkUniformMap("uniformValues", uniformValues)
  if (uvErr) return fail(uvErr)

  const graphUniforms = raw.graphUniforms ?? []
  if (!Array.isArray(graphUniforms)) return fail("graphUniforms must be an array")
  for (let i = 0; i < graphUniforms.length; i++) {
    const g = graphUniforms[i]
    if (!isObj(g) || typeof g.id !== "string" || typeof g.name !== "string" || typeof g.type !== "string") {
      return fail(`graphUniforms[${i}] needs string id, name and type`)
    }
  }

  const variations = raw.variations ?? []
  if (!Array.isArray(variations)) return fail("variations must be an array")
  for (let i = 0; i < variations.length; i++) {
    const v = variations[i]
    if (!isObj(v) || typeof v.id !== "string" || typeof v.name !== "string") return fail(`variations[${i}] needs string id and name`)
    const err = checkUniformMap(`variations[${i}].uniformValues`, v.uniformValues ?? {})
    if (err) return fail(err)
  }

  let audioSettings: Record<string, unknown> | undefined
  if (raw.audioSettings !== undefined) {
    const a = raw.audioSettings
    if (!isObj(a)) return fail("audioSettings must be an object")
    audioSettings = {}
    if (a.sourceType !== undefined) {
      if (typeof a.sourceType !== "string" || !AUDIO_SOURCES.includes(a.sourceType)) return fail(`audioSettings.sourceType must be one of ${AUDIO_SOURCES.join(", ")}`)
      audioSettings.sourceType = a.sourceType
    }
    for (const key of ["volume", "gain", "smoothing"]) {
      if (a[key] === undefined) continue
      if (!isFiniteNum(a[key])) return fail(`audioSettings.${key} must be a finite number`)
      audioSettings[key] = a[key]
    }
  }

  if (raw.audioBindings !== undefined) {
    if (!isObj(raw.audioBindings)) return fail("audioBindings must be an object")
    for (const [k, b] of Object.entries(raw.audioBindings)) {
      if (!isObj(b) || typeof b.band !== "string" || !AUDIO_BANDS.includes(b.band) || !isFiniteNum(b.amount)) {
        return fail(`audioBindings.${k} needs a valid band and a finite amount`)
      }
    }
  }

  let memoryBudget: Record<string, unknown> | undefined
  if (raw.memoryBudget !== undefined) {
    if (!isObj(raw.memoryBudget)) return fail("memoryBudget must be an object")
    memoryBudget = {}
    for (const key of ["textureBudgetMB", "geometryBudgetMB", "totalVramBudgetMB", "warnThresholdRatio"]) {
      const v = raw.memoryBudget[key]
      if (v === undefined) continue
      if (!isFiniteNum(v) || v < 0) return fail(`memoryBudget.${key} must be a non-negative finite number`)
      memoryBudget[key] = v
    }
  }

  let environmentSettings: Record<string, unknown> | undefined
  if (raw.environmentSettings !== undefined) {
    const env = sanitizeEnvironment(raw.environmentSettings, warnings)
    if (env.error) return fail(env.error)
    environmentSettings = env.value
  }

  const now = Date.now()
  const stored = mode === "stored"
  const data = {
    name,
    version: "1.0",
    backend,
    graphNodes,
    graphEdges,
    uniformValues: uniformValues as Record<string, UniformValue>,
    graphUniforms,
    shaderSources,
    audioSettings,
    audioBindings: raw.audioBindings,
    variations,
    environmentSettings,
    memoryBudget,
    projectId: stored && typeof raw.projectId === "string" ? raw.projectId : newProjectId(),
    createdAt: stored && isFiniteNum(raw.createdAt) ? raw.createdAt : now,
    updatedAt: stored && isFiniteNum(raw.updatedAt) ? raw.updatedAt : now,
  } as ProjectData
  return { ok: true, data, warnings }
}

/**
 * Validate parsed .shaderstudio JSON and return a sanitized ProjectData with a FRESH projectId (an import can never
 * overwrite an existing project). Deep-checks graph nodes/edges, uniforms, audio, memory budget and environment
 * settings; strips __proto__ / constructor / prototype keys at every nesting level; drops an environment
 * customTextureSrc that is not a data:image/*, blob: or https: URL (reported in warnings). Never throws.
 */
export function validateProjectImport(raw: unknown): ProjectImportResult {
  return validateProject(raw, "import")
}

/** Same checks for a row read from IndexedDB (may predate this version); keeps projectId, name and timestamps. */
export function validateStoredProject(raw: unknown): ProjectImportResult {
  return validateProject(raw, "stored")
}

/** Size-capped JSON.parse + validation. Never throws; returns a user-facing error message instead. */
export function parseProjectJson(text: string): ProjectImportResult {
  if (typeof text !== "string" || text.length === 0) return fail("file is empty")
  if (text.length > MAX_PROJECT_IMPORT_BYTES) {
    return fail(`file is larger than the ${Math.round(MAX_PROJECT_IMPORT_BYTES / (1024 * 1024))} MB limit`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail("not valid JSON")
  }
  return validateProjectImport(parsed)
}

/** "name" if free, else "name (imported)", "name (imported 2)", ... Case-insensitive against existing names. */
export function uniqueImportName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let candidate = `${name} (imported)`
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name} (imported ${i})`
  return candidate
}
