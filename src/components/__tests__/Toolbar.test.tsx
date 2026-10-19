import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Toolbar } from "../Toolbar"
import { useProjectStore } from "@/stores/projectStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { useTransportStore } from "@/stores/transportStore"
import { useLayoutStore } from "@/stores/layoutStore"

// Mock next-themes
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

describe("Toolbar Component (Requirement R2)", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useFileSystemStore.setState({ bridgeConnected: true })
    useLayoutStore.setState({ isLeftSidebarOpen: true })
    useTransportStore.setState({
      isPlaying: true,
      playbackTime: 5.32,
      duration: 300.0,
      resolutionScale: 1,
    })
  })

  it("renders primary sidebar toggle button with Ctrl+B shortcut and ARIA attributes", () => {
    useLayoutStore.setState({ isLeftSidebarOpen: true })
    let html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("data-testid=\"toolbar-sidebar-toggle\"")
    expect(html).toContain("aria-controls=\"left-sidebar-dock\"")
    expect(html).toContain("aria-expanded=\"true\"")
    expect(html).toContain("aria-label=\"Collapse Primary Sidebar\"")
    expect(html).toContain("Collapse Primary Sidebar (Ctrl+B)")

    useLayoutStore.setState({ isLeftSidebarOpen: false })
    html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("aria-expanded=\"false\"")
    expect(html).toContain("aria-label=\"Expand Primary Sidebar\"")
    expect(html).toContain("Expand Primary Sidebar (Ctrl+B)")
  })

  it("renders studio brand title and bridge connection status", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("ShaderStudio")
    expect(html).toContain("Bridge server connected")
  })

  it("renders segmented backend selector buttons (WebGPU, WebGL2, Three.js)", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("data-testid=\"backend-selector-segmented\"")
    expect(html).toContain("WebGPU")
    expect(html).toContain("WebGL2")
    expect(html).toContain("Three.js")
  })

  it("renders playback transport controls: Rewind (t=0), Play/Pause, and digital counter", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("Rewind to start (t=0)")
    expect(html).toContain("Pause (Space)")
    expect(html).toContain("data-testid=\"playback-time-counter\"")
    expect(html).toContain("00:05.32")
    expect(html).toContain("/ 05:00.00")
  })

  it("renders interactive scrub slider for timeline navigation", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("aria-label=\"Timeline Scrub Slider\"")
  })

  it("renders canvas resolution scaling selector with 0.5x, 1x, 2x, Native pills", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("data-testid=\"resolution-scale-selector\"")
    expect(html).toContain("0.5x")
    expect(html).toContain("1x")
    expect(html).toContain("2x")
    expect(html).toContain("Native")
  })

  it("renders real-time telemetry badge", () => {
    const html = renderToStaticMarkup(<Toolbar />)
    expect(html).toContain("data-testid=\"toolbar-telemetry\"")
    expect(html).toContain("FPS")
  })

  it("renders auto-compile switch, quick actions, and theme toggle", () => {
    const onOpenExport = vi.fn()
    const onOpenTemplates = vi.fn()
    const onToggleCopilot = vi.fn()

    const html = renderToStaticMarkup(
      <Toolbar
        onOpenExport={onOpenExport}
        onOpenTemplates={onOpenTemplates}
        onToggleCopilot={onToggleCopilot}
        isCopilotOpen={true}
      />
    )

    expect(html).toContain("Auto-compile")
    expect(html).toContain("Templates")
    expect(html).toContain("Export")
    expect(html).toContain("AI Copilot")
    expect(html).toContain("Toggle theme")
  })

  it("switches active backend in projectStore", () => {
    useProjectStore.getState().setActiveBackend("webgl2")
    expect(useProjectStore.getState().activeBackend).toBe("webgl2")

    useProjectStore.getState().setActiveBackend("threejs")
    expect(useProjectStore.getState().activeBackend).toBe("threejs")

    useProjectStore.getState().setActiveBackend("webgpu")
    expect(useProjectStore.getState().activeBackend).toBe("webgpu")
  })

  it("updates resolution scale in transportStore", () => {
    useTransportStore.getState().setResolutionScale(0.5)
    expect(useTransportStore.getState().resolutionScale).toBe(0.5)

    useTransportStore.getState().setResolutionScale(2)
    expect(useTransportStore.getState().resolutionScale).toBe(2)

    useTransportStore.getState().setResolutionScale("native")
    expect(useTransportStore.getState().resolutionScale).toBe("native")
  })

  it("toggles play/pause state in transportStore", () => {
    expect(useTransportStore.getState().isPlaying).toBe(true)

    useTransportStore.getState().togglePlay()
    expect(useTransportStore.getState().isPlaying).toBe(false)

    useTransportStore.getState().togglePlay()
    expect(useTransportStore.getState().isPlaying).toBe(true)
  })

  it("resets playback time to 00:00.00 via resetTime", () => {
    useTransportStore.getState().seek(45.2)
    expect(useTransportStore.getState().playbackTime).toBe(45.2)

    useTransportStore.getState().resetTime()
    expect(useTransportStore.getState().playbackTime).toBe(0.0)
    expect(useTransportStore.getState().getFormattedTime()).toBe("00:00.00")
  })
})
