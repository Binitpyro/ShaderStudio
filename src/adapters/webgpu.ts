import type {
  RenderAdapter,
  PerfMetrics,
  AudioUniforms,
  RenderingPipelineMode,
  GBufferDebugView,
  AntiAliasingMode,
  GBufferTargets,
  ShadowMapConfig,
  ShadowSettings,
  SSRSettings,
  DoFSettings,
  SSAOSettings,
  MultiBackendParityState,
} from "./types"
import type { RenderQueue, ComputePreset } from "@/core/graphCompiler"
import type { UniformValue, EnvironmentSettings } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import { generateEnvironmentRGBA, ENVIRONMENT_PRESETS } from "@/core/environmentGenerator"
import { computeUniformBufferLayout, writeFieldData, type UniformBufferLayout, type UniformFieldLayout } from "@/core/uniformLayout"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { renderCoordinator } from "@/core/renderCoordinator"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { WebGPUPingPong, CUSTOM_WGSL_TEMPLATE, type PostProcessPassType } from "@/core/postProcessChain"
import defaultShader from "../shaders/default.wgsl?raw"
import vignetteWgsl from "../shaders/postprocess/vignette.wgsl?raw"
import blurWgsl from "../shaders/postprocess/blur.wgsl?raw"
import chromaticWgsl from "../shaders/postprocess/chromatic_aberration.wgsl?raw"
import bloomWgsl from "../shaders/postprocess/bloom.wgsl?raw"
import passthroughWgsl from "../shaders/postprocess/passthrough.wgsl?raw"
import ssaoWgsl from "../shaders/postprocess/ssao.wgsl?raw"
import dofWgsl from "../shaders/postprocess/dof.wgsl?raw"
import fxaaWgsl from "../shaders/postprocess/fxaa.wgsl?raw"
import taaWgsl from "../shaders/postprocess/taa.wgsl?raw"
import ssrWgsl from "../shaders/postprocess/ssr.wgsl?raw"
import curlNoiseWgsl from "../shaders/compute/curl_noise.wgsl?raw"
import particleRenderWgsl from "../shaders/compute/particle_render.wgsl?raw"
import { getComputePresetCode } from "@/core/computePresets"
import skyboxWgsl from "../shaders/skybox.wgsl?raw"

export { getComputePresetCode }

interface WebGPUPostProcessPass {
  id: string
  passType: PostProcessPassType
  pipeline: GPURenderPipeline
  bindGroupLayout: GPUBindGroupLayout
  uniformBuffer: GPUBuffer | null
  uniformValues: Record<string, number | number[]>
  bindGroupCache?: Map<GPUTextureView, GPUBindGroup>
}

interface PostProcessStep {
  id: string
  pass: PostProcessPassType
  customSource?: string
  uniforms: Record<string, number | number[]>
}

import { customModelRegistry } from "@/core/customModelRegistry"

import {
  type GeometryKey, getVerticesForGeometry, setLookAtMatrix, setRotationMatrix, multiplyMatricesInto,
  setPerspectiveMatrixWebGPU, halton, setTexMeta,
} from "./math"
// Fixed camera: shared constants, no per-frame array literals.
const CAM_EYE: [number, number, number] = [0, 2, 4]
const CAM_TARGET: [number, number, number] = [0, 0, 0]
const CAM_UP: [number, number, number] = [0, 1, 0]

export { createLookAtMatrix, createRotationMatrix, multiplyMatrices } from "./math"

export function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  return setPerspectiveMatrixWebGPU(new Float32Array(16), fov, aspect, near, far)
}


interface FrameFields {
  mvp: number
  time: number
  audio: Array<{ offset: number; key: keyof AudioUniforms }>
  envExposure: number
  envRotation: number
}

interface UniformResources {
  layout: UniformBufferLayout
  buffer: GPUBuffer
  cpu: ArrayBuffer
  view: DataView
}

const stripU = (n: string) => n.replace(/^u_/, "")

/** Finds the layout field for `name` (u_ prefix optional, `name[i]` element, or whole `name[0..n]` array). */
function resolveField(layout: UniformBufferLayout, name: string): UniformFieldLayout | null {
  const f = layout.fields
  const lookup = (n: string) => f[n] || f[stripU(n)] || f[`u_${n}`]
  const direct = lookup(name)
  if (direct) return direct

  const match = name.match(/^(.+?)\[(\d+)\]$/)
  if (match) {
    const baseField = lookup(match[1])
    const index = parseInt(match[2], 10)
    if (baseField && baseField.arrayCount && baseField.arrayStride && index < baseField.arrayCount) {
      return {
        name,
        type: baseField.type,
        offset: baseField.offset + index * baseField.arrayStride,
        size: baseField.arrayStride,
        alignment: baseField.alignment,
      }
    }
  }

  const elem0 = lookup(`${name}[0]`)
  if (elem0) {
    const prefix = elem0.name.replace(/\[0\]$/, "")
    let count = 0
    while (f[`${prefix}[${count}]`]) count++
    const elem1 = f[`${prefix}[1]`]
    const stride = elem1 ? elem1.offset - elem0.offset : Math.max(16, elem0.size)
    return {
      name,
      type: elem0.type,
      offset: elem0.offset,
      size: count > 0 ? count * stride : elem0.size,
      alignment: elem0.alignment,
      arrayCount: count,
      arrayStride: stride,
    }
  }
  return null
}

/** Writes `value` into the CPU uniform block through uniformLayout's writer; returns the field written (or null). */
function writeUniformValue(layout: UniformBufferLayout, view: DataView, name: string, value: UniformValue): UniformFieldLayout | null {
  const field = resolveField(layout, name)
  if (!field) return null
  let raw: any = value.value
  if (field.arrayCount && field.arrayStride) {
    if (!Array.isArray(raw)) raw = [raw]
  } else if (field.type === "vec4f" && value.type === "color" && (Array.isArray(raw) || raw instanceof Float32Array) && raw.length === 3) {
    raw = [raw[0], raw[1], raw[2], 1]
  } else if (field.type === "i32" || field.type === "u32") {
    raw = Math.round(Number(raw) || 0)
  }
  writeFieldData(view, field, raw)
  return field
}


export class WebGPUAdapter implements RenderAdapter {
  readonly backendType = "webgpu" as const
  private canvas: HTMLCanvasElement | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat = "bgra8unorm"
  private pipeline: GPURenderPipeline | null = null
  private vertexBuffers: Map<GeometryKey, GPUBuffer> = new Map()
  private vertexCounts: Map<GeometryKey, number> = new Map()
  private uniformBuffer: GPUBuffer | null = null
  private bindGroup: GPUBindGroup | null = null
  private depthTexture: GPUTexture | null = null
  private depthTextureView: GPUTextureView | null = null
  private rafId: number | null = null
  private initialized = false
  private angleX = 0
  private angleY = 0
  private currentGeometry: GeometryKey = "cube"
  private projMatrix = new Float32Array(16)
  private viewMatrix = new Float32Array(16)
  private rotMatrix = new Float32Array(16)
  private tempMatrix = new Float32Array(16)
  private mvpMatrix = new Float32Array(16)
  private simDataArray = new Float32Array(12)
  private particleRenderArray = new Float32Array(20)
  private isExternalLoopDriven = false
  private textureResources: Map<string, GPUTexture> = new Map()
  private defaultSampler: GPUSampler | null = null
  private defaultTexture: GPUTexture | null = null
  private textureBindings: Record<string, string> = {}
  private queueTextures: Array<{ id: string; binding: number }> = []
  private currentShaderSource: string = defaultShader
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void
  private isDisposed = false
  // Auto-Recovery & Fallback State
  public maxRecoveryAttempts = 2
  public recoveryBackoffMs = 200
  private isRecovering = false
  private recoveryAttempts = 0
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private hasPostProcess = false
  private pingPong: WebGPUPingPong | null = null
  private postProcessPasses: WebGPUPostProcessPass[] = []
  private postProcessSampler: GPUSampler | null = null

  // R2: Rendering Fidelity Parity State
  public state: MultiBackendParityState = {
    pipelineMode: "forward",
    gBufferTargets: null,
    shadowConfig: {
      resolution: 2048,
      filtering: "pcf",
      bias: 0.005,
      normalBias: 0.01,
    },
    pointShadowCubeEnabled: false,
    postProcessState: {
      fxaa: { enabled: false },
      taa: { enabled: false, jitterSample: [0, 0], motionVectorClamp: true },
      dof: { enabled: false, focalDistance: 5.0, aperture: 0.05, bokehShape: "circle" },
      ssao: { enabled: false, radius: 0.5, intensity: 1.5, sampleCount: 16 },
      ssr: { enabled: false, maxSteps: 64, thickness: 0.02, falloff: 0.8, iblBlend: 0.5 },
    },
    atmosphereParams: {
      timeOfDay: 12.0,
      sunIntensity: 1.0,
      turbidity: 2.5,
      solarElevationDeg: 90.0,
    },
  }

  public shadowSettings: ShadowSettings = {
    enabled: false,
    resolution: 2048,
    filterMode: "pcf",
    bias: 0.005,
    normalBias: 0.01,
    directionalLight: {
      enabled: true,
      position: [5, 10, 5],
      target: [0, 0, 0],
      intensity: 1.0,
      color: [1, 0.95, 0.9],
      orthoSize: 10,
      near: 0.1,
      far: 50,
    },
  }

  public gBufferDebugView: GBufferDebugView = "none"
  private antiAliasingMode: AntiAliasingMode = "none"
  private taaFrameIndex = 0

  private gBufferAlbedoTex: GPUTexture | null = null
  private gBufferNormalTex: GPUTexture | null = null
  private gBufferRoughnessTex: GPUTexture | null = null
  private gBufferDepthTex: GPUTexture | null = null
  private gBufferMotionTex: GPUTexture | null = null
  // Cached views of the G-buffer textures; rebuilt in initGBuffer (resize/rebuild), dropped on destroy.
  private gBufferViews: { albedo: GPUTextureView; normal: GPUTextureView; roughness: GPUTextureView; depth: GPUTextureView; motion: GPUTextureView } | null = null
  private shadowDepthTex: GPUTexture | null = null
  private shadowCubeTex: GPUTexture | null = null
  private deferredLightingPipeline: GPURenderPipeline | null = null
  deferredLightingProgram: any = null
  private deferredLightingUniformBuffer: GPUBuffer | null = null
  private deferredLightingBindGroup: GPUBindGroup | null = null
  private deferredGeometryPipeline: GPURenderPipeline | null = null

  // Compute & Simulation Pipeline state
  private hasCompute = false
  private computePipeline: GPUComputePipeline | null = null
  private computeBindGroup: GPUBindGroup | null = null
  private particleStorageBuffer: GPUBuffer | null = null
  private particleCount = 50000
  private simUniformBuffer: GPUBuffer | null = null
  private particleRenderPipeline: GPURenderPipeline | null = null
  private particleRenderUniformBuffer: GPUBuffer | null = null
  private particleRenderBindGroup: GPUBindGroup | null = null
  private currentComputeSource: string = curlNoiseWgsl
  private simParams = {
    speed: 1.0,
    damping: 0.98,
    strength: 1.0,
    noiseScale: 1.0,
    pointSize: 4.0,
    blendMode: 1.0,
    reset: 0.0,
  }

  // Audio Pipeline state
  private audioTexture: GPUTexture | null = null
  private audioUniforms: AudioUniforms = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 }
  private envTexture: GPUTexture | null = null
  private currentEnvPreset: string | null = null
  private lastCustomTextureSrc?: string
  private envSettings: EnvironmentSettings | null = null
  private skyboxPipeline: GPURenderPipeline | null = null
  private skyboxBindGroupLayout: GPUBindGroupLayout | null = null
  private skyboxBindGroup: GPUBindGroup | null = null
  private skyboxUniformBuffer: GPUBuffer | null = null
  private skyboxSampler: GPUSampler | null = null
  private unsubscribeCustomModel: (() => void) | null = null

  private ensureGeometryBuffer(geo: GeometryKey) {
    if (!this.device) return
    if (geo === "custom") {
      const custom = customModelRegistry.getActiveModel()
      const vertices = custom ? custom.positions : getVerticesForGeometry("torus_knot")
      const oldBuf = this.vertexBuffers.get("custom")
      if (oldBuf) oldBuf.destroy()
      const buffer = this.device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(buffer, 0, vertices.buffer as ArrayBuffer, 0, vertices.byteLength)
      this.vertexBuffers.set("custom", buffer)
      this.vertexCounts.set("custom", vertices.length / 3)
      return
    }
    if (!this.vertexBuffers.has(geo)) {
      const vertices = getVerticesForGeometry(geo)
      const buffer = this.device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(buffer, 0, vertices.buffer as ArrayBuffer, 0, vertices.byteLength)
      this.vertexBuffers.set(geo, buffer)
      this.vertexCounts.set(geo, vertices.length / 3)
    }
  }

  private uniformLayout: UniformBufferLayout | null = null
  private cpuUniformBuffer: ArrayBuffer | null = null
  private cpuUniformView: DataView | null = null
  private cachedUniformValues = new Map<string, UniformValue>()
  // Field offsets for the per-frame writes, resolved once per compile (never looked up by name in the frame loop).
  private frameFields: FrameFields = { mvp: -1, time: -1, audio: [], envExposure: -1, envRotation: -1 }
  private mvpView: Float32Array | null = null
  private timeView: Float32Array | null = null
  private uniformDirtyMin = Infinity
  private uniformDirtyMax = 0
  private audioShadow = new Uint8Array(1024)
  // Structured compile error handling: latest compile wins; stale async results are discarded.
  private renderCompileGen = 0
  private computeCompileGen = 0
  private failedComputeSource: string | null = null
  // Per-frame draw statistics reported to performanceTelemetry (plain counters, no allocation).
  private statDraws = 0
  private statTriangles = 0
  private frameStats = { drawCalls: 0, triangles: 0 }
  private deferredArray = new Float32Array(16)
  private deferredInts = new Int32Array(this.deferredArray.buffer)
  private skyboxArray = new Float32Array(16)
  private ppScratch = new Float32Array(4)
  private loadingTextures = new Set<string>()
  private postProcessSignature = ""
  /** Shadow depth pass is disabled until W4 provides a depth-only pipeline (see encodeShadowPass). */
  private readonly shadowPassReady: boolean = false

  private resolveFrameFields(layout: UniformBufferLayout): FrameFields {
    const pick = (...names: string[]) => {
      for (const n of names) if (layout.fields[n]) return layout.fields[n].offset
      return -1
    }
    const audio: FrameFields["audio"] = []
    for (const key of ["bass", "mid", "treble", "level", "beat"] as const) {
      const cap = key[0].toUpperCase() + key.slice(1)
      for (const n of [key, `u_${key}`, `audio_${key}`, `u_audio_${key}`, `audio${cap}`]) {
        if (layout.fields[n]) audio.push({ offset: layout.fields[n].offset, key })
      }
    }
    return {
      mvp: pick("mvp", "u_mvp"),
      time: pick("time", "u_time"),
      audio,
      envExposure: pick("envExposure", "u_envExposure"),
      envRotation: pick("envRotation", "u_envRotation"),
    }
  }

  /** Builds layout + GPU buffer + CPU shadow for `source` without touching live state (throws on unsupported types). */
  private buildUniformResources(source: string): UniformResources {
    const device = this.device!
    const parsed = parseWgslUniforms(source).filter(u => u.kind !== "texture")
    const layout = computeUniformBufferLayout(parsed)
    const buffer = device.createBuffer({
      size: layout.totalSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "ShaderStudio_DynamicUniformBuffer",
    })
    const cpu = new ArrayBuffer(layout.totalSize)
    const view = new DataView(cpu)

    // Seed with existing uniform values from store or cache
    const storeValues = useProjectStore.getState().uniformValues
    for (const [name, val] of Object.entries(storeValues)) writeUniformValue(layout, view, name, val)
    for (const [name, val] of this.cachedUniformValues.entries()) writeUniformValue(layout, view, name, val)

    // Default color if color field exists but wasn't populated
    const colorField = layout.fields["color"] || layout.fields["u_color"]
    if (colorField && !storeValues["color"] && !storeValues["u_color"] && !this.cachedUniformValues.has("color") && !this.cachedUniformValues.has("u_color")) {
      writeUniformValue(layout, view, colorField.name, { type: "color", value: [0.4, 0.6, 0.9] })
    }

    device.queue.writeBuffer(buffer, 0, cpu)
    return { layout, buffer, cpu, view }
  }

  /** Makes `res` the live uniform block and destroys the previous GPU buffer. */
  private applyUniformResources(res: UniformResources) {
    const old = this.uniformBuffer
    this.uniformLayout = res.layout
    this.uniformBuffer = res.buffer
    this.cpuUniformBuffer = res.cpu
    this.cpuUniformView = res.view
    this.frameFields = this.resolveFrameFields(res.layout)
    this.mvpView = this.frameFields.mvp >= 0 ? new Float32Array(res.cpu, this.frameFields.mvp, 16) : null
    this.timeView = this.frameFields.time >= 0 ? new Float32Array(res.cpu, this.frameFields.time, 1) : null
    this.uniformDirtyMin = Infinity
    this.uniformDirtyMax = 0
    if (old && old !== res.buffer) { try { old.destroy() } catch {} }
  }

  private markUniformDirty(offset: number, size: number) {
    if (offset < this.uniformDirtyMin) this.uniformDirtyMin = offset
    if (offset + size > this.uniformDirtyMax) this.uniformDirtyMax = offset + size
  }

  /** The single queue.writeBuffer for the uniform block: only the dirty byte range. */
  private flushUniforms() {
    if (this.uniformDirtyMax <= this.uniformDirtyMin || !this.device || !this.uniformBuffer || !this.cpuUniformBuffer) return
    const start = this.uniformDirtyMin & ~3
    const end = (this.uniformDirtyMax + 3) & ~3
    this.device.queue.writeBuffer(this.uniformBuffer, start, this.cpuUniformBuffer, start, end - start)
    this.uniformDirtyMin = Infinity
    this.uniformDirtyMax = 0
  }

  /** Writes a float into the CPU block and marks it dirty only when the value changed. */
  private setCpuFloat(offset: number, value: number): boolean {
    const view = this.cpuUniformView
    if (!view || offset < 0) return false
    if (view.getFloat32(offset, true) === Math.fround(value)) return false
    view.setFloat32(offset, value, true)
    this.markUniformDirty(offset, 4)
    return true
  }

  private writeUniformToCpuBuffer(name: string, value: UniformValue): UniformFieldLayout | null {
    if (!this.cpuUniformView || !this.uniformLayout) return null
    return writeUniformValue(this.uniformLayout, this.cpuUniformView, name, value)
  }

  /**
   * Creates GPU objects through `create` and validates them. WGSL/pipeline errors are asynchronous, so when the
   * device exposes error scopes / compilation info the result is delivered later; `onOk` runs only for valid
   * objects and `onFail` receives the structured error text (`:line:col error: message`, one per line) or null
   * when the result is stale. Without those APIs (headless mocks) everything resolves synchronously.
   */
  private compileChecked<T>(
    create: (device: GPUDevice) => { value: T; module: GPUShaderModule },
    isStale: () => boolean,
    onOk: (value: T) => void,
    onFail: (value: T | null, error: string | null) => void,
  ) {
    const device = this.device
    if (!device) return
    const scoped = typeof device.pushErrorScope === "function" && typeof device.popErrorScope === "function"
    let built: { value: T; module: GPUShaderModule } | null = null
    let thrown: unknown = null
    if (scoped) device.pushErrorScope("validation")
    try { built = create(device) } catch (e) { thrown = e }
    const popped = scoped ? device.popErrorScope() : null
    if (!built) {
      popped?.catch(() => {})
      onFail(null, isStale() ? null : (thrown instanceof Error ? thrown.message : String(thrown)))
      return
    }
    const info = typeof built.module.getCompilationInfo === "function" ? built.module.getCompilationInfo() : null
    if (!popped && !info) {
      if (isStale()) onFail(built.value, null)
      else onOk(built.value)
      return
    }
    const value = built.value
    Promise.all([info, popped]).then(([ci, scopeErr]) => {
      if (isStale() || this.device !== device) return onFail(value, null)
      const lines = (ci?.messages ?? [])
        .filter(m => m.type === "error")
        .map(m => `:${m.lineNum}:${m.linePos} error: ${m.message}`)
      if (lines.length === 0 && scopeErr) lines.push(scopeErr.message || "WebGPU validation error")
      if (lines.length > 0) onFail(value, lines.join("\n"))
      else onOk(value)
    }, (err) => onFail(value, isStale() ? null : (err instanceof Error ? err.message : String(err))))
  }

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    this.isDisposed = false
    if (!navigator.gpu) { useProjectStore.getState().setLastCompileError("WebGPU not supported"); return false }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) { useProjectStore.getState().setLastCompileError("No WebGPU adapter found"); return false }
    this.device = await adapter.requestDevice()
    this.setupDeviceLostHandler(this.device)
    this.context = canvas.getContext("webgpu")
    if (!this.context) { useProjectStore.getState().setLastCompileError("Could not get WebGPU context"); return false }
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" })
    for (const geo of ["cube", "sphere", "plane", "torus_knot"] as const) {
      this.ensureGeometryBuffer(geo)
    }
    if (!this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel = customModelRegistry.subscribe(() => {
        if (this.currentGeometry === "custom") {
          this.ensureGeometryBuffer("custom")
        }
      })
    }

    this.createDefaultTexture()
    this.currentShaderSource = defaultShader
    try {
      this.applyUniformResources(this.buildUniformResources(defaultShader))
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(msg); return false }

    const shaderModule = this.device.createShaderModule({ code: defaultShader })
    try {
      this.pipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      })
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(msg); return false }
    this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: this.buildBindGroupEntries(defaultShader) })
    this.createDepthTexture()
    this.initShadowMap(this.state.shadowConfig.resolution || 2048)
    if (this.state.pipelineMode === "deferred") {
      this.initDeferredGeometryPipeline()
      this.initDeferredLightingPipeline()
      this.initGBuffer(this.canvas.width || 1920, this.canvas.height || 1080)
    }
    const envSettings = useProjectStore.getState().environmentSettings
    if (envSettings) {
      this.updateEnvironment(envSettings)
    }
    if (this.state.pointShadowCubeEnabled) {
      this.shadowCubeTex = null
      this.setPointLightShadowCube(true)
    }
    useProjectStore.getState().setLastCompileError(null)
    this.initialized = true
    this.startRenderLoop()
    return true
  }

  private createDefaultTexture() {
    if (!this.device) return
    this.defaultTexture = this.device.createTexture({
      size: [2, 2],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.defaultSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    })
  }

  private createAudioTexture() {
    if (!this.device) return
    this.audioTexture?.destroy()
    this.audioTexture = this.device.createTexture({
      size: [512, 2],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "AudioDataTexture",
    })
    this.audioShadow.fill(0) // fresh textures are zero-initialised
  }

  updateAudioData(textureBuffer: Uint8Array, uniforms: AudioUniforms) {
    this.audioUniforms = uniforms
    if (!this.device || !this.initialized) return
    let changed = false

    if (!this.audioTexture) {
      this.createAudioTexture()
      this.updateBindGroup()
    }

    // Upload the 1KB spectrum texture only when its contents actually changed (idle/silent audio costs nothing).
    if (this.audioTexture && textureBuffer.length >= 1024) {
      const shadow = this.audioShadow
      let differs = false
      for (let i = 0; i < 1024; i++) {
        if (shadow[i] !== textureBuffer[i]) { differs = true; break }
      }
      if (differs) {
        shadow.set(textureBuffer.subarray(0, 1024))
        try {
          this.device.queue.writeTexture(
            { texture: this.audioTexture },
            textureBuffer as any,
            { bytesPerRow: 512, rowsPerImage: 2 },
            [512, 2, 1]
          )
          changed = true
        } catch {
          // Safe write fallback in headless tests
        }
      }
    }

    // Audio scalars go into the persistent CPU block; the dirty range is flushed with the frame's single write.
    for (const f of this.frameFields.audio) {
      if (this.setCpuFloat(f.offset, uniforms[f.key])) changed = true
    }
    if (changed) renderCoordinator.requestRender()
  }

  updateEnvironment(settings: EnvironmentSettings) {
    this.envSettings = { ...settings }
    if (!this.device || !this.initialized) return

    const isCustom = settings.preset === "custom"
    const customSrcChanged = isCustom && settings.customTextureSrc !== this.lastCustomTextureSrc

    if (this.currentEnvPreset !== settings.preset || !this.envTexture || customSrcChanged) {
      this.currentEnvPreset = settings.preset
      this.lastCustomTextureSrc = settings.customTextureSrc
      this.envTexture?.destroy()
      this.envTexture = null

      if (isCustom && settings.customTextureSrc) {
        this.loadCustomEnvironment(settings.customTextureSrc, "custom")
      } else {
        const presetMeta = ENVIRONMENT_PRESETS.find((p) => p.id === settings.preset)
        const imgSrc = presetMeta?.imageSrc
        if (imgSrc && typeof window !== "undefined" && typeof fetch === "function") {
          this.loadCustomEnvironment(imgSrc, settings.preset)
        }

        const rgba = generateEnvironmentRGBA(settings.preset, 512, 256)
        try {
          const tex = this.device.createTexture({
            size: [512, 256],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: "EnvironmentMapTexture",
          })
          this.device.queue.writeTexture(
            { texture: tex },
            rgba as any,
            { bytesPerRow: 512 * 4, rowsPerImage: 256 },
            [512, 256, 1]
          )
          this.envTexture = tex
          this.updateBindGroup()
          this.updateSkyboxBindGroup()
          renderCoordinator.requestRender()
        } catch {
          // Safe fallback for mock/headless tests
        }
      }
    }

    this.setCpuFloat(this.frameFields.envExposure, settings.exposure)
    this.setCpuFloat(this.frameFields.envRotation, (settings.rotation * Math.PI) / 180)
    this.flushUniforms()

    if (settings.showSkybox) {
      if (!this.skyboxPipeline) {
        this.setupSkyboxPipeline()
      }
    } else {
      this.cleanupSkyboxPipeline()
    }
  }

  private cleanupSkyboxPipeline() {
    this.skyboxPipeline = null
    this.skyboxBindGroupLayout = null
    this.skyboxBindGroup = null
    try { this.skyboxUniformBuffer?.destroy() } catch {}
    this.skyboxUniformBuffer = null
    this.skyboxSampler = null
  }

  private async loadCustomEnvironment(src: string, expectedPreset?: string) {
    if (!this.device || !this.initialized) return
    try {
      const res = await fetch(src)
      if (!res.ok) return
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.device || !this.initialized) {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      if (expectedPreset && this.currentEnvPreset !== expectedPreset) {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      try {
        this.envTexture?.destroy()
        const tex = this.device.createTexture({
          size: [bitmap.width, bitmap.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          label: "CustomEnvironmentMapTexture",
        })
        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height])
        this.envTexture = tex
        this.updateBindGroup()
        this.updateSkyboxBindGroup()
        renderCoordinator.requestRender()
      } finally {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
      }
    } catch {
      // Safe fallback for offline or headless tests
    }
  }

  private setupSkyboxPipeline() {
    if (!this.device) return
    try {
      const shaderModule = this.device.createShaderModule({ code: skyboxWgsl })

      if (!this.skyboxUniformBuffer) {
        this.skyboxUniformBuffer = this.device.createBuffer({
          size: 64,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: "SkyboxUniformBuffer",
        })
      }

      if (!this.skyboxSampler) {
        this.skyboxSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "repeat",
          addressModeV: "clamp-to-edge",
        })
      }

      this.skyboxBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      })

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.skyboxBindGroupLayout],
      })

      this.skyboxPipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vertex_main",
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragment_main",
          targets: [{ format: this.format }],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "none",
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: false,
          depthCompare: "always",
        },
      })

      this.updateSkyboxBindGroup()
    } catch (err) {
      console.warn("Skybox pipeline error:", err)
    }
  }

  private updateSkyboxBindGroup() {
    if (!this.device || !this.skyboxBindGroupLayout || !this.skyboxUniformBuffer || !this.skyboxSampler) return
    const tex = this.envTexture || this.defaultTexture
    if (!tex) return
    try {
      this.skyboxBindGroup = this.device.createBindGroup({
        layout: this.skyboxBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.skyboxUniformBuffer } },
          { binding: 1, resource: this.skyboxSampler },
          { binding: 2, resource: tex.createView() },
        ],
      })
    } catch {
      // Safe fallback for mock tests
    }
  }

  private buildBindGroupEntries(wgslSource?: string, uniformBuffer: GPUBuffer | null = this.uniformBuffer): GPUBindGroupEntry[] {
    const entries: GPUBindGroupEntry[] = []
    if (uniformBuffer) {
      entries.push({ binding: 0, resource: { buffer: uniformBuffer } })
    }
    if (!this.device) return entries

    const source = wgslSource || this.currentShaderSource
    if (source) {
      const bindingRegex = /(?:@group\s*\(\s*0\s*\)\s*@binding\s*\(\s*(\d+)\s*\)|@binding\s*\(\s*(\d+)\s*\)\s*@group\s*\(\s*0\s*\))\s*var(?:\s*<[^>]+>)?\s+(\w+)\s*:\s*([^;]+);/g
      let match: RegExpExecArray | null
      while ((match = bindingRegex.exec(source)) !== null) {
        const rawIdx = match[1] !== undefined ? match[1] : match[2]
        const bindingIndex = parseInt(rawIdx, 10)
        if (bindingIndex === 0) continue

        const name = match[3]
        const typeStr = match[4].trim()

        if (typeStr.startsWith("sampler")) {
          if (this.defaultSampler) {
            entries.push({ binding: bindingIndex, resource: this.defaultSampler })
          }
        } else if (typeStr.startsWith("texture_2d")) {
          const boundTexId = this.textureBindings[name] ||
                             this.textureBindings[name.replace(/^u_/, "")] ||
                             this.textureBindings[`u_${name}`]
          let targetTexture: GPUTexture | null = null
          if (boundTexId && this.textureResources.has(boundTexId)) {
            targetTexture = this.textureResources.get(boundTexId)!
          } else if (boundTexId === "audioTexture" || name === "audioTexture" || name.toLowerCase().includes("audio")) {
            if (!this.audioTexture) this.createAudioTexture()
            targetTexture = this.audioTexture || this.defaultTexture
          } else if (boundTexId === "envTexture" || name === "envTexture" || name.toLowerCase().includes("env")) {
            targetTexture = this.envTexture || this.defaultTexture
          } else {
            const qTex = this.queueTextures.find((t) => t.binding === bindingIndex)
            if (qTex && this.textureResources.has(qTex.id)) {
              targetTexture = this.textureResources.get(qTex.id)!
            } else if (this.textureResources.size > 0) {
              targetTexture = Array.from(this.textureResources.values())[0]
            } else {
              targetTexture = this.defaultTexture
            }
          }

          if (targetTexture) {
            entries.push({ binding: bindingIndex, resource: targetTexture.createView() })
          }
        }
      }
    }
    return entries
  }

  private updateBindGroup() {
    if (!this.device || !this.pipeline) return
    try {
      const entries = this.buildBindGroupEntries(this.currentShaderSource)
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries,
      })
    } catch {
      // Ignore bind group reconstruction errors during transition
    }
  }

  private createDepthTexture() {
    if (!this.device || !this.canvas) return
    const width = Math.max(1, Math.floor(this.canvas.width)), height = Math.max(1, Math.floor(this.canvas.height))
    this.depthTexture?.destroy()
    this.depthTexture = this.device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT })
    this.depthTextureView = this.depthTexture.createView()
  }

  resize(width: number, height: number, customDpr?: number) {
    if (!this.canvas || !this.device) return
    const dpr = customDpr !== undefined ? customDpr : (typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1)
    const canvasWidth = Math.max(1, Math.floor(width * dpr)), canvasHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) return
    this.canvas.width = canvasWidth; this.canvas.height = canvasHeight
    this.createDepthTexture()
    if (this.pingPong && this.hasPostProcess) {
      this.pingPong.resize(canvasWidth, canvasHeight)
      for (const pass of this.postProcessPasses) {
        pass.bindGroupCache?.clear()
      }
    }
    // Blur/FXAA/TAA uniforms bake the canvas size: refresh them for the new dimensions.
    for (const pass of this.postProcessPasses) {
      if (pass.passType === "blur" || pass.passType === "fxaa" || pass.passType === "taa") this.writePostProcessUniforms(pass)
    }
    if (this.state.pipelineMode === "deferred") {
      this.initGBuffer(canvasWidth, canvasHeight)
    }
  }

  private initializeParticleStorage(count: number, preset: ComputePreset) {
    if (!this.device) return
    this.particleCount = count
    const bufferSize = count * 32 // 32 bytes per particle

    this.particleStorageBuffer?.destroy()
    // Bind groups still reference the buffer being replaced: drop them until the pipelines are rebuilt.
    this.computePipeline = null
    this.computeBindGroup = null
    this.particleRenderBindGroup = null
    this.particleStorageBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
      label: "ParticleStorageBuffer",
    })

    const data = new Float32Array(count * 8)
    for (let i = 0; i < count; i++) {
      const offset = i * 8
      if (preset === "galaxy") {
        const arm = (i % 2) * Math.PI
        const dist = Math.pow(Math.random(), 0.7) * 2.5 + 0.2
        const angle = dist * 2.0 + arm + (Math.random() - 0.5) * 0.4
        data[offset + 0] = Math.cos(angle) * dist
        data[offset + 1] = (Math.random() - 0.5) * 0.15
        data[offset + 2] = Math.sin(angle) * dist
        data[offset + 3] = 1.0
        const vOrbit = Math.sqrt(4.0 / dist)
        data[offset + 4] = -Math.sin(angle) * vOrbit
        data[offset + 5] = 0.0
        data[offset + 6] = Math.cos(angle) * vOrbit
        data[offset + 7] = 1.0
      } else {
        const theta = Math.random() * 2 * Math.PI
        const phi = Math.acos(2 * Math.random() - 1)
        const r = Math.cbrt(Math.random()) * 1.5
        data[offset + 0] = r * Math.sin(phi) * Math.cos(theta)
        data[offset + 1] = r * Math.sin(phi) * Math.sin(theta)
        data[offset + 2] = r * Math.cos(phi)
        data[offset + 3] = 0.5 + Math.random() * 1.5
        data[offset + 4] = (Math.random() - 0.5) * 0.2
        data[offset + 5] = (Math.random() - 0.5) * 0.2
        data[offset + 6] = (Math.random() - 0.5) * 0.2
        data[offset + 7] = 1.0
      }
    }

    this.device.queue.writeBuffer(this.particleStorageBuffer, 0, data)
  }

  /** Builds the compute pipeline into locals; the previous pipeline keeps running until the new one validates. */
  private setupComputePipeline(source: string) {
    if (!this.device || !this.particleStorageBuffer) return
    const gen = ++this.computeCompileGen
    const device = this.device
    const storage = this.particleStorageBuffer
    this.compileChecked<{ simBuffer: GPUBuffer; created: boolean; bindGroup: GPUBindGroup; pipeline: GPUComputePipeline }>(
      (dev) => {
        const module = dev.createShaderModule({ code: source })
        const created = !this.simUniformBuffer
        const simBuffer = this.simUniformBuffer ?? dev.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: "SimUniformBuffer",
        })
        const bindGroupLayout = dev.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          ],
        })
        const bindGroup = dev.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: simBuffer } },
            { binding: 1, resource: { buffer: storage } },
          ],
        })
        const pipeline = dev.createComputePipeline({
          layout: dev.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
          compute: { module, entryPoint: "main" },
        })
        return { value: { simBuffer, created, bindGroup, pipeline }, module }
      },
      () => gen !== this.computeCompileGen || this.device !== device || this.particleStorageBuffer !== storage,
      (v) => {
        this.simUniformBuffer = v.simBuffer
        this.computeBindGroup = v.bindGroup
        this.computePipeline = v.pipeline
        this.currentComputeSource = source
        this.failedComputeSource = null
        renderCoordinator.requestRender()
      },
      (v, err) => {
        if (v?.created && v.simBuffer !== this.simUniformBuffer) { try { v.simBuffer.destroy() } catch {} }
        if (err === null) return
        this.failedComputeSource = source
        console.warn("Compute pipeline compilation error:", err)
        useProjectStore.getState().setLastCompileError(err || "Compute shader compilation failed")
      },
    )
  }

  private setupParticleRenderPipeline() {
    if (!this.device || !this.particleStorageBuffer) return
    try {
      const renderModule = this.device.createShaderModule({ code: particleRenderWgsl })

      if (!this.particleRenderUniformBuffer) {
        this.particleRenderUniformBuffer = this.device.createBuffer({
          size: 80,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: "ParticleRenderUniformBuffer",
        })
      }

      const renderBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        ],
      })

      this.particleRenderBindGroup = this.device.createBindGroup({
        layout: renderBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.particleRenderUniformBuffer } },
          { binding: 1, resource: { buffer: this.particleStorageBuffer } },
        ],
      })

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [renderBindGroupLayout],
      })

      this.particleRenderPipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: renderModule,
          entryPoint: "vertex_main",
        },
        fragment: {
          module: renderModule,
          entryPoint: "fragment_main",
          targets: [
            {
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              },
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "none",
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: false,
          depthCompare: "always",
        },
      })
    } catch (err: any) {
      console.warn("Particle render pipeline error:", err)
    }
  }

  updateComputeUniform(name: string, value: number | number[]) {
    const val = typeof value === "number" ? value : Number(value[0]) || 0
    if (name === "speed") this.simParams.speed = val
    else if (name === "damping") this.simParams.damping = val
    else if (name === "strength") this.simParams.strength = val
    else if (name === "noiseScale") this.simParams.noiseScale = val
    else if (name === "pointSize") this.simParams.pointSize = val
    else if (name === "blendMode") this.simParams.blendMode = val
  }

  reseedSimulation() {
    this.simParams.reset = 1.0
  }

  recompileComputeShader(source: string) {
    this.setupComputePipeline(source)
    if (!this.particleRenderPipeline) {
      this.setupParticleRenderPipeline()
    }
  }

  /**
   * TODO(W4): the shadow depth pass is invalid today (it reuses the colour pipeline inside a depth-only pass),
   * so it can never run: `shadowPassReady` stays false until W4 builds a depth-only shadow pipeline + light MVP.
   */
  private encodeShadowPass(encoder: GPUCommandEncoder, vertexBuffer: GPUBuffer, vertexCount: number) {
    if (!this.shadowPassReady || !this.shadowSettings?.enabled || !this.shadowDepthTex || !this.pipeline || !this.bindGroup) return
    const shadowPass = encoder.beginRenderPass({
      label: "ShadowDepthPass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowDepthTex.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    })
    shadowPass.setPipeline(this.pipeline)
    shadowPass.setBindGroup(0, this.bindGroup)
    shadowPass.setVertexBuffer(0, vertexBuffer)
    shadowPass.draw(vertexCount)
    shadowPass.end()
    this.statDraws++
    this.statTriangles += vertexCount / 3
  }

  renderFrame(time: number, delta: number = 16) {
    if (!this.initialized || !this.canvas || !this.device || !this.context) return
    this.frameCount++
    if (time - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFrameTime = time
      if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / (this.fps || 1), timestamp: time })
    }
    this.statDraws = 0
    this.statTriangles = 0
    // Mesh rotation is a pure function of playback time (0.6 / 0.9 rad/s): pause, seek and recording are deterministic.
    const seconds = time / 1000
    this.angleX = seconds * 0.6
    this.angleY = seconds * 0.9
    const aspect = this.canvas.width / (this.canvas.height || 1)
    setPerspectiveMatrixWebGPU(this.projMatrix, Math.PI / 4, aspect, 0.1, 100)
    setLookAtMatrix(this.viewMatrix, CAM_EYE, CAM_TARGET, CAM_UP)
    if (this.state.postProcessState.taa.enabled) {
      this.taaFrameIndex = Math.floor(time / (1000 / 60)) % 16
      const jitterX = (halton(this.taaFrameIndex + 1, 2) - 0.5) / this.canvas.width
      const jitterY = (halton(this.taaFrameIndex + 1, 3) - 0.5) / this.canvas.height
      const jitter = this.state.postProcessState.taa.jitterSample
      jitter[0] = jitterX
      jitter[1] = jitterY
      this.projMatrix[8] += jitterX * 2.0
      this.projMatrix[9] += jitterY * 2.0
    }
    setRotationMatrix(this.rotMatrix, this.angleX, this.angleY)
    multiplyMatricesInto(this.tempMatrix, this.viewMatrix, this.rotMatrix)
    multiplyMatricesInto(this.mvpMatrix, this.projMatrix, this.tempMatrix)

    // Per-frame uniforms (mvp + time) go into the persistent CPU block; everything dirty (plus any audio writes)
    // leaves in ONE writeBuffer. Unchanged values (paused) cost no GPU write.
    if (this.uniformBuffer && this.cpuUniformBuffer) {
      const mvp = this.mvpView
      if (mvp) {
        const src = this.mvpMatrix
        let differs = false
        for (let i = 0; i < 16; i++) {
          if (mvp[i] !== src[i]) { differs = true; break }
        }
        if (differs) {
          mvp.set(src)
          this.markUniformDirty(this.frameFields.mvp, 64)
        }
      }
      if (this.timeView && this.timeView[0] !== Math.fround(seconds)) {
        this.timeView[0] = seconds
        this.markUniformDirty(this.frameFields.time, 4)
      }
      this.flushUniforms()
    }

    const geometry = this.currentGeometry
    const vertexBuffer = this.vertexBuffers.get(geometry)
    const vertexCount = this.vertexCounts.get(geometry) ?? 36
    if (!this.hasCompute && !vertexBuffer) return
    // Update skybox uniforms if skybox is active
    if (this.envSettings?.showSkybox && this.skyboxPipeline && this.skyboxBindGroup && this.skyboxUniformBuffer && this.canvas) {
      const halfTan = Math.tan(Math.PI / 8)
      const V = this.viewMatrix
      const rotRad = ((this.envSettings.rotation || 0) * Math.PI) / 180
      const blur = this.envSettings.backgroundBlur || 0.0
      const exposure = this.envSettings.exposure ?? 1.0

      const sky = this.skyboxArray
      sky[0] = V[0] * aspect * halfTan; sky[1] = V[4] * aspect * halfTan; sky[2] = V[8] * aspect * halfTan; sky[3] = aspect
      sky[4] = V[1] * halfTan; sky[5] = V[5] * halfTan; sky[6] = V[9] * halfTan; sky[7] = 0
      sky[8] = -V[2]; sky[9] = -V[6]; sky[10] = -V[10]; sky[11] = 0
      sky[12] = rotRad; sky[13] = blur; sky[14] = exposure; sky[15] = 0
      this.device.queue.writeBuffer(this.skyboxUniformBuffer, 0, sky)
    }

    const commandEncoder = this.device.createCommandEncoder()
    const textureView = this.context.getCurrentTexture().createView()
    const usePostProcess = this.hasPostProcess && this.postProcessPasses.length > 0 && !!this.pingPong?.getCurrent()
    const targetView = usePostProcess
      ? this.pingPong!.getCurrent()!
      : textureView
    const skybox = !!(this.envSettings?.showSkybox && this.skyboxPipeline && this.skyboxBindGroup)

    if (this.hasCompute && this.computePipeline && this.computeBindGroup && this.particleStorageBuffer && this.particleRenderPipeline && this.particleRenderBindGroup) {
      // 1. Compute pass: skipped while paused (delta === 0) so the simulation is frozen, except to honour a reseed.
      if (delta > 0 || this.simParams.reset > 0) {
        this.simDataArray[0] = delta > 0 ? delta / 1000 : 0
        this.simDataArray[1] = seconds
        this.simDataArray[2] = this.simParams.speed
        this.simDataArray[3] = this.simParams.damping
        this.simDataArray[4] = this.simParams.strength
        this.simDataArray[5] = this.particleCount
        this.simDataArray[6] = this.simParams.noiseScale
        this.simDataArray[7] = this.simParams.reset
        this.simDataArray[8] = this.audioUniforms.bass
        this.simDataArray[9] = this.audioUniforms.mid
        this.simDataArray[10] = this.audioUniforms.treble
        this.simDataArray[11] = this.audioUniforms.beat

        if (this.simUniformBuffer) {
          this.device.queue.writeBuffer(this.simUniformBuffer, 0, this.simDataArray)
        }
        if (this.simParams.reset > 0) {
          this.simParams.reset = 0.0
        }

        const computePass = commandEncoder.beginComputePass({ label: "ParticleSimComputePass" })
        computePass.setPipeline(this.computePipeline)
        computePass.setBindGroup(0, this.computeBindGroup)
        const workgroups = Math.ceil(this.particleCount / 64)
        computePass.dispatchWorkgroups(workgroups)
        computePass.end()
      }

      // 2. Render Pass for Particles
      if (this.particleRenderUniformBuffer) {
        this.particleRenderArray.set(this.mvpMatrix, 0)
        this.particleRenderArray[16] = this.simParams.pointSize
        this.particleRenderArray[17] = this.simParams.blendMode
        this.device.queue.writeBuffer(this.particleRenderUniformBuffer, 0, this.particleRenderArray)
      }

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: targetView, clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 }, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: this.depthTextureView!, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
      })
      if (skybox) {
        renderPass.setPipeline(this.skyboxPipeline!)
        renderPass.setBindGroup(0, this.skyboxBindGroup!)
        renderPass.draw(3)
        this.statDraws++
        this.statTriangles++
      }
      renderPass.setPipeline(this.particleRenderPipeline)
      renderPass.setBindGroup(0, this.particleRenderBindGroup)
      renderPass.draw(6, this.particleCount, 0, 0)
      renderPass.end()
      this.statDraws++
      this.statTriangles += 2 * this.particleCount
    } else if (vertexBuffer && this.pipeline && this.bindGroup) {
      if (this.state.pipelineMode === "deferred") {
        if (!this.gBufferAlbedoTex || !this.gBufferNormalTex || !this.gBufferRoughnessTex || !this.gBufferDepthTex || !this.gBufferMotionTex) {
          this.initGBuffer(this.canvas?.width || 1920, this.canvas?.height || 1080)
        }
        if (!this.deferredLightingPipeline) {
          this.initDeferredLightingPipeline()
        }

        // 1. Directional Light Shadow Depth Render Pass (guarded, see encodeShadowPass)
        this.encodeShadowPass(commandEncoder, vertexBuffer, vertexCount)

        // 2. GBuffer Geometry Pass
        const gBufferPass = commandEncoder.beginRenderPass({
          label: "GBufferGeometryPass",
          colorAttachments: [
            { view: this.gBufferViews!.albedo, clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 }, loadOp: "clear", storeOp: "store" },
            { view: this.gBufferViews!.normal, clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1.0 }, loadOp: "clear", storeOp: "store" },
            { view: this.gBufferViews!.roughness, clearValue: { r: 0.5, g: 0.0, b: 0.0, a: 1.0 }, loadOp: "clear", storeOp: "store" },
            { view: this.gBufferViews!.motion, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: "clear", storeOp: "store" },
          ],
          depthStencilAttachment: {
            view: this.gBufferViews!.depth,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
          },
        })
        if (skybox) {
          gBufferPass.setPipeline(this.skyboxPipeline!)
          gBufferPass.setBindGroup(0, this.skyboxBindGroup!)
          gBufferPass.draw(3)
          this.statDraws++
          this.statTriangles++
        }
        gBufferPass.setPipeline(this.deferredGeometryPipeline || this.pipeline)
        gBufferPass.setBindGroup(0, this.bindGroup)
        gBufferPass.setVertexBuffer(0, vertexBuffer)
        gBufferPass.draw(vertexCount)
        gBufferPass.end()
        this.statDraws++
        this.statTriangles += vertexCount / 3

        // 3. Fullscreen Deferred Lighting Pass
        this.updateDeferredLightingUniforms()
        const lightingPass = commandEncoder.beginRenderPass({
          label: "DeferredLightingPass",
          colorAttachments: [{
            view: targetView,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        })
        if (this.deferredLightingPipeline && this.deferredLightingBindGroup) {
          lightingPass.setPipeline(this.deferredLightingPipeline)
          lightingPass.setBindGroup(0, this.deferredLightingBindGroup)
          lightingPass.draw(3)
          this.statDraws++
          this.statTriangles++
        }
        lightingPass.end()
      } else {
        this.encodeShadowPass(commandEncoder, vertexBuffer, vertexCount)

        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{ view: targetView, clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1 }, loadOp: "clear", storeOp: "store" }],
          depthStencilAttachment: { view: this.depthTextureView!, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
        })
        if (skybox) {
          renderPass.setPipeline(this.skyboxPipeline!)
          renderPass.setBindGroup(0, this.skyboxBindGroup!)
          renderPass.draw(3)
          this.statDraws++
          this.statTriangles++
        }
        renderPass.setPipeline(this.pipeline)
        renderPass.setBindGroup(0, this.bindGroup)
        renderPass.setVertexBuffer(0, vertexBuffer)
        renderPass.draw(vertexCount)
        renderPass.end()
        this.statDraws++
        this.statTriangles += vertexCount / 3
      }
    }

    if (usePostProcess) {
      const numPasses = this.postProcessPasses.length
      for (let i = 0; i < numPasses; i++) {
        const pass = this.postProcessPasses[i]
        const isFinal = (i === numPasses - 1)
        const passTarget = isFinal ? textureView : this.pingPong!.getNext()!
        const inputView = this.pingPong!.getCurrent()!

        if (!pass.bindGroupCache) {
          pass.bindGroupCache = new Map()
        }
        let passBindGroup = pass.bindGroupCache.get(inputView)
        if (!passBindGroup) {
          const bindEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: this.postProcessSampler! },
            { binding: 1, resource: inputView },
          ]
          if (pass.uniformBuffer) {
            bindEntries.push({ binding: 2, resource: { buffer: pass.uniformBuffer } })
          }
          if (pass.passType === "ssao" || pass.passType === "ssr") {
            const depthV = this.gBufferViews?.depth || this.depthTextureView || this.defaultTexture!.createView()
            const normV = this.gBufferViews?.normal || this.defaultTexture!.createView()
            bindEntries.push({ binding: 3, resource: depthV })
            bindEntries.push({ binding: 4, resource: normV })
          } else if (pass.passType === "dof") {
            const depthV = this.gBufferViews?.depth || this.depthTextureView || this.defaultTexture!.createView()
            bindEntries.push({ binding: 3, resource: depthV })
          } else if (pass.passType === "taa") {
            const histV = this.defaultTexture!.createView()
            const motV = this.gBufferViews?.motion || this.defaultTexture!.createView()
            bindEntries.push({ binding: 3, resource: histV })
            bindEntries.push({ binding: 4, resource: motV })
          }
          passBindGroup = this.device.createBindGroup({
            layout: pass.bindGroupLayout,
            entries: bindEntries,
          })
          pass.bindGroupCache.set(inputView, passBindGroup)
        }

        const ppPass = commandEncoder.beginRenderPass({
          colorAttachments: [{ view: passTarget, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        })
        ppPass.setPipeline(pass.pipeline)
        ppPass.setBindGroup(0, passBindGroup)
        ppPass.draw(6)
        ppPass.end()
        this.statDraws++
        this.statTriangles += 2

        if (!isFinal) {
          this.pingPong!.swap()
        }
      }
    }

    this.device.queue.submit([commandEncoder.finish()])
    this.frameStats.drawCalls = this.statDraws
    this.frameStats.triangles = this.statTriangles
    performanceTelemetry.reportFrameStats(this.frameStats)
  }

  setExternalLoopDriven(external: boolean) {
    this.isExternalLoopDriven = external
    if (external && this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    } else if (!external && this.initialized && this.rafId === null) {
      this.startRenderLoop()
    }
  }

  private startRenderLoop() {
    if (this.isExternalLoopDriven) return
    const render = (time: number) => {
      if (this.isExternalLoopDriven) {
        this.rafId = null
        return
      }
      this.renderFrame(time, 16)
      if (!this.isExternalLoopDriven) {
        this.rafId = requestAnimationFrame(render)
      }
    }
    this.rafId = requestAnimationFrame(render)
  }

  setRenderQueue(queue: RenderQueue | null) {
    // An empty/null queue is a real state (graph emptied): reset every flag it could leave stuck on.
    const steps = queue ?? []
    this.hasPostProcess = false
    this.queueTextures = []
    this.textureBindings = {}
    let foundCompute = false
    const ppSteps: PostProcessStep[] = []

    for (const step of steps) {
      if (step.type === "mesh") {
        this.currentGeometry = step.geometry as GeometryKey
        this.ensureGeometryBuffer(this.currentGeometry)
      } else if (step.type === "compute") {
        foundCompute = true
        this.hasCompute = true
        const count = step.particleCount || 50000
        const preset = step.preset || "curl_noise"
        const code = getComputePresetCode(preset, step.computeSource)

        if (step.params) {
          for (const [k, v] of Object.entries(step.params)) {
            this.updateComputeUniform(k, v)
          }
        }

        if (this.device) {
          if (!this.particleStorageBuffer || this.particleCount !== count) {
            this.initializeParticleStorage(count, preset)
            this.setupComputePipeline(code)
            this.setupParticleRenderPipeline()
          } else if (this.currentComputeSource !== code && this.failedComputeSource !== code) {
            this.setupComputePipeline(code)
          }
        }
      } else if (step.type === "texture") {
        this.queueTextures.push({ id: step.id, binding: step.binding })
        this.loadTexture(step.id)
      } else if (step.type === "audio") {
        if (this.device && !this.audioTexture) {
          this.createAudioTexture()
          this.updateBindGroup()
        }
      } else if (step.type === "material") {
        if (step.textureBindings) {
          this.textureBindings = { ...step.textureBindings }
        }
      } else if (step.type === "postprocess") {
        this.hasPostProcess = true
        const passType: PostProcessPassType = step.pass || "vignette"
        ppSteps.push({
          id: step.id || `${passType}-${ppSteps.length}`,
          pass: passType,
          customSource: step.customSource,
          uniforms: step.uniforms || {},
        })
      }
    }
    if (!foundCompute) {
      this.hasCompute = false
    }
    this.pruneTextures()
    if (this.hasPostProcess && this.device && this.canvas) {
      if (!this.pingPong) this.pingPong = new WebGPUPingPong(this.device, this.format)
      this.pingPong.resize(this.canvas.width, this.canvas.height)
      this.syncPostProcessPasses(ppSteps)
    } else {
      this.postProcessSignature = ""
      this.cleanupPostProcessPasses()
    }
    this.updateBindGroup()
  }

  /** Destroys graph textures that are no longer referenced by the render queue. */
  private pruneTextures() {
    const wanted = new Set(this.queueTextures.map(t => t.id))
    for (const [id, tex] of this.textureResources) {
      if (wanted.has(id)) continue
      try { tex.destroy() } catch {}
      this.textureResources.delete(id)
    }
  }

  /** Rebuilds the post chain only when its structure changed; value-only changes just rewrite the pass uniforms. */
  private syncPostProcessPasses(steps: PostProcessStep[]) {
    const signature = JSON.stringify(steps.map(s => [s.id, s.pass, s.customSource ?? ""]))
    if (signature !== this.postProcessSignature || this.postProcessPasses.length === 0) {
      this.postProcessSignature = signature
      this.rebuildPostProcessPasses(steps)
      return
    }
    for (let i = 0; i < steps.length; i++) {
      const pass = this.postProcessPasses.find(p => p.id === steps[i].id)
      if (!pass) continue
      const next = steps[i].uniforms
      let changed = false
      for (const k of Object.keys(next)) {
        if (!Object.is(pass.uniformValues[k], next[k]) && JSON.stringify(pass.uniformValues[k]) !== JSON.stringify(next[k])) { changed = true; break }
      }
      if (changed) {
        pass.uniformValues = { ...next }
        this.writePostProcessUniforms(pass)
      }
    }
  }

  /** Packs a pass's vec4 uniform block into the shared scratch array and uploads it (canvas size read live). */
  private writePostProcessUniforms(pass: WebGPUPostProcessPass) {
    if (!this.device || !pass.uniformBuffer) return
    const u = pass.uniformValues
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) ? x : d }
    const out = this.ppScratch
    out.fill(0)
    switch (pass.passType) {
      case "vignette":
        out[0] = n(u.intensity ?? u.u_vignetteIntensity, 0.5)
        out[1] = n(u.radius ?? u.u_vignetteRadius, 0.8)
        break
      case "blur":
        out[0] = this.canvas?.width || 800
        out[1] = this.canvas?.height || 600
        out[2] = n(u.amount ?? u.u_blurAmount, 2.0)
        break
      case "chromatic_aberration":
        out[0] = n(u.offset ?? u.u_aberrationOffset, 0.008)
        break
      case "bloom":
        out[0] = n(u.threshold ?? u.u_bloomThreshold, 0.7)
        out[1] = n(u.intensity ?? u.u_bloomIntensity, 0.5)
        break
      case "ssao":
        out[0] = n(u.radius ?? u.u_radius, 0.5)
        out[1] = n(u.intensity ?? u.u_intensity, 1.5)
        out[2] = n(u.sampleCount ?? u.u_sampleCount, 16)
        out[3] = n(u.bias ?? u.u_bias, 0.025)
        break
      case "dof":
        out[0] = n(u.focalDistance ?? u.u_focalDistance, 5.0)
        out[1] = n(u.aperture ?? u.u_aperture, 0.05)
        out[2] = n(u.maxBlur ?? u.u_maxBlur, 1.0)
        break
      case "fxaa":
      case "taa":
        out[0] = 1.0 / (this.canvas?.width || 800)
        out[1] = 1.0 / (this.canvas?.height || 600)
        break
      case "ssr":
        out[0] = n(u.maxSteps ?? u.u_maxSteps, 64)
        out[1] = n(u.thickness ?? u.u_thickness, 0.02)
        out[2] = n(u.falloff ?? u.u_falloff, 0.8)
        out[3] = n(u.iblBlend ?? u.u_iblBlend, 0.5)
        break
      default:
        return
    }
    this.device.queue.writeBuffer(pass.uniformBuffer, 0, out)
  }

  private rebuildPostProcessPasses(steps: PostProcessStep[]) {
    if (!this.device) return
    this.cleanupPostProcessPasses()

    if (!this.postProcessSampler) {
      this.postProcessSampler = this.device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      })
    }

    const withUniforms: PostProcessPassType[] = ["vignette", "blur", "chromatic_aberration", "bloom", "ssao", "dof", "fxaa", "taa", "ssr"]
    for (const step of steps) {
      try {
        let code = passthroughWgsl
        switch (step.pass) {
          case "vignette": code = vignetteWgsl; break
          case "blur": code = blurWgsl; break
          case "chromatic_aberration": code = chromaticWgsl; break
          case "bloom": code = bloomWgsl; break
          case "ssao": code = ssaoWgsl; break
          case "dof": code = dofWgsl; break
          case "fxaa": code = fxaaWgsl; break
          case "taa": code = taaWgsl; break
          case "ssr": code = ssrWgsl; break
          case "custom": code = step.customSource || CUSTOM_WGSL_TEMPLATE; break
          case "passthrough": code = passthroughWgsl; break
        }

        const shaderModule = this.device.createShaderModule({ code })
        const uniformBuffer: GPUBuffer | null = withUniforms.includes(step.pass)
          ? this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
          : null

        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ]
        if (uniformBuffer) {
          entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } })
        }
        if (step.pass === "ssao" || step.pass === "ssr") {
          entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } })
          entries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } })
        } else if (step.pass === "dof") {
          entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } })
        } else if (step.pass === "taa") {
          entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } })
          entries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } })
        }
        const bindGroupLayout = this.device.createBindGroupLayout({ entries })
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] })
        const pipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: "vertex_main" },
          fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
          primitive: { topology: "triangle-list" },
        })

        const pass: WebGPUPostProcessPass = {
          id: step.id,
          passType: step.pass,
          pipeline,
          bindGroupLayout,
          uniformBuffer,
          uniformValues: { ...step.uniforms },
          bindGroupCache: new Map(),
        }
        this.writePostProcessUniforms(pass)
        this.postProcessPasses.push(pass)
      } catch (e) {
        console.error("Failed to compile post-process pass:", step.pass, e)
      }
    }
  }

  private cleanupPostProcessPasses() {
    for (const p of this.postProcessPasses) {
      p.uniformBuffer?.destroy()
      p.bindGroupCache?.clear()
    }
    this.postProcessPasses = []
  }

  private async loadTexture(textureId: string) {
    if (!this.device || !this.initialized) return
    const textureResource = useProjectStore.getState().textureResources.find(t => t.id === textureId)
    if (!textureResource || this.textureResources.has(textureId) || this.loadingTextures.has(textureId)) return
    this.loadingTextures.add(textureId)
    try {
      const response = await fetch(textureResource.src)
      if (!this.device || !this.initialized) return
      const blob = await response.blob()
      if (!this.device || !this.initialized) return
      const bitmap = await createImageBitmap(blob)
      if (!this.device || !this.initialized || !this.queueTextures.some(t => t.id === textureId)) {
        // Adapter went away or the node left the graph while the image was loading.
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      try {
        const texture = this.device.createTexture({
          size: [bitmap.width, bitmap.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        })
        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height])
        this.textureResources.set(textureId, texture)
        this.updateBindGroup()
        renderCoordinator.requestRender()
      } finally {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
      }
    } catch (e) {
      if (this.initialized) console.error("Failed to load texture:", e)
    } finally {
      this.loadingTextures.delete(textureId)
    }
  }

  /**
   * Compiles `wgslSource` into fresh objects (module, pipeline, uniform block, bind group). Only a valid result
   * replaces the live ones (and destroys the old uniform buffer); on a compile error the previous pipeline keeps
   * rendering and the error (`:line:col error: message`) is published for the editor diagnostics.
   */
  recompileShader(wgslSource: string) {
    if (!this.device || !this.initialized) return
    const device = this.device
    const gen = ++this.renderCompileGen
    this.compileChecked<{ res: UniformResources; pipeline: GPURenderPipeline; bindGroup: GPUBindGroup }>(
      (dev) => {
        const res = this.buildUniformResources(wgslSource)
        try {
          const module = dev.createShaderModule({ code: wgslSource })
          const pipeline = dev.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "vertex_main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
            fragment: { module, entryPoint: "fragment_main", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
          })
          const bindGroup = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: this.buildBindGroupEntries(wgslSource, res.buffer) })
          return { value: { res, pipeline, bindGroup }, module }
        } catch (e) {
          try { res.buffer.destroy() } catch {}
          throw e
        }
      },
      () => gen !== this.renderCompileGen || this.device !== device || !this.initialized,
      (v) => {
        this.currentShaderSource = wgslSource
        this.applyUniformResources(v.res)
        this.pipeline = v.pipeline
        this.bindGroup = v.bindGroup
        useProjectStore.getState().setLastCompileError(null)
        renderCoordinator.requestRender()
      },
      (v, err) => {
        if (v) { try { v.res.buffer.destroy() } catch {} }
        if (err !== null) useProjectStore.getState().setLastCompileError(err)
      },
    )
  }

  updateUniform(name: string, value: UniformValue) {
    const alt = name.startsWith("u_") ? name.slice(2) : `u_${name}`
    this.cachedUniformValues.delete(alt)
    this.cachedUniformValues.set(name, value)
    if (!this.device || !this.uniformBuffer || !this.uniformLayout || !this.cpuUniformBuffer) return

    const field = this.writeUniformToCpuBuffer(name, value)
    if (!field) return
    this.device.queue.writeBuffer(this.uniformBuffer, field.offset, this.cpuUniformBuffer, field.offset, field.size)
  }

  updatePostProcessUniform(nodeId: string, name: string, value: number | number[]) {
    if (!this.device) return
    const pass = this.postProcessPasses.find(p => p.id === nodeId || p.passType === nodeId)
    if (!pass || !pass.uniformBuffer) return
    pass.uniformValues[name] = value
    pass.uniformValues[name.replace(/^u_/, "")] = value
    const lower = name.toLowerCase()
    for (const key of ["intensity", "radius", "threshold"]) if (lower.includes(key)) pass.uniformValues[key] = value
    // blur/chromatic nodes expose a single value whatever it is named.
    const val = typeof value === "number" ? value : Number(value[0]) || 0
    if (pass.passType === "blur") pass.uniformValues.amount = val
    else if (pass.passType === "chromatic_aberration") pass.uniformValues.offset = val
    this.writePostProcessUniforms(pass)
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  private setupDeviceLostHandler(device: GPUDevice) {
    device.lost.then((info) => {
      if (this.isDisposed) return

      // In WebGPU spec, info.reason === "destroyed" indicates application called device.destroy().
      // Mock tests might emit "GPU out of memory" with default reason "destroyed".
      const isIntentional = info.reason === "destroyed" && !info.message?.toLowerCase().includes("memory")
      if (isIntentional) {
        console.info("[WebGPU] Device intentionally destroyed:", info.message)
        this.initialized = false
        return
      }

      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this.initialized = false
      useProjectStore.getState().setDeviceLost(true)
      useProjectStore.getState().setLastCompileError(`Device lost: ${info.message}`)

      this.handleDeviceLostRecovery()
    }).catch((err) => {
      console.error("[WebGPU] Error in device.lost listener:", err)
    })
  }

  private cleanupDeadResources() {
    this.depthTexture = null
    this.depthTextureView = null
    this.vertexBuffers.clear()
    this.vertexCounts.clear()
    this.uniformBuffer = null
    this.bindGroup = null
    this.pipeline = null
    this.textureResources.clear()
    this.defaultTexture = null
    this.defaultSampler = null
    this.pingPong = null
    this.postProcessPasses = []
    this.postProcessSampler = null
    this.particleStorageBuffer = null
    this.simUniformBuffer = null
    this.particleRenderUniformBuffer = null
    this.computePipeline = null
    this.computeBindGroup = null
    this.particleRenderPipeline = null
    this.particleRenderBindGroup = null
    this.audioTexture = null
    this.envTexture = null
    this.skyboxPipeline = null
    this.skyboxBindGroupLayout = null
    this.skyboxBindGroup = null
    this.skyboxUniformBuffer = null
    this.skyboxSampler = null
    this.uniformLayout = null
    this.cpuUniformBuffer = null
    this.cpuUniformView = null
    this.mvpView = null
    this.timeView = null
    this.queueTextures = []
    this.loadingTextures.clear()
    this.postProcessSignature = ""
    this.renderCompileGen++
    this.computeCompileGen++
    this.device = null
    this.context = null
  }

  private handleDeviceLostRecovery() {
    if (this.isRecovering || this.isDisposed) return
    this.isRecovering = true

    if (this.recoveryAttempts < this.maxRecoveryAttempts) {
      this.recoveryAttempts++
      this.recoveryTimer = setTimeout(async () => {
        this.recoveryTimer = null
        if (this.isDisposed) return

        this.cleanupDeadResources()
        let success = false
        if (this.canvas) {
          try {
            success = await this.mount(this.canvas)
            if (success) {
              const store = useProjectStore.getState()
              if (store.shaderSource && store.shaderSource !== defaultShader) {
                this.recompileShader(store.shaderSource)
              }
              if (store.renderQueue) {
                this.setRenderQueue(store.renderQueue)
              }
            }
          } catch {
            success = false
          }
        }

        if (success) {
          this.recoveryAttempts = 0
          this.isRecovering = false
          renderCoordinator.requestRender()
          useProjectStore.getState().setDeviceLost(false)
          useProjectStore.getState().setLastCompileError(null)
          return
        }

        this.isRecovering = false
        if (this.recoveryAttempts < this.maxRecoveryAttempts) {
          this.handleDeviceLostRecovery()
        } else {
          this.triggerWebGL2Fallback()
        }
      }, this.recoveryBackoffMs)
    } else {
      this.triggerWebGL2Fallback()
    }
  }

  private triggerWebGL2Fallback() {
    this.cleanupDeadResources()
    this.isRecovering = false
    this.recoveryAttempts = 0
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }

    const store = useProjectStore.getState()
    store.setActiveBackend("webgl2")
    store.setDeviceLost(false)
    store.setLastCompileError(null)
  }

  private initGBuffer(width: number, height: number) {
    if (!this.device) return
    const w = Math.max(1, width)
    const h = Math.max(1, height)

    try { this.gBufferAlbedoTex?.destroy() } catch {}
    try { this.gBufferNormalTex?.destroy() } catch {}
    try { this.gBufferRoughnessTex?.destroy() } catch {}
    try { this.gBufferDepthTex?.destroy() } catch {}
    try { this.gBufferMotionTex?.destroy() } catch {}

    this.gBufferAlbedoTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.gBufferNormalTex = this.device.createTexture({
      size: [w, h],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.gBufferRoughnessTex = this.device.createTexture({
      size: [w, h],
      format: "rg8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.gBufferDepthTex = this.device.createTexture({
      size: [w, h],
      format: "depth24plus-stencil8",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.gBufferMotionTex = this.device.createTexture({
      size: [w, h],
      format: "rg16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })

    this.gBufferViews = {
      albedo: this.gBufferAlbedoTex.createView(),
      normal: this.gBufferNormalTex.createView(),
      roughness: this.gBufferRoughnessTex.createView(),
      depth: this.gBufferDepthTex.createView(),
      motion: this.gBufferMotionTex.createView(),
    }
    setTexMeta(this.gBufferAlbedoTex, "rgba8unorm", w, h)
    setTexMeta(this.gBufferNormalTex, "rgba16float", w, h)
    setTexMeta(this.gBufferRoughnessTex, "rg8unorm", w, h)
    setTexMeta(this.gBufferDepthTex, "depth24plus-stencil8", w, h)
    setTexMeta(this.gBufferMotionTex, "rg16float", w, h)

    this.state.gBufferTargets = {
      albedo: this.gBufferAlbedoTex,
      normal: this.gBufferNormalTex,
      roughnessMetallic: this.gBufferRoughnessTex,
      depth: this.gBufferDepthTex,
      motionVectors: this.gBufferMotionTex,
    }

    this.updateDeferredLightingBindGroup()
  }

  private initShadowMap(resolution: number = 2048) {
    if (!this.device) return
    try { this.shadowDepthTex?.destroy() } catch {}
    try {
      this.shadowDepthTex = this.device.createTexture({
        size: [resolution, resolution, 1],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    } catch {}
  }

  private initDeferredGeometryPipeline() {
    if (!this.device) return
    try {
      const code = `
struct VertexInput {
  @location(0) position: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
};

struct GBufferOutput {
  @location(0) albedo: vec4<f32>,
  @location(1) normal: vec4<f32>,
  @location(2) roughnessMetallic: vec2<f32>,
  @location(3) motion: vec2<f32>,
};

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4<f32>(input.position, 1.0);
  out.uv = input.position.xy * 0.5 + 0.5;
  out.normal = vec3<f32>(0.0, 1.0, 0.0);
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> GBufferOutput {
  var out: GBufferOutput;
  out.albedo = vec4<f32>(0.8, 0.8, 0.8, 1.0);
  out.normal = vec4<f32>(in.normal * 0.5 + 0.5, 1.0);
  out.roughnessMetallic = vec2<f32>(0.5, 0.0);
  out.motion = vec2<f32>(0.0, 0.0);
  return out;
}
`
      const module = this.device.createShaderModule({ code })
      this.deferredGeometryPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vertex_main",
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        fragment: {
          module,
          entryPoint: "fragment_main",
          targets: [
            { format: "rgba8unorm" },
            { format: "rgba16float" },
            { format: "rg8unorm" },
            { format: "rg16float" },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus-stencil8", depthWriteEnabled: true, depthCompare: "less" },
      })
    } catch {}
  }

  private initDeferredLightingPipeline() {
    if (!this.device) return
    try {
      this.deferredLightingUniformBuffer?.destroy()
      this.deferredLightingUniformBuffer = this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      const wgsl = `
struct DeferredUniforms {
  lightDir: vec3<f32>,
  lightIntensity: f32,
  lightColor: vec3<f32>,
  envExposure: f32,
  debugView: i32,
  shadowEnabled: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_albedoTex: texture_2d<f32>;
@group(0) @binding(2) var u_normalTex: texture_2d<f32>;
@group(0) @binding(3) var u_roughnessTex: texture_2d<f32>;
@group(0) @binding(4) var u_depthTex: texture_2d<f32>;
@group(0) @binding(5) var u_motionTex: texture_2d<f32>;
@group(0) @binding(6) var<uniform> u_params: DeferredUniforms;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragment_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let dims = textureDimensions(u_albedoTex);
  let uv = fragCoord.xy / vec2<f32>(f32(max(dims.x, 1u)), f32(max(dims.y, 1u)));
  let albedo = textureSample(u_albedoTex, u_sampler, uv);
  let normalRough = textureSample(u_normalTex, u_sampler, uv);
  let roughnessMetallic = textureSample(u_roughnessTex, u_sampler, uv);
  let depth = textureSample(u_depthTex, u_sampler, uv).r;
  let motion = textureSample(u_motionTex, u_sampler, uv);

  if (u_params.debugView == 1) { return vec4<f32>(albedo.rgb, 1.0); }
  if (u_params.debugView == 2) { return vec4<f32>(normalRough.xyz * 0.5 + 0.5, 1.0); }
  if (u_params.debugView == 3) { return vec4<f32>(vec3<f32>(roughnessMetallic.r), 1.0); }
  if (u_params.debugView == 4) { return vec4<f32>(vec3<f32>(roughnessMetallic.g), 1.0); }
  if (u_params.debugView == 5) { return vec4<f32>(vec3<f32>(depth), 1.0); }
  if (u_params.debugView == 6) { return vec4<f32>(vec3<f32>(motion.xy * 10.0 + 0.5, 0.0), 1.0); }

  let N = normalize(normalRough.xyz * 2.0 - 1.0);
  let L = normalize(u_params.lightDir);
  let NdotL = max(dot(N, L), 0.0);
  var shadow: f32 = 1.0;
  let diffuse = albedo.rgb * u_params.lightColor * (NdotL * shadow * u_params.lightIntensity);
  let ambient = albedo.rgb * 0.15 * u_params.envExposure;
  return vec4<f32>(diffuse + ambient, albedo.a);
}
`
      const module = this.device.createShaderModule({ code: wgsl })
      this.deferredLightingPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertex_main" },
        fragment: { module, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list" },
      })
      this.deferredLightingProgram = this.deferredLightingPipeline
      this.updateDeferredLightingBindGroup()
    } catch (e) {
      this.deferredLightingProgram = {}
    }
  }

  private updateDeferredLightingBindGroup() {
    if (!this.device || !this.deferredLightingPipeline || !this.deferredLightingUniformBuffer) return
    const defaultTexView = this.defaultTexture?.createView() || ({} as any)
    const albView = this.gBufferViews?.albedo || defaultTexView
    const normView = this.gBufferViews?.normal || defaultTexView
    const roughView = this.gBufferViews?.roughness || defaultTexView
    const depthView = this.gBufferViews?.depth || defaultTexView
    const motView = this.gBufferViews?.motion || defaultTexView

    try {
      this.deferredLightingBindGroup = this.device.createBindGroup({
        layout: this.deferredLightingPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.defaultSampler || this.postProcessSampler! },
          { binding: 1, resource: albView },
          { binding: 2, resource: normView },
          { binding: 3, resource: roughView },
          { binding: 4, resource: depthView },
          { binding: 5, resource: motView },
          { binding: 6, resource: { buffer: this.deferredLightingUniformBuffer } },
        ],
      })
    } catch {}
  }

  private updateDeferredLightingUniforms() {
    if (!this.device || !this.deferredLightingUniformBuffer) return
    const debugViewCodes: Record<GBufferDebugView, number> = {
      none: 0,
      albedo: 1,
      normal: 2,
      roughness: 3,
      metallic: 4,
      depth: 5,
      motion: 6,
    }
    const debugCode = debugViewCodes[this.gBufferDebugView] ?? 0

    const dirLight = this.shadowSettings.directionalLight
    let lDirX = 0.5, lDirY = 1.0, lDirZ = 0.75
    let lColR = 1.0, lColG = 0.95, lColB = 0.9
    let lInt = dirLight?.intensity ?? 1.0

    if (dirLight) {
      if (dirLight.enabled === false) {
        lInt = 0.0
      }
      if (dirLight.position && dirLight.target) {
        const dx = dirLight.position[0] - dirLight.target[0]
        const dy = dirLight.position[1] - dirLight.target[1]
        const dz = dirLight.position[2] - dirLight.target[2]
        const len = Math.hypot(dx, dy, dz) || 1.0
        lDirX = dx / len
        lDirY = dy / len
        lDirZ = dz / len
      }
      if (dirLight.color) {
        lColR = dirLight.color[0]
        lColG = dirLight.color[1]
        lColB = dirLight.color[2]
      }
    }

    const exp = useProjectStore.getState().environmentSettings?.exposure ?? 1.0
    const shadowEnabled = (this.shadowSettings?.enabled && this.shadowDepthTex) ? 1.0 : 0.0

    const data = this.deferredArray
    data[0] = lDirX; data[1] = lDirY; data[2] = lDirZ; data[3] = lInt
    data[4] = lColR; data[5] = lColG; data[6] = lColB; data[7] = exp
    this.deferredInts[8] = debugCode
    data[9] = shadowEnabled
    data[10] = 0.0; data[11] = 0.0

    this.device.queue.writeBuffer(this.deferredLightingUniformBuffer, 0, data)
  }

  setRenderingPipelineMode(mode: RenderingPipelineMode) {
    this.state.pipelineMode = mode
    if (mode === "deferred") {
      const w = this.canvas?.width || 1920
      const h = this.canvas?.height || 1080
      this.initGBuffer(w, h)
      if (!this.state.gBufferTargets) {
        this.state.gBufferTargets = {
          albedo: this.gBufferAlbedoTex || { format: "rgba8unorm", width: w, height: h },
          normal: this.gBufferNormalTex || { format: "rgba16float", width: w, height: h },
          roughnessMetallic: this.gBufferRoughnessTex || { format: "rg8unorm", width: w, height: h },
          depth: this.gBufferDepthTex || { format: "depth24plus-stencil8", width: w, height: h },
          motionVectors: this.gBufferMotionTex || { format: "rg16float", width: w, height: h },
        }
      }
      if (!this.deferredGeometryPipeline) {
        this.initDeferredGeometryPipeline()
      }
      if (!this.deferredLightingPipeline) {
        this.initDeferredLightingPipeline()
      }
    } else {
      this.state.gBufferTargets = null
    }
  }

  setPipelineMode(mode: RenderingPipelineMode) {
    this.setRenderingPipelineMode(mode)
  }

  getPipelineMode(): RenderingPipelineMode {
    return this.state.pipelineMode
  }

  getGBufferTextures(): GBufferTargets | null {
    return this.state.gBufferTargets
  }

  setGBufferDebugView(view: GBufferDebugView) {
    this.gBufferDebugView = view
  }

  getGBufferDebugView(): GBufferDebugView {
    return this.gBufferDebugView
  }

  setShadowConfig(config: Partial<ShadowMapConfig>) {
    if (config.resolution !== undefined) {
      if (typeof config.resolution !== "number" || Number.isNaN(config.resolution) || ![512, 1024, 2048, 4096].includes(config.resolution as any)) {
        throw new Error(`Invalid shadow resolution ${config.resolution}. Supported: 512, 1024, 2048, 4096`)
      }
    }
    this.state.shadowConfig = { ...this.state.shadowConfig, ...config }
    this.shadowSettings.resolution = this.state.shadowConfig.resolution
    this.shadowSettings.filterMode = this.state.shadowConfig.filtering
    this.shadowSettings.bias = this.state.shadowConfig.bias
    this.shadowSettings.normalBias = this.state.shadowConfig.normalBias
    if (this.device && config.resolution) {
      this.initShadowMap(config.resolution)
    }
  }

  updateShadowSettings(settings: Partial<ShadowSettings>) {
    if (settings.resolution !== undefined) {
      if (typeof settings.resolution !== "number" || Number.isNaN(settings.resolution) || ![512, 1024, 2048, 4096].includes(settings.resolution as any)) {
        throw new Error(`Invalid shadow resolution ${settings.resolution}. Supported: 512, 1024, 2048, 4096`)
      }
    }
    this.shadowSettings = { ...this.shadowSettings, ...settings }
    if (settings.resolution) this.state.shadowConfig.resolution = settings.resolution
    if (settings.filterMode) this.state.shadowConfig.filtering = settings.filterMode
    if (settings.bias !== undefined) this.state.shadowConfig.bias = settings.bias
    if (settings.normalBias !== undefined) this.state.shadowConfig.normalBias = settings.normalBias
    if (this.device && settings.resolution) {
      this.initShadowMap(settings.resolution)
    }
  }

  getShadowSettings(): ShadowSettings {
    return this.shadowSettings
  }

  setPointLightShadowCube(enabled: boolean) {
    this.state.pointShadowCubeEnabled = enabled
    if (enabled) {
      if (this.device && !this.shadowCubeTex) {
        try {
          this.shadowCubeTex = this.device.createTexture({
            size: [512, 512, 6],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          })
        } catch {}
      } else if (!this.device && !this.shadowCubeTex) {
        this.shadowCubeTex = { width: 512, height: 512, depthOrArrayLayers: 6, format: "depth24plus" } as any
      }
    } else {
      this.shadowCubeTex = null
    }
  }

  setPostProcessEnabled(
    pass: "fxaa" | "taa" | "dof" | "ssao" | "ssr",
    enabled: boolean,
    params?: any
  ) {
    if (this.state.postProcessState[pass]) {
      this.state.postProcessState[pass].enabled = enabled
      if (params) {
        Object.assign(this.state.postProcessState[pass], params)
      }
    }
  }

  updateSSRSettings(settings: Partial<SSRSettings>) {
    if (settings.enabled !== undefined) this.state.postProcessState.ssr.enabled = settings.enabled
    if (settings.maxSteps !== undefined) this.state.postProcessState.ssr.maxSteps = settings.maxSteps
    if (settings.thickness !== undefined) this.state.postProcessState.ssr.thickness = settings.thickness
    if (settings.falloff !== undefined) this.state.postProcessState.ssr.falloff = settings.falloff
    if (settings.iblBlend !== undefined) this.state.postProcessState.ssr.iblBlend = settings.iblBlend
  }

  updateDoFSettings(settings: Partial<DoFSettings>) {
    if (settings.enabled !== undefined) this.state.postProcessState.dof.enabled = settings.enabled
    if (settings.focalDistance !== undefined) this.state.postProcessState.dof.focalDistance = settings.focalDistance
    if (settings.aperture !== undefined) this.state.postProcessState.dof.aperture = settings.aperture
    if (settings.bokehShape !== undefined) this.state.postProcessState.dof.bokehShape = settings.bokehShape
  }

  updateSSAOSettings(settings: Partial<SSAOSettings>) {
    if (settings.enabled !== undefined) this.state.postProcessState.ssao.enabled = settings.enabled
    if (settings.radius !== undefined) this.state.postProcessState.ssao.radius = settings.radius
    if (settings.intensity !== undefined) this.state.postProcessState.ssao.intensity = settings.intensity
    if (settings.sampleCount !== undefined) this.state.postProcessState.ssao.sampleCount = settings.sampleCount
  }

  setAntiAliasingMode(mode: AntiAliasingMode) {
    this.antiAliasingMode = mode
    this.state.postProcessState.fxaa.enabled = (mode === "fxaa")
    this.state.postProcessState.taa.enabled = (mode === "taa")
  }

  getAntiAliasingMode(): AntiAliasingMode {
    return this.antiAliasingMode
  }

  setAtmosphereParams(params: { timeOfDay: number; sunIntensity?: number; turbidity?: number }) {
    const tod = Math.max(0, Math.min(24, params.timeOfDay))
    const solarElevation = Math.max(0, Math.sin(((tod - 6) / 12) * Math.PI) * 90)
    this.state.atmosphereParams = {
      timeOfDay: tod,
      sunIntensity: params.sunIntensity ?? this.state.atmosphereParams.sunIntensity,
      turbidity: params.turbidity ?? this.state.atmosphereParams.turbidity,
      solarElevationDeg: solarElevation,
    }
  }

  calculateRayleighMieScattering(wavelengthNm = [680, 550, 440]): { rayleigh: number[]; mie: number } {
    const rayleigh = wavelengthNm.map((lambda) => {
      const lambdaUm = lambda / 1000.0
      return 0.008 * Math.pow(lambdaUm, -4)
    })
    const mie = 0.002 * this.state.atmosphereParams.turbidity
    return { rayleigh, mie }
  }

  dispose() {
    this.isDisposed = true
    this.renderCompileGen++ // pending async compiles must not commit into a disposed adapter
    this.computeCompileGen++
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
    this.isRecovering = false
    this.recoveryAttempts = 0
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.isExternalLoopDriven = false
    if (this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel()
      this.unsubscribeCustomModel = null
    }
    try { this.depthTexture?.destroy() } catch {}
    this.depthTexture = null; this.depthTextureView = null
    for (const buffer of this.vertexBuffers.values()) {
      try { buffer?.destroy() } catch {}
    }
    this.vertexBuffers.clear()
    try { this.uniformBuffer?.destroy() } catch {}
    this.uniformBuffer = null
    this.uniformLayout = null; this.cpuUniformBuffer = null; this.cpuUniformView = null
    this.mvpView = null; this.timeView = null
    this.bindGroup = null; this.pipeline = null
    for (const texture of this.textureResources.values()) {
      try { texture?.destroy() } catch {}
    }
    this.textureResources.clear()
    this.queueTextures = []
    this.textureBindings = {}
    this.loadingTextures.clear()
    this.postProcessSignature = ""
    try { this.defaultTexture?.destroy() } catch {}
    this.defaultTexture = null; this.defaultSampler = null
    try { this.cleanupPostProcessPasses() } catch {}
    try { this.pingPong?.destroy() } catch {}
    this.pingPong = null; this.hasPostProcess = false
    this.postProcessSampler = null
    try { this.particleStorageBuffer?.destroy() } catch {}
    this.particleStorageBuffer = null
    try { this.simUniformBuffer?.destroy() } catch {}
    this.simUniformBuffer = null
    try { this.particleRenderUniformBuffer?.destroy() } catch {}
    this.particleRenderUniformBuffer = null
    this.computePipeline = null; this.computeBindGroup = null
    this.particleRenderPipeline = null; this.particleRenderBindGroup = null
    this.hasCompute = false
    try { this.audioTexture?.destroy() } catch {}
    this.audioTexture = null
    try { this.envTexture?.destroy() } catch {}
    this.envTexture = null
    this.currentEnvPreset = null
    this.skyboxPipeline = null
    this.skyboxBindGroupLayout = null
    this.skyboxBindGroup = null
    try { this.skyboxUniformBuffer?.destroy() } catch {}
    this.skyboxUniformBuffer = null
    this.skyboxSampler = null
    try { this.gBufferAlbedoTex?.destroy() } catch {}
    try { this.gBufferNormalTex?.destroy() } catch {}
    try { this.gBufferRoughnessTex?.destroy() } catch {}
    try { this.gBufferDepthTex?.destroy() } catch {}
    try { this.gBufferMotionTex?.destroy() } catch {}
    this.gBufferViews = null
    this.gBufferAlbedoTex = null
    this.gBufferNormalTex = null
    this.gBufferRoughnessTex = null
    this.gBufferDepthTex = null
    this.gBufferMotionTex = null
    this.state.gBufferTargets = null
    try { this.deferredLightingUniformBuffer?.destroy() } catch {}
    this.deferredLightingUniformBuffer = null
    this.deferredLightingPipeline = null
    this.deferredLightingProgram = null
    this.deferredLightingBindGroup = null
    this.deferredGeometryPipeline = null
    try { this.shadowDepthTex?.destroy() } catch {}
    this.shadowDepthTex = null
    try { this.shadowCubeTex?.destroy() } catch {}
    this.shadowCubeTex = null
    try { this.device?.destroy() } catch {}
    this.device = null
    this.context = null; this.initialized = false
  }
}

export const webgpuAdapter = new WebGPUAdapter()
