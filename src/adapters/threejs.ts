import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue, ParsedUniform } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import { parseGlslUniforms } from "@/parsers/glslUniforms"

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
        this.setupPostProcess()
      }
    }
  }

  private setupPostProcess() {
    if (!this.renderer || !this.scene || !this.camera) return
    this.composer?.dispose()
    this.composer = new EffectComposer(this.renderer)
    const renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(renderPass)
    const vignetteShader = {
      uniforms: { tDiffuse: { value: null }, u_vignetteIntensity: { value: 0.5 }, u_vignetteRadius: { value: 0.8 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float u_vignetteIntensity; uniform float u_vignetteRadius; varying vec2 vUv; void main() { vec4 color = texture2D(tDiffuse, vUv); vec2 uv = vUv * 2.0 - 1.0; float dist = length(uv); float vignette = smoothstep(u_vignetteRadius, u_vignetteRadius - 0.3, dist); vignette = mix(1.0, vignette, u_vignetteIntensity); gl_FragColor = vec4(color.rgb * vignette, color.a); }`,
    }
    const vignettePass = new ShaderPass(vignetteShader); this.composer.addPass(vignettePass)
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
