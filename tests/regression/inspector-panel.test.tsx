// @vitest-environment happy-dom
import "../setup/rtl"
/** Inspector panel + Environment/Audio/Compute/Variations sections (RTL). */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent, within, act } from "@testing-library/react"
import { ParameterPanel, INSPECTOR_SECTIONS_KEY } from "@/components/ParameterPanel"
import { EnvironmentSection, ENVIRONMENT_PRESET_TILES } from "@/components/inspector/EnvironmentSection"
import { AudioDynamicsSection } from "@/components/inspector/AudioDynamicsSection"
import { ComputeSimulationSection } from "@/components/inspector/ComputeSimulationSection"
import { VariationsSection } from "@/components/inspector/VariationsSection"
import { useProjectStore } from "@/stores/projectStore"
import { audioEngine } from "@/audio/audioEngine"
import { loadAdapter } from "@/adapters/activeAdapter"

const noAdapter = vi.hoisted(() => ({ on: false }))
vi.mock("@/adapters/activeAdapter", async (orig) => {
  const m = await orig<typeof import("@/adapters/activeAdapter")>()
  return { ...m, getActiveAdapter: () => (noAdapter.on ? null : m.getActiveAdapter()) }
})

const adapters: Record<string, any> = {}
beforeAll(async () => {
  adapters.webgpu = await loadAdapter("webgpu")
})

function typeInto(input: HTMLElement, value: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}
const computeStep = { id: "c1", name: "Sim", type: "compute", shaderSource: "" } as never

beforeEach(() => {
  localStorage.clear()
  useProjectStore.getState().resetProject()
  useProjectStore.setState({ activeBackend: "webgpu", audioBindings: {}, variations: [], activeVariationId: null, isAudioPlaying: false, selectedNodeId: null })
})
afterEach(() => {
  noAdapter.on = false
  vi.restoreAllMocks()
})

const sectionButtons = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"))
const expanded = (title: RegExp) => sectionButtons().find((b) => title.test(b.textContent ?? ""))!.getAttribute("aria-expanded")

describe("ParameterPanel", () => {
  it("renders the sections in order; Compute is hidden without a compute node", () => {
    render(<ParameterPanel />)
    expect(sectionButtons().map((b) => b.textContent?.replace(/\d+$/, "").replace(/Live|\d+ bound/, ""))).toEqual(["Parameters", "Render", "Environment & lighting", "Audio", "Variations"])
    expect(screen.queryByText("Inspector sections")).toBeNull()
  })

  it("shows Compute only on WebGPU with a compute step", () => {
    useProjectStore.setState({ renderQueue: [computeStep] })
    const { unmount } = render(<ParameterPanel />)
    expect(sectionButtons().map((b) => b.textContent)).toContain("Compute")
    expect(expanded(/Compute/)).toBe("false")
    unmount()
    useProjectStore.setState({ activeBackend: "webgl2" })
    render(<ParameterPanel />)
    expect(sectionButtons().map((b) => b.textContent)).not.toContain("Compute")
  })

  it("opens Parameters and Render by default and shows their content", () => {
    render(<ParameterPanel />)
    expect(expanded(/Parameters/)).toBe("true")
    expect(expanded(/Render/)).toBe("true")
    expect(expanded(/Environment/)).toBe("false")
    expect(screen.getByPlaceholderText("Search uniforms...")).toBeTruthy()
    expect(screen.queryByText("Lighting preset")).toBeNull()
  })

  it("persists open/closed state per section to localStorage and restores it", () => {
    const first = render(<ParameterPanel />)
    fireEvent.click(sectionButtons().find((b) => /Environment/.test(b.textContent ?? ""))!)
    fireEvent.click(sectionButtons().find((b) => /Parameters/.test(b.textContent ?? ""))!)
    expect(JSON.parse(localStorage.getItem(INSPECTOR_SECTIONS_KEY)!).sort()).toEqual(["environment", "render"])
    first.unmount()

    render(<ParameterPanel />)
    expect(expanded(/Environment/)).toBe("true")
    expect(expanded(/Parameters/)).toBe("false")
    expect(screen.getByText("Lighting preset")).toBeTruthy()
  })

  it("survives corrupt or unavailable storage", () => {
    localStorage.setItem(INSPECTOR_SECTIONS_KEY, "{not json")
    render(<ParameterPanel />)
    expect(expanded(/Parameters/)).toBe("true")
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    fireEvent.click(sectionButtons()[0])
    expect(expanded(/Parameters/)).toBe("false")
  })

  it("single collapse-all button collapses then expands", () => {
    render(<ParameterPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse all sections" }))
    expect(sectionButtons().every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Expand all sections" }))
    expect(sectionButtons().every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true)
  })

  it("badges: uniform count, audio live / bound, variation count", () => {
    useProjectStore.setState({
      parsedUniforms: [
        { name: "a", type: "f32", kind: "scalar" },
        { name: "b", type: "f32", kind: "scalar" },
      ],
      graphUniforms: [{ id: "g", name: "g_x", type: "float", defaultValue: 1 }],
      audioBindings: { a: { band: "bass", amount: 1 }, b: { band: "mid", amount: 1 } },
      variations: [{ id: "v1", name: "A", uniformValues: {}, createdAt: 1 }],
    })
    render(<ParameterPanel />)
    expect(sectionButtons().find((b) => /Parameters/.test(b.textContent!))!.textContent).toBe("Parameters3")
    expect(sectionButtons().find((b) => /Audio/.test(b.textContent!))!.textContent).toBe("Audio2 bound")
    expect(sectionButtons().find((b) => /Variations/.test(b.textContent!))!.textContent).toBe("Variations1")
    act(() => useProjectStore.setState({ isAudioPlaying: true }))
    expect(sectionButtons().find((b) => /Audio/.test(b.textContent!))!.textContent).toBe("AudioLive")
  })

  it("selecting an audio node reveals the Audio section", () => {
    render(<ParameterPanel />)
    expect(expanded(/Audio/)).toBe("false")
    act(() => useProjectStore.setState({ selectedNodeId: "audio-1" }))
    expect(expanded(/Audio/)).toBe("true")
  })
})

describe("EnvironmentSection", () => {
  it("preset tiles set the preset", () => {
    render(<EnvironmentSection />)
    for (const t of ENVIRONMENT_PRESET_TILES) {
      fireEvent.click(screen.getByRole("button", { name: t.label }))
      expect(useProjectStore.getState().environmentSettings.preset).toBe(t.id)
      expect(screen.getByRole("button", { name: t.label }).getAttribute("aria-pressed")).toBe("true")
    }
  })

  it("exposure, rotation, blur NumericFields and skybox switch write the store (exposure clamps)", () => {
    render(<EnvironmentSection />)
    typeInto(screen.getByRole("textbox", { name: "Exposure" }), "2.75")
    expect(useProjectStore.getState().environmentSettings.exposure).toBe(2.75)
    typeInto(screen.getByRole("textbox", { name: "Exposure" }), "99")
    expect(useProjectStore.getState().environmentSettings.exposure).toBe(4)
    typeInto(screen.getByRole("textbox", { name: "Rotation" }), "210")
    expect(useProjectStore.getState().environmentSettings.rotation).toBe(210)
    typeInto(screen.getByRole("textbox", { name: "Background blur" }), "0.85")
    expect(useProjectStore.getState().environmentSettings.backgroundBlur).toBe(0.85)
    fireEvent.click(screen.getByRole("switch", { name: "Show skybox" }))
    expect(useProjectStore.getState().environmentSettings.showSkybox).toBe(true)
  })

  it("custom preset reveals the skymap loader and applies a URL", () => {
    render(<EnvironmentSection />)
    expect(screen.queryByLabelText("Skymap URL")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    fireEvent.change(screen.getByLabelText("Skymap URL"), { target: { value: " https://x/p.jpg " } })
    fireEvent.click(screen.getByRole("button", { name: "Load" }))
    expect(useProjectStore.getState().environmentSettings).toMatchObject({ preset: "custom", customTextureSrc: "https://x/p.jpg" })
  })
})

describe("AudioDynamicsSection", () => {
  let spies: { mockRestore: () => void }[]
  beforeEach(() => {
    spies = [
      vi.spyOn(audioEngine, "togglePlay").mockReturnValue(true),
      vi.spyOn(audioEngine, "setSourceType").mockResolvedValue(undefined as never),
      vi.spyOn(audioEngine, "getIsPlaying").mockReturnValue(true),
      vi.spyOn(audioEngine, "startMicrophone").mockResolvedValue(undefined as never),
      vi.spyOn(audioEngine, "loadCustomAudioFile").mockResolvedValue(true as never),
      vi.spyOn(audioEngine, "setGainMultiplier").mockImplementation(() => {}),
      vi.spyOn(audioEngine, "setSmoothing").mockImplementation(() => {}),
    ]
  })
  afterEach(() => spies.forEach((s) => s.mockRestore()))

  it("renders idle state, five gauges, gain/smoothing", () => {
    render(<AudioDynamicsSection />)
    expect(screen.getByText("Audio Suspended")).toBeTruthy()
    for (const l of ["BASS", "MID", "TREBLE", "BEAT", "LEVEL"]) expect(screen.getByText(l)).toBeTruthy()
    expect(screen.getByText("Real-Time VU Spectrum")).toBeTruthy()
    expect(screen.getByText("Gain")).toBeTruthy()
    expect(screen.getByText("Smoothing")).toBeTruthy()
  })

  it("play, source switch, mic, file upload through the lazy engine", async () => {
    render(<AudioDynamicsSection />)
    fireEvent.click(screen.getByRole("button", { name: "Play Audio" }))
    await vi.waitFor(() => expect(useProjectStore.getState().isAudioPlaying).toBe(true))
    expect(audioEngine.togglePlay).toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Built-in" }))
    await vi.waitFor(() => expect(audioEngine.setSourceType).toHaveBeenCalledWith("builtin"))
    fireEvent.click(screen.getByRole("button", { name: "Mic" }))
    await vi.waitFor(() => expect(audioEngine.startMicrophone).toHaveBeenCalled())
    expect(useProjectStore.getState().audioSourceType).toBe("mic")

    const file = new File(["x"], "a.wav")
    fireEvent.change(screen.getByLabelText("Upload audio file"), { target: { files: [file] } })
    await vi.waitFor(() => expect(audioEngine.loadCustomAudioFile).toHaveBeenCalledWith(file))
    await vi.waitFor(() => expect(useProjectStore.getState().audioSourceType).toBe("file"))
  })

  it("gain and smoothing sliders (keyboard) update store and engine within bounds", async () => {
    useProjectStore.setState({ audioGain: 1, audioSmoothing: 0.8 })
    render(<AudioDynamicsSection />)
    const gain = screen.getAllByRole("slider")[0]
    fireEvent.keyDown(gain, { key: "End" })
    expect(useProjectStore.getState().audioGain).toBe(5)
    expect(audioEngine.setGainMultiplier).toHaveBeenCalledWith(5)
    const smooth = screen.getAllByRole("slider")[1]
    fireEvent.keyDown(smooth, { key: "End" })
    expect(useProjectStore.getState().audioSmoothing).toBe(0.95)
    expect(audioEngine.setSmoothing).toHaveBeenCalledWith(0.95)
  })

  it("lists bindings and disconnects one", () => {
    useProjectStore.setState({ audioBindings: { u_pulse: { band: "bass", amount: 2.5 }, u_shimmer: { band: "treble", amount: 1.2 } } })
    render(<AudioDynamicsSection />)
    expect(screen.getByText("Active Audio Bindings (2)")).toBeTruthy()
    expect(screen.getByText("2.5x")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Disconnect u_pulse" }))
    expect(useProjectStore.getState().audioBindings.u_pulse).toBeUndefined()
    expect(useProjectStore.getState().audioBindings.u_shimmer).toBeDefined()
  })
})

describe("ComputeSimulationSection", () => {
  it("non-WebGPU backend shows notice and switches back", () => {
    useProjectStore.setState({ activeBackend: "webgl2" })
    render(<ComputeSimulationSection />)
    expect(screen.getByText("Active on WebGPU backend")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Switch to WebGPU" }))
    expect(useProjectStore.getState().activeBackend).toBe("webgpu")
  })

  it("controls forward to the compute adapter; re-seed bumps the reset trigger", () => {
    const update = vi.fn()
    const reseed = vi.fn()
    adapters.webgpu.updateComputeUniform = update
    adapters.webgpu.reseedSimulation = reseed
    const before = useProjectStore.getState().simulationResetTrigger
    render(<ComputeSimulationSection />)
    for (const l of ["Simulation Speed", "Damping", "Gravity / Force", "Particle Size", "Additive blend"]) expect(screen.getByLabelText(l)).toBeTruthy()
    typeInto(screen.getByRole("textbox", { name: "Simulation Speed" }), "2")
    expect(update).toHaveBeenCalledWith("speed", 2)
    fireEvent.click(screen.getByRole("switch", { name: "Additive blend" }))
    expect(update).toHaveBeenCalledWith("blendMode", 0)
    fireEvent.click(screen.getByRole("button", { name: "Re-seed" }))
    expect(reseed).toHaveBeenCalled()
    expect(useProjectStore.getState().simulationResetTrigger).toBe(before + 1)
  })
})

describe("VariationsSection", () => {
  it("saves with a name, falls back to 'Variation N', applies to store + adapter, deletes", () => {
    const spy = vi.spyOn(adapters.webgpu, "updateUniform").mockImplementation(() => {})
    useProjectStore.getState().setUniformValue("u_scale", { type: "float", value: 3 })
    render(<VariationsSection />)
    fireEvent.change(screen.getByLabelText("Variation name"), { target: { value: "Emerald" } })
    fireEvent.keyDown(screen.getByLabelText("Variation name"), { key: "Enter" })
    fireEvent.click(screen.getByRole("button", { name: /Save Variation/ }))
    expect(useProjectStore.getState().variations.map((v) => v.name)).toEqual(["Emerald", "Variation 2"])
    expect(screen.getByText("2 snapshots")).toBeTruthy()

    useProjectStore.getState().setUniformValue("u_scale", { type: "float", value: 0.1 })
    spy.mockClear()
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0])
    expect(useProjectStore.getState().uniformValues.u_scale).toEqual({ type: "float", value: 3 })
    expect(spy).toHaveBeenCalledWith("u_scale", { type: "float", value: 3 })

    const id = useProjectStore.getState().activeVariationId
    expect(id).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Delete variation" })[0])
    expect(useProjectStore.getState().variations).toHaveLength(1)
    expect(useProjectStore.getState().activeVariationId).toBeNull()
  })

  it("applying with no active adapter does not throw and still updates the store", () => {
    noAdapter.on = true
    useProjectStore.setState({ variations: [{ id: "v", name: "V", uniformValues: { u_x: { type: "float", value: 7 } }, createdAt: 1 }] })
    render(<VariationsSection />)
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Apply" }))).not.toThrow()
    expect(useProjectStore.getState().uniformValues.u_x).toEqual({ type: "float", value: 7 })
    expect(useProjectStore.getState().activeVariationId).toBe("v")
  })

  it("renders exact uniform counts per card", () => {
    useProjectStore.setState({
      variations: [
        { id: "a", name: "Zero", uniformValues: {}, createdAt: 1 },
        { id: "b", name: "One", uniformValues: { u: { type: "float", value: 1 } }, createdAt: 1 },
        { id: "c", name: "Three", uniformValues: { a: { type: "float", value: 1 }, b: { type: "float", value: 1 }, c: { type: "float", value: 1 } }, createdAt: 1 },
      ],
    })
    render(<VariationsSection />)
    expect(screen.getByText(/· 0 uniforms/)).toBeTruthy()
    expect(screen.getByText(/· 1 uniform$/)).toBeTruthy()
    expect(screen.getByText(/· 3 uniforms/)).toBeTruthy()
  })

  it("rejects corrupt JSON imports without touching the list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<VariationsSection />)
    const input = screen.getByLabelText("Import variations file")
    fireEvent.change(input, { target: { files: [new File(["{broken"], "v.json")] } })
    await new Promise((r) => setTimeout(r, 30))
    expect(useProjectStore.getState().variations).toHaveLength(0)
    const good = JSON.stringify([{ id: "x", name: "Imported", uniformValues: {}, createdAt: 1 }])
    fireEvent.change(input, { target: { files: [new File([good], "v.json")] } })
    await vi.waitFor(() => expect(useProjectStore.getState().variations.length).toBe(1))
    within(document.body)
  })
})
