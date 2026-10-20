import { useState, useRef } from "react"
import { useDialogA11y } from "@/lib/useDialogA11y"
import { Button, IconButton, Label, Select } from "@/components/ui"
import {
  X,
  Video,
  Download,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
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

  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, isOpen, onClose, !isRecording)

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
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 outline-none" role="dialog" aria-modal="true" aria-label="Record video loop">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-overlay shadow-lg">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2">
            <Video className="size-4 text-brand-text" />
            <h2 className="text-sm font-medium text-fg">Record video loop</h2>
          </div>
          <IconButton label="Close" onClick={onClose} disabled={isRecording}><X /></IconButton>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {isRecording ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <span className="size-3 animate-pulse rounded-full bg-danger-solid" />
              <div className="text-center">
                <div className="text-sm font-medium text-fg">Recording at <span className="num">{fps}</span> fps</div>
                <div className="num mt-1 text-xs text-fg-muted">
                  {progress.elapsedSeconds.toFixed(1)}s / {progress.targetSeconds.toFixed(1)}s ({progress.percent}%)
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                <div className="h-full bg-brand transition-all duration-100 ease-out" style={{ width: `${progress.percent}%` }} />
              </div>
              <Button variant="outline" size="sm" onClick={handleStopRecording}>Stop early and save</Button>
            </div>
          ) : result ? (
            <div className="flex flex-col gap-3">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-canvas">
                <video ref={videoRef} src={result.url} autoPlay loop muted controls playsInline className="h-full w-full object-contain" />
              </div>
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-3.5" />Loop recorded</span>
                <span className="num">{(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB, {fps} fps</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={handleDownload} className="flex-1"><Download />Download WebM</Button>
                <Button variant="outline" onClick={() => setResult(null)}><RotateCcw />Record another</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loop-duration">Duration</Label>
                  <Select id="loop-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    <option value={2}>2 seconds</option>
                    <option value={4}>4 seconds</option>
                    <option value={6}>6 seconds</option>
                    <option value={8}>8 seconds</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loop-fps">Frame rate</Label>
                  <Select id="loop-fps" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                    <option value={60}>60 fps</option>
                    <option value={30}>30 fps</option>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="loop-bitrate">Quality</Label>
                <Select id="loop-bitrate" value={bitrateMbps} onChange={(e) => setBitrateMbps(Number(e.target.value))}>
                  <option value={25}>25 Mbps, production</option>
                  <option value={15}>15 Mbps, web</option>
                  <option value={8}>8 Mbps, compact</option>
                </Select>
              </div>
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                  <AlertCircle className="size-3.5 shrink-0" /><span>{error}</span>
                </div>
              )}
              <Button variant="primary" onClick={handleStartRecording} className="w-full">
                <Play />Start recording
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
