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
function createRotationMatrix(angleX: number, angleY: number): Float32Array { const cx = Math.cos(angleX), sx = Math.sin(angleX), cy = Math.cos(angleY), sy = Math.sin(angleY); return new Float32Array([cy, sy * sx, -sy * cx, 0, 0, cx, sx, 0, sy, -cy * sx, cy * cx, 0, 0, 0, 0, 1]) }
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
  private quadBuffer: WebGLBuffer | null = null

  private uniformLocations = new Map<string, WebGLUniformLocation | null>()
  private uniformValues = new Map<string, UniformValue>()
  private loadedTextures = new Map<string, WebGLTexture>()
  private textureBindings: Record<string, string> = {}
  private queueTextures: Array<{ id: string; binding: number }> = []
  private defaultTexture: WebGLTexture | null = null

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
    useProjectStore.getState().setDeviceLost(true)
    useProjectStore.getState().setLastCompileError("WebGL2 context lost")
  }
  private handleContextRestored = () => { useProjectStore.getState().setDeviceLost(false); useProjectStore.getState().setLastCompileError(null); this.initialize() }

  private initialize(): boolean {
    const gl = this.gl; if (!gl) return false
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK)
    this.program = this.createProgram(defaultVertSource, defaultFragSource)
    if (!this.program) return false
    this.cacheUniformLocations()
    this.mvpLocation = this.getUniformLoc("u_mvp")
    this.colorLocation = this.getUniformLoc("u_color")
    this.createGeometry(this.currentGeometry)
    this.createDefaultTexture()
    this.initializePostProcess()
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

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    this.queueTextures = []
    this.textureBindings = {}
    for (const step of queue) {
      if (step.type === "mesh") {
        this.createGeometry(step.geometry as GeometryKey)
      } else if (step.type === "texture") {
        this.queueTextures.push({ id: step.id, binding: step.binding })
        this.loadTexture(step.id)
      } else if (step.type === "material") {
        if (step.textureBindings) {
          this.textureBindings = { ...step.textureBindings }
        }
      } else if (step.type === "postprocess") {
        this.hasPostProcess = true
      }
    }
    if (this.hasPostProcess && this.canvas) this.createPostProcessFramebuffers(this.canvas.width, this.canvas.height)
  }

  recompileShader(source: string) {
    const gl = this.gl; if (!gl || !this.initialized) return
    let vertSource = defaultVertSource, fragSource = source
    if (source.includes("#ifdef FRAGMENT")) { const parts = source.split("#ifdef FRAGMENT"); vertSource = parts[0].replace("// Fragment shader", "").trim(); fragSource = parts[1].replace("#endif", "").trim() }
    const newProgram = this.createProgram(vertSource, fragSource)
    if (newProgram) {
      if (this.program) gl.deleteProgram(this.program)
      this.program = newProgram
      this.cacheUniformLocations()
      this.mvpLocation = this.getUniformLoc("u_mvp")
      this.colorLocation = this.getUniformLoc("u_color")
      useProjectStore.getState().setLastCompileError(null)
    }
  }

  updateUniform(name: string, value: UniformValue) {
    const alt = name.startsWith("u_") ? name.slice(2) : `u_${name}`
    this.uniformValues.delete(alt)
    this.uniformValues.set(name, value)
    if (this.gl && this.program) {
      this.gl.useProgram(this.program)
      const loc = this.findUniformLoc(name)
      if (loc) {
        this.applyUniform(loc, value)
      }
    }
  }

  private getAuthoritativeUniforms(storeValues: Record<string, UniformValue>): Map<string, UniformValue> {
    const authoritative = new Map<string, UniformValue>()

    // 1. Seed with store values, prioritizing 'u_' prefixed keys for WebGL2 GLSL conventions
    for (const [key, val] of Object.entries(storeValues)) {
      const alt = key.startsWith("u_") ? key.slice(2) : `u_${key}`
      if (authoritative.has(alt)) {
        if (key.startsWith("u_")) {
          authoritative.delete(alt)
          authoritative.set(key, val)
        }
      } else {
        authoritative.set(key, val)
      }
    }

    // 2. Overlay adapter uniformValues (runtime updates take absolute precedence over store)
    for (const [key, val] of this.uniformValues.entries()) {
      const alt = key.startsWith("u_") ? key.slice(2) : `u_${key}`
      authoritative.delete(alt)
      authoritative.set(key, val)
    }

    return authoritative
  }

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
      const storeValues = useProjectStore.getState().uniformValues
      const authoritative = this.getAuthoritativeUniforms(storeValues)
      let color: number[] = [0.4, 0.6, 0.9]
      const colorVal = authoritative.get("u_color") || authoritative.get("color")
      if (colorVal && Array.isArray(colorVal.value)) color = colorVal.value as number[]
      const gl = this.gl
      if (this.hasPostProcess && this.postProcessFramebuffers.length > 0) { this.postProcessFramebuffers[0].bind(); gl.viewport(0, 0, this.canvas.width, this.canvas.height) }
      gl.clearColor(0.08, 0.08, 0.1, 1.0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.useProgram(this.program)

      if (this.mvpLocation) {
        gl.uniformMatrix4fv(this.mvpLocation, false, mvpMatrix)
      }
      if (this.colorLocation) {
        gl.uniform3fv(this.colorLocation, new Float32Array(color.slice(0, 3)))
      }

      // Time uniform update
      const timeLoc = this.findUniformLoc("time")
      if (timeLoc) {
        gl.uniform1f(timeLoc, time / 1000)
      }

      // Bind all custom and modified uniforms without duplicate location uploads
      const boundLocations = new Set<WebGLUniformLocation>()
      if (this.mvpLocation) boundLocations.add(this.mvpLocation)
      if (this.colorLocation) boundLocations.add(this.colorLocation)
      if (timeLoc) boundLocations.add(timeLoc)

      for (const [name, val] of authoritative.entries()) {
        if (name === "color" || name === "u_color" || name === "u_mvp" || name === "mvp" || name === "time" || name === "u_time") continue
        const loc = this.findUniformLoc(name)
        if (loc && !boundLocations.has(loc)) {
          boundLocations.add(loc)
          this.applyUniform(loc, val)
        }
      }

      // Bind textures to texture units
      let activeUnit = 0
      for (const [uniformName, texId] of Object.entries(this.textureBindings)) {
        const tex = this.loadedTextures.get(texId) || this.defaultTexture
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
          this.quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
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
    if (gl) {
      if (this.program) gl.deleteProgram(this.program)
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
    }
    this.queueTextures = []
    this.textureBindings = {}
    if (this.canvas) { this.canvas.removeEventListener("webglcontextlost", this.handleContextLost); this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored) }
    this.program = null; this.vao = null; this.vertexBuffer = null; this.quadVAO = null; this.quadBuffer = null; this.initialized = false; this.gl = null; this.canvas = null
    this.uniformLocations.clear()
    this.uniformValues.clear()
  }
}

export const webgl2Adapter = new WebGL2Adapter()
