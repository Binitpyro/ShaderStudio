import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"

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
      this.createMesh(this.currentGeometry)
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); this.scene.add(ambientLight)
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); directionalLight.position.set(5, 5, 5); this.scene.add(directionalLight)
      this.initialized = true
      useProjectStore.getState().setLastCompileError(null)
      this.startRenderLoop()
      return true
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(`Three.js init failed: ${msg}`); return false }
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
    this.mesh = new THREE.Mesh(threeGeometry, this.material); this.scene.add(this.mesh); this.currentGeometry = geometry
  }

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    for (const step of queue) { if (step.type === "mesh") { this.createMesh(step.geometry as GeometryKey); break } }
    for (const step of queue) { if (step.type === "postprocess") { this.hasPostProcess = true; this.setupPostProcess() } }
  }

  private setupPostProcess() {
    if (!this.renderer || !this.scene || !this.camera) return
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
      this.material.vertexShader = vertexShader; this.material.fragmentShader = fragmentShader; this.material.needsUpdate = true
      useProjectStore.getState().setLastCompileError(null)
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(`Shader compile error: ${msg}`) }
  }

  updateUniform(name: string, value: UniformValue) {
    if (!this.material) return
    const uniforms = this.material.uniforms as Record<string, { value: unknown }>
    if (uniforms[name]) {
      if (value.type === "float" && typeof value.value === "number") uniforms[name].value = value.value
      else if (value.type === "vec3" || value.type === "color" || value.type === "vec4") {
        if (Array.isArray(value.value)) uniforms[name].value = new THREE.Color(value.value[0] as number, value.value[1] as number, value.value[2] as number)
      }
    }
  }

  resize(width: number, height: number) {
    if (!this.canvas || !this.renderer || !this.camera) return
    const dpr = window.devicePixelRatio || 1
    const canvasWidth = Math.max(1, Math.floor(width * dpr)), canvasHeight = Math.max(1, Math.floor(height * dpr))
    this.renderer.setSize(width, height, false)
    this.canvas.width = canvasWidth; this.canvas.height = canvasHeight
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix()
    if (this.composer) this.composer.setSize(width, height)
  }

  private startRenderLoop() {
    const render = (time: number) => {
      if (!this.initialized || !this.renderer || !this.scene || !this.camera || !this.mesh) { this.animationId = requestAnimationFrame(render); return }
      this.frameCount++
      if (time - this.lastFrameTime >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.lastFrameTime = time; if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / this.fps, timestamp: time }) }
      this.mesh.rotation.x += 0.01; this.mesh.rotation.y += 0.015
      const uniformValues = useProjectStore.getState().uniformValues
      if (uniformValues["color"] && this.material) {
        const uniforms = this.material.uniforms as Record<string, { value: THREE.Color }>
        if (uniforms["u_color"]) { const color = uniformValues["color"].value; if (Array.isArray(color)) uniforms["u_color"].value = new THREE.Color(color[0], color[1], color[2]) }
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
    this.renderer = null; this.scene = null; this.camera = null; this.mesh = null; this.material = null; this.initialized = false; this.canvas = null
  }
}

export const threejsAdapter = new ThreeJSAdapter()
