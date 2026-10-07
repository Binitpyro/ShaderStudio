/**
 * Frame timing and requestAnimationFrame mocks
 */

export class MockClock {
  private currentTime: number = 0
  private nextCallbackId: number = 1
  private callbacks: Map<number, (time: number) => void> = new Map()
  private originalRAF: any = null
  private originalCAF: any = null

  constructor(initialTime = 0) {
    this.currentTime = initialTime
  }

  requestAnimationFrame = (callback: (time: number) => void): number => {
    const id = this.nextCallbackId++
    this.callbacks.set(id, callback)
    return id
  }

  cancelAnimationFrame = (id: number): void => {
    this.callbacks.delete(id)
  }

  getTime(): number {
    return this.currentTime
  }

  setTime(time: number): void {
    this.currentTime = time
  }

  get activeCallbackCount(): number {
    return this.callbacks.size
  }

  get pendingCallbackIds(): number[] {
    return Array.from(this.callbacks.keys())
  }

  step(deltaMs: number = 16.666): void {
    this.currentTime += deltaMs
    // Snapshot current callbacks so newly scheduled ones don't execute in this step
    const currentCallbacks = Array.from(this.callbacks.entries())
    this.callbacks.clear()
    for (const [, cb] of currentCallbacks) {
      cb(this.currentTime)
    }
  }

  stepFrames(count: number, frameMs: number = 16.666): void {
    for (let i = 0; i < count; i++) {
      this.step(frameMs)
    }
  }

  reset(): void {
    this.currentTime = 0
    this.nextCallbackId = 1
    this.callbacks.clear()
  }

  install(): void {
    this.originalRAF = globalThis.requestAnimationFrame
    this.originalCAF = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = this.requestAnimationFrame as any
    globalThis.cancelAnimationFrame = this.cancelAnimationFrame as any
    if (globalThis.window) {
      globalThis.window.requestAnimationFrame = this.requestAnimationFrame as any
      globalThis.window.cancelAnimationFrame = this.cancelAnimationFrame as any
    }
  }

  uninstall(): void {
    if (this.originalRAF !== null) {
      globalThis.requestAnimationFrame = this.originalRAF
    }
    if (this.originalCAF !== null) {
      globalThis.cancelAnimationFrame = this.originalCAF
    }
    if (globalThis.window) {
      if (this.originalRAF !== null) globalThis.window.requestAnimationFrame = this.originalRAF
      if (this.originalCAF !== null) globalThis.window.cancelAnimationFrame = this.originalCAF
    }
  }
}

export const mockClock = new MockClock()
