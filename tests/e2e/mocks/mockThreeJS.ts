/**
 * Three.js WebGLRenderer and ShaderMaterial Mocks
 */

import { vi } from "vitest"

export class MockThreeRenderer {
  domElement: any
  capabilities = { isWebGL2: true, getMaxAnisotropy: () => 16, precision: "highp" }
  render = vi.fn()
  setSize = vi.fn((w: number, h: number) => {
    this._width = w
    this._height = h
  })
  setPixelRatio = vi.fn((pr: number) => {
    this._pixelRatio = pr
  })
  getPixelRatio = vi.fn(() => this._pixelRatio)
  getSize = vi.fn((target: any) => target.set(this._width, this._height))
  getClearColor = vi.fn((target: any) => target.set(0x000000))
  getClearAlpha = vi.fn(() => 1)
  setClearColor = vi.fn()
  dispose = vi.fn()
  getRenderTarget = vi.fn(() => null)
  setRenderTarget = vi.fn()
  clear = vi.fn()
  autoClear = true

  private _width = 800
  private _height = 600
  private _pixelRatio = 1

  static instances: MockThreeRenderer[] = []

  constructor(params?: any) {
    this.domElement = params?.canvas || ((globalThis.document as any)?.createElement("canvas") ?? {})
    MockThreeRenderer.instances.push(this)
  }

  static reset(): void {
    MockThreeRenderer.instances = []
  }
}
