/**
 * UI/UX Creative Workstation Overhaul — Authoritative E2E Test Harness
 *
 * Implements authoritative contract validators and reference state engines
 * for requirements R1-R4 specified in PROJECT.md and ORIGINAL_REQUEST.md:
 * - R1: Activity Bar, Sliding Sidebars, Center Stage Split/Maximize, Status Bar & Layout State
 * - R2: Studio Transport Controls, Virtual Playback Clock, Resolution Scaling & Telemetry
 * - R3: Parameter Inspector 5 Accordions, Search/Filter, Per-Uniform Reset, Defaults & Presets
 * - R4: Monaco Multi-Tabs, Marker Isolation, Top Action Bar, Console Drawer & Jump-to-Line
 */

import { vi } from "vitest"
import { useProjectStore, type BackendType, type UniformValue, type ParsedUniform } from "@/stores/projectStore"

// ============================================================================
// 1. Layout Contracts & State Machine (R1)
// ============================================================================

export type ActivityTab = "graph" | "project" | "templates" | "copilot"
export type SplitOrientation = "vertical" | "horizontal"
export type MaximizedPanel = "none" | "viewport" | "editor"

export interface JumpTarget {
  line: number
  column?: number
  timestamp: number
}

export interface LayoutStateContract {
  activeActivityTab: ActivityTab | null
  isLeftSidebarOpen: boolean
  toggleActivityTab: (tab: ActivityTab) => void
  setLeftSidebarOpen: (open: boolean) => void

  isRightInspectorOpen: boolean
  toggleRightInspector: () => void
  setRightInspectorOpen: (open: boolean) => void

  isConsoleOpen: boolean
  toggleConsole: () => void
  setConsoleOpen: (open: boolean) => void

  splitOrientation: SplitOrientation
  toggleSplitOrientation: () => void

  maximizedPanel: MaximizedPanel
  setMaximizedPanel: (panel: MaximizedPanel) => void
  toggleMaximizeViewport: () => void
  toggleMaximizeEditor: () => void

  editorMinimap: boolean
  toggleEditorMinimap: () => void

  jumpTarget: JumpTarget | null
  jumpToLine: (line: number, column?: number) => void
}

export class LayoutHarness implements LayoutStateContract {
  activeActivityTab: ActivityTab | null = null
  isLeftSidebarOpen = false
  isRightInspectorOpen = true
  isConsoleOpen = false
  splitOrientation: SplitOrientation = "vertical"
  maximizedPanel: MaximizedPanel = "none"
  editorMinimap = true
  jumpTarget: JumpTarget | null = null

  // Dimension properties for layout testing (assumes 1920x1080 default workstation)
  totalWidth = 1920
  totalHeight = 1080
  activityRailWidth = 48
  sidebarExpandedWidth = 260
  inspectorExpandedWidth = 320
  consoleExpandedHeight = 180
  statusBarHeight = 28
  toolbarHeight = 44

  // Split ratio for center stage (0.0 to 1.0, default 0.6 Viewport / 0.4 Editor)
  centerSplitRatio = 0.6

  toggleActivityTab(tab: ActivityTab): void {
    if (this.activeActivityTab === tab && this.isLeftSidebarOpen) {
      // Re-clicking active tab collapses sidebar to 0px
      this.isLeftSidebarOpen = false
      this.activeActivityTab = null
    } else {
      this.activeActivityTab = tab
      this.isLeftSidebarOpen = true
    }
  }

  setLeftSidebarOpen(open: boolean): void {
    this.isLeftSidebarOpen = open
    if (!open) {
      this.activeActivityTab = null
    }
  }

  toggleRightInspector(): void {
    this.isRightInspectorOpen = !this.isRightInspectorOpen
  }

  setRightInspectorOpen(open: boolean): void {
    this.isRightInspectorOpen = open
  }

  toggleConsole(): void {
    this.isConsoleOpen = !this.isConsoleOpen
  }

  setConsoleOpen(open: boolean): void {
    this.isConsoleOpen = open
  }

  toggleSplitOrientation(): void {
    this.splitOrientation = this.splitOrientation === "vertical" ? "horizontal" : "vertical"
  }

  setMaximizedPanel(panel: MaximizedPanel): void {
    this.maximizedPanel = panel
  }

  toggleMaximizeViewport(): void {
    this.maximizedPanel = this.maximizedPanel === "viewport" ? "none" : "viewport"
  }

  toggleMaximizeEditor(): void {
    this.maximizedPanel = this.maximizedPanel === "editor" ? "none" : "editor"
  }

  toggleEditorMinimap(): void {
    this.editorMinimap = !this.editorMinimap
  }

  jumpToLine(line: number, column = 1): void {
    // Clamping: line numbers must be >= 1, columns >= 1
    const clampedLine = Math.max(1, Math.floor(line))
    const clampedColumn = Math.max(1, Math.floor(column))

    // If viewport is maximized, un-maximize so editor is visible
    if (this.maximizedPanel === "viewport") {
      this.maximizedPanel = "none"
    }

    this.jumpTarget = {
      line: clampedLine,
      column: clampedColumn,
      timestamp: Date.now(),
    }
  }

  /**
   * Computed horizontal widths for responsive layout verification
   */
  getEffectiveLeftSidebarWidth(): number {
    return this.isLeftSidebarOpen ? this.sidebarExpandedWidth : 0
  }

  getEffectiveRightInspectorWidth(): number {
    return this.isRightInspectorOpen ? this.inspectorExpandedWidth : 0
  }

  getEffectiveCenterStageWidth(): number {
    return (
      this.totalWidth -
      this.activityRailWidth -
      this.getEffectiveLeftSidebarWidth() -
      this.getEffectiveRightInspectorWidth()
    )
  }

  getEffectiveCenterStageHeight(): number {
    const bottomDrawerHeight = this.isConsoleOpen ? this.consoleExpandedHeight : 0
    return this.totalHeight - this.toolbarHeight - this.statusBarHeight - bottomDrawerHeight
  }

  getViewportDimensions(): { width: number; height: number } {
    const centerW = this.getEffectiveCenterStageWidth()
    const centerH = this.getEffectiveCenterStageHeight()

    if (this.maximizedPanel === "viewport") {
      return { width: centerW, height: centerH }
    }
    if (this.maximizedPanel === "editor") {
      return { width: 0, height: 0 }
    }

    if (this.splitOrientation === "vertical") {
      // Side-by-side: viewport gets split ratio of width
      return {
        width: Math.round(centerW * this.centerSplitRatio),
        height: centerH,
      }
    } else {
      // Stacked top/bottom: viewport gets split ratio of height
      return {
        width: centerW,
        height: Math.round(centerH * this.centerSplitRatio),
      }
    }
  }

  getEditorDimensions(): { width: number; height: number } {
    const centerW = this.getEffectiveCenterStageWidth()
    const centerH = this.getEffectiveCenterStageHeight()

    if (this.maximizedPanel === "editor") {
      return { width: centerW, height: centerH }
    }
    if (this.maximizedPanel === "viewport") {
      return { width: 0, height: 0 }
    }

    if (this.splitOrientation === "vertical") {
      return {
        width: Math.round(centerW * (1.0 - this.centerSplitRatio)),
        height: centerH,
      }
    } else {
      return {
        width: centerW,
        height: Math.round(centerH * (1.0 - this.centerSplitRatio)),
      }
    }
  }
}

// ============================================================================
// 2. Transport & Virtual Playback Contracts (R2)
// ============================================================================

export type ResolutionScale = 0.5 | 1 | 2 | "native"

export interface TransportMetrics {
  fps: number
  frameTimeMs: number
  activeCallbacks: number
  currentTime: number
  isPlaying: boolean
  resolutionScale: ResolutionScale
}

export interface TransportStateContract {
  isPlaying: boolean
  currentTime: number
  duration: number
  resolutionScale: ResolutionScale
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  resetTime: () => void
  setResolutionScale: (scale: ResolutionScale) => void
}

export class TransportHarness implements TransportStateContract {
  isPlaying = true
  currentTime = 0.0
  duration = 300.0
  resolutionScale: ResolutionScale = 1

  // Virtual clock decoupled from performance.now()
  private metricsSubscribers = new Set<(metrics: TransportMetrics) => void>()
  private renderFrameSubscribers = new Set<(time: number, isSeek: boolean) => void>()
  private singleFrameRenderCount = 0

  setIsPlaying(playing: boolean): void {
    this.isPlaying = playing
  }

  setCurrentTime(time: number): void {
    // Clamping boundaries [0.0, duration]
    this.currentTime = Math.max(0.0, Math.min(time, this.duration))
  }

  resetTime(): void {
    this.currentTime = 0.0
    // Immediate canvas redraw notification for reset (t=0)
    this.broadcastRender(0.0, true)
  }

  setResolutionScale(scale: ResolutionScale): void {
    // Valid values validation
    if (scale === 0.5 || scale === 1 || scale === 2 || scale === "native") {
      this.resolutionScale = scale
    } else {
      // Fallback/clamping for unexpected inputs
      const numeric = Number(scale)
      if (numeric <= 0.5) this.resolutionScale = 0.5
      else if (numeric >= 2.0) this.resolutionScale = 2
      else this.resolutionScale = 1
    }
  }

  /**
   * Advances the virtual playback clock when playing
   */
  tick(deltaMs: number): void {
    if (this.isPlaying) {
      const deltaSec = deltaMs / 1000
      this.currentTime += deltaSec
      if (this.duration > 0 && this.currentTime > this.duration) {
        // Loop playback
        this.currentTime = this.currentTime % this.duration
      }
      this.broadcastRender(this.currentTime, false)
    }

    const fps = deltaMs > 0 ? Math.round(1000 / deltaMs) : 60
    this.broadcastMetrics({
      fps,
      frameTimeMs: Number(deltaMs.toFixed(2)),
      activeCallbacks: 1,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      resolutionScale: this.resolutionScale,
    })
  }

  /**
   * Interactive timeline scrub: moves playhead and forces synchronous redraw even if paused
   */
  seek(timeSeconds: number): void {
    this.setCurrentTime(timeSeconds)
    // Synchronous single-frame redraw when scrubbing
    this.singleFrameRenderCount++
    this.broadcastRender(this.currentTime, true)
  }

  /**
   * Calculates effective device pixel ratio multiplier based on display DPR and scale setting
   */
  getEffectiveDpr(hostDpr = 1.0): number {
    if (this.resolutionScale === "native") {
      // Clamped to 2.0 for 4K/Retina GPU buffer safety
      return Math.min(hostDpr, 2.0)
    }
    const targetScale = typeof this.resolutionScale === "number" ? this.resolutionScale : 1.0
    return Math.min(targetScale, 2.0)
  }

  /**
   * Formats current time into digital display MM:SS.ss
   */
  getFormattedTime(): string {
    const mins = Math.floor(this.currentTime / 60)
    const secs = this.currentTime % 60
    const minsStr = String(mins).padStart(2, "0")
    const secsStr = secs.toFixed(2).padStart(5, "0")
    return `${minsStr}:${secsStr}`
  }

  onRenderFrame(fn: (time: number, isSeek: boolean) => void): () => void {
    this.renderFrameSubscribers.add(fn)
    return () => this.renderFrameSubscribers.delete(fn)
  }

  onMetrics(fn: (metrics: TransportMetrics) => void): () => void {
    this.metricsSubscribers.add(fn)
    return () => this.metricsSubscribers.delete(fn)
  }

  private broadcastRender(time: number, isSeek: boolean): void {
    for (const sub of this.renderFrameSubscribers) {
      sub(time, isSeek)
    }
  }

  private broadcastMetrics(metrics: TransportMetrics): void {
    for (const sub of this.metricsSubscribers) {
      sub(metrics)
    }
  }

  getSingleFrameRenderCount(): number {
    return this.singleFrameRenderCount
  }
}

// ============================================================================
// 3. Parameter Inspector Accordions Contracts (R3)
// ============================================================================

export type InspectorAccordionKey = "uniforms" | "environment" | "audio" | "compute" | "variations"

export interface EnvironmentSettingsModel {
  preset: "studio" | "sunset" | "cyberpunk" | "neutral"
  exposure: number
  rotation: number
  backgroundBlur: number
  showSkybox: boolean
}

export interface AudioDynamicsModel {
  vuMeters: { bass: number; mid: number; treble: number }
  gain: number
  smoothing: number
  reactiveBindings: Record<string, { band: "bass" | "mid" | "treble"; amount: number }>
}

export interface ComputeSimulationModel {
  speed: number
  gravity: number
  damping: number
  particleSize: number
  blendMode: "additive" | "alpha" | "screen"
  seed: number
}

export interface InspectorStateContract {
  openAccordions: Set<InspectorAccordionKey>
  toggleAccordion: (key: InspectorAccordionKey) => void
  isAccordionOpen: (key: InspectorAccordionKey) => boolean

  // Section 1: Uniforms & Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  getFilteredUniforms: (uniforms: ParsedUniform[]) => ParsedUniform[]
  resetUniformToDefault: (uniformName: string) => void
  resetAllUniformsToDefault: () => void

  // Section 2: Environment
  environment: EnvironmentSettingsModel
  setEnvironmentPreset: (preset: EnvironmentSettingsModel["preset"]) => void
  setEnvironmentExposure: (exp: number) => void

  // Section 3: Audio
  audio: AudioDynamicsModel
  setAudioGain: (gain: number) => void

  // Section 4: Compute
  compute: ComputeSimulationModel
  reseedComputeSimulation: () => void

  // Section 5: Variations
  saveVariation: (name: string) => string
  applyVariation: (id: string) => void
  deleteVariation: (id: string) => void
}

export class InspectorHarness implements InspectorStateContract {
  openAccordions = new Set<InspectorAccordionKey>(["uniforms", "environment"])
  searchQuery = ""

  // Reference storage for initial parsed defaults
  parsedDefaults: Record<string, UniformValue> = {}

  environment: EnvironmentSettingsModel = {
    preset: "studio",
    exposure: 1.0,
    rotation: 0.0,
    backgroundBlur: 0.2,
    showSkybox: false,
  }

  audio: AudioDynamicsModel = {
    vuMeters: { bass: 0.0, mid: 0.0, treble: 0.0 },
    gain: 1.0,
    smoothing: 0.8,
    reactiveBindings: {},
  }

  compute: ComputeSimulationModel = {
    speed: 1.0,
    gravity: 0.0,
    damping: 0.05,
    particleSize: 4.0,
    blendMode: "additive",
    seed: 1337,
  }

  toggleAccordion(key: InspectorAccordionKey): void {
    if (this.openAccordions.has(key)) {
      this.openAccordions.delete(key)
    } else {
      this.openAccordions.add(key)
    }
  }

  isAccordionOpen(key: InspectorAccordionKey): boolean {
    return this.openAccordions.has(key)
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query
  }

  getFilteredUniforms(uniforms: ParsedUniform[]): ParsedUniform[] {
    const trimmed = this.searchQuery.trim().toLowerCase()
    if (!trimmed) return [...uniforms]
    return uniforms.filter((u) => u.name.toLowerCase().includes(trimmed))
  }

  setParsedDefaults(defaults: Record<string, UniformValue>): void {
    this.parsedDefaults = JSON.parse(JSON.stringify(defaults))
  }

  resetUniformToDefault(uniformName: string): void {
    const defaultVal = this.parsedDefaults[uniformName]
    if (defaultVal) {
      useProjectStore.getState().setUniformValue(uniformName, JSON.parse(JSON.stringify(defaultVal)))
    }
  }

  resetAllUniformsToDefault(): void {
    for (const [name, defaultVal] of Object.entries(this.parsedDefaults)) {
      useProjectStore.getState().setUniformValue(name, JSON.parse(JSON.stringify(defaultVal)))
    }
  }

  setEnvironmentPreset(preset: EnvironmentSettingsModel["preset"]): void {
    this.environment.preset = preset
  }

  setEnvironmentExposure(exp: number): void {
    this.environment.exposure = Math.max(0.1, Math.min(exp, 5.0))
  }

  setAudioGain(gain: number): void {
    this.audio.gain = Math.max(0.0, Math.min(gain, 10.0))
  }

  reseedComputeSimulation(): void {
    this.compute.seed = Math.floor(Math.random() * 100000)
    useProjectStore.getState().triggerSimulationReset()
  }

  saveVariation(name: string): string {
    return useProjectStore.getState().addVariation(name)
  }

  applyVariation(id: string): void {
    useProjectStore.getState().applyVariation(id)
  }

  deleteVariation(id: string): void {
    useProjectStore.getState().deleteVariation(id)
  }
}

// ============================================================================
// 4. Monaco Multi-Tabs, Editor Actions & Console Drawer Contracts (R4)
// ============================================================================

export type ShaderEditorTab = "fragment" | "vertex" | "compute"

export interface DiagnosticItem {
  id: string
  tab: ShaderEditorTab
  severity: "error" | "warning"
  message: string
  line: number
  column?: number
}

export interface EditorConsoleContract {
  activeTab: ShaderEditorTab
  setActiveTab: (tab: ShaderEditorTab) => void
  sources: Record<ShaderEditorTab, string>
  setSource: (tab: ShaderEditorTab, code: string) => void

  // Editor Actions
  formatCode: () => void
  minimapEnabled: boolean
  toggleMinimap: () => void
  triggerRecompile: () => void
  recompileCount: number

  // Diagnostics & Console Drawer
  diagnostics: DiagnosticItem[]
  addDiagnostic: (item: Omit<DiagnosticItem, "id">) => string
  clearDiagnostics: () => void
  getActiveTabDiagnostics: () => DiagnosticItem[]
  getErrorCount: () => number
  getWarningCount: () => number
  clickToJump: (diagId: string, layout: LayoutHarness) => boolean
}

export class EditorConsoleHarness implements EditorConsoleContract {
  activeTab: ShaderEditorTab = "fragment"
  sources: Record<ShaderEditorTab, string> = {
    fragment: "// Fragment Shader Source\nvoid main() {\n  gl_FragColor = vec4(1.0);\n}\n",
    vertex: "// Vertex Shader Source\nvoid main() {\n  gl_Position = vec4(position, 1.0);\n}\n",
    compute: "// Compute Shader Source\n@compute @workgroup_size(64)\nfn main() {}\n",
  }
  minimapEnabled = true
  recompileCount = 0
  diagnostics: DiagnosticItem[] = []
  private diagCounter = 0

  setActiveTab(tab: ShaderEditorTab): void {
    this.activeTab = tab
  }

  setSource(tab: ShaderEditorTab, code: string): void {
    this.sources[tab] = code
  }

  formatCode(): void {
    // Reference Monaco document formatting: normalizes trailing whitespace and indents
    const current = this.sources[this.activeTab]
    const lines = current.split("\n").map((l) => l.trimEnd())
    this.sources[this.activeTab] = lines.join("\n")
  }

  toggleMinimap(): void {
    this.minimapEnabled = !this.minimapEnabled
  }

  triggerRecompile(): void {
    this.recompileCount++
    useProjectStore.getState().triggerRecompile()
  }

  addDiagnostic(item: Omit<DiagnosticItem, "id">): string {
    this.diagCounter++
    const id = `diag_${this.diagCounter}`
    this.diagnostics.push({
      ...item,
      id,
    })
    return id
  }

  clearDiagnostics(): void {
    this.diagnostics = []
    useProjectStore.getState().setLastCompileError(null)
  }

  /**
   * Active-tab compiler marker isolation (F-EDIT-02):
   * Monaco only renders markers for the currently focused tab model.
   */
  getActiveTabDiagnostics(): DiagnosticItem[] {
    return this.diagnostics.filter((d) => d.tab === this.activeTab)
  }

  getErrorCount(): number {
    return this.diagnostics.filter((d) => d.severity === "error").length
  }

  getWarningCount(): number {
    return this.diagnostics.filter((d) => d.severity === "warning").length
  }

  /**
   * Click-to-Jump (F-CONS-02):
   * Focuses the target tab, reveals line in editor, and un-maximizes Viewport if hidden.
   */
  clickToJump(diagId: string, layout: LayoutHarness): boolean {
    const diag = this.diagnostics.find((d) => d.id === diagId)
    if (!diag) return false

    // 1. Switch to affected editor tab
    this.activeTab = diag.tab

    // 2. Invoke layout store jumpToLine
    layout.jumpToLine(diag.line, diag.column || 1)

    return true
  }
}

// ============================================================================
// 5. Unified Creative Workstation Orchestrator
// ============================================================================

export class WorkstationHarness {
  layout: LayoutHarness
  transport: TransportHarness
  inspector: InspectorHarness
  editorConsole: EditorConsoleHarness

  constructor() {
    this.layout = new LayoutHarness()
    this.transport = new TransportHarness()
    this.inspector = new InspectorHarness()
    this.editorConsole = new EditorConsoleHarness()
  }

  resetAll(): void {
    this.layout = new LayoutHarness()
    this.transport = new TransportHarness()
    this.inspector = new InspectorHarness()
    this.editorConsole = new EditorConsoleHarness()
  }
}

export function createWorkstationHarness(): WorkstationHarness {
  return new WorkstationHarness()
}
