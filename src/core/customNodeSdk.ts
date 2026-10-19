import type { ComponentType } from "react"
import { Cpu } from "lucide-react"

export interface CustomNodePort {
  id?: string
  name: string
  type: string
  defaultValue?: any
}

export interface CustomNodeParam {
  id?: string
  name: string
  type: "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "color" | "boolean"
  default?: any
  defaultValue?: any
  ui?:
    | "slider"
    | "color-picker"
    | "switch"
    | "dropdown"
    | "number"
    | {
        widget?: "slider" | "color-picker" | "switch" | "dropdown" | "number"
        min?: number
        max?: number
        step?: number
        options?: Array<{ label: string; value: string | number }>
      }
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string | number }>
}

export interface CustomNodeManifest {
  type?: string
  id: string
  title?: string
  name?: string
  version?: string
  author?: string
  category: "math" | "filter" | "generator" | "utility" | "custom" | "Geometry" | "Shading" | "Post-Processing" | "Dynamics & Audio" | "SDF & Raymarching" | "Custom"
  description?: string
  inputs: CustomNodePort[]
  outputs: CustomNodePort[]
  parameters: CustomNodeParam[]
  glsl?: string
  wgsl?: string
  shader?: {
    glsl?: string
    wgsl?: string
    entryFunction?: string
  }
  customUiComponent?: string
  customComponent?: string
}

export interface CustomNodeValidationResult {
  valid: boolean
  errors: string[]
  manifest?: CustomNodeManifest
}

export function validateCustomNodeManifest(data: unknown): CustomNodeValidationResult {
  const errors: string[] = []
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Manifest must be a non-null object."] }
  }

  const obj = data as Record<string, any>
  const rawId = obj.id !== undefined && obj.id !== null ? obj.id : obj.type
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    errors.push("Manifest requires a non-empty string 'id' or 'type'.")
  }
  const id = typeof rawId === "string" ? rawId.trim() : ""

  const rawName = obj.name !== undefined && obj.name !== null ? obj.name : obj.title
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    errors.push("Manifest requires a non-empty string 'name' or 'title'.")
  }
  const name = typeof rawName === "string" ? rawName.trim() : ""

  if (!Array.isArray(obj.inputs)) {
    errors.push("Manifest requires an 'inputs' array.")
  } else {
    for (let i = 0; i < obj.inputs.length; i++) {
      const port = obj.inputs[i]
      if (!port || typeof port.name !== "string" || !port.type) {
        errors.push(`Input port at index ${i} must have 'name' and 'type'.`)
      }
    }
  }

  if (!Array.isArray(obj.outputs)) {
    errors.push("Manifest requires an 'outputs' array.")
  } else {
    for (let i = 0; i < obj.outputs.length; i++) {
      const port = obj.outputs[i]
      if (!port || typeof port.name !== "string" || !port.type) {
        errors.push(`Output port at index ${i} must have 'name' and 'type'.`)
      }
    }
  }

  if (!Array.isArray(obj.parameters)) {
    errors.push("Manifest requires a 'parameters' array.")
  } else {
    for (let i = 0; i < obj.parameters.length; i++) {
      const param = obj.parameters[i]
      if (!param || typeof param !== "object") {
        errors.push(`Parameter at index ${i} must be a non-null object.`)
        continue
      }
      if (typeof param.name !== "string" || param.name.trim().length === 0) {
        errors.push(`Parameter at index ${i} must have a non-empty string 'name'.`)
      }
      if (!param.type || typeof param.type !== "string" || param.type.trim().length === 0) {
        errors.push(`Parameter at index ${i} must have a valid 'type'.`)
      }
    }
  }

  const hasShader =
    Boolean(obj.glsl) ||
    Boolean(obj.wgsl) ||
    Boolean(obj.shader?.glsl) ||
    Boolean(obj.shader?.wgsl) ||
    Boolean(obj.customUiComponent) ||
    Boolean(obj.customComponent)
  if (!hasShader) {
    errors.push("Manifest requires at least one shader snippet ('glsl', 'wgsl') or custom component.")
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const normalized: CustomNodeManifest = {
    id,
    type: "custom",
    name,
    title: name,
    version: obj.version || "1.0.0",
    author: obj.author,
    category: obj.category || "Custom",
    description: obj.description || "",
    inputs: obj.inputs.map((p: any) => ({
      id: p.id || `in_${p.name}`,
      name: p.name,
      type: p.type,
      defaultValue: p.defaultValue,
    })),
    outputs: obj.outputs.map((p: any) => ({
      id: p.id || `out_${p.name}`,
      name: p.name,
      type: p.type,
    })),
    parameters: obj.parameters.map((param: any) => ({
      id: param.id && typeof param.id === "string" && param.id.trim().length > 0 ? param.id.trim() : param.name.trim(),
      name: param.name.trim(),
      type: param.type.trim(),
      default: param.default !== undefined ? param.default : param.defaultValue,
      defaultValue: param.defaultValue !== undefined ? param.defaultValue : param.default,
      ui: param.ui,
      min: param.min,
      max: param.max,
      step: param.step,
      options: param.options,
    })),
    glsl: obj.glsl || obj.shader?.glsl,
    wgsl: obj.wgsl || obj.shader?.wgsl,
    shader: obj.shader,
    customUiComponent: obj.customUiComponent || obj.customComponent,
    customComponent: obj.customComponent || obj.customUiComponent,
  }

  return { valid: true, errors: [], manifest: normalized }
}

export class CustomNodeRegistry {
  private manifests = new Map<string, CustomNodeManifest>()
  private customComponents = new Map<string, ComponentType<any>>()

  constructor() {
    this.discoverBuiltinNodes()
  }

  public register(manifest: CustomNodeManifest): boolean {
    const res = validateCustomNodeManifest(manifest)
    if (!res.valid || !res.manifest) {
      console.warn(`[CustomNodeRegistry] Failed to register manifest "${(manifest as any)?.id}":`, res.errors)
      return false
    }
    this.manifests.set(res.manifest.id, res.manifest)
    return true
  }

  public unregister(id: string): boolean {
    return this.manifests.delete(id)
  }

  public get(id: string): CustomNodeManifest | undefined {
    return this.manifests.get(id)
  }

  public has(id: string): boolean {
    return this.manifests.has(id)
  }

  public getAll(): CustomNodeManifest[] {
    return Array.from(this.manifests.values())
  }

  public clear(): void {
    this.manifests.clear()
    this.customComponents.clear()
  }

  public registerComponent(name: string, component: ComponentType<any>): void {
    this.customComponents.set(name, component)
  }

  public getComponent(name: string): ComponentType<any> | undefined {
    return this.customComponents.get(name)
  }

  public discoverBuiltinNodes(globModules?: Record<string, any>): CustomNodeManifest[] {
    const discovered: CustomNodeManifest[] = []
    let modules = globModules

    if (!modules && typeof import.meta !== "undefined" && typeof (import.meta as any).glob === "function") {
      try {
        modules = import.meta.glob("../../custom-nodes/**/*.json", { eager: true })
      } catch {
        modules = {}
      }
    }

    if (modules) {
      for (const [path, mod] of Object.entries(modules)) {
        const data = mod?.default ?? mod
        const res = validateCustomNodeManifest(data)
        if (res.valid && res.manifest) {
          this.register(res.manifest)
          const filenameMatch = path.match(/([^/\\]+)\.json$/)
          if (filenameMatch && filenameMatch[1] && filenameMatch[1] !== res.manifest.id) {
            this.manifests.set(filenameMatch[1], res.manifest)
          }
          discovered.push(res.manifest)
        } else {
          console.warn(`[CustomNodeRegistry] Ignored invalid custom node at ${path}:`, res.errors)
        }
      }
    }

    return discovered
  }

  public getPaletteItems(): Array<{
    id: string
    label: string
    type: string
    category: any
    description: string
    icon: any
    defaultData: any
  }> {
    return Array.from(this.manifests.values()).map((manifest) => {
      const defaultParams: Record<string, any> = {}
      for (const p of manifest.parameters) {
        defaultParams[p.name] = p.default ?? p.defaultValue ?? 0
      }

      return {
        id: `custom-${manifest.id}`,
        label: manifest.name || manifest.title || manifest.id,
        type: "custom",
        category: (manifest.category as any) || "Custom",
        description: manifest.description || "Custom user-authored node.",
        icon: Cpu,
        defaultData: {
          type: "custom",
          manifestId: manifest.id,
          parameters: defaultParams,
          customComponent: manifest.customComponent || manifest.customUiComponent,
        },
      }
    })
  }
}

export const customNodeRegistry = new CustomNodeRegistry()
