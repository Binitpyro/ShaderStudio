import { create } from "zustand"
import type { Node, Edge } from "@xyflow/react"
import { compileGraph, type GraphNodeData, type RenderQueue } from "@/core/graphCompiler"
import type { EnvironmentPreset } from "@/core/environmentGenerator"
import {
  checkMemoryThreshold,
  createDefaultMemoryBudget,
  type MemoryBudgetConfig,
  type MemoryThresholdResult,
  type MemoryUsage,
} from "@/core/memoryBudget"
import {
  STARTER_WGSL,
  STARTER_GLSL,
  STARTER_VERT_GLSL,
  STARTER_NODES,
  STARTER_EDGES,
  STARTER_UNIFORMS,
  STARTER_AUDIO_BINDINGS,
  STARTER_VARIATIONS,
  STARTER_ENVIRONMENT,
} from "@/core/defaultStarterScene"

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
  | "vec2i"
  | "vec3i"
  | "vec4i"
  | "vec2u"
  | "vec3u"
  | "vec4u"
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

export interface PresetVariation {
  id: string
  name: string
  uniformValues: Record<string, UniformValue>
  createdAt: number
}

export type AudioBand = "bass" | "mid" | "treble" | "beat" | "level"
export type AudioSourceType = "builtin" | "file" | "mic"

export interface AudioBinding {
  band: AudioBand
  amount: number
}

export interface EnvironmentSettings {
  preset: EnvironmentPreset
  exposure: number
  rotation: number
  backgroundBlur: number
  showSkybox: boolean
  customTextureSrc?: string
  timeOfDay?: number
  rayleighScattering?: [number, number, number]
  mieScattering?: number
  mieTurbidity?: number
  sunIntensity?: number
  sunDiscSize?: number
}

// Project serialization types
export interface ProjectData {
  /** Stable identity used for DB upserts (name is not unique). */
  projectId?: string
  name: string
  version: "1.0"
  backend: BackendType
  graphNodes: Node<GraphNodeData>[]
  graphEdges: Edge[]
  uniformValues: Record<string, UniformValue>
  graphUniforms: GraphUniform[]
  shaderSources: { wgsl?: string; glsl?: string; compute?: string; vertex?: string }
  audioSettings?: {
    sourceType: "builtin" | "file" | "mic"
    volume: number
    gain: number
    smoothing: number
  }
  audioBindings?: Record<string, AudioBinding>
  variations?: PresetVariation[]
  environmentSettings?: EnvironmentSettings
  memoryBudget?: MemoryBudgetConfig
  createdAt: number
  updatedAt: number
}

export type EditorTab = "render" | "compute" | "fragment" | "vertex"

export type ShaderLanguage = "wgsl" | "glsl"

/** webgpu runs WGSL; webgl2 / threejs run GLSL. */
export function languageForBackend(backend: BackendType): ShaderLanguage {
  return backend === "webgpu" ? "wgsl" : "glsl"
}

/**
 * Optional provider returning the live React Flow graph (with current positions). NodeGraph registers one
 * so save/export serialise real positions without the store tracking every drag tick.
 */
type LiveGraphProvider = () => { nodes: Node<GraphNodeData>[]; edges: Edge[] }
let liveGraphProvider: LiveGraphProvider | null = null
export function registerLiveGraphProvider(provider: LiveGraphProvider | null) {
  liveGraphProvider = provider
}

interface ProjectState {
  activeBackend: BackendType
  /** Per-backend sources: switching backend only changes which one is active, never overwrites either. */
  wgslSource: string
  glslSource: string
  /** Derived: always equals the source of the active backend's language (wgslSource | glslSource). */
  shaderSource: string
  activeShaderPath: string | null
  computeShaderSource: string
  vertexShaderSource: string
  activeEditorTab: EditorTab
  simulationResetTrigger: number
  audioSourceType: "builtin" | "file" | "mic"
  isAudioPlaying: boolean
  audioVolume: number
  audioGain: number
  audioSmoothing: number
  parsedUniforms: ParsedUniform[]
  uniformValues: Record<string, UniformValue>
  lastCompileError: string | null
  /** Bumped by every adapter/compiler report (setLastCompileError); plain clears do not bump it. Lets callers await a real report. */
  compileSeq: number
  deviceLost: boolean
  autoCompile: boolean
  recompileTrigger: number
  graphUniforms: GraphUniform[]
  textureResources: TextureResource[]
  renderQueue: RenderQueue | null
  /**
   * Serializable graph snapshot. React Flow owns the live nodes/edges; NodeGraph publishes here only on
   * structure/data edits (and debounced after drags) - never per drag tick.
   */
  _graphNodes: Node<GraphNodeData>[]
  _graphEdges: Edge[]
  // Variations & snapshots
  variations: PresetVariation[]
  activeVariationId: string | null
  // Audio parameter modulation bindings
  audioBindings: Record<string, AudioBinding>
  // Environment & IBL Lighting
  environmentSettings: EnvironmentSettings
  // Project management
  currentProjectName: string | null
  currentProjectId: string | null
  hasUnsavedChanges: boolean
  selectedNodeId: string | null
  // Memory Budget System (R5b)
  memoryBudget: MemoryBudgetConfig

  setActiveBackend: (backend: BackendType) => void
  /** Writes the source for the given language (default: the active backend's language). */
  setShaderSource: (source: string, language?: ShaderLanguage) => void
  /** Graph-generated (raymarch) sources for both languages; does not mark the project dirty. */
  setGeneratedSources: (sources: { wgsl: string; glsl: string }) => void
  /** Merge several uniform values in one update (single store notification). */
  mergeUniformValues: (values: Record<string, UniformValue>) => void
  setActiveShaderPath: (path: string | null) => void
  setComputeShaderSource: (source: string) => void
  setVertexShaderSource: (source: string) => void
  setActiveEditorTab: (tab: EditorTab) => void
  triggerSimulationReset: () => void
  setAudioSourceType: (type: "builtin" | "file" | "mic") => void
  setIsAudioPlaying: (playing: boolean) => void
  setAudioVolume: (vol: number) => void
  setAudioGain: (gain: number) => void
  setAudioSmoothing: (smoothing: number) => void
  setAudioBinding: (uniformName: string, binding: AudioBinding | null) => void
  clearAudioBindings: () => void
  setEnvironmentSettings: (settings: Partial<EnvironmentSettings>) => void
  setEnvironmentPreset: (preset: EnvironmentPreset) => void
  setEnvironmentExposure: (exposure: number) => void
  setEnvironmentRotation: (rotation: number) => void
  setEnvironmentSkybox: (show: boolean) => void
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
  setGraphNodes: (nodes: Node<GraphNodeData>[], opts?: { markDirty?: boolean }) => void
  setGraphEdges: (edges: Edge[], opts?: { markDirty?: boolean }) => void
  setCurrentProjectName: (name: string | null) => void
  setCurrentProjectId: (id: string | null) => void
  setHasUnsavedChanges: (has: boolean) => void
  setSelectedNodeId: (id: string | null) => void
  addVariation: (name: string) => string
  applyVariation: (id: string) => void
  deleteVariation: (id: string) => void
  importVariations: (imported: PresetVariation[]) => void
  resetProject: () => void
  loadStarterScene: () => void
  loadProjectData: (data: ProjectData) => void
  exportProjectData: () => ProjectData
  setMemoryBudget: (config: Partial<MemoryBudgetConfig>) => void
  getMemoryBudget: () => MemoryBudgetConfig
  checkMemoryThreshold: (usage: MemoryUsage) => MemoryThresholdResult
}

/**
 * Resolve both language sources from saved data. Handles the legacy format where only the active
 * language was saved (and, defensively, a bare top-level shaderSource string).
 */
function resolveLoadedSources(data: ProjectData): { wgsl: string; glsl: string } {
  const saved = data.shaderSources
  let wgsl = typeof saved?.wgsl === "string" ? saved.wgsl : ""
  let glsl = typeof saved?.glsl === "string" ? saved.glsl : ""
  const legacy = (data as unknown as { shaderSource?: unknown }).shaderSource
  if (!wgsl && !glsl && typeof legacy === "string") {
    if (data.backend === "webgpu") wgsl = legacy
    else glsl = legacy
  }
  return { wgsl, glsl }
}

/** Compile a graph to a render queue; null when empty or invalid. Lets store writes publish the queue without NodeGraph mounted. */
export function compileQueue(nodes: Node<GraphNodeData>[], edges: Edge[]): RenderQueue | null {
  if (nodes.length === 0) return null
  const { queue, error } = compileGraph(nodes, edges)
  return error ? null : queue
}

export const STARTER_QUEUE = compileGraph(STARTER_NODES, STARTER_EDGES).queue

export const useProjectStore = create<ProjectState>((set, get, api) => {
  api.getInitialState = () => api.getState()
  return {
  activeBackend: "webgpu",
  wgslSource: STARTER_WGSL,
  glslSource: STARTER_GLSL,
  shaderSource: STARTER_WGSL,
  activeShaderPath: null,
  computeShaderSource: "",
  vertexShaderSource: STARTER_VERT_GLSL,
  activeEditorTab: "render",
  simulationResetTrigger: 0,
  audioSourceType: "builtin",
  isAudioPlaying: false,
  audioVolume: 0.8,
  audioGain: 1.2,
  audioSmoothing: 0.8,
  audioBindings: { ...STARTER_AUDIO_BINDINGS },
  environmentSettings: { ...STARTER_ENVIRONMENT },
  parsedUniforms: [],
  uniformValues: { ...STARTER_UNIFORMS },
  lastCompileError: null,
  compileSeq: 0,
  deviceLost: false,
  autoCompile: true,
  recompileTrigger: 0,
  graphUniforms: [],
  textureResources: [],
  renderQueue: STARTER_QUEUE,
  _graphNodes: [...STARTER_NODES],
  _graphEdges: [...STARTER_EDGES],
  variations: [...STARTER_VARIATIONS],
  activeVariationId: null,
  currentProjectName: "Iridescent Torus Hero",
  currentProjectId: null,
  hasUnsavedChanges: false,
  selectedNodeId: null,
  memoryBudget: createDefaultMemoryBudget(),

  setActiveBackend: (backend) => set((state) => {
    let nextTab = state.activeEditorTab
    if (backend === "webgpu") {
      if (nextTab === "fragment" || nextTab === "vertex") {
        nextTab = "render"
      }
    } else {
      if (nextTab === "render") {
        nextTab = "fragment"
      }
    }

    // Never overwrite user code. Only a still-empty slot of a project that already has code in the
    // other language is seeded with that language's starter so the new backend has something to run.
    let wgslSource = state.wgslSource
    let glslSource = state.glslSource
    if (!wgslSource && glslSource) wgslSource = STARTER_WGSL
    if (!glslSource && wgslSource) glslSource = STARTER_GLSL

    return {
      activeBackend: backend,
      activeEditorTab: nextTab,
      wgslSource,
      glslSource,
      shaderSource: backend === "webgpu" ? wgslSource : glslSource,
      hasUnsavedChanges: true,
      recompileTrigger: state.recompileTrigger + 1,
    }
  }),
  setShaderSource: (source, language) => set((state) => {
    const lang = language ?? languageForBackend(state.activeBackend)
    const wgslSource = lang === "wgsl" ? source : state.wgslSource
    const glslSource = lang === "glsl" ? source : state.glslSource
    return {
      wgslSource,
      glslSource,
      shaderSource: languageForBackend(state.activeBackend) === "wgsl" ? wgslSource : glslSource,
      hasUnsavedChanges: true,
    }
  }),
  setGeneratedSources: ({ wgsl, glsl }) => set((state) => ({
    wgslSource: wgsl,
    glslSource: glsl,
    shaderSource: languageForBackend(state.activeBackend) === "wgsl" ? wgsl : glsl,
  })),
  mergeUniformValues: (values) => set((state) => ({
    uniformValues: { ...state.uniformValues, ...values },
    hasUnsavedChanges: true,
  })),
  setActiveShaderPath: (path) => set({ activeShaderPath: path }),
  setComputeShaderSource: (source) => set({ computeShaderSource: source, hasUnsavedChanges: true }),
  setVertexShaderSource: (source) => set({ vertexShaderSource: source, hasUnsavedChanges: true }),
  setActiveEditorTab: (tab) => set({ activeEditorTab: tab }),
  triggerSimulationReset: () => set((state) => ({ simulationResetTrigger: state.simulationResetTrigger + 1 })),
  setAudioSourceType: (type) => set({ audioSourceType: type, hasUnsavedChanges: true }),
  setIsAudioPlaying: (playing) => set({ isAudioPlaying: playing }),
  setAudioVolume: (vol) => set({ audioVolume: vol, hasUnsavedChanges: true }),
  setAudioGain: (gain) => set({ audioGain: gain, hasUnsavedChanges: true }),
  setAudioSmoothing: (smoothing) => set({ audioSmoothing: smoothing, hasUnsavedChanges: true }),
  setAudioBinding: (uniformName, binding) => set((state) => {
    const next = { ...state.audioBindings }
    if (!binding) {
      delete next[uniformName]
    } else {
      next[uniformName] = binding
    }
    return { audioBindings: next, hasUnsavedChanges: true }
  }),
  clearAudioBindings: () => set({ audioBindings: {}, hasUnsavedChanges: true }),
  setEnvironmentSettings: (settings) => set((state) => ({
    environmentSettings: { ...state.environmentSettings, ...settings },
    hasUnsavedChanges: true,
  })),
  setEnvironmentPreset: (preset) => set((state) => ({
    environmentSettings: { ...state.environmentSettings, preset },
    hasUnsavedChanges: true,
  })),
  setEnvironmentExposure: (exposure) => set((state) => ({
    environmentSettings: {
      ...state.environmentSettings,
      exposure: Math.max(0.1, Math.min(4.0, Number.isFinite(exposure) ? exposure : 1.0)),
    },
    hasUnsavedChanges: true,
  })),
  setEnvironmentRotation: (rotation) => set((state) => ({
    environmentSettings: {
      ...state.environmentSettings,
      rotation: ((rotation % 360) + 360) % 360,
    },
    hasUnsavedChanges: true,
  })),
  setEnvironmentSkybox: (show) => set((state) => ({
    environmentSettings: { ...state.environmentSettings, showSkybox: show },
    hasUnsavedChanges: true,
  })),
  setParsedUniforms: (uniforms) => set((state) => {
    if (!uniforms || uniforms.length === 0) {
      return { parsedUniforms: [] }
    }
    const nextUniformValues = { ...state.uniformValues }
    const nextAudioBindings = { ...state.audioBindings }

    const AUDIO_PARAM_MAP: Record<string, AudioBand> = {
      u_audiobass: "bass",
      u_audio_bass: "bass",
      audiobass: "bass",
      u_audiomid: "mid",
      u_audio_mid: "mid",
      audiomid: "mid",
      u_audiotreble: "treble",
      u_audio_treble: "treble",
      audiotreble: "treble",
      u_audiobeat: "beat",
      u_audio_beat: "beat",
      audiobeat: "beat",
      u_audiolevel: "level",
      u_audio_level: "level",
      audiolevel: "level",
    }

    for (const u of uniforms) {
      if (!nextUniformValues[u.name]) {
        nextUniformValues[u.name] = getDefaultUniformValue(u)
      }
      const lower = u.name.toLowerCase()
      if (AUDIO_PARAM_MAP[lower] && !nextAudioBindings[u.name]) {
        nextAudioBindings[u.name] = {
          band: AUDIO_PARAM_MAP[lower],
          amount: 1.0,
        }
      }
    }
    return {
      parsedUniforms: uniforms,
      uniformValues: nextUniformValues,
      audioBindings: nextAudioBindings,
    }
  }),
  setUniformValue: (name, value) => set((state) => ({
    uniformValues: { ...state.uniformValues, [name]: value },
    hasUnsavedChanges: true,
  })),
  setLastCompileError: (error) => set((s) => ({ lastCompileError: error, compileSeq: s.compileSeq + 1 })),
  setDeviceLost: (lost) => set({ deviceLost: lost }),
  setAutoCompile: (auto) => set({ autoCompile: auto }),
  triggerRecompile: () => set((state) => ({ recompileTrigger: state.recompileTrigger + 1 })),
  addGraphUniform: (uniform) => set((state) => ({
    // Idempotent per id: loading a project (which restores graphUniforms) and mounting its uniform nodes must not duplicate.
    graphUniforms: state.graphUniforms.some((u) => u.id === uniform.id)
      ? state.graphUniforms.map((u) => (u.id === uniform.id ? { ...u, ...uniform } : u))
      : [...state.graphUniforms, uniform],
    hasUnsavedChanges: true,
  })),
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
  setGraphNodes: (nodes, opts) => set((state) => ({
    _graphNodes: nodes,
    hasUnsavedChanges: opts?.markDirty === false ? state.hasUnsavedChanges : true,
  })),
  setGraphEdges: (edges, opts) => set((state) => ({
    _graphEdges: edges,
    hasUnsavedChanges: opts?.markDirty === false ? state.hasUnsavedChanges : true,
  })),
  setCurrentProjectName: (name) => set({ currentProjectName: name }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setHasUnsavedChanges: (has) => set({ hasUnsavedChanges: has }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  addVariation: (name) => {
    const id = "var-" + crypto.randomUUID()
    const currentUniforms = { ...get().uniformValues }
    const newVariation: PresetVariation = {
      id,
      name: name.trim() || `Variation ${get().variations.length + 1}`,
      uniformValues: currentUniforms,
      createdAt: Date.now(),
    }
    set((state) => ({
      variations: [...state.variations, newVariation],
      activeVariationId: id,
      hasUnsavedChanges: true,
    }))
    return id
  },

  applyVariation: (id) => {
    const v = get().variations.find((item) => item.id === id)
    if (!v) return
    set({
      uniformValues: { ...v.uniformValues },
      activeVariationId: id,
      hasUnsavedChanges: true,
    })
  },

  deleteVariation: (id) => {
    set((state) => ({
      variations: state.variations.filter((item) => item.id !== id),
      activeVariationId: state.activeVariationId === id ? null : state.activeVariationId,
      hasUnsavedChanges: true,
    }))
  },

  importVariations: (imported) => {
    if (!Array.isArray(imported) || imported.length === 0) return
    set((state) => ({
      variations: [...state.variations, ...imported],
      hasUnsavedChanges: true,
    }))
  },

  resetProject: () => {
    set({
      currentProjectName: "Untitled",
      currentProjectId: null,
      wgslSource: "",
      glslSource: "",
      shaderSource: "",
      vertexShaderSource: "",
      computeShaderSource: "",
      activeEditorTab: get().activeBackend === "webgpu" ? "render" : "fragment",
      parsedUniforms: [],
      uniformValues: {},
      graphUniforms: [],
      textureResources: [],
      _graphNodes: [],
      _graphEdges: [],
      renderQueue: null,
      variations: [],
      activeVariationId: null,
      audioBindings: {},
      environmentSettings: {
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0.0,
        backgroundBlur: 0.0,
        showSkybox: false,
      },
      memoryBudget: createDefaultMemoryBudget(),
      lastCompileError: null,
      hasUnsavedChanges: false,
      selectedNodeId: null,
      recompileTrigger: get().recompileTrigger + 1,
    })
  },

  loadStarterScene: () => {
    const isWebGpu = get().activeBackend === "webgpu"
    set({
      currentProjectName: "Iridescent Torus Hero",
      currentProjectId: null,
      wgslSource: STARTER_WGSL,
      glslSource: STARTER_GLSL,
      shaderSource: isWebGpu ? STARTER_WGSL : STARTER_GLSL,
      vertexShaderSource: STARTER_VERT_GLSL,
      computeShaderSource: "",
      activeEditorTab: isWebGpu ? "render" : "fragment",
      uniformValues: { ...STARTER_UNIFORMS },
      graphUniforms: [],
      textureResources: [],
      _graphNodes: [...STARTER_NODES],
      _graphEdges: [...STARTER_EDGES],
      variations: [...STARTER_VARIATIONS],
      activeVariationId: null,
      audioBindings: { ...STARTER_AUDIO_BINDINGS },
      environmentSettings: { ...STARTER_ENVIRONMENT },
      memoryBudget: createDefaultMemoryBudget(),
      renderQueue: STARTER_QUEUE,
      lastCompileError: null,
      hasUnsavedChanges: false,
      selectedNodeId: null,
      recompileTrigger: get().recompileTrigger + 1,
    })
  },

  loadProjectData: (data) => {
    const sources = resolveLoadedSources(data)
    set({
    activeBackend: data.backend,
    _graphNodes: data.graphNodes || [],
    _graphEdges: data.graphEdges || [],
    renderQueue: compileQueue(data.graphNodes || [], data.graphEdges || []),
    uniformValues: data.uniformValues || {},
    graphUniforms: data.graphUniforms || [],
    wgslSource: sources.wgsl,
    glslSource: sources.glsl,
    shaderSource: data.backend === "webgpu" ? sources.wgsl : sources.glsl,
    computeShaderSource: data.shaderSources?.compute || "",
    vertexShaderSource: data.shaderSources?.vertex || "",
    selectedNodeId: null,
    audioSourceType: data.audioSettings?.sourceType || "builtin",
    audioVolume: data.audioSettings?.volume ?? 0.8,
    audioGain: data.audioSettings?.gain ?? 1.2,
    audioSmoothing: data.audioSettings?.smoothing ?? 0.8,
    audioBindings: data.audioBindings || {},
    variations: data.variations || [],
    environmentSettings: {
      preset: "studio_warm",
      exposure: 1.0,
      rotation: 0.0,
      backgroundBlur: 0.0,
      showSkybox: false,
      ...(data.environmentSettings || {}),
    },
    memoryBudget: data.memoryBudget ? { ...createDefaultMemoryBudget(), ...data.memoryBudget } : createDefaultMemoryBudget(),
    activeVariationId: null,
    currentProjectName: data.name,
    currentProjectId: data.projectId ?? null,
    hasUnsavedChanges: false,
    recompileTrigger: get().recompileTrigger + 1,
    })
  },

  exportProjectData: () => {
    const state = get()
    const live = liveGraphProvider?.()
    return {
      projectId: state.currentProjectId ?? undefined,
      name: state.currentProjectName || "Untitled",
      version: "1.0" as const,
      backend: state.activeBackend,
      graphNodes: live?.nodes ?? state._graphNodes,
      graphEdges: live?.edges ?? state._graphEdges,
      uniformValues: state.uniformValues,
      graphUniforms: state.graphUniforms,
      shaderSources: {
        wgsl: state.wgslSource || undefined,
        glsl: state.glslSource || undefined,
        compute: state.computeShaderSource || undefined,
        vertex: state.vertexShaderSource || undefined,
      },
      audioSettings: {
        sourceType: state.audioSourceType,
        volume: state.audioVolume,
        gain: state.audioGain,
        smoothing: state.audioSmoothing,
      },
      audioBindings: state.audioBindings,
      variations: state.variations,
      environmentSettings: state.environmentSettings,
      memoryBudget: state.memoryBudget,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  },

  setMemoryBudget: (config) => set((state) => ({
    memoryBudget: { ...state.memoryBudget, ...config },
    hasUnsavedChanges: true,
  })),

  getMemoryBudget: () => get().memoryBudget,

  checkMemoryThreshold: (usage) => checkMemoryThreshold(usage, get().memoryBudget),
} })

// Ensure SSR / renderToStaticMarkup snapshots reflect current state
useProjectStore.getInitialState = () => useProjectStore.getState()
