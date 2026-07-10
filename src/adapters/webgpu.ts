import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import defaultShader from "../shaders/default.wgsl?raw"

type GeometryKey = "cube" | "sphere" | "plane"

function generateCubeVertices(): Float32Array {
  return new Float32Array([
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1,
    1, -1, -1, -1, -1, -1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1,
    -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, -1, 1, -1,
    -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, 1,
    1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1,
    -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, 1, -1,
  ])
}

function generatePlaneVertices(): Float32Array {
  return new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1])
}

function generateSphereVertices(segments: number = 16): Float32Array {
  const vertices: number[] = []
  for (let lat = 0; lat < segments; lat++) {
    const theta1 = (lat / segments) * Math.PI
    const theta2 = ((lat + 1) / segments) * Math.PI
    for (let lon = 0; lon < segments; lon++) {
      const phi1 = (lon / segments) * 2 * Math.PI
      const phi2 = ((lon + 1) / segments) * 2 * Math.PI
      const p1 = spherePoint(theta1, phi1), p2 = spherePoint(theta1, phi2)
      const p3 = spherePoint(theta2, phi2), p4 = spherePoint(theta2, phi1)
      vertices.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4)
    }
  }
  return new Float32Array(vertices)
}

function spherePoint(theta: number, phi: number): [number, number, number] {
  return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
}

function getVerticesForGeometry(geometry: GeometryKey): Float32Array {
  switch (geometry) { case "cube": return generateCubeVertices(); case "sphere": return generateSphereVertices(); case "plane": return generatePlaneVertices() }
}

function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far)
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}

function createLookAtMatrix(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  const zAxis = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]])
  const xAxis = normalize(cross(up, zAxis)), yAxis = cross(zAxis, xAxis)
  return new Float32Array([xAxis[0], yAxis[0], zAxis[0], 0, xAxis[1], yAxis[1], zAxis[1], 0, xAxis[2], yAxis[2], zAxis[2], 0, -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1])
}

function createRotationMatrix(angleX: number, angleY: number): Float32Array {
  const cx = Math.cos(angleX), sx = Math.sin(angleX), cy = Math.cos(angleY), sy = Math.sin(angleY)
  return new Float32Array([cy, sy * sx, -sy * cx, 0, 0, cx, sx, 0, sy, -cy * sx, cy * cx, 1, 0, 0, 0, 1])
}

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) result[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j]
  return result
}

function normalize(v: number[]): number[] { const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0] }
function cross(a: number[], b: number[]): number[] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

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
  private textureResources: Map<string, GPUTexture> = new Map()
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    if (!navigator.gpu) { useProjectStore.getState().setLastCompileError("WebGPU not supported"); return false }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) { useProjectStore.getState().setLastCompileError("No WebGPU adapter found"); return false }
    this.device = await adapter.requestDevice()
    this.device.lost.then((info) => { useProjectStore.getState().setDeviceLost(true); useProjectStore.getState().setLastCompileError(`Device lost: ${info.message}`); this.initialized = false })
    this.context = canvas.getContext("webgpu")
    if (!this.context) { useProjectStore.getState().setLastCompileError("Could not get WebGPU context"); return false }
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" })
    for (const geo of ["cube", "sphere", "plane"] as const) {
      const vertices = getVerticesForGeometry(geo)
      const buffer = this.device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(buffer, 0, vertices.buffer as ArrayBuffer, 0, vertices.byteLength)
      this.vertexBuffers.set(geo, buffer)
      this.vertexCounts.set(geo, vertices.length / 3)
    }
    this.uniformBuffer = this.device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const shaderModule = this.device.createShaderModule({ code: defaultShader })
    try {
      this.pipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      })
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(msg); return false }
    this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }] })
    this.createDepthTexture()
    useProjectStore.getState().setLastCompileError(null)
    this.initialized = true
    this.startRenderLoop()
    return true
  }

  private createDepthTexture() {
    if (!this.device || !this.canvas) return
    const width = Math.max(1, Math.floor(this.canvas.width)), height = Math.max(1, Math.floor(this.canvas.height))
    this.depthTexture?.destroy()
    this.depthTexture = this.device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT })
    this.depthTextureView = this.depthTexture.createView()
  }

  resize(width: number, height: number) {
    if (!this.canvas || !this.device) return
    const dpr = window.devicePixelRatio || 1
    const canvasWidth = Math.max(1, Math.floor(width * dpr)), canvasHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) return
    this.canvas.width = canvasWidth; this.canvas.height = canvasHeight
    this.createDepthTexture()
  }

  private startRenderLoop() {
    const render = (time: number) => {
      if (!this.initialized || !this.canvas || !this.device || !this.context || !this.pipeline) { this.rafId = requestAnimationFrame(render); return }
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
      const uniformData = new Float32Array(20)
      uniformData.set(mvpMatrix, 0); uniformData.set(color, 16)
      this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData.buffer as ArrayBuffer)
      const geometry = this.currentGeometry
      const vertexBuffer = this.vertexBuffers.get(geometry)
      const vertexCount = this.vertexCounts.get(geometry) ?? 36
      if (!vertexBuffer) { this.rafId = requestAnimationFrame(render); return }
      const commandEncoder = this.device.createCommandEncoder()
      const textureView = this.context.getCurrentTexture().createView()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: textureView, clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1 }, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: this.depthTextureView!, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
      })
      renderPass.setPipeline(this.pipeline)
      renderPass.setBindGroup(0, this.bindGroup)
      renderPass.setVertexBuffer(0, vertexBuffer)
      renderPass.draw(vertexCount)
      renderPass.end()
      this.device.queue.submit([commandEncoder.finish()])
      this.rafId = requestAnimationFrame(render)
    }
    this.rafId = requestAnimationFrame(render)
  }

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    for (const step of queue) { if (step.type === "mesh") { this.currentGeometry = step.geometry as GeometryKey; break } }
    for (const step of queue) { if (step.type === "texture") this.loadTexture(step.id) }
  }

  private async loadTexture(textureId: string) {
    if (!this.device) return
    const textureResource = useProjectStore.getState().textureResources.find(t => t.id === textureId)
    if (!textureResource || this.textureResources.has(textureId)) return
    try {
      const response = await fetch(textureResource.src), blob = await response.blob(), bitmap = await createImageBitmap(blob)
      const texture = this.device.createTexture({ size: [bitmap.width, bitmap.height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
      this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height])
      this.textureResources.set(textureId, texture)
    } catch (e) { console.error("Failed to load texture:", e) }
  }

  recompileShader(wgslSource: string) {
    if (!this.device || !this.initialized) return
    try {
      const shaderModule = this.device.createShaderModule({ code: wgslSource })
      const newPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      })
      const newBindGroup = this.device.createBindGroup({ layout: newPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniformBuffer! } }] })
      this.pipeline = newPipeline; this.bindGroup = newBindGroup
      useProjectStore.getState().setLastCompileError(null)
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(msg) }
  }

  updateUniform(_name: string, value: UniformValue) {
    if (!this.device || !this.uniformBuffer) return
    if (value.type === "color" || value.type === "vec3") {
      const color = Array.isArray(value.value) ? value.value : [0.5, 0.5, 0.5]
      const uniformData = new Float32Array(4); uniformData.set(color.slice(0, 3), 0); uniformData[3] = 1.0
      this.device.queue.writeBuffer(this.uniformBuffer, 64, uniformData.buffer as ArrayBuffer)
    }
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  dispose() {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.depthTexture?.destroy(); this.depthTexture = null; this.depthTextureView = null
    for (const buffer of this.vertexBuffers.values()) buffer?.destroy()
    this.vertexBuffers.clear()
    this.uniformBuffer?.destroy(); this.uniformBuffer = null
    this.bindGroup = null; this.pipeline = null
    for (const texture of this.textureResources.values()) texture?.destroy()
    this.textureResources.clear()
    this.device?.destroy(); this.device = null
    this.context = null; this.initialized = false
  }
}

export const webgpuAdapter = new WebGPUAdapter()
