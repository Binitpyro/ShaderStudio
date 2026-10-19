import { useState, useEffect, useCallback, memo } from "react"
import { useTheme } from "@/components/theme-provider"
import { useProjectStore, type BackendType } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { useTransportStore, type ResolutionScale, formatTime } from "@/stores/transportStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { renderCoordinator, type PerformanceMetrics } from "@/core/renderCoordinator"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Code2,
  Palette,
  Sun,
  Moon,
  Layers,
  Cpu,
  Monitor,
  PanelLeft,
} from "lucide-react"

const BACKEND_OPTIONS: { value: BackendType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "webgpu", label: "WebGPU", icon: Cpu },
  { value: "webgl2", label: "WebGL2", icon: Layers },
  { value: "threejs", label: "Three.js", icon: Monitor },
]

const RESOLUTION_SCALES: { value: ResolutionScale; label: string }[] = [
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: "native", label: "Native" },
]

// ----------------------------------------------------------------------------
// Telemetry Badge Component (Throttled real-time FPS & GPU Frame Time)
// ----------------------------------------------------------------------------
const TelemetryBadge = memo(function TelemetryBadge() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)

  useEffect(() => {
    let lastUpdate = 0
    const unsubscribe = renderCoordinator.onMetrics((latest) => {
      const now = performance.now()
      if (now - lastUpdate >= 120) {
        lastUpdate = now
        setMetrics(latest)
      }
    })
    return unsubscribe
  }, [])

  const fps = metrics ? Math.round(metrics.fps) : 60
  const frameTime = metrics ? metrics.frameTimeMs : 16.6

  return (
    <div
      data-testid="toolbar-telemetry"
      title="Real-time GPU Rendering Telemetry"
      className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/60 border border-border/50 font-mono text-[11px] select-none"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-colors",
          fps >= 55 ? "bg-emerald-400" : fps >= 30 ? "bg-amber-400" : "bg-rose-500 animate-pulse"
        )}
      />
      <span className="font-semibold text-foreground">{fps} FPS</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="text-muted-foreground">{frameTime.toFixed(1)}ms</span>
    </div>
  )
})

// ----------------------------------------------------------------------------
// Timeline Scrubber Sub-Component (Isolated 60 FPS Re-rendering)
// ----------------------------------------------------------------------------
const TimelineScrubber = memo(function TimelineScrubber() {
  const isPlaying = useTransportStore((state) => state.isPlaying)
  const playbackTime = useTransportStore((state) => state.playbackTime)
  const duration = useTransportStore((state) => state.duration)
  const togglePlay = useTransportStore((state) => state.togglePlay)
  const seek = useTransportStore((state) => state.seek)
  const resetTime = useTransportStore((state) => state.resetTime)

  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(playbackTime)

  // Keep scrubValue synced with playbackTime when not actively dragging
  useEffect(() => {
    if (!isScrubbing) {
      setScrubValue(playbackTime)
    }
  }, [playbackTime, isScrubbing])

  const handleSliderChange = useCallback((values: number[]) => {
    const val = values[0] ?? 0
    setIsScrubbing(true)
    setScrubValue(val)
    seek(val)
  }, [seek])

  const handleSliderCommit = useCallback((values: number[]) => {
    const val = values[0] ?? 0
    setIsScrubbing(false)
    seek(val)
  }, [seek])

  const displayTime = isScrubbing ? scrubValue : playbackTime

  return (
    <div className="flex items-center gap-2">
      {/* Rewind (t=0) Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={resetTime}
        title="Rewind to start (t=0)"
        aria-label="Rewind to start (t=0)"
        className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      {/* Play / Pause Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "Pause" : "Play"}
        className={cn(
          "h-7 w-7 rounded cursor-pointer transition-colors",
          isPlaying
            ? "text-primary hover:bg-primary/10"
            : "text-foreground bg-accent/60 hover:bg-accent"
        )}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
        )}
      </Button>

      {/* Live Digital Time Counter */}
      <span
        data-testid="playback-time-counter"
        className="font-mono text-xs tabular-nums text-foreground font-medium min-w-[54px] text-center select-none"
      >
        {formatTime(displayTime)}
      </span>

      {/* Interactive Scrub Slider */}
      <div className="w-24 sm:w-32 md:w-44 flex items-center">
        <Slider
          min={0}
          max={duration > 0 ? duration : 300}
          step={0.05}
          value={[displayTime]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          aria-label="Timeline Scrub Slider"
          className="cursor-pointer"
        />
      </div>

      {/* Duration Label */}
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 hidden sm:inline select-none">
        / {formatTime(duration)}
      </span>
    </div>
  )
})

// ----------------------------------------------------------------------------
// Resolution Scaling Pills Selector
// ----------------------------------------------------------------------------
const ResolutionScaleSelector = memo(function ResolutionScaleSelector() {
  const resolutionScale = useTransportStore((state) => state.resolutionScale)
  const setResolutionScale = useTransportStore((state) => state.setResolutionScale)

  return (
    <div
      data-testid="resolution-scale-selector"
      className="flex items-center rounded-md bg-muted/50 p-0.5 border border-border/40 select-none"
    >
      {RESOLUTION_SCALES.map((scale) => {
        const isActive = resolutionScale === scale.value
        return (
          <button
            key={String(scale.value)}
            type="button"
            onClick={() => setResolutionScale(scale.value)}
            title={`Set canvas resolution to ${scale.label}`}
            aria-label={`Resolution ${scale.label}`}
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-mono rounded font-medium transition-all cursor-pointer",
              isActive
                ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {scale.label}
          </button>
        )
      })}
    </div>
  )
})

// ----------------------------------------------------------------------------
// Segmented Backend Selector with Badge Styling
// ----------------------------------------------------------------------------
const BackendSelector = memo(function BackendSelector() {
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)

  return (
    <div
      data-testid="backend-selector-segmented"
      className="flex items-center rounded-md bg-muted/50 p-0.5 border border-border/40 select-none"
    >
      {BACKEND_OPTIONS.map((opt) => {
        const isActive = activeBackend === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setActiveBackend(opt.value)}
            title={`Switch to ${opt.label} backend`}
            aria-label={`Switch to ${opt.label}`}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer",
              isActive
                ? opt.value === "webgpu"
                  ? "bg-indigo-600 text-white font-semibold shadow-xs"
                  : opt.value === "webgl2"
                  ? "bg-amber-600 text-white font-semibold shadow-xs"
                  : "bg-sky-600 text-white font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
})

// ----------------------------------------------------------------------------
// Theme Toggle Button (Sun/Moon)
// ----------------------------------------------------------------------------
const ThemeToggle = memo(function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentTheme = mounted ? theme : "dark"
  const isDark = currentTheme === "dark"

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label="Toggle theme"
      className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
    >
      {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-slate-700" />}
    </Button>
  )
})

// ----------------------------------------------------------------------------
// Main Full Studio Transport Toolbar
// ----------------------------------------------------------------------------
export function Toolbar({
  isCopilotOpen,
  onToggleCopilot,
  onOpenExport,
  onOpenTemplates,
}: {
  isCopilotOpen?: boolean
  onToggleCopilot?: () => void
  onOpenExport?: () => void
  onOpenTemplates?: () => void
}) {
  const autoCompile = useProjectStore((state) => state.autoCompile)
  const setAutoCompile = useProjectStore((state) => state.setAutoCompile)
  const hasUnsavedChanges = useProjectStore((state) => state.hasUnsavedChanges)
  const currentProjectName = useProjectStore((state) => state.currentProjectName)
  const bridgeConnected = useFileSystemStore((state) => state.bridgeConnected)
  const togglePlay = useTransportStore((state) => state.togglePlay)
  const isLeftSidebarOpen = useLayoutStore((state) => state.isLeftSidebarOpen)
  const toggleLeftSidebar = useLayoutStore((state) => state.toggleLeftSidebar)

  // Global shortcuts: Space for Play/Pause, Ctrl+B / Cmd+B for Primary Sidebar Toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+B or Cmd+B to toggle Primary Sidebar
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault()
        toggleLeftSidebar()
        return
      }

      if (e.code === "Space") {
        const target = e.target as HTMLElement | null
        if (!target) return
        const tagName = target.tagName.toLowerCase()
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          target.isContentEditable ||
          target.closest(".monaco-editor")
        ) {
          return
        }
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [togglePlay, toggleLeftSidebar])

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card/95 px-3 select-none z-20 gap-2">
      {/* ------------------------------------------------------------------ */}
      {/* Left Zone: Sidebar Toggle, Brand & Backend Selector                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLeftSidebar}
          data-testid="toolbar-sidebar-toggle"
          title={isLeftSidebarOpen ? "Collapse Primary Sidebar (Ctrl+B)" : "Expand Primary Sidebar (Ctrl+B)"}
          aria-label={isLeftSidebarOpen ? "Collapse Primary Sidebar" : "Expand Primary Sidebar"}
          aria-controls="left-sidebar-dock"
          aria-expanded={isLeftSidebarOpen}
          className={cn(
            "h-7 w-7 transition-colors cursor-pointer",
            isLeftSidebarOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              bridgeConnected ? "bg-green-500 animate-pulse" : "bg-primary"
            )}
            title={bridgeConnected ? "Bridge server connected" : "Bridge server offline"}
          />
          <h1 className="text-xs font-bold tracking-tight text-foreground flex items-center gap-1">
            <span className="text-primary font-mono">&lt;/&gt;</span>
            <span className="hidden sm:inline">ShaderStudio</span>
          </h1>
          {currentProjectName && (
            <span className="text-[11px] text-muted-foreground/80 font-mono hidden md:inline truncate max-w-[120px]">
              - {currentProjectName}
            </span>
          )}
          {hasUnsavedChanges && <span className="text-xs text-primary font-bold">*</span>}
        </div>

        <span className="text-border">|</span>

        {/* Segmented Backend Selector */}
        <BackendSelector />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Center Zone: Studio Playback Controls & Scrubber & Resolution       */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center gap-3">
        {/* Playback Controls & Scrubber */}
        <TimelineScrubber />

        <span className="text-border hidden md:inline">|</span>

        {/* Canvas Resolution Scaling */}
        <div className="hidden md:flex items-center">
          <ResolutionScaleSelector />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right Zone: Telemetry, Auto-compile, Actions & Theme Toggle        */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real-time FPS & GPU Frame Time */}
        <div className="hidden lg:block">
          <TelemetryBadge />
        </div>

        <span className="text-border hidden lg:inline">|</span>

        {/* Auto-compile switch */}
        <div className="flex items-center gap-1.5">
          <Switch
            id="auto-compile"
            checked={autoCompile}
            onCheckedChange={setAutoCompile}
            className="scale-90"
          />
          <Label
            htmlFor="auto-compile"
            className="text-[11px] text-muted-foreground cursor-pointer hidden xl:inline"
          >
            Auto-compile
          </Label>
        </div>

        {/* Action Buttons: Templates, Export, Copilot */}
        {onOpenTemplates && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenTemplates}
            title="Open Shader Templates"
            className="h-7 gap-1 px-2 text-xs font-medium border-border hover:border-primary/60 transition-all cursor-pointer"
          >
            <Palette className="h-3.5 w-3.5 text-foreground" />
            <span className="hidden sm:inline">Templates</span>
          </Button>
        )}

        {onOpenExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenExport}
            title="Export Shaders & ZIP"
            className="h-7 gap-1 px-2 text-xs font-medium border-border hover:border-primary/60 transition-all cursor-pointer"
          >
            <Code2 className="h-3.5 w-3.5 text-foreground" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        )}

        {onToggleCopilot && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleCopilot}
            title="Toggle AI Shader Copilot"
            className={cn(
              "h-7 gap-1 px-2 text-xs font-medium border-primary/40 hover:border-primary transition-all cursor-pointer",
              isCopilotOpen && "bg-primary/10 border-primary text-primary"
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">AI Copilot</span>
          </Button>
        )}

        <span className="text-border">|</span>

        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}
