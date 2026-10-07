import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue, ParsedUniform } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import type { PostProcessPassType } from "@/core/postProcessChain"

type GeometryKey = "cube" | "sphere" | "plane"

export class ThreeJSAdapter implements RenderAdapter {
  readonly backendType = "threejs" as const
  private canvas: HTMLCanvasElement | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
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
      this.renderer.setClearColor(new THREE.Color(0.08, 0.08, 0.1), 1)
      this.scene = new THREE.Scene()
      const aspect = canvas.clientWidth / canvas.clientHeight
      this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100)
      this.camera.position.set(0, 2, 4); this.camera.lookAt(0, 0, 0)
      this.createDefaultTexture()
      this.createMesh(this.currentGeometry)
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); this.scene.add(ambientLight)
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); directionalLight.position.set(5, 5, 5); this.scene.add(directionalLight)
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
    if (!resource || this.loadedTextures.has(textureId)) return
    try {
      const response = await fetch(resource.src)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      if (!this.initialized) {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      const tex = new THREE.Texture(bitmap as any)
      tex.needsUpdate = true
      this.loadedTextures.set(textureId, tex)
      this.applyTextureBindings()
    } catch (e) {
      if (this.initialized) console.error("Failed to load texture in Three.js:", e)
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

  private createMesh(geometry: GeometryKey) {
    if (!this.scene) return
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose() }
    let threeGeometry: THREE.BufferGeometry
    switch (geometry) { case "cube": threeGeometry = new THREE.BoxGeometry(2, 2, 2); break; case "sphere": threeGeometry = new THREE.SphereGeometry(1, 32, 32); break; case "plane": threeGeometry = new THREE.PlaneGeometry(2, 2); break; default: threeGeometry = new THREE.BoxGeometry(2, 2, 2) }
    this.material = new THREE.ShaderMaterial({
      vertexShader: this.defaultVertexShader,
      fragmentShader: this.defaultFragmentShader,
      uniforms: { u_color: { value: new THREE.Color(0.4, 0.6, 0.9) } },
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
    const ppSteps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []

    for (const step of queue) {
      if (step.type === "mesh") {
        this.createMesh(step.geometry as GeometryKey)
      } else if (step.type === "texture") {
        this.loadTexture(step.id)
      } else if (step.type === "material") {
        if (step.textureBindings) {
          this.textureBindings = { ...step.textureBindings }
          for (const texKey of Object.values(step.textureBindings)) {
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
    if (this.hasPostProcess) {
      this.setupPostProcess(ppSteps)
    } else {
      this.composer?.dispose()
      this.composer = null
      this.postProcessPassesMap.clear()
    }
  }

  private setupPostProcess(steps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []) {
    if (!this.renderer || !this.scene || !this.camera) return
    this.composer?.dispose()
    this.composer = new EffectComposer(this.renderer)
    this.postProcessPassesMap.clear()

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

  recompileShader(source: string) {
    if (!this.material || !this.initialized) return
    try {
      let vertexShader = this.defaultVertexShader, fragmentShader = source
      if (source.includes("void main()") && source.includes("gl_Position")) fragmentShader = source
      this.material.vertexShader = vertexShader
      this.material.fragmentShader = fragmentShader
      this.syncMaterialUniforms(fragmentShader)
      this.material.needsUpdate = true
      useProjectStore.getState().setLastCompileError(null)
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
        target.value = Array.isArray(value.value) ? value.value : [1, 0, 0, 1]
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

  resize(width: number, height: number) {
    if (!this.canvas || !this.renderer || !this.camera) return
    const dpr = window.devicePixelRatio || 1
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    const canvasWidth = Math.max(1, Math.floor(safeWidth * dpr))
    const canvasHeight = Math.max(1, Math.floor(safeHeight * dpr))
    this.renderer.setSize(safeWidth, safeHeight, false)
    this.canvas.width = canvasWidth
    this.canvas.height = canvasHeight
    this.camera.aspect = safeWidth / safeHeight
    this.camera.updateProjectionMatrix()
    if (this.composer) this.composer.setSize(safeWidth, safeHeight)
  }

  private startRenderLoop() {
    const render = (time: number) => {
      if (!this.initialized || !this.renderer || !this.scene || !this.camera || !this.mesh) { this.animationId = requestAnimationFrame(render); return }
      this.frameCount++
      if (time - this.lastFrameTime >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.lastFrameTime = time; if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / this.fps, timestamp: time }) }
      this.mesh.rotation.x += 0.01; this.mesh.rotation.y += 0.015

      if (this.material) {
        const timeUniform = this.material.uniforms["u_time"] || this.material.uniforms["time"]
        if (timeUniform) {
          timeUniform.value = time / 1000
        }
      }

      if (this.composer && this.hasPostProcess) this.composer.render()
      else this.renderer.render(this.scene, this.camera)
      this.animationId = requestAnimationFrame(render)
    }
    this.animationId = requestAnimationFrame(render)
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  dispose() {
    if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null }
    if (this.mesh) { this.mesh.geometry.dispose(); if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose() }
    if (this.scene) this.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); if (obj.material instanceof THREE.Material) obj.material.dispose() } })
    if (this.renderer) this.renderer.dispose()
    this.composer?.dispose(); this.composer = null
    this.postProcessPassesMap.clear()
    for (const tex of this.loadedTextures.values()) {
      tex.dispose()
    }
    this.loadedTextures.clear()
    if (this.defaultTexture) {
      this.defaultTexture.dispose()
      this.defaultTexture = null
    }
    this.textureBindings = {}
    this.renderer = null; this.scene = null; this.camera = null; this.mesh = null; this.material = null; this.initialized = false; this.canvas = null
    this.cachedUniformValues.clear()
  }
}

export const threejsAdapter = new ThreeJSAdapter()
