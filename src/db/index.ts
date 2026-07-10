import Dexie, { type EntityTable } from "dexie"
import type { ProjectData } from "@/stores/projectStore"

export interface ShaderSnapshot {
  id?: number
  path: string
  content: string
  timestamp: number
}

export interface SavedProject extends ProjectData {
  id?: number
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
  }
}

export const db = new ShaderStudioDB()

export async function saveSnapshot(path: string, content: string) {
  await db.snapshots.add({ path, content, timestamp: Date.now() })
}

export async function getLatestSnapshot(path: string) {
  return db.snapshots.where("path").equals(path).reverse().sortBy("timestamp").then((results) => results[0] ?? null)
}

export async function saveProject(data: ProjectData): Promise<number> {
  const existing = await db.projects.where("name").equals(data.name).first()
  if (existing && existing.id) {
    await db.projects.update(existing.id, { ...data, updatedAt: Date.now() })
    return existing.id
  }
  const id = await db.projects.add({ ...data, createdAt: Date.now(), updatedAt: Date.now() })
  return id as number
}

export async function loadProject(name: string): Promise<ProjectData | null> {
  const project = await db.projects.where("name").equals(name).first()
  if (!project) return null
  const { id, ...data } = project
  return data as ProjectData
}

export async function listProjects(): Promise<Array<{ name: string; updatedAt: number }>> {
  const projects = await db.projects.toArray()
  return projects.map((p) => ({ name: p.name, updatedAt: p.updatedAt }))
}

export async function deleteProject(name: string) {
  const project = await db.projects.where("name").equals(name).first()
  if (project && project.id) await db.projects.delete(project.id)
}
