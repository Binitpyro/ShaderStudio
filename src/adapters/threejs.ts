import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
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
import type { UniformValue, ParsedUniform, EnvironmentSettings } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import type { PostProcessPassType } from "@/core/postProcessChain"
import { customModelRegistry } from "@/core/customModelRegistry"
import { generateEnvironmentCanvas, ENVIRONMENT_PRESETS } from "@/core/environmentGenerator"
import { renderCoordinator } from "@/core/renderCoordinator"
import { performanceTelemetry } from "@/core/performanceTelemetry"

type GeometryKey = "cube" | "sphere" | "plane" | "torus_knot" | "custom"

export class ThreeJSAdapter implements RenderAdapter {
  readonly backendType = "threejs" as const
  private canvas: HTMLCanvasElement | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private currentEnvTexture: THREE.Texture | null = null
  private currentEnvPreset: string | null = null
  private mesh: THREE.Mesh | null = null
  private material: THREE.ShaderMaterial | null = null
  private animationId: number | null = null
  private initialized = false
  private currentGeometry: GeometryKey = "cube"
  private composer: EffectComposer | null = null
  private postProcessPassesMap = new Map<string, ShaderPass>()
  private hasPostProcess = false
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void
  private cachedUniformValues = new Map<string, UniformValue>()
  private loadedTextures = new Map<string, THREE.Texture>()
  private textureBindings: Record<string, string> = {}
  private defaultTexture: THREE.Texture | null = null
  private unsubscribeCustomModel: (() => void) | null = null
  private geometryCache = new Map<GeometryKey, THREE.BufferGeometry>()
  private isExternalLoopDriven = false
  /** Bumped on dispose so async loads from a previous mount never touch the new one. */
  private session = 0
  /** Bumped whenever the environment preset changes; stale loader callbacks compare against it. */
  private envGeneration = 0
  private loadingTextures = new Set<string>()
  private postPasses: ShaderPass[] = []
  private postChainKey: string | null = null
  private readonly tmpProj = new THREE.Matrix4()
  private readonly tmpLightDir = new THREE.Vector3()

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
      color: [1, 0.95, 0.9],
      orthoSize: 10,
      near: 0.1,
      far: 50,
    },
  }

  public gBufferDebugView: GBufferDebugView = "none"
  private antiAliasingMode: AntiAliasingMode = "none"
  private directionalLight: THREE.DirectionalLight | null = null
  private pointLight: THREE.PointLight | null = null
  private gBufferRenderTarget: THREE.WebGLRenderTarget | null = null
  private deferredLightingScene: THREE.Scene | null = null
  private deferredLightingCamera: THREE.OrthographicCamera | null = null
  private deferredLightingMaterial: THREE.ShaderMaterial | null = null
  private deferredLightingQuad: THREE.Mesh | null = null
  public deferredLightingProgram: THREE.ShaderMaterial | null = null
  private taaFrameIndex = 0

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

  private defaultVertexShader = `
    varying vec3 vNormal;
    void main() { vNormal = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `
  private defaultFragmentShader = `
    uniform vec3 u_color;
    varying vec3 vNormal;
    void main() { gl_FragColor = vec4(u_color, 1.0); }
  `

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
      this.renderer.setPixelRatio(window.devicePixelRatio || 1)
      // Composer/deferred paths call render() several times per frame; we reset + read once per frame ourselves.
      if (this.renderer.info) this.renderer.info.autoReset = false
      this.renderer.setClearColor(new THREE.Color(0.08, 0.08, 0.1), 1)
      this.scene = new THREE.Scene()
      const aspect = canvas.clientWidth / canvas.clientHeight
      this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100)
      this.camera.position.set(0, 2, 4); this.camera.lookAt(0, 0, 0)
      this.createDefaultTexture()
      this.createMesh(this.currentGeometry)
      if (!this.unsubscribeCustomModel) {
        this.unsubscribeCustomModel = customModelRegistry.subscribe(() => {
          if (this.currentGeometry === "custom") {
            this.createMesh("custom")
          }
        })
      }
      if (this.renderer.shadowMap) {
        this.renderer.shadowMap.enabled = this.shadowSettings.enabled
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
      }
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); this.scene.add(ambientLight)
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
      directionalLight.position.set(5, 5, 5)
      directionalLight.castShadow = true
      directionalLight.shadow.mapSize.width = this.state.shadowConfig.resolution
      directionalLight.shadow.mapSize.height = this.state.shadowConfig.resolution
      directionalLight.shadow.bias = this.state.shadowConfig.bias
      this.directionalLight = directionalLight
      this.scene.add(directionalLight)
      const pointLight = new THREE.PointLight(0xffffff, 1.0, 50)
      pointLight.position.set(0, 3, 0)
      pointLight.castShadow = this.state.pointShadowCubeEnabled
      pointLight.shadow.mapSize.width = this.state.shadowConfig.resolution
      pointLight.shadow.mapSize.height = this.state.shadowConfig.resolution
      pointLight.shadow.bias = this.state.shadowConfig.bias
      this.pointLight = pointLight
      this.scene.add(pointLight)
      const envSettings = useProjectStore.getState().environmentSettings
      if (envSettings) {
        this.updateEnvironment(envSettings)
      }
      this.initialized = true
      useProjectStore.getState().setLastCompileError(null)
      this.startRenderLoop()
      return true
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(`Three.js init failed: ${msg}`); return false }
  }

  private createDefaultTexture(): THREE.Texture {
    if (this.defaultTexture) return this.defaultTexture
    const data = new Uint8Array([255, 255, 255, 255])
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    texture.needsUpdate = true
    this.defaultTexture = texture
    return texture
  }

  private async loadTexture(textureId: string) {
    if (!this.initialized) return
    const resource = useProjectStore.getState().textureResources.find((t) => t.id === textureId)
    if (!resource || this.loadedTextures.has(textureId) || this.loadingTextures.has(textureId)) return
    const session = this.session
    this.loadingTextures.add(textureId)
    try {
      const response = await fetch(resource.src)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.initialized || session !== this.session) {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      const tex = new THREE.Texture(bitmap as any)
      tex.needsUpdate = true
      this.loadedTextures.set(textureId, tex)
      this.applyTextureBindings()
      renderCoordinator.requestRender()
    } catch (e) {
      if (this.initialized && session === this.session) console.error("Failed to load texture in Three.js:", e)
    } finally {
      this.loadingTextures.delete(textureId)
    }
  }

  /** Disposes graph textures that left the graph (not referenced by the queue, bindings or uniform values). */
  private pruneTextures(keep: Set<string>) {
    for (const v of this.cachedUniformValues.values()) if (v.type === "texture") keep.add(String(v.value))
    for (const id of Object.values(this.textureBindings)) keep.add(id)
    const pruned = new Set<THREE.Texture>()
    for (const [id, tex] of this.loadedTextures) {
      if (keep.has(id)) continue
      tex.dispose()
      pruned.add(tex)
      this.loadedTextures.delete(id)
    }
    if (pruned.size && this.material) {
      for (const u of Object.values(this.material.uniforms)) {
        if (pruned.has(u.value)) u.value = this.createDefaultTexture()
      }
    }
  }

  private applyTextureBindings() {
    if (!this.material) return
    const defaultTex = this.createDefaultTexture()
    for (const [uniformName, textureId] of Object.entries(this.textureBindings)) {
      const tex = this.loadedTextures.get(textureId) || defaultTex
      const key = this.material.uniforms[uniformName]
        ? uniformName
        : this.material.uniforms[`u_${uniformName}`]
        ? `u_${uniformName}`
        : uniformName.startsWith("u_") && this.material.uniforms[uniformName.slice(2)]
        ? uniformName.slice(2)
        : uniformName

      if (this.material.uniforms[key]) {
        this.material.uniforms[key].value = tex
      } else {
        this.material.uniforms[key] = { value: tex }
      }
    }
    this.material.uniformsNeedUpdate = true
  }

  private getOrCreateGeometry(geometry: GeometryKey): THREE.BufferGeometry {
    if (geometry !== "custom" && this.geometryCache.has(geometry)) {
      return this.geometryCache.get(geometry)!
    }
    let threeGeometry: THREE.BufferGeometry
    switch (geometry) {
      case "cube": threeGeometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "sphere": threeGeometry = new THREE.SphereGeometry(1, 32, 32); break;
      case "plane": threeGeometry = new THREE.PlaneGeometry(2, 2); break;
      case "torus_knot": threeGeometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16); break;
      case "custom": {
        const custom = customModelRegistry.getActiveModel()
        if (custom) {
          threeGeometry = new THREE.BufferGeometry()
          threeGeometry.setAttribute("position", new THREE.BufferAttribute(custom.positions, 3))
          threeGeometry.setAttribute("normal", new THREE.BufferAttribute(custom.normals, 3))
          threeGeometry.setAttribute("uv", new THREE.BufferAttribute(custom.uvs, 2))
        } else {
          threeGeometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16)
        }
        return threeGeometry
      }
      default: threeGeometry = new THREE.BoxGeometry(2, 2, 2)
    }
    this.geometryCache.set(geometry, threeGeometry)
    return threeGeometry
  }

  private createMesh(geometry: GeometryKey) {
    if (!this.scene) return
    if (this.mesh && this.currentGeometry === geometry && geometry !== "custom") return

    const threeGeometry = this.getOrCreateGeometry(geometry)

    if (this.mesh) {
      if (this.currentGeometry === "custom" && this.mesh.geometry !== threeGeometry) {
        this.mesh.geometry.dispose()
      }
      this.mesh.geometry = threeGeometry
      this.currentGeometry = geometry
      return
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: this.defaultVertexShader,
      fragmentShader: this.defaultFragmentShader,
      uniforms: { u_color: { value: new THREE.Color(0.4, 0.6, 0.9) } },
      side: THREE.DoubleSide,
    })
    this.syncMaterialUniforms(this.defaultFragmentShader)
    this.mesh = new THREE.Mesh(threeGeometry, this.material); this.scene.add(this.mesh); this.currentGeometry = geometry
  }

  private createInitialValue(u: ParsedUniform): unknown {
    if (u.kind === "color") return new THREE.Color(0.4, 0.6, 0.9)
    if (u.type === "mat4x4f") return new THREE.Matrix4()
    if (u.type === "mat3x3f") return new THREE.Matrix3()
    if (u.type === "mat2x2f") return [1, 0, 0, 1]
    if (u.type === "vec4f") return new THREE.Vector4(0, 0, 0, 1)
    if (u.type === "vec3f") return new THREE.Vector3(0, 0, 0)
    if (u.type === "vec2f") return new THREE.Vector2(0, 0)
    if (u.type === "bool") return false
    return 0
  }

  private syncMaterialUniforms(glslSource: string) {
    if (!this.material) return
    const parsed = parseGlslUniforms(glslSource)
    const uniforms = this.material.uniforms

    for (const u of parsed) {
      if (u.kind === "texture") {
        if (!uniforms[u.name]) {
          uniforms[u.name] = { value: this.createDefaultTexture() }
        }
        continue
      }
      if (!uniforms[u.name]) {
        uniforms[u.name] = { value: this.createInitialValue(u) }
      }
    }

    const storeValues = useProjectStore.getState().uniformValues
    for (const [name, val] of Object.entries(storeValues)) {
      this.updateUniform(name, val)
    }
    for (const [name, val] of this.cachedUniformValues.entries()) {
      this.updateUniform(name, val)
    }
    this.applyTextureBindings()
  }

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    this.textureBindings = {}
    const keepTextures = new Set<string>()
    const ppSteps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []

    for (const step of queue) {
      if (step.type === "mesh") {
        this.createMesh(step.geometry as GeometryKey)
      } else if (step.type === "texture") {
        keepTextures.add(step.id)
        this.loadTexture(step.id)
      } else if (step.type === "material") {
        if (step.textureBindings) {
          this.textureBindings = { ...step.textureBindings }
          for (const texKey of Object.values(step.textureBindings)) {
            keepTextures.add(texKey)
            this.loadTexture(texKey)
          }
          this.applyTextureBindings()
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
    this.pruneTextures(keepTextures)
    if (this.hasPostProcess) {
      const key = JSON.stringify(ppSteps)
      if (this.composer && key === this.postChainKey) return // same chain: keep passes (and their GPU programs)
      this.setupPostProcess(ppSteps)
      this.postChainKey = key
    } else {
      this.disposePostChain()
    }
    renderCoordinator.requestRender()
  }

  private disposePostChain() {
    for (const pass of this.postPasses) pass.dispose()
    this.postPasses = []
    this.composer?.dispose()
    this.composer = null
    this.postProcessPassesMap.clear()
    this.postChainKey = null
  }

  private setupPostProcess(steps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []) {
    if (!this.renderer || !this.scene || !this.camera) return
    this.disposePostChain()
    this.composer = new EffectComposer(this.renderer)

    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    const w = this.canvas?.width || 800
    const h = this.canvas?.height || 600
    const passSteps = steps.length > 0
      ? steps
      : [{ id: "vignette-default", pass: "vignette" as PostProcessPassType, uniforms: {} }]

    for (let i = 0; i < passSteps.length; i++) {
      const step = passSteps[i]
      const isFinal = (i === passSteps.length - 1)
      let shaderDef: any

      switch (step.pass) {
        case "blur": {
          const amount = Number(step.uniforms.amount ?? step.uniforms.u_blurAmount ?? 2.0)
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_resolution: { value: new THREE.Vector2(w, h) },
              u_blurAmount: { value: amount },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform vec2 u_resolution;
              uniform float u_blurAmount;
              varying vec2 vUv;
              void main() {
                vec2 texelSize = 1.0 / u_resolution * u_blurAmount;
                vec4 result = vec4(0.0);
                float weights[9] = float[](0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625);
                int idx = 0;
                for (int y = -1; y <= 1; y++) {
                  for (int x = -1; x <= 1; x++) {
                    vec2 offset = vec2(float(x), float(y)) * texelSize;
                    result += texture2D(tDiffuse, vUv + offset) * weights[idx];
                    idx++;
                  }
                }
                gl_FragColor = result;
              }
            `,
          }
          break
        }
        case "chromatic_aberration": {
          const offset = Number(step.uniforms.offset ?? step.uniforms.u_aberrationOffset ?? 0.008)
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_aberrationOffset: { value: offset },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform float u_aberrationOffset;
              varying vec2 vUv;
              void main() {
                vec2 uv = vUv;
                vec2 dir = uv - vec2(0.5);
                float dist = length(dir);
                vec2 offset = (dist > 0.0001) ? (dir / dist) * u_aberrationOffset : vec2(u_aberrationOffset, 0.0);
                float r = texture2D(tDiffuse, uv + offset).r;
                float g = texture2D(tDiffuse, uv).g;
                float b = texture2D(tDiffuse, uv - offset).b;
                float a = texture2D(tDiffuse, uv).a;
                gl_FragColor = vec4(r, g, b, a);
              }
            `,
          }
          break
        }
        case "bloom": {
          const threshold = Number(step.uniforms.threshold ?? step.uniforms.u_bloomThreshold ?? 0.7)
          const intensity = Number(step.uniforms.intensity ?? step.uniforms.u_bloomIntensity ?? 0.5)
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_bloomThreshold: { value: threshold },
              u_bloomIntensity: { value: intensity },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform float u_bloomThreshold;
              uniform float u_bloomIntensity;
              varying vec2 vUv;
              void main() {
                vec4 baseColor = texture2D(tDiffuse, vUv);
                float stepSize = 0.004;
                vec3 glow = max(baseColor.rgb - vec3(u_bloomThreshold), vec3(0.0));
                glow += max(texture2D(tDiffuse, vUv + vec2(-stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
                glow += max(texture2D(tDiffuse, vUv + vec2(stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
                glow += max(texture2D(tDiffuse, vUv + vec2(0.0, -stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));
                glow += max(texture2D(tDiffuse, vUv + vec2(0.0, stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));
                glow = (glow / 5.0) * u_bloomIntensity;
                gl_FragColor = vec4(baseColor.rgb + glow, baseColor.a);
              }
            `,
          }
          break
        }
        case "custom": {
          shaderDef = {
            uniforms: { tDiffuse: { value: null } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              varying vec2 vUv;
              void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                gl_FragColor = vec4(1.0 - color.rgb, color.a);
              }
            `,
          }
          break
        }
        case "fxaa": {
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_resolution: { value: new THREE.Vector2(w, h) },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform vec2 u_resolution;
              varying vec2 vUv;
              float rgb2luma(vec3 rgb) { return dot(rgb, vec3(0.299, 0.587, 0.114)); }
              void main() {
                vec2 inverseVP = 1.0 / u_resolution;
                vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
                float lumaM = rgb2luma(rgbM);
                float lumaNW = rgb2luma(texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * inverseVP).rgb);
                float lumaNE = rgb2luma(texture2D(tDiffuse, vUv + vec2( 1.0, -1.0) * inverseVP).rgb);
                float lumaSW = rgb2luma(texture2D(tDiffuse, vUv + vec2(-1.0,  1.0) * inverseVP).rgb);
                float lumaSE = rgb2luma(texture2D(tDiffuse, vUv + vec2( 1.0,  1.0) * inverseVP).rgb);
                float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
                float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
                float lumaRange = lumaMax - lumaMin;
                if (lumaRange < max(0.0312, lumaMax * 0.125)) {
                  gl_FragColor = vec4(rgbM, 1.0);
                  return;
                }
                vec2 dir;
                dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
                dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
                float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * 0.125), 0.00001);
                float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
                dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * inverseVP;
                vec3 rgbA = 0.5 * (
                  texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
                  texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
                );
                vec3 rgbB = rgbA * 0.5 + 0.25 * (
                  texture2D(tDiffuse, vUv + dir * (0.0 / 3.0 - 0.5)).rgb +
                  texture2D(tDiffuse, vUv + dir * (3.0 / 3.0 - 0.5)).rgb
                );
                float lumaB = rgb2luma(rgbB);
                if ((lumaB < lumaMin) || (lumaB > lumaMax)) {
                  gl_FragColor = vec4(rgbA, 1.0);
                } else {
                  gl_FragColor = vec4(rgbB, 1.0);
                }
              }
            `,
          }
          break
        }
        case "taa": {
          const feedbackMax = Number(step.uniforms.feedbackMax ?? step.uniforms.u_feedbackMax ?? 0.95)
          const motionScale = Number(step.uniforms.motionScale ?? step.uniforms.u_motionScale ?? 1.0)
          const motionTex = this.gBufferRenderTarget?.textures?.[3] || this.createDefaultTexture()
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_historyTexture: { value: this.createDefaultTexture() },
              u_motionTexture: { value: motionTex },
              u_resolution: { value: new THREE.Vector2(w, h) },
              u_feedbackMax: { value: feedbackMax },
              u_motionScale: { value: motionScale },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform sampler2D u_historyTexture;
              uniform sampler2D u_motionTexture;
              uniform vec2 u_resolution;
              uniform float u_feedbackMax;
              uniform float u_motionScale;
              varying vec2 vUv;
              vec3 RGBToYCoCg(vec3 rgb) {
                float Y = dot(rgb, vec3(0.25, 0.5, 0.25));
                float Co = dot(rgb, vec3(0.5, 0.0, -0.5));
                float Cg = dot(rgb, vec3(-0.25, 0.5, -0.25));
                return vec3(Y, Co, Cg);
              }
              vec3 YCoCgToRGB(vec3 ycocg) {
                float Y = ycocg.x;
                float Co = ycocg.y;
                float Cg = ycocg.z;
                return vec3(Y + Co - Cg, Y + Cg, Y - Co - Cg);
              }
              void main() {
                vec2 texelSize = 1.0 / u_resolution;
                vec4 currentColor = texture2D(tDiffuse, vUv);
                vec2 motion = texture2D(u_motionTexture, vUv).xy * u_motionScale;
                vec2 historyUV = vUv - motion;
                vec4 historyColor = texture2D(u_historyTexture, historyUV);
                vec3 minColor = RGBToYCoCg(currentColor.rgb);
                vec3 maxColor = minColor;
                for (int y = -1; y <= 1; y++) {
                  for (int x = -1; x <= 1; x++) {
                    vec3 neighbor = RGBToYCoCg(texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * texelSize).rgb);
                    minColor = min(minColor, neighbor);
                    maxColor = max(maxColor, neighbor);
                  }
                }
                vec3 historyYCoCg = clamp(RGBToYCoCg(historyColor.rgb), minColor, maxColor);
                vec3 clampedHistory = YCoCgToRGB(historyYCoCg);
                float blendWeight = clamp(u_feedbackMax, 0.8, 0.98);
                if (!(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)) {
                  blendWeight = 0.0;
                }
                vec3 finalColor = mix(currentColor.rgb, clampedHistory, blendWeight);
                gl_FragColor = vec4(finalColor, currentColor.a);
              }
            `,
          }
          break
        }
        case "dof": {
          const focalDistance = Number(step.uniforms.focalDistance ?? step.uniforms.u_focalDistance ?? 5.0)
          const aperture = Number(step.uniforms.aperture ?? step.uniforms.u_aperture ?? 0.05)
          const maxBlur = Number(step.uniforms.maxBlur ?? step.uniforms.u_maxBlur ?? 16.0)
          const bokehShape = Number(step.uniforms.bokehShape ?? step.uniforms.u_bokehShape ?? 0.0)
          const depthTex = this.gBufferRenderTarget?.depthTexture || this.createDefaultTexture()
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_depthTexture: { value: depthTex },
              u_resolution: { value: new THREE.Vector2(w, h) },
              u_focalDistance: { value: focalDistance },
              u_aperture: { value: aperture },
              u_maxBlur: { value: maxBlur },
              u_bokehShape: { value: bokehShape },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform sampler2D u_depthTexture;
              uniform vec2 u_resolution;
              uniform float u_focalDistance;
              uniform float u_aperture;
              uniform float u_maxBlur;
              uniform float u_bokehShape;
              varying vec2 vUv;
              void main() {
                vec4 centerColor = texture2D(tDiffuse, vUv);
                float depth = texture2D(u_depthTexture, vUv).r;
                float near = 0.1;
                float far = 100.0;
                float zLinear = (near * far) / (far - depth * (far - near));
                float coc = clamp(abs(zLinear - u_focalDistance) / max(zLinear, 0.001) * u_aperture * 100.0, 0.0, u_maxBlur);
                if (coc < 0.5) {
                  gl_FragColor = centerColor;
                  return;
                }
                vec4 accum = vec4(0.0);
                float totalWeight = 0.0;
                vec2 texelSize = 1.0 / u_resolution;
                for (int i = 0; i < 24; i++) {
                  float theta = float(i) * 2.3999632;
                  float r = sqrt(float(i + 1) / 24.0) * coc;
                  if (u_bokehShape > 0.5) {
                    float n = u_bokehShape > 1.5 ? 8.0 : 6.0;
                    float piN = 3.14159265 / n;
                    float modAngle = mod(theta, 2.0 * piN) - piN;
                    r *= cos(piN) / cos(modAngle);
                  }
                  vec2 offset = vec2(cos(theta), sin(theta)) * r * texelSize;
                  vec4 sampleCol = texture2D(tDiffuse, vUv + offset);
                  float lum = dot(sampleCol.rgb, vec3(0.299, 0.587, 0.114));
                  float weight = 1.0 + pow(max(0.0, lum - 0.7), 2.0) * 4.0;
                  accum += sampleCol * weight;
                  totalWeight += weight;
                }
                gl_FragColor = accum / max(totalWeight, 0.001);
              }
            `,
          }
          break
        }
        case "ssao": {
          const radius = Number(step.uniforms.radius ?? step.uniforms.u_radius ?? 0.5)
          const intensity = Number(step.uniforms.intensity ?? step.uniforms.u_intensity ?? 1.5)
          const sampleCount = Number(step.uniforms.sampleCount ?? step.uniforms.u_sampleCount ?? 16.0)
          const bias = Number(step.uniforms.bias ?? step.uniforms.u_bias ?? 0.025)
          const depthTex = this.gBufferRenderTarget?.depthTexture || this.createDefaultTexture()
          const normalTex = this.gBufferRenderTarget?.textures?.[1] || this.createDefaultTexture()
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_depthTexture: { value: depthTex },
              u_normalTexture: { value: normalTex },
              u_resolution: { value: new THREE.Vector2(w, h) },
              u_radius: { value: radius },
              u_intensity: { value: intensity },
              u_sampleCount: { value: sampleCount },
              u_bias: { value: bias },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform sampler2D u_depthTexture;
              uniform sampler2D u_normalTexture;
              uniform vec2 u_resolution;
              uniform float u_radius;
              uniform float u_intensity;
              uniform float u_sampleCount;
              uniform float u_bias;
              varying vec2 vUv;
              float interleavedGradientNoise(vec2 screenPos) {
                return fract(52.9829189 * fract(dot(screenPos, vec2(0.06711056, 0.00583715))));
              }
              void main() {
                vec4 baseColor = texture2D(tDiffuse, vUv);
                float depth = texture2D(u_depthTexture, vUv).r;
                if (depth >= 1.0) {
                  gl_FragColor = baseColor;
                  return;
                }
                vec3 normal = texture2D(u_normalTexture, vUv).xyz;
                normal = normalize(normal * 2.0 - 1.0);
                vec2 screenPos = vUv * u_resolution;
                float noise = interleavedGradientNoise(screenPos);
                float angle = noise * 6.2831853;
                mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
                float occlusion = 0.0;
                int samples = int(clamp(u_sampleCount, 4.0, 32.0));
                float radius = u_radius * 0.05;
                for (int i = 0; i < 32; i++) {
                  if (i >= samples) break;
                  float fi = float(i) / float(samples);
                  float sampleAngle = fi * 6.2831853 * 2.0;
                  float dist = sqrt(fi) * radius;
                  vec2 offset = rot * vec2(cos(sampleAngle), sin(sampleAngle)) * dist;
                  vec2 sampleUV = clamp(vUv + offset, vec2(0.0), vec2(1.0));
                  float sampleDepth = texture2D(u_depthTexture, sampleUV).r;
                  float depthDiff = (depth - sampleDepth);
                  if (depthDiff > u_bias && depthDiff < radius * 4.0) {
                    float distFalloff = 1.0 - smoothstep(0.0, radius * 4.0, depthDiff);
                    occlusion += distFalloff;
                  }
                }
                float ao = clamp(1.0 - (occlusion / float(samples)) * u_intensity, 0.0, 1.0);
                gl_FragColor = vec4(baseColor.rgb * ao, baseColor.a);
              }
            `,
          }
          break
        }
        case "ssr": {
          const maxSteps = Number(step.uniforms.maxSteps ?? step.uniforms.u_maxSteps ?? 64.0)
          const thickness = Number(step.uniforms.thickness ?? step.uniforms.u_thickness ?? 0.02)
          const falloff = Number(step.uniforms.falloff ?? step.uniforms.u_falloff ?? 0.8)
          const iblBlend = Number(step.uniforms.iblBlend ?? step.uniforms.u_iblBlend ?? 0.5)
          const depthTex = this.gBufferRenderTarget?.depthTexture || this.createDefaultTexture()
          const normalTex = this.gBufferRenderTarget?.textures?.[1] || this.createDefaultTexture()
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_depthTexture: { value: depthTex },
              u_normalTexture: { value: normalTex },
              u_resolution: { value: new THREE.Vector2(w, h) },
              u_maxSteps: { value: maxSteps },
              u_thickness: { value: thickness },
              u_falloff: { value: falloff },
              u_iblBlend: { value: iblBlend },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform sampler2D u_depthTexture;
              uniform sampler2D u_normalTexture;
              uniform vec2 u_resolution;
              uniform float u_maxSteps;
              uniform float u_thickness;
              uniform float u_falloff;
              uniform float u_iblBlend;
              varying vec2 vUv;
              void main() {
                vec4 baseColor = texture2D(tDiffuse, vUv);
                float depth = texture2D(u_depthTexture, vUv).r;
                if (depth >= 1.0) {
                  gl_FragColor = baseColor;
                  return;
                }
                vec4 normRough = texture2D(u_normalTexture, vUv);
                vec3 normal = normalize(normRough.xyz * 2.0 - 1.0);
                float roughness = normRough.a;
                if (roughness > 0.6) {
                  gl_FragColor = baseColor;
                  return;
                }
                vec3 reflectDir = reflect(vec3(0.0, 0.0, -1.0), normal);
                int maxSteps = int(clamp(u_maxSteps, 16.0, 128.0));
                float stepSize = 0.02;
                vec2 hitUV = vUv;
                bool hit = false;
                for (int i = 0; i < 128; i++) {
                  if (i >= maxSteps) break;
                  hitUV += reflectDir.xy * stepSize;
                  if (hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) break;
                  float sampleDepth = texture2D(u_depthTexture, hitUV).r;
                  float diff = depth - sampleDepth;
                  if (diff > 0.0 && diff < u_thickness) {
                    hit = true;
                    break;
                  }
                  stepSize *= 1.02;
                }
                if (hit) {
                  vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.1), hitUV) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - hitUV);
                  float confidence = pow(edgeFade.x * edgeFade.y, u_falloff) * (1.0 - roughness / 0.6);
                  vec4 reflectedColor = texture2D(tDiffuse, hitUV);
                  vec3 blended = mix(baseColor.rgb, reflectedColor.rgb, confidence * (1.0 - u_iblBlend));
                  gl_FragColor = vec4(blended, baseColor.a);
                } else {
                  gl_FragColor = baseColor;
                }
              }
            `,
          }
          break
        }
        case "vignette":
        default: {
          const intensity = Number(step.uniforms.intensity ?? step.uniforms.u_vignetteIntensity ?? 0.5)
          const radius = Number(step.uniforms.radius ?? step.uniforms.u_vignetteRadius ?? 0.8)
          shaderDef = {
            uniforms: {
              tDiffuse: { value: null },
              u_vignetteIntensity: { value: intensity },
              u_vignetteRadius: { value: radius },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform float u_vignetteIntensity;
              uniform float u_vignetteRadius;
              varying vec2 vUv;
              void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                float vignette = smoothstep(u_vignetteRadius, u_vignetteRadius - 0.3, dist);
                vignette = mix(1.0, vignette, u_vignetteIntensity);
                gl_FragColor = vec4(color.rgb * vignette, color.a);
              }
            `,
          }
          break
        }
      }

      const shaderPass = new ShaderPass(shaderDef)
      if (isFinal) shaderPass.renderToScreen = true
      this.postProcessPassesMap.set(step.id, shaderPass)
      this.postProcessPassesMap.set(step.pass, shaderPass)
      this.postPasses.push(shaderPass)
      this.composer.addPass(shaderPass)
    }
  }

  updatePostProcessUniform(nodeId: string, name: string, value: number | number[]) {
    const pass = this.postProcessPassesMap.get(nodeId)
    if (!pass || !pass.uniforms) return
    const numericVal = typeof value === "number" ? value : Number(value[0]) || 0
    const rawName = name.startsWith("u_") ? name : `u_${name}`
    if (pass.uniforms[rawName]) {
      pass.uniforms[rawName].value = numericVal
    } else if (pass.uniforms[name]) {
      pass.uniforms[name].value = numericVal
    }
  }

  /**
   * Compiles the candidate shaders on a throwaway material and returns the driver log (line numbers
   * remapped to the user's source) or null when it compiles. The live material is untouched, so a broken
   * edit keeps the last good frame on screen.
   */
  private validateShader(vertexShader: string, fragmentShader: string, glsl3: boolean): string | null {
    const r = this.renderer
    if (!r || !this.camera || !this.mesh || typeof r.compile !== "function") return null
    const probe = new THREE.ShaderMaterial({ vertexShader, fragmentShader, glslVersion: glsl3 ? THREE.GLSL3 : null, side: THREE.DoubleSide })
    const probeScene = new THREE.Scene()
    probeScene.add(new THREE.Mesh(this.mesh.geometry, probe))
    const dbg = r.debug
    const prevCheck = dbg?.checkShaderErrors, prevCb = dbg?.onShaderError
    const stage = (gl: WebGLRenderingContext, sh: WebGLShader | null, label: string, user: string) => {
      const log = (sh && gl.getShaderInfoLog(sh)) || ""
      if (!log.trim()) return ""
      const body = user.replace(/^\s*#version[^\n]*\n/, "").trim()
      const full = (sh && gl.getShaderSource(sh)) || ""
      const at = body ? full.lastIndexOf(body) : -1
      const offset = at > 0 ? full.slice(0, at).split("\n").length - 1 : 0
      const mapped = log.trim().replace(/(ERROR|WARNING):\s*(\d+):(\d+)/g, (_m, sev, f, line) => `${sev}: ${f}:${Math.max(1, Number(line) - offset)}`)
      return `${label} shader error:\n${mapped}`
    }
    let message = ""
    if (dbg) {
      dbg.checkShaderErrors = true
      dbg.onShaderError = (gl: WebGLRenderingContext, program: WebGLProgram, glVs: WebGLShader, glFs: WebGLShader) => {
        message = [stage(gl, glVs, "Vertex", vertexShader), stage(gl, glFs, "Fragment", fragmentShader)].filter(Boolean).join("\n")
        if (!message) message = (gl.getProgramInfoLog(program) || "Program link error").trim()
      }
    }
    try {
      r.compile(probeScene, this.camera)
      // With KHR_parallel_shader_compile three defers the status check until first use; force it.
      ;(r as any).properties?.get(probe)?.currentProgram?.getUniforms?.()
    } catch (e) {
      message ||= e instanceof Error ? e.message : String(e)
    } finally {
      if (dbg) { dbg.checkShaderErrors = prevCheck as boolean; dbg.onShaderError = prevCb as typeof dbg.onShaderError }
      probeScene.clear()
      probe.dispose()
    }
    return message || null
  }

  recompileShader(source: string) {
    if (!this.material || !this.initialized) return
    try {
      const customVert = useProjectStore.getState().vertexShaderSource
      const vertexShader = customVert || this.defaultVertexShader
      const fragmentShader = source
      const glsl3 = source.includes("#version 300 es") || vertexShader.includes("#version 300 es")
      const error = this.validateShader(vertexShader, fragmentShader, glsl3)
      if (error) {
        useProjectStore.getState().setLastCompileError(`Shader compile error:\n${error}`)
        return
      }
      this.material.glslVersion = glsl3 ? THREE.GLSL3 : null
      this.material.side = THREE.DoubleSide
      this.material.vertexShader = vertexShader
      this.material.fragmentShader = fragmentShader
      this.syncMaterialUniforms(fragmentShader)
      this.material.needsUpdate = true
      useProjectStore.getState().setLastCompileError(null)
      renderCoordinator.requestRender()
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(`Shader compile error: ${msg}`) }
  }

  updateUniform(name: string, value: UniformValue) {
    if (!this.material) return
    this.cachedUniformValues.set(name, value)
    const uniforms = this.material.uniforms

    const key = uniforms[name]
      ? name
      : uniforms[`u_${name}`]
      ? `u_${name}`
      : name.startsWith("u_") && uniforms[name.slice(2)]
      ? name.slice(2)
      : name

    if (!uniforms[key]) {
      uniforms[key] = { value: null }
    }

    const target = uniforms[key]

    switch (value.type) {
      case "mat4": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : []
        if (!(target.value instanceof THREE.Matrix4)) target.value = new THREE.Matrix4()
        if (arr.length === 16) (target.value as THREE.Matrix4).fromArray(arr)
        break
      }
      case "mat3": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : []
        if (!(target.value instanceof THREE.Matrix3)) target.value = new THREE.Matrix3()
        if (arr.length === 9) (target.value as THREE.Matrix3).fromArray(arr)
        break
      }
      case "mat2": {
        const src = Array.isArray(value.value) ? value.value : [1, 0, 0, 1]
        if (Array.isArray(target.value) && target.value.length === src.length) {
          for (let i = 0; i < src.length; i++) target.value[i] = src[i]
        } else {
          target.value = src.slice()
        }
        break
      }
      case "vec4": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : [0, 0, 0, 0]
        if (!(target.value instanceof THREE.Vector4)) target.value = new THREE.Vector4()
        ;(target.value as THREE.Vector4).set(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 0)
        break
      }
      case "color": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : [0.5, 0.5, 0.5]
        if (!(target.value instanceof THREE.Color)) target.value = new THREE.Color()
        ;(target.value as THREE.Color).setRGB(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0)
        break
      }
      case "vec3": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : [0, 0, 0]
        if (target.value instanceof THREE.Color) {
          target.value.setRGB(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0)
        } else {
          if (!(target.value instanceof THREE.Vector3)) target.value = new THREE.Vector3()
          ;(target.value as THREE.Vector3).set(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0)
        }
        break
      }
      case "vec2": {
        const arr = Array.isArray(value.value) || value.value instanceof Float32Array ? (value.value as any) : [0, 0]
        if (!(target.value instanceof THREE.Vector2)) target.value = new THREE.Vector2()
        ;(target.value as THREE.Vector2).set(arr[0] ?? 0, arr[1] ?? 0)
        break
      }
      case "float": {
        target.value = typeof value.value === "number" ? value.value : Number(value.value) || 0
        break
      }
      case "bool": {
        target.value = Boolean(value.value)
        break
      }
      case "int":
      case "uint": {
        target.value = Math.round(Number(value.value) || 0)
        break
      }
      case "texture": {
        const textureId = String(value.value)
        this.textureBindings[name] = textureId
        this.loadTexture(textureId)
        const tex = this.loadedTextures.get(textureId) || this.createDefaultTexture()
        target.value = tex
        break
      }
    }

    this.material.uniformsNeedUpdate = true
  }

  resize(width: number, height: number, customDpr?: number) {
    if (!this.canvas || !this.renderer || !this.camera) return
    const dpr = customDpr !== undefined ? customDpr : (typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1)
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    const canvasWidth = Math.max(1, Math.floor(safeWidth * dpr))
    const canvasHeight = Math.max(1, Math.floor(safeHeight * dpr))
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(safeWidth, safeHeight, false)
    this.canvas.width = canvasWidth
    this.canvas.height = canvasHeight
    this.camera.aspect = safeWidth / safeHeight
    this.camera.updateProjectionMatrix()
    if (this.composer) {
      this.composer.setPixelRatio(dpr)
      this.composer.setSize(safeWidth, safeHeight)
      for (const pass of this.postPasses) {
        const res = pass.uniforms?.u_resolution?.value
        if (res instanceof THREE.Vector2) res.set(canvasWidth, canvasHeight)
      }
    }
    if (this.state.pipelineMode === "deferred") {
      this.initGBuffer(canvasWidth, canvasHeight)
    }
  }

  renderFrame(time: number, _delta: number = 16) {
    if (!this.initialized || !this.renderer || !this.scene || !this.camera || !this.mesh) return
    this.frameCount++
    if (time < this.lastFrameTime) this.lastFrameTime = time // playback seeked backwards
    if (time - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFrameTime = time
      if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / (this.fps || 1), timestamp: time })
    }
    // Pure function of playback time (0.6 / 0.9 rad/s) so seeking and replay are deterministic.
    const seconds = time / 1000
    this.mesh.rotation.x = seconds * 0.6
    this.mesh.rotation.y = seconds * 0.9
    this.renderer.info?.reset()

    if (this.material) {
      const timeUniform = this.material.uniforms["u_time"] || this.material.uniforms["time"]
      if (timeUniform) {
        timeUniform.value = time / 1000
      }
    }

    // TAA Halton subpixel jitter
    let jittered = false
    if (this.state.postProcessState.taa.enabled) {
      this.taaFrameIndex = (this.taaFrameIndex + 1) % 8
      const jX = (this.halton(this.taaFrameIndex, 2) - 0.5) / (this.canvas?.width || 800)
      const jY = (this.halton(this.taaFrameIndex, 3) - 0.5) / (this.canvas?.height || 600)
      const js = this.state.postProcessState.taa.jitterSample // in place: no per-frame allocation
      js[0] = jX
      js[1] = jY
      this.tmpProj.copy(this.camera.projectionMatrix)
      jittered = true
      this.camera.projectionMatrix.elements[8] += jX * 2.0
      this.camera.projectionMatrix.elements[9] += jY * 2.0
    }

    try {
      if (this.state.pipelineMode === "deferred") {
        if (!this.gBufferRenderTarget) {
          this.initGBuffer(this.canvas?.width || 800, this.canvas?.height || 600)
        }
        this.renderer.setRenderTarget(this.gBufferRenderTarget)
        this.renderer.clear()
        this.renderer.render(this.scene, this.camera)
        this.renderer.setRenderTarget(null)

        this.updateDeferredLightingUniforms()
        if (this.deferredLightingScene && this.deferredLightingCamera) {
          this.renderer.render(this.deferredLightingScene, this.deferredLightingCamera)
        }
      } else {
        if (this.composer && this.hasPostProcess) this.composer.render()
        else this.renderer.render(this.scene, this.camera)
      }
    } finally {
      // a throw in composer.render must not leave the camera jittered (it would compound next frame)
      if (jittered) this.camera.projectionMatrix.copy(this.tmpProj)
    }

    const info = this.renderer.info
    if (info) performanceTelemetry.reportFrameStats({ drawCalls: info.render.calls, triangles: info.render.triangles })
  }

  setExternalLoopDriven(external: boolean) {
    this.isExternalLoopDriven = external
    if (external && this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    } else if (!external && this.initialized && this.animationId === null) {
      this.startRenderLoop()
    }
  }

  private startRenderLoop() {
    if (this.isExternalLoopDriven) return
    const render = (time: number) => {
      if (this.isExternalLoopDriven) {
        this.animationId = null
        return
      }
      this.renderFrame(time, 16)
      if (!this.isExternalLoopDriven) {
        this.animationId = requestAnimationFrame(render)
      }
    }
    this.animationId = requestAnimationFrame(render)
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  updateAudioData(_textureBuffer: Uint8Array, uniforms: AudioUniforms) {
    if (!this.material) return
    const u = this.material.uniforms
    if (u["u_audio_bass"] || u["audio_bass"]) (u["u_audio_bass"] || u["audio_bass"]).value = uniforms.bass
    if (u["u_audio_mid"] || u["audio_mid"]) (u["u_audio_mid"] || u["audio_mid"]).value = uniforms.mid
    if (u["u_audio_treble"] || u["audio_treble"]) (u["u_audio_treble"] || u["audio_treble"]).value = uniforms.treble
    if (u["u_audio_level"] || u["audio_level"]) (u["u_audio_level"] || u["audio_level"]).value = uniforms.level
    if (u["u_audio_beat"] || u["audio_beat"]) (u["u_audio_beat"] || u["audio_beat"]).value = uniforms.beat
  }

  updateEnvironment(settings: EnvironmentSettings) {
    if (!this.scene || !this.renderer) return

    // Update tone mapping exposure
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = Math.max(0.1, settings.exposure)

    // Generate or update environment texture if preset changed
    if (this.currentEnvPreset !== settings.preset || !this.currentEnvTexture) {
      this.currentEnvPreset = settings.preset
      const gen = ++this.envGeneration
      // Async loads apply only if no newer preset (or dispose) happened; otherwise the texture is freed.
      const adopt = (tex: THREE.Texture) => {
        if (gen !== this.envGeneration || !this.scene) { tex.dispose(); return }
        tex.mapping = THREE.EquirectangularReflectionMapping
        if (this.currentEnvTexture && this.currentEnvTexture !== tex) this.currentEnvTexture.dispose()
        this.currentEnvTexture = tex
        this.applyEnvToScene(settings)
        renderCoordinator.requestRender()
      }
      if (this.currentEnvTexture) {
        this.currentEnvTexture.dispose()
        this.currentEnvTexture = null
      }

      if (settings.preset === "custom" && settings.customTextureSrc) {
        const loader = new THREE.TextureLoader()
        loader.load(settings.customTextureSrc, adopt)
        return
      } else {
        const presetMeta = ENVIRONMENT_PRESETS.find((p) => p.id === settings.preset)
        const imgSrc = presetMeta?.imageSrc
        if (imgSrc && typeof window !== "undefined") {
          const loader = new THREE.TextureLoader()
          loader.load(imgSrc, adopt, undefined, () => {})
        }
        const canvas = generateEnvironmentCanvas(settings.preset)
        if (canvas) {
          const tex = new THREE.CanvasTexture(canvas)
          tex.mapping = THREE.EquirectangularReflectionMapping
          tex.needsUpdate = true
          this.currentEnvTexture = tex
        }
      }
    }

    this.applyEnvToScene(settings)
  }

  private applyEnvToScene(settings: EnvironmentSettings) {
    if (!this.scene) return

    if (this.currentEnvTexture) {
      this.scene.environment = this.currentEnvTexture

      if (settings.showSkybox) {
        this.scene.background = this.currentEnvTexture
        if ("backgroundBlurriness" in this.scene) {
          (this.scene as any).backgroundBlurriness = settings.backgroundBlur
        }
      } else {
        this.scene.background = null
      }

      const rad = (settings.rotation * Math.PI) / 180
      if ("environmentRotation" in this.scene) {
        (this.scene as any).environmentRotation = new THREE.Euler(0, rad, 0)
      }
      if ("backgroundRotation" in this.scene) {
        (this.scene as any).backgroundRotation = new THREE.Euler(0, rad, 0)
      }
    } else {
      this.scene.environment = null
      this.scene.background = null
    }
  }

  private initGBuffer(width: number, height: number) {
    const w = Math.max(1, width)
    const h = Math.max(1, height)

    if (this.gBufferRenderTarget) {
      this.gBufferRenderTarget.dispose()
      this.gBufferRenderTarget = null
    }

    try {
      this.gBufferRenderTarget = new THREE.WebGLRenderTarget(w, h, {
        count: 4,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      })
      this.gBufferRenderTarget.depthTexture = new THREE.DepthTexture(w, h)
    } catch {}

    const albedoTex = this.gBufferRenderTarget?.textures?.[0] || this.gBufferRenderTarget?.texture || this.createDefaultTexture()
    const normalTex = this.gBufferRenderTarget?.textures?.[1] || albedoTex
    const roughnessTex = this.gBufferRenderTarget?.textures?.[2] || albedoTex
    const motionTex = this.gBufferRenderTarget?.textures?.[3] || albedoTex
    const depthTex = this.gBufferRenderTarget?.depthTexture || this.createDefaultTexture()

    const setTexMeta = (tex: any, format: string, width: number, height: number) => {
      if (!tex) return
      try { tex.image = { width, height } } catch {}
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

    setTexMeta(albedoTex, "rgba16float", w, h)
    setTexMeta(normalTex, "rgba16float", w, h)
    setTexMeta(roughnessTex, "rg8unorm", w, h)
    setTexMeta(depthTex, "depth24plus-stencil8", w, h)
    setTexMeta(motionTex, "rg16float", w, h)

    this.state.gBufferTargets = {
      albedo: albedoTex,
      normal: normalTex,
      roughnessMetallic: roughnessTex,
      depth: depthTex,
      motionVectors: motionTex,
    }

    this.initDeferredLightingScene()
  }

  private initDeferredLightingScene() {
    if (this.deferredLightingScene && this.deferredLightingMaterial) {
      const gbuffer = this.state.gBufferTargets
      if (gbuffer) {
        this.deferredLightingMaterial.uniforms["u_albedoTex"].value = gbuffer.albedo
        this.deferredLightingMaterial.uniforms["u_normalTex"].value = gbuffer.normal
        this.deferredLightingMaterial.uniforms["u_roughnessTex"].value = gbuffer.roughnessMetallic
        this.deferredLightingMaterial.uniforms["u_depthTex"].value = gbuffer.depth
        this.deferredLightingMaterial.uniforms["u_motionTex"].value = gbuffer.motionVectors
      }
      return
    }

    this.deferredLightingScene = new THREE.Scene()
    this.deferredLightingCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const gbuffer = this.state.gBufferTargets
    const albedo = gbuffer?.albedo || this.createDefaultTexture()
    const normal = gbuffer?.normal || this.createDefaultTexture()
    const roughness = gbuffer?.roughnessMetallic || this.createDefaultTexture()
    const depth = gbuffer?.depth || this.createDefaultTexture()
    const motion = gbuffer?.motionVectors || this.createDefaultTexture()

    this.deferredLightingMaterial = new THREE.ShaderMaterial({
      uniforms: {
        u_albedoTex: { value: albedo },
        u_normalTex: { value: normal },
        u_roughnessTex: { value: roughness },
        u_depthTex: { value: depth },
        u_motionTex: { value: motion },
        u_debugView: { value: 0 },
        u_lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.75).normalize() },
        u_lightColor: { value: new THREE.Color(1.0, 0.95, 0.9) },
        u_lightIntensity: { value: 1.0 },
        u_envExposure: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D u_albedoTex;
        uniform sampler2D u_normalTex;
        uniform sampler2D u_roughnessTex;
        uniform sampler2D u_depthTex;
        uniform sampler2D u_motionTex;
        uniform int u_debugView;
        uniform vec3 u_lightDir;
        uniform vec3 u_lightColor;
        uniform float u_lightIntensity;
        uniform float u_envExposure;
        varying vec2 vUv;

        void main() {
          vec4 albedo = texture2D(u_albedoTex, vUv);
          vec4 normalSample = texture2D(u_normalTex, vUv);
          vec3 N = normalize(normalSample.xyz * 2.0 - 1.0);
          vec4 roughnessMetallic = texture2D(u_roughnessTex, vUv);
          float roughness = roughnessMetallic.r;
          float metallic = roughnessMetallic.g;
          float depth = texture2D(u_depthTex, vUv).r;
          vec4 motion = texture2D(u_motionTex, vUv);

          if (u_debugView == 1) { gl_FragColor = vec4(albedo.rgb, 1.0); return; }
          if (u_debugView == 2) { gl_FragColor = vec4(N * 0.5 + 0.5, 1.0); return; }
          if (u_debugView == 3) { gl_FragColor = vec4(vec3(roughness), 1.0); return; }
          if (u_debugView == 4) { gl_FragColor = vec4(vec3(metallic), 1.0); return; }
          if (u_debugView == 5) { gl_FragColor = vec4(vec3(depth), 1.0); return; }
          if (u_debugView == 6) { gl_FragColor = vec4(vec3(motion.rg * 10.0 + 0.5, 0.0), 1.0); return; }

          vec3 L = normalize(u_lightDir);
          float NdotL = max(dot(N, L), 0.0);
          vec3 diffuse = albedo.rgb * u_lightColor * (NdotL * u_lightIntensity);
          vec3 ambient = albedo.rgb * 0.15 * u_envExposure;
          gl_FragColor = vec4(diffuse + ambient, albedo.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    })

    this.deferredLightingProgram = this.deferredLightingMaterial
    this.deferredLightingQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.deferredLightingMaterial)
    this.deferredLightingScene.add(this.deferredLightingQuad)
  }

  private updateDeferredLightingUniforms() {
    if (!this.deferredLightingMaterial) return
    const debugViewCodes: Record<GBufferDebugView, number> = {
      none: 0,
      albedo: 1,
      normal: 2,
      roughness: 3,
      metallic: 4,
      depth: 5,
      motion: 6,
    }
    this.deferredLightingMaterial.uniforms["u_debugView"].value = debugViewCodes[this.gBufferDebugView] ?? 0

    const dirLight = this.shadowSettings.directionalLight
    if (dirLight) {
      if (dirLight.enabled === false) {
        this.deferredLightingMaterial.uniforms["u_lightIntensity"].value = 0.0
      } else {
        this.deferredLightingMaterial.uniforms["u_lightIntensity"].value = dirLight.intensity ?? 1.0
      }
      if (dirLight.position && dirLight.target) {
        this.tmpLightDir.set(
          dirLight.position[0] - dirLight.target[0],
          dirLight.position[1] - dirLight.target[1],
          dirLight.position[2] - dirLight.target[2]
        ).normalize()
        this.deferredLightingMaterial.uniforms["u_lightDir"].value.copy(this.tmpLightDir)
      }
      if (dirLight.color) {
        this.deferredLightingMaterial.uniforms["u_lightColor"].value.setRGB(
          dirLight.color[0],
          dirLight.color[1],
          dirLight.color[2]
        )
      }
    }
    const envSettings = useProjectStore.getState().environmentSettings
    if (envSettings) {
      this.deferredLightingMaterial.uniforms["u_envExposure"].value = envSettings.exposure ?? 1.0
    }
  }

  setRenderingPipelineMode(mode: RenderingPipelineMode) {
    this.state.pipelineMode = mode
    if (mode === "deferred") {
      const w = this.canvas?.width || 1920
      const h = this.canvas?.height || 1080
      this.initGBuffer(w, h)
    } else {
      this.state.gBufferTargets = null
      if (this.gBufferRenderTarget) {
        this.gBufferRenderTarget.dispose()
        this.gBufferRenderTarget = null
      }
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
    if (this.directionalLight && config.resolution) {
      this.directionalLight.shadow.mapSize.width = config.resolution
      this.directionalLight.shadow.mapSize.height = config.resolution
    }
    if (this.pointLight && config.resolution) {
      this.pointLight.shadow.mapSize.width = config.resolution
      this.pointLight.shadow.mapSize.height = config.resolution
    }
    if (this.directionalLight && config.bias !== undefined) {
      this.directionalLight.shadow.bias = config.bias
    }
    if (this.pointLight && config.bias !== undefined) {
      this.pointLight.shadow.bias = config.bias
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
    if (this.directionalLight && settings.resolution) {
      this.directionalLight.shadow.mapSize.width = settings.resolution
      this.directionalLight.shadow.mapSize.height = settings.resolution
    }
    if (this.pointLight && settings.resolution) {
      this.pointLight.shadow.mapSize.width = settings.resolution
      this.pointLight.shadow.mapSize.height = settings.resolution
    }
    if (this.directionalLight && settings.bias !== undefined) {
      this.directionalLight.shadow.bias = settings.bias
    }
    if (this.pointLight && settings.bias !== undefined) {
      this.pointLight.shadow.bias = settings.bias
    }
  }

  getShadowSettings(): ShadowSettings {
    return this.shadowSettings
  }

  setPointLightShadowCube(enabled: boolean) {
    this.state.pointShadowCubeEnabled = enabled
    if (this.pointLight) {
      this.pointLight.castShadow = enabled
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
    if (this.directionalLight) {
      const phi = (tod / 24) * 2 * Math.PI - Math.PI / 2
      this.directionalLight.position.set(Math.cos(phi) * 10, Math.sin(phi) * 10, 5)
      this.directionalLight.intensity = Math.max(0, Math.sin(phi)) * (this.state.atmosphereParams.sunIntensity)
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
    this.session++
    this.envGeneration++
    this.loadingTextures.clear()
    if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null }
    this.isExternalLoopDriven = false
    if (this.mesh) {
      if (this.currentGeometry === "custom") {
        this.mesh.geometry.dispose()
      }
      if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose()
    }
    for (const geom of this.geometryCache.values()) {
      geom.dispose()
    }
    this.geometryCache.clear()
    if (this.scene) this.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); if (obj.material instanceof THREE.Material) obj.material.dispose() } })
    this.disposePostChain()
    this.directionalLight?.shadow.dispose()
    this.pointLight?.shadow.dispose()
    if (this.renderer) {
      this.renderer.dispose()
      // dispose() alone leaves the GL context alive; release it so contexts don't pile up across backend switches.
      this.renderer.forceContextLoss()
    }
    for (const tex of this.loadedTextures.values()) {
      tex.dispose()
    }
    this.loadedTextures.clear()
    if (this.defaultTexture) {
      this.defaultTexture.dispose()
      this.defaultTexture = null
    }
    if (this.currentEnvTexture) {
      this.currentEnvTexture.dispose()
      this.currentEnvTexture = null
    }
    this.currentEnvPreset = null
    this.textureBindings = {}
    if (this.unsubscribeCustomModel) {
      this.unsubscribeCustomModel()
      this.unsubscribeCustomModel = null
    }
    if (this.gBufferRenderTarget) {
      this.gBufferRenderTarget.dispose()
      this.gBufferRenderTarget = null
    }
    if (this.deferredLightingMaterial) {
      this.deferredLightingMaterial.dispose()
      this.deferredLightingMaterial = null
    }
    if (this.deferredLightingQuad) {
      this.deferredLightingQuad.geometry.dispose()
      this.deferredLightingQuad = null
    }
    this.deferredLightingScene = null
    this.deferredLightingCamera = null
    this.deferredLightingProgram = null
    this.state.gBufferTargets = null
    this.directionalLight = null
    this.pointLight = null
    this.renderer = null; this.scene = null; this.camera = null; this.mesh = null; this.material = null; this.initialized = false; this.canvas = null
    this.cachedUniformValues.clear()
  }
}

export const threejsAdapter = new ThreeJSAdapter()
