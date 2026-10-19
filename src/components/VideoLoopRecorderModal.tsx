import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  X,
  Video,
  Download,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react"
import { videoLoopRecorder, type RecordResult } from "@/core/videoRecorder"
import { viewportCapture } from "@/utils/frameCapture"

interface VideoLoopRecorderModalProps {
  isOpen: boolean
  onClose: () => void
}

export function VideoLoopRecorderModal({ isOpen, onClose }: VideoLoopRecorderModalProps) {
  const [duration, setDuration] = useState<number>(4)
  const [fps, setFps] = useState<number>(60)
  const [bitrateMbps, setBitrateMbps] = useState<number>(20)
  const [isRecording, setIsRecording] = useState(false)
  const [progress, setProgress] = useState<{ elapsedSeconds: number; targetSeconds: number; percent: number }>({
    elapsedSeconds: 0,
    targetSeconds: 4,
    percent: 0,
  })
  const [result, setResult] = useState<RecordResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  if (!isOpen) return null

  const handleStartRecording = async () => {
    const canvas = viewportCapture.getCanvas()
    if (!canvas) {
      setError("No active viewport canvas detected. Please ensure viewport is visible.")
      return
    }

    setIsRecording(true)
    setError(null)
    setResult(null)
    setProgress({ elapsedSeconds: 0, targetSeconds: duration, percent: 0 })

    try {
      const res = await videoLoopRecorder.startRecording({
        canvas,
        durationSeconds: duration,
        fps,
        bitrateMbps,
        onProgress: (p) => setProgress(p),
      })
      setResult(res)
    } catch (err: any) {
      setError(err?.message || "Failed to record video loop")
    } finally {
      setIsRecording(false)
    }
  }

  const handleStopRecording = () => {
    videoLoopRecorder.stopRecording()
  }

  const handleDownload = () => {
    if (!result) return
    videoLoopRecorder.downloadVideo(
      result.blob,
      `ShaderStudio_Loop_${result.durationSeconds}s_${fps}fps.webm`
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex flex-col w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">60fps Seamless Video Looper</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isRecording}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-4">
          {isRecording ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="relative flex items-center justify-center">
                <span className="absolute h-12 w-12 rounded-full bg-red-500/20 animate-ping" />
                <span className="h-6 w-6 rounded-full bg-red-600 animate-pulse shadow-lg shadow-red-500/50" />
              </div>

              <div className="text-center">
                <div className="text-sm font-semibold text-foreground">
                  Recording Seamless Loop ({fps} FPS)
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-1">
                  {progress.elapsedSeconds.toFixed(1)}s / {progress.targetSeconds.toFixed(1)}s ({progress.percent}%)
                </div>
              </div>

              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-red-500 h-full transition-all duration-100 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleStopRecording}
                className="mt-2 text-xs border-red-500/40 hover:bg-red-500/10 text-red-400"
              >
                Stop Early & Save
              </Button>
            </div>
          ) : result ? (
            <div className="flex flex-col gap-3">
              <div className="relative aspect-video w-full rounded-md border border-border overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  src={result.url}
                  autoPlay
                  loop
                  muted
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Loop Recorded Successfully</span>
                </div>
                <span className="font-mono text-[11px]">
                  {(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB • {fps} FPS
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <Button
                  onClick={handleDownload}
                  className="flex-1 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Video ({fps}fps WebM)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setResult(null)}
                  className="gap-1.5 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Record Another
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 flex flex-col gap-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                  <span>Loop Parameters</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Duration (Seconds)</label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value={2}>2.0 Seconds (Short loop)</option>
                      <option value={4}>4.0 Seconds (Standard loop)</option>
                      <option value={6}>6.0 Seconds (Extended loop)</option>
                      <option value={8}>8.0 Seconds (Long loop)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Frame Rate</label>
                    <select
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value))}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value={60}>60 FPS (Ultra Smooth)</option>
                      <option value={30}>30 FPS (Standard)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Video Quality / Bitrate</label>
                  <select
                    value={bitrateMbps}
                    onChange={(e) => setBitrateMbps(Number(e.target.value))}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value={25}>25 Mbps (Crisp Ultra HD / Production)</option>
                    <option value={15}>15 Mbps (High Quality / Web)</option>
                    <option value={8}>8 Mbps (Compact / Social Media)</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button onClick={handleStartRecording} className="gap-2 w-full">
                <Play className="h-3.5 w-3.5" />
                Start {duration}s Recording at {fps} FPS
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
