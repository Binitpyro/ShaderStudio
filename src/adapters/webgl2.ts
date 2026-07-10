import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue } from "@/stores/projectStore"
import { WebGL2Framebuffer, PASSTHROUGH_VERTEX, VIGNETTE_FRAGMENT } from "@/core/postProcessChain"
import { useProjectStore } from "@/stores/projectStore"
import defaultVertSource from "../shaders/default.vert?raw"
import defaultFragSource from "../shaders/default.frag?raw"

type GeometryKey = "cube" | "sphere" | "plane"

function generateCubeVertices(): Float32Array {
  return new Float32Array([-1,-1,1,1,-1,1,1,1,1,-1,-1,1,1,1,1,-1,1,1,1,-1,-1,-1,-1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,1,-1,-1,1,1,1,1,1,1,1,-1,-1,1,1,1,1,-1,-1,1,-1,-1,-1,-1,-1,1,-1,1,1,-1,-1,-1,-1,1,1,-1,1,-1,1,-1,-1,1,-1,1,1,-1,1,-1,1,1,1,-1,1,1,1,1,1,1,-1,1,1,1,-1,-1,-1,-1,-1,1,-1,1,1,-1,-1,-1,-1,1,1,-1,1,-1])
}
function generatePlaneVertices(): Float32Array { return new Float32Array([-1,0,-1,1,0,-1,1,0,1,-1,0,-1,1,0,1,-1,0,1]) }
function generateSphereVertices(segments: number = 16): Float32Array {
  const vertices: number[] = []
  for (let lat = 0; lat < segments; lat++) {
    const theta1 = (lat / segments) * Math.PI, theta2 = ((lat + 1) / segments) * Math.PI
    for (let lon = 0; lon < segments; lon++) {
      const phi1 = (lon / segments) * 2 * Math.PI, phi2 = ((lon + 1) / segments) * 2 * Math.PI
      const p1 = spherePoint(theta1, phi1), p2 = spherePoint(theta1, phi2), p3 = spherePoint(theta2, phi2), p4 = spherePoint(theta2, phi1)
      vertices.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4)
    }
  }
  return new Float32Array(vertices)
}
function spherePoint(theta: number, phi: number): [number, number, number] { return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)] }
function getVerticesForGeometry(geometry: GeometryKey): Float32Array { switch (geometry) { case "cube": return generateCubeVertices(); case "sphere": return generateSphereVertices(); case "plane": return generatePlaneVertices() } }

function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array { const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]) }
function createLookAtMatrix(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  const zAxis = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]), xAxis = normalize(cross(up, zAxis)), yAxis = cross(zAxis, xAxis)
  return new Float32Array([xAxis[0], yAxis[0], zAxis[0], 0, xAxis[1], yAxis[1], zAxis[1], 0, xAxis[2], yAxis[2], zAxis[2], 0, -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1])
}
function createRotationMatrix(angleX: number, angleY: number): Float32Array { const cx = Math.cos(angleX), sx = Math.sin(angleX), cy = Math.cos(angleY), sy = Math.sin(angleY); return new Float32Array([cy, sy * sx, -sy * cx, 0, 0, cx, sx, 0, sy, -cy * sx, cy * cx, 1, 0, 0, 0, 1]) }
function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array { const result = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) result[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j]; return result }
function normalize(v: number[]): number[] { const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0] }
function cross(a: number[], b: number[]): number[] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

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
  private postProcessFramebuffers: WebGL2Framebuffer[] = []
  private postProcessPrograms: WebGLProgram[] = []
  private hasPostProcess = false
  private mvpLocation: WebGLUniformLocation | null = null
  private colorLocation: WebGLUniformLocation | null = null
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void
  private quadVAO: WebGLVertexArrayObject | null = null

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true })
    if (!gl) { useProjectStore.getState().setLastCompileError("WebGL2 not supported"); return false }
    this.gl = gl
    canvas.addEventListener("webglcontextlost", this.handleContextLost)
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored)
    return this.initialize()
  }

  private handleContextLost = (e: Event) => { e.preventDefault(); if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null }; this.initialized = false; useProjectStore.getState().setDeviceLost(true); useProjectStore.getState().setLastCompileError("WebGL2 context lost") }
  private handleContextRestored = () => { useProjectStore.getState().setDeviceLost(false); useProjectStore.getState().setLastCompileError(null); this.initialize() }

  private initialize(): boolean {
    const gl = this.gl; if (!gl) return false
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK)
    this.program = this.createProgram(defaultVertSource, defaultFragSource)
    if (!this.program) return false
    this.mvpLocation = gl.getUniformLocation(this.program, "u_mvp")
    this.colorLocation = gl.getUniformLocation(this.program, "u_color")
    this.createGeometry(this.currentGeometry)
    this.initializePostProcess()
    this.initialized = true
    this.startRenderLoop()
    return true
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

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    for (const step of queue) { if (step.type === "mesh") { this.createGeometry(step.geometry as GeometryKey); break } }
    for (const step of queue) { if (step.type === "postprocess") this.hasPostProcess = true }
    if (this.hasPostProcess && this.canvas) this.createPostProcessFramebuffers(this.canvas.width, this.canvas.height)
  }

  recompileShader(source: string) {
    const gl = this.gl; if (!gl || !this.initialized) return
    let vertSource = defaultVertSource, fragSource = source
    if (source.includes("#ifdef FRAGMENT")) { const parts = source.split("#ifdef FRAGMENT"); vertSource = parts[0].replace("// Fragment shader", "").trim(); fragSource = parts[1].replace("#endif", "").trim() }
    const newProgram = this.createProgram(vertSource, fragSource)
    if (newProgram) { if (this.program) gl.deleteProgram(this.program); this.program = newProgram; this.mvpLocation = gl.getUniformLocation(this.program, "u_mvp"); this.colorLocation = gl.getUniformLocation(this.program, "u_color"); useProjectStore.getState().setLastCompileError(null) }
  }

  updateUniform(_name: string, _value: UniformValue) { /* uniforms updated in render loop */ }

  resize(width: number, height: number) {
    if (!this.canvas || !this.gl) return
    const dpr = window.devicePixelRatio || 1
    const canvasWidth = Math.max(1, Math.floor(width * dpr)), canvasHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) return
    this.canvas.width = canvasWidth; this.canvas.height = canvasHeight
    this.gl.viewport(0, 0, canvasWidth, canvasHeight)
    this.createPostProcessFramebuffers(canvasWidth, canvasHeight)
  }

  private startRenderLoop() {
    const render = (time: number) => {
      if (!this.initialized || !this.gl || !this.canvas || !this.program) { this.rafId = requestAnimationFrame(render); return }
      this.frameCount++
      if (time - this.lastFrameTime >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.lastFrameTime = time; if (this.onPerfUpdate) this.onPerfUpdate({ fps: this.fps, frameTime: 1000 / this.fps, timestamp: time }) }
      this.angleX += 0.01; this.angleY += 0.015
      const aspect = this.canvas.width / this.canvas.height
      const projectionMatrix = createPerspectiveMatrix(Math.PI / 4, aspect, 0.1, 100)
      const viewMatrix = createLookAtMatrix([0, 2, 4], [0, 0, 0], [0, 1, 0])
      const rotationMatrix = createRotationMatrix(this.angleX, this.angleY)
      const mvpMatrix = multiplyMatrices(projectionMatrix, multiplyMatrices(viewMatrix, rotationMatrix))
      const uniformValues = useProjectStore.getState().uniformValues
      let color: number[] = [0.4, 0.6, 0.9]
      if (uniformValues["color"] && Array.isArray(uniformValues["color"].value)) color = uniformValues["color"].value as number[]
      const gl = this.gl
      if (this.hasPostProcess && this.postProcessFramebuffers.length > 0) { this.postProcessFramebuffers[0].bind(); gl.viewport(0, 0, this.canvas.width, this.canvas.height) }
      gl.clearColor(0.08, 0.08, 0.1, 1.0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.useProgram(this.program)
      gl.uniformMatrix4fv(this.mvpLocation, false, mvpMatrix)
      gl.uniform3fv(this.colorLocation, new Float32Array(color))
      gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount); gl.bindVertexArray(null)
      if (this.hasPostProcess && this.postProcessPrograms.length > 0 && this.postProcessFramebuffers.length > 0) {
        this.postProcessFramebuffers[0].unbind()
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        const ppProgram = this.postProcessPrograms[0]; gl.useProgram(ppProgram)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.postProcessFramebuffers[0].getTexture())
        gl.uniform1i(gl.getUniformLocation(ppProgram, "u_texture"), 0)
        gl.uniform2f(gl.getUniformLocation(ppProgram, "u_resolution"), this.canvas.width, this.canvas.height)
        gl.uniform1f(gl.getUniformLocation(ppProgram, "u_vignetteIntensity"), 0.5)
        gl.uniform1f(gl.getUniformLocation(ppProgram, "u_vignetteRadius"), 0.8)
        if (!this.quadVAO) {
          this.quadVAO = gl.createVertexArray(); gl.bindVertexArray(this.quadVAO)
          const quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
        }
        gl.bindVertexArray(this.quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
      this.rafId = requestAnimationFrame(render)
    }
    this.rafId = requestAnimationFrame(render)
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  dispose() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null }
    const gl = this.gl
    if (gl) { if (this.program) gl.deleteProgram(this.program); if (this.vao) gl.deleteVertexArray(this.vao); if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer); for (const prog of this.postProcessPrograms) gl.deleteProgram(prog); for (const fb of this.postProcessFramebuffers) fb.destroy() }
    if (this.canvas) { this.canvas.removeEventListener("webglcontextlost", this.handleContextLost); this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored) }
    this.program = null; this.vao = null; this.vertexBuffer = null; this.initialized = false; this.gl = null; this.canvas = null
  }
}

export const webgl2Adapter = new WebGL2Adapter()
