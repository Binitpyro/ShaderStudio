import { create } from "zustand"
import type { Node, Edge } from "reactflow"
import type { GraphNodeData, RenderQueue } from "@/core/graphCompiler"

export type BackendType = "webgpu" | "webgl2" | "threejs"
export type SyncMode = "bridge" | "folder" | "local"

export type UniformType =
  | "f32"
  | "i32"
  | "u32"
  | "bool"
  | "vec2f"
  | "vec3f"
  | "vec4f"
  | "mat2x2f"
  | "mat3x3f"
  | "mat4x4f"
  | "texture"
  | "struct"

export type UniformKind =
  | "scalar"
  | "vector"
  | "matrix"
  | "color"
  | "texture"
  | "array"
  | "struct"

export interface ParsedUniform {
  name: string
  type: UniformType
  kind: UniformKind
  arrayLength?: number
  structFields?: ParsedUniform[]
}

export type UniformValueType =
  | "float"
  | "int"
  | "uint"
  | "vec2"
  | "vec3"
  | "vec4"
  | "mat2"
  | "mat3"
  | "mat4"
  | "color"
  | "bool"
  | "texture"
  | "struct"

export interface UniformValue {
  type: UniformValueType
  value: number | number[] | boolean | string | Record<string, any>
}

export function getDefaultUniformValue(uniform: ParsedUniform): UniformValue {
  switch (uniform.kind) {
    case "color":
      return {
        type: uniform.type === "vec4f" ? "vec4" : "color",
        value: uniform.type === "vec4f" ? [0.5, 0.5, 0.5, 1.0] : [0.5, 0.5, 0.5],
      }
    case "vector":
      if (uniform.type === "vec2f") return { type: "vec2", value: [0, 0] }
      if (uniform.type === "vec3f") return { type: "vec3", value: [0, 0, 0] }
      return { type: "vec4", value: [0, 0, 0, 1] }
    case "matrix":
      if (uniform.type === "mat2x2f") return { type: "mat2", value: [1, 0, 0, 1] }
      if (uniform.type === "mat3x3f") return { type: "mat3", value: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
      return {
        type: "mat4",
        value: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
      }
    case "texture":
      return { type: "texture", value: "" }
    case "scalar":
      if (uniform.type === "bool") return { type: "bool", value: false }
      return { type: "float", value: 0 }
    case "struct":
      return { type: "struct", value: {} }
    case "array":
      return { type: "float", value: 0 }
    default:
      return { type: "float", value: 0 }
  }
}

export interface GraphUniform {
  id: string
  name: string
  type: "float" | "vec2" | "vec3" | "vec4" | "color" | "bool"
  defaultValue: number | number[] | boolean
}

export interface TextureResource {
  id: string
  name: string
  src: string
}

// Project serialization types
export interface ProjectData {
  name: string
  version: "1.0"
  backend: BackendType
  graphNodes: Node<GraphNodeData>[]
  graphEdges: Edge[]
  uniformValues: Record<string, UniformValue>
  graphUniforms: GraphUniform[]
  shaderSources: { wgsl?: string; glsl?: string }
  createdAt: number
  updatedAt: number
}

interface ProjectState {
  activeBackend: BackendType
  shaderSource: string
  activeShaderPath: string | null
  parsedUniforms: ParsedUniform[]
  uniformValues: Record<string, UniformValue>
  lastCompileError: string | null
  deviceLost: boolean
  autoCompile: boolean
  recompileTrigger: number
  graphUniforms: GraphUniform[]
  textureResources: TextureResource[]
  renderQueue: RenderQueue | null
  _graphNodes: Node<GraphNodeData>[]
  _graphEdges: Edge[]
  // Project management
  currentProjectName: string | null
  hasUnsavedChanges: boolean

  setActiveBackend: (backend: BackendType) => void
  setShaderSource: (source: string) => void
  setActiveShaderPath: (path: string | null) => void
  setParsedUniforms: (uniforms: ParsedUniform[]) => void
  setUniformValue: (name: string, value: UniformValue) => void
  setLastCompileError: (error: string | null) => void
  setDeviceLost: (lost: boolean) => void
  setAutoCompile: (auto: boolean) => void
  triggerRecompile: () => void
  addGraphUniform: (uniform: GraphUniform) => void
  updateGraphUniform: (id: string, updates: Partial<GraphUniform>) => void
  removeGraphUniform: (id: string) => void
  addTextureResource: (texture: TextureResource) => void
  removeTextureResource: (id: string) => void
  setRenderQueue: (queue: RenderQueue | null) => void
  setGraphNodes: (nodes: Node<GraphNodeData>[]) => void
  setGraphEdges: (edges: Edge[]) => void
  setCurrentProjectName: (name: string | null) => void
  setHasUnsavedChanges: (has: boolean) => void
  loadProjectData: (data: ProjectData) => void
  exportProjectData: () => ProjectData
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeBackend: "webgpu",
  shaderSource: "",
  activeShaderPath: null,
  parsedUniforms: [],
  uniformValues: {},
  lastCompileError: null,
  deviceLost: false,
  autoCompile: true,
  recompileTrigger: 0,
  graphUniforms: [],
  textureResources: [],
  renderQueue: null,
  _graphNodes: [],
  _graphEdges: [],
  currentProjectName: null,
  hasUnsavedChanges: false,

  setActiveBackend: (backend) => set({ activeBackend: backend, hasUnsavedChanges: true }),
  setShaderSource: (source) => set({ shaderSource: source, hasUnsavedChanges: true }),
  setActiveShaderPath: (path) => set({ activeShaderPath: path }),
  setParsedUniforms: (uniforms) => set((state) => {
    if (!uniforms || uniforms.length === 0) {
      return { parsedUniforms: [] }
    }
    const nextUniformValues = { ...state.uniformValues }
    for (const u of uniforms) {
      if (!nextUniformValues[u.name]) {
        nextUniformValues[u.name] = getDefaultUniformValue(u)
      }
    }
    return {
      parsedUniforms: uniforms,
      uniformValues: nextUniformValues,
    }
  }),
  setUniformValue: (name, value) => set((state) => ({
    uniformValues: { ...state.uniformValues, [name]: value },
    hasUnsavedChanges: true,
  })),
  setLastCompileError: (error) => set({ lastCompileError: error }),
  setDeviceLost: (lost) => set({ deviceLost: lost }),
  setAutoCompile: (auto) => set({ autoCompile: auto }),
  triggerRecompile: () => set((state) => ({ recompileTrigger: state.recompileTrigger + 1 })),
  addGraphUniform: (uniform) => set((state) => ({ graphUniforms: [...state.graphUniforms, uniform], hasUnsavedChanges: true })),
  updateGraphUniform: (id, updates) => set((state) => ({
    graphUniforms: state.graphUniforms.map((u) => u.id === id ? { ...u, ...updates } : u),
    hasUnsavedChanges: true,
  })),
  removeGraphUniform: (id) => set((state) => ({
    graphUniforms: state.graphUniforms.filter((u) => u.id !== id),
    hasUnsavedChanges: true,
  })),
  addTextureResource: (texture) => set((state) => ({ textureResources: [...state.textureResources, texture], hasUnsavedChanges: true })),
  removeTextureResource: (id) => set((state) => ({
    textureResources: state.textureResources.filter((t) => t.id !== id),
    hasUnsavedChanges: true,
  })),
  setRenderQueue: (queue) => set({ renderQueue: queue }),
  setGraphNodes: (nodes) => set({ _graphNodes: nodes, hasUnsavedChanges: true }),
  setGraphEdges: (edges) => set({ _graphEdges: edges, hasUnsavedChanges: true }),
  setCurrentProjectName: (name) => set({ currentProjectName: name }),
  setHasUnsavedChanges: (has) => set({ hasUnsavedChanges: has }),

  loadProjectData: (data) => set({
    activeBackend: data.backend,
    _graphNodes: data.graphNodes,
    _graphEdges: data.graphEdges,
    uniformValues: data.uniformValues,
    graphUniforms: data.graphUniforms,
    shaderSource: data.shaderSources.wgsl || data.shaderSources.glsl || "",
    currentProjectName: data.name,
    hasUnsavedChanges: false,
  }),

  exportProjectData: () => {
    const state = get()
    return {
      name: state.currentProjectName || "Untitled",
      version: "1.0" as const,
      backend: state.activeBackend,
      graphNodes: state._graphNodes,
      graphEdges: state._graphEdges,
      uniformValues: state.uniformValues,
      graphUniforms: state.graphUniforms,
      shaderSources: {
        wgsl: state.activeBackend === "webgpu" ? state.shaderSource : undefined,
        glsl: state.activeBackend !== "webgpu" ? state.shaderSource : undefined,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  },
}))
