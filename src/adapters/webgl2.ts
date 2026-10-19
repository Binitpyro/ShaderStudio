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

interface WebGL2PostProcessPass {
  id: string
  passType: PostProcessPassType
  program: WebGLProgram
  uniformLocations: Map<string, WebGLUniformLocation | null>
  uniforms: Record<string, number | number[]>
}

import { type GeometryKey, getVerticesForGeometry, setLookAtMatrix, setRotationMatrix, multiplyMatricesInto } from "./math"
export { createLookAtMatrix, createRotationMatrix, multiplyMatrices } from "./math"

function setPerspectiveMatrixWebGL2(out: Float32Array, fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far)
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0
  return out
}
export function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  return setPerspectiveMatrixWebGL2(new Float32Array(16), fov, aspect, near, far)
}

export class WebGL2Adapter implements RenderAdapter {
  readonly backendType = "webgl2" as const
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vertexBuffer: WebGLBuffer | null = null
  private vertexCount = 36
  private initialized = false
  private rafId: number | null = null
  private angleX = 0
  private angleY = 0
  private currentGeometry: GeometryKey = "cube"
  private projMatrix = new Float32Array(16)
  private viewMatrix = new Float32Array(16)
  private rotMatrix = new Float32Array(16)
  private tempMatrix = new Float32Array(16)
  private mvpMatrix = new Float32Array(16)
  private colorBuffer = new Float32Array(3)
  private isExternalLoopDriven = false
  private postProcessFramebuffers: WebGL2Framebuffer[] = []
  private postProcessPrograms: WebGLProgram[] = []
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
  private queueTextures: Array<{ id: string; binding: number }> = []
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
    enabled: true,
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
    this.quadVAO = null
    this.quadBuffer = null
    this.skyboxVAO = null
    this.skyboxProgram = null
    this.skyboxUniformLocations.clear()
    useProjectStore.getState().setDeviceLost(true)
    useProjectStore.getState().setLastCompileError("WebGL2 context lost")
  }
  private handleContextRestored = () => { useProjectStore.getState().setDeviceLost(false); useProjectStore.getState().setLastCompileError(null); this.initialize() }

  private initialize(): boolean {
    const gl = this.gl; if (!gl) return false
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE)
    this.program = this.createProgram(defaultVertSource, defaultFragSource)
    if (!this.program) return false
    this.cacheUniformLocations()
    this.mvpLocation = this.getUniformLoc("u_mvp")
    this.colorLocation = this.getUniformLoc("u_color")
    this.createGeometry(this.currentGeometry)
    this.createDefaultTexture()
    this.initializePostProcess()
    const envSettings = useProjectStore.getState().environmentSettings
    if (envSettings) {
      this.updateEnvironment(envSettings)
    }
    if (!this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel = customModelRegistry.subscribe(() => {
        if (this.currentGeometry === "custom") {
          this.createGeometry("custom")
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
    try {
      const response = await fetch(resource.src)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.gl || !this.initialized) return

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
    } catch (e) {
      if (this.initialized) console.error("Failed to load texture in WebGL2:", e)
    }
  }

  private cacheUniformLocations() {
    if (!this.gl || !this.program) return
    this.uniformLocations.clear()
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

  private getUniformLoc(name: string): WebGLUniformLocation | null {
    if (this.uniformLocations.has(name)) return this.uniformLocations.get(name)!
    if (!this.gl || !this.program) return null
    const loc = this.gl.getUniformLocation(this.program, name)
    this.uniformLocations.set(name, loc)
    return loc
  }

  private findUniformLoc(name: string): WebGLUniformLocation | null {
    if (this.uniformLocations.has(name)) return this.uniformLocations.get(name)!
    const prefixed = `u_${name}`
    if (this.uniformLocations.has(prefixed)) return this.uniformLocations.get(prefixed)!
    if (name.startsWith("u_")) {
      const stripped = name.slice(2)
      if (this.uniformLocations.has(stripped)) return this.uniformLocations.get(stripped)!
    }
    return this.getUniformLoc(name) ||
           this.getUniformLoc(prefixed) ||
           (name.startsWith("u_") ? this.getUniformLoc(name.slice(2)) : null)
  }

  private applyUniform(loc: WebGLUniformLocation, val: UniformValue) {
    const gl = this.gl
    if (!gl) return

    switch (val.type) {
      case "mat4": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : []
        const data = arr.length === 16 ? new Float32Array(arr) : new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
        gl.uniformMatrix4fv(loc, false, data)
        break
      }
      case "mat3": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : []
        const data = arr.length === 9 ? new Float32Array(arr) : new Float32Array([1,0,0, 0,1,0, 0,0,1])
        gl.uniformMatrix3fv(loc, false, data)
        break
      }
      case "mat2": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : []
        const data = arr.length === 4 ? new Float32Array(arr) : new Float32Array([1,0, 0,1])
        gl.uniformMatrix2fv(loc, false, data)
        break
      }
      case "vec4": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : [0, 0, 0, 0]
        gl.uniform4fv(loc, new Float32Array([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 0]))
        break
      }
      case "vec3": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : [0, 0, 0]
        gl.uniform3fv(loc, new Float32Array([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0]))
        break
      }
      case "color": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : [0.5, 0.5, 0.5]
        if (arr.length >= 4) {
          gl.uniform4fv(loc, new Float32Array([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 1]))
        } else {
          gl.uniform3fv(loc, new Float32Array([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0]))
        }
        break
      }
      case "vec2": {
        const arr = Array.isArray(val.value) || val.value instanceof Float32Array ? (val.value as any) : [0, 0]
        gl.uniform2fv(loc, new Float32Array([arr[0] ?? 0, arr[1] ?? 0]))
        break
      }
      case "float": {
        gl.uniform1f(loc, typeof val.value === "number" ? val.value : Number(val.value) || 0)
        break
      }
      case "bool": {
        gl.uniform1i(loc, val.value ? 1 : 0)
        break
      }
      case "int": {
        gl.uniform1i(loc, Math.round(Number(val.value) || 0))
        break
      }
      case "uint": {
        gl.uniform1ui(loc, Math.max(0, Math.round(Number(val.value) || 0)))
        break
      }
    }
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl; if (!gl) return null
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vertexShader, vertexSource); gl.compileShader(vertexShader)
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(vertexShader); useProjectStore.getState().setLastCompileError(`Vertex shader error: ${error}`); return null }
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fragmentShader, fragmentSource); gl.compileShader(fragmentShader)
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(fragmentShader); useProjectStore.getState().setLastCompileError(`Fragment shader error: ${error}`); return null }
    const program = gl.createProgram()!; gl.attachShader(program, vertexShader); gl.attachShader(program, fragmentShader); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const error = gl.getProgramInfoLog(program); useProjectStore.getState().setLastCompileError(`Program link error: ${error}`); return null }
    gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader)
    return program
  }

  private createGeometry(geometry: GeometryKey) {
    const gl = this.gl; if (!gl) return
    if (this.vao) gl.deleteVertexArray(this.vao); if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer)
    const vertices = getVerticesForGeometry(geometry); this.vertexCount = vertices.length / 3
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao)
    this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null); this.currentGeometry = geometry
  }

  private initializePostProcess() { const vignetteProgram = this.createProgram(PASSTHROUGH_VERTEX, VIGNETTE_FRAGMENT); if (vignetteProgram) this.postProcessPrograms.push(vignetteProgram) }

  private createPostProcessFramebuffers(width: number, height: number) {
    for (const fb of this.postProcessFramebuffers) fb.destroy()
    this.postProcessFramebuffers = []
    if (this.hasPostProcess) for (let i = 0; i < 2; i++) { const fb = new WebGL2Framebuffer(this.gl!); fb.resize(width, height); this.postProcessFramebuffers.push(fb) }
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
  }

  updateAudioData(textureBuffer: Uint8Array, uniforms: AudioUniforms) {
    this.audioUniforms = uniforms
    const gl = this.gl
    if (!gl || !this.initialized) return

    if (!this.audioTexture) {
      this.createAudioTexture()
    }

    if (this.audioTexture && textureBuffer.length >= 1024) {
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
      } catch {
        // Safe write fallback in headless mock
      }
    }
  }

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    this.queueTextures = []
    this.textureBindings = {}
    const ppSteps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []

    for (const step of queue) {
      if (step.type === "mesh") {
        this.createGeometry(step.geometry as GeometryKey)
      } else if (step.type === "texture") {
        this.queueTextures.push({ id: step.id, binding: step.binding })
        this.loadTexture(step.id)
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
          id: step.id || `${passType}-${ppSteps.length}`,
          pass: passType,
          customSource: step.customSource,
          uniforms: step.uniforms || {},
        })
      }
    }
    if (this.hasPostProcess && this.canvas) {
      this.createPostProcessFramebuffers(this.canvas.width, this.canvas.height)
      this.rebuildPostProcessPasses(ppSteps)
    } else {
      this.cleanupPostProcessPasses()
    }
  }

  private rebuildPostProcessPasses(steps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }>) {
    this.cleanupPostProcessPasses()
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
        this.postProcessPrograms.push(program)
        const uniformLocations = new Map<string, WebGLUniformLocation | null>()
        const names = [
          "u_texture", "u_resolution",
          "u_vignetteIntensity", "u_vignetteRadius",
          "u_blurAmount",
          "u_aberrationOffset",
          "u_bloomThreshold", "u_bloomIntensity",
        ]
        for (const name of names) {
          uniformLocations.set(name, gl.getUniformLocation(program, name))
        }

        const uniforms: Record<string, number | number[]> = {
          ...getDefaultPostProcessUniforms(step.pass),
          ...step.uniforms,
        }

        this.postProcessPasses.push({
          id: step.id,
          passType: step.pass,
          program,
          uniformLocations,
          uniforms,
        })
      }
    }
  }

  private cleanupPostProcessPasses() {
    const gl = this.gl
    for (const pass of this.postProcessPasses) {
      if (gl) gl.deleteProgram(pass.program)
    }
    this.postProcessPasses = []
    this.postProcessPrograms = []
  }

  recompileShader(source: string) {
    const gl = this.gl; if (!gl || !this.initialized) return
    const customVert = useProjectStore.getState().vertexShaderSource
    let vertSource = customVert || defaultVertSource, fragSource = source
    if (source.includes("#ifdef FRAGMENT")) { const parts = source.split("#ifdef FRAGMENT"); vertSource = parts[0].replace("// Fragment shader", "").trim(); fragSource = parts[1].replace("#endif", "").trim() }
    const newProgram = this.createProgram(vertSource, fragSource)
    if (newProgram) {
      if (this.program) gl.deleteProgram(this.program)
      this.program = newProgram
      this.cacheUniformLocations()
      this.mvpLocation = this.getUniformLoc("u_mvp")
      this.colorLocation = this.getUniformLoc("u_color")
      this.uniformsDirty = true
      useProjectStore.getState().setLastCompileError(null)
    }
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
    this.createPostProcessFramebuffers(canvasWidth, canvasHeight)
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
    gl.bindVertexArray(null)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas?.width || 800, this.canvas?.height || 600)
  }

  renderFrame(time: number, _delta: number = 16) {
    if (!this.initialized || !this.gl || !this.canvas || !this.program) return
    if (this.shadowSettings.enabled) {
      this.renderShadowPass()
    }
    this.frameCount++
    if (time - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFrameTime = time
      if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / (this.fps || 1), timestamp: time })
    }
    this.angleX += 0.01
    this.angleY += 0.015
    const aspect = this.canvas.width / (this.canvas.height || 1)
    setPerspectiveMatrixWebGL2(this.projMatrix, Math.PI / 4, aspect, 0.1, 100)

    // TAA Jitter application
    if (this.state.postProcessState.taa.enabled) {
      this.taaFrameIndex = (this.taaFrameIndex + 1) % 8
      const jX = (this.halton(this.taaFrameIndex, 2) - 0.5) / (this.canvas.width || 800)
      const jY = (this.halton(this.taaFrameIndex, 3) - 0.5) / (this.canvas.height || 600)
      this.state.postProcessState.taa.jitterSample = [jX, jY]
      this.projMatrix[8] += jX * 2.0
      this.projMatrix[9] += jY * 2.0
    }

    setLookAtMatrix(this.viewMatrix, [0, 2, 4], [0, 0, 0], [0, 1, 0])
    setRotationMatrix(this.rotMatrix, this.angleX, this.angleY)
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
      gl.bindVertexArray(null)

      gl.enable(gl.DEPTH_TEST)
      if (typeof (gl as any).depthMask === "function") (gl as any).depthMask(true)
    }

    gl.useProgram(this.program)

    if (this.mvpLocation) {
      gl.uniformMatrix4fv(this.mvpLocation, false, this.mvpMatrix)
    }

    // Time uniform update
    const timeLoc = this.findUniformLoc("time")
    if (timeLoc) {
      gl.uniform1f(timeLoc, time / 1000)
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
    for (const [uniformName, texId] of Object.entries(this.textureBindings)) {
      let tex = this.loadedTextures.get(texId) || this.defaultTexture
      if (texId === "audioTexture" || uniformName === "audioTexture" || uniformName === "u_audioTexture") {
        tex = this.audioTexture || this.defaultTexture
      }
      if (tex) {
        gl.activeTexture(gl.TEXTURE0 + activeUnit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        const loc = this.findUniformLoc(uniformName)
        if (loc) {
          gl.uniform1i(loc, activeUnit)
        }
        activeUnit++
      }
    }
    for (const qTex of this.queueTextures) {
      const tex = this.loadedTextures.get(qTex.id) || this.defaultTexture
      if (tex) {
        const unit = qTex.binding ?? activeUnit
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        const loc = this.findUniformLoc(`u_texture${unit}`) || this.findUniformLoc("u_texture")
        if (loc) {
          gl.uniform1i(loc, unit)
        }
      }
    }

    if (this.hasAudio || this.audioTexture) {
      const bassLoc = this.findUniformLoc("u_audio_bass") || this.findUniformLoc("audio_bass") || this.findUniformLoc("u_bass")
      if (bassLoc) gl.uniform1f(bassLoc, this.audioUniforms.bass)
      const midLoc = this.findUniformLoc("u_audio_mid") || this.findUniformLoc("audio_mid") || this.findUniformLoc("u_mid")
      if (midLoc) gl.uniform1f(midLoc, this.audioUniforms.mid)
      const trebleLoc = this.findUniformLoc("u_audio_treble") || this.findUniformLoc("audio_treble") || this.findUniformLoc("u_treble")
      if (trebleLoc) gl.uniform1f(trebleLoc, this.audioUniforms.treble)
      const levelLoc = this.findUniformLoc("u_audio_level") || this.findUniformLoc("audio_level") || this.findUniformLoc("u_level")
      if (levelLoc) gl.uniform1f(levelLoc, this.audioUniforms.level)
      const beatLoc = this.findUniformLoc("u_audio_beat") || this.findUniformLoc("audio_beat") || this.findUniformLoc("u_beat")
      if (beatLoc) gl.uniform1f(beatLoc, this.audioUniforms.beat)

      const audioTexLoc = this.findUniformLoc("u_audioTexture") || this.findUniformLoc("audioTexture")
      if (audioTexLoc && this.audioTexture) {
        gl.activeTexture(gl.TEXTURE0 + activeUnit)
        gl.bindTexture(gl.TEXTURE_2D, this.audioTexture)
        gl.uniform1i(audioTexLoc, activeUnit)
        activeUnit++
      }
    }

    // Bind environment map if shader declares it
    const envLoc = this.findUniformLoc("envMap") || this.findUniformLoc("u_envMap")
    if (envLoc && this.envTexture) {
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, this.envTexture)
      gl.uniform1i(envLoc, 7)
    }
    const envExpLoc = this.findUniformLoc("envExposure") || this.findUniformLoc("u_envExposure")
    if (envExpLoc) {
      const exp = useProjectStore.getState().environmentSettings?.exposure ?? 1.0
      gl.uniform1f(envExpLoc, exp)
    }
    const envRotLoc = this.findUniformLoc("envRotation") || this.findUniformLoc("u_envRotation")
    if (envRotLoc) {
      const rot = useProjectStore.getState().environmentSettings?.rotation ?? 0.0
      gl.uniform1f(envRotLoc, (rot * Math.PI) / 180)
    }

    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount); gl.bindVertexArray(null)

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
      if (!this.quadVAO) {
        this.quadVAO = gl.createVertexArray(); gl.bindVertexArray(this.quadVAO)
        this.quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      }

      const passes = this.postProcessPasses.length > 0
        ? this.postProcessPasses
        : (this.postProcessPrograms.length > 0
            ? [{
                id: "vignette-default",
                passType: "vignette" as PostProcessPassType,
                program: this.postProcessPrograms[0],
                uniformLocations: new Map<string, WebGLUniformLocation | null>(),
                uniforms: { u_vignetteIntensity: 0.5, u_vignetteRadius: 0.8 },
              }]
            : [])

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

        const locTex = pass.uniformLocations.get("u_texture") ?? gl.getUniformLocation(pass.program, "u_texture")
        if (locTex) gl.uniform1i(locTex, 0)

        const bindAux = (uniformName: string, unit: number, tex: WebGLTexture | null) => {
          const loc = pass.uniformLocations.get(uniformName) ?? gl.getUniformLocation(pass.program, uniformName)
          if (loc) {
            gl.activeTexture(gl.TEXTURE0 + unit)
            gl.bindTexture(gl.TEXTURE_2D, tex || this.defaultTexture)
            gl.uniform1i(loc, unit)
          }
        }
        bindAux("u_depthTexture", 1, this.gBufferDepthTex)
        bindAux("u_normalTexture", 2, this.gBufferNormalTex)
        bindAux("u_motionTexture", 3, this.gBufferMotionTex)
        bindAux("u_historyTexture", 4, this.postProcessFramebuffers[1 - currentRead]?.getTexture() || this.defaultTexture)

        const locRes = pass.uniformLocations.get("u_resolution") ?? gl.getUniformLocation(pass.program, "u_resolution")
        if (locRes) gl.uniform2f(locRes, this.canvas.width, this.canvas.height)

        for (const [uName, uVal] of Object.entries(pass.uniforms)) {
          const loc = pass.uniformLocations.get(uName) ?? gl.getUniformLocation(pass.program, uName)
          if (loc && typeof uVal === "number") {
            gl.uniform1f(loc, uVal)
          }
        }

        gl.bindVertexArray(this.quadVAO)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        gl.bindVertexArray(null)

        if (!isFinal) {
          currentRead = 1 - currentRead
        }
      }
    }
  }

  private renderDeferredPass() {
    const gl = this.gl
    if (!gl) return

    if (!this.quadVAO) {
      this.quadVAO = gl.createVertexArray()
      gl.bindVertexArray(this.quadVAO)
      this.quadBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    }

    if (!this.deferredLightingProgram) {
      const vsSource = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`
      const fsSource = `#version 300 es
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
      this.deferredLightingProgram = this.createProgram(vsSource, fsSource)
    }

    if (!this.deferredLightingProgram) return

    gl.useProgram(this.deferredLightingProgram)
    gl.bindVertexArray(this.quadVAO)

    const bindTex = (name: string, unit: number, tex: WebGLTexture | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex || this.defaultTexture)
      const loc = gl.getUniformLocation(this.deferredLightingProgram!, name)
      if (loc) gl.uniform1i(loc, unit)
    }

    bindTex("u_albedoTex", 0, this.gBufferAlbedoTex)
    bindTex("u_normalTex", 1, this.gBufferNormalTex)
    bindTex("u_roughnessTex", 2, this.gBufferRoughnessTex)
    bindTex("u_depthTex", 3, this.gBufferDepthTex)
    bindTex("u_motionTex", 4, this.gBufferMotionTex)
    bindTex("u_shadowMap", 5, this.shadowMapTex)
    bindTex("u_envMap", 6, this.envTexture)

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
    const debugLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_debugView")
    if (debugLoc) gl.uniform1i(debugLoc, debugCode)

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

    const lightDirLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_lightDir")
    if (lightDirLoc) gl.uniform3f(lightDirLoc, lDirX, lDirY, lDirZ)
    const lightColLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_lightColor")
    if (lightColLoc) gl.uniform3f(lightColLoc, lColR, lColG, lColB)
    const lightIntLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_lightIntensity")
    if (lightIntLoc) gl.uniform1f(lightIntLoc, lInt)
    const shadowEnLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_shadowEnabled")
    if (shadowEnLoc) gl.uniform1f(shadowEnLoc, this.shadowSettings.enabled ? 1.0 : 0.0)
    const envExpLoc = gl.getUniformLocation(this.deferredLightingProgram, "u_envExposure")
    if (envExpLoc) gl.uniform1f(envExpLoc, useProjectStore.getState().environmentSettings?.exposure ?? 1.0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
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
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  private setupSkyboxPipeline() {
    const gl = this.gl
    if (!gl) return
    try {
      this.skyboxProgram = this.createProgram(skyboxVertSource, skyboxFragSource)
      if (this.skyboxProgram) {
        this.skyboxVAO = gl.createVertexArray()
        const names = ["u_envMap", "u_camRight", "u_camUp", "u_camForward", "u_rotation", "u_blur", "u_exposure"]
        for (const name of names) {
          this.skyboxUniformLocations.set(name, gl.getUniformLocation(this.skyboxProgram, name))
        }
      }
    } catch (e) {
      console.warn("Failed to setup WebGL2 skybox pipeline:", e)
    }
  }

  private async loadCustomEnvironment(src: string, expectedPreset?: string) {
    if (!this.gl || !this.initialized) return
    try {
      const res = await fetch(src)
      if (!res.ok) return
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.gl || !this.initialized) return
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

  private halton(index: number, base: number): number {
    let result = 0
    let f = 1 / base
    let i = index
    while (i > 0) {
      result += f * (i % base)
      i = Math.floor(i / base)
      f /= base
    }
    return result
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

    const setTexMeta = (tex: any, format: string, width: number, height: number) => {
      if (!tex) return
      try {
        Object.defineProperty(tex, "format", { value: format, configurable: true, writable: true })
      } catch {
        tex.format = format
      }
      try {
        Object.defineProperty(tex, "width", { value: width, configurable: true, writable: true })
      } catch {
        tex.width = width
      }
      try {
        Object.defineProperty(tex, "height", { value: height, configurable: true, writable: true })
      } catch {
        tex.height = height
      }
    }
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
    this.cleanupPostProcessPasses()
    const gl = this.gl
    if (gl) {
      if (this.program) gl.deleteProgram(this.program)
      if (this.skyboxProgram) gl.deleteProgram(this.skyboxProgram)
      if (this.skyboxVAO) gl.deleteVertexArray(this.skyboxVAO)
      this.skyboxProgram = null
      this.skyboxVAO = null
      this.skyboxUniformLocations.clear()
      if (this.vao) gl.deleteVertexArray(this.vao)
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer)
      if (this.quadVAO) gl.deleteVertexArray(this.quadVAO)
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
      for (const prog of this.postProcessPrograms) gl.deleteProgram(prog)
      for (const fb of this.postProcessFramebuffers) fb.destroy()
      for (const tex of this.loadedTextures.values()) gl.deleteTexture(tex)
      this.loadedTextures.clear()
      if (this.defaultTexture) gl.deleteTexture(this.defaultTexture)
      this.defaultTexture = null
      if (this.envTexture) gl.deleteTexture(this.envTexture)
      this.envTexture = null
      this.currentEnvPreset = null
      if (this.audioTexture) gl.deleteTexture(this.audioTexture)
      this.audioTexture = null
      this.hasAudio = false
      if (this.gBufferFBO) gl.deleteFramebuffer(this.gBufferFBO)
      if (this.gBufferAlbedoTex) gl.deleteTexture(this.gBufferAlbedoTex)
      if (this.gBufferNormalTex) gl.deleteTexture(this.gBufferNormalTex)
      if (this.gBufferRoughnessTex) gl.deleteTexture(this.gBufferRoughnessTex)
      if (this.gBufferDepthTex) gl.deleteTexture(this.gBufferDepthTex)
      if (this.gBufferMotionTex) gl.deleteTexture(this.gBufferMotionTex)
      this.gBufferFBO = null
      this.gBufferAlbedoTex = null
      this.gBufferNormalTex = null
      this.gBufferRoughnessTex = null
      this.gBufferDepthTex = null
      this.gBufferMotionTex = null
      this.state.gBufferTargets = null
      if (this.shadowFBO) gl.deleteFramebuffer(this.shadowFBO)
      if (this.shadowMapTex) gl.deleteTexture(this.shadowMapTex)
      if (this.shadowCubeMapTex) gl.deleteTexture(this.shadowCubeMapTex)
      this.shadowFBO = null
      this.shadowMapTex = null
      this.shadowCubeMapTex = null
      if (this.deferredLightingProgram) gl.deleteProgram(this.deferredLightingProgram)
      this.deferredLightingProgram = null
    }
    if (this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel()
      this.unsubscribeCustomModel = null
    }
    this.queueTextures = []
    this.textureBindings = {}
    if (this.canvas) { this.canvas.removeEventListener("webglcontextlost", this.handleContextLost); this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored) }
    this.program = null; this.vao = null; this.vertexBuffer = null; this.quadVAO = null; this.quadBuffer = null; this.initialized = false; this.gl = null; this.canvas = null
    this.uniformLocations.clear()
    this.uniformValues.clear()
    this.authoritativeUniforms.clear()
    this.lastStoreValues = null
    this.uniformsDirty = true
  }
}

export const webgl2Adapter = new WebGL2Adapter()
