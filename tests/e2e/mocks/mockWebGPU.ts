/**
 * High-fidelity WebGPU Mock for Headless Testing
 */

export const MockGPUBufferUsage = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
}

export const MockGPUTextureUsage = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
}

export const MockGPUShaderStage = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
}

export const MockGPUColorWrite = {
  RED: 1,
  GREEN: 2,
  BLUE: 4,
  ALPHA: 8,
  ALL: 15,
}

export class MockGPUBuffer {
  size: number
  usage: number
  data: Uint8Array
  isDestroyed = false
  label?: string

  constructor(descriptor: { size: number; usage: number; label?: string }) {
    this.size = descriptor.size
    this.usage = descriptor.usage
    this.label = descriptor.label
    this.data = new Uint8Array(descriptor.size)
  }

  destroy(): void {
    this.isDestroyed = true
  }

  getMappedRange(offset = 0, size?: number): ArrayBuffer {
    const s = size !== undefined ? size : this.size - offset
    return this.data.buffer.slice(offset, offset + s) as ArrayBuffer
  }

  async mapAsync(_mode: number, _offset = 0, _size?: number): Promise<void> {
    return Promise.resolve()
  }

  unmap(): void {}
}

export class MockGPUTextureView {
  texture: MockGPUTexture
  label?: string
  __isMockTextureView = true

  constructor(texture: MockGPUTexture, label?: string) {
    this.texture = texture
    this.label = label
  }
}

export class MockGPUTexture {
  width: number
  height: number
  depthOrArrayLayers: number
  format: string
  usage: number
  isDestroyed = false
  label?: string
  views: MockGPUTextureView[] = []

  constructor(descriptor: {
    size: [number, number, number?] | { width: number; height: number; depthOrArrayLayers?: number }
    format: string
    usage: number
    label?: string
  }) {
    if (Array.isArray(descriptor.size)) {
      this.width = descriptor.size[0]
      this.height = descriptor.size[1]
      this.depthOrArrayLayers = descriptor.size[2] ?? 1
    } else {
      this.width = descriptor.size.width
      this.height = descriptor.size.height
      this.depthOrArrayLayers = descriptor.size.depthOrArrayLayers ?? 1
    }
    this.format = descriptor.format
    this.usage = descriptor.usage
    this.label = descriptor.label
  }

  createView(descriptor?: { label?: string }): MockGPUTextureView {
    const view = new MockGPUTextureView(this, descriptor?.label)
    this.views.push(view)
    return view
  }

  destroy(): void {
    this.isDestroyed = true
  }
}

export class MockGPUSampler {
  label?: string
  constructor(descriptor?: any) {
    this.label = descriptor?.label
  }
}

export class MockGPUBindGroupLayout {
  descriptor: any
  constructor(descriptor: any) {
    this.descriptor = descriptor
  }
}

export class MockGPUBindGroup {
  layout: MockGPUBindGroupLayout
  entries: any[]
  label?: string

  constructor(descriptor: { layout: MockGPUBindGroupLayout; entries: any[]; label?: string }) {
    this.layout = descriptor.layout
    this.entries = descriptor.entries
    this.label = descriptor.label
  }
}

export class MockGPUShaderModule {
  code: string
  label?: string
  constructor(descriptor: { code: string; label?: string }) {
    this.code = descriptor.code
    this.label = descriptor.label
  }
}

export class MockGPURenderPipeline {
  descriptor: any
  label?: string
  bindGroupLayouts: Map<number, MockGPUBindGroupLayout> = new Map()

  constructor(descriptor: any) {
    this.descriptor = descriptor
    this.label = descriptor.label
  }

  getBindGroupLayout(index: number): MockGPUBindGroupLayout {
    if (!this.bindGroupLayouts.has(index)) {
      this.bindGroupLayouts.set(index, new MockGPUBindGroupLayout({ index }))
    }
    return this.bindGroupLayouts.get(index)!
  }
}

export interface DrawCallRecord {
  vertexCount: number
  instanceCount: number
  firstVertex: number
  firstInstance: number
  pipeline: MockGPURenderPipeline | null
  bindGroups: Map<number, MockGPUBindGroup>
  vertexBuffers: Map<number, MockGPUBuffer>
}

export class MockGPURenderPassEncoder {
  descriptor: any
  currentPipeline: MockGPURenderPipeline | null = null
  currentBindGroups: Map<number, MockGPUBindGroup> = new Map()
  currentVertexBuffers: Map<number, MockGPUBuffer> = new Map()
  drawCalls: DrawCallRecord[] = []
  ended = false

  constructor(descriptor: any) {
    this.descriptor = descriptor
  }

  setPipeline(pipeline: MockGPURenderPipeline): void {
    this.currentPipeline = pipeline
  }

  setBindGroup(index: number, bindGroup: MockGPUBindGroup): void {
    this.currentBindGroups.set(index, bindGroup)
  }

  setVertexBuffer(slot: number, buffer: MockGPUBuffer): void {
    this.currentVertexBuffers.set(slot, buffer)
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.drawCalls.push({
      vertexCount,
      instanceCount,
      firstVertex,
      firstInstance,
      pipeline: this.currentPipeline,
      bindGroups: new Map(this.currentBindGroups),
      vertexBuffers: new Map(this.currentVertexBuffers),
    })
  }

  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0): void {
    this.draw(indexCount, instanceCount, firstIndex, firstInstance)
  }

  end(): void {
    this.ended = true
  }
}

export class MockGPUCommandEncoder {
  renderPasses: MockGPURenderPassEncoder[] = []

  beginRenderPass(descriptor: any): MockGPURenderPassEncoder {
    const pass = new MockGPURenderPassEncoder(descriptor)
    this.renderPasses.push(pass)
    return pass
  }

  finish(): { renderPasses: MockGPURenderPassEncoder[] } {
    return { renderPasses: this.renderPasses }
  }
}

export class MockGPUQueue {
  device: MockGPUDevice
  submittedCommands: any[] = []
  writeBufferCalls: Array<{ buffer: MockGPUBuffer; offset: number; byteLength: number }> = []

  constructor(device: MockGPUDevice) {
    this.device = device
  }

  writeBuffer(
    buffer: MockGPUBuffer,
    bufferOffset: number,
    data: BufferSource,
    dataOffset = 0,
    size?: number
  ): void {
    let sourceBytes: Uint8Array
    if (data instanceof ArrayBuffer) {
      sourceBytes = new Uint8Array(data, dataOffset, size)
    } else if (ArrayBuffer.isView(data)) {
      const byteOffset = data.byteOffset + dataOffset
      const byteLength = size !== undefined ? size : data.byteLength - dataOffset
      sourceBytes = new Uint8Array(data.buffer, byteOffset, byteLength)
    } else {
      sourceBytes = new Uint8Array(0)
    }

    if (buffer.data.length < bufferOffset + sourceBytes.length) {
      const expanded = new Uint8Array(bufferOffset + sourceBytes.length)
      expanded.set(buffer.data)
      buffer.data = expanded
      buffer.size = expanded.length
    }

    buffer.data.set(sourceBytes, bufferOffset)
    this.writeBufferCalls.push({
      buffer,
      offset: bufferOffset,
      byteLength: sourceBytes.length,
    })
  }

  submit(commandBuffers: any[]): void {
    this.submittedCommands.push(...commandBuffers)
  }

  copyExternalImageToTexture(
    source: { source: any },
    destination: { texture: MockGPUTexture },
    copySize: [number, number, number?] | { width: number; height: number; depthOrArrayLayers?: number }
  ): void {
    // Record texture copy
  }
}

export class MockGPUDevice {
  queue: MockGPUQueue
  isDestroyed = false
  createdBuffers: MockGPUBuffer[] = []
  createdTextures: MockGPUTexture[] = []
  createdPipelines: MockGPURenderPipeline[] = []
  createdBindGroups: MockGPUBindGroup[] = []
  createdShaderModules: MockGPUShaderModule[] = []

  private lostResolve!: (info: { reason: string; message: string }) => void
  readonly lost: Promise<{ reason: string; message: string }>

  constructor() {
    this.queue = new MockGPUQueue(this)
    this.lost = new Promise((resolve) => {
      this.lostResolve = resolve
    })
  }

  createBuffer(descriptor: { size: number; usage: number; label?: string }): MockGPUBuffer {
    const buffer = new MockGPUBuffer(descriptor)
    this.createdBuffers.push(buffer)
    return buffer
  }

  createTexture(descriptor: any): MockGPUTexture {
    const texture = new MockGPUTexture(descriptor)
    this.createdTextures.push(texture)
    return texture
  }

  createSampler(descriptor?: any): MockGPUSampler {
    return new MockGPUSampler(descriptor)
  }

  createShaderModule(descriptor: { code: string; label?: string }): MockGPUShaderModule {
    if (descriptor.code && descriptor.code.includes("SYNTAX_ERROR_TRIGGER")) {
      throw new Error("WGSL Parse error: Invalid syntax")
    }
    const module = new MockGPUShaderModule(descriptor)
    this.createdShaderModules.push(module)
    return module
  }

  createRenderPipeline(descriptor: any): MockGPURenderPipeline {
    const pipeline = new MockGPURenderPipeline(descriptor)
    this.createdPipelines.push(pipeline)
    return pipeline
  }

  createBindGroupLayout(descriptor: any): MockGPUBindGroupLayout {
    return new MockGPUBindGroupLayout(descriptor)
  }

  createPipelineLayout(_descriptor: any): any {
    return { __isMockPipelineLayout: true }
  }

  createBindGroup(descriptor: { layout: MockGPUBindGroupLayout; entries: any[]; label?: string }): MockGPUBindGroup {
    const bindGroup = new MockGPUBindGroup(descriptor)
    this.createdBindGroups.push(bindGroup)
    return bindGroup
  }

  createCommandEncoder(): MockGPUCommandEncoder {
    return new MockGPUCommandEncoder()
  }

  simulateDeviceLost(message = "WebGPU device was disconnected", reason = "destroyed"): void {
    this.isDestroyed = true
    this.lostResolve({ message, reason })
  }

  destroy(): void {
    this.isDestroyed = true
  }
}

export class MockGPUAdapter {
  device: MockGPUDevice | null = null
  features = new Set<string>()
  limits: Record<string, number> = {
    maxTextureDimension2D: 8192,
    maxBufferSize: 268435456,
  }

  async requestDevice(): Promise<MockGPUDevice> {
    this.device = new MockGPUDevice()
    return this.device
  }
}

export class MockNavigatorGPU {
  adapter: MockGPUAdapter | null = null
  preferredFormat: string = "bgra8unorm"
  shouldFailAdapter = false

  async requestAdapter(): Promise<MockGPUAdapter | null> {
    if (this.shouldFailAdapter) return null
    this.adapter = new MockGPUAdapter()
    return this.adapter
  }

  getPreferredCanvasFormat(): string {
    return this.preferredFormat
  }
}

let originalGPU: any = undefined
let originalNavigator: any = undefined

export function setupWebGPUMock(): {
  gpu: MockNavigatorGPU
  getDevice: () => MockGPUDevice | null
} {
  const mockGPU = new MockNavigatorGPU()

  // Install global GPU enums
  ;(globalThis as any).GPUBufferUsage = MockGPUBufferUsage
  ;(globalThis as any).GPUTextureUsage = MockGPUTextureUsage
  ;(globalThis as any).GPUShaderStage = MockGPUShaderStage
  ;(globalThis as any).GPUColorWrite = MockGPUColorWrite

  if (!globalThis.navigator) {
    ;(globalThis as any).navigator = { gpu: mockGPU }
  } else {
    originalGPU = (globalThis.navigator as any).gpu
    Object.defineProperty(globalThis.navigator, "gpu", {
      value: mockGPU,
      configurable: true,
      writable: true,
    })
  }

  return {
    gpu: mockGPU,
    getDevice: () => mockGPU.adapter?.device ?? null,
  }
}

export function teardownWebGPUMock(): void {
  delete (globalThis as any).GPUBufferUsage
  delete (globalThis as any).GPUTextureUsage
  delete (globalThis as any).GPUShaderStage
  delete (globalThis as any).GPUColorWrite

  if (globalThis.navigator) {
    if (originalGPU !== undefined) {
      Object.defineProperty(globalThis.navigator, "gpu", {
        value: originalGPU,
        configurable: true,
        writable: true,
      })
    } else {
      delete (globalThis.navigator as any).gpu
    }
  }
}
