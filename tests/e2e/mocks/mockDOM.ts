/**
 * DOM and Canvas Mocks for Headless E2E Testing
 */

export type EventCallback = (e: any) => void

export class MockCanvasElement {
  width: number = 800
  height: number = 600
  clientWidth: number = 800
  clientHeight: number = 600
  style: Record<string, string> = {}
  tagName: string = "CANVAS"
  private eventListeners: Map<string, Set<EventCallback>> = new Map()
  public webglContext: any = null
  public webgpuContext: any = null

  constructor(width = 800, height = 600) {
    this.width = width
    this.height = height
    this.clientWidth = width
    this.clientHeight = height
  }

  getContext(type: string, options?: any): any {
    if (type === "webgpu") {
      if (!this.webgpuContext) {
        this.webgpuContext = createMockGPUCanvasContext(this)
      }
      return this.webgpuContext
    }
    if (type === "webgl2" || type === "webgl") {
      if (!this.webglContext && (globalThis as any).__createMockWebGL2Context) {
        this.webglContext = (globalThis as any).__createMockWebGL2Context(this, options)
      }
      return this.webglContext
    }
    return null
  }

  addEventListener(type: string, callback: EventCallback) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(callback)
  }

  removeEventListener(type: string, callback: EventCallback) {
    const listeners = this.eventListeners.get(type)
    if (listeners) {
      listeners.delete(callback)
    }
  }

  dispatchEvent(event: { type: string; preventDefault?: () => void }): boolean {
    const listeners = this.eventListeners.get(event.type)
    if (listeners) {
      for (const listener of listeners) {
        listener(event)
      }
    }
    return true
  }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: this.width,
      bottom: this.height,
      width: this.width,
      height: this.height,
      toJSON: () => ({}),
    }
  }
}

export function createMockGPUCanvasContext(canvas: MockCanvasElement) {
  let configuredDevice: any = null
  let configuredFormat: string = "bgra8unorm"
  let currentTexture: any = null

  return {
    canvas,
    configure(config: { device: any; format?: string; alphaMode?: string }) {
      configuredDevice = config.device
      configuredFormat = config.format || "bgra8unorm"
    },
    unconfigure() {
      configuredDevice = null
    },
    getCurrentTexture() {
      if (!currentTexture || currentTexture.width !== canvas.width || currentTexture.height !== canvas.height) {
        currentTexture = {
          width: canvas.width,
          height: canvas.height,
          format: configuredFormat,
          createView: () => ({
            __isMockTextureView: true,
            label: "canvas-current-texture-view",
          }),
          destroy: () => {},
        }
      }
      return currentTexture
    },
    getConfiguredDevice: () => configuredDevice,
    getConfiguredFormat: () => configuredFormat,
  }
}

class MockResizeObserver {
  private callback: (entries: any[], observer: MockResizeObserver) => void
  private observedElements: Set<any> = new Set()

  constructor(callback: (entries: any[], observer: MockResizeObserver) => void) {
    this.callback = callback
  }

  observe(target: any) {
    this.observedElements.add(target)
  }

  unobserve(target: any) {
    this.observedElements.delete(target)
  }

  disconnect() {
    this.observedElements.clear()
  }

  triggerResize(target: any, contentRect?: { width: number; height: number }) {
    if (this.observedElements.has(target)) {
      const rect = contentRect || target.getBoundingClientRect()
      this.callback([{ target, contentRect: rect }], this)
    }
  }
}

let originalGlobals: Record<string, any> = {}

export function setupDOMEnvironment() {
  originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLCanvasElement: (globalThis as any).HTMLCanvasElement,
    ResizeObserver: globalThis.ResizeObserver,
    createImageBitmap: (globalThis as any).createImageBitmap,
    fetch: globalThis.fetch,
  }

  const mockWindow: any = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }

  const mockDocument: any = {
    createElement(tagName: string) {
      if (tagName.toLowerCase() === "canvas") {
        return new MockCanvasElement()
      }
      return {
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
      }
    },
    createElementNS(_ns: string, tagName: string) {
      return mockDocument.createElement(tagName)
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  }

  globalThis.window = mockWindow
  globalThis.document = mockDocument
  ;(globalThis as any).HTMLCanvasElement = MockCanvasElement
  globalThis.ResizeObserver = MockResizeObserver as any

  ;(globalThis as any).createImageBitmap = async (image: any) => {
    return {
      width: image?.width || 256,
      height: image?.height || 256,
      close: () => {},
    }
  }

  globalThis.fetch = async (_url: any) => {
    return {
      ok: true,
      blob: async () => ({ size: 1024, type: "image/png" }),
      arrayBuffer: async () => new ArrayBuffer(1024),
    } as any
  }
}

export function teardownDOMEnvironment() {
  if (originalGlobals.window !== undefined) globalThis.window = originalGlobals.window
  if (originalGlobals.document !== undefined) globalThis.document = originalGlobals.document
  if (originalGlobals.HTMLCanvasElement !== undefined) (globalThis as any).HTMLCanvasElement = originalGlobals.HTMLCanvasElement
  if (originalGlobals.ResizeObserver !== undefined) globalThis.ResizeObserver = originalGlobals.ResizeObserver
  if (originalGlobals.createImageBitmap !== undefined) (globalThis as any).createImageBitmap = originalGlobals.createImageBitmap
  if (originalGlobals.fetch !== undefined) globalThis.fetch = originalGlobals.fetch
}
