import { renderCoordinator } from "@/core/renderCoordinator"

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

  /**
   * Screenshot of the NEXT drawn frame via renderCoordinator.captureNextFrame(). Use this for every
   * user/agent-facing capture: WebGL2/Three lack preserveDrawingBuffer, so reading the canvas outside
   * the render loop (captureBase64/captureBlob) yields a blank image. Resolves null on failure.
   */
  public async captureFrameBase64(options?: CaptureOptions): Promise<string | null> {
    try {
      const blob = await renderCoordinator.captureNextFrame()
      const mime = options?.mimeType || "image/png"
      const wantsResize = !!(options?.width && options?.height)
      if (!wantsResize && mime === "image/png") return await blobToDataUrl(blob)
      const bitmap = await createImageBitmap(blob)
      const out = document.createElement("canvas")
      out.width = options?.width || bitmap.width
      out.height = options?.height || bitmap.height
      out.getContext("2d")?.drawImage(bitmap, 0, 0, out.width, out.height)
      bitmap.close?.()
      return out.toDataURL(mime, options?.quality)
    } catch (e) {
      console.warn("Failed to capture viewport frame:", e)
      return null
    }
  }

  /** Raw canvas read. Only valid inside the render loop (RenderCoordinator uses it right after a draw). Prefer captureFrameBase64. */
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
