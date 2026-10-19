export interface RecordOptions {
  canvas: HTMLCanvasElement
  durationSeconds?: number
  fps?: number
  bitrateMbps?: number
  mimeType?: string
  onProgress?: (progress: { elapsedSeconds: number; targetSeconds: number; percent: number }) => void
}

export interface RecordResult {
  blob: Blob
  url: string
  durationSeconds: number
  mimeType: string
  sizeBytes: number
}

const scheduleFrame = (cb: () => void): number => {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(cb)
  }
  return setTimeout(cb, 16) as unknown as number
}

const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(id)
  } else {
    clearTimeout(id)
  }
}

class VideoLoopRecorderService {
  private mediaRecorder: MediaRecorder | null = null
  private recordedChunks: Blob[] = []
  private isRecording = false
  private timerId: number | null = null
  private startTime = 0
  private currentStream: MediaStream | null = null
  private lastObjectUrl: string | null = null

  public isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function"
    )
  }

  public getSupportedMimeType(): string {
    if (typeof MediaRecorder === "undefined") return "video/webm"

    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ]

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }
    return "video/webm"
  }

  public startRecording(options: RecordOptions): Promise<RecordResult> {
    return new Promise((resolve, reject) => {
      if (this.isRecording) {
        reject(new Error("Recording is already in progress"))
        return
      }

      if (!options.canvas) {
        reject(new Error("No canvas provided for recording"))
        return
      }

      const durationSeconds = options.durationSeconds || 4
      const fps = options.fps || 60
      const bitrate = (options.bitrateMbps || 20) * 1_000_000
      const mimeType = options.mimeType || this.getSupportedMimeType()

      if (this.lastObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(this.lastObjectUrl)
        this.lastObjectUrl = null
      }

      this.recordedChunks = []
      this.isRecording = true

      try {
        const stream = options.canvas.captureStream(fps)
        this.currentStream = stream

        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: bitrate,
        })
        this.mediaRecorder = recorder

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            this.recordedChunks.push(event.data)
          }
        }

        recorder.onerror = (event: any) => {
          this.cleanup()
          reject(event.error || new Error("MediaRecorder runtime error"))
        }

        recorder.onstop = () => {
          this.cleanup()
          const finalBlob = new Blob(this.recordedChunks, { type: mimeType })
          const url = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(finalBlob)
            : ""
          this.lastObjectUrl = url
          resolve({
            blob: finalBlob,
            url,
            durationSeconds,
            mimeType,
            sizeBytes: finalBlob.size,
          })
        }

        this.startTime = performance.now()
        // Request chunks every 100ms
        recorder.start(100)

        // Progress polling loop
        const checkProgress = () => {
          if (!this.isRecording) return
          const now = performance.now()
          const elapsed = (now - this.startTime) / 1000
          const percent = Math.min(100, Math.round((elapsed / durationSeconds) * 100))

          if (options.onProgress) {
            options.onProgress({
              elapsedSeconds: Math.min(durationSeconds, Math.round(elapsed * 10) / 10),
              targetSeconds: durationSeconds,
              percent,
            })
          }

          if (elapsed >= durationSeconds) {
            this.stopRecording()
          } else {
            this.timerId = scheduleFrame(checkProgress)
          }
        }

        this.timerId = scheduleFrame(checkProgress)
      } catch (err: any) {
        this.cleanup()
        reject(err)
      }
    })
  }

  public stopRecording() {
    if (!this.isRecording) return
    this.isRecording = false

    if (this.timerId !== null) {
      cancelFrame(this.timerId)
      this.timerId = null
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop()
      } catch (e) {
        console.warn("Error stopping MediaRecorder:", e)
      }
    }
  }

  public getIsRecording(): boolean {
    return this.isRecording
  }

  private cleanup() {
    this.isRecording = false
    if (this.timerId !== null) {
      cancelFrame(this.timerId)
      this.timerId = null
    }
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop())
      this.currentStream = null
    }
  }

  public downloadVideo(blob: Blob, filename = "ShaderStudio_Loop_60fps.webm") {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  public revokeLastUrl() {
    if (this.lastObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.lastObjectUrl)
      this.lastObjectUrl = null
    }
  }
}

export const videoLoopRecorder = new VideoLoopRecorderService()
