import { create } from "zustand"
import type { Node, Edge } from "reactflow"
import type { GraphNodeData, RenderQueue } from "@/core/graphCompiler"

export type BackendType = "webgpu" | "webgl2" | "threejs"
export type SyncMode = "bridge" | "folder" | "local"

export interface ParsedUniform {
  name: string
  type: "f32" | "i32" | "u32" | "bool" | "vec2f" | "vec3f" | "vec4f" | "texture"
  kind: "scalar" | "vector" | "color" | "texture" | "array"
  arrayLength?: number
}

export interface UniformValue {
  type: "float" | "vec2" | "vec3" | "vec4" | "color" | "bool" | "texture"
  value: number | number[] | boolean | string
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
  setParsedUniforms: (uniforms) => set({ parsedUniforms: uniforms }),
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
