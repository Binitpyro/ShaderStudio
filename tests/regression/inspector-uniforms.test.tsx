// @vitest-environment happy-dom
import "../setup/rtl"
/**
 * Uniform controls (RTL): every control writes the store and the active adapter (no recompile), per-uniform reset,
 * reset all, search, audio bind, texture slot. Migrated from the VDOM-introspection tests in parameter-inspector.test.tsx.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { UniformsSection } from "@/components/inspector/UniformsSection"
import { useProjectStore, type ParsedUniform } from "@/stores/projectStore"
import { loadAdapter } from "@/adapters/activeAdapter"

let gpuSpy: ReturnType<typeof vi.fn>
let adapters: Record<string, any> = {}

beforeAll(async () => {
  adapters.webgpu = await loadAdapter("webgpu")
  adapters.webgl2 = await loadAdapter("webgl2")
  adapters.threejs = await loadAdapter("threejs")
})

beforeEach(() => {
  useProjectStore.getState().resetProject()
  useProjectStore.setState({ activeBackend: "webgpu", audioBindings: {}, graphUniforms: [] })
  gpuSpy = vi.spyOn(adapters.webgpu, "updateUniform").mockImplementation(() => {}) as never
})
afterEach(() => vi.restoreAllMocks())

const setUniforms = (u: ParsedUniform[]) => useProjectStore.getState().setParsedUniforms(u)
const values = () => useProjectStore.getState().uniformValues

/** Type a value into a NumericField and commit it (blur). */
function typeInto(input: HTMLElement, value: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe("uniform controls write the store and the adapter", () => {
  it("bool: Switch toggles with type 'bool'", () => {
    setUniforms([{ name: "u_flag", type: "bool", kind: "scalar" }])
    render(<UniformsSection />)
    const sw = screen.getByRole("switch", { name: "u_flag" })
    fireEvent.click(sw)
    expect(gpuSpy).toHaveBeenCalledWith("u_flag", { type: "bool", value: true })
    expect(values().u_flag).toEqual({ type: "bool", value: true })
    fireEvent.click(sw)
    expect(values().u_flag).toEqual({ type: "bool", value: false })
  })

  it("float: typing commits a float", () => {
    setUniforms([{ name: "u_speed", type: "f32", kind: "scalar" }])
    render(<UniformsSection />)
    typeInto(screen.getByRole("textbox", { name: "u_speed" }), "4.75")
    expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 4.75 })
    expect(values().u_speed).toEqual({ type: "float", value: 4.75 })
  })

  it("float: drag-scrubbing the grip writes the store and adapter (step per 2px, shift x10)", () => {
    setUniforms([{ name: "u_speed", type: "f32", kind: "scalar" }])
    const { container } = render(<UniformsSection />)
    const grip = container.querySelector("[data-uniform='u_speed'] [data-scrub]") as HTMLElement
    fireEvent.pointerDown(grip, { clientX: 100, button: 0, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 120, pointerId: 1 })
    expect(values().u_speed).toEqual({ type: "float", value: 0.1 })
    expect(gpuSpy).toHaveBeenLastCalledWith("u_speed", { type: "float", value: 0.1 })
    fireEvent.pointerMove(grip, { clientX: 120, shiftKey: true, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 140, shiftKey: true, pointerId: 1 })
    expect(values().u_speed).toEqual({ type: "float", value: 2 })
    fireEvent.pointerUp(grip, { pointerId: 1 })
    // no drag in flight after release
    fireEvent.pointerMove(grip, { clientX: 400, pointerId: 1 })
    expect(values().u_speed).toEqual({ type: "float", value: 2 })
  })

  it("int rounds to an integer with type 'int'", () => {
    setUniforms([{ name: "u_iterations", type: "i32", kind: "scalar" }])
    render(<UniformsSection />)
    typeInto(screen.getByRole("textbox", { name: "u_iterations" }), "14.6")
    expect(gpuSpy).toHaveBeenCalledWith("u_iterations", { type: "int", value: 15 })
    expect(values().u_iterations).toEqual({ type: "int", value: 15 })
  })

  it("uint clamps negatives to 0 and rounds", () => {
    setUniforms([{ name: "u_count", type: "u32", kind: "scalar" }])
    render(<UniformsSection />)
    const input = screen.getByRole("textbox", { name: "u_count" })
    typeInto(input, "-10")
    expect(gpuSpy).toHaveBeenCalledWith("u_count", { type: "uint", value: 0 })
    typeInto(input, "32.2")
    expect(gpuSpy).toHaveBeenCalledWith("u_count", { type: "uint", value: 32 })
  })

  it("vec2: x/y NumericFields write accurate vector arrays", () => {
    setUniforms([{ name: "u_offset", type: "vec2f", kind: "vector" }])
    render(<UniformsSection />)
    typeInto(screen.getByRole("textbox", { name: "u_offset.x" }), "3.5")
    expect(gpuSpy).toHaveBeenCalledWith("u_offset", { type: "vec2", value: [3.5, 0] })
    typeInto(screen.getByRole("textbox", { name: "u_offset.y" }), "-7.25")
    expect(gpuSpy).toHaveBeenCalledWith("u_offset", { type: "vec2", value: [3.5, -7.25] })
    expect(values().u_offset).toEqual({ type: "vec2", value: [3.5, -7.25] })
  })

  it("vec4 exposes x/y/z/w", () => {
    setUniforms([{ name: "u_v", type: "vec4f", kind: "vector" }])
    render(<UniformsSection />)
    for (const c of ["x", "y", "z", "w"]) expect(screen.getByRole("textbox", { name: `u_v.${c}` })).toBeTruthy()
  })

  it("color: vec3f writes 'color', vec4f writes 'vec4' with alpha preserved", () => {
    setUniforms([
      { name: "u_tint3", type: "vec3f", kind: "color" },
      { name: "u_tint4", type: "vec4f", kind: "color" },
    ])
    render(<UniformsSection />)
    fireEvent.change(screen.getByLabelText("u_tint3 color"), { target: { value: "#ff0000" } })
    expect(gpuSpy).toHaveBeenCalledWith("u_tint3", { type: "color", value: [1, 0, 0] })
    fireEvent.change(screen.getByLabelText("u_tint4 color"), { target: { value: "#00ffff" } })
    expect(gpuSpy).toHaveBeenCalledWith("u_tint4", { type: "vec4", value: [0, 1, 1, 1] })
  })

  it("color: alpha field updates only alpha on vec4f", () => {
    setUniforms([{ name: "u_tintAlpha", type: "vec4f", kind: "color" }])
    useProjectStore.getState().setUniformValue("u_tintAlpha", { type: "vec4", value: [1, 1, 1, 1] })
    render(<UniformsSection />)
    typeInto(screen.getByRole("textbox", { name: "u_tintAlpha alpha" }), "0.35")
    expect(gpuSpy).toHaveBeenCalledWith("u_tintAlpha", { type: "vec4", value: [1, 1, 1, 0.35] })
    expect(values().u_tintAlpha).toEqual({ type: "vec4", value: [1, 1, 1, 0.35] })
  })

  it("color: hex text input writes the uniform on Enter", () => {
    setUniforms([{ name: "u_hex", type: "vec3f", kind: "color" }])
    render(<UniformsSection />)
    const hex = screen.getByLabelText("u_hex color hex")
    fireEvent.change(hex, { target: { value: "#0000ff" } })
    fireEvent.keyDown(hex, { key: "Enter" })
    expect(gpuSpy).toHaveBeenCalledWith("u_hex", { type: "color", value: [0, 0, 1] })
  })

  it("color: incomplete/invalid hex drafts never write the store or adapter", () => {
    setUniforms([{ name: "u_inv", type: "vec3f", kind: "color" }])
    render(<UniformsSection />)
    const hex = screen.getByLabelText("u_inv color hex") as HTMLInputElement
    const before = values().u_inv
    for (const bad of ["#12", "zzz", "#12345", "12345"]) {
      fireEvent.change(hex, { target: { value: bad } })
      fireEvent.keyDown(hex, { key: "Enter" })
      fireEvent.blur(hex)
    }
    expect(gpuSpy).not.toHaveBeenCalledWith("u_inv", expect.anything())
    expect(values().u_inv).toEqual(before)
  })

  it("color: picker hex is normalised to floats", () => {
    setUniforms([{ name: "u_base", type: "vec3f", kind: "color" }])
    render(<UniformsSection />)
    fireEvent.change(screen.getByLabelText("u_base color"), { target: { value: "#ffffff" } })
    expect(gpuSpy).toHaveBeenCalledWith("u_base", { type: "color", value: [1, 1, 1] })
  })

  it("matrix: collapsed by default (advanced); presets write mat3 / mat2 / mat4", () => {
    setUniforms([
      { name: "u_m3", type: "mat3x3f", kind: "matrix" },
      { name: "u_m2", type: "mat2x2f", kind: "matrix" },
      { name: "u_m4", type: "mat4x4f", kind: "matrix" },
    ])
    const { container } = render(<UniformsSection />)
    for (const d of container.querySelectorAll("details")) expect(d.open).toBe(false)

    const within3 = within(container.querySelector("[data-uniform='u_m3']") as HTMLElement)
    fireEvent.click(within3.getByRole("button", { name: "2x" }))
    expect(gpuSpy).toHaveBeenCalledWith("u_m3", { type: "mat3", value: [2, 0, 0, 0, 2, 0, 0, 0, 2] })
    fireEvent.click(within3.getByRole("button", { name: "0.5x" }))
    expect(gpuSpy).toHaveBeenCalledWith("u_m3", { type: "mat3", value: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5] })
    fireEvent.click(within3.getByRole("button", { name: "Identity" }))
    expect(gpuSpy).toHaveBeenCalledWith("u_m3", { type: "mat3", value: [1, 0, 0, 0, 1, 0, 0, 0, 1] })

    const within2 = within(container.querySelector("[data-uniform='u_m2']") as HTMLElement)
    fireEvent.click(within2.getByRole("button", { name: "2x" }))
    expect(values().u_m2).toEqual({ type: "mat2", value: [2, 0, 0, 2] })

    const within4 = within(container.querySelector("[data-uniform='u_m4']") as HTMLElement)
    fireEvent.click(within4.getByRole("button", { name: "0.5x" }))
    const half = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5]
    expect(values().u_m4).toEqual({ type: "mat4", value: half })
    expect(within4.getAllByRole("textbox")).toHaveLength(16)
    typeInto(within4.getByRole("textbox", { name: "u_m4[0]" }), "9")
    expect(gpuSpy).toHaveBeenCalledWith("u_m4", { type: "mat4", value: [9, ...half.slice(1)] })
  })

  it("matrix: a corrupt stored array falls back to the identity layout without crashing", () => {
    setUniforms([{ name: "u_bad", type: "mat3x3f", kind: "matrix" }])
    useProjectStore.getState().setUniformValue("u_bad", { type: "mat3", value: [99, 99, 99] })
    render(<UniformsSection />)
    expect(screen.getAllByRole("textbox", { name: /^u_bad\[/ })).toHaveLength(9)
  })

  it("routes writes to whichever adapter is active (WebGL2, Three.js)", () => {
    setUniforms([{ name: "u_factor", type: "f32", kind: "scalar" }])
    const gl = vi.spyOn(adapters.webgl2, "updateUniform").mockImplementation(() => {})
    const three = vi.spyOn(adapters.threejs, "updateUniform").mockImplementation(() => {})
    useProjectStore.setState({ activeBackend: "webgl2" })
    render(<UniformsSection />)
    typeInto(screen.getByRole("textbox", { name: "u_factor" }), "10.5")
    expect(gl).toHaveBeenCalledWith("u_factor", { type: "float", value: 10.5 })
    expect(three).not.toHaveBeenCalled()
    useProjectStore.setState({ activeBackend: "threejs" })
    typeInto(screen.getByRole("textbox", { name: "u_factor" }), "25")
    expect(three).toHaveBeenCalledWith("u_factor", { type: "float", value: 25 })
  })

  it("survives 1,000 rapid updates without desync", () => {
    setUniforms([{ name: "u_scrub", type: "f32", kind: "scalar" }])
    const { container } = render(<UniformsSection />)
    const grip = container.querySelector("[data-scrub]") as HTMLElement
    fireEvent.pointerDown(grip, { clientX: 0, button: 0, pointerId: 1 })
    for (let i = 1; i <= 1000; i++) fireEvent.pointerMove(grip, { clientX: i * 2, pointerId: 1 })
    expect(gpuSpy).toHaveBeenCalledTimes(1000)
    expect(values().u_scrub).toEqual({ type: "float", value: 10 })
  })
})

describe("reset", () => {
  it("per-uniform reset restores the parsed default, syncs the adapter, and leaves others untouched", () => {
    setUniforms([
      { name: "u_speed", type: "f32", kind: "scalar" },
      { name: "u_color", type: "vec3f", kind: "color" },
    ])
    useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 88 })
    useProjectStore.getState().setUniformValue("u_color", { type: "color", value: [1, 0, 0] })
    const { container } = render(<UniformsSection />)
    gpuSpy.mockClear()
    fireEvent.click(within(container.querySelector("[data-uniform='u_speed']") as HTMLElement).getByRole("button", { name: "Reset to default" }))
    expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 0 })
    expect(values().u_speed).toEqual({ type: "float", value: 0 })
    expect(values().u_color).toEqual({ type: "color", value: [1, 0, 0] })
  })

  it("graph uniforms reset to their declared defaultValue", () => {
    setUniforms([])
    useProjectStore.getState().addGraphUniform({ id: "gu-1", name: "g_customFloat", type: "float", defaultValue: 7.5 })
    useProjectStore.getState().setUniformValue("g_customFloat", { type: "float", value: 99 })
    const { container } = render(<UniformsSection />)
    gpuSpy.mockClear()
    fireEvent.click(within(container.querySelector("[data-uniform='g_customFloat']") as HTMLElement).getByRole("button", { name: "Reset to default" }))
    expect(gpuSpy).toHaveBeenCalledWith("g_customFloat", { type: "float", value: 7.5 })
    expect(values().g_customFloat).toEqual({ type: "float", value: 7.5 })
  })

  it("Reset all restores every parsed uniform in the store and the adapter", () => {
    setUniforms([
      { name: "u_alpha", type: "f32", kind: "scalar" },
      { name: "u_active", type: "bool", kind: "scalar" },
      { name: "u_tint", type: "vec4f", kind: "color" },
      { name: "u_pos", type: "vec3f", kind: "vector" },
      { name: "u_mat", type: "mat2x2f", kind: "matrix" },
    ])
    const store = useProjectStore.getState()
    store.setUniformValue("u_alpha", { type: "float", value: 0.99 })
    store.setUniformValue("u_active", { type: "bool", value: true })
    store.setUniformValue("u_tint", { type: "vec4", value: [0, 1, 0, 0.5] })
    store.setUniformValue("u_pos", { type: "vec3", value: [10, 20, 30] })
    store.setUniformValue("u_mat", { type: "mat2", value: [5, 5, 5, 5] })
    render(<UniformsSection />)
    gpuSpy.mockClear()
    fireEvent.click(screen.getByRole("button", { name: /Reset all/ }))
    expect(gpuSpy).toHaveBeenCalledWith("u_alpha", { type: "float", value: 0 })
    expect(gpuSpy).toHaveBeenCalledWith("u_active", { type: "bool", value: false })
    expect(gpuSpy).toHaveBeenCalledWith("u_tint", { type: "vec4", value: [0.5, 0.5, 0.5, 1] })
    expect(gpuSpy).toHaveBeenCalledWith("u_pos", { type: "vec3", value: [0, 0, 0] })
    expect(gpuSpy).toHaveBeenCalledWith("u_mat", { type: "mat2", value: [1, 0, 0, 1] })
    expect(values().u_mat).toEqual({ type: "mat2", value: [1, 0, 0, 1] })
  })

  it("Reset all uses each graph uniform's custom default", () => {
    setUniforms([])
    useProjectStore.setState({
      graphUniforms: [
        { id: "g1", name: "g_brightness", type: "float", defaultValue: 3.5 },
        { id: "g2", name: "g_color", type: "color", defaultValue: [0.1, 0.2, 0.8] },
        { id: "g3", name: "g_active", type: "bool", defaultValue: true },
        { id: "g4", name: "g_offset", type: "vec2", defaultValue: [1.2, 3.4] },
      ],
    })
    render(<UniformsSection />)
    fireEvent.click(screen.getByRole("button", { name: /Reset all/ }))
    const v = values()
    expect(v.g_brightness).toEqual({ type: "float", value: 3.5 })
    expect(v.g_color).toEqual({ type: "color", value: [0.1, 0.2, 0.8] })
    expect(v.g_active).toEqual({ type: "bool", value: true })
    expect(v.g_offset).toEqual({ type: "vec2", value: [1.2, 3.4] })
  })
})

describe("search, fallback, audio bind, textures", () => {
  it("falls back to u_color when no uniforms exist", () => {
    setUniforms([])
    render(<UniformsSection />)
    expect(screen.getByText("u_color")).toBeTruthy()
    expect(screen.getByText("vec3f color")).toBeTruthy()
  })

  it("filters by substring and is safe with regex metacharacters", () => {
    setUniforms([
      { name: "u_color", type: "vec3f", kind: "color" },
      { name: "u_roughness", type: "f32", kind: "scalar" },
      { name: "u_special[0]", type: "f32", kind: "scalar" },
    ])
    render(<UniformsSection />)
    const search = screen.getByPlaceholderText("Search uniforms...")
    for (const q of [".*", "[a-z(", "(?=.*[0-9])", "\\", "++", "u_color|u_roughness"]) {
      fireEvent.change(search, { target: { value: q } })
      expect(screen.getByText(/No uniforms matching/)).toBeTruthy()
    }
    fireEvent.change(search, { target: { value: "rough" } })
    expect(screen.getByText("Found 1 matching uniform")).toBeTruthy()
    expect(screen.queryByText("u_color")).toBeNull()
    fireEvent.change(search, { target: { value: "u_special[" } })
    expect(screen.getByText("u_special[0]")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(screen.getByText("u_color")).toBeTruthy()
  })

  it("binds a scalar uniform to audio via the IconButton panel, then unbinds", () => {
    setUniforms([{ name: "u_pulse", type: "f32", kind: "scalar" }])
    render(<UniformsSection />)
    fireEvent.click(screen.getByRole("button", { name: "Bind to audio" }))
    fireEvent.click(screen.getByRole("button", { name: "bass" }))
    expect(useProjectStore.getState().audioBindings.u_pulse).toEqual({ band: "bass", amount: 1 })
    fireEvent.click(screen.getByRole("button", { name: "treble" }))
    expect(useProjectStore.getState().audioBindings.u_pulse).toEqual({ band: "treble", amount: 1 })
    fireEvent.click(screen.getByRole("button", { name: /Unbind/ }))
    expect(useProjectStore.getState().audioBindings.u_pulse).toBeUndefined()
  })

  it("texture slot shows a thumbnail for a bound image and writes a replacement", async () => {
    setUniforms([{ name: "u_albedo", type: "texture", kind: "texture" }])
    useProjectStore.getState().setUniformValue("u_albedo", { type: "texture", value: "data:image/png;base64,AAAA" })
    render(<UniformsSection />)
    expect((screen.getByAltText("u_albedo preview") as HTMLImageElement).src).toContain("data:image/png")
    const file = new File(["x"], "t.png", { type: "image/png" })
    fireEvent.change(screen.getByLabelText("Replace u_albedo texture"), { target: { files: [file] } })
    await vi.waitFor(() => expect((values().u_albedo as any).value).not.toBe("data:image/png;base64,AAAA"))
    expect(gpuSpy).toHaveBeenCalledWith("u_albedo", expect.objectContaining({ type: "texture" }))
  })
})
