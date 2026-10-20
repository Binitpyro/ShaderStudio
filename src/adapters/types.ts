import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue, EnvironmentSettings, ParsedUniform } from "@/stores/projectStore"
import type { Node, Edge } from "@xyflow/react"

export interface PerfMetrics {
  fps: number
  frameTime: number
  timestamp: number
}

export interface AudioUniforms {
  bass: number
  mid: number
  treble: number
  level: number
  beat: number
}

// ----------------------------------------------------------------------------
// R1 Contracts
// ----------------------------------------------------------------------------
export interface SubGraphPort {
  id: string
  name: string
  type: "float" | "vec2" | "vec3" | "vec4" | "color" | "sampler2D"
  direction: "input" | "output"
}

export interface SubGraphDefinition {
  id: string
  name: string
  description?: string
  inputs: SubGraphPort[]
  outputs: SubGraphPort[]
  nodes: Node[]
  edges: Edge[]
  uniforms?: ParsedUniform[]
}

export interface CustomNodeManifest {
  type: string
  title: string
  category: "math" | "filter" | "generator" | "utility" | "custom"
  inputs: Array<{ name: string; type: string }>
  outputs: Array<{ name: string; type: string }>
  parameters?: Array<{
    name: string
    type: "float" | "vec2" | "vec3" | "vec4" | "color" | "boolean"
    default: any
    ui?: "slider" | "color-picker" | "switch" | "number"
    min?: number
    max?: number
    step?: number
  }>
  glsl?: string
  wgsl?: string
  customUiComponent?: string
}

export interface MathExpressionNodeData {
  expression: string
  inputNames: string[]
  outputType: "float" | "vec2" | "vec3" | "vec4"
  error?: string | null
}

// ----------------------------------------------------------------------------
// R2 Fidelity Configurations & Contracts
// ----------------------------------------------------------------------------
export type RenderingPipelineMode = "forward" | "deferred"
export type GBufferDebugView = "none" | "albedo" | "normal" | "roughness" | "metallic" | "depth" | "motion"
export type AntiAliasingMode = "none" | "fxaa" | "taa"
export type ShadowFilterMode = "pcf" | "vsm"
export type BokehShape = "circle" | "circular" | "hexagon" | "hexagonal" | "octagon" | "octagonal"

export interface GBufferTargets {
  albedo: unknown
  normal: unknown
  roughnessMetallic: unknown
  depth: unknown
  motionVectors?: unknown
}

export interface ShadowMapConfig {
  resolution: 512 | 1024 | 2048 | 4096
  filtering: ShadowFilterMode
  bias: number
  normalBias: number
}

export interface ShadowSettings {
  enabled: boolean
  resolution: 512 | 1024 | 2048 | 4096
  filterMode: ShadowFilterMode
  bias: number
  normalBias: number
  directionalLight?: {
    enabled: boolean
    position: [number, number, number]
    target: [number, number, number]
    intensity: number
    color: [number, number, number]
    orthoSize: number
    near: number
    far: number
  }
  pointLight?: {
    enabled: boolean
    position: [number, number, number]
    intensity: number
    color: [number, number, number]
    range: number
    near: number
    far: number
  }
}

export interface SSRSettings {
  enabled: boolean
  maxSteps: number
  thickness: number
  falloff: number
  maxRoughness?: number
  iblBlend?: number
}

export interface DoFSettings {
  enabled: boolean
  focalDistance: number
  aperture: number
  bokehShape: BokehShape
  maxBlur: number
}

export interface SSAOSettings {
  enabled: boolean
  radius: number
  intensity: number
  sampleCount: number
  bias: number
}

export interface AtmosphereParams {
  timeOfDay: number // 0 - 24 hours
  sunIntensity: number
  turbidity: number
  solarElevationDeg: number
}

export interface MultiBackendParityState {
  pipelineMode: RenderingPipelineMode
  gBufferTargets: GBufferTargets | null
  shadowConfig: ShadowMapConfig
  pointShadowCubeEnabled: boolean
  postProcessState: {
    fxaa: { enabled: boolean }
    taa: { enabled: boolean; jitterSample: [number, number]; motionVectorClamp: boolean }
    dof: { enabled: boolean; focalDistance: number; aperture: number; bokehShape: BokehShape }
    ssao: { enabled: boolean; radius: number; intensity: number; sampleCount: number }
    ssr: { enabled: boolean; maxSteps: number; thickness: number; falloff: number; iblBlend: number }
  }
  atmosphereParams: AtmosphereParams
}

// ----------------------------------------------------------------------------
// R5 Contracts
// ----------------------------------------------------------------------------
export interface DetailedGpuMetrics {
  fps: number
  frameTime: number
  passTimings: {
    gbuffer?: number
    shadow?: number
    lighting?: number
    ssr?: number
    postprocess?: number
  }
  drawCalls: number
  triangles: number
  estimatedVramBytes: number
  frameTimeline: number[] // Last 60 frame times (ms)
}

export interface MemoryBudgetConfig {
  textureBudgetMB: number
  geometryBudgetMB: number
  totalVramBudgetMB: number
  warnThresholdRatio: number // default 0.8
}

// ----------------------------------------------------------------------------
// W2 Contracts (adapters wire these in W4)
// ----------------------------------------------------------------------------

/**
 * Fidelity settings owned by `useRenderSettingsStore`. The coordinator/Viewport pushes the whole
 * object to the active adapter via `applyRenderSettings`; adapters diff and apply what they support.
 */
export interface RenderSettings {
  renderMode: RenderingPipelineMode
  shadows: {
    enabled: boolean
    resolution: 512 | 1024 | 2048 | 4096
    filterMode: ShadowFilterMode
    bias: number
    normalBias: number
    /** Omnidirectional (cube) point-light shadows. */
    pointShadows: boolean
  }
  antiAliasing: AntiAliasingMode
  ssao: SSAOSettings
  ssr: SSRSettings
  dof: DoFSettings
  atmosphere: AtmosphereParams
  gbufferDebugView: GBufferDebugView
}

/** Per-frame stats an adapter reports after drawing (see `performanceTelemetry.reportFrameStats`). */
export interface FrameStats {
  drawCalls: number
  triangles: number
  passTimings?: DetailedGpuMetrics["passTimings"]
}

/** Request for a one-off GPU preview of a single node's shader (inspector thumbnails). */
export interface RenderToTargetRequest {
  nodeId: string
  source: { wgsl?: string; glsl?: string }
  width: number
  height: number
}

// ----------------------------------------------------------------------------
// Core RenderAdapter Interface
// ----------------------------------------------------------------------------
export interface RenderAdapter {
  mount(canvas: HTMLCanvasElement): Promise<boolean>
  setRenderQueue(queue: RenderQueue | null): void
  recompileShader(source: string): void
  updateUniform(name: string, value: UniformValue): void
  resize(width: number, height: number, dpr?: number): void
  setResolutionScale?(scale: 0.5 | 1 | 2 | "native"): void
  dispose(): void
  readonly backendType: "webgpu" | "webgl2" | "threejs"
  setPerfCallback?(callback: (metrics: PerfMetrics) => void): void
  updatePostProcessUniform?(nodeId: string, name: string, value: number | number[]): void
  recompileComputeShader?(source: string): void
  reseedSimulation?(): void
  updateComputeUniform?(name: string, value: number | number[]): void
  updateAudioData?(textureBuffer: Uint8Array, uniforms: AudioUniforms): void
  updateEnvironment?(settings: EnvironmentSettings): void

  /**
   * When true the adapter must NOT run its own requestAnimationFrame loop: the RenderCoordinator is
   * the single loop authority and calls `renderFrame`. Viewport sets this BEFORE `mount`.
   */
  setExternalLoopDriven?(external: boolean): void
  /** Draws one frame. `delta` is 0 while paused (adapters should skip compute/simulation steps). */
  renderFrame?(time: number, delta: number): void
  /** Applies the full fidelity settings object (renderMode, shadows, AA, SSAO/SSR/DoF, atmosphere, G-buffer view). */
  applyRenderSettings?(settings: RenderSettings): void
  /**
   * Renders `request.source` for one node into an offscreen target and returns the pixels.
   * Resolves null when unsupported or the source fails to compile.
   */
  renderToTarget?(request: RenderToTargetRequest): Promise<ImageBitmap | ImageData | null>

  // R2 Extended Methods & Parity State
  state?: MultiBackendParityState
  setRenderingPipelineMode?(mode: RenderingPipelineMode): void
  setPipelineMode?(mode: RenderingPipelineMode): void
  getPipelineMode?(): RenderingPipelineMode
  setGBufferDebugView?(view: GBufferDebugView): void
  getGBufferDebugView?(): GBufferDebugView
  getGBufferTextures?(): GBufferTargets | null
  setShadowConfig?(config: Partial<ShadowMapConfig>): void
  updateShadowSettings?(settings: Partial<ShadowSettings>): void
  getShadowSettings?(): ShadowSettings
  setPointLightShadowCube?(enabled: boolean): void
  setPostProcessEnabled?(pass: "fxaa" | "taa" | "dof" | "ssao" | "ssr", enabled: boolean, params?: any): void
  updateSSRSettings?(settings: Partial<SSRSettings>): void
  updateDoFSettings?(settings: Partial<DoFSettings>): void
  updateSSAOSettings?(settings: Partial<SSAOSettings>): void
  setAntiAliasingMode?(mode: AntiAliasingMode): void
  getAntiAliasingMode?(): AntiAliasingMode
  setAtmosphereParams?(params: { timeOfDay: number; sunIntensity?: number; turbidity?: number }): void
  calculateRayleighMieScattering?(wavelengthNm?: number[]): { rayleigh: number[]; mie: number }
}
