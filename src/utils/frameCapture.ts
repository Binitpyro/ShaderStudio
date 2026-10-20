export interface CaptureOptions {
  width?: number
  height?: number
  mimeType?: string
  quality?: number
}

class ViewportCaptureService {
  private canvas: HTMLCanvasElement | null = null
  private getPerfMetricsFn: (() => { fps: number; frameTimeMs: number }) | null = null

  public registerCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas
  }

  public unregisterCanvas() {
    this.canvas = null
  }

  public registerPerfMetrics(fn: () => { fps: number; frameTimeMs: number }) {
    this.getPerfMetricsFn = fn
  }

  public unregisterPerfMetrics() {
    this.getPerfMetricsFn = null
  }

  public getPerfMetrics(): { fps: number; frameTimeMs: number } {
    if (this.getPerfMetricsFn) {
      return this.getPerfMetricsFn()
    }
    return { fps: 60, frameTimeMs: 16.6 }
  }

  public captureBase64(options?: CaptureOptions): string | null {
    if (!this.canvas) return null

    try {
      if (options?.width && options?.height && (options.width !== this.canvas.width || options.height !== this.canvas.height)) {
        // Resized snapshot using an offscreen canvas
        const offscreen = document.createElement("canvas")
        offscreen.width = options.width
        offscreen.height = options.height
        const ctx = offscreen.getContext("2d")
        if (ctx) {
          ctx.drawImage(this.canvas, 0, 0, options.width, options.height)
          return offscreen.toDataURL(options.mimeType || "image/png", options.quality)
        }
      }
      return this.canvas.toDataURL(options?.mimeType || "image/png", options?.quality)
    } catch (e) {
      console.warn("Failed to capture viewport snapshot:", e)
      return null
    }
  }

  public async captureBlob(options?: CaptureOptions): Promise<Blob | null> {
    if (!this.canvas) return null
    return new Promise((resolve) => {
      try {
        this.canvas?.toBlob(
          (blob) => resolve(blob),
          options?.mimeType || "image/png",
          options?.quality
        )
      } catch {
        resolve(null)
      }
    })
  }
}

export const viewportCapture = new ViewportCaptureService()
