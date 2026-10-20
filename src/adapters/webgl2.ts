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
  RenderSettings,
  RenderToTargetRequest,
  FidelityCapabilities,
  ShadowFilterMode,
  DetailedGpuMetrics,
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
import fullscreenVert from "../shaders/fidelity/fullscreen.vert?raw"
import gbufferVert from "../shaders/fidelity/gbuffer.vert?raw"
import gbufferFrag from "../shaders/fidelity/gbuffer.frag?raw"
import depthVert from "../shaders/fidelity/depth.vert?raw"
import depthFrag from "../shaders/fidelity/depth.frag?raw"
import forwardLitVert from "../shaders/fidelity/forward_lit.vert?raw"
import forwardLitFrag from "../shaders/fidelity/forward_lit.frag?raw"
import lightingFrag from "../shaders/fidelity/lighting.frag?raw"
import skyFrag from "../shaders/fidelity/sky.frag?raw"
import ssaoFrag from "../shaders/fidelity/ssao.frag?raw"
import ssrFrag from "../shaders/fidelity/ssr.frag?raw"
import dofFrag from "../shaders/fidelity/dof.frag?raw"
import taaFrag from "../shaders/fidelity/taa.frag?raw"
import compositeFrag from "../shaders/fidelity/composite.frag?raw"
import vsmFrag from "../shaders/fidelity/vsm.frag?raw"
import envChunk from "../shaders/fidelity/env.glsl?raw"
import shadowChunk from "../shaders/fidelity/shadow.glsl?raw"
import lightingChunk from "../shaders/fidelity/lighting.glsl?raw"
import skyChunk from "../shaders/fidelity/sky.glsl?raw"
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
const EYE: [number, number, number] = [0, 2, 4]
const TARGET: [number, number, number] = [0, 0, 0]
const UP: [number, number, number] = [0, 1, 0]
const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])
const IDENTITY_F32 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const EYE_X = EYE[0], EYE_Y = EYE[1], EYE_Z = EYE[2]

// ---------------------------------------------------------------------------------------------
// Fidelity layer (W4). Frame pass order, every stage optional and settings driven:
//   1. shadow    directional depth map (+ VSM moments, + point-light cube faces)
//   2. geometry  G-buffer MRT (deferred) or the same MRT as a depth/normal/motion pre-pass (forward,
//                only when SSAO / SSR / DoF / TAA need it)
//   3. SSAO      -> aoTex, consumed by the deferred lighting pass (forward: multiplied in at stage 4)
//   4. lighting  deferred full-screen lighting | forward scene (sky, shadow-catcher ground, mesh)
//   5. SSR  ->  6. DoF  ->  7. AA (FXAA | TAA)  ->  8. user post-process chain (final to screen)
// ---------------------------------------------------------------------------------------------
type FxKey = "gbuffer" | "depth" | "forwardLit" | "lighting" | "sky" | "ssao" | "ssr" | "dof" | "taa" | "fxaa" | "composite" | "vsm"
interface FxProgram { program: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }
const CHUNKS: Record<string, string> = { env: envChunk, shadow: shadowChunk, lighting: lightingChunk, sky: skyChunk }
const expandIncludes = (src: string): string => {
  let s = src
  for (let i = 0; i < 3 && s.includes("//#include"); i++) s = s.replace(/\/\/#include (\w+)/g, (_m, n: string) => CHUNKS[n] ?? "")
  return s
}
const LIGHT_NAMES = [
  "u_envMap", "u_envExposure", "u_shadowMap", "u_shadowMoments", "u_shadowCubeMap", "u_lightVP", "u_shadowParams", "u_pointLight",
  "u_pointParams", "u_shadowEnabled", "u_lightDir", "u_lightColor", "u_lightIntensity", "u_camPos", "u_pointColor",
]
const FX_DEFS: Record<FxKey, { vs: string; fs: string; names: string[] }> = {
  gbuffer: { vs: gbufferVert, fs: gbufferFrag, names: ["u_mvp", "u_mvpUnjit", "u_prevMvp", "u_model", "u_color", "u_camPos", "u_roughness", "u_metallic"] },
  depth: { vs: depthVert, fs: depthFrag, names: ["u_mvp"] },
  forwardLit: { vs: forwardLitVert, fs: forwardLitFrag, names: ["u_mvp", "u_model", "u_color", "u_roughness", "u_metallic", ...LIGHT_NAMES] },
  lighting: {
    vs: fullscreenVert, fs: lightingFrag,
    names: ["u_albedoTex", "u_normalTex", "u_roughnessTex", "u_depthTex", "u_motionTex", "u_aoTex", "u_invViewProj", "u_debugView", "u_aoEnabled",
      "u_bgMode", "u_bgColor", "u_camRight", "u_camUp", "u_camForward", "u_sunDir", "u_skyParams", ...LIGHT_NAMES],
  },
  sky: { vs: fullscreenVert, fs: skyFrag, names: ["u_camRight", "u_camUp", "u_camForward", "u_sunDir", "u_skyParams"] },
  ssao: { vs: fullscreenVert, fs: ssaoFrag, names: ["u_depthTexture", "u_normalTexture", "u_proj", "u_invProj", "u_view", "u_resolution", "u_radius", "u_intensity", "u_sampleCount", "u_bias"] },
  ssr: {
    vs: fullscreenVert, fs: ssrFrag,
    names: ["u_texture", "u_depthTexture", "u_normalTexture", "u_proj", "u_invProj", "u_view", "u_invView", "u_maxSteps", "u_thickness", "u_falloff", "u_iblBlend", "u_envMap", "u_envExposure"],
  },
  dof: { vs: fullscreenVert, fs: dofFrag, names: ["u_texture", "u_depthTexture", "u_resolution", "u_focalDistance", "u_aperture", "u_maxBlur", "u_bokehShape", "u_near", "u_far"] },
  taa: { vs: fullscreenVert, fs: taaFrag, names: ["u_texture", "u_historyTexture", "u_motionTexture", "u_resolution", "u_historyValid", "u_feedback"] },
  fxaa: { vs: PASSTHROUGH_VERTEX, fs: FXAA_FRAGMENT, names: ["u_texture", "u_resolution", "u_fxaaQualitySubpix", "u_fxaaQualityEdgeThreshold", "u_fxaaQualityEdgeThresholdMin"] },
  composite: { vs: fullscreenVert, fs: compositeFrag, names: ["u_texture", "u_aoTex", "u_aoStrength"] },
  vsm: { vs: fullscreenVert, fs: vsmFrag, names: ["u_shadowMap"] },
}
const ST_AO = 1, ST_SSR = 2, ST_DOF = 3, ST_FXAA = 4, ST_TAA = 5
// Texture units. G-buffer 0-4, AO 5, env 6/7, shadow resources 10-12 (shared with user shaders that declare the uniforms).
const U_AO = 5, U_ENV = 6, U_SHADOW = 10, U_MOMENTS = 11, U_CUBE = 12
const POINT_SHADOW_RES = 512
const POINT_DEFAULT: [number, number, number] = [2, 3, 2]
const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const FACE_UPS: Array<[number, number, number]> = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]]
const GROUND_Y = -1.2
const GROUND_VERTS = new Float32Array([-6, GROUND_Y, -6, 6, GROUND_Y, -6, 6, GROUND_Y, 6, -6, GROUND_Y, -6, 6, GROUND_Y, 6, -6, GROUND_Y, 6])
const RTT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
out vec2 v_texCoord;
out vec2 v_clip;
void main() {
  v_clip = a_position;
  v_uv = a_position * 0.5 + 0.5;
  v_texCoord = v_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`
const RTT_CACHE_MAX = 12
const TIMER_SLOTS = 24

function hashSource(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16) + ":" + s.length
}

/** General 4x4 inverse (column-major). Returns identity for singular input. */
function invertMat4(out: Float32Array, m: Float32Array): Float32Array {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7]
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15]
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) { out.set(IDENTITY_F32); return out }
  det = 1 / det
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return out
}

function setOrthoGL(out: Float32Array, l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  out.fill(0)
  out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n)
  out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1
  return out
}

function sameShallowEq(a: object, b: object): boolean {
  const ak = Object.keys(a) as Array<keyof typeof a>, bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (a[k] !== (b as typeof a)[k]) return false
  return true
}

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

  private mvpMatrix = new Float32Array(16)
  private colorBuffer = new Float32Array(3)
  // Scratch buffers so applyUniform never allocates
  private scratch2 = new Float32Array(2)
  private scratch3 = new Float32Array(3)
  private scratch4 = new Float32Array(4)
  private scratchM2 = new Float32Array(4)
  private scratchM3 = new Float32Array(9)
  private scratchM4 = new Float32Array(16)
  private frameStats: { drawCalls: number; triangles: number; passTimings?: DetailedGpuMetrics["passTimings"] } = { drawCalls: 0, triangles: 0 }
  private inFrame = false
  // Fidelity (W4) CPU/GPU state
  private invViewMatrix = invertMat4(new Float32Array(16), this.viewMatrix)
  private vpJit = new Float32Array(16)
  private vpUnjit = new Float32Array(16)
  private mvpUnjit = new Float32Array(16)
  private prevMvp = new Float32Array(16)
  private prevValid = false
  private invViewProj = new Float32Array(16)
  private invProj = new Float32Array(16)
  private lightView = new Float32Array(16)
  private lightProj = new Float32Array(16)
  private lightVP = new Float32Array(16)
  private cubeView = new Float32Array(16)
  private cubeProj = new Float32Array(16)
  private cubeVP = Array.from({ length: 6 }, () => new Float32Array(16))
  private shadowMvp = new Float32Array(16)
  private eyeT: [number, number, number] = [0, 0, 0]
  private tgtT: [number, number, number] = [0, 0, 0]
  private upT: [number, number, number] = [0, 1, 0]
  private pointPos = new Float32Array(3)
  private pointNear = 0.1
  private pointFar = 50
  private lightDirty = true
  private sunDir = new Float32Array([0, 1, 0])
  private stageBuf = new Int8Array(6)
  private gbAll = [0x8ce0, 0x8ce1, 0x8ce2, 0x8ce3]
  private gbAlbedoOnly = [0x8ce0, 0, 0, 0]
  private floatTargets = false
  private gBufferComplete = false
  private gbW = 0
  private gbH = 0
  private fxPrograms = new Map<FxKey, FxProgram | null>()
  private aoFB: WebGL2Framebuffer | null = null
  private taaHist: WebGL2Framebuffer[] = []
  private taaRead = 0
  private taaHistoryValid = false
  private ssaoBias = 0.025
  private dofMaxBlur = 8
  private shadowRes = 0
  private vsmFBO: WebGLFramebuffer | null = null
  private vsmTex: WebGLTexture | null = null
  private vsmRes = 0
  private shadowCubeFBO: WebGLFramebuffer | null = null
  private pointCubeReady = false
  private groundVAO: WebGLVertexArrayObject | null = null
  private groundBuffer: WebGLBuffer | null = null
  private lastApplied: RenderSettings | null = null
  private rttQueue: Promise<unknown> = Promise.resolve()
  private rttPrograms = new Map<string, { program: WebGLProgram; res: WebGLUniformLocation | null; time: WebGLUniformLocation | null; locs: Map<string, WebGLUniformLocation | null> }>()
  private rttFBO: WebGLFramebuffer | null = null
  private rttTex: WebGLTexture | null = null
  private rttW = 0
  private rttH = 0
  private timer: {
    ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    queries: WebGLQuery[]
    keys: Array<keyof DetailedGpuMetrics["passTimings"]>
    busy: Uint8Array
    activeSlot: number
    out: DetailedGpuMetrics["passTimings"]
    has: boolean
  } | null = null
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
    shadow: {
      map: null as WebGLUniformLocation | null, moments: null as WebGLUniformLocation | null, cube: null as WebGLUniformLocation | null,
      lightVP: null as WebGLUniformLocation | null, params: null as WebGLUniformLocation | null, enabled: null as WebGLUniformLocation | null,
    },
  }
  private resolvedLocs = new Map<string, WebGLUniformLocation | null>()
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
  deferredLightingProgram: WebGLProgram | null = null


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
    this.deferredLightingProgram = null // owned by fxPrograms
    del(this.vao, (o) => gl!.deleteVertexArray(o)); this.vao = null
    del(this.vertexBuffer, (o) => gl!.deleteBuffer(o)); this.vertexBuffer = null
    del(this.quadVAO, (o) => gl!.deleteVertexArray(o)); this.quadVAO = null
    del(this.quadBuffer, (o) => gl!.deleteBuffer(o)); this.quadBuffer = null
    for (const fx of this.fxPrograms.values()) if (fx && gl) gl.deleteProgram(fx.program)
    this.fxPrograms.clear()
    for (const e of this.rttPrograms.values()) if (gl) gl.deleteProgram(e.program)
    this.rttPrograms.clear()
    del(this.rttFBO, (o) => gl!.deleteFramebuffer(o)); this.rttFBO = null
    del(this.rttTex, (o) => gl!.deleteTexture(o)); this.rttTex = null
    this.rttW = this.rttH = 0
    del(this.groundVAO, (o) => gl!.deleteVertexArray(o)); this.groundVAO = null
    del(this.groundBuffer, (o) => gl!.deleteBuffer(o)); this.groundBuffer = null
    del(this.shadowCubeFBO, (o) => gl!.deleteFramebuffer(o)); this.shadowCubeFBO = null
    if (live) this.releaseTimers(); else this.timer = null
    if (this.aoFB && gl) this.aoFB.destroy()
    this.aoFB = null
    for (const fb of this.taaHist) if (gl) fb.destroy()
    this.taaHist = []; this.taaHistoryValid = false; this.taaRead = 0; this.prevValid = false
    this.releaseGBuffer(live)
    this.releaseShadows()
    this.pointCubeReady = false
    this.cleanupPostProcessPasses(gl)
    del(this.defaultPass, (o) => gl!.deleteProgram(o.program)); this.defaultPass = null
    for (const fb of this.postProcessFramebuffers) if (gl) fb.destroy()
    this.postProcessFramebuffers = []
    for (const tex of this.loadedTextures.values()) if (gl) gl.deleteTexture(tex)
    this.loadedTextures.clear()
    for (const k of ["defaultTexture", "envTexture", "audioTexture", "shadowCubeMapTex"] as const) {
      del(this[k], (o) => gl!.deleteTexture(o)); this[k] = null
    }
    this.currentEnvPreset = null
    this.lastCustomTextureSrc = undefined
    this.audioMirrorValid = false
    this.mvpLocation = this.colorLocation = null
    this.uniformLocations.clear(); this.resolvedLocs.clear(); this.skyboxUniformLocations.clear()
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
    this.floatTargets = !!this.gl!.getExtension("EXT_color_buffer_float")
    this.initTimers()
    this.updateSunDir()
    this.refreshFidelity()
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
    f.shadow.map = this.getUniformLoc("u_shadowMap"); f.shadow.moments = this.getUniformLoc("u_shadowMoments"); f.shadow.cube = this.getUniformLoc("u_shadowCubeMap")
    f.shadow.lightVP = this.getUniformLoc("u_lightVP"); f.shadow.params = this.getUniformLoc("u_shadowParams"); f.shadow.enabled = this.getUniformLoc("u_shadowEnabled")
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
  private createProgram(vertexSource: string, fragmentSource: string, report = true): WebGLProgram | null {
    const gl = this.gl; if (!gl) return null
    const fail = (message: string): null => { if (report) useProjectStore.getState().setLastCompileError(message); return null }
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
    if (!this.hasPostProcess && this.fillStages() === 0) { this.destroyPostProcessFramebuffers(); return }
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
    this.taaHistoryValid = false
    this.refreshFidelity() // every screen-sized target follows the canvas; u_resolution is set per pass from it
  }

  // ---------------------------------------------------------------------------------------------
  // Fidelity: programs, resources, uniform helpers
  // ---------------------------------------------------------------------------------------------
  private fxProgram(key: FxKey): FxProgram | null {
    const hit = this.fxPrograms.get(key)
    if (hit !== undefined) return hit
    const gl = this.gl; if (!gl) return null
    const def = FX_DEFS[key]
    const program = this.createProgram(expandIncludes(def.vs), expandIncludes(def.fs))
    let fx: FxProgram | null = null
    if (program) {
      fx = { program, locs: new Map() }
      for (const n of def.names) fx.locs.set(n, gl.getUniformLocation(program, n)) // resolved once, at link
    }
    this.fxPrograms.set(key, fx)
    if (key === "lighting") this.deferredLightingProgram = program
    return fx
  }

  private u1f(fx: FxProgram, name: string, v: number) { const l = fx.locs.get(name); if (l) this.gl!.uniform1f(l, v) }
  private u1i(fx: FxProgram, name: string, v: number) { const l = fx.locs.get(name); if (l) this.gl!.uniform1i(l, v) }
  private u2f(fx: FxProgram, name: string, x: number, y: number) { const l = fx.locs.get(name); if (l) this.gl!.uniform2f(l, x, y) }
  private u3f(fx: FxProgram, name: string, x: number, y: number, z: number) { const l = fx.locs.get(name); if (l) this.gl!.uniform3f(l, x, y, z) }
  private u4f(fx: FxProgram, name: string, x: number, y: number, z: number, w: number) { const l = fx.locs.get(name); if (l) this.gl!.uniform4f(l, x, y, z, w) }
  private uM4(fx: FxProgram, name: string, m: Float32Array) { const l = fx.locs.get(name); if (l) this.gl!.uniformMatrix4fv(l, false, m) }
  private tex(fx: FxProgram, name: string, unit: number, t: WebGLTexture | null) { this.bindAux(fx.locs.get(name), unit, t) }

  private bindCube(loc: WebGLUniformLocation | null | undefined, unit: number, t: WebGLTexture | null) {
    const gl = this.gl
    if (!gl || !loc) return
    if (t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t) } // unbound = valid, never sampled when disabled
    gl.uniform1i(loc, unit)
  }

  /** True only when the cube map is rendered this frame and will be sampled. */
  private pointShadowSampled(): boolean {
    return this.state.pointShadowCubeEnabled && this.pointCubeReady && this.shadowSettings.enabled
  }

  private numUniform(name: string, fallback: number): number {
    const v = (this.authoritativeUniforms.get("u_" + name) ?? this.authoritativeUniforms.get(name))?.value
    return typeof v === "number" && Number.isFinite(v) ? v : fallback
  }

  /** Albedo colour shared by every built-in program (mirrors what the default fragment shader draws). */
  private resolveColor() {
    const v = (this.authoritativeUniforms.get("u_color") ?? this.authoritativeUniforms.get("color"))?.value
    const c = Array.isArray(v) ? (v as number[]) : null
    this.colorBuffer[0] = c?.[0] ?? 0.4; this.colorBuffer[1] = c?.[1] ?? 0.6; this.colorBuffer[2] = c?.[2] ?? 0.9
  }

  private drawQuad() {
    const gl = this.gl!
    gl.bindVertexArray(this.quadVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    this.frameStats.drawCalls++; this.frameStats.triangles += 2
  }

  private bindTarget(fb: WebGL2Framebuffer | null, w: number, h: number) {
    const gl = this.gl!
    if (fb) fb.bind(); else gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
  }

  private needsGeometry(): boolean {
    const p = this.state.postProcessState
    return this.state.pipelineMode === "deferred" || p.ssao.enabled || p.ssr.enabled || p.dof.enabled || p.taa.enabled
  }

  /** Stages that read/write the scene ping-pong chain (deferred SSAO is consumed by lighting instead). */
  private fillStages(): number {
    const p = this.state.postProcessState, s = this.stageBuf
    let n = 0
    if (this.state.pipelineMode !== "deferred" && p.ssao.enabled) s[n++] = ST_AO
    if (p.ssr.enabled) s[n++] = ST_SSR
    if (p.dof.enabled) s[n++] = ST_DOF
    if (p.fxaa.enabled) s[n++] = ST_FXAA
    if (p.taa.enabled) s[n++] = ST_TAA
    return n
  }

  /**
   * Idempotent: reconciles every GPU resource with the current settings. Allocates what is needed, frees
   * what is not, and touches nothing whose size/kind is unchanged. No-op before mount.
   */
  private refreshFidelity() {
    const gl = this.gl, canvas = this.canvas
    if (!gl || !canvas) return
    const w = Math.max(1, canvas.width), h = Math.max(1, canvas.height)
    const p = this.state.postProcessState
    const needGeo = this.needsGeometry()
    // Deferred owns a persistent G-buffer. Forward frees it here and re-creates the pre-pass buffers lazily
    // in the frame, and only while a screen-space effect still needs them.
    if (this.state.pipelineMode === "deferred" && needGeo) { if (!this.gBufferFBO || this.gbW !== w || this.gbH !== h) this.initGBuffer(w, h) } else this.releaseGBuffer()
    this.publishGBufferTargets()
    if (p.ssao.enabled && needGeo) { this.aoFB ??= new WebGL2Framebuffer(gl); this.aoFB.resize(w, h) } else if (this.aoFB) { this.aoFB.destroy(); this.aoFB = null }
    if (p.taa.enabled) {
      if (this.taaHist.length !== 2) { this.taaHist = [new WebGL2Framebuffer(gl), new WebGL2Framebuffer(gl)]; this.taaHistoryValid = false }
      for (const fb of this.taaHist) fb.resize(w, h)
    } else if (this.taaHist.length) { for (const fb of this.taaHist) fb.destroy(); this.taaHist = []; this.taaHistoryValid = false }
    this.ensurePostProcessFramebuffers(w, h)
    if (this.shadowSettings.enabled) {
      const res = this.state.shadowConfig.resolution || 2048
      if (!this.shadowMapTex || !this.shadowFBO || this.shadowRes !== res) this.initShadowMap(res)
      if (this.shadowSettings.filterMode === "vsm" && this.floatTargets) this.ensureVsm(res)
      else this.releaseVsm()
    } else this.releaseShadows()
    this.lightDirty = true
  }

  // ---------------------------------------------------------------------------------------------
  // Shadows
  // ---------------------------------------------------------------------------------------------
  private initShadowMap(resolution: number) {
    const gl = this.gl
    if (!gl) return
    if (this.shadowMapTex && this.shadowFBO && this.shadowRes === resolution) return
    if (this.shadowFBO) gl.deleteFramebuffer(this.shadowFBO)
    if (this.shadowMapTex) gl.deleteTexture(this.shadowMapTex)
    this.releaseVsm()

    this.shadowFBO = gl.createFramebuffer()
    this.shadowMapTex = gl.createTexture()
    this.shadowRes = resolution
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMapTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, resolution, resolution, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowMapTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    setTexMeta(this.shadowMapTex, "depth24plus", resolution, resolution)
  }

  private ensureVsm(res: number) {
    const gl = this.gl
    if (!gl || (this.vsmFBO && this.vsmTex && this.vsmRes === res)) return
    this.releaseVsm()
    this.vsmRes = res
    this.vsmFBO = gl.createFramebuffer()
    this.vsmTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.vsmTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, res, res, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.vsmFBO)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vsmTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private releaseVsm() {
    const gl = this.gl
    if (gl && this.vsmFBO) gl.deleteFramebuffer(this.vsmFBO)
    if (gl && this.vsmTex) gl.deleteTexture(this.vsmTex)
    this.vsmFBO = null; this.vsmTex = null; this.vsmRes = 0
  }

  private releaseShadows() {
    const gl = this.gl
    if (gl && this.shadowFBO) gl.deleteFramebuffer(this.shadowFBO)
    if (gl && this.shadowMapTex) gl.deleteTexture(this.shadowMapTex)
    this.shadowFBO = null; this.shadowMapTex = null; this.shadowRes = 0
    this.releaseVsm()
  }

  /** Light matrices change only when the light settings do; recomputed lazily (the lookAt helper allocates). */
  private updateLightMatrices() {
    const d = this.shadowSettings.directionalLight
    const pos = d?.position ?? [5, 10, 5], tgt = d?.target ?? [0, 0, 0]
    const dx = pos[0] - tgt[0], dy = pos[1] - tgt[1], dz = pos[2] - tgt[2]
    const parallel = Math.abs(dy) > 0.99 * (Math.hypot(dx, dy, dz) || 1)
    this.eyeT[0] = pos[0]; this.eyeT[1] = pos[1]; this.eyeT[2] = pos[2]
    this.tgtT[0] = tgt[0]; this.tgtT[1] = tgt[1]; this.tgtT[2] = tgt[2]
    this.upT[0] = 0; this.upT[1] = parallel ? 0 : 1; this.upT[2] = parallel ? 1 : 0
    setLookAtMatrix(this.lightView, this.eyeT, this.tgtT, this.upT)
    const s = d?.orthoSize ?? 10
    setOrthoGL(this.lightProj, -s, s, -s, s, d?.near ?? 0.1, d?.far ?? 50)
    multiplyMatricesInto(this.lightVP, this.lightProj, this.lightView)

    const pl = this.shadowSettings.pointLight
    const pp = pl?.position ?? POINT_DEFAULT
    this.pointPos[0] = pp[0]; this.pointPos[1] = pp[1]; this.pointPos[2] = pp[2]
    this.pointNear = pl?.near ?? 0.1; this.pointFar = pl?.far ?? 50
    setPerspectiveMatrixGL(this.cubeProj, Math.PI / 2, 1, this.pointNear, this.pointFar)
    for (let i = 0; i < 6; i++) {
      this.eyeT[0] = pp[0]; this.eyeT[1] = pp[1]; this.eyeT[2] = pp[2]
      this.tgtT[0] = pp[0] + FACE_DIRS[i][0]; this.tgtT[1] = pp[1] + FACE_DIRS[i][1]; this.tgtT[2] = pp[2] + FACE_DIRS[i][2]
      const up = FACE_UPS[i]
      this.upT[0] = up[0]; this.upT[1] = up[1]; this.upT[2] = up[2]
      setLookAtMatrix(this.cubeView, this.eyeT, this.tgtT, this.upT)
      multiplyMatricesInto(this.cubeVP[i], this.cubeProj, this.cubeView)
    }
    this.lightDirty = false
  }

  /** Depth-only draw of the mesh with the given light-space MVP into the currently bound FBO. */
  private drawDepthMesh(fx: FxProgram, vp: Float32Array) {
    const gl = this.gl!
    multiplyMatricesInto(this.shadowMvp, vp, this.rotMatrix)
    this.uM4(fx, "u_mvp", this.shadowMvp)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
    this.frameStats.drawCalls++; this.frameStats.triangles += this.triCount
    gl.bindVertexArray(null)
  }

  private renderShadowPass() {
    const gl = this.gl
    if (!gl || !this.vao) return
    const fx = this.fxProgram("depth")
    if (!fx) return
    const res = this.state.shadowConfig.resolution || 2048
    if (!this.shadowMapTex || !this.shadowFBO) this.initShadowMap(res)
    if (this.lightDirty) this.updateLightMatrices()

    gl.enable(gl.DEPTH_TEST)
    gl.useProgram(fx.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO)
    gl.viewport(0, 0, res, res)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    this.drawDepthMesh(fx, this.lightVP)

    // VSM: convert the depth map into (d, d^2) moments, filtered linearly when sampled.
    if (this.shadowSettings.filterMode === "vsm" && this.vsmFBO && this.floatTargets) {
      const vsm = this.fxProgram("vsm")
      if (vsm) {
        this.ensureQuad()
        gl.disable(gl.DEPTH_TEST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.vsmFBO)
        gl.viewport(0, 0, res, res)
        gl.useProgram(vsm.program)
        this.tex(vsm, "u_shadowMap", 0, this.shadowMapTex)
        this.drawQuad()
        gl.enable(gl.DEPTH_TEST)
      }
    }

    // Point light: six depth faces of the cube map.
    if (this.pointShadowSampled() && this.shadowCubeMapTex) {
      if (!this.shadowCubeFBO) this.shadowCubeFBO = gl.createFramebuffer()
      gl.useProgram(fx.program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowCubeFBO)
      gl.viewport(0, 0, POINT_SHADOW_RES, POINT_SHADOW_RES)
      for (let i = 0; i < 6; i++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.shadowCubeMapTex, 0)
        gl.clear(gl.DEPTH_BUFFER_BIT)
        this.drawDepthMesh(fx, this.cubeVP[i])
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas?.width || 800, this.canvas?.height || 600)
  }

  // ---------------------------------------------------------------------------------------------
  // GPU pass timers (EXT_disjoint_timer_query_webgl2). Absent -> passTimings is simply omitted.
  // ---------------------------------------------------------------------------------------------
  private initTimers() {
    const gl = this.gl
    this.timer = null
    if (!gl || typeof gl.createQuery !== "function") return
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT?: number; GPU_DISJOINT_EXT?: number } | null
    if (!ext || typeof ext.TIME_ELAPSED_EXT !== "number") return
    const queries: WebGLQuery[] = []
    for (let i = 0; i < TIMER_SLOTS; i++) { const q = gl.createQuery(); if (q) queries.push(q) }
    this.timer = { ext: ext as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }, queries, keys: new Array<keyof DetailedGpuMetrics["passTimings"]>(queries.length), busy: new Uint8Array(queries.length), activeSlot: -1, out: {}, has: false }
  }

  private timeBegin(key: keyof DetailedGpuMetrics["passTimings"]) {
    const t = this.timer, gl = this.gl
    if (!t || !gl || t.activeSlot >= 0) return
    for (let i = 0; i < t.queries.length; i++) {
      if (t.busy[i]) continue
      gl.beginQuery(t.ext.TIME_ELAPSED_EXT, t.queries[i])
      t.activeSlot = i; t.keys[i] = key; t.busy[i] = 1
      return
    }
  }

  private timeEnd() {
    const t = this.timer
    if (!t || t.activeSlot < 0) return
    this.gl!.endQuery(t.ext.TIME_ELAPSED_EXT)
    t.activeSlot = -1
  }

  private timeSwitch(key: keyof DetailedGpuMetrics["passTimings"]) {
    const t = this.timer
    if (!t) return
    if (t.activeSlot >= 0 && t.keys[t.activeSlot] === key) return
    this.timeEnd(); this.timeBegin(key)
  }

  private pollTimers() {
    const t = this.timer, gl = this.gl
    if (!t || !gl) return
    const disjoint = !!gl.getParameter(t.ext.GPU_DISJOINT_EXT)
    for (let i = 0; i < t.queries.length; i++) {
      if (!t.busy[i] || i === t.activeSlot) continue
      const q = t.queries[i]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue
      if (!disjoint) { t.out[t.keys[i]] = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6; t.has = true }
      t.busy[i] = 0
    }
  }

  private releaseTimers() {
    const t = this.timer, gl = this.gl
    if (t && gl) for (const q of t.queries) gl.deleteQuery(q)
    this.timer = null
  }

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------
  renderFrame(time: number, _delta: number = 16) {
    if (!this.initialized || !this.gl || !this.canvas || !this.program) return
    this.inFrame = true
    try { this.drawFrame(this.gl, this.canvas, time) } finally { this.inFrame = false }
  }

  private drawFrame(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, time: number) {
    const stats = this.frameStats
    stats.drawCalls = 0; stats.triangles = 0
    this.pollTimers()
    this.frameCount++
    if (time - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFrameTime = time
      if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / (this.fps || 1), timestamp: time })
    }
    const W = canvas.width, H = canvas.height
    const pp = this.state.postProcessState
    const isDeferred = this.state.pipelineMode === "deferred"
    const needGeo = this.needsGeometry()
    const shadowsOn = this.shadowSettings.enabled

    // Rotation is a pure function of playback time (ms), so seek/pause/export are deterministic.
    const angleX = (time / 1000) * SPIN_X
    const angleY = (time / 1000) * SPIN_Y
    const aspect = W / (H || 1)
    setPerspectiveMatrixGL(this.projMatrix, Math.PI / 4, aspect, 0.1, 100)

    // TAA: sub-pixel Halton jitter is applied to the projection for rasterisation only, then restored.
    let jittered = false
    if (pp.taa.enabled) {
      this.taaFrameIndex = (this.taaFrameIndex + 1) % 8
      const jX = (halton(this.taaFrameIndex + 1, 2) - 0.5) / (W || 800)
      const jY = (halton(this.taaFrameIndex + 1, 3) - 0.5) / (H || 600)
      const jitter = pp.taa.jitterSample
      jitter[0] = jX; jitter[1] = jY
      this.projMatrix[8] += jX * 2.0
      this.projMatrix[9] += jY * 2.0
      jittered = true
    }
    setRotationMatrix(this.rotMatrix, angleX, angleY)
    multiplyMatricesInto(this.vpJit, this.projMatrix, this.viewMatrix)
    multiplyMatricesInto(this.mvpMatrix, this.vpJit, this.rotMatrix)
    invertMat4(this.invViewProj, this.vpJit)
    if (jittered) { this.projMatrix[8] = 0; this.projMatrix[9] = 0 } // projection restored for every later consumer
    multiplyMatricesInto(this.vpUnjit, this.projMatrix, this.viewMatrix)
    multiplyMatricesInto(this.mvpUnjit, this.vpUnjit, this.rotMatrix)
    invertMat4(this.invProj, this.projMatrix)
    if (!this.prevValid) { this.prevMvp.set(this.mvpUnjit); this.prevValid = true }

    const storeValues = useProjectStore.getState().uniformValues
    if (storeValues !== this.lastStoreValues) {
      this.lastStoreValues = storeValues
      this.syncAuthoritativeUniforms(storeValues)
    }
    this.resolveColor()
    gl.enable(gl.DEPTH_TEST)

    // 1. shadow
    if (shadowsOn) { this.timeBegin("shadow"); this.renderShadowPass(); this.timeEnd() }

    // 2. geometry (G-buffer / pre-pass), 3. SSAO
    if (needGeo && (!this.gBufferFBO || this.gbW !== W || this.gbH !== H)) this.initGBuffer(W, H)
    if (needGeo && this.gBufferFBO) {
      this.timeBegin("gbuffer")
      this.runGeometryPass(time, isDeferred, shadowsOn)
      if (pp.ssao.enabled && this.aoFB) this.runSSAO(W, H)
      this.timeEnd()
    }

    // 4. lighting
    const nStages = this.fillStages()
    const chain = this.postProcessFramebuffers.length >= 2 && (this.hasPostProcess || nStages > 0)
    const sceneFB = chain ? this.postProcessFramebuffers[0] : this.postProcessFramebuffers.length > 0 && this.hasPostProcess ? this.postProcessFramebuffers[0] : null
    this.timeBegin("lighting")
    if (isDeferred && this.gBufferFBO) this.runLighting(sceneFB, W, H, aspect)
    else this.runForwardScene(sceneFB, W, H, aspect, time, shadowsOn)

    // 5-7. SSR -> DoF -> AA
    let cur = 0
    if (chain) {
      this.ensureQuad()
      gl.disable(gl.DEPTH_TEST)
      for (let k = 0; k < nStages; k++) {
        const stage = this.stageBuf[k]
        if (stage === ST_SSR) this.timeSwitch("ssr")
        else if (stage !== ST_AO) this.timeSwitch("postprocess")
        const last = k === nStages - 1 && !this.hasPostProcess
        this.runStage(stage, this.postProcessFramebuffers[cur], last ? null : this.postProcessFramebuffers[1 - cur], W, H)
        if (!last) cur = 1 - cur
      }
    }

    // 8. user post-process chain
    if (this.hasPostProcess && this.postProcessFramebuffers.length >= 2) {
      this.timeSwitch("postprocess")
      this.ensureQuad()
      gl.disable(gl.DEPTH_TEST)
      const passes = this.activePasses
      const numPasses = passes.length
      let currentRead = cur

      for (let i = 0; i < numPasses; i++) {
        const pass = passes[i]
        const isFinal = (i === numPasses - 1)

        if (isFinal) {
          this.postProcessFramebuffers[currentRead].unbind()
          gl.viewport(0, 0, W, H)
        } else {
          this.postProcessFramebuffers[1 - currentRead].bind()
          gl.viewport(0, 0, W, H)
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
        if (locRes) gl.uniform2f(locRes, W, H)

        for (const uName in pass.uniforms) {
          const uVal = pass.uniforms[uName]
          const loc = locs.get(uName)
          if (loc && typeof uVal === "number") gl.uniform1f(loc, uVal)
        }

        this.drawQuad()
        gl.bindVertexArray(null)
        if (!isFinal) currentRead = 1 - currentRead
      }
    }
    this.timeEnd()

    this.prevMvp.set(this.mvpUnjit)
    if (this.timer?.has) stats.passTimings = this.timer.out
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

  private ensureGround() {
    const gl = this.gl
    if (!gl || this.groundVAO) return
    this.groundVAO = gl.createVertexArray()
    gl.bindVertexArray(this.groundVAO)
    this.groundBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, GROUND_VERTS, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  /** G-buffer pass; in forward mode the same MRT is only a depth/normal/motion pre-pass for the screen-space effects. */
  private runGeometryPass(time: number, isDeferred: boolean, shadowsOn: boolean) {
    const gl = this.gl!, canvas = this.canvas!
    const fx = this.fxProgram("gbuffer")
    if (!fx || !this.vao) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBufferFBO)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.drawBuffers(this.gbAll)
    gl.clearColor(0.5, 0.5, 0.5, 1.0) // 0.5 = zero motion / neutral normal for empty (sky) pixels
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(fx.program)
    const rough = this.numUniform("roughness", 0.5), metal = this.numUniform("metallic", 0)
    this.u3f(fx, "u_camPos", EYE_X, EYE_Y, EYE_Z)
    this.uM4(fx, "u_mvp", this.mvpMatrix); this.uM4(fx, "u_mvpUnjit", this.mvpUnjit); this.uM4(fx, "u_prevMvp", this.prevMvp)
    this.uM4(fx, "u_model", this.rotMatrix)
    this.u3f(fx, "u_color", this.colorBuffer[0], this.colorBuffer[1], this.colorBuffer[2])
    this.u1f(fx, "u_roughness", rough); this.u1f(fx, "u_metallic", metal)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
    this.frameStats.drawCalls++; this.frameStats.triangles += this.triCount
    if (shadowsOn) {
      this.ensureGround()
      this.uM4(fx, "u_mvp", this.vpJit); this.uM4(fx, "u_mvpUnjit", this.vpUnjit); this.uM4(fx, "u_prevMvp", this.vpUnjit)
      this.uM4(fx, "u_model", IDENTITY_F32)
      this.u3f(fx, "u_color", 0.35, 0.37, 0.4); this.u1f(fx, "u_roughness", 0.8); this.u1f(fx, "u_metallic", 0)
      gl.bindVertexArray(this.groundVAO)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      this.frameStats.drawCalls++; this.frameStats.triangles += 2
    }
    gl.bindVertexArray(null)
    // A user-authored fragment shader still owns the albedo: draw it over attachment 0 only (depth-equal).
    if (isDeferred && this.userFrag !== null) {
      gl.drawBuffers(this.gbAlbedoOnly)
      gl.depthFunc(gl.LEQUAL)
      this.drawUserMesh(time)
      gl.depthFunc(gl.LESS)
    }
  }

  private runSSAO(W: number, H: number) {
    const gl = this.gl!
    const fx = this.fxProgram("ssao")
    if (!fx || !this.aoFB) return
    this.ensureQuad()
    gl.disable(gl.DEPTH_TEST)
    this.bindTarget(this.aoFB, W, H)
    gl.useProgram(fx.program)
    this.tex(fx, "u_depthTexture", 1, this.gBufferDepthTex)
    this.tex(fx, "u_normalTexture", 2, this.gBufferNormalTex)
    this.uM4(fx, "u_proj", this.projMatrix); this.uM4(fx, "u_invProj", this.invProj); this.uM4(fx, "u_view", this.viewMatrix)
    const s = this.state.postProcessState.ssao
    this.u2f(fx, "u_resolution", W, H)
    this.u1f(fx, "u_radius", s.radius); this.u1f(fx, "u_intensity", s.intensity)
    this.u1f(fx, "u_sampleCount", s.sampleCount); this.u1f(fx, "u_bias", this.ssaoBias)
    this.drawQuad()
    gl.enable(gl.DEPTH_TEST)
  }

  /** Camera ray basis for background passes (same maths as the skybox). */
  private setCamRays(fx: FxProgram, aspect: number) {
    const halfTan = Math.tan(Math.PI / 8), V = this.viewMatrix
    this.u3f(fx, "u_camRight", V[0] * aspect * halfTan, V[4] * aspect * halfTan, V[8] * aspect * halfTan)
    this.u3f(fx, "u_camUp", V[1] * halfTan, V[5] * halfTan, V[9] * halfTan)
    this.u3f(fx, "u_camForward", -V[2], -V[6], -V[10])
  }

  private setSky(fx: FxProgram) {
    const a = this.state.atmosphereParams
    this.u3f(fx, "u_sunDir", this.sunDir[0], this.sunDir[1], this.sunDir[2])
    this.u3f(fx, "u_skyParams", a.sunIntensity, a.turbidity, 0)
  }

  /** 0 clear colour, 1 env-map skybox, 2 procedural atmosphere. */
  private backgroundMode(): number {
    const env = this.envSettings
    if (!env?.showSkybox) return 0
    return env.preset === "atmosphere" ? 2 : this.envTexture ? 1 : 0
  }

  /** Uploads light, shadow and environment state for a program that declares the shared lighting chunks. */
  private bindLighting(fx: FxProgram, shadowUnit: number) {
    const dirLight = this.shadowSettings.directionalLight
    let lDirX = 0.5, lDirY = 1.0, lDirZ = 0.75
    let lColR = 1.0, lColG = 0.95, lColB = 0.9
    let lInt = dirLight?.intensity ?? 1.0
    if (dirLight) {
      if (dirLight.enabled === false) lInt = 0.0
      if (dirLight.position && dirLight.target) {
        const dx = dirLight.position[0] - dirLight.target[0]
        const dy = dirLight.position[1] - dirLight.target[1]
        const dz = dirLight.position[2] - dirLight.target[2]
        const len = Math.hypot(dx, dy, dz) || 1.0
        lDirX = dx / len; lDirY = dy / len; lDirZ = dz / len
      }
      if (dirLight.color) { lColR = dirLight.color[0]; lColG = dirLight.color[1]; lColB = dirLight.color[2] }
    }
    this.u3f(fx, "u_lightDir", lDirX, lDirY, lDirZ)
    this.u3f(fx, "u_lightColor", lColR, lColG, lColB)
    this.u1f(fx, "u_lightIntensity", lInt)
    this.u3f(fx, "u_camPos", EYE_X, EYE_Y, EYE_Z)
    this.u1f(fx, "u_envExposure", useProjectStore.getState().environmentSettings?.exposure ?? 1.0)
    this.tex(fx, "u_envMap", U_ENV, this.envTexture)
    const shadowOn = this.shadowSettings.enabled && !!this.shadowMapTex
    this.u1f(fx, "u_shadowEnabled", shadowOn ? 1 : 0)
    this.tex(fx, "u_shadowMap", shadowUnit, this.shadowMapTex)
    this.tex(fx, "u_shadowMoments", shadowUnit + 1, this.vsmTex)
    this.bindCube(fx.locs.get("u_shadowCubeMap"), shadowUnit + 2, this.pointShadowSampled() ? this.shadowCubeMapTex : null)
    this.uM4(fx, "u_lightVP", this.lightVP)
    const mode = this.shadowSettings.filterMode === "vsm" && this.vsmTex ? 2 : (this.shadowSettings.filterMode as string) === "hard" ? 0 : 1
    this.u4f(fx, "u_shadowParams", this.shadowSettings.bias, this.shadowSettings.normalBias, 1 / (this.shadowRes || 2048), mode)
    const pl = this.shadowSettings.pointLight
    const pointOn = pl?.enabled ?? this.state.pointShadowCubeEnabled
    const pi = pl?.intensity ?? 1
    const pc = pl?.color ?? [1, 0.9, 0.8]
    this.u4f(fx, "u_pointLight", this.pointPos[0], this.pointPos[1], this.pointPos[2], this.pointFar)
    this.u4f(fx, "u_pointColor", pc[0] * pi, pc[1] * pi, pc[2] * pi, pointOn ? 1 : 0)
    this.u2f(fx, "u_pointParams", this.pointNear, this.pointShadowSampled() ? 1 : 0)
  }

  private runLighting(target: WebGL2Framebuffer | null, W: number, H: number, aspect: number) {
    const gl = this.gl!
    const fx = this.fxProgram("lighting")
    if (!fx) return
    this.ensureQuad()
    gl.disable(gl.DEPTH_TEST)
    this.bindTarget(target, W, H)
    gl.useProgram(fx.program)
    this.tex(fx, "u_albedoTex", 0, this.gBufferAlbedoTex)
    this.tex(fx, "u_normalTex", 1, this.gBufferNormalTex)
    this.tex(fx, "u_roughnessTex", 2, this.gBufferRoughnessTex)
    this.tex(fx, "u_depthTex", 3, this.gBufferDepthTex)
    this.tex(fx, "u_motionTex", 4, this.gBufferMotionTex)
    const ao = this.state.postProcessState.ssao.enabled && !!this.aoFB
    this.tex(fx, "u_aoTex", U_AO, ao ? this.aoFB!.getTexture() : null)
    this.u1f(fx, "u_aoEnabled", ao ? 1 : 0)
    this.u1i(fx, "u_debugView", DEBUG_VIEW_CODES[this.gBufferDebugView] ?? 0)
    this.uM4(fx, "u_invViewProj", this.invViewProj)
    const mode = this.backgroundMode()
    this.u1i(fx, "u_bgMode", mode)
    this.u3f(fx, "u_bgColor", 0.08, 0.08, 0.1)
    this.setCamRays(fx, aspect)
    this.setSky(fx)
    this.bindLighting(fx, U_SHADOW)
    this.drawQuad()
    gl.bindVertexArray(null)
    gl.enable(gl.DEPTH_TEST)
  }

  private runForwardScene(target: WebGL2Framebuffer | null, W: number, H: number, aspect: number, time: number, shadowsOn: boolean) {
    const gl = this.gl!
    this.bindTarget(target, W, H)
    gl.clearColor(0.08, 0.08, 0.1, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const bg = this.backgroundMode()
    if (bg === 2) {
      const sky = this.fxProgram("sky")
      if (sky) {
        this.ensureQuad()
        gl.disable(gl.DEPTH_TEST)
        gl.useProgram(sky.program)
        this.setCamRays(sky, aspect); this.setSky(sky)
        this.drawQuad()
        gl.enable(gl.DEPTH_TEST)
      }
    } else if (this.envSettings?.showSkybox && this.skyboxProgram && this.envTexture) {
      this.drawSkybox(aspect)
    }
    if (shadowsOn) this.drawForwardLit(this.userFrag === null)
    if (this.userFrag !== null || !shadowsOn) this.drawUserMesh(time)
  }

  /** Built-in lit forward shading (default look when no user program is linked) + the shadow-catcher ground. */
  private drawForwardLit(withMesh: boolean) {
    const gl = this.gl!
    const fx = this.fxProgram("forwardLit")
    if (!fx || !this.vao) return
    gl.useProgram(fx.program)
    this.bindLighting(fx, U_SHADOW)
    const rough = this.numUniform("roughness", 0.5), metal = this.numUniform("metallic", 0)
    this.ensureGround()
    this.uM4(fx, "u_mvp", this.vpJit); this.uM4(fx, "u_model", IDENTITY_F32)
    this.u3f(fx, "u_color", 0.35, 0.37, 0.4); this.u1f(fx, "u_roughness", 0.8); this.u1f(fx, "u_metallic", 0)
    gl.bindVertexArray(this.groundVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    this.frameStats.drawCalls++; this.frameStats.triangles += 2
    if (withMesh) {
      this.uM4(fx, "u_mvp", this.mvpMatrix); this.uM4(fx, "u_model", this.rotMatrix)
      this.u3f(fx, "u_color", this.colorBuffer[0], this.colorBuffer[1], this.colorBuffer[2])
      this.u1f(fx, "u_roughness", rough); this.u1f(fx, "u_metallic", metal)
      gl.bindVertexArray(this.vao)
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
      this.frameStats.drawCalls++; this.frameStats.triangles += this.triCount
    }
    gl.bindVertexArray(null)
  }

  private drawSkybox(aspect: number) {
    const gl = this.gl!, stats = this.frameStats
    gl.disable(gl.DEPTH_TEST)
    if (typeof (gl as any).depthMask === "function") (gl as any).depthMask(false)
    gl.useProgram(this.skyboxProgram)

    const halfTan = Math.tan(Math.PI / 8)
    const V = this.viewMatrix
    const rotRad = (((this.envSettings?.rotation) || 0) * Math.PI) / 180
    const blur = this.envSettings?.backgroundBlur || 0.0
    const exposure = this.envSettings?.exposure ?? 1.0
    const sk = this.skyboxUniformLocations
    const locRight = sk.get("u_camRight")
    if (locRight) gl.uniform3f(locRight, V[0] * aspect * halfTan, V[4] * aspect * halfTan, V[8] * aspect * halfTan)
    const locUp = sk.get("u_camUp")
    if (locUp) gl.uniform3f(locUp, V[1] * halfTan, V[5] * halfTan, V[9] * halfTan)
    const locFwd = sk.get("u_camForward")
    if (locFwd) gl.uniform3f(locFwd, -V[2], -V[6], -V[10])
    const locRot = sk.get("u_rotation")
    if (locRot) gl.uniform1f(locRot, rotRad)
    const locBlur = sk.get("u_blur")
    if (locBlur) gl.uniform1f(locBlur, blur)
    const locExp = sk.get("u_exposure")
    if (locExp) gl.uniform1f(locExp, exposure)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture)
    const locEnv = sk.get("u_envMap")
    if (locEnv) gl.uniform1i(locEnv, 0)

    gl.bindVertexArray(this.skyboxVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    stats.drawCalls++; stats.triangles++
    gl.bindVertexArray(null)

    gl.enable(gl.DEPTH_TEST)
    if (typeof (gl as any).depthMask === "function") (gl as any).depthMask(true)
  }

  /** Draws the mesh with the user-facing program (all uniform/texture/audio/env/shadow binding). */
  private drawUserMesh(time: number) {
    const gl = this.gl!, stats = this.frameStats
    if (!this.program) return
    gl.useProgram(this.program)

    if (this.mvpLocation) gl.uniformMatrix4fv(this.mvpLocation, false, this.mvpMatrix)
    const fl = this.frameLocs
    if (fl.time) gl.uniform1f(fl.time, time / 1000)
    // The viewport size is the adapter's to write (raymarching divides by it), never the stored default.
    const resLoc = this.findUniformLoc("u_resolution") ?? this.findUniformLoc("resolution")
    if (resLoc) gl.uniform2f(resLoc, gl.drawingBufferWidth, gl.drawingBufferHeight)

    if (this.uniformsDirty) {
      if (this.colorLocation) gl.uniform3fv(this.colorLocation, this.colorBuffer)
      for (const [name, val] of this.authoritativeUniforms.entries()) {
        if (name === "color" || name === "u_color" || name === "u_mvp" || name === "mvp" || name === "time" || name === "u_time" || name === "resolution" || name === "u_resolution") continue
        const loc = this.findUniformLoc(name)
        if (loc) this.applyUniform(loc, val)
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
        if (loc) gl.uniform1i(loc, activeUnit)
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
        if (loc) gl.uniform1i(loc, unit)
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

    if (fl.env && this.envTexture) {
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, this.envTexture)
      gl.uniform1i(fl.env, 7)
    }
    if (fl.envExp) gl.uniform1f(fl.envExp, useProjectStore.getState().environmentSettings?.exposure ?? 1.0)
    if (fl.envRot) gl.uniform1f(fl.envRot, ((useProjectStore.getState().environmentSettings?.rotation ?? 0.0) * Math.PI) / 180)

    // Shadow resources offered to user shaders that declare the standard names (forward shadow sampling).
    const sh = fl.shadow
    if (this.shadowSettings.enabled && this.shadowMapTex) {
      if (sh.map) this.bindAux(sh.map, U_SHADOW, this.shadowMapTex)
      if (sh.moments && this.vsmTex) this.bindAux(sh.moments, U_MOMENTS, this.vsmTex)
      if (sh.cube && this.pointShadowSampled()) this.bindCube(sh.cube, U_CUBE, this.shadowCubeMapTex)
      if (sh.lightVP) gl.uniformMatrix4fv(sh.lightVP, false, this.lightVP)
      if (sh.params) {
        const mode = this.shadowSettings.filterMode === "vsm" && this.vsmTex ? 2 : (this.shadowSettings.filterMode as string) === "hard" ? 0 : 1
        gl.uniform4f(sh.params, this.shadowSettings.bias, this.shadowSettings.normalBias, 1 / (this.shadowRes || 2048), mode)
      }
    }
    if (sh.enabled) gl.uniform1f(sh.enabled, this.shadowSettings.enabled && this.shadowMapTex ? 1 : 0)

    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount); gl.bindVertexArray(null)
    stats.drawCalls++; stats.triangles += this.triCount
  }

  private runStage(stage: number, src: WebGL2Framebuffer, dst: WebGL2Framebuffer | null, W: number, H: number) {
    const gl = this.gl!
    const p = this.state.postProcessState
    const srcTex = src.getTexture()
    switch (stage) {
      case ST_AO: {
        const fx = this.fxProgram("composite"); if (!fx || !this.aoFB) return
        this.bindTarget(dst, W, H); gl.useProgram(fx.program)
        this.tex(fx, "u_texture", 0, srcTex); this.tex(fx, "u_aoTex", U_AO, this.aoFB.getTexture()); this.u1f(fx, "u_aoStrength", 1)
        this.drawQuad(); break
      }
      case ST_SSR: {
        const fx = this.fxProgram("ssr"); if (!fx) return
        const s = p.ssr
        this.bindTarget(dst, W, H); gl.useProgram(fx.program)
        this.tex(fx, "u_texture", 0, srcTex); this.tex(fx, "u_depthTexture", 1, this.gBufferDepthTex); this.tex(fx, "u_normalTexture", 2, this.gBufferNormalTex)
        this.tex(fx, "u_envMap", U_ENV, this.envTexture)
        this.u1f(fx, "u_envExposure", useProjectStore.getState().environmentSettings?.exposure ?? 1.0)
        this.uM4(fx, "u_proj", this.projMatrix); this.uM4(fx, "u_invProj", this.invProj); this.uM4(fx, "u_view", this.viewMatrix); this.uM4(fx, "u_invView", this.invViewMatrix)
        this.u1f(fx, "u_maxSteps", s.maxSteps); this.u1f(fx, "u_thickness", s.thickness); this.u1f(fx, "u_falloff", s.falloff); this.u1f(fx, "u_iblBlend", s.iblBlend)
        this.drawQuad(); break
      }
      case ST_DOF: {
        const fx = this.fxProgram("dof"); if (!fx) return
        const s = p.dof
        const shape = /hex/.test(s.bokehShape) ? 1 : /oct/.test(s.bokehShape) ? 2 : 0
        this.bindTarget(dst, W, H); gl.useProgram(fx.program)
        this.tex(fx, "u_texture", 0, srcTex); this.tex(fx, "u_depthTexture", 1, this.gBufferDepthTex)
        this.u2f(fx, "u_resolution", W, H)
        this.u1f(fx, "u_focalDistance", s.focalDistance); this.u1f(fx, "u_aperture", s.aperture); this.u1f(fx, "u_maxBlur", this.dofMaxBlur)
        this.u1f(fx, "u_bokehShape", shape); this.u1f(fx, "u_near", 0.1); this.u1f(fx, "u_far", 100)
        this.drawQuad(); break
      }
      case ST_FXAA: {
        const fx = this.fxProgram("fxaa"); if (!fx) return
        this.bindTarget(dst, W, H); gl.useProgram(fx.program)
        this.tex(fx, "u_texture", 0, srcTex); this.u2f(fx, "u_resolution", W, H)
        this.u1f(fx, "u_fxaaQualitySubpix", 0.75); this.u1f(fx, "u_fxaaQualityEdgeThreshold", 0.166); this.u1f(fx, "u_fxaaQualityEdgeThresholdMin", 0.0833)
        this.drawQuad(); break
      }
      case ST_TAA: {
        const fx = this.fxProgram("taa"), cp = this.fxProgram("composite")
        if (!fx || !cp || this.taaHist.length !== 2) return
        const histR = this.taaHist[this.taaRead], histW = this.taaHist[1 - this.taaRead]
        this.bindTarget(histW, W, H); gl.useProgram(fx.program)
        this.tex(fx, "u_texture", 0, srcTex); this.tex(fx, "u_motionTexture", 3, this.gBufferMotionTex); this.tex(fx, "u_historyTexture", 4, histR.getTexture())
        this.u2f(fx, "u_resolution", W, H); this.u1f(fx, "u_historyValid", this.taaHistoryValid ? 1 : 0); this.u1f(fx, "u_feedback", 0.9)
        this.drawQuad()
        this.bindTarget(dst, W, H); gl.useProgram(cp.program) // resolved frame continues down the chain
        this.tex(cp, "u_texture", 0, histW.getTexture()); this.u1f(cp, "u_aoStrength", 0)
        this.drawQuad()
        this.taaRead = 1 - this.taaRead; this.taaHistoryValid = true
        break
      }
    }
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
    // Float targets (RGBA16F) when the driver can render to them, RGBA8 packing otherwise (all G-buffer
    // channels are stored in [0,1]-encoded form so both paths decode identically).
    this.floatTargets = !!gl.getExtension("EXT_color_buffer_float")
    this.buildGBuffer(width, height, this.floatTargets)
    if (!this.gBufferComplete && this.floatTargets) {
      this.floatTargets = false
      this.buildGBuffer(width, height, false)
    }
    this.publishGBufferTargets()
  }

  private buildGBuffer(width: number, height: number, float: boolean) {
    const gl = this.gl!
    this.releaseGBuffer(true, false)
    this.gBufferFBO = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBufferFBO)

    const color = (attachment: number, internal: number, type: number): WebGLTexture | null => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, t, 0)
      return t
    }
    const fi = float ? gl.RGBA16F : gl.RGBA8
    const ft = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    this.gBufferAlbedoTex = color(gl.COLOR_ATTACHMENT0, gl.RGBA8, gl.UNSIGNED_BYTE)
    this.gBufferNormalTex = color(gl.COLOR_ATTACHMENT1, fi, ft)
    this.gBufferRoughnessTex = color(gl.COLOR_ATTACHMENT2, fi, ft)
    this.gBufferMotionTex = color(gl.COLOR_ATTACHMENT3, fi, ft)

    this.gBufferDepthTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.gBufferDepthTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.gBufferDepthTex, 0)

    gl.drawBuffers(this.gbAll)
    this.gBufferComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    setTexMeta(this.gBufferAlbedoTex, "rgba8unorm", width, height)
    setTexMeta(this.gBufferNormalTex, float ? "rgba16float" : "rgba8unorm", width, height)
    setTexMeta(this.gBufferRoughnessTex, float ? "rgba16float" : "rgba8unorm", width, height)
    setTexMeta(this.gBufferDepthTex, "depth24plus", width, height)
    setTexMeta(this.gBufferMotionTex, float ? "rgba16float" : "rgba8unorm", width, height)
    this.gbW = width; this.gbH = height
  }

  /** Frees the G-buffer FBO and every attachment (`live` false = context gone, only forget). */
  private releaseGBuffer(live = true, clearState = true) {
    const gl = live ? this.gl : null
    if (gl && this.gBufferFBO) gl.deleteFramebuffer(this.gBufferFBO)
    for (const k of ["gBufferAlbedoTex", "gBufferNormalTex", "gBufferRoughnessTex", "gBufferDepthTex", "gBufferMotionTex"] as const) {
      if (gl && this[k]) gl.deleteTexture(this[k])
      this[k] = null
    }
    this.gBufferFBO = null
    this.gbW = this.gbH = 0
    if (clearState) this.state.gBufferTargets = null
  }

  /** The public G-buffer view exists only in deferred mode (forward pre-pass buffers stay internal). */
  private publishGBufferTargets() {
    if (this.state.pipelineMode !== "deferred") { this.state.gBufferTargets = null; return }
    if (!this.gBufferAlbedoTex) return
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
    const width = this.canvas?.width || 1920
    const height = this.canvas?.height || 1080
    this.refreshFidelity() // allocates the G-buffer for deferred, releases it again when forward needs none
    if (mode === "deferred") {
      this.publishGBufferTargets()
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

  /** VSM needs float render targets; without EXT_color_buffer_float it explicitly falls back to PCF. */
  getEffectiveShadowFilter(): ShadowFilterMode {
    return this.shadowSettings.filterMode === "vsm" && !this.floatTargets ? "pcf" : this.shadowSettings.filterMode
  }

  getFidelityCapabilities(): FidelityCapabilities {
    return { effectiveShadowFilter: this.getEffectiveShadowFilter(), unsupported: [] }
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

  private static validResolution(r: unknown) {
    if (typeof r !== "number" || Number.isNaN(r) || ![512, 1024, 2048, 4096].includes(r as number)) {
      throw new Error(`Invalid shadow resolution ${String(r)}. Supported: 512, 1024, 2048, 4096`)
    }
  }

  setShadowConfig(config: Partial<ShadowMapConfig>) {
    if (config.resolution !== undefined) WebGL2Adapter.validResolution(config.resolution)
    this.state.shadowConfig = { ...this.state.shadowConfig, ...config }
    this.shadowSettings.resolution = this.state.shadowConfig.resolution
    this.shadowSettings.filterMode = this.state.shadowConfig.filtering
    this.shadowSettings.bias = this.state.shadowConfig.bias
    this.shadowSettings.normalBias = this.state.shadowConfig.normalBias
    this.refreshFidelity()
  }

  updateShadowSettings(settings: Partial<ShadowSettings>) {
    if (settings.resolution !== undefined) WebGL2Adapter.validResolution(settings.resolution)
    this.shadowSettings = { ...this.shadowSettings, ...settings }
    if (settings.resolution) this.state.shadowConfig.resolution = settings.resolution
    if (settings.filterMode) this.state.shadowConfig.filtering = settings.filterMode
    if (settings.bias !== undefined) this.state.shadowConfig.bias = settings.bias
    if (settings.normalBias !== undefined) this.state.shadowConfig.normalBias = settings.normalBias
    this.refreshFidelity()
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
          gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.DEPTH_COMPONENT24, POINT_SHADOW_RES, POINT_SHADOW_RES, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
        }
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)
        this.pointCubeReady = true
      } else if (!gl && !this.shadowCubeMapTex) {
        this.shadowCubeMapTex = { width: POINT_SHADOW_RES, height: POINT_SHADOW_RES, isCube: true } as any
        this.pointCubeReady = false
      }
    } else {
      if (gl && this.shadowCubeMapTex && this.pointCubeReady) gl.deleteTexture(this.shadowCubeMapTex)
      if (gl && this.shadowCubeFBO) gl.deleteFramebuffer(this.shadowCubeFBO)
      this.shadowCubeFBO = null
      this.shadowCubeMapTex = null
      this.pointCubeReady = false
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
      this.refreshFidelity()
    }
  }

  updateSSRSettings(settings: Partial<SSRSettings>) {
    const s = this.state.postProcessState.ssr
    if (settings.enabled !== undefined) s.enabled = settings.enabled
    if (settings.maxSteps !== undefined) s.maxSteps = settings.maxSteps
    if (settings.thickness !== undefined) s.thickness = settings.thickness
    if (settings.falloff !== undefined) s.falloff = settings.falloff
    if (settings.iblBlend !== undefined) s.iblBlend = settings.iblBlend
    this.refreshFidelity()
  }

  updateDoFSettings(settings: Partial<DoFSettings>) {
    const s = this.state.postProcessState.dof
    if (settings.enabled !== undefined) s.enabled = settings.enabled
    if (settings.focalDistance !== undefined) s.focalDistance = settings.focalDistance
    if (settings.aperture !== undefined) s.aperture = settings.aperture
    if (settings.bokehShape !== undefined) s.bokehShape = settings.bokehShape
    if (settings.maxBlur !== undefined) this.dofMaxBlur = settings.maxBlur
    this.refreshFidelity()
  }

  updateSSAOSettings(settings: Partial<SSAOSettings>) {
    const s = this.state.postProcessState.ssao
    if (settings.enabled !== undefined) s.enabled = settings.enabled
    if (settings.radius !== undefined) s.radius = settings.radius
    if (settings.intensity !== undefined) s.intensity = settings.intensity
    if (settings.sampleCount !== undefined) s.sampleCount = settings.sampleCount
    if (settings.bias !== undefined) this.ssaoBias = settings.bias
    this.refreshFidelity()
  }

  setAntiAliasingMode(mode: AntiAliasingMode) {
    this.antiAliasingMode = mode
    this.state.postProcessState.fxaa.enabled = (mode === "fxaa")
    this.state.postProcessState.taa.enabled = (mode === "taa")
    this.taaHistoryValid = false
    this.refreshFidelity()
  }

  getAntiAliasingMode(): AntiAliasingMode {
    return this.antiAliasingMode
  }

  private updateSunDir() {
    const a = this.state.atmosphereParams
    const el = (a.solarElevationDeg * Math.PI) / 180
    const az = (a.timeOfDay / 24) * Math.PI * 2
    this.sunDir[0] = Math.sin(az) * Math.cos(el); this.sunDir[1] = Math.sin(el); this.sunDir[2] = -Math.cos(az) * Math.cos(el)
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
    this.updateSunDir()
  }

  calculateRayleighMieScattering(wavelengthNm = [680, 550, 440]): { rayleigh: number[]; mie: number } {
    const rayleigh = wavelengthNm.map((lambda) => {
      const lambdaUm = lambda / 1000.0
      return 0.008 * Math.pow(lambdaUm, -4)
    })
    const mie = 0.002 * this.state.atmosphereParams.turbidity
    return { rayleigh, mie }
  }

  /**
   * Applies the whole fidelity settings object, touching only the sections that changed since the last
   * call (an identical object rebuilds nothing). Resources are reconciled once at the end.
   */
  applyRenderSettings(s: RenderSettings) {
    const prev = this.lastApplied
    if (prev && prev.renderMode === s.renderMode && prev.antiAliasing === s.antiAliasing && prev.gbufferDebugView === s.gbufferDebugView &&
      sameShallowEq(prev.shadows, s.shadows) && sameShallowEq(prev.ssao, s.ssao) && sameShallowEq(prev.ssr, s.ssr) &&
      sameShallowEq(prev.dof, s.dof) && sameShallowEq(prev.atmosphere, s.atmosphere)) return
    const changed = (k: "shadows" | "ssao" | "ssr" | "dof" | "atmosphere") => !prev || !sameShallowEq(prev[k], s[k])

    if (changed("shadows")) {
      const sh = s.shadows
      this.shadowSettings = { ...this.shadowSettings, enabled: sh.enabled, resolution: sh.resolution, filterMode: sh.filterMode, bias: sh.bias, normalBias: sh.normalBias }
      this.state.shadowConfig = { ...this.state.shadowConfig, resolution: sh.resolution, filtering: sh.filterMode, bias: sh.bias, normalBias: sh.normalBias }
      if (!prev || prev.shadows.pointShadows !== sh.pointShadows) this.setPointLightShadowCube(sh.pointShadows)
    }
    if (changed("ssao")) { const { bias, ...rest } = s.ssao; this.ssaoBias = bias; Object.assign(this.state.postProcessState.ssao, rest) }
    if (changed("ssr")) Object.assign(this.state.postProcessState.ssr, { ...s.ssr, iblBlend: s.ssr.iblBlend ?? 0.5 })
    if (changed("dof")) { const { maxBlur, ...rest } = s.dof; this.dofMaxBlur = maxBlur; Object.assign(this.state.postProcessState.dof, rest) }
    if (changed("atmosphere")) {
      const a = s.atmosphere
      this.state.atmosphereParams = { timeOfDay: Math.max(0, Math.min(24, a.timeOfDay)), sunIntensity: a.sunIntensity, turbidity: a.turbidity, solarElevationDeg: a.solarElevationDeg }
      this.updateSunDir()
    }
    if (!prev || prev.antiAliasing !== s.antiAliasing) {
      this.antiAliasingMode = s.antiAliasing
      this.state.postProcessState.fxaa.enabled = s.antiAliasing === "fxaa"
      this.state.postProcessState.taa.enabled = s.antiAliasing === "taa"
      this.taaHistoryValid = false
    }
    if (!prev || prev.gbufferDebugView !== s.gbufferDebugView) this.gBufferDebugView = s.gbufferDebugView
    if (!prev || prev.renderMode !== s.renderMode) this.state.pipelineMode = s.renderMode

    this.lastApplied = { ...s, shadows: { ...s.shadows }, ssao: { ...s.ssao }, ssr: { ...s.ssr }, dof: { ...s.dof }, atmosphere: { ...s.atmosphere } }
    this.setRenderingPipelineMode(this.state.pipelineMode) // also reconciles every other resource
    renderCoordinator.requestRender()
  }

  // ---------------------------------------------------------------------------------------------
  // renderToTarget: one-off GPU previews for node thumbnails
  // ---------------------------------------------------------------------------------------------
  renderToTarget(request: RenderToTargetRequest): Promise<ImageBitmap | ImageData | null> {
    const run = this.rttQueue.then(() => this.runRenderToTarget(request)) // strictly one at a time
    const safe = run.catch((e) => { if (!this.rttWarned) { this.rttWarned = true; console.warn("WebGL2 renderToTarget failed:", e) } return null })
    this.rttQueue = safe
    return safe
  }

  private rttWarned = false

  private runRenderToTarget(req: RenderToTargetRequest): ImageData | null {
    const gl = this.gl
    const glsl = req.source?.glsl
    if (!gl || !this.initialized || this.inFrame || !glsl) return null
    if (!Number.isFinite(req.width) || !Number.isFinite(req.height)) return null
    const w = Math.max(1, Math.min(2048, Math.floor(req.width))), h = Math.max(1, Math.min(2048, Math.floor(req.height)))

    const key = hashSource(glsl)
    let entry = this.rttPrograms.get(key)
    if (entry) { this.rttPrograms.delete(key); this.rttPrograms.set(key, entry) } // LRU touch
    else {
      const program = this.createProgram(RTT_VERT, glsl, false) // a bad preview must not clobber the editor's error
      if (!program) return null
      entry = { program, res: gl.getUniformLocation(program, "u_resolution"), time: gl.getUniformLocation(program, "u_time"), locs: new Map() }
      this.rttPrograms.set(key, entry)
      if (this.rttPrograms.size > RTT_CACHE_MAX) {
        const oldest = this.rttPrograms.keys().next().value as string
        gl.deleteProgram(this.rttPrograms.get(oldest)!.program)
        this.rttPrograms.delete(oldest)
      }
    }

    const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const vp = gl.getParameter(gl.VIEWPORT) as ArrayLike<number>
    const vx = vp[0], vy = vp[1], vw = vp[2], vh = vp[3]
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null
    const prevClear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as ArrayLike<number>
    const prevBlend = gl.isEnabled(gl.BLEND)
    const prevBlendFn = [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA)] as number[]
    const prevScissorOn = gl.isEnabled(gl.SCISSOR_TEST)
    const prevScissor = gl.getParameter(gl.SCISSOR_BOX) as ArrayLike<number>
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    try {
      gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST)
      if (!this.rttFBO || !this.rttTex || this.rttW !== w || this.rttH !== h) {
        if (this.rttFBO) gl.deleteFramebuffer(this.rttFBO)
        if (this.rttTex) gl.deleteTexture(this.rttTex)
        this.rttFBO = gl.createFramebuffer(); this.rttTex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, this.rttTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.rttFBO)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rttTex, 0)
        gl.bindTexture(gl.TEXTURE_2D, null)
        this.rttW = w; this.rttH = h
      }
      this.ensureQuad()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.rttFBO)
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(entry.program)
      if (entry.res) gl.uniform2f(entry.res, w, h)
      const supplied = req.uniforms ?? {}
      const t = Number((supplied.time ?? supplied.u_time)?.value)
      if (entry.time) gl.uniform1f(entry.time, Number.isFinite(t) ? t : 0)
      for (const [name, val] of Object.entries(supplied)) {
        if (!val || name === "time" || name === "u_time" || name === "u_resolution") continue
        let loc = entry.locs.get(name)
        if (loc === undefined) {
          loc = gl.getUniformLocation(entry.program, name) ?? gl.getUniformLocation(entry.program, "u_" + name) ?? (name.startsWith("u_") ? gl.getUniformLocation(entry.program, name.slice(2)) : null)
          entry.locs.set(name, loc)
        }
        if (loc) this.applyUniform(loc, val)
      }
      gl.bindVertexArray(this.quadVAO)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      const bytes = new Uint8ClampedArray(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes as unknown as ArrayBufferView)
      const row = w * 4, tmp = new Uint8ClampedArray(row) // GL rows are bottom-up
      for (let y = 0; y < h >> 1; y++) {
        const a = y * row, b = (h - 1 - y) * row
        tmp.set(bytes.subarray(a, a + row)); bytes.copyWithin(a, b, b + row); bytes.set(tmp, b)
      }
      return typeof ImageData !== "undefined" ? new ImageData(bytes, w, h) : ({ data: bytes, width: w, height: h, colorSpace: "srgb" } as ImageData)
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB)
      gl.viewport(vx, vy, vw, vh)
      gl.useProgram(prevProgram)
      gl.bindVertexArray(prevVAO)
      gl.clearColor(prevClear[0], prevClear[1], prevClear[2], prevClear[3])
      gl.blendFuncSeparate(prevBlendFn[0], prevBlendFn[1], prevBlendFn[2], prevBlendFn[3])
      if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND)
      gl.scissor(prevScissor[0], prevScissor[1], prevScissor[2], prevScissor[3])
      if (prevScissorOn) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST)
      gl.bindTexture(gl.TEXTURE_2D, prevTex) // texture (re)allocation above binds on the active unit
      gl.activeTexture(prevActive)
    }
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
