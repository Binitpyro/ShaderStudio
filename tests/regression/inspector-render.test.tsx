// @vitest-environment happy-dom
import "../setup/rtl"
/** Render section (RTL): controls write useRenderSettingsStore, Sky drives the environment, capability-disabled controls explain why. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RenderSection } from "@/components/inspector/RenderSection"
import { useRenderSettingsStore, DEFAULT_RENDER_SETTINGS } from "@/stores/renderSettingsStore"
import { useProjectStore } from "@/stores/projectStore"
import { loadAdapter } from "@/adapters/activeAdapter"

const adapters: Record<string, any> = {}
beforeAll(async () => {
  for (const b of ["webgpu", "webgl2", "threejs"]) adapters[b] = await loadAdapter(b)
})

beforeEach(() => {
  useRenderSettingsStore.getState().reset()
  useProjectStore.setState({ activeBackend: "webgpu" })
  useProjectStore.getState().setEnvironmentSettings({ preset: "studio_warm", showSkybox: false })
})
afterEach(() => vi.restoreAllMocks())

const settings = () => useRenderSettingsStore.getState().settings
function typeInto(input: HTMLElement, value: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}
const radio = (group: string, name: string) => {
  const g = screen.getByRole("radiogroup", { name: group })
  return Array.from(g.querySelectorAll<HTMLElement>("[role=radio]")).find((b) => b.textContent === name)!
}

describe("Render section writes the render settings store", () => {
  it("render mode and anti-aliasing segmented controls", () => {
    render(<RenderSection />)
    expect(radio("Render mode", "Forward").getAttribute("aria-checked")).toBe("true")
    fireEvent.click(radio("Render mode", "Deferred"))
    expect(settings().renderMode).toBe("deferred")
    fireEvent.click(radio("Anti-aliasing", "TAA"))
    expect(settings().antiAliasing).toBe("taa")
    fireEvent.click(radio("Anti-aliasing", "FXAA"))
    expect(settings().antiAliasing).toBe("fxaa")
  })

  it("shadows switch plus advanced resolution, filter, bias, normal bias and point shadows", () => {
    const { container } = render(<RenderSection />)
    fireEvent.click(screen.getByRole("switch", { name: "Shadows" }))
    expect(settings().shadows.enabled).toBe(true)

    // advanced controls live in sections that start closed
    const adv = Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Shadow settings"))!
    expect(adv.open).toBe(false)

    fireEvent.change(screen.getByLabelText("Shadow resolution"), { target: { value: "4096" } })
    expect(settings().shadows.resolution).toBe(4096)
    fireEvent.change(screen.getByLabelText("Shadow filter"), { target: { value: "vsm" } })
    expect(settings().shadows.filterMode).toBe("vsm")
    typeInto(screen.getByRole("textbox", { name: "Bias" }), "0.02")
    expect(settings().shadows.bias).toBe(0.02)
    typeInto(screen.getByRole("textbox", { name: "Normal bias" }), "0.05")
    expect(settings().shadows.normalBias).toBe(0.05)
    fireEvent.click(screen.getByRole("switch", { name: "Point-light shadows" }))
    expect(settings().shadows.pointShadows).toBe(true)
  })

  it("SSAO, SSR and DoF switches and their parameters", () => {
    render(<RenderSection />)
    fireEvent.click(screen.getByRole("switch", { name: "SSAO" }))
    fireEvent.click(screen.getByRole("switch", { name: "SSR" }))
    fireEvent.click(screen.getByRole("switch", { name: "DoF" }))
    expect(settings().ssao.enabled && settings().ssr.enabled && settings().dof.enabled).toBe(true)

    typeInto(screen.getByRole("textbox", { name: "Radius" }), "1.25")
    expect(settings().ssao.radius).toBe(1.25)
    typeInto(screen.getByRole("textbox", { name: "Max steps" }), "96")
    expect(settings().ssr.maxSteps).toBe(96)
    typeInto(screen.getByRole("textbox", { name: "Focal distance" }), "8")
    expect(settings().dof.focalDistance).toBe(8)
    fireEvent.change(screen.getByLabelText("Bokeh shape"), { target: { value: "hexagon" } })
    expect(settings().dof.bokehShape).toBe("hexagon")
  })

  it("sky parameters write the atmosphere section", () => {
    render(<RenderSection />)
    typeInto(screen.getByRole("textbox", { name: "Time of day" }), "18")
    expect(settings().atmosphere.timeOfDay).toBe(18)
    typeInto(screen.getByRole("textbox", { name: "Turbidity" }), "4")
    expect(settings().atmosphere.turbidity).toBe(4)
  })

  it("the Sky switch sets the atmosphere preset and skybox; switching off hides the skybox", () => {
    render(<RenderSection />)
    const sky = screen.getByRole("switch", { name: "Sky" })
    expect(sky.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(sky)
    expect(useProjectStore.getState().environmentSettings).toMatchObject({ preset: "atmosphere", showSkybox: true })
    expect(screen.getByRole("switch", { name: "Sky" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("switch", { name: "Sky" }))
    expect(useProjectStore.getState().environmentSettings.showSkybox).toBe(false)
  })

  it("G-buffer view is only enabled in deferred mode", () => {
    render(<RenderSection />)
    const get = () => screen.getByLabelText("G-buffer debug view") as HTMLSelectElement
    const sel = get()
    expect(sel.disabled).toBe(true)
    fireEvent.click(radio("Render mode", "Deferred"))
    expect(get().disabled).toBe(false)
    fireEvent.change(get(), { target: { value: "normal" } })
    expect(settings().gbufferDebugView).toBe("normal")
  })

  it("Reset render settings restores the defaults", () => {
    render(<RenderSection />)
    fireEvent.click(radio("Render mode", "Deferred"))
    fireEvent.click(screen.getByRole("switch", { name: "Shadows" }))
    fireEvent.click(screen.getByRole("button", { name: /Reset render settings/ }))
    expect(settings()).toEqual(DEFAULT_RENDER_SETTINGS)
  })
})

describe("capability-disabled controls", () => {
  it("Three.js disables SSAO intensity, bokeh shape and SSR IBL blend with a reason, and shows the shadow limitation", () => {
    useProjectStore.setState({ activeBackend: "threejs" })
    render(<RenderSection />)
    expect((screen.getByRole("textbox", { name: "Intensity" }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("textbox", { name: "IBL blend" }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText("Bokeh shape") as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole("tooltip").filter((t) => t.textContent === "Not supported on Three.js")).toHaveLength(3)
    // supported controls stay enabled
    expect((screen.getByRole("textbox", { name: "Radius" }) as HTMLInputElement).disabled).toBe(false)

    expect(screen.queryByText(/Custom shaders don.t receive shadows/)).toBeNull()
    fireEvent.click(screen.getByRole("switch", { name: "Shadows" }))
    expect(screen.getByText(/Custom shaders don.t receive shadows/)).toBeTruthy()
  })

  it("WebGPU supports everything", () => {
    render(<RenderSection />)
    expect((screen.getByRole("textbox", { name: "Intensity" }) as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryAllByRole("tooltip").filter((t) => /Not supported/.test(t.textContent ?? ""))).toHaveLength(0)
  })

  it("WebGL2 reporting a PCF fallback for VSM shows the explanation", () => {
    useProjectStore.setState({ activeBackend: "webgl2" })
    vi.spyOn(adapters.webgl2, "getFidelityCapabilities").mockReturnValue({ effectiveShadowFilter: "pcf", unsupported: [] })
    useRenderSettingsStore.getState().updateSection("shadows", { filterMode: "vsm" })
    render(<RenderSection />)
    expect(screen.getByText("VSM unavailable on this GPU, using PCF.")).toBeTruthy()
  })

  it("no fallback note when VSM is honoured", () => {
    useProjectStore.setState({ activeBackend: "webgl2" })
    vi.spyOn(adapters.webgl2, "getFidelityCapabilities").mockReturnValue({ effectiveShadowFilter: "vsm", unsupported: [] })
    useRenderSettingsStore.getState().updateSection("shadows", { filterMode: "vsm" })
    render(<RenderSection />)
    expect(screen.queryByText(/VSM unavailable/)).toBeNull()
  })
})
