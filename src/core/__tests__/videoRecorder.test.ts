import { describe, it, expect, vi, beforeEach } from "vitest"
import { videoLoopRecorder } from "../videoRecorder"

describe("Video Loop Recorder Service", () => {
  beforeEach(() => {
    videoLoopRecorder.stopRecording()
  })

  it("handles browser support checks and default mime types", () => {
    const mime = videoLoopRecorder.getSupportedMimeType()
    expect(mime).toBeDefined()
    expect(typeof mime).toBe("string")
    expect(mime).toContain("video/")
  })

  it("rejects recording if canvas is missing", async () => {
    await expect(
      videoLoopRecorder.startRecording({ canvas: null as any })
    ).rejects.toThrow("No canvas provided for recording")
  })

  it("records video stream with MediaRecorder mock and resolves result", async () => {
    let ondataavailableHandler: ((e: any) => void) | null = null
    let onstopHandler: (() => void) | null = null

    const mockTracks = [{ stop: vi.fn() }]
    const mockStream = {
      getTracks: () => mockTracks,
    }

    const mockCanvas = {
      captureStream: vi.fn(() => mockStream),
    } as unknown as HTMLCanvasElement

    class MockMediaRecorder {
      state = "recording"
      ondataavailable: any = null
      onstop: any = null
      onerror: any = null
      constructor() {
        setTimeout(() => {
          ondataavailableHandler = this.ondataavailable
          onstopHandler = this.onstop
          if (ondataavailableHandler) {
            ondataavailableHandler({ data: new Blob(["mock-video-chunk"]) })
          }
        }, 10)
      }
      start = vi.fn()
      stop = vi.fn(() => {
        this.state = "inactive"
        if (onstopHandler) onstopHandler()
      })
    }

    (globalThis as any).MediaRecorder = MockMediaRecorder as any
    ;(globalThis as any).MediaRecorder.isTypeSupported = vi.fn(() => true)

    let progressCalls = 0
    const recordPromise = videoLoopRecorder.startRecording({
      canvas: mockCanvas,
      durationSeconds: 0.1, // Quick timer
      fps: 60,
      onProgress: () => {
        progressCalls++
      },
    })

    // Wait a brief moment and stop recording
    await new Promise((r) => setTimeout(r, 20))
    videoLoopRecorder.stopRecording()

    const result = await recordPromise
    expect(result.durationSeconds).toBe(0.1)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(mockCanvas.captureStream).toHaveBeenCalledWith(60)
  })
})
