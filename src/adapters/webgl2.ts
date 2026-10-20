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
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue, EnvironmentSettings } from "@/stores/projectStore"
import { generateEnvironmentRGBA, ENVIRONMENT_PRESETS } from "@/core/environmentGenerator"
import {
  WebGL2Framebuffer,
  PASSTHROUGH_VERTEX,
  PASSTHROUGH_FRAGMENT,
  VIGNETTE_FRAGMENT,
  BLUR_FRAGMENT,
  CHROMATIC_ABERRATION_FRAGMENT,
  BLOOM_FRAGMENT,
  SSAO_FRAGMENT,
  DOF_FRAGMENT,
  FXAA_FRAGMENT,
  TAA_FRAGMENT,
  SSR_FRAGMENT,
  CUSTOM_GLSL_TEMPLATE,
  getDefaultPostProcessUniforms,
  type PostProcessPassType,
} from "@/core/postProcessChain"
import { useProjectStore } from "@/stores/projectStore"
import defaultVertSource from "../shaders/default.vert?raw"
import defaultFragSource from "../shaders/default.frag?raw"
import skyboxVertSource from "../shaders/skybox.vert?raw"
import skyboxFragSource from "../shaders/skybox.frag?raw"
import { customModelRegistry } from "@/core/customModelRegistry"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { renderCoordinator } from "@/core/renderCoordinator"

interface WebGL2PostProcessPass {
  id: string
  passType: PostProcessPassType
  program: WebGLProgram
  /** Every location this pass touches, resolved once at build (null = cached miss). */
  uniformLocations: Map<string, WebGLUniformLocation | null>
  uniforms: Record<string, number | number[]>
}

import { type GeometryKey, getVerticesForGeometry, setLookAtMatrix, setRotationMatrix, multiplyMatricesInto, halton, setTexMeta, setPerspectiveMatrixGL } from "./math"
export { createLookAtMatrix, createRotationMatrix, multiplyMatrices } from "./math"

export function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  return setPerspectiveMatrixGL(new Float32Array(16), fov, aspect, near, far)
}

type PPStep = { id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }
const PP_STATIC_NAMES = ["u_texture", "u_resolution", "u_depthTexture", "u_normalTexture", "u_motionTexture", "u_historyTexture"]
/** Mesh spin rates (rad/s); equal to the old 0.01 / 0.015 rad per 60 fps frame. */
const SPIN_X = 0.6
const SPIN_Y = 0.9
const AUDIO_NAMES = [
  ["u_audio_bass", "audio_bass", "u_bass"], ["u_audio_mid", "audio_mid", "u_mid"], ["u_audio_treble", "audio_treble", "u_treble"],
  ["u_audio_level", "audio_level", "u_level"], ["u_audio_beat", "audio_beat", "u_beat"],
] as const
const SKYBOX_NAMES = ["u_envMap", "u_camRight", "u_camUp", "u_camForward", "u_rotation", "u_blur", "u_exposure"]
const DEFERRED_NAMES = [
  "u_albedoTex", "u_normalTex", "u_roughnessTex", "u_depthTex", "u_motionTex", "u_shadowMap", "u_envMap",
  "u_debugView", "u_lightDir", "u_lightColor", "u_lightIntensity", "u_shadowEnabled", "u_envExposure",
]
const EYE: [number, number, number] = [0, 2, 4]
const TARGET: [number, number, number] = [0, 0, 0]
const UP: [number, number, number] = [0, 1, 0]
const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])
const DEFERRED_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`
const DEFERRED_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_albedoTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_roughnessTex;
uniform sampler2D u_depthTex;
uniform sampler2D u_motionTex;
uniform sampler2D u_shadowMap;
uniform sampler2D u_envMap;
uniform int u_debugView; // 0=none, 1=albedo, 2=normal, 3=roughness, 4=metallic, 5=depth, 6=motion
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_shadowEnabled;
uniform float u_envExposure;

void main() {
  vec4 albedo = texture(u_albedoTex, v_uv);
  vec4 normalRoughness = texture(u_normalTex, v_uv);
  vec4 metallicMotion = texture(u_roughnessTex, v_uv);
  float depth = texture(u_depthTex, v_uv).r;
  vec4 motion = texture(u_motionTex, v_uv);

  if (u_debugView == 1) {
    fragColor = vec4(albedo.rgb, 1.0);
    return;
  } else if (u_debugView == 2) {
    fragColor = vec4(normalRoughness.rgb * 0.5 + 0.5, 1.0);
    return;
  } else if (u_debugView == 3) {
    fragColor = vec4(vec3(normalRoughness.a), 1.0);
    return;
  } else if (u_debugView == 4) {
    fragColor = vec4(vec3(metallicMotion.r), 1.0);
    return;
  } else if (u_debugView == 5) {
    fragColor = vec4(vec3(depth), 1.0);
    return;
  } else if (u_debugView == 6) {
    fragColor = vec4(vec3(motion.rg, 0.0), 1.0);
    return;
  }

  vec3 N = normalize(normalRoughness.xyz);
  vec3 L = normalize(u_lightDir);
  float NdotL = max(dot(N, L), 0.0);
  float shadow = 1.0;
  if (u_shadowEnabled > 0.5) {
    float shadowDepth = texture(u_shadowMap, v_uv).r;
    shadow = (depth - 0.005 > shadowDepth) ? 0.3 : 1.0;
  }

  vec3 diffuse = albedo.rgb * u_lightColor * (NdotL * shadow * u_lightIntensity);
  vec3 ambient = albedo.rgb * 0.15 * u_envExposure;
  fragColor = vec4(diffuse + ambient, albedo.a);
}`
const IDENTITY2 = [1, 0, 0, 1]
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const ZERO4 = [0, 0, 0, 0]
const COLOR4 = [0.5, 0.5, 0.5, 1]
const DEBUG_VIEW_CODES: Record<GBufferDebugView, number> = { none: 0, albedo: 1, normal: 2, roughness: 3, metallic: 4, depth: 5, motion: 6 }

export class WebGL2Adapter implements RenderAdapter {
  readonly backendType = "webgl2" as const
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vertexBuffer: WebGLBuffer | null = null
  private vertexCount = 36
  private triCount = 12
  private initialized = false
  private rafId: number | null = null
  private currentGeometry: GeometryKey = "cube"
  private projMatrix = new Float32Array(16)
  private viewMatrix = setLookAtMatrix(new Float32Array(16), EYE, TARGET, UP) // fixed camera: computed once
  private rotMatrix = new Float32Array(16)
  private tempMatrix = new Float32Array(16)
  private mvpMatrix = new Float32Array(16)
  private colorBuffer = new Float32Array(3)
  // Scratch buffers so applyUniform never allocates
  private scratch2 = new Float32Array(2)
  private scratch3 = new Float32Array(3)
  private scratch4 = new Float32Array(4)
  private scratchM2 = new Float32Array(4)
  private scratchM3 = new Float32Array(9)
  private scratchM4 = new Float32Array(16)
  private frameStats = { drawCalls: 0, triangles: 0 }
  private ctxGen = 0
  // CPU-side state retained so a lost context can be rebuilt
  private userVert: string | null = null
  private userFrag: string | null = null
  private lastQueue: RenderQueue | null = null
  private ppKey = ""
  private defaultPass: WebGL2PostProcessPass | null = null
  private activePasses: WebGL2PostProcessPass[] = []
  private frameLocs = {
    time: null as WebGLUniformLocation | null,
    audio: [null, null, null, null, null] as Array<WebGLUniformLocation | null>,
    audioTex: null as WebGLUniformLocation | null,
    env: null as WebGLUniformLocation | null,
    envExp: null as WebGLUniformLocation | null,
    envRot: null as WebGLUniformLocation | null,
  }
  private resolvedLocs = new Map<string, WebGLUniformLocation | null>()
  private deferredLocs = new Map<string, WebGLUniformLocation | null>()
  private audioMirror = new Uint8Array(1024)
  private audioMirrorValid = false
  private isExternalLoopDriven = false
  private postProcessFramebuffers: WebGL2Framebuffer[] = []
  private postProcessPasses: WebGL2PostProcessPass[] = []
  private hasPostProcess = false
  private mvpLocation: WebGLUniformLocation | null = null
  private colorLocation: WebGLUniformLocation | null = null
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void
  private quadVAO: WebGLVertexArrayObject | null = null
  private quadBuffer: WebGLBuffer | null = null

  private uniformLocations = new Map<string, WebGLUniformLocation | null>()
  private uniformValues = new Map<string, UniformValue>()
  private authoritativeUniforms = new Map<string, UniformValue>()
  private uniformsDirty = true
  private lastStoreValues: Record<string, UniformValue> | null = null
  private loadedTextures = new Map<string, WebGLTexture>()
  private textureBindings: Record<string, string> = {}
  private queueTextures: Array<{ id: string; binding: number; name: string }> = []
  private boundTextureList: Array<{ name: string; texId: string; isAudio: boolean }> = []
  private defaultTexture: WebGLTexture | null = null
  private hasAudio = false
  private audioTexture: WebGLTexture | null = null
  private audioUniforms: AudioUniforms = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 }
  private envTexture: WebGLTexture | null = null
  private currentEnvPreset: string | null = null
  private lastCustomTextureSrc?: string
  private envSettings: EnvironmentSettings | null = null
  private skyboxProgram: WebGLProgram | null = null
  private skyboxVAO: WebGLVertexArrayObject | null = null
  private skyboxUniformLocations = new Map<string, WebGLUniformLocation | null>()
  private unsubscribeCustomModel: (() => void) | null = null

  // R2 Parity State & Configurations
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

  private gBufferFBO: WebGLFramebuffer | null = null
  private gBufferAlbedoTex: WebGLTexture | null = null
  private gBufferNormalTex: WebGLTexture | null = null
  private gBufferRoughnessTex: WebGLTexture | null = null
  private gBufferDepthTex: WebGLTexture | null = null
  private gBufferMotionTex: WebGLTexture | null = null
  private gBufferDebugView: GBufferDebugView = "none"

  private shadowFBO: WebGLFramebuffer | null = null
  private shadowMapTex: WebGLTexture | null = null
  private shadowCubeMapTex: WebGLTexture | null = null
  private shadowSettings: ShadowSettings = {
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
      color: [1, 1, 1],
      orthoSize: 10,
      near: 0.1,
      far: 50,
    },
  }

  private antiAliasingMode: AntiAliasingMode = "none"
  private taaFrameIndex = 0
  private deferredLightingProgram: WebGLProgram | null = null


  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true })
    if (!gl) { useProjectStore.getState().setLastCompileError("WebGL2 not supported"); return false }
    this.gl = gl
    canvas.addEventListener("webglcontextlost", this.handleContextLost)
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored)
    return this.initialize()
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault()
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.initialized = false
    this.ctxGen++ // in-flight async loads belong to the dead context
    this.releaseGpuState(false)
    useProjectStore.getState().setDeviceLost(true)
    useProjectStore.getState().setLastCompileError("WebGL2 context lost")
  }

  /** Rebuilds everything from the retained CPU-side state (sources, queue, texture ids, env). */
  private handleContextRestored = () => {
    useProjectStore.getState().setDeviceLost(false)
    useProjectStore.getState().setLastCompileError(null)
    if (!this.initialize()) return
    if (this.userFrag !== null) this.linkUserProgram(this.userVert ?? defaultVertSource, this.userFrag)
    const queue = this.lastQueue
    this.lastQueue = null
    this.ppKey = ""
    if (queue) this.setRenderQueue(queue)
    if (this.state.pipelineMode === "deferred" && this.canvas) this.initGBuffer(this.canvas.width, this.canvas.height)
    renderCoordinator.requestRender()
  }

  /**
   * Deletes (live context) or forgets (lost context) every GL object. Collections are emptied only
   * after their members are deleted, so nothing leaks. CPU-side state is kept for restore.
   */
  private releaseGpuState(live: boolean) {
    const gl = live ? this.gl : null
    const del = <T>(o: T | null, f: (o: T) => void) => { if (o && gl) f(o) }
    del(this.program, (o) => gl!.deleteProgram(o)); this.program = null
    del(this.skyboxProgram, (o) => gl!.deleteProgram(o)); this.skyboxProgram = null
    del(this.skyboxVAO, (o) => gl!.deleteVertexArray(o)); this.skyboxVAO = null
    del(this.deferredLightingProgram, (o) => gl!.deleteProgram(o)); this.deferredLightingProgram = null
    del(this.vao, (o) => gl!.deleteVertexArray(o)); this.vao = null
    del(this.vertexBuffer, (o) => gl!.deleteBuffer(o)); this.vertexBuffer = null
    del(this.quadVAO, (o) => gl!.deleteVertexArray(o)); this.quadVAO = null
    del(this.quadBuffer, (o) => gl!.deleteBuffer(o)); this.quadBuffer = null
    this.cleanupPostProcessPasses(gl)
    del(this.defaultPass, (o) => gl!.deleteProgram(o.program)); this.defaultPass = null
    for (const fb of this.postProcessFramebuffers) if (gl) fb.destroy()
    this.postProcessFramebuffers = []
    for (const tex of this.loadedTextures.values()) if (gl) gl.deleteTexture(tex)
    this.loadedTextures.clear()
    for (const k of ["defaultTexture", "envTexture", "audioTexture", "gBufferAlbedoTex", "gBufferNormalTex", "gBufferRoughnessTex",
      "gBufferDepthTex", "gBufferMotionTex", "shadowMapTex", "shadowCubeMapTex"] as const) {
      del(this[k], (o) => gl!.deleteTexture(o)); this[k] = null
    }
    del(this.gBufferFBO, (o) => gl!.deleteFramebuffer(o)); this.gBufferFBO = null
    del(this.shadowFBO, (o) => gl!.deleteFramebuffer(o)); this.shadowFBO = null
    this.state.gBufferTargets = null
    this.currentEnvPreset = null
    this.lastCustomTextureSrc = undefined
    this.audioMirrorValid = false
    this.mvpLocation = this.colorLocation = null
    this.uniformLocations.clear(); this.resolvedLocs.clear(); this.deferredLocs.clear(); this.skyboxUniformLocations.clear()
    this.uniformsDirty = true
  }

  private initialize(): boolean {
    const gl = this.gl; if (!gl) return false
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE)
    const program = this.createProgram(defaultVertSource, defaultFragSource)
    if (!program) return false
    this.adoptProgram(program)
    this.createGeometry(this.currentGeometry)
    this.createDefaultTexture()
    this.initializePostProcess()
    const envSettings = this.envSettings ?? useProjectStore.getState().environmentSettings
    if (envSettings) {
      this.updateEnvironment(envSettings)
    }
    if (!this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel = customModelRegistry.subscribe(() => {
        if (this.currentGeometry === "custom") {
          this.createGeometry("custom")
          renderCoordinator.requestRender()
        }
      })
    }
    if (this.state.pointShadowCubeEnabled) {
      this.shadowCubeMapTex = null
      this.setPointLightShadowCube(true)
    }
    this.initialized = true
    this.startRenderLoop()
    return true
  }

  private createDefaultTexture() {
    if (!this.gl) return
    const gl = this.gl
    this.defaultTexture = gl.createTexture()
    if (!this.defaultTexture) return
    gl.bindTexture(gl.TEXTURE_2D, this.defaultTexture)
    const whitePixel = new Uint8Array([255, 255, 255, 255])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  private async loadTexture(textureId: string) {
    if (!this.gl || !this.initialized) return
    const resource = useProjectStore.getState().textureResources.find((t) => t.id === textureId)
    if (!resource || this.loadedTextures.has(textureId)) return
    const gen = this.ctxGen
    try {
      const response = await fetch(resource.src)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      // Stale: context lost/disposed meanwhile, or the texture left the graph while loading.
      if (!this.gl || !this.initialized || gen !== this.ctxGen || this.loadedTextures.has(textureId)) return
      if (!this.isTextureReferenced(textureId)) return

      const gl = this.gl
      const tex = gl.createTexture()
      if (!tex) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindTexture(gl.TEXTURE_2D, null)

      this.loadedTextures.set(textureId, tex)
      renderCoordinator.requestRender()
    } catch (e) {
      if (this.initialized) console.error("Failed to load texture in WebGL2:", e)
    }
  }

  private isTextureReferenced(id: string): boolean {
    if (this.queueTextures.some((q) => q.id === id)) return true
    for (const k in this.textureBindings) if (this.textureBindings[k] === id) return true
    return false
  }

  /** Makes the program the user-facing one: swaps (deleting the old), re-caches every location. */
  private adoptProgram(program: WebGLProgram) {
    const gl = this.gl
    if (gl && this.program && this.program !== program) gl.deleteProgram(this.program)
    this.program = program
    this.cacheUniformLocations()
    this.mvpLocation = this.getUniformLoc("u_mvp")
    this.colorLocation = this.getUniformLoc("u_color")
    this.warmLocations()
    this.uniformsDirty = true
  }

  private cacheUniformLocations() {
    if (!this.gl || !this.program) return
    this.uniformLocations.clear()
    this.resolvedLocs.clear()
    const count = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < count; i++) {
      const info = this.gl.getActiveUniform(this.program, i)
      if (!info) continue
      const loc = this.gl.getUniformLocation(this.program, info.name)
      this.uniformLocations.set(info.name, loc)
      if (info.name.endsWith("[0]")) {
        this.uniformLocations.set(info.name.slice(0, -3), loc)
      }
    }
  }

  /** Resolves every location the frame loop reads, so steady-state frames never query the driver. */
  private warmLocations() {
    if (!this.gl || !this.program) return
    const f = this.frameLocs
    f.time = this.findUniformLoc("time")
    for (let i = 0; i < AUDIO_NAMES.length; i++) {
      const n = AUDIO_NAMES[i]
      f.audio[i] = this.findUniformLoc(n[0]) || this.findUniformLoc(n[1]) || this.findUniformLoc(n[2])
    }
    f.audioTex = this.findUniformLoc("u_audioTexture") || this.findUniformLoc("audioTexture")
    f.env = this.findUniformLoc("envMap") || this.findUniformLoc("u_envMap")
    f.envExp = this.findUniformLoc("envExposure") || this.findUniformLoc("u_envExposure")
    f.envRot = this.findUniformLoc("envRotation") || this.findUniformLoc("u_envRotation")
    for (const b of this.boundTextureList) this.findUniformLoc(b.name)
    for (const q of this.queueTextures) this.findUniformLoc(q.name) || this.findUniformLoc("u_texture")
    for (const name of this.authoritativeUniforms.keys()) this.findUniformLoc(name)
  }

  private getUniformLoc(name: string): WebGLUniformLocation | null {
    const hit = this.uniformLocations.get(name)
    if (hit !== undefined) return hit
    if (!this.gl || !this.program) return null
    const loc = this.gl.getUniformLocation(this.program, name)
    this.uniformLocations.set(name, loc) // misses are cached as null
    return loc
  }

  /** Looks up name, u_name or name-without-u_; memoised (misses too) until the next link. */
  private findUniformLoc(name: string): WebGLUniformLocation | null {
    const memo = this.resolvedLocs.get(name)
    if (memo !== undefined) return memo
    const prefixed = "u_" + name
    const stripped = name.startsWith("u_") ? name.slice(2) : null
    let loc: WebGLUniformLocation | null | undefined = this.uniformLocations.get(name)
    if (loc === undefined) loc = this.uniformLocations.get(prefixed)
    if (loc === undefined && stripped) loc = this.uniformLocations.get(stripped)
    if (loc === undefined) loc = this.getUniformLoc(name) || this.getUniformLoc(prefixed) || (stripped ? this.getUniformLoc(stripped) : null)
    this.resolvedLocs.set(name, loc)
    return loc
  }

  private fillScratch(dst: Float32Array, value: unknown, defaults: ArrayLike<number>): Float32Array {
    const arr = Array.isArray(value) || value instanceof Float32Array ? (value as ArrayLike<number>) : null
    const isMatrix = dst.length === 4 || dst.length === 9 || dst.length === 16
    if (isMatrix && arr && arr.length !== dst.length) { for (let i = 0; i < dst.length; i++) dst[i] = defaults[i]; return dst }
    for (let i = 0; i < dst.length; i++) dst[i] = arr?.[i] ?? defaults[i] ?? 0
    return dst
  }

  private applyUniform(loc: WebGLUniformLocation, val: UniformValue) {
    const gl = this.gl
    if (!gl) return
    const v = val.value as unknown
    switch (val.type) {
      case "mat4": gl.uniformMatrix4fv(loc, false, this.fillScratch(this.scratchM4, v, IDENTITY4)); break
      case "mat3": gl.uniformMatrix3fv(loc, false, this.fillScratch(this.scratchM3, v, IDENTITY3)); break
      case "mat2": gl.uniformMatrix2fv(loc, false, this.fillScratch(this.scratchM2, v, IDENTITY2)); break
      case "vec4": gl.uniform4fv(loc, this.fillScratch(this.scratch4, v, ZERO4)); break
      case "vec3": gl.uniform3fv(loc, this.fillScratch(this.scratch3, v, ZERO4)); break
      case "color": {
        const len = Array.isArray(v) || v instanceof Float32Array ? (v as ArrayLike<number>).length : 3
        if (len >= 4) gl.uniform4fv(loc, this.fillScratch(this.scratch4, v, COLOR4))
        else gl.uniform3fv(loc, this.fillScratch(this.scratch3, v, COLOR4))
        break
      }
      case "vec2": gl.uniform2fv(loc, this.fillScratch(this.scratch2, v, ZERO4)); break
      case "float": gl.uniform1f(loc, typeof val.value === "number" ? val.value : Number(val.value) || 0); break
      case "bool": gl.uniform1i(loc, val.value ? 1 : 0); break
      case "int": gl.uniform1i(loc, Math.round(Number(val.value) || 0)); break
      case "uint": gl.uniform1ui(loc, Math.max(0, Math.round(Number(val.value) || 0))); break
    }
  }

  /**
   * Compiles and links into locals; any failure deletes the partial objects, reports the driver log
   * (verbatim, so parseDiagnosticErrors can extract "ERROR: 0:LINE:") and returns null so the
   * caller keeps its last good program.
   */
  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl; if (!gl) return null
    const fail = (message: string): null => { useProjectStore.getState().setLastCompileError(message); return null }
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
      const log = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      fail((type === gl.VERTEX_SHADER ? "Vertex" : "Fragment") + " shader error: " + log)
      return null
    }
    const vs = compile(gl.VERTEX_SHADER, vertexSource); if (!vs) return null
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource); if (!fs) { gl.deleteShader(vs); return null }
    const program = gl.createProgram()
    if (!program) { gl.deleteShader(vs); gl.deleteShader(fs); return fail("Program link error: could not create program") }
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      return fail("Program link error: " + log)
    }
    return program
  }

  private createGeometry(geometry: GeometryKey) {
    const gl = this.gl; if (!gl) return
    if (this.vao) gl.deleteVertexArray(this.vao); if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer)
    const vertices = getVerticesForGeometry(geometry); this.vertexCount = Math.floor(vertices.length / 3); this.triCount = Math.floor(this.vertexCount / 3)
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao)
    this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null); this.currentGeometry = geometry
  }

  private initializePostProcess() {
    const gl = this.gl; if (!gl) return
    const program = this.createProgram(PASSTHROUGH_VERTEX, VIGNETTE_FRAGMENT)
    if (!program) return
    this.defaultPass = this.buildPass(program, "vignette-default", "vignette", { u_vignetteIntensity: 0.5, u_vignetteRadius: 0.8 })
    this.refreshActivePasses()
  }

  /** Creates a pass with every location it will ever touch resolved up front (misses cached as null). */
  private buildPass(program: WebGLProgram, id: string, passType: PostProcessPassType, uniforms: Record<string, number | number[]>): WebGL2PostProcessPass {
    const pass: WebGL2PostProcessPass = { id, passType, program, uniformLocations: new Map(), uniforms }
    for (const name of PP_STATIC_NAMES) pass.uniformLocations.set(name, this.gl!.getUniformLocation(program, name))
    this.registerPassLocs(pass)
    return pass
  }

  private registerPassLocs(pass: WebGL2PostProcessPass) {
    for (const name in pass.uniforms) {
      if (!pass.uniformLocations.has(name)) pass.uniformLocations.set(name, this.gl!.getUniformLocation(pass.program, name))
    }
  }

  private refreshActivePasses() {
    this.activePasses = this.postProcessPasses.length > 0 ? this.postProcessPasses : this.defaultPass ? [this.defaultPass] : []
  }

  private ensurePostProcessFramebuffers(width: number, height: number) {
    const gl = this.gl
    if (!gl) return
    if (!this.hasPostProcess) { this.destroyPostProcessFramebuffers(); return }
    if (this.postProcessFramebuffers.length !== 2) {
      this.destroyPostProcessFramebuffers()
      for (let i = 0; i < 2; i++) this.postProcessFramebuffers.push(new WebGL2Framebuffer(gl))
    }
    for (const fb of this.postProcessFramebuffers) fb.resize(width, height) // no-op when the size is unchanged
  }

  private destroyPostProcessFramebuffers() {
    for (const fb of this.postProcessFramebuffers) fb.destroy()
    this.postProcessFramebuffers = []
  }

  private createAudioTexture() {
    const gl = this.gl
    if (!gl) return
    this.audioTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.audioTexture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      512,
      2,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.audioMirrorValid = false
  }

  updateAudioData(textureBuffer: Uint8Array, uniforms: AudioUniforms) {
    this.audioUniforms = uniforms
    const gl = this.gl
    if (!gl || !this.initialized) return

    if (!this.audioTexture) {
      this.createAudioTexture()
    }

    if (this.audioTexture && textureBuffer.length >= 1024) {
      // Skip the GPU upload when the spectrum is byte-identical to what is already resident.
      if (this.audioMirrorValid) {
        let same = true
        for (let i = 0; i < 1024; i++) if (textureBuffer[i] !== this.audioMirror[i]) { same = false; break }
        if (same) return
      }
      try {
        gl.bindTexture(gl.TEXTURE_2D, this.audioTexture)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          512,
          2,
          gl.RED,
          gl.UNSIGNED_BYTE,
          textureBuffer
        )
        gl.bindTexture(gl.TEXTURE_2D, null)
        this.audioMirror.set(textureBuffer.subarray(0, 1024))
        this.audioMirrorValid = true
      } catch {
        // Safe write fallback in headless mock
      }
    }
  }

  setRenderQueue(queue: RenderQueue | null) {
    this.lastQueue = queue && queue.length > 0 ? queue : null
    // An empty queue resets the flags too; stale post-process/audio state must not outlive its graph.
    this.hasPostProcess = false
    this.hasAudio = false
    this.queueTextures = []
    this.textureBindings = {}
    const ppSteps: PPStep[] = []

    for (const step of queue ?? []) {
      if (step.type === "mesh") {
        if (step.geometry !== this.currentGeometry || step.geometry === "custom" || !this.vao) this.createGeometry(step.geometry as GeometryKey)
      } else if (step.type === "texture") {
        this.queueTextures.push({ id: step.id, binding: step.binding, name: "u_texture" + step.binding })
      } else if (step.type === "audio") {
        this.hasAudio = true
        if (this.gl && !this.audioTexture) {
          this.createAudioTexture()
        }
      } else if (step.type === "material") {
        if (step.textureBindings) {
          this.textureBindings = { ...step.textureBindings }
        }
      } else if (step.type === "postprocess") {
        this.hasPostProcess = true
        const passType: PostProcessPassType = step.pass || "vignette"
        ppSteps.push({
          id: step.id || passType + "-" + ppSteps.length,
          pass: passType,
          customSource: step.customSource,
          uniforms: step.uniforms || {},
        })
      }
    }

    this.boundTextureList = []
    for (const uniformName in this.textureBindings) {
      const texId = this.textureBindings[uniformName]
      this.boundTextureList.push({ name: uniformName, texId, isAudio: texId === "audioTexture" || uniformName === "audioTexture" || uniformName === "u_audioTexture" })
    }
    this.pruneTextures()
    for (const q of this.queueTextures) this.loadTexture(q.id)
    for (const b of this.boundTextureList) if (!b.isAudio) this.loadTexture(b.texId)

    if (this.hasPostProcess && this.canvas) {
      this.ensurePostProcessFramebuffers(this.canvas.width, this.canvas.height)
      this.syncPostProcessPasses(ppSteps)
    } else {
      this.cleanupPostProcessPasses(this.gl)
      this.destroyPostProcessFramebuffers()
      this.ppKey = ""
    }
    this.warmLocations()
  }

  /** Deletes GPU textures that are no longer referenced by the graph. */
  private pruneTextures() {
    const gl = this.gl
    for (const [id, tex] of this.loadedTextures) {
      if (this.isTextureReferenced(id)) continue
      if (gl) gl.deleteTexture(tex)
      this.loadedTextures.delete(id)
    }
  }

  /** Rebuilds programs only when the chain structure (ids / pass types / custom source) changed. */
  private syncPostProcessPasses(steps: PPStep[]) {
    const key = steps.map((s) => s.id + "|" + s.pass + "|" + (s.customSource ?? "")).join("\n")
    if (key === this.ppKey && this.postProcessPasses.length === steps.length) {
      for (let i = 0; i < steps.length; i++) {
        const pass = this.postProcessPasses[i]
        pass.uniforms = { ...getDefaultPostProcessUniforms(steps[i].pass), ...steps[i].uniforms }
        this.registerPassLocs(pass)
      }
      return
    }
    this.rebuildPostProcessPasses(steps)
    this.ppKey = key
  }

  private rebuildPostProcessPasses(steps: PPStep[]) {
    this.cleanupPostProcessPasses(this.gl)
    const gl = this.gl
    if (!gl) return

    for (const step of steps) {
      let fragSource = PASSTHROUGH_FRAGMENT
      switch (step.pass) {
        case "vignette": fragSource = VIGNETTE_FRAGMENT; break
        case "blur": fragSource = BLUR_FRAGMENT; break
        case "chromatic_aberration": fragSource = CHROMATIC_ABERRATION_FRAGMENT; break
        case "bloom": fragSource = BLOOM_FRAGMENT; break
        case "ssao": fragSource = SSAO_FRAGMENT; break
        case "dof": fragSource = DOF_FRAGMENT; break
        case "fxaa": fragSource = FXAA_FRAGMENT; break
        case "taa": fragSource = TAA_FRAGMENT; break
        case "ssr": fragSource = SSR_FRAGMENT; break
        case "custom": fragSource = step.customSource || CUSTOM_GLSL_TEMPLATE; break
        case "passthrough": fragSource = PASSTHROUGH_FRAGMENT; break
      }

      const program = this.createProgram(PASSTHROUGH_VERTEX, fragSource)
      if (program) {
        this.postProcessPasses.push(this.buildPass(program, step.id, step.pass, { ...getDefaultPostProcessUniforms(step.pass), ...step.uniforms }))
      }
    }
    this.refreshActivePasses()
  }

  /** Deletes each pass's program before the collection is emptied. */
  private cleanupPostProcessPasses(gl: WebGL2RenderingContext | null) {
    for (const pass of this.postProcessPasses) {
      if (gl) gl.deleteProgram(pass.program)
    }
    this.postProcessPasses = []
    this.ppKey = ""
    this.refreshActivePasses()
  }

  /** Compiles into a local program first; on failure the previous program keeps rendering. */
  private linkUserProgram(vertSource: string, fragSource: string): boolean {
    if (!this.gl) return false
    const program = this.createProgram(vertSource, fragSource)
    if (!program) return false
    this.userVert = vertSource
    this.userFrag = fragSource
    this.adoptProgram(program)
    return true
  }

  recompileShader(source: string) {
    const gl = this.gl; if (!gl || !this.initialized) return
    const customVert = useProjectStore.getState().vertexShaderSource
    let vertSource = customVert || defaultVertSource, fragSource = source
    if (source.includes("#ifdef FRAGMENT")) { const parts = source.split("#ifdef FRAGMENT"); vertSource = parts[0].replace("// Fragment shader", "").trim(); fragSource = parts[1].replace("#endif", "").trim() }
    if (this.linkUserProgram(vertSource, fragSource)) useProjectStore.getState().setLastCompileError(null)
  }

  updateUniform(name: string, value: UniformValue) {
    const alt = name.startsWith("u_") ? name.slice(2) : `u_${name}`
    this.uniformValues.delete(alt)
    this.uniformValues.set(name, value)
    this.authoritativeUniforms.delete(alt)
    this.authoritativeUniforms.set(name, value)
    if (this.gl && this.program) {
      this.gl.useProgram(this.program)
      const loc = this.findUniformLoc(name)
      if (loc) {
        this.applyUniform(loc, value)
      }
    }
  }

  private syncAuthoritativeUniforms(storeValues: Record<string, UniformValue>) {
    this.authoritativeUniforms.clear()

    // 1. Seed with store values, prioritizing 'u_' prefixed keys for WebGL2 GLSL conventions
    for (const [key, val] of Object.entries(storeValues)) {
      const alt = key.startsWith("u_") ? key.slice(2) : `u_${key}`
      if (this.authoritativeUniforms.has(alt)) {
        if (key.startsWith("u_")) {
          this.authoritativeUniforms.delete(alt)
          this.authoritativeUniforms.set(key, val)
        }
      } else {
        this.authoritativeUniforms.set(key, val)
      }
    }

    // 2. Overlay adapter uniformValues (runtime updates take absolute precedence over store)
    for (const [key, val] of this.uniformValues.entries()) {
      const alt = key.startsWith("u_") ? key.slice(2) : `u_${key}`
      this.authoritativeUniforms.delete(alt)
      this.authoritativeUniforms.set(key, val)
    }

    this.uniformsDirty = true
  }

  resize(width: number, height: number, customDpr?: number) {
    if (!this.canvas || !this.gl) return
    const dpr = customDpr !== undefined ? customDpr : (typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1)
    const canvasWidth = Math.max(1, Math.floor(width * dpr)), canvasHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) return
    this.canvas.width = canvasWidth; this.canvas.height = canvasHeight
    this.gl.viewport(0, 0, canvasWidth, canvasHeight)
    this.ensurePostProcessFramebuffers(canvasWidth, canvasHeight) // FBO sizes follow the canvas; u_resolution is set per pass from it
    if (this.state.pipelineMode === "deferred") {
      this.initGBuffer(canvasWidth, canvasHeight)
    }
  }

  private initShadowMap(resolution: number) {
    const gl = this.gl
    if (!gl) return

    if (this.shadowFBO) gl.deleteFramebuffer(this.shadowFBO)
    if (this.shadowMapTex) gl.deleteTexture(this.shadowMapTex)

    this.shadowFBO = gl.createFramebuffer()
    this.shadowMapTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMapTex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      resolution,
      resolution,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowMapTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private renderShadowPass() {
    const gl = this.gl
    if (!gl || !this.program || !this.vao) return
    const res = this.state.shadowConfig.resolution || 2048
    if (!this.shadowMapTex || !this.shadowFBO) {
      this.initShadowMap(res)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO)
    gl.viewport(0, 0, res, res)
    gl.clear(gl.DEPTH_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
    this.frameStats.drawCalls++; this.frameStats.triangles += this.triCount
    gl.bindVertexArray(null)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas?.width || 800, this.canvas?.height || 600)
  }

  renderFrame(time: number, _delta: number = 16) {
    if (!this.initialized || !this.gl || !this.canvas || !this.program) return
    const stats = this.frameStats
    stats.drawCalls = 0; stats.triangles = 0
    // TODO(W4): shadows are only sampled by the deferred lighting pass today, so the depth pass is
    // skipped unless that consumer exists. W4 wires forward shadow sampling and lifts this guard.
    if (this.shadowSettings.enabled && this.state.pipelineMode === "deferred") {
      this.renderShadowPass()
    }
    this.frameCount++
    if (time - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFrameTime = time
      if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / (this.fps || 1), timestamp: time })
    }
    // Rotation is a pure function of playback time (ms), so seek/pause/export are deterministic.
    const angleX = (time / 1000) * SPIN_X
    const angleY = (time / 1000) * SPIN_Y
    const aspect = this.canvas.width / (this.canvas.height || 1)
    setPerspectiveMatrixGL(this.projMatrix, Math.PI / 4, aspect, 0.1, 100)

    // TAA Jitter application
    if (this.state.postProcessState.taa.enabled) {
      this.taaFrameIndex = (this.taaFrameIndex + 1) % 8
      const jX = (halton(this.taaFrameIndex, 2) - 0.5) / (this.canvas.width || 800)
      const jY = (halton(this.taaFrameIndex, 3) - 0.5) / (this.canvas.height || 600)
      const jitter = this.state.postProcessState.taa.jitterSample
      jitter[0] = jX; jitter[1] = jY
      this.projMatrix[8] += jX * 2.0
      this.projMatrix[9] += jY * 2.0
    }

    setRotationMatrix(this.rotMatrix, angleX, angleY)
    multiplyMatricesInto(this.tempMatrix, this.viewMatrix, this.rotMatrix)
    multiplyMatricesInto(this.mvpMatrix, this.projMatrix, this.tempMatrix)
    const storeValues = useProjectStore.getState().uniformValues
    if (storeValues !== this.lastStoreValues) {
      this.lastStoreValues = storeValues
      this.syncAuthoritativeUniforms(storeValues)
    }

    const gl = this.gl
    const isDeferred = this.state.pipelineMode === "deferred"
    if (isDeferred) {
      if (!this.gBufferFBO) {
        this.initGBuffer(this.canvas.width, this.canvas.height)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBufferFBO)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.clearColor(0.0, 0.0, 0.0, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    } else if (this.hasPostProcess && this.postProcessFramebuffers.length > 0) {
      this.postProcessFramebuffers[0].bind()
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.clearColor(0.08, 0.08, 0.1, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.clearColor(0.08, 0.08, 0.1, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    }

    // Render skybox before mesh if showSkybox is enabled
    if (this.envSettings?.showSkybox && this.skyboxProgram && this.envTexture) {
      gl.disable(gl.DEPTH_TEST)
      if (typeof (gl as any).depthMask === "function") (gl as any).depthMask(false)
      gl.useProgram(this.skyboxProgram)

      const halfTan = Math.tan(Math.PI / 8)
      const V = this.viewMatrix

      const camRightX = V[0] * aspect * halfTan
      const camRightY = V[4] * aspect * halfTan
      const camRightZ = V[8] * aspect * halfTan

      const camUpX = V[1] * halfTan
      const camUpY = V[5] * halfTan
      const camUpZ = V[9] * halfTan

      const camFwdX = -V[2]
      const camFwdY = -V[6]
      const camFwdZ = -V[10]

      const rotRad = ((this.envSettings.rotation || 0) * Math.PI) / 180
      const blur = this.envSettings.backgroundBlur || 0.0
      const exposure = this.envSettings.exposure ?? 1.0

      const locRight = this.skyboxUniformLocations.get("u_camRight")
      if (locRight) gl.uniform3f(locRight, camRightX, camRightY, camRightZ)
      const locUp = this.skyboxUniformLocations.get("u_camUp")
      if (locUp) gl.uniform3f(locUp, camUpX, camUpY, camUpZ)
      const locFwd = this.skyboxUniformLocations.get("u_camForward")
      if (locFwd) gl.uniform3f(locFwd, camFwdX, camFwdY, camFwdZ)
      const locRot = this.skyboxUniformLocations.get("u_rotation")
      if (locRot) gl.uniform1f(locRot, rotRad)
      const locBlur = this.skyboxUniformLocations.get("u_blur")
      if (locBlur) gl.uniform1f(locBlur, blur)
      const locExp = this.skyboxUniformLocations.get("u_exposure")
      if (locExp) gl.uniform1f(locExp, exposure)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.envTexture)
      const locEnv = this.skyboxUniformLocations.get("u_envMap")
      if (locEnv) gl.uniform1i(locEnv, 0)

      gl.bindVertexArray(this.skyboxVAO)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      stats.drawCalls++; stats.triangles++
      gl.bindVertexArray(null)

      gl.enable(gl.DEPTH_TEST)
      if (typeof (gl as any).depthMask === "function") (gl as any).depthMask(true)
    }

    gl.useProgram(this.program)

    if (this.mvpLocation) {
      gl.uniformMatrix4fv(this.mvpLocation, false, this.mvpMatrix)
    }

    // Time uniform update
    const fl = this.frameLocs
    if (fl.time) {
      gl.uniform1f(fl.time, time / 1000)
    }

    if (this.uniformsDirty) {
      let color: number[] = [0.4, 0.6, 0.9]
      const colorVal = this.authoritativeUniforms.get("u_color") || this.authoritativeUniforms.get("color")
      if (colorVal && Array.isArray(colorVal.value)) color = colorVal.value as number[]
      if (this.colorLocation) {
        this.colorBuffer[0] = color[0] ?? 0.4
        this.colorBuffer[1] = color[1] ?? 0.6
        this.colorBuffer[2] = color[2] ?? 0.9
        gl.uniform3fv(this.colorLocation, this.colorBuffer)
      }

      for (const [name, val] of this.authoritativeUniforms.entries()) {
        if (name === "color" || name === "u_color" || name === "u_mvp" || name === "mvp" || name === "time" || name === "u_time") continue
        const loc = this.findUniformLoc(name)
        if (loc) {
          this.applyUniform(loc, val)
        }
      }
      this.uniformsDirty = false
    }

    // Bind textures to texture units
    let activeUnit = 0
    const bound = this.boundTextureList
    for (let i = 0; i < bound.length; i++) {
      const b = bound[i]
      const tex = b.isAudio ? (this.audioTexture || this.defaultTexture) : (this.loadedTextures.get(b.texId) || this.defaultTexture)
      if (tex) {
        gl.activeTexture(gl.TEXTURE0 + activeUnit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        const loc = this.findUniformLoc(b.name)
        if (loc) {
          gl.uniform1i(loc, activeUnit)
        }
        activeUnit++
      }
    }
    for (let i = 0; i < this.queueTextures.length; i++) {
      const qTex = this.queueTextures[i]
      const tex = this.loadedTextures.get(qTex.id) || this.defaultTexture
      if (tex) {
        const unit = qTex.binding ?? activeUnit
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        const loc = this.findUniformLoc(qTex.name) || this.findUniformLoc("u_texture")
        if (loc) {
          gl.uniform1i(loc, unit)
        }
      }
    }

    if (this.hasAudio || this.audioTexture) {
      const au = this.audioUniforms
      if (fl.audio[0]) gl.uniform1f(fl.audio[0], au.bass)
      if (fl.audio[1]) gl.uniform1f(fl.audio[1], au.mid)
      if (fl.audio[2]) gl.uniform1f(fl.audio[2], au.treble)
      if (fl.audio[3]) gl.uniform1f(fl.audio[3], au.level)
      if (fl.audio[4]) gl.uniform1f(fl.audio[4], au.beat)

      if (fl.audioTex && this.audioTexture) {
        gl.activeTexture(gl.TEXTURE0 + activeUnit)
        gl.bindTexture(gl.TEXTURE_2D, this.audioTexture)
        gl.uniform1i(fl.audioTex, activeUnit)
        activeUnit++
      }
    }

    // Bind environment map if shader declares it
    if (fl.env && this.envTexture) {
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, this.envTexture)
      gl.uniform1i(fl.env, 7)
    }
    if (fl.envExp) {
      const exp = useProjectStore.getState().environmentSettings?.exposure ?? 1.0
      gl.uniform1f(fl.envExp, exp)
    }
    if (fl.envRot) {
      const rot = useProjectStore.getState().environmentSettings?.rotation ?? 0.0
      gl.uniform1f(fl.envRot, (rot * Math.PI) / 180)
    }

    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount); gl.bindVertexArray(null)
    stats.drawCalls++; stats.triangles += this.triCount

    if (isDeferred) {
      if (this.hasPostProcess && this.postProcessFramebuffers.length > 0) {
        this.postProcessFramebuffers[0].bind()
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      this.renderDeferredPass()
    }

    if (this.hasPostProcess && this.postProcessFramebuffers.length >= 2) {
      this.ensureQuad()
      const passes = this.activePasses
      const numPasses = passes.length
      let currentRead = 0

      for (let i = 0; i < numPasses; i++) {
        const pass = passes[i]
        const isFinal = (i === numPasses - 1)

        if (isFinal) {
          this.postProcessFramebuffers[currentRead].unbind()
          gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        } else {
          this.postProcessFramebuffers[1 - currentRead].bind()
          gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        }

        gl.useProgram(pass.program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.postProcessFramebuffers[currentRead].getTexture())

        const locs = pass.uniformLocations
        const locTex = locs.get("u_texture")
        if (locTex) gl.uniform1i(locTex, 0)

        this.bindAux(locs.get("u_depthTexture"), 1, this.gBufferDepthTex)
        this.bindAux(locs.get("u_normalTexture"), 2, this.gBufferNormalTex)
        this.bindAux(locs.get("u_motionTexture"), 3, this.gBufferMotionTex)
        this.bindAux(locs.get("u_historyTexture"), 4, this.postProcessFramebuffers[1 - currentRead]?.getTexture() || this.defaultTexture)

        const locRes = locs.get("u_resolution")
        if (locRes) gl.uniform2f(locRes, this.canvas.width, this.canvas.height)

        for (const uName in pass.uniforms) {
          const uVal = pass.uniforms[uName]
          const loc = locs.get(uName)
          if (loc && typeof uVal === "number") {
            gl.uniform1f(loc, uVal)
          }
        }

        gl.bindVertexArray(this.quadVAO)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        stats.drawCalls++; stats.triangles += 2
        gl.bindVertexArray(null)

        if (!isFinal) {
          currentRead = 1 - currentRead
        }
      }
    }

    performanceTelemetry.reportFrameStats(stats)
  }

  private bindAux(loc: WebGLUniformLocation | null | undefined, unit: number, tex: WebGLTexture | null) {
    const gl = this.gl
    if (!gl || !loc) return
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex || this.defaultTexture)
    gl.uniform1i(loc, unit)
  }

  private ensureQuad() {
    const gl = this.gl
    if (!gl || this.quadVAO) return
    this.quadVAO = gl.createVertexArray()
    gl.bindVertexArray(this.quadVAO)
    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  private renderDeferredPass() {
    const gl = this.gl
    if (!gl) return

    this.ensureQuad()

    if (!this.deferredLightingProgram) {
      const vsSource = DEFERRED_VERT
      const fsSource = DEFERRED_FRAG
      this.deferredLightingProgram = this.createProgram(vsSource, fsSource)
      this.deferredLocs.clear()
      if (this.deferredLightingProgram) for (const n of DEFERRED_NAMES) this.deferredLocs.set(n, gl.getUniformLocation(this.deferredLightingProgram, n))
    }

    if (!this.deferredLightingProgram) return
    const loc = this.deferredLocs

    gl.useProgram(this.deferredLightingProgram)
    gl.bindVertexArray(this.quadVAO)

    this.bindAux(loc.get("u_albedoTex"), 0, this.gBufferAlbedoTex)
    this.bindAux(loc.get("u_normalTex"), 1, this.gBufferNormalTex)
    this.bindAux(loc.get("u_roughnessTex"), 2, this.gBufferRoughnessTex)
    this.bindAux(loc.get("u_depthTex"), 3, this.gBufferDepthTex)
    this.bindAux(loc.get("u_motionTex"), 4, this.gBufferMotionTex)
    this.bindAux(loc.get("u_shadowMap"), 5, this.shadowMapTex)
    this.bindAux(loc.get("u_envMap"), 6, this.envTexture)

    const debugLoc = loc.get("u_debugView")
    if (debugLoc) gl.uniform1i(debugLoc, DEBUG_VIEW_CODES[this.gBufferDebugView] ?? 0)

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

    const lightDirLoc = loc.get("u_lightDir")
    if (lightDirLoc) gl.uniform3f(lightDirLoc, lDirX, lDirY, lDirZ)
    const lightColLoc = loc.get("u_lightColor")
    if (lightColLoc) gl.uniform3f(lightColLoc, lColR, lColG, lColB)
    const lightIntLoc = loc.get("u_lightIntensity")
    if (lightIntLoc) gl.uniform1f(lightIntLoc, lInt)
    const shadowEnLoc = loc.get("u_shadowEnabled")
    if (shadowEnLoc) gl.uniform1f(shadowEnLoc, this.shadowSettings.enabled ? 1.0 : 0.0)
    const envExpLoc = loc.get("u_envExposure")
    if (envExpLoc) gl.uniform1f(envExpLoc, useProjectStore.getState().environmentSettings?.exposure ?? 1.0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
    this.frameStats.drawCalls++; this.frameStats.triangles += 2
    gl.bindVertexArray(null)
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

  updatePostProcessUniform(nodeId: string, name: string, value: number | number[]) {
    const pass = this.postProcessPasses.find(p => p.id === nodeId || p.passType === nodeId)
    if (!pass) return
    const numericVal = typeof value === "number" ? value : Number(value[0]) || 0
    pass.uniforms[name] = numericVal
    const prefixed = name.startsWith("u_") ? name : `u_${name}`
    pass.uniforms[prefixed] = numericVal
    this.registerPassLocs(pass) // new names are resolved here, never inside the frame loop
    renderCoordinator.requestRender()
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  private setupSkyboxPipeline() {
    const gl = this.gl
    if (!gl) return
    try {
      this.skyboxProgram = this.createProgram(skyboxVertSource, skyboxFragSource)
      if (this.skyboxProgram) {
        this.skyboxVAO = gl.createVertexArray()
        for (const name of SKYBOX_NAMES) {
          this.skyboxUniformLocations.set(name, gl.getUniformLocation(this.skyboxProgram, name))
        }
      }
    } catch (e) {
      console.warn("Failed to setup WebGL2 skybox pipeline:", e)
    }
  }

  private async loadCustomEnvironment(src: string, expectedPreset?: string) {
    if (!this.gl || !this.initialized) return
    const gen = this.ctxGen
    try {
      const res = await fetch(src)
      if (!res.ok) return
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.gl || !this.initialized || gen !== this.ctxGen) return
      if (expectedPreset && this.currentEnvPreset !== expectedPreset) return

      const gl = this.gl
      if (this.envTexture) {
        gl.deleteTexture(this.envTexture)
        this.envTexture = null
      }
      const tex = gl.createTexture()
      if (tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        this.envTexture = tex
        renderCoordinator.requestRender()
      }
    } catch {
      // Safe fallback for offline or headless tests
    }
  }

  updateEnvironment(settings: EnvironmentSettings) {
    this.envSettings = { ...settings }
    if (!this.gl) return
    const gl = this.gl

    const isCustom = settings.preset === "custom"
    const customSrcChanged = isCustom && settings.customTextureSrc !== this.lastCustomTextureSrc

    if (this.currentEnvPreset !== settings.preset || !this.envTexture || customSrcChanged) {
      this.currentEnvPreset = settings.preset
      this.lastCustomTextureSrc = settings.customTextureSrc
      if (this.envTexture) {
        gl.deleteTexture(this.envTexture)
        this.envTexture = null
      }

      if (isCustom && settings.customTextureSrc) {
        this.loadCustomEnvironment(settings.customTextureSrc, "custom")
        return
      }

      const presetMeta = ENVIRONMENT_PRESETS.find((p) => p.id === settings.preset)
      const imgSrc = presetMeta?.imageSrc
      if (imgSrc && typeof window !== "undefined" && typeof fetch === "function") {
        this.loadCustomEnvironment(imgSrc, settings.preset)
      }

      const rgba = generateEnvironmentRGBA(settings.preset, 512, 256)
      const tex = gl.createTexture()
      if (tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        this.envTexture = tex
      }
    }

    if (settings.showSkybox) {
      if (!this.skyboxProgram) {
        this.setupSkyboxPipeline()
      }
    } else {
      this.cleanupSkyboxPipeline()
    }
  }

  private cleanupSkyboxPipeline() {
    const gl = this.gl
    if (gl) {
      if (this.skyboxProgram) gl.deleteProgram(this.skyboxProgram)
      if (this.skyboxVAO) gl.deleteVertexArray(this.skyboxVAO)
    }
    this.skyboxProgram = null
    this.skyboxVAO = null
    this.skyboxUniformLocations.clear()
  }

  private initGBuffer(width: number, height: number) {
    const gl = this.gl
    if (!gl) return

    if (this.gBufferFBO) gl.deleteFramebuffer(this.gBufferFBO)
    if (this.gBufferAlbedoTex) gl.deleteTexture(this.gBufferAlbedoTex)
    if (this.gBufferNormalTex) gl.deleteTexture(this.gBufferNormalTex)
    if (this.gBufferRoughnessTex) gl.deleteTexture(this.gBufferRoughnessTex)
    if (this.gBufferDepthTex) gl.deleteTexture(this.gBufferDepthTex)
    if (this.gBufferMotionTex) gl.deleteTexture(this.gBufferMotionTex)

    this.gBufferFBO = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBufferFBO)

    this.gBufferAlbedoTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferAlbedoTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gBufferAlbedoTex, 0)

    this.gBufferNormalTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferNormalTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, (gl as any).RGBA16F || gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, (gl as any).COLOR_ATTACHMENT1 || gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gBufferNormalTex, 0)

    this.gBufferRoughnessTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferRoughnessTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, (gl as any).RGBA16F || gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, (gl as any).COLOR_ATTACHMENT2 || gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gBufferRoughnessTex, 0)

    this.gBufferMotionTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferMotionTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, (gl as any).RG16F || gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    this.gBufferDepthTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferDepthTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.gBufferDepthTex, 0)

    if (gl.drawBuffers) {
      gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        (gl as any).COLOR_ATTACHMENT1 || gl.COLOR_ATTACHMENT0,
        (gl as any).COLOR_ATTACHMENT2 || gl.COLOR_ATTACHMENT0,
      ])
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    setTexMeta(this.gBufferAlbedoTex, "rgba8unorm", width, height)
    setTexMeta(this.gBufferNormalTex, "rgba16float", width, height)
    setTexMeta(this.gBufferRoughnessTex, "rg8unorm", width, height)
    setTexMeta(this.gBufferDepthTex, "depth24plus-stencil8", width, height)
    setTexMeta(this.gBufferMotionTex, "rg16float", width, height)

    this.state.gBufferTargets = {
      albedo: this.gBufferAlbedoTex,
      normal: this.gBufferNormalTex,
      roughnessMetallic: this.gBufferRoughnessTex,
      depth: this.gBufferDepthTex,
      motionVectors: this.gBufferMotionTex,
    }
  }

  setRenderingPipelineMode(mode: RenderingPipelineMode) {
    this.state.pipelineMode = mode
    if (mode === "deferred") {
      const width = this.canvas?.width || 1920
      const height = this.canvas?.height || 1080
      this.initGBuffer(width, height)
      if (!this.state.gBufferTargets) {
        this.state.gBufferTargets = {
          albedo: this.gBufferAlbedoTex || { format: "rgba8unorm", width, height },
          normal: this.gBufferNormalTex || { format: "rgba16float", width, height },
          roughnessMetallic: this.gBufferRoughnessTex || { format: "rg8unorm", width, height },
          depth: this.gBufferDepthTex || { format: "depth24plus-stencil8", width, height },
          motionVectors: this.gBufferMotionTex || { format: "rg16float", width, height },
        }
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
    if (this.gl && config.resolution) {
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
    if (this.gl && settings.resolution) {
      this.initShadowMap(settings.resolution)
    }
  }

  getShadowSettings(): ShadowSettings {
    return this.shadowSettings
  }

  setPointLightShadowCube(enabled: boolean) {
    this.state.pointShadowCubeEnabled = enabled
    const gl = this.gl
    if (enabled) {
      if (gl && !this.shadowCubeMapTex) {
        this.shadowCubeMapTex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.shadowCubeMapTex)
        for (let i = 0; i < 6; i++) {
          gl.texImage2D(
            gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
            0,
            gl.DEPTH_COMPONENT24,
            512,
            512,
            0,
            gl.DEPTH_COMPONENT,
            gl.UNSIGNED_INT,
            null
          )
        }
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)
      } else if (!gl && !this.shadowCubeMapTex) {
        this.shadowCubeMapTex = { width: 512, height: 512, isCube: true } as any
      }
    } else {
      this.shadowCubeMapTex = null
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
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.isExternalLoopDriven = false
    this.ctxGen++
    if (this.canvas) { this.canvas.removeEventListener("webglcontextlost", this.handleContextLost); this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored) }
    if (this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel()
      this.unsubscribeCustomModel = null
    }
    const gl = this.gl
    this.releaseGpuState(true)
    // Browsers cap live WebGL contexts (~16); release this one explicitly instead of waiting for GC.
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext() } catch { /* already lost */ }
    this.hasAudio = false
    this.queueTextures = []
    this.boundTextureList = []
    this.textureBindings = {}
    this.lastQueue = null
    this.userVert = this.userFrag = null
    this.initialized = false; this.gl = null; this.canvas = null
    this.uniformValues.clear()
    this.authoritativeUniforms.clear()
    this.lastStoreValues = null
    this.uniformsDirty = true
  }
}

export const webgl2Adapter = new WebGL2Adapter()
