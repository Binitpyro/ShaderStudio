import type { RenderAdapter, PerfMetrics } from "./types"
import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue } from "@/stores/projectStore"
import { useProjectStore } from "@/stores/projectStore"
import { computeUniformBufferLayout, type UniformBufferLayout, type UniformFieldLayout } from "@/core/uniformLayout"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { WebGPUPingPong, CUSTOM_WGSL_TEMPLATE, type PostProcessPassType } from "@/core/postProcessChain"
import defaultShader from "../shaders/default.wgsl?raw"
import vignetteWgsl from "../shaders/postprocess/vignette.wgsl?raw"
import blurWgsl from "../shaders/postprocess/blur.wgsl?raw"
import chromaticWgsl from "../shaders/postprocess/chromatic_aberration.wgsl?raw"
import bloomWgsl from "../shaders/postprocess/bloom.wgsl?raw"
import passthroughWgsl from "../shaders/postprocess/passthrough.wgsl?raw"

interface WebGPUPostProcessPass {
  id: string
  passType: PostProcessPassType
  pipeline: GPURenderPipeline
  bindGroupLayout: GPUBindGroupLayout
  uniformBuffer: GPUBuffer | null
  uniformValues: Record<string, number | number[]>
}

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
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0])
}

function createLookAtMatrix(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  const zAxis = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]])
  const xAxis = normalize(cross(up, zAxis)), yAxis = cross(zAxis, xAxis)
  return new Float32Array([xAxis[0], yAxis[0], zAxis[0], 0, xAxis[1], yAxis[1], zAxis[1], 0, xAxis[2], yAxis[2], zAxis[2], 0, -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1])
}

function createRotationMatrix(angleX: number, angleY: number): Float32Array {
  const cx = Math.cos(angleX), sx = Math.sin(angleX), cy = Math.cos(angleY), sy = Math.sin(angleY)
  return new Float32Array([cy, sy * sx, -sy * cx, 0, 0, cx, sx, 0, sy, -cy * sx, cy * cx, 0, 0, 0, 0, 1])
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
  private defaultSampler: GPUSampler | null = null
  private defaultTexture: GPUTexture | null = null
  private textureBindings: Record<string, string> = {}
  private queueTextures: Array<{ id: string; binding: number }> = []
  private currentShaderSource: string = defaultShader
  private lastFrameTime = 0
  private frameCount = 0
  private fps = 0
  private onPerfUpdate?: (metrics: PerfMetrics) => void
  private isDisposed = false
  private hasPostProcess = false
  private pingPong: WebGPUPingPong | null = null
  private postProcessPasses: WebGPUPostProcessPass[] = []
  private postProcessSampler: GPUSampler | null = null

  private uniformLayout: UniformBufferLayout | null = null
  private cpuUniformBuffer: ArrayBuffer | null = null
  private cachedUniformValues = new Map<string, UniformValue>()

  private setupDynamicUniformBuffer(source: string) {
    if (!this.device) return
    const parsed = parseWgslUniforms(source)
    const bufferUniforms = parsed.filter(u => u.kind !== "texture")
    this.uniformLayout = computeUniformBufferLayout(bufferUniforms)

    const bufferSize = this.uniformLayout.totalSize

    this.uniformBuffer?.destroy()
    this.uniformBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "ShaderStudio_DynamicUniformBuffer",
    })

    this.cpuUniformBuffer = new ArrayBuffer(bufferSize)

    // Seed with existing uniform values from store or cache
    const storeValues = useProjectStore.getState().uniformValues
    for (const [name, val] of Object.entries(storeValues)) {
      this.writeUniformToCpuBuffer(name, val)
    }
    for (const [name, val] of this.cachedUniformValues.entries()) {
      this.writeUniformToCpuBuffer(name, val)
    }

    // Default color if color field exists but wasn't populated
    const colorField = this.uniformLayout.fields["color"] || this.uniformLayout.fields["u_color"]
    if (colorField && !storeValues["color"] && !storeValues["u_color"] && !this.cachedUniformValues.has("color") && !this.cachedUniformValues.has("u_color")) {
      this.writeUniformToCpuBuffer(colorField.name, { type: "color", value: [0.4, 0.6, 0.9] })
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.cpuUniformBuffer)
  }

  private getFieldLayout(name: string): UniformFieldLayout | null {
    if (!this.uniformLayout) return null
    const direct = this.uniformLayout.fields[name] ||
                   this.uniformLayout.fields[name.replace(/^u_/, "")] ||
                   this.uniformLayout.fields[`u_${name}`]
    if (direct) return direct

    const match = name.match(/^(.+?)\[(\d+)\]$/)
    if (match) {
      const baseName = match[1]
      const index = parseInt(match[2], 10)
      const baseField = this.uniformLayout.fields[baseName] ||
                        this.uniformLayout.fields[baseName.replace(/^u_/, "")] ||
                        this.uniformLayout.fields[`u_${baseName}`]
      if (baseField && baseField.arrayCount && baseField.arrayStride && index < baseField.arrayCount) {
        return {
          name,
          type: baseField.type,
          offset: baseField.offset + index * baseField.arrayStride,
          size: baseField.arrayStride,
          alignment: baseField.alignment,
        }
      }
    }

    const elem0 = this.uniformLayout.fields[`${name}[0]`] ||
                  this.uniformLayout.fields[`${name.replace(/^u_/, "")}[0]`] ||
                  this.uniformLayout.fields[`u_${name}[0]`]
    if (elem0) {
      const prefix = elem0.name.replace(/\[0\]$/, "")
      let count = 0
      while (this.uniformLayout.fields[`${prefix}[${count}]`]) {
        count++
      }
      const elem1 = this.uniformLayout.fields[`${prefix}[1]`]
      const stride = elem1 ? elem1.offset - elem0.offset : Math.max(16, elem0.size)
      return {
        name,
        type: elem0.type,
        offset: elem0.offset,
        size: count > 0 ? count * stride : elem0.size,
        alignment: elem0.alignment,
        arrayCount: count,
        arrayStride: stride,
      }
    }

    return null
  }

  private writeElement(
    view: DataView,
    type: string,
    offset: number,
    rawVal: any,
    isColor = false
  ) {
    switch (type) {
      case "f32": {
        const v = typeof rawVal === "number" ? rawVal : Number(rawVal) || 0
        view.setFloat32(offset, isNaN(v) ? 0 : v, true)
        break
      }
      case "i32": {
        const v = Math.round(Number(rawVal) || 0)
        view.setInt32(offset, isNaN(v) ? 0 : v, true)
        break
      }
      case "u32": {
        const v = Math.max(0, Math.round(Number(rawVal) || 0))
        view.setUint32(offset, isNaN(v) ? 0 : v, true)
        break
      }
      case "bool": {
        view.setUint32(offset, rawVal ? 1 : 0, true)
        break
      }
      case "vec2f": {
        const arr = Array.isArray(rawVal) || rawVal instanceof Float32Array ? rawVal : [0, 0]
        view.setFloat32(offset, Number(arr[0] ?? 0) || 0, true)
        view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
        break
      }
      case "vec3f": {
        const arr = Array.isArray(rawVal) || rawVal instanceof Float32Array ? rawVal : [0, 0, 0]
        view.setFloat32(offset, Number(arr[0] ?? 0) || 0, true)
        view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
        view.setFloat32(offset + 8, Number(arr[2] ?? 0) || 0, true)
        break
      }
      case "vec4f": {
        const arr = Array.isArray(rawVal) || rawVal instanceof Float32Array ? rawVal : [0, 0, 0, 0]
        view.setFloat32(offset, Number(arr[0] ?? 0) || 0, true)
        view.setFloat32(offset + 4, Number(arr[1] ?? 0) || 0, true)
        view.setFloat32(offset + 8, Number(arr[2] ?? 0) || 0, true)
        view.setFloat32(offset + 12, Number(arr[3] ?? (isColor ? 1 : 0)) || 0, true)
        break
      }
      case "mat4x4f": {
        const arr = (Array.isArray(rawVal) || rawVal instanceof Float32Array) && (rawVal as any).length === 16
          ? rawVal
          : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
        for (let i = 0; i < 16; i++) {
          view.setFloat32(offset + i * 4, Number(arr[i] ?? (i % 5 === 0 ? 1 : 0)) || 0, true)
        }
        break
      }
      case "mat3x3f": {
        const arr = (Array.isArray(rawVal) || rawVal instanceof Float32Array) ? rawVal : [1,0,0, 0,1,0, 0,0,1]
        if ((arr as any).length >= 12) {
          for (let col = 0; col < 3; col++) {
            for (let row = 0; row < 3; row++) {
              view.setFloat32(offset + col * 16 + row * 4, Number(arr[col * 4 + row] ?? 0) || 0, true)
            }
          }
        } else {
          for (let col = 0; col < 3; col++) {
            for (let row = 0; row < 3; row++) {
              const idx = col * 3 + row
              view.setFloat32(offset + col * 16 + row * 4, Number(arr[idx] ?? (col === row ? 1 : 0)) || 0, true)
            }
          }
        }
        break
      }
      case "mat2x2f": {
        const arr = (Array.isArray(rawVal) || rawVal instanceof Float32Array) && (rawVal as any).length === 4
          ? rawVal
          : [1,0, 0,1]
        for (let i = 0; i < 4; i++) {
          view.setFloat32(offset + i * 4, Number(arr[i] ?? (i % 3 === 0 ? 1 : 0)) || 0, true)
        }
        break
      }
    }
  }

  private writeUniformToCpuBuffer(name: string, value: UniformValue) {
    if (!this.cpuUniformBuffer || !this.uniformLayout) return
    const field = this.getFieldLayout(name)
    if (!field) return

    const view = new DataView(this.cpuUniformBuffer)
    const rawVal = value.value

    if (field.arrayCount && field.arrayCount > 0 && field.arrayStride) {
      const arr = Array.isArray(rawVal) ? rawVal : [rawVal]
      for (let i = 0; i < field.arrayCount; i++) {
        const elemOffset = field.offset + i * field.arrayStride
        this.writeElement(view, field.type, elemOffset, arr[i], value.type === "color")
      }
      return
    }

    this.writeElement(view, field.type, field.offset, rawVal, value.type === "color")
  }

  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    this.isDisposed = false
    if (!navigator.gpu) { useProjectStore.getState().setLastCompileError("WebGPU not supported"); return false }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) { useProjectStore.getState().setLastCompileError("No WebGPU adapter found"); return false }
    this.device = await adapter.requestDevice()
    this.device.lost.then((info) => {
      if (this.isDisposed) return
      useProjectStore.getState().setDeviceLost(true)
      useProjectStore.getState().setLastCompileError(`Device lost: ${info.message}`)
      this.initialized = false
    })
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

    this.createDefaultTexture()
    this.currentShaderSource = defaultShader
    this.setupDynamicUniformBuffer(defaultShader)

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
    this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: this.buildBindGroupEntries(defaultShader) })
    this.createDepthTexture()
    useProjectStore.getState().setLastCompileError(null)
    this.initialized = true
    this.startRenderLoop()
    return true
  }

  private createDefaultTexture() {
    if (!this.device) return
    this.defaultTexture = this.device.createTexture({
      size: [2, 2],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.defaultSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    })
  }

  private buildBindGroupEntries(wgslSource?: string): GPUBindGroupEntry[] {
    const entries: GPUBindGroupEntry[] = []
    if (this.uniformBuffer) {
      entries.push({ binding: 0, resource: { buffer: this.uniformBuffer } })
    }
    if (!this.device) return entries

    const source = wgslSource || this.currentShaderSource
    if (source) {
      const bindingRegex = /(?:@group\s*\(\s*0\s*\)\s*@binding\s*\(\s*(\d+)\s*\)|@binding\s*\(\s*(\d+)\s*\)\s*@group\s*\(\s*0\s*\))\s*var(?:\s*<[^>]+>)?\s+(\w+)\s*:\s*([^;]+);/g
      let match: RegExpExecArray | null
      while ((match = bindingRegex.exec(source)) !== null) {
        const rawIdx = match[1] !== undefined ? match[1] : match[2]
        const bindingIndex = parseInt(rawIdx, 10)
        if (bindingIndex === 0) continue

        const name = match[3]
        const typeStr = match[4].trim()

        if (typeStr.startsWith("sampler")) {
          if (this.defaultSampler) {
            entries.push({ binding: bindingIndex, resource: this.defaultSampler })
          }
        } else if (typeStr.startsWith("texture_2d")) {
          const boundTexId = this.textureBindings[name] ||
                             this.textureBindings[name.replace(/^u_/, "")] ||
                             this.textureBindings[`u_${name}`]
          let targetTexture: GPUTexture | null = null
          if (boundTexId && this.textureResources.has(boundTexId)) {
            targetTexture = this.textureResources.get(boundTexId)!
          } else {
            const qTex = this.queueTextures.find((t) => t.binding === bindingIndex)
            if (qTex && this.textureResources.has(qTex.id)) {
              targetTexture = this.textureResources.get(qTex.id)!
            } else if (this.textureResources.size > 0) {
              targetTexture = Array.from(this.textureResources.values())[0]
            } else {
              targetTexture = this.defaultTexture
            }
          }

          if (targetTexture) {
            entries.push({ binding: bindingIndex, resource: targetTexture.createView() })
          }
        }
      }
    }
    return entries
  }

  private updateBindGroup() {
    if (!this.device || !this.pipeline) return
    try {
      const entries = this.buildBindGroupEntries(this.currentShaderSource)
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries,
      })
    } catch {
      // Ignore bind group reconstruction errors during transition
    }
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
    if (this.pingPong && this.hasPostProcess) {
      this.pingPong.resize(canvasWidth, canvasHeight)
    }
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

      // Update per-frame uniforms (mvp and time only, without stomping other uniforms)
      if (this.uniformBuffer && this.uniformLayout) {
        const mvpField = this.uniformLayout.fields["mvp"] || this.uniformLayout.fields["u_mvp"]
        if (mvpField) {
          this.device.queue.writeBuffer(this.uniformBuffer, mvpField.offset, mvpMatrix.buffer as ArrayBuffer)
        }
        const timeField = this.uniformLayout.fields["time"] || this.uniformLayout.fields["u_time"]
        if (timeField) {
          this.device.queue.writeBuffer(this.uniformBuffer, timeField.offset, new Float32Array([time / 1000]).buffer as ArrayBuffer)
        }
      }

      const geometry = this.currentGeometry
      const vertexBuffer = this.vertexBuffers.get(geometry)
      const vertexCount = this.vertexCounts.get(geometry) ?? 36
      if (!vertexBuffer) { this.rafId = requestAnimationFrame(render); return }
      const commandEncoder = this.device.createCommandEncoder()
      const textureView = this.context.getCurrentTexture().createView()
      const usePostProcess = this.hasPostProcess && this.postProcessPasses.length > 0 && !!this.pingPong?.getCurrent()
      const targetView = usePostProcess
        ? this.pingPong!.getCurrent()!
        : textureView
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: targetView, clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1 }, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: this.depthTextureView!, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
      })
      renderPass.setPipeline(this.pipeline)
      renderPass.setBindGroup(0, this.bindGroup)
      renderPass.setVertexBuffer(0, vertexBuffer)
      renderPass.draw(vertexCount)
      renderPass.end()

      if (usePostProcess) {
        const numPasses = this.postProcessPasses.length
        for (let i = 0; i < numPasses; i++) {
          const pass = this.postProcessPasses[i]
          const isFinal = (i === numPasses - 1)
          const passTarget = isFinal ? textureView : this.pingPong!.getNext()!
          const inputView = this.pingPong!.getCurrent()!

          const bindEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: this.postProcessSampler! },
            { binding: 1, resource: inputView },
          ]
          if (pass.uniformBuffer) {
            bindEntries.push({ binding: 2, resource: { buffer: pass.uniformBuffer } })
          }
          const passBindGroup = this.device.createBindGroup({
            layout: pass.bindGroupLayout,
            entries: bindEntries,
          })

          const ppPass = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: passTarget, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
          })
          ppPass.setPipeline(pass.pipeline)
          ppPass.setBindGroup(0, passBindGroup)
          ppPass.draw(6)
          ppPass.end()

          if (!isFinal) {
            this.pingPong!.swap()
          }
        }
      }

      this.device.queue.submit([commandEncoder.finish()])
      this.rafId = requestAnimationFrame(render)
    }
    this.rafId = requestAnimationFrame(render)
  }

  setRenderQueue(queue: RenderQueue | null) {
    if (!queue || queue.length === 0) return
    this.hasPostProcess = false
    this.queueTextures = []
    const ppSteps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }> = []

    for (const step of queue) {
      if (step.type === "mesh") {
        this.currentGeometry = step.geometry as GeometryKey
      } else if (step.type === "texture") {
        this.queueTextures.push({ id: step.id, binding: step.binding })
        this.loadTexture(step.id)
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
    if (this.hasPostProcess && this.device && this.canvas) {
      if (!this.pingPong) this.pingPong = new WebGPUPingPong(this.device, this.format)
      this.pingPong.resize(this.canvas.width, this.canvas.height)
      this.rebuildPostProcessPasses(ppSteps)
    } else {
      this.cleanupPostProcessPasses()
    }
    this.updateBindGroup()
  }

  private rebuildPostProcessPasses(steps: Array<{ id: string; pass: PostProcessPassType; customSource?: string; uniforms: Record<string, number | number[]> }>) {
    if (!this.device) return
    this.cleanupPostProcessPasses()

    if (!this.postProcessSampler) {
      this.postProcessSampler = this.device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      })
    }

    for (const step of steps) {
      try {
        let code = passthroughWgsl
        switch (step.pass) {
          case "vignette": code = vignetteWgsl; break
          case "blur": code = blurWgsl; break
          case "chromatic_aberration": code = chromaticWgsl; break
          case "bloom": code = bloomWgsl; break
          case "custom": code = step.customSource || CUSTOM_WGSL_TEMPLATE; break
          case "passthrough": code = passthroughWgsl; break
        }

        const shaderModule = this.device.createShaderModule({ code })
        let uniformBuffer: GPUBuffer | null = null

        if (step.pass === "vignette") {
          uniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })
          const intensity = Number(step.uniforms.intensity ?? step.uniforms.u_vignetteIntensity ?? 0.5)
          const radius = Number(step.uniforms.radius ?? step.uniforms.u_vignetteRadius ?? 0.8)
          this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([intensity, radius, 0, 0]).buffer as ArrayBuffer)
        } else if (step.pass === "blur") {
          uniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })
          const w = this.canvas?.width || 800
          const h = this.canvas?.height || 600
          const amount = Number(step.uniforms.amount ?? step.uniforms.u_blurAmount ?? 2.0)
          this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([w, h, amount, 0]).buffer as ArrayBuffer)
        } else if (step.pass === "chromatic_aberration") {
          uniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })
          const offset = Number(step.uniforms.offset ?? step.uniforms.u_aberrationOffset ?? 0.008)
          this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([offset, 0, 0, 0]).buffer as ArrayBuffer)
        } else if (step.pass === "bloom") {
          uniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })
          const threshold = Number(step.uniforms.threshold ?? step.uniforms.u_bloomThreshold ?? 0.7)
          const intensity = Number(step.uniforms.intensity ?? step.uniforms.u_bloomIntensity ?? 0.5)
          this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([threshold, intensity, 0, 0]).buffer as ArrayBuffer)
        }

        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ]
        if (uniformBuffer) {
          entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } })
        }
        const bindGroupLayout = this.device.createBindGroupLayout({ entries })
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] })
        const pipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: "vertex_main" },
          fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
          primitive: { topology: "triangle-list" },
        })

        this.postProcessPasses.push({
          id: step.id,
          passType: step.pass,
          pipeline,
          bindGroupLayout,
          uniformBuffer,
          uniformValues: { ...step.uniforms },
        })
      } catch (e) {
        console.error("Failed to compile post-process pass:", step.pass, e)
      }
    }
  }

  private cleanupPostProcessPasses() {
    for (const p of this.postProcessPasses) {
      p.uniformBuffer?.destroy()
    }
    this.postProcessPasses = []
  }

  private async loadTexture(textureId: string) {
    if (!this.device || !this.initialized) return
    const textureResource = useProjectStore.getState().textureResources.find(t => t.id === textureId)
    if (!textureResource || this.textureResources.has(textureId)) return
    try {
      const response = await fetch(textureResource.src)
      if (!this.device || !this.initialized) return
      const blob = await response.blob()
      if (!this.device || !this.initialized) return
      const bitmap = await createImageBitmap(blob)
      if (!this.device || !this.initialized) {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
        return
      }
      try {
        const texture = this.device.createTexture({
          size: [bitmap.width, bitmap.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        })
        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height])
        this.textureResources.set(textureId, texture)
        this.updateBindGroup()
      } finally {
        if ("close" in bitmap && typeof (bitmap as any).close === "function") (bitmap as any).close()
      }
    } catch (e) {
      if (this.initialized) console.error("Failed to load texture:", e)
    }
  }

  recompileShader(wgslSource: string) {
    if (!this.device || !this.initialized) return
    try {
      this.currentShaderSource = wgslSource
      this.setupDynamicUniformBuffer(wgslSource)
      const shaderModule = this.device.createShaderModule({ code: wgslSource })
      const newPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vertex_main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      })
      const newBindGroup = this.device.createBindGroup({ layout: newPipeline.getBindGroupLayout(0), entries: this.buildBindGroupEntries(wgslSource) })
      this.pipeline = newPipeline
      this.bindGroup = newBindGroup
      useProjectStore.getState().setLastCompileError(null)
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); useProjectStore.getState().setLastCompileError(msg) }
  }

  updateUniform(name: string, value: UniformValue) {
    const alt = name.startsWith("u_") ? name.slice(2) : `u_${name}`
    this.cachedUniformValues.delete(alt)
    this.cachedUniformValues.set(name, value)
    if (!this.device || !this.uniformBuffer || !this.uniformLayout || !this.cpuUniformBuffer) return

    const field = this.getFieldLayout(name)
    if (!field) return

    this.writeUniformToCpuBuffer(name, value)
    const slice = this.cpuUniformBuffer.slice(field.offset, field.offset + field.size)
    this.device.queue.writeBuffer(this.uniformBuffer, field.offset, slice)
  }

  updatePostProcessUniform(nodeId: string, name: string, value: number | number[]) {
    if (!this.device) return
    const pass = this.postProcessPasses.find(p => p.id === nodeId || p.passType === nodeId)
    if (!pass || !pass.uniformBuffer) return
    pass.uniformValues[name] = value

    const val = typeof value === "number" ? value : Number(value[0]) || 0
    switch (pass.passType) {
      case "vignette": {
        const intensity = name.includes("Intensity") || name === "intensity"
          ? val
          : Number(pass.uniformValues.intensity ?? pass.uniformValues.u_vignetteIntensity ?? 0.5)
        const radius = name.includes("Radius") || name === "radius"
          ? val
          : Number(pass.uniformValues.radius ?? pass.uniformValues.u_vignetteRadius ?? 0.8)
        this.device.queue.writeBuffer(pass.uniformBuffer, 0, new Float32Array([intensity, radius, 0, 0]).buffer as ArrayBuffer)
        break
      }
      case "blur": {
        const amount = val
        const w = this.canvas?.width || 800
        const h = this.canvas?.height || 600
        this.device.queue.writeBuffer(pass.uniformBuffer, 0, new Float32Array([w, h, amount, 0]).buffer as ArrayBuffer)
        break
      }
      case "chromatic_aberration": {
        this.device.queue.writeBuffer(pass.uniformBuffer, 0, new Float32Array([val, 0, 0, 0]).buffer as ArrayBuffer)
        break
      }
      case "bloom": {
        const threshold = name.includes("Threshold") || name === "threshold"
          ? val
          : Number(pass.uniformValues.threshold ?? pass.uniformValues.u_bloomThreshold ?? 0.7)
        const intensity = name.includes("Intensity") || name === "intensity"
          ? val
          : Number(pass.uniformValues.intensity ?? pass.uniformValues.u_bloomIntensity ?? 0.5)
        this.device.queue.writeBuffer(pass.uniformBuffer, 0, new Float32Array([threshold, intensity, 0, 0]).buffer as ArrayBuffer)
        break
      }
    }
  }

  setPerfCallback(callback: (metrics: PerfMetrics) => void) { this.onPerfUpdate = callback }

  dispose() {
    this.isDisposed = true
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.depthTexture?.destroy(); this.depthTexture = null; this.depthTextureView = null
    for (const buffer of this.vertexBuffers.values()) buffer?.destroy()
    this.vertexBuffers.clear()
    this.uniformBuffer?.destroy(); this.uniformBuffer = null
    this.bindGroup = null; this.pipeline = null
    for (const texture of this.textureResources.values()) texture?.destroy()
    this.textureResources.clear()
    this.defaultTexture?.destroy(); this.defaultTexture = null; this.defaultSampler = null
    this.cleanupPostProcessPasses()
    this.pingPong?.destroy(); this.pingPong = null; this.hasPostProcess = false
    this.postProcessSampler = null
    this.device?.destroy(); this.device = null
    this.context = null; this.initialized = false
  }
}

export const webgpuAdapter = new WebGPUAdapter()
