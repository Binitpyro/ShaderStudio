import { useState, useEffect, useCallback, memo } from "react"
import { useTheme } from "@/components/theme-provider"
import { useProjectStore, type BackendType } from "@/stores/projectStore"
import { useTransportStore, type ResolutionScale, formatTime } from "@/stores/transportStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { Button, Segmented, Separator, Slider } from "@/components/ui"
import { ShortcutTip, TipIconButton } from "@/components/layout/ShortcutTip"
import { cn } from "@/lib/utils"
import { Play, Pause, RotateCcw, Sparkles, Download, LayoutTemplate, Sun, Moon, PanelLeft, PanelRight } from "lucide-react"

/** Focus inside these owns the Space key (code editor, node-graph canvas which opens its palette on Space). */
const SPACE_IGNORE_SELECTOR = ".monaco-editor, .react-flow, [data-node-graph], [data-space-passthrough]"
/** Monaco binds Ctrl+I (suggest); leave Ctrl+I / Ctrl+J to it while the editor has focus. */
const EDITOR_SELECTOR = ".monaco-editor"

const BACKEND_OPTIONS: { value: BackendType; label: string }[] = [
  { value: "webgpu", label: "WebGPU" },
  { value: "webgl2", label: "WebGL2" },
  { value: "threejs", label: "Three.js" },
]

const RESOLUTION_OPTIONS = [
  { value: "0.5", label: <span className="num">0.5x</span> },
  { value: "1", label: <span className="num">1x</span> },
  { value: "2", label: <span className="num">2x</span> },
  { value: "native", label: "Native" },
]

/**
 * Global shortcuts: Space play/pause (never in inputs, the code editor or the graph canvas),
 * Ctrl/Cmd+B sidebar, Ctrl/Cmd+J console, Ctrl/Cmd+I inspector (the last two yield to Monaco).
 */
function useShellShortcuts() {
  const togglePlay = useTransportStore((state) => state.togglePlay)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null

      if (e.ctrlKey || e.metaKey) {
        const key = typeof e.key === "string" ? e.key.toLowerCase() : ""
        const layout = useLayoutStore.getState()
        if (key === "b") {
          e.preventDefault()
          layout.toggleLeftSidebar()
        } else if ((key === "j" || key === "i") && !target?.closest?.(EDITOR_SELECTOR)) {
          e.preventDefault()
          if (key === "j") layout.toggleConsole()
          else layout.toggleRightInspector()
        }
        return
      }

      if (e.code === "Space") {
        if (!target || e.repeat) return
        const tagName = target.tagName.toLowerCase()
        if (tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable || target.closest(SPACE_IGNORE_SELECTOR)) {
          return
        }
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [togglePlay])
}

// Compact FPS readout, throttled; shows "Paused" instead of a stale number while stopped.
const TelemetryBadge = memo(function TelemetryBadge() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const isPlaying = useTransportStore((state) => state.isPlaying)

  useEffect(() => {
    let lastUpdate = 0
    return renderCoordinator.onMetrics((latest) => {
      const now = performance.now()
      if (now - lastUpdate >= 250) {
        lastUpdate = now
        setMetrics(latest)
      }
    })
  }, [])

  const fps = metrics ? Math.round(metrics.fps) : 60

  return (
    <div data-testid="toolbar-telemetry" title="Rendering frame rate" className="flex h-8 items-center gap-1.5 px-1 text-xs text-fg-muted select-none">
      {isPlaying ? (
        <>
          <span aria-hidden className={cn("size-1.5 rounded-full", fps >= 55 ? "bg-success" : fps >= 30 ? "bg-warning" : "bg-danger")} />
          <span>
            <span className="num text-fg">{fps}</span> FPS
          </span>
        </>
      ) : (
        <span>Paused</span>
      )}
    </div>
  )
})

// Transport: rewind, play/pause, time, scrubber (reads the throttled ~10Hz transport mirror).
const TimelineScrubber = memo(function TimelineScrubber() {
  const isPlaying = useTransportStore((state) => state.isPlaying)
  const playbackTime = useTransportStore((state) => state.playbackTime)
  const duration = useTransportStore((state) => state.duration)
  const togglePlay = useTransportStore((state) => state.togglePlay)
  const seek = useTransportStore((state) => state.seek)
  const resetTime = useTransportStore((state) => state.resetTime)

  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const val = values[0] ?? 0
      setIsScrubbing(true)
      setScrubValue(val)
      seek(val)
    },
    [seek],
  )

  const handleSliderCommit = useCallback(
    (values: number[]) => {
      setIsScrubbing(false)
      seek(values[0] ?? 0)
    },
    [seek],
  )

  const displayTime = isScrubbing ? scrubValue : playbackTime

  return (
    <div role="group" aria-label="Transport" className="flex items-center gap-1">
      <TipIconButton label="Rewind to start" side="bottom" onClick={resetTime}>
        <RotateCcw />
      </TipIconButton>
      <TipIconButton label={isPlaying ? "Pause" : "Play"} keys={["Space"]} side="bottom" onClick={togglePlay} aria-pressed={isPlaying}>
        {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </TipIconButton>

      <span data-testid="playback-time-counter" className="num min-w-14 px-1 text-center text-xs text-fg select-none">
        {formatTime(displayTime)}
      </span>

      <div className="flex w-24 items-center xl:w-40">
        <Slider
          min={0}
          max={duration > 0 ? duration : 300}
          step={0.05}
          value={[displayTime]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          aria-label="Timeline Scrub Slider"
        />
      </div>

      <span className="num hidden text-2xs text-fg-subtle select-none xl:inline">/ {formatTime(duration)}</span>
    </div>
  )
})

const ResolutionScaleSelector = memo(function ResolutionScaleSelector() {
  const resolutionScale = useTransportStore((state) => state.resolutionScale)
  const setResolutionScale = useTransportStore((state) => state.setResolutionScale)

  return (
    <div data-testid="resolution-scale-selector">
      <Segmented
        aria-label="Resolution"
        value={String(resolutionScale)}
        onValueChange={(v) => setResolutionScale((v === "native" ? "native" : Number(v)) as ResolutionScale)}
        options={RESOLUTION_OPTIONS}
      />
    </div>
  )
})

const BackendSelector = memo(function BackendSelector() {
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)

  return (
    <div data-testid="backend-selector-segmented">
      <Segmented aria-label="Render backend" value={activeBackend} onValueChange={setActiveBackend} options={BACKEND_OPTIONS} />
    </div>
  )
})

const ThemeToggle = memo(function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const isDark = (resolvedTheme || theme || "dark") === "dark"
  return (
    <TipIconButton label={isDark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? <Sun /> : <Moon />}
    </TipIconButton>
  )
})

/** Icon-only below 2xl (labels would overflow 1280px); always labelled for assistive tech. */
function BarButton({ label, onClick, pressed, variant = "ghost", icon, tipKeys, "data-testid": testId }: { label: string; onClick: () => void; pressed?: boolean; variant?: "ghost" | "secondary" | "primary"; icon: React.ReactNode; tipKeys?: string[]; "data-testid"?: string }) {
  return (
    <ShortcutTip label={label} keys={tipKeys} side="bottom-end">
      <Button size="sm" variant={variant} aria-label={label} aria-pressed={pressed} onClick={onClick} data-testid={testId} className={cn("2xl:px-3", pressed && "bg-active text-fg")}>
        {icon}
        <span className="hidden 2xl:inline">{label}</span>
      </Button>
    </ShortcutTip>
  )
}

export function Toolbar({ onOpenExport }: { onOpenExport?: () => void }) {
  const hasUnsavedChanges = useProjectStore((state) => state.hasUnsavedChanges)
  const currentProjectName = useProjectStore((state) => state.currentProjectName)
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const activeTab = useLayoutStore((state) => state.activeActivityTab)
  const isInspectorOpen = useLayoutStore((state) => state.isRightInspectorOpen)
  const toggleLeftSidebar = useLayoutStore((state) => state.toggleLeftSidebar)
  const toggleRightInspector = useLayoutStore((state) => state.toggleRightInspector)
  const openActivityTab = useLayoutStore((state) => state.openActivityTab)
  const focusCopilot = useLayoutStore((state) => state.focusCopilot)

  useShellShortcuts()

  return (
    <header className="z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3 select-none">
      {/* Project */}
      <div className="flex min-w-0 items-center gap-3">
        <TipIconButton
          label={isLeftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          keys={["Ctrl", "B"]}
          side="bottom-start"
          data-testid="toolbar-sidebar-toggle"
          aria-controls="left-sidebar-dock"
          aria-expanded={isLeftSidebarOpen}
          onClick={toggleLeftSidebar}
          className={cn(isLeftSidebarOpen && "text-fg")}
        >
          <PanelLeft />
        </TipIconButton>

        <div className="flex min-w-0 items-center gap-2">
          <h1 className="hidden shrink-0 text-sm font-semibold text-fg md:block">ShaderStudio</h1>
          <span aria-hidden className="hidden text-fg-disabled md:inline">
            /
          </span>
          <span className="max-w-40 truncate text-sm text-fg-muted">{currentProjectName || "Untitled"}</span>
          {hasUnsavedChanges && <span role="img" aria-label="Unsaved changes" title="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-brand" />}
        </div>

        <BackendSelector />
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3">
        <TimelineScrubber />
        <Separator orientation="vertical" className="hidden h-5 lg:block" />
        <div className="hidden lg:block">
          <ResolutionScaleSelector />
        </div>
        <div className="hidden lg:block">
          <TelemetryBadge />
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <BarButton label="Templates" icon={<LayoutTemplate />} pressed={isLeftSidebarOpen && activeTab === "templates"} onClick={() => openActivityTab("templates")} />
        <BarButton label="Copilot" icon={<Sparkles />} pressed={isLeftSidebarOpen && activeTab === "copilot"} onClick={focusCopilot} />
        {onOpenExport && <BarButton label="Export" variant="primary" icon={<Download />} onClick={onOpenExport} />}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <TipIconButton
          label={isInspectorOpen ? "Hide inspector" : "Show inspector"}
          keys={["Ctrl", "I"]}
          aria-controls="inspector-panel"
          aria-expanded={isInspectorOpen}
          onClick={toggleRightInspector}
          className={cn(isInspectorOpen && "text-fg")}
        >
          <PanelRight />
        </TipIconButton>
        <ThemeToggle />
      </div>
    </header>
  )
}
