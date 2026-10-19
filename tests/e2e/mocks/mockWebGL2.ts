/**
 * High-fidelity WebGL2 Mock for Headless Testing
 */

import type { MockCanvasElement } from "./mockDOM"

export class MockWebGLShader {
  type: number
  source = ""
  compiled = true
  infoLog = ""
  isDestroyed = false

  constructor(type: number) {
    this.type = type
  }
}

export class MockWebGLProgram {
  shaders: MockWebGLShader[] = []
  linked = true
  infoLog = ""
  isDestroyed = false
  uniformLocations: Map<string, MockWebGLUniformLocation> = new Map()
  activeUniforms: Array<{ name: string; size: number; type: number }> = [
    { name: "u_mvp", size: 1, type: 0x8b5c },
    { name: "u_color", size: 1, type: 0x8b51 },
    { name: "u_time", size: 1, type: 0x1406 },
  ]

  getUniformLocation(name: string): MockWebGLUniformLocation {
    if (!this.uniformLocations.has(name)) {
      this.uniformLocations.set(name, new MockWebGLUniformLocation(name))
    }
    return this.uniformLocations.get(name)!
  }
}

export class MockWebGLUniformLocation {
  name: string
  value: any = null

  constructor(name: string) {
    this.name = name
  }
}

export class MockWebGLBuffer {
  target: number = 0
  data: ArrayBufferView | ArrayBuffer | null = null
  usage: number = 0
  isDestroyed = false
}

export class MockWebGLVertexArrayObject {
  attribs: Map<number, any> = new Map()
  isDestroyed = false
}

export class MockWebGLTexture {
  target: number = 0
  width: number = 0
  height: number = 0
  minFilter: number = 0
  magFilter: number = 0
  wrapS: number = 0
  wrapT: number = 0
  isDestroyed = false
}

export class MockWebGLFramebuffer {
  attachments: Map<number, MockWebGLTexture> = new Map()
  isDestroyed = false
}

export class MockWebGL2RenderingContext {
  // WebGL & WebGL2 Constants
  readonly DEPTH_TEST = 0x0b71
  readonly CULL_FACE = 0x0b44
  readonly BACK = 0x0405
  readonly VERTEX_SHADER = 0x8b31
  readonly FRAGMENT_SHADER = 0x8b30
  readonly COMPILE_STATUS = 0x8b81
  readonly LINK_STATUS = 0x8b82
  readonly ACTIVE_UNIFORMS = 0x8b86
  readonly ACTIVE_ATTRIBUTES = 0x8b89
  readonly ARRAY_BUFFER = 0x8892
  readonly STATIC_DRAW = 0x88e4
  readonly DYNAMIC_DRAW = 0x88e8
  readonly FLOAT = 0x1406
  readonly TRIANGLES = 0x0004
  readonly COLOR_BUFFER_BIT = 0x00004000
  readonly DEPTH_BUFFER_BIT = 0x00000100
  readonly TEXTURE0 = 0x84c0
  readonly TEXTURE1 = 0x84c1
  readonly TEXTURE2 = 0x84c2
  readonly TEXTURE3 = 0x84c3
  readonly TEXTURE_2D = 0x0de1
  readonly RGBA = 0x1908
  readonly UNSIGNED_BYTE = 0x1401
  readonly LINEAR = 0x2601
  readonly NEAREST = 0x2600
  readonly CLAMP_TO_EDGE = 0x812f
  readonly FRAMEBUFFER = 0x8d40
  readonly COLOR_ATTACHMENT0 = 0x8ce0
  readonly COLOR_ATTACHMENT1 = 0x8ce1
  readonly COLOR_ATTACHMENT2 = 0x8ce2
  readonly COLOR_ATTACHMENT3 = 0x8ce3
  readonly COLOR_ATTACHMENT4 = 0x8ce4
  readonly COLOR_ATTACHMENT5 = 0x8ce5
  readonly COLOR_ATTACHMENT6 = 0x8ce6
  readonly COLOR_ATTACHMENT7 = 0x8ce7
  readonly DEPTH_ATTACHMENT = 0x8d00
  readonly DEPTH_STENCIL_ATTACHMENT = 0x821a
  readonly RGBA8 = 0x8058
  readonly RGBA16F = 0x881a
  readonly RGBA32F = 0x8814
  readonly RG16F = 0x822f
  readonly RG32F = 0x8230
  readonly R16F = 0x822d
  readonly R32F = 0x822e
  readonly DEPTH_COMPONENT16 = 0x81a5
  readonly DEPTH_COMPONENT24 = 0x81a6
  readonly DEPTH_COMPONENT32F = 0x8cac
  readonly DEPTH24_STENCIL8 = 0x88f0
  readonly TEXTURE_CUBE_MAP = 0x8513
  readonly TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515
  readonly TEXTURE_CUBE_MAP_NEGATIVE_X = 0x8516
  readonly TEXTURE_CUBE_MAP_POSITIVE_Y = 0x8517
  readonly TEXTURE_CUBE_MAP_NEGATIVE_Y = 0x8518
  readonly TEXTURE_CUBE_MAP_POSITIVE_Z = 0x8519
  readonly TEXTURE_CUBE_MAP_NEGATIVE_Z = 0x851a
  readonly COMPARE_REF_TO_TEXTURE = 0x884e
  readonly TEXTURE_COMPARE_MODE = 0x884c
  readonly TEXTURE_COMPARE_FUNC = 0x884d
  readonly LEQUAL = 0x0203
  readonly NONE = 0
  readonly HALF_FLOAT = 0x140b
  readonly TEXTURE4 = 0x84c4
  readonly TEXTURE5 = 0x84c5
  readonly TEXTURE6 = 0x84c6
  readonly TEXTURE7 = 0x84c7
  readonly TEXTURE8 = 0x84c8
  readonly TEXTURE9 = 0x84c9
  readonly TEXTURE10 = 0x84ca
  readonly DRAW_FRAMEBUFFER = 0x8ca9
  readonly READ_FRAMEBUFFER = 0x8ca8
  readonly RENDERBUFFER = 0x8d41
  readonly FRAMEBUFFER_COMPLETE = 0x8cd5
  readonly TEXTURE_MIN_FILTER = 0x2801
  readonly TEXTURE_MAG_FILTER = 0x2800
  readonly TEXTURE_WRAP_S = 0x2802
  readonly TEXTURE_WRAP_T = 0x2803
  readonly TEXTURE_WRAP_R = 0x8072

  drawBuffersList: number[] = []

  canvas: MockCanvasElement
  activeProgram: MockWebGLProgram | null = null
  activeVAO: MockWebGLVertexArrayObject | null = null
  boundBuffers: Map<number, MockWebGLBuffer> = new Map()
  boundTextures: Map<number, MockWebGLTexture> = new Map()
  activeTextureUnit: number = 0x84c0
  boundFramebuffer: MockWebGLFramebuffer | null = null

  enabledCaps = new Set<number>()
  viewportRect = { x: 0, y: 0, width: 800, height: 600 }
  clearColorValues = [0, 0, 0, 1]

  drawCount = 0
  drawVertexCount = 0
  contextLost = false

  createdShaders: MockWebGLShader[] = []
  createdPrograms: MockWebGLProgram[] = []
  createdBuffers: MockWebGLBuffer[] = []
  createdVAOs: MockWebGLVertexArrayObject[] = []
  createdTextures: MockWebGLTexture[] = []
  createdFramebuffers: MockWebGLFramebuffer[] = []

  // Uniform values record for assertion
  uniformValues: Map<string, any> = new Map()

  constructor(canvas: MockCanvasElement) {
    this.canvas = canvas
    this.viewportRect.width = canvas.width
    this.viewportRect.height = canvas.height
  }

  enable(cap: number): void {
    this.enabledCaps.add(cap)
  }

  disable(cap: number): void {
    this.enabledCaps.delete(cap)
  }

  depthMask(_flag: boolean): void {}

  cullFace(_mode: number): void {}

  createShader(type: number): MockWebGLShader {
    const shader = new MockWebGLShader(type)
    this.createdShaders.push(shader)
    return shader
  }

  shaderSource(shader: MockWebGLShader, source: string): void {
    shader.source = source
    if (source.includes("SYNTAX_ERROR_TRIGGER")) {
      shader.compiled = false
      shader.infoLog = "GLSL compile error: syntax error"
    }
  }

  compileShader(_shader: MockWebGLShader): void {}

  getShaderParameter(shader: MockWebGLShader, pname: number): any {
    if (pname === this.COMPILE_STATUS) return shader.compiled
    return true
  }

  getShaderInfoLog(shader: MockWebGLShader): string {
    return shader.infoLog
  }

  deleteShader(shader: MockWebGLShader): void {
    shader.isDestroyed = true
  }

  createProgram(): MockWebGLProgram {
    const program = new MockWebGLProgram()
    this.createdPrograms.push(program)
    return program
  }

  attachShader(program: MockWebGLProgram, shader: MockWebGLShader): void {
    program.shaders.push(shader)
    if (!shader.compiled) {
      program.linked = false
      program.infoLog = shader.infoLog
    }
  }

  linkProgram(_program: MockWebGLProgram): void {}

  getProgramParameter(program: MockWebGLProgram, pname: number): any {
    if (pname === this.LINK_STATUS) return program.linked
    if (pname === this.ACTIVE_UNIFORMS) return program.activeUniforms.length
    return true
  }

  getActiveUniform(program: MockWebGLProgram, index: number): { name: string; size: number; type: number } | null {
    return program.activeUniforms[index] || null
  }

  getProgramInfoLog(program: MockWebGLProgram): string {
    return program.infoLog
  }

  useProgram(program: MockWebGLProgram | null): void {
    this.activeProgram = program
  }

  deleteProgram(program: MockWebGLProgram): void {
    program.isDestroyed = true
  }

  getUniformLocation(program: MockWebGLProgram, name: string): MockWebGLUniformLocation | null {
    return program.getUniformLocation(name)
  }

  createVertexArray(): MockWebGLVertexArrayObject {
    const vao = new MockWebGLVertexArrayObject()
    this.createdVAOs.push(vao)
    return vao
  }

  bindVertexArray(vao: MockWebGLVertexArrayObject | null): void {
    this.activeVAO = vao
  }

  deleteVertexArray(vao: MockWebGLVertexArrayObject): void {
    vao.isDestroyed = true
  }

  createBuffer(): MockWebGLBuffer {
    const buffer = new MockWebGLBuffer()
    this.createdBuffers.push(buffer)
    return buffer
  }

  bindBuffer(target: number, buffer: MockWebGLBuffer | null): void {
    if (buffer) {
      buffer.target = target
      this.boundBuffers.set(target, buffer)
    } else {
      this.boundBuffers.delete(target)
    }
  }

  bufferData(target: number, data: ArrayBufferView | ArrayBuffer, usage: number): void {
    const buffer = this.boundBuffers.get(target)
    if (buffer) {
      buffer.data = data
      buffer.usage = usage
    }
  }

  deleteBuffer(buffer: MockWebGLBuffer): void {
    buffer.isDestroyed = true
  }

  enableVertexAttribArray(index: number): void {
    if (this.activeVAO) {
      this.activeVAO.attribs.set(index, { enabled: true })
    }
  }

  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    if (this.activeVAO) {
      this.activeVAO.attribs.set(index, { size, type, normalized, stride, offset })
    }
  }

  clearColor(r: number, g: number, b: number, a: number): void {
    this.clearColorValues = [r, g, b, a]
  }

  clear(_mask: number): void {}

  viewport(x: number, y: number, width: number, height: number): void {
    this.viewportRect = { x, y, width, height }
  }

  uniform1f(location: MockWebGLUniformLocation | null, v: number): void {
    if (location) {
      location.value = v
      this.uniformValues.set(location.name, v)
    }
  }

  uniform1i(location: MockWebGLUniformLocation | null, v: number): void {
    if (location) {
      location.value = v
      this.uniformValues.set(location.name, v)
    }
  }

  uniform2f(location: MockWebGLUniformLocation | null, x: number, y: number): void {
    if (location) {
      location.value = [x, y]
      this.uniformValues.set(location.name, [x, y])
    }
  }

  uniform2fv(location: MockWebGLUniformLocation | null, v: Float32Array | number[]): void {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }

  uniform3f(location: MockWebGLUniformLocation | null, x: number, y: number, z: number): void {
    if (location) {
      location.value = [x, y, z]
      this.uniformValues.set(location.name, [x, y, z])
    }
  }

  uniform3fv(location: MockWebGLUniformLocation | null, v: Float32Array | number[]): void {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }

  uniform4fv(location: MockWebGLUniformLocation | null, v: Float32Array | number[]): void {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }

  uniformMatrix4fv(location: MockWebGLUniformLocation | null, _transpose: boolean, v: Float32Array | number[]): void {
    if (location) {
      const arr = Array.from(v)
      location.value = arr
      this.uniformValues.set(location.name, arr)
    }
  }

  drawArrays(_mode: number, _first: number, count: number): void {
    this.drawCount++
    this.drawVertexCount += count
  }

  activeTexture(textureUnit: number): void {
    this.activeTextureUnit = textureUnit
  }

  createTexture(): MockWebGLTexture {
    const tex = new MockWebGLTexture()
    this.createdTextures.push(tex)
    return tex
  }

  bindTexture(target: number, texture: MockWebGLTexture | null): void {
    if (texture) {
      texture.target = target
      this.boundTextures.set(this.activeTextureUnit, texture)
    } else {
      this.boundTextures.delete(this.activeTextureUnit)
    }
  }

  texImage2D(
    target: number,
    _level: number,
    _internalformat: number,
    width: number,
    height: number,
    _border: number,
    _format: number,
    _type: number,
    _pixels: any
  ): void {
    const tex = this.boundTextures.get(this.activeTextureUnit)
    if (tex) {
      tex.target = target
      tex.width = width
      tex.height = height
    }
  }

  texParameteri(_target: number, pname: number, param: number): void {
    const tex = this.boundTextures.get(this.activeTextureUnit)
    if (tex) {
      if (pname === this.TEXTURE_MIN_FILTER) tex.minFilter = param
      if (pname === this.TEXTURE_MAG_FILTER) tex.magFilter = param
      if (pname === this.TEXTURE_WRAP_S) tex.wrapS = param
      if (pname === this.TEXTURE_WRAP_T) tex.wrapT = param
    }
  }

  deleteTexture(texture: MockWebGLTexture): void {
    texture.isDestroyed = true
  }

  createFramebuffer(): MockWebGLFramebuffer {
    const fb = new MockWebGLFramebuffer()
    this.createdFramebuffers.push(fb)
    return fb
  }

  bindFramebuffer(target: number, fb: MockWebGLFramebuffer | null): void {
    this.boundFramebuffer = fb
  }

  framebufferTexture2D(
    _target: number,
    attachment: number,
    _textarget: number,
    texture: MockWebGLTexture | null,
    _level: number
  ): void {
    if (this.boundFramebuffer && texture) {
      this.boundFramebuffer.attachments.set(attachment, texture)
    }
  }

  checkFramebufferStatus(_target: number): number {
    return this.FRAMEBUFFER_COMPLETE
  }

  deleteFramebuffer(fb: MockWebGLFramebuffer): void {
    fb.isDestroyed = true
  }

  drawBuffers(buffers: number[]): void {
    this.drawBuffersList = [...buffers]
  }

  getExtension(name: string): any {
    if (
      name === "EXT_color_buffer_float" ||
      name === "OES_texture_float_linear" ||
      name === "EXT_color_buffer_half_float"
    ) {
      return {}
    }
    return {}
  }

  texStorage2D(target: number, _levels: number, _internalformat: number, width: number, height: number): void {
    const tex = this.boundTextures.get(this.activeTextureUnit)
    if (tex) {
      tex.target = target
      tex.width = width
      tex.height = height
    }
  }

  createRenderbuffer(): any {
    return { isDestroyed: false }
  }

  bindRenderbuffer(_target: number, _rb: any): void {}

  renderbufferStorage(_target: number, _internalformat: number, _width: number, _height: number): void {}

  framebufferRenderbuffer(_target: number, _attachment: number, _renderbuffertarget: number, _renderbuffer: any): void {}

  isContextLost(): boolean {
    return this.contextLost
  }

  simulateContextLost(): void {
    this.contextLost = true
    const event = {
      type: "webglcontextlost",
      preventDefault: () => {},
    }
    this.canvas.dispatchEvent(event)
  }

  simulateContextRestored(): void {
    this.contextLost = false
    const event = {
      type: "webglcontextrestored",
      preventDefault: () => {},
    }
    this.canvas.dispatchEvent(event)
  }
}

export function setupWebGL2Mock(): {
  getLastContext: () => MockWebGL2RenderingContext | null
} {
  let lastContext: MockWebGL2RenderingContext | null = null

  ;(globalThis as any).__createMockWebGL2Context = (canvas: MockCanvasElement) => {
    lastContext = new MockWebGL2RenderingContext(canvas)
    return lastContext
  }

  return {
    getLastContext: () => lastContext,
  }
}

export function teardownWebGL2Mock(): void {
  delete (globalThis as any).__createMockWebGL2Context
}
