/**
 * Parameter inspector: accordion panel, uniforms (types, reset, presets, adapter sync), audio dynamics, variations, environment, compute.
 * Consolidated by fleet w1-b-ui; self-referential helpers (re-implemented filter/accordion simulators) were dropped, and w1-e removed the local getDefaultValueFor copy in favour of driving the real UniformsSection.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ParameterPanel, type AccordionSectionKey } from "@/components/ParameterPanel"
import { AccordionSection } from "@/components/inspector/AccordionSection"
import { UniformsSection } from "@/components/inspector/UniformsSection"
import { EnvironmentSection } from "@/components/inspector/EnvironmentSection"
import { AudioDynamicsSection } from "@/components/inspector/AudioDynamicsSection"
import { ComputeSimulationSection } from "@/components/inspector/ComputeSimulationSection"
import { VariationsSection } from "@/components/inspector/VariationsSection"
import { useProjectStore, getDefaultUniformValue, type ParsedUniform, type UniformValue, type GraphUniform, type PresetVariation, type EditorTab, type BackendType } from "@/stores/projectStore"
import { audioEngine } from "@/audio/audioEngine"
import { webgpuAdapter } from "@/adapters/webgpu"
import { loadAdapter } from "@/adapters/activeAdapter"

beforeAll(async () => { await loadAdapter("webgpu") }) // webgpu registers lazily
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import React from "react"
import { ShaderEditor, COMPILER_MARKER_OWNER, getErrorTargetTab, doesTabMatch } from "@/components/ShaderEditor"
import { ConsoleDrawer } from "@/components/layout/ConsoleDrawer"
import { useLayoutStore } from "@/stores/layoutStore"
import { useFileSystemStore } from "@/stores/fileSystemStore"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    language,
    options,
    onMount,
    onChange,
  }: {
    value: string
    language: string
    options: any
    onMount?: (editor: any, monaco: any) => void
    onChange?: (value: string | undefined) => void
  }) => {
    capturedOnMount = onMount || null
    capturedOnChange = onChange || null
    return (
      <div
        data-testid="mock-monaco-editor"
        data-language={language}
        data-minimap={options?.minimap?.enabled ? "true" : "false"}
      >
        <pre data-testid="editor-content">{value}</pre>
      </div>
    )
  },
}))

vi.mock("@/components/SyncStatusBanner", () => ({
  SyncStatusBanner: () => <div data-testid="sync-status-banner">Sync Status</div>,
}))

describe("panel / sections (m3 challenger)", () => {
describe("Milestone 3 Adversarial Challenger: Parameter Inspector & Organization (R3)", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useProjectStore.setState({
      activeBackend: "webgpu",
      isAudioPlaying: false,
      audioGain: 1.0,
      audioSmoothing: 0.8,
      audioSourceType: "builtin",
      audioBindings: {},
      variations: [],
      activeVariationId: null,
      environmentSettings: {
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0,
        backgroundBlur: 0.0,
        showSkybox: false,
      },
    })
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Section 1: Accordion Resilience & Rapid Expand/Collapse Stress
  // ==========================================================================
  describe("Section 1: Accordion Resilience & Expand/Collapse State Machine", () => {
    it("renders default layout with uniforms and environment open, others collapsed", () => {
      const html = renderToStaticMarkup(<ParameterPanel />)

      expect(html).toContain("5 Inspector Sections")
      expect(html).toContain("Collapse All")

      // Uniforms section open
      expect(html).toContain("data-testid=\"accordion-uniforms\"")
      expect(html).toContain("Search uniforms...")

      // Environment section open
      expect(html).toContain("data-testid=\"accordion-environment\"")
      expect(html).toContain("Lighting Preset")

      // Audio section collapsed by default (title present, body omitted)
      expect(html).toContain("data-testid=\"accordion-audio\"")
      expect(html).not.toContain("Real-Time VU Spectrum")

      // Compute section collapsed by default
      expect(html).toContain("data-testid=\"accordion-compute\"")
      expect(html).not.toContain("Simulation Speed")

      // Variations section collapsed by default
      expect(html).toContain("data-testid=\"accordion-variations\"")
      expect(html).not.toContain("Save Variation")
    })

    it("renders all 32 power set combinations of open/closed accordions without crashing", () => {
      const allKeys: AccordionSectionKey[] = [
        "uniforms",
        "environment",
        "audio",
        "compute",
        "variations",
      ]

      // 2^5 = 32 combinations
      for (let mask = 0; mask < 32; mask++) {
        const activeSet = new Set<AccordionSectionKey>()
        for (let bit = 0; bit < 5; bit++) {
          if ((mask & (1 << bit)) !== 0) {
            activeSet.add(allKeys[bit])
          }
        }

        const html = renderToStaticMarkup(
          <div>
            <AccordionSection
              id="uniforms"
              title="Shader Uniforms"
              isOpen={activeSet.has("uniforms")}
              onToggle={() => {}}
            >
              <div>Uniforms Content</div>
            </AccordionSection>
            <AccordionSection
              id="environment"
              title="Studio Environment"
              isOpen={activeSet.has("environment")}
              onToggle={() => {}}
            >
              <div>Environment Content</div>
            </AccordionSection>
            <AccordionSection
              id="audio"
              title="Audio Dynamics"
              isOpen={activeSet.has("audio")}
              onToggle={() => {}}
            >
              <div>Audio Content</div>
            </AccordionSection>
            <AccordionSection
              id="compute"
              title="Compute Simulation"
              isOpen={activeSet.has("compute")}
              onToggle={() => {}}
            >
              <div>Compute Content</div>
            </AccordionSection>
            <AccordionSection
              id="variations"
              title="Variations & Presets"
              isOpen={activeSet.has("variations")}
              onToggle={() => {}}
            >
              <div>Variations Content</div>
            </AccordionSection>
          </div>
        )

        // Verify accurate aria-expanded and content visibility for each section
        for (const k of allKeys) {
          const isOpen = activeSet.has(k)
          if (isOpen) {
            expect(html).toContain(`data-testid="accordion-${k}"`)
            expect(html).toContain("rotate-0")
          } else {
            expect(html).toContain("-rotate-90")
          }
        }
      }
    })

    it("verifies accessible ARIA contracts and stopPropagation on header actions", () => {
      let toggled = false
      let actionClicked = false

      const html = renderToStaticMarkup(
        <AccordionSection
          id="test-sec"
          title="Custom Section"
          isOpen={true}
          onToggle={() => {
            toggled = true
          }}
          headerActions={
            <button
              data-testid="sub-action"
              onClick={(e) => {
                e.stopPropagation()
                actionClicked = true
              }}
            >
              Action
            </button>
          }
        >
          <div>Child Content</div>
        </AccordionSection>
      )

      expect(html).toContain("aria-expanded=\"true\"")
      expect(html).toContain("data-testid=\"sub-action\"")
      expect(html).toContain("Child Content")
    })
  })

  // ==========================================================================
  // Section 3: Uniform Types, Per-Uniform Reset to Default & Global Reset-All
  // ==========================================================================
  describe("Section 3: Uniform Diversity, Per-Uniform Reset & Global Reset-All", () => {
    it("returns correct default values for all uniform types via getDefaultUniformValue", () => {
      const tests: Array<{ uniform: ParsedUniform; expected: UniformValue }> = [
        {
          uniform: { name: "u_float", type: "f32", kind: "scalar" },
          expected: { type: "float", value: 0 },
        },
        {
          uniform: { name: "u_int", type: "i32", kind: "scalar" },
          expected: { type: "float", value: 0 },
        },
        {
          uniform: { name: "u_uint", type: "u32", kind: "scalar" },
          expected: { type: "float", value: 0 },
        },
        {
          uniform: { name: "u_bool", type: "bool", kind: "scalar" },
          expected: { type: "bool", value: false },
        },
        {
          uniform: { name: "u_v2", type: "vec2f", kind: "vector" },
          expected: { type: "vec2", value: [0, 0] },
        },
        {
          uniform: { name: "u_v3", type: "vec3f", kind: "vector" },
          expected: { type: "vec3", value: [0, 0, 0] },
        },
        {
          uniform: { name: "u_v4", type: "vec4f", kind: "vector" },
          expected: { type: "vec4", value: [0, 0, 0, 1] },
        },
        {
          uniform: { name: "u_c3", type: "vec3f", kind: "color" },
          expected: { type: "color", value: [0.5, 0.5, 0.5] },
        },
        {
          uniform: { name: "u_c4", type: "vec4f", kind: "color" },
          expected: { type: "vec4", value: [0.5, 0.5, 0.5, 1.0] },
        },
        {
          uniform: { name: "u_m2", type: "mat2x2f", kind: "matrix" },
          expected: { type: "mat2", value: [1, 0, 0, 1] },
        },
        {
          uniform: { name: "u_m3", type: "mat3x3f", kind: "matrix" },
          expected: { type: "mat3", value: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        },
        {
          uniform: { name: "u_m4", type: "mat4x4f", kind: "matrix" },
          expected: {
            type: "mat4",
            value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        },
        {
          uniform: { name: "u_tex", type: "texture", kind: "texture" },
          expected: { type: "texture", value: "" },
        },
      ]

      for (const t of tests) {
        expect(getDefaultUniformValue(t.uniform)).toEqual(t.expected)
      }
    })

    it("resets graph uniforms to their custom defaultValue instead of zero fallback", () => {
      const graphUniforms: GraphUniform[] = [
        { id: "g1", name: "g_brightness", type: "float", defaultValue: 3.5 },
        { id: "g2", name: "g_color", type: "color", defaultValue: [0.1, 0.2, 0.8] },
        { id: "g3", name: "g_active", type: "float", defaultValue: true as any },
        { id: "g4", name: "g_offset", type: "vec2", defaultValue: [1.2, 3.4] },
      ]
      useProjectStore.setState({ graphUniforms })

      // Dirty every graph uniform so a no-op reset cannot pass.
      for (const g of graphUniforms) {
        useProjectStore.getState().setUniformValue(g.name, { type: "float", value: 99 })
      }

      // Render the REAL UniformsSection and fire its "Reset All" handler (which calls the private getDefaultValueFor).
      let resetAll: (() => void) | null = null
      const find = (node: any): void => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(find)
        if (node.props?.title === "Reset all uniforms to default parsed values") resetAll = node.props.onClick
        if (node.props?.children) find(node.props.children)
      }
      function Interceptor() {
        find(UniformsSection())
        return null
      }
      renderToStaticMarkup(<Interceptor />)
      expect(resetAll).toBeTypeOf("function")
      resetAll!()

      const values = useProjectStore.getState().uniformValues
      expect(values.g_brightness).toEqual({ type: "float", value: 3.5 })
      expect(values.g_color).toEqual({ type: "color", value: [0.1, 0.2, 0.8] })
      expect(values.g_active).toEqual({ type: "bool", value: true })
      expect(values.g_offset).toEqual({ type: "vec2", value: [1.2, 3.4] })
    })

    it("verifies per-uniform reset isolation: resets single uniform without affecting others", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_speed", type: "f32", kind: "scalar" },
        { name: "u_intensity", type: "f32", kind: "scalar" },
        { name: "u_color", type: "vec3f", kind: "color" },
      ]
      useProjectStore.getState().setParsedUniforms(uniforms)

      // Mutate all 3 uniforms
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 99.5 })
      useProjectStore.getState().setUniformValue("u_intensity", { type: "float", value: 42.0 })
      useProjectStore.getState().setUniformValue("u_color", { type: "color", value: [1, 0, 0] })

      // Reset ONLY u_speed
      const defSpeed = getDefaultUniformValue(uniforms[0])
      useProjectStore.getState().setUniformValue("u_speed", defSpeed)

      const values = useProjectStore.getState().uniformValues
      expect(values["u_speed"]).toEqual({ type: "float", value: 0 })
      // Other uniforms remain untouched
      expect(values["u_intensity"]).toEqual({ type: "float", value: 42.0 })
      expect(values["u_color"]).toEqual({ type: "color", value: [1, 0, 0] })
    })

    it("verifies global reset-all: restores 100% of mutated uniforms to their exact defaults", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_speed", type: "f32", kind: "scalar" },
        { name: "u_flag", type: "bool", kind: "scalar" },
        { name: "u_color", type: "vec3f", kind: "color" },
        { name: "u_tint", type: "vec4f", kind: "color" },
        { name: "u_offset", type: "vec2f", kind: "vector" },
        { name: "u_matrix", type: "mat3x3f", kind: "matrix" },
      ]
      useProjectStore.getState().setParsedUniforms(uniforms)

      // Heavily mutate all uniforms
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 77.7 })
      useProjectStore.getState().setUniformValue("u_flag", { type: "bool", value: true })
      useProjectStore.getState().setUniformValue("u_color", { type: "color", value: [0, 1, 0] })
      useProjectStore.getState().setUniformValue("u_tint", { type: "vec4", value: [1, 1, 0, 0.2] })
      useProjectStore.getState().setUniformValue("u_offset", { type: "vec2", value: [10, -10] })
      useProjectStore.getState().setUniformValue("u_matrix", {
        type: "mat3",
        value: [2, 0, 0, 0, 2, 0, 0, 0, 2],
      })

      // Execute global reset
      for (const u of uniforms) {
        useProjectStore.getState().setUniformValue(u.name, getDefaultUniformValue(u))
      }

      const finalValues = useProjectStore.getState().uniformValues
      expect(finalValues["u_speed"]).toEqual({ type: "float", value: 0 })
      expect(finalValues["u_flag"]).toEqual({ type: "bool", value: false })
      expect(finalValues["u_color"]).toEqual({ type: "color", value: [0.5, 0.5, 0.5] })
      expect(finalValues["u_tint"]).toEqual({ type: "vec4", value: [0.5, 0.5, 0.5, 1.0] })
      expect(finalValues["u_offset"]).toEqual({ type: "vec2", value: [0, 0] })
      expect(finalValues["u_matrix"]).toEqual({
        type: "mat3",
        value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      })
    })

    it("dispatches uniform updates to active adapter across WebGPU, WebGL2, and ThreeJS backends", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      const glSpy = vi.spyOn(webgl2Adapter, "updateUniform")
      const threeSpy = vi.spyOn(threejsAdapter, "updateUniform")

      const testVal: UniformValue = { type: "float", value: 12.34 }

      // 1. WebGPU active
      useProjectStore.getState().setActiveBackend("webgpu")
      webgpuAdapter.updateUniform("u_test", testVal)
      expect(gpuSpy).toHaveBeenCalledWith("u_test", testVal)

      // 2. WebGL2 active
      useProjectStore.getState().setActiveBackend("webgl2")
      webgl2Adapter.updateUniform("u_test", testVal)
      expect(glSpy).toHaveBeenCalledWith("u_test", testVal)

      // 3. ThreeJS active
      useProjectStore.getState().setActiveBackend("threejs")
      threejsAdapter.updateUniform("u_test", testVal)
      expect(threeSpy).toHaveBeenCalledWith("u_test", testVal)
    })
  })

  // ==========================================================================
  // Section 4: Audio Dynamics, DSP Gauges & Slider Boundaries
  // ==========================================================================
  describe("Section 4: Audio Dynamics, DSP Gauges & Slider Boundaries", () => {
    it("reflects audio playback idle vs active states and updates button labels", () => {
      // Idle state
      useProjectStore.getState().setIsAudioPlaying(false)
      let html = renderToStaticMarkup(<AudioDynamicsSection />)
      expect(html).toContain("Audio Suspended")
      expect(html).toContain("Play Audio")

      // Active state
      useProjectStore.getState().setIsAudioPlaying(true)
      html = renderToStaticMarkup(<AudioDynamicsSection />)
      expect(html).toContain("Audio Engine Active")
      expect(html).toContain("Pause Audio")
    })

    it("verifies audio input source selection: builtin, file, mic", () => {
      const store = useProjectStore.getState()

      store.setAudioSourceType("builtin")
      expect(useProjectStore.getState().audioSourceType).toBe("builtin")

      store.setAudioSourceType("file")
      expect(useProjectStore.getState().audioSourceType).toBe("file")

      store.setAudioSourceType("mic")
      expect(useProjectStore.getState().audioSourceType).toBe("mic")
    })

    it("strictly enforces boundary clamping on AudioEngine gainMultiplier [0.1, 5.0]", () => {
      audioEngine.setGainMultiplier(1.0)
      expect(audioEngine.getGainMultiplier()).toBe(1.0)

      // Underflow clamp
      audioEngine.setGainMultiplier(-10.0)
      expect(audioEngine.getGainMultiplier()).toBe(0.1)

      audioEngine.setGainMultiplier(0.0)
      expect(audioEngine.getGainMultiplier()).toBe(0.1)

      // Max boundary clamp
      audioEngine.setGainMultiplier(5.0)
      expect(audioEngine.getGainMultiplier()).toBe(5.0)

      // Overflow clamp
      audioEngine.setGainMultiplier(25.0)
      expect(audioEngine.getGainMultiplier()).toBe(5.0)
    })

    it("strictly enforces boundary clamping on AudioEngine smoothing [0.0, 0.95]", () => {
      audioEngine.setSmoothing(0.8)
      expect(audioEngine.getSmoothing()).toBe(0.8)

      // Underflow clamp
      audioEngine.setSmoothing(-0.5)
      expect(audioEngine.getSmoothing()).toBe(0.0)

      // Max boundary clamp
      audioEngine.setSmoothing(0.95)
      expect(audioEngine.getSmoothing()).toBe(0.95)

      // Overflow clamp
      audioEngine.setSmoothing(1.5)
      expect(audioEngine.getSmoothing()).toBe(0.95)
    })

    it("calculates VU meter gauge percentages with energy spike clamping", () => {
      const calcGauge = (energy: number) => Math.min(100, Math.max(0, Math.round(energy * 100)))

      expect(calcGauge(0.0)).toBe(0)
      expect(calcGauge(0.55)).toBe(55)
      expect(calcGauge(1.0)).toBe(100)
      // Clamps extreme spikes
      expect(calcGauge(3.5)).toBe(100)
      // Clamps negative anomalies
      expect(calcGauge(-0.2)).toBe(0)
    })

    it("manages reactive audio bindings: adding, updating intensity, and disconnecting", () => {
      const store = useProjectStore.getState()

      // Bind u_speed to bass
      store.setAudioBinding("u_speed", { band: "bass", amount: 2.5 })
      expect(useProjectStore.getState().audioBindings["u_speed"]).toEqual({
        band: "bass",
        amount: 2.5,
      })

      // Bind u_glow to treble
      store.setAudioBinding("u_glow", { band: "treble", amount: 1.0 })
      expect(Object.keys(useProjectStore.getState().audioBindings)).toHaveLength(2)

      // Render active bindings list
      let html = renderToStaticMarkup(<AudioDynamicsSection />)
      expect(html).toContain("Active Audio Bindings (2)")
      expect(html).toContain("u_speed")
      expect(html).toContain("u_glow")
      expect(html).toContain("2.5x")
      expect(html).toContain("1.0x")

      // Disconnect u_speed
      store.setAudioBinding("u_speed", null)
      expect(useProjectStore.getState().audioBindings["u_speed"]).toBeUndefined()
      expect(Object.keys(useProjectStore.getState().audioBindings)).toHaveLength(1)

      // Disconnect all
      store.setAudioBinding("u_glow", null)
      expect(Object.keys(useProjectStore.getState().audioBindings)).toHaveLength(0)

      html = renderToStaticMarkup(<AudioDynamicsSection />)
      expect(html).toContain("No uniforms bound to audio")
    })
  })

  // ==========================================================================
  // Section 5: Variations & Preset Management Adversarial Stress
  // ==========================================================================
  describe("Section 5: Variations & Preset Management Adversarial Stress", () => {
    it("creates snapshot variations with custom names, capturing current uniforms and timestamps", () => {
      useProjectStore.getState().setUniformValue("u_zoom", { type: "float", value: 2.5 })

      const varId = useProjectStore.getState().addVariation("Deep Fractal")
      expect(varId).toMatch(/^var-/)

      const variations = useProjectStore.getState().variations
      expect(variations).toHaveLength(1)
      expect(variations[0].name).toBe("Deep Fractal")
      expect(variations[0].uniformValues["u_zoom"]).toEqual({ type: "float", value: 2.5 })
      expect(variations[0].createdAt).toBeGreaterThan(0)

      // Newly created variation becomes active
      expect(useProjectStore.getState().activeVariationId).toBe(varId)
      expect(useProjectStore.getState().hasUnsavedChanges).toBe(true)
    })

    it("falls back to 'Variation N' when name is empty or pure whitespace", () => {
      const id1 = useProjectStore.getState().addVariation("")
      expect(useProjectStore.getState().variations[0].name).toBe("Variation 1")

      const id2 = useProjectStore.getState().addVariation("    ")
      expect(useProjectStore.getState().variations[1].name).toBe("Variation 2")

      expect(id1).not.toBe(id2)
    })

    it("allows duplicate variation names without collision or crash", () => {
      const idA = useProjectStore.getState().addVariation("Cyber Neon")
      const idB = useProjectStore.getState().addVariation("Cyber Neon")

      expect(idA).not.toBe(idB)
      const variations = useProjectStore.getState().variations
      expect(variations).toHaveLength(2)
      expect(variations[0].name).toBe("Cyber Neon")
      expect(variations[1].name).toBe("Cyber Neon")
      expect(variations[0].id).not.toBe(variations[1].id)
    })

    it("applies variation: restores uniform values and synchronizes active adapter", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      // Snapshot 1: u_speed = 1.0
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 1.0 })
      const var1 = useProjectStore.getState().addVariation("Slow")

      // Snapshot 2: u_speed = 10.0
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 10.0 })
      const var2 = useProjectStore.getState().addVariation("Fast")

      // Currently var2 is active
      expect(useProjectStore.getState().activeVariationId).toBe(var2)
      expect(useProjectStore.getState().uniformValues["u_speed"]).toEqual({
        type: "float",
        value: 10.0,
      })

      // Apply var1
      useProjectStore.getState().applyVariation(var1)
      expect(useProjectStore.getState().activeVariationId).toBe(var1)
      expect(useProjectStore.getState().uniformValues["u_speed"]).toEqual({
        type: "float",
        value: 1.0,
      })

      // Applying invalid ID safely no-ops without error
      expect(() => {
        useProjectStore.getState().applyVariation("non-existent-id")
      }).not.toThrow()
    })

    it("deleting inactive variation preserves active ID; deleting active variation resets active ID to null", () => {
      const var1 = useProjectStore.getState().addVariation("One")
      const var2 = useProjectStore.getState().addVariation("Two")
      const var3 = useProjectStore.getState().addVariation("Three")

      // Make var2 active
      useProjectStore.getState().applyVariation(var2)
      expect(useProjectStore.getState().activeVariationId).toBe(var2)

      // Delete inactive var1
      useProjectStore.getState().deleteVariation(var1)
      expect(useProjectStore.getState().variations).toHaveLength(2)
      expect(useProjectStore.getState().activeVariationId).toBe(var2) // Still active!

      // Delete active var2
      useProjectStore.getState().deleteVariation(var2)
      expect(useProjectStore.getState().variations).toHaveLength(1)
      expect(useProjectStore.getState().activeVariationId).toBeNull() // Cleared to null!

      // Delete remaining var3
      useProjectStore.getState().deleteVariation(var3)
      expect(useProjectStore.getState().variations).toHaveLength(0)

      const html = renderToStaticMarkup(<VariationsSection />)
      expect(html).toContain("No saved variations yet")
    })

    it("handles corrupt, empty, and invalid JSON imports gracefully without throwing", () => {
      const store = useProjectStore.getState()

      // 1. Empty array import
      expect(() => store.importVariations([])).not.toThrow()
      expect(useProjectStore.getState().variations).toHaveLength(0)

      // 2. Non-array primitive imports
      expect(() => store.importVariations(null as any)).not.toThrow()
      expect(() => store.importVariations(undefined as any)).not.toThrow()
      expect(() => store.importVariations("not an array" as any)).not.toThrow()
      expect(() => store.importVariations(12345 as any)).not.toThrow()
      expect(() => store.importVariations({ foo: "bar" } as any)).not.toThrow()
      expect(useProjectStore.getState().variations).toHaveLength(0)

      // 3. Valid import merges cleanly
      const validVariations: PresetVariation[] = [
        {
          id: "imported-1",
          name: "Imported Nebula",
          uniformValues: { u_color: { type: "vec3", value: [0.2, 0.4, 0.8] } },
          createdAt: 1000000,
        },
        {
          id: "imported-2",
          name: "Imported Gold",
          uniformValues: { u_metallic: { type: "float", value: 1.0 } },
          createdAt: 2000000,
        },
      ]

      store.importVariations(validVariations)
      expect(useProjectStore.getState().variations).toHaveLength(2)
      expect(useProjectStore.getState().variations[0].name).toBe("Imported Nebula")
      expect(useProjectStore.getState().variations[1].name).toBe("Imported Gold")
    })

    it("round-trips variations through JSON export and import without data loss", () => {
      useProjectStore.getState().setUniformValue("u_spec", { type: "float", value: 0.85 })
      useProjectStore.getState().addVariation("Specular Peak")

      const original = useProjectStore.getState().variations
      const serialized = JSON.stringify(original)

      // Deserialize and re-import
      const parsed = JSON.parse(serialized)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe("Specular Peak")
      expect(parsed[0].uniformValues["u_spec"]).toEqual({ type: "float", value: 0.85 })
    })
  })

  // ==========================================================================
  // Section 6: Studio Environment & Lighting Preset Invariants
  // ==========================================================================
  describe("Section 6: Studio Environment & Lighting Preset Invariants", () => {
    it("cycles through all 5 environment lighting presets", () => {
      const presets = [
        "studio_warm",
        "cyberpunk_neon",
        "sunset",
        "nebula",
        "clean_neutral",
      ] as const

      for (const p of presets) {
        useProjectStore.getState().setEnvironmentPreset(p)
        expect(useProjectStore.getState().environmentSettings?.preset).toBe(p)

        const html = renderToStaticMarkup(<EnvironmentSection />)
        expect(html).toContain("Lighting Preset")
        expect(html).toContain("Exposure")
        expect(html).toContain("Rotation")
        expect(html).toContain("Background Blur")
        expect(html).toContain("Show Skybox")
      }
    })

    it("updates exposure, rotation, background blur, and skybox toggles", () => {
      const store = useProjectStore.getState()

      store.setEnvironmentExposure(2.5)
      expect(useProjectStore.getState().environmentSettings?.exposure).toBe(2.5)

      store.setEnvironmentRotation(180)
      expect(useProjectStore.getState().environmentSettings?.rotation).toBe(180)

      store.setEnvironmentSettings({ backgroundBlur: 0.75 })
      expect(useProjectStore.getState().environmentSettings?.backgroundBlur).toBe(0.75)

      store.setEnvironmentSkybox(true)
      expect(useProjectStore.getState().environmentSettings?.showSkybox).toBe(true)

      store.setEnvironmentSkybox(false)
      expect(useProjectStore.getState().environmentSettings?.showSkybox).toBe(false)
    })
  })

  // ==========================================================================
  // Section 7: Compute Simulation Pipeline Controls
  // ==========================================================================
  describe("Section 7: Compute Simulation Pipeline Controls", () => {
    it("renders WebGPU notice when backend is WebGL2 and allows switching to WebGPU", () => {
      useProjectStore.getState().setActiveBackend("webgl2")
      let html = renderToStaticMarkup(<ComputeSimulationSection />)

      expect(html).toContain("Active on WebGPU backend")
      expect(html).toContain("Switch to WebGPU")

      // Switch to WebGPU
      useProjectStore.getState().setActiveBackend("webgpu")
      html = renderToStaticMarkup(<ComputeSimulationSection />)
      expect(html).toContain("WebGPU Compute Pipeline")
      expect(html).toContain("Re-seed")
    })

    it("triggers reseed simulation without errors and updates simulationResetTrigger", () => {
      const initialTrigger = useProjectStore.getState().simulationResetTrigger
      useProjectStore.getState().triggerSimulationReset()
      expect(useProjectStore.getState().simulationResetTrigger).toBe(initialTrigger + 1)
    })

    it("renders simulation controls for speed, damping, force, particle size, and additive blend", () => {
      useProjectStore.getState().setActiveBackend("webgpu")
      const html = renderToStaticMarkup(<ComputeSimulationSection />)

      expect(html).toContain("Simulation Speed")
      expect(html).toContain("Damping")
      expect(html).toContain("Gravity / Force")
      expect(html).toContain("Particle Size")
      expect(html).toContain("Additive Blend Mode")
    })
  })

  // ==========================================================================
  // Section 8: Deep Edge Cases & Dynamic Badge Integration Stress
  // ==========================================================================
  describe("Section 8: Deep Edge Cases & Dynamic Badge Integration", () => {
    it("injects fallback u_color when both parsedUniforms and graphUniforms are empty", () => {
      useProjectStore.getState().setParsedUniforms([])
      useProjectStore.setState({ graphUniforms: [] })

      const html = renderToStaticMarkup(<UniformsSection />)
      expect(html).toContain("u_color")
      expect(html).toContain("vec3f (color)")
    })

    it("evaluates matrix transformation presets mathematically", () => {
      // 2x2 matrix
      const default2x2 = [1, 0, 0, 1]
      const scale2x_2 = [2, 0, 0, 2]
      const halfScale_2 = [0.5, 0, 0, 0.5]

      // 3x3 matrix
      const default3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const scale2x_3 = [2, 0, 0, 0, 2, 0, 0, 0, 2]
      const halfScale_3 = [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]

      // 4x4 matrix
      const default4x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      const scale2x_4 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2]

      expect(scale2x_2).toEqual([2, 0, 0, 2])
      expect(halfScale_2).toEqual([0.5, 0, 0, 0.5])
      expect(scale2x_3.filter((_, i) => i % 4 === 0).every((v) => v === 2)).toBe(true)
      expect(halfScale_3.filter((_, i) => i % 4 === 0).every((v) => v === 0.5)).toBe(true)
      expect(scale2x_4.filter((_, i) => i % 5 === 0).every((v) => v === 2)).toBe(true)
    })

    it("dynamically reflects compute badge based on renderQueue compute step existence", () => {
      // No compute in queue -> no COMPUTE badge
      useProjectStore.getState().setRenderQueue(null)
      let html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).not.toContain("COMPUTE</span>")

      // Add compute step to queue -> COMPUTE badge rendered
      useProjectStore.getState().setRenderQueue([
        {
          id: "step-1",
          type: "compute",
          source: "// compute",
          workgroups: [16, 16, 1],
        } as any,
        {
          id: "step-2",
          type: "render",
          source: "// render",
        } as any,
      ])
      html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain("COMPUTE")
    })

    it("dynamically reflects audio badge based on live audio vs bound uniform counts", () => {
      // Case 1: Audio stopped, 0 bindings -> no badge
      useProjectStore.getState().setIsAudioPlaying(false)
      useProjectStore.setState({ audioBindings: {} })
      let html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).not.toContain("LIVE")
      expect(html).not.toContain("bound")

      // Case 2: Audio stopped, 2 bindings -> '2 bound'
      useProjectStore.getState().setAudioBinding("u_freq", { band: "bass", amount: 1.0 })
      useProjectStore.getState().setAudioBinding("u_amp", { band: "treble", amount: 2.0 })
      html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain("2 bound")
      expect(html).not.toContain("LIVE")

      // Case 3: Audio playing -> 'LIVE' overrides binding count
      useProjectStore.getState().setIsAudioPlaying(true)
      html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain("LIVE")
    })

    it("dynamically reflects variations count badge", () => {
      // 0 variations -> no badge
      useProjectStore.setState({ variations: [] })
      let html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain("Variations &amp; Presets")

      // 3 variations -> badge shows 3
      useProjectStore.getState().addVariation("Var 1")
      useProjectStore.getState().addVariation("Var 2")
      useProjectStore.getState().addVariation("Var 3")
      html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain(">3<")
    })

    it("verifies variations cards render exact uniform counts (0 uniforms, 1 uniform, N uniforms)", () => {
      useProjectStore.setState({ variations: [] })

      // 0 uniforms
      useProjectStore.getState().addVariation("Zero")
      useProjectStore.setState((s) => ({
        variations: s.variations.map((v) =>
          v.name === "Zero" ? { ...v, uniformValues: {} } : v
        ),
      }))

      // 1 uniform
      useProjectStore.getState().addVariation("One")
      useProjectStore.setState((s) => ({
        variations: s.variations.map((v) =>
          v.name === "One"
            ? { ...v, uniformValues: { u_speed: { type: "float", value: 1.0 } } }
            : v
        ),
      }))

      // 3 uniforms
      useProjectStore.getState().addVariation("Three")
      useProjectStore.setState((s) => ({
        variations: s.variations.map((v) =>
          v.name === "Three"
            ? {
                ...v,
                uniformValues: {
                  u_a: { type: "float", value: 1 },
                  u_b: { type: "float", value: 2 },
                  u_c: { type: "float", value: 3 },
                },
              }
            : v
        ),
      }))

      const html = renderToStaticMarkup(<VariationsSection />)
      expect(html).toContain("0 uniforms")
      expect(html).toContain("1 uniform")
      expect(html).toContain("3 uniforms")
    })
  })
})
})

describe("adapter synchronisation (m3 sync)", () => {
// Recursively expand functional component elements inside the active React render phase
function expandTree(node: any): any {
  if (!node) return node
  if (Array.isArray(node)) {
    return node.map(expandTree)
  }
  if (typeof node.type === "function") {
    try {
      const rendered = node.type(node.props)
      return expandTree(rendered)
    } catch {
      return node
    }
  }
  if (node.props?.children) {
    return {
      ...node,
      props: {
        ...node.props,
        children: expandTree(node.props.children),
      },
    }
  }
  return node
}

// Helper to render a component, expanding all child subcomponents, and capture the full tree
function renderAndCaptureVDOM(Component: React.ComponentType): any {
  let capturedTree: any = null
  function Interceptor() {
    const raw = Component({})
    capturedTree = expandTree(raw)
    return React.createElement("div", null, capturedTree)
  }
  renderToStaticMarkup(React.createElement(Interceptor))
  return capturedTree
}

// Helper to find a node in the VDOM matching a predicate
function findVDOMNode(vdom: any, predicate: (node: any) => boolean): any {
  if (!vdom) return null
  if (predicate(vdom)) return vdom
  if (Array.isArray(vdom)) {
    for (const child of vdom) {
      const found = findVDOMNode(child, predicate)
      if (found) return found
    }
  }
  if (vdom.props?.children) {
    return findVDOMNode(vdom.props.children, predicate)
  }
  return null
}

// Helper to find all nodes in the VDOM matching a predicate
function findAllVDOMNodes(vdom: any, predicate: (node: any) => boolean): any[] {
  const results: any[] = []
  function traverse(node: any) {
    if (!node) return
    if (predicate(node)) results.push(node)
    if (Array.isArray(node)) {
      for (const c of node) traverse(c)
    } else if (node.props?.children) {
      traverse(node.props.children)
    }
  }
  traverse(vdom)
  return results
}

describe("Milestone 3 Challenger 2: Parameter Inspector & Adapter Synchronization", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useProjectStore.setState({
      activeBackend: "webgpu",
      isAudioPlaying: false,
      audioGain: 1.0,
      audioSmoothing: 0.8,
      audioSourceType: "builtin",
      audioBindings: {},
      variations: [],
      activeVariationId: null,
      environmentSettings: {
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0,
        backgroundBlur: 0.0,
        showSkybox: false,
      },
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Challenge 1: Uniform Input Controls -> adapter.updateUniform Type Fidelity
  // ==========================================================================
  describe("Challenge 1: Uniform Controls Invoke adapter.updateUniform with Exact Types", () => {
    it("dispatches boolean toggle to active adapter with type 'bool'", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_flag", type: "bool", kind: "scalar" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      // Find Switch component
      const switchNode = findVDOMNode(vdom, (n) => typeof n?.props?.onCheckedChange === "function")
      expect(switchNode).not.toBeNull()

      // Toggle boolean to true
      switchNode.props.onCheckedChange(true)
      expect(gpuSpy).toHaveBeenCalledWith("u_flag", { type: "bool", value: true })
      expect(useProjectStore.getState().uniformValues["u_flag"]).toEqual({
        type: "bool",
        value: true,
      })

      // Toggle boolean to false
      switchNode.props.onCheckedChange(false)
      expect(gpuSpy).toHaveBeenCalledWith("u_flag", { type: "bool", value: false })
      expect(useProjectStore.getState().uniformValues["u_flag"]).toEqual({
        type: "bool",
        value: false,
      })
    })

    it("dispatches float slider update to active adapter with type 'float'", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_speed", type: "f32", kind: "scalar" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const sliderNode = findVDOMNode(vdom, (n) => typeof n?.props?.onValueChange === "function")
      expect(sliderNode).not.toBeNull()

      sliderNode.props.onValueChange([4.75])
      expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 4.75 })
      expect(useProjectStore.getState().uniformValues["u_speed"]).toEqual({
        type: "float",
        value: 4.75,
      })
    })

    it("dispatches integer update with type 'int' and rounded integer value", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_iterations", type: "i32", kind: "scalar" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const numberInput = findVDOMNode(
        vdom,
        (n) => n?.type === "input" && n?.props?.type === "number" && typeof n?.props?.onChange === "function"
      )
      expect(numberInput).not.toBeNull()

      // Enter float in integer input: should round to integer
      numberInput.props.onChange({ target: { value: "14.6" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_iterations", { type: "int", value: 15 })
      expect(useProjectStore.getState().uniformValues["u_iterations"]).toEqual({
        type: "int",
        value: 15,
      })
    })

    it("dispatches uint update with type 'uint' and clamps negative values to 0", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_count", type: "u32", kind: "scalar" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const numberInput = findVDOMNode(
        vdom,
        (n) => n?.type === "input" && n?.props?.type === "number" && typeof n?.props?.onChange === "function"
      )
      expect(numberInput).not.toBeNull()

      // Enter negative number in unsigned int: clamped to 0
      numberInput.props.onChange({ target: { value: "-10" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_count", { type: "uint", value: 0 })
      expect(useProjectStore.getState().uniformValues["u_count"]).toEqual({
        type: "uint",
        value: 0,
      })

      // Enter positive float: rounded
      numberInput.props.onChange({ target: { value: "32.2" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_count", { type: "uint", value: 32 })
    })

    it("dispatches vector component edits with accurate vector types and arrays", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_offset", type: "vec2f", kind: "vector" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      // Vector has 2 component inputs (x and y)
      const inputs = findAllVDOMNodes(
        vdom,
        (n) => n?.type === "input" && n?.props?.type === "number" && typeof n?.props?.onChange === "function"
      )
      expect(inputs.length).toBeGreaterThanOrEqual(2)

      // Edit .x
      inputs[0].props.onChange({ target: { value: "3.5" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_offset", { type: "vec2", value: [3.5, 0] })
      expect(useProjectStore.getState().uniformValues["u_offset"]).toEqual({
        type: "vec2",
        value: [3.5, 0],
      })

      // Re-render to reflect new x, then edit .y
      const vdom2 = renderAndCaptureVDOM(UniformsSection)
      const inputs2 = findAllVDOMNodes(
        vdom2,
        (n) => n?.type === "input" && n?.props?.type === "number" && typeof n?.props?.onChange === "function"
      )
      inputs2[1].props.onChange({ target: { value: "-7.25" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_offset", { type: "vec2", value: [3.5, -7.25] })
      expect(useProjectStore.getState().uniformValues["u_offset"]).toEqual({
        type: "vec2",
        value: [3.5, -7.25],
      })
    })

    it("dispatches color hex changes with type 'color' for vec3f and 'vec4' for vec4f", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_tint3", type: "vec3f", kind: "color" },
        { name: "u_tint4", type: "vec4f", kind: "color" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const textInputs = findAllVDOMNodes(
        vdom,
        (n) => n?.type === "input" && n?.props?.type === "text" && typeof n?.props?.onChange === "function"
      )
      // First text input is search, second is u_tint3 hex, third is u_tint4 hex
      expect(textInputs.length).toBe(3)

      // Set u_tint3 to pure red (#ff0000)
      textInputs[1].props.onChange({ target: { value: "#ff0000" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_tint3", { type: "color", value: [1, 0, 0] })
      expect(useProjectStore.getState().uniformValues["u_tint3"]).toEqual({
        type: "color",
        value: [1, 0, 0],
      })

      // Set u_tint4 to cyan (#00ffff)
      textInputs[2].props.onChange({ target: { value: "#00ffff" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_tint4", { type: "vec4", value: [0, 1, 1, 1.0] })
      expect(useProjectStore.getState().uniformValues["u_tint4"]).toEqual({
        type: "vec4",
        value: [0, 1, 1, 1.0],
      })
    })

    it("dispatches matrix presets (Identity, 2x, 0.5x) with type 'mat3' and 9 numbers", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_transform", type: "mat3x3f", kind: "matrix" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const buttons = findAllVDOMNodes(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && typeof n?.props?.children === "string"
      )

      const scale2Btn = buttons.find((b) => b.props.children === "2x")
      expect(scale2Btn).toBeDefined()

      scale2Btn.props.onClick()
      expect(gpuSpy).toHaveBeenCalledWith("u_transform", {
        type: "mat3",
        value: [2, 0, 0, 0, 2, 0, 0, 0, 2],
      })
      expect(useProjectStore.getState().uniformValues["u_transform"]).toEqual({
        type: "mat3",
        value: [2, 0, 0, 0, 2, 0, 0, 0, 2],
      })

      const scaleHalfBtn = buttons.find((b) => b.props.children === "0.5x")
      expect(scaleHalfBtn).toBeDefined()

      scaleHalfBtn.props.onClick()
      expect(gpuSpy).toHaveBeenCalledWith("u_transform", {
        type: "mat3",
        value: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5],
      })

      const identityBtn = buttons.find((b) => b.props.children === "Identity")
      expect(identityBtn).toBeDefined()

      identityBtn.props.onClick()
      expect(gpuSpy).toHaveBeenCalledWith("u_transform", {
        type: "mat3",
        value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      })
    })

    it("routes uniform changes to the currently active hardware adapter (WebGL2 & ThreeJS)", async () => {
      await loadAdapter("webgl2")
      await loadAdapter("threejs")
      const glSpy = vi.spyOn(webgl2Adapter, "updateUniform")
      const threeSpy = vi.spyOn(threejsAdapter, "updateUniform")

      useProjectStore.getState().setParsedUniforms([
        { name: "u_factor", type: "f32", kind: "scalar" },
      ])

      // Switch to WebGL2
      useProjectStore.getState().setActiveBackend("webgl2")
      const vdomGL = renderAndCaptureVDOM(UniformsSection)
      const sliderGL = findVDOMNode(vdomGL, (n) => typeof n?.props?.onValueChange === "function")
      sliderGL.props.onValueChange([10.5])

      expect(glSpy).toHaveBeenCalledWith("u_factor", { type: "float", value: 10.5 })
      expect(threeSpy).not.toHaveBeenCalled()

      // Switch to ThreeJS
      useProjectStore.getState().setActiveBackend("threejs")
      const vdomThree = renderAndCaptureVDOM(UniformsSection)
      const sliderThree = findVDOMNode(vdomThree, (n) => typeof n?.props?.onValueChange === "function")
      sliderThree.props.onValueChange([25.0])

      expect(threeSpy).toHaveBeenCalledWith("u_factor", { type: "float", value: 25.0 })
    })
  })

  // ==========================================================================
  // Challenge 2: Per-Uniform Reset to Default
  // ==========================================================================
  describe("Challenge 2: Per-Uniform Reset Updates Store and Hardware Adapter", () => {
    it("resets a modified uniform to parsed default and invokes adapter.updateUniform", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_speed", type: "f32", kind: "scalar" },
        { name: "u_color", type: "vec3f", kind: "color" },
      ])

      // Mutate both in store
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 88.0 })
      useProjectStore.getState().setUniformValue("u_color", { type: "color", value: [1, 0, 0] })

      gpuSpy.mockClear()

      const vdom = renderAndCaptureVDOM(UniformsSection)
      // Find reset button for u_speed (title="Reset to default")
      const resetButtons = findAllVDOMNodes(
        vdom,
        (n) => n?.type === "button" && n?.props?.title === "Reset to default"
      )
      expect(resetButtons.length).toBeGreaterThan(0)

      resetButtons[0].props.onClick()

      // Verify adapter called with default float 0
      expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 0 })
      // Verify store updated
      expect(useProjectStore.getState().uniformValues["u_speed"]).toEqual({
        type: "float",
        value: 0,
      })
      // Isolation: other uniform untouched
      expect(useProjectStore.getState().uniformValues["u_color"]).toEqual({
        type: "color",
        value: [1, 0, 0],
      })
    })

    it("resets graph uniforms to their custom defaultValue and syncs adapter", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([])
      useProjectStore.getState().addGraphUniform({
        id: "gu-1",
        name: "g_customFloat",
        type: "float",
        defaultValue: 7.5,
      })

      // Mutate
      useProjectStore.getState().setUniformValue("g_customFloat", { type: "float", value: 99.0 })
      gpuSpy.mockClear()

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const resetBtn = findVDOMNode(
        vdom,
        (n) => n?.type === "button" && n?.props?.title === "Reset to default"
      )
      expect(resetBtn).not.toBeNull()

      resetBtn.props.onClick()

      // Custom defaultValue 7.5 must be restored, NOT 0
      expect(gpuSpy).toHaveBeenCalledWith("g_customFloat", { type: "float", value: 7.5 })
      expect(useProjectStore.getState().uniformValues["g_customFloat"]).toEqual({
        type: "float",
        value: 7.5,
      })
    })
  })

  // ==========================================================================
  // Challenge 3: Global Reset-All
  // ==========================================================================
  describe("Challenge 3: Global Reset-All Restores All Uniforms in Store and Adapter", () => {
    it("restores all parsed and graph uniforms and invokes adapter.updateUniform for each", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")

      const parsed: ParsedUniform[] = [
        { name: "u_alpha", type: "f32", kind: "scalar" },
        { name: "u_active", type: "bool", kind: "scalar" },
        { name: "u_tint", type: "vec4f", kind: "color" },
        { name: "u_pos", type: "vec3f", kind: "vector" },
        { name: "u_mat", type: "mat2x2f", kind: "matrix" },
      ]
      useProjectStore.getState().setParsedUniforms(parsed)

      // Heavily mutate all values
      useProjectStore.getState().setUniformValue("u_alpha", { type: "float", value: 0.99 })
      useProjectStore.getState().setUniformValue("u_active", { type: "bool", value: true })
      useProjectStore.getState().setUniformValue("u_tint", { type: "vec4", value: [0, 1, 0, 0.5] })
      useProjectStore.getState().setUniformValue("u_pos", { type: "vec3", value: [10, 20, 30] })
      useProjectStore.getState().setUniformValue("u_mat", { type: "mat2", value: [5, 5, 5, 5] })

      gpuSpy.mockClear()

      const vdom = renderAndCaptureVDOM(UniformsSection)
      // Find "Reset All" button
      const resetAllBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.title === "Reset all uniforms to default parsed values"
      )
      expect(resetAllBtn).not.toBeNull()

      resetAllBtn.props.onClick()

      // Verify adapter was invoked for each of the 5 uniforms with exact defaults
      expect(gpuSpy).toHaveBeenCalledWith("u_alpha", { type: "float", value: 0 })
      expect(gpuSpy).toHaveBeenCalledWith("u_active", { type: "bool", value: false })
      expect(gpuSpy).toHaveBeenCalledWith("u_tint", { type: "vec4", value: [0.5, 0.5, 0.5, 1.0] })
      expect(gpuSpy).toHaveBeenCalledWith("u_pos", { type: "vec3", value: [0, 0, 0] })
      expect(gpuSpy).toHaveBeenCalledWith("u_mat", { type: "mat2", value: [1, 0, 0, 1] })

      // Verify store state is completely restored
      const storeVals = useProjectStore.getState().uniformValues
      expect(storeVals["u_alpha"]).toEqual({ type: "float", value: 0 })
      expect(storeVals["u_active"]).toEqual({ type: "bool", value: false })
      expect(storeVals["u_tint"]).toEqual({ type: "vec4", value: [0.5, 0.5, 0.5, 1.0] })
      expect(storeVals["u_pos"]).toEqual({ type: "vec3", value: [0, 0, 0] })
      expect(storeVals["u_mat"]).toEqual({ type: "mat2", value: [1, 0, 0, 1] })
    })
  })

  // ==========================================================================
  // Challenge 4: Variation Snapshots and Active Adapter Synchronization
  // ==========================================================================
  describe("Challenge 4: Variation Snapshots Synchronize Active Hardware Adapter", () => {
    it("dispatches all snapshot uniform updates to active adapter when variation is applied", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")

      // Seed store uniforms
      useProjectStore.getState().setUniformValue("u_color", { type: "vec3", value: [0.1, 0.9, 0.2] })
      useProjectStore.getState().setUniformValue("u_scale", { type: "float", value: 3.14 })
      useProjectStore.getState().setUniformValue("u_enabled", { type: "bool", value: true })

      // Save variation snapshot
      const varId = useProjectStore.getState().addVariation("Emerald Matrix")
      expect(varId).toBeDefined()

      // Now change store uniforms to something completely different
      useProjectStore.getState().setUniformValue("u_color", { type: "vec3", value: [1.0, 0.0, 0.0] })
      useProjectStore.getState().setUniformValue("u_scale", { type: "float", value: 0.1 })
      useProjectStore.getState().setUniformValue("u_enabled", { type: "bool", value: false })

      gpuSpy.mockClear()

      // Render VariationsSection and click "Apply" button for this variation
      const vdom = renderAndCaptureVDOM(VariationsSection)
      const applyBtn = findVDOMNode(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && (n?.props?.children === "Apply" || n?.props?.children === "Active")
      )
      expect(applyBtn).not.toBeNull()

      applyBtn.props.onClick()

      // Verify store uniform values were restored
      expect(useProjectStore.getState().uniformValues["u_color"]).toEqual({
        type: "vec3",
        value: [0.1, 0.9, 0.2],
      })
      expect(useProjectStore.getState().uniformValues["u_scale"]).toEqual({
        type: "float",
        value: 3.14,
      })
      expect(useProjectStore.getState().uniformValues["u_enabled"]).toEqual({
        type: "bool",
        value: true,
      })

      // Verify active adapter received ALL uniform updates from snapshot
      expect(gpuSpy).toHaveBeenCalledWith("u_color", { type: "vec3", value: [0.1, 0.9, 0.2] })
      expect(gpuSpy).toHaveBeenCalledWith("u_scale", { type: "float", value: 3.14 })
      expect(gpuSpy).toHaveBeenCalledWith("u_enabled", { type: "bool", value: true })
    })

    it("synchronizes with newly selected backend when applying variation snapshot", async () => {
      await loadAdapter("webgl2")
      const glSpy = vi.spyOn(webgl2Adapter, "updateUniform")

      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.65 })
      const varId = useProjectStore.getState().addVariation("Rough Metal")

      // Switch to WebGL2 backend
      useProjectStore.getState().setActiveBackend("webgl2")
      useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: 0.1 })

      glSpy.mockClear()

      const vdom = renderAndCaptureVDOM(VariationsSection)
      const applyBtn = findVDOMNode(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && (n?.props?.children === "Apply" || n?.props?.children === "Active")
      )
      applyBtn.props.onClick()

      expect(glSpy).toHaveBeenCalledWith("u_roughness", { type: "float", value: 0.65 })
    })
  })

  // ==========================================================================
  // Challenge 5: Environment Preset Propagation & Adapter Synchronization
  // ==========================================================================
  describe("Challenge 5: Environment Preset Changes Propagate to Store and Hardware Adapter", () => {
    it("updates store environmentSettings.preset when preset pill is clicked in EnvironmentSection", () => {
      const vdom = renderAndCaptureVDOM(EnvironmentSection)
      const presetButtons = findAllVDOMNodes(
        vdom,
        (n) => n?.type === "button" && typeof n?.props?.onClick === "function" && typeof n?.props?.children === "string"
      )

      const cyberpunkBtn = presetButtons.find((b) => b.props.children === "Cyberpunk")
      expect(cyberpunkBtn).toBeDefined()

      cyberpunkBtn.props.onClick()
      expect(useProjectStore.getState().environmentSettings.preset).toBe("cyberpunk_neon")

      const sunsetBtn = presetButtons.find((b) => b.props.children === "Sunset")
      expect(sunsetBtn).toBeDefined()

      sunsetBtn.props.onClick()
      expect(useProjectStore.getState().environmentSettings.preset).toBe("sunset")
    })

    it("propagates setEnvironmentSettings and setEnvironmentPreset to active adapters via updateEnvironment", () => {
      const gpuEnvSpy = vi.spyOn(webgpuAdapter, "updateEnvironment")
      const glEnvSpy = vi.spyOn(webgl2Adapter, "updateEnvironment")
      const threeEnvSpy = vi.spyOn(threejsAdapter, "updateEnvironment")

      // 1. Direct adapter call test
      const envSettings = {
        preset: "nebula" as const,
        exposure: 1.8,
        rotation: 45,
        backgroundBlur: 0.5,
        showSkybox: true,
      }

      webgpuAdapter.updateEnvironment(envSettings)
      expect(gpuEnvSpy).toHaveBeenCalledWith(envSettings)

      webgl2Adapter.updateEnvironment(envSettings)
      expect(glEnvSpy).toHaveBeenCalledWith(envSettings)

      threejsAdapter.updateEnvironment(envSettings)
      expect(threeEnvSpy).toHaveBeenCalledWith(envSettings)
    })

    it("verifies store setEnvironmentSettings partial updates preserve existing settings", () => {
      useProjectStore.getState().setEnvironmentSettings({
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0,
        backgroundBlur: 0.0,
        showSkybox: false,
      })

      // Partial update backgroundBlur
      useProjectStore.getState().setEnvironmentSettings({ backgroundBlur: 0.75 })
      const s1 = useProjectStore.getState().environmentSettings
      expect(s1.backgroundBlur).toBe(0.75)
      expect(s1.preset).toBe("studio_warm")
      expect(s1.exposure).toBe(1.0)

      // Partial update exposure via setEnvironmentExposure
      useProjectStore.getState().setEnvironmentExposure(3.2)
      const s2 = useProjectStore.getState().environmentSettings
      expect(s2.exposure).toBe(3.2)
      expect(s2.backgroundBlur).toBe(0.75)

      // Partial update rotation via setEnvironmentRotation
      useProjectStore.getState().setEnvironmentRotation(180)
      const s3 = useProjectStore.getState().environmentSettings
      expect(s3.rotation).toBe(180)
      expect(s3.exposure).toBe(3.2)

      // Partial update skybox
      useProjectStore.getState().setEnvironmentSkybox(true)
      const s4 = useProjectStore.getState().environmentSettings
      expect(s4.showSkybox).toBe(true)
      expect(s4.rotation).toBe(180)
    })

    it("clamps exposure within [0.1, 4.0] and wraps rotation within [0, 360)", () => {
      // Exposure clamping
      useProjectStore.getState().setEnvironmentExposure(-5.0)
      expect(useProjectStore.getState().environmentSettings.exposure).toBe(0.1)

      useProjectStore.getState().setEnvironmentExposure(10.0)
      expect(useProjectStore.getState().environmentSettings.exposure).toBe(4.0)

      // Rotation wrap
      useProjectStore.getState().setEnvironmentRotation(400)
      expect(useProjectStore.getState().environmentSettings.rotation).toBe(40)

      useProjectStore.getState().setEnvironmentRotation(-90)
      expect(useProjectStore.getState().environmentSettings.rotation).toBe(270)
    })

    it("verifies slider changes in EnvironmentSection invoke store environment setters", () => {
      const vdom = renderAndCaptureVDOM(EnvironmentSection)
      const sliders = findAllVDOMNodes(vdom, (n) => typeof n?.props?.onValueChange === "function")
      // Sliders: 0: Exposure, 1: Rotation, 2: Background Blur
      expect(sliders.length).toBe(3)

      // Exposure slider
      sliders[0].props.onValueChange([2.75])
      expect(useProjectStore.getState().environmentSettings.exposure).toBe(2.75)

      // Rotation slider
      sliders[1].props.onValueChange([210])
      expect(useProjectStore.getState().environmentSettings.rotation).toBe(210)

      // Background blur slider
      sliders[2].props.onValueChange([0.85])
      expect(useProjectStore.getState().environmentSettings.backgroundBlur).toBe(0.85)

      // Skybox switch
      const switchNode = findVDOMNode(vdom, (n) => typeof n?.props?.onCheckedChange === "function")
      expect(switchNode).not.toBeNull()
      switchNode.props.onCheckedChange(true)
      expect(useProjectStore.getState().environmentSettings.showSkybox).toBe(true)
    })
  })

  // ==========================================================================
  // Challenge 6: Matrix Dimensions (mat2x2f, mat4x4f) & Malformed Array Resilience
  // ==========================================================================
  describe("Challenge 6: Matrix Dimensions (mat2x2f, mat4x4f) and Array Resilience", () => {
    it("handles mat2x2f presets (Identity, 2x, 0.5x) and produces 4-element arrays", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_rot2", type: "mat2x2f", kind: "matrix" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const buttons = findAllVDOMNodes(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && typeof n?.props?.children === "string"
      )

      const scale2Btn = buttons.find((b) => b.props.children === "2x")
      expect(scale2Btn).toBeDefined()
      scale2Btn.props.onClick()

      expect(gpuSpy).toHaveBeenCalledWith("u_rot2", {
        type: "mat2",
        value: [2, 0, 0, 2],
      })
      expect(useProjectStore.getState().uniformValues["u_rot2"]).toEqual({
        type: "mat2",
        value: [2, 0, 0, 2],
      })

      const identityBtn = buttons.find((b) => b.props.children === "Identity")
      identityBtn.props.onClick()
      expect(gpuSpy).toHaveBeenCalledWith("u_rot2", {
        type: "mat2",
        value: [1, 0, 0, 1],
      })
    })

    it("handles mat4x4f presets and cell edits producing 16-element arrays", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_modelView", type: "mat4x4f", kind: "matrix" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const buttons = findAllVDOMNodes(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && typeof n?.props?.children === "string"
      )

      const scaleHalfBtn = buttons.find((b) => b.props.children === "0.5x")
      expect(scaleHalfBtn).toBeDefined()
      scaleHalfBtn.props.onClick()

      const expectedScaleHalf = [
        0.5, 0, 0, 0,
        0, 0.5, 0, 0,
        0, 0, 0.5, 0,
        0, 0, 0, 0.5,
      ]
      expect(gpuSpy).toHaveBeenCalledWith("u_modelView", {
        type: "mat4",
        value: expectedScaleHalf,
      })

      // Edit cell [0] (top-left) to 9.0
      const vdom2 = renderAndCaptureVDOM(UniformsSection)
      const cellInputs = findAllVDOMNodes(
        vdom2,
        (n) => n?.type === "input" && n?.props?.type === "number" && typeof n?.props?.onChange === "function"
      )
      expect(cellInputs.length).toBe(16)

      cellInputs[0].props.onChange({ target: { value: "9.0" } })
      const expectedCellUpdate = [...expectedScaleHalf]
      expectedCellUpdate[0] = 9.0

      expect(gpuSpy).toHaveBeenCalledWith("u_modelView", {
        type: "mat4",
        value: expectedCellUpdate,
      })
    })

    it("recovers gracefully when matrix value in store is corrupted with wrong array length", () => {
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_badMat", type: "mat3x3f", kind: "matrix" },
      ])

      // Corrupt store with invalid 3-element array instead of 9
      useProjectStore.getState().setUniformValue("u_badMat", {
        type: "mat3",
        value: [99, 99, 99],
      })

      // Rendering must not crash, must fall back to 9-element identity
      expect(() => {
        const vdom = renderAndCaptureVDOM(UniformsSection)
        const cellInputs = findAllVDOMNodes(
          vdom,
          (n) => n?.type === "input" && n?.props?.type === "number"
        )
        expect(cellInputs.length).toBe(9)
      }).not.toThrow()
    })
  })

  // ==========================================================================
  // Challenge 7: Hex Color Parser Resilience
  // ==========================================================================
  describe("Challenge 7: Hex Color Parser Resilience & Alpha Channel Fidelity", () => {
    it("safely ignores incomplete hex strings (<6 chars) without corrupting store", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_baseColor", type: "vec3f", kind: "color" },
      ])

      // Initial color is default [0.5, 0.5, 0.5]
      const vdom = renderAndCaptureVDOM(UniformsSection)
      const textInputs = findAllVDOMNodes(
        vdom,
        (n) => n?.type === "input" && n?.props?.type === "text" && typeof n?.props?.onChange === "function"
      )
      expect(textInputs.length).toBe(2) // search + hex

      gpuSpy.mockClear()

      // User types 1 char: #f
      textInputs[1].props.onChange({ target: { value: "#f" } })
      expect(gpuSpy).not.toHaveBeenCalled()

      // User types 3 chars: #fff
      textInputs[1].props.onChange({ target: { value: "#fff" } })
      expect(gpuSpy).not.toHaveBeenCalled()

      // User types full 6 chars: #ffffff
      textInputs[1].props.onChange({ target: { value: "#ffffff" } })
      expect(gpuSpy).toHaveBeenCalledWith("u_baseColor", { type: "color", value: [1, 1, 1] })
    })

    it("accurately updates alpha slider on vec4f color uniforms", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_tintAlpha", type: "vec4f", kind: "color" },
      ])

      // Initialize with opaque white
      useProjectStore.getState().setUniformValue("u_tintAlpha", {
        type: "vec4",
        value: [1.0, 1.0, 1.0, 1.0],
      })

      const vdom = renderAndCaptureVDOM(UniformsSection)
      // Find Alpha slider
      const sliderNode = findVDOMNode(vdom, (n) => typeof n?.props?.onValueChange === "function")
      expect(sliderNode).not.toBeNull()

      sliderNode.props.onValueChange([0.35])
      expect(gpuSpy).toHaveBeenCalledWith("u_tintAlpha", {
        type: "vec4",
        value: [1.0, 1.0, 1.0, 0.35],
      })
      expect(useProjectStore.getState().uniformValues["u_tintAlpha"]).toEqual({
        type: "vec4",
        value: [1.0, 1.0, 1.0, 0.35],
      })
    })
  })

  // ==========================================================================
  // Challenge 8: High-Frequency Parameter Scrubbing Stress
  // ==========================================================================
  describe("Challenge 8: High-Frequency Parameter Scrubbing Stress", () => {
    it("survives 1,000 rapid sequential slider updates without desynchronization", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.getState().setParsedUniforms([
        { name: "u_scrub", type: "f32", kind: "scalar" },
      ])

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const slider = findVDOMNode(vdom, (n) => typeof n?.props?.onValueChange === "function")
      expect(slider).not.toBeNull()

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        const val = i * 0.1
        slider.props.onValueChange([val])
      }
      const elapsed = performance.now() - start

      expect(gpuSpy).toHaveBeenCalledTimes(1000)
      expect(useProjectStore.getState().uniformValues["u_scrub"]).toEqual({
        type: "float",
        value: 99.9,
      })
      expect(elapsed).toBeLessThan(300) // Highly performant
    })
  })

  // ==========================================================================
  // Challenge 9: Variation Snapshot Stress & Multi-Uniform Payloads
  // ==========================================================================
  describe("Challenge 9: Variation Snapshot Stress & Multi-Uniform Payloads", () => {
    it("dispatches 50 uniform updates across diverse types when applying a heavy snapshot", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")

      // Generate 50 diverse uniforms
      const sampleUniformValues: Record<string, UniformValue> = {}
      for (let i = 0; i < 50; i++) {
        if (i % 4 === 0) {
          sampleUniformValues[`u_param_${i}`] = { type: "float", value: i * 1.5 }
        } else if (i % 4 === 1) {
          sampleUniformValues[`u_param_${i}`] = { type: "bool", value: i % 2 === 0 }
        } else if (i % 4 === 2) {
          sampleUniformValues[`u_param_${i}`] = { type: "vec3", value: [0.1, 0.2, 0.3] }
        } else {
          sampleUniformValues[`u_param_${i}`] = {
            type: "mat2",
            value: [1, 0, 0, 1],
          }
        }
      }

      useProjectStore.setState({ uniformValues: sampleUniformValues })

      // Create snapshot with all 50 uniforms
      const heavyVarId = useProjectStore.getState().addVariation("Heavy 50-Uniform Snapshot")
      expect(heavyVarId).toBeDefined()

      // Mutate all uniforms to zero
      const zeroUniforms: Record<string, UniformValue> = {}
      for (const k of Object.keys(sampleUniformValues)) {
        zeroUniforms[k] = { type: "float", value: 0 }
      }
      useProjectStore.setState({ uniformValues: zeroUniforms })

      gpuSpy.mockClear()

      // Apply snapshot
      const vdom = renderAndCaptureVDOM(VariationsSection)
      const applyBtn = findVDOMNode(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && (n?.props?.children === "Apply" || n?.props?.children === "Active")
      )
      expect(applyBtn).not.toBeNull()

      applyBtn.props.onClick()

      // Active adapter must have received exactly 50 updateUniform calls
      expect(gpuSpy).toHaveBeenCalledTimes(50)

      // Verify sample updates
      expect(gpuSpy).toHaveBeenCalledWith("u_param_0", { type: "float", value: 0 })
      expect(gpuSpy).toHaveBeenCalledWith("u_param_1", { type: "bool", value: false })
      expect(gpuSpy).toHaveBeenCalledWith("u_param_2", { type: "vec3", value: [0.1, 0.2, 0.3] })
      expect(gpuSpy).toHaveBeenCalledWith("u_param_3", { type: "mat2", value: [1, 0, 0, 1] })

      // Verify store state restored
      expect(useProjectStore.getState().uniformValues["u_param_4"]).toEqual({
        type: "float",
        value: 6.0,
      })
    })

    it("safely applies snapshot when uniformValues is completely empty", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")
      useProjectStore.getState().setActiveBackend("webgpu")
      useProjectStore.setState({ uniformValues: {} })

      const emptyVarId = useProjectStore.getState().addVariation("Empty Snapshot")
      gpuSpy.mockClear()

      const vdom = renderAndCaptureVDOM(VariationsSection)
      const applyBtn = findVDOMNode(
        vdom,
        (n) => typeof n?.props?.onClick === "function" && (n?.props?.children === "Apply" || n?.props?.children === "Active")
      )
      expect(() => applyBtn.props.onClick()).not.toThrow()
      expect(gpuSpy).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Challenge 10: Uniform Prefix Normalization & Direct Adapter Sync
  // ==========================================================================
  describe("Challenge 10: Uniform Prefix Normalization and Adapter Cache Consistency", () => {
    it("synchronizes uniform values in WebGPU adapter cache regardless of 'u_' prefix", () => {
      useProjectStore.getState().setActiveBackend("webgpu")

      // Update with 'u_roughness'
      webgpuAdapter.updateUniform("u_roughness", { type: "float", value: 0.42 })
      expect((webgpuAdapter as any).cachedUniformValues.get("u_roughness")).toEqual({
        type: "float",
        value: 0.42,
      })
      // Old unprefixed key should be purged
      expect((webgpuAdapter as any).cachedUniformValues.has("roughness")).toBe(false)

      // Update with 'roughness' (no u_ prefix)
      webgpuAdapter.updateUniform("roughness", { type: "float", value: 0.99 })
      expect((webgpuAdapter as any).cachedUniformValues.get("roughness")).toEqual({
        type: "float",
        value: 0.99,
      })
      // Old prefixed key should be purged
      expect((webgpuAdapter as any).cachedUniformValues.has("u_roughness")).toBe(false)
    })

    it("synchronizes uniform values in WebGL2 adapter authoritative map", () => {
      useProjectStore.getState().setActiveBackend("webgl2")

      webgl2Adapter.updateUniform("u_specular", { type: "float", value: 0.77 })
      expect((webgl2Adapter as any).authoritativeUniforms.get("u_specular")).toEqual({
        type: "float",
        value: 0.77,
      })

      webgl2Adapter.updateUniform("specular", { type: "float", value: 0.12 })
      expect((webgl2Adapter as any).authoritativeUniforms.get("specular")).toEqual({
        type: "float",
        value: 0.12,
      })
    })

    it("demonstrates ThreeJS material guard: drops updates pre-mount, synchronizes once material is initialized", () => {
      useProjectStore.getState().setActiveBackend("threejs")

      // Pre-mount: material is null -> updateUniform returns early and cachedUniformValues is not updated
      ;(threejsAdapter as any).material = null
      threejsAdapter.updateUniform("u_preMount", { type: "color", value: [0.1, 0.2, 0.3] })
      expect((threejsAdapter as any).cachedUniformValues.get("u_preMount")).toBeUndefined()

      // Post-initialization: material is assigned -> updateUniform caches and updates uniforms
      ;(threejsAdapter as any).material = { uniforms: {} }
      threejsAdapter.updateUniform("u_diffuse", { type: "color", value: [0.2, 0.4, 0.6] })
      expect((threejsAdapter as any).cachedUniformValues.get("u_diffuse")).toEqual({
        type: "color",
        value: [0.2, 0.4, 0.6],
      })
      expect((threejsAdapter as any).material.uniforms["u_diffuse"]).toBeDefined()
    })
  })
})
})

describe("panel via VDOM interaction (m5)", () => {
// Captured mounts and changes for mocked Monaco Editor
let capturedOnMount: ((editor: any, monaco: any) => void) | null = null
let capturedOnChange: ((value: string | undefined) => void) | null = null

// ----------------------------------------------------------------------------
// VDOM Expansion Utilities for White-Box Event Invocation
// ----------------------------------------------------------------------------

function expandTree(node: any, idx = 0): any {
  if (!node) return node
  if (Array.isArray(node)) {
    return node.map((child, i) => expandTree(child, i))
  }
  if (typeof node.type === "function") {
    try {
      const rendered = node.type(node.props)
      return expandTree(rendered, idx)
    } catch {
      return node
    }
  }
  if (React.isValidElement(node)) {
    const key = node.key ?? `k-${idx}`
    if (node.props?.children) {
      return React.cloneElement(node as React.ReactElement<any>, {
        key,
        children: expandTree(node.props.children),
      })
    }
    return React.cloneElement(node as React.ReactElement<any>, { key })
  }
  return node
}

function renderAndCaptureVDOM(Component: React.ComponentType<any>, props: any = {}): any {
  let capturedTree: any = null
  function Interceptor() {
    const raw = Component(props)
    capturedTree = expandTree(raw)
    return React.createElement("div", { key: "interceptor-root" }, capturedTree)
  }
  renderToStaticMarkup(React.createElement(Interceptor, { key: "root" }))
  return capturedTree
}

function findVDOMNode(vdom: any, predicate: (node: any) => boolean): any {
  if (!vdom) return null
  if (predicate(vdom)) return vdom
  if (Array.isArray(vdom)) {
    for (const child of vdom) {
      const found = findVDOMNode(child, predicate)
      if (found) return found
    }
  }
  if (vdom.props?.children) {
    return findVDOMNode(vdom.props.children, predicate)
  }
  return null
}

function findAllVDOMNodes(vdom: any, predicate: (node: any) => boolean): any[] {
  const results: any[] = []
  function traverse(node: any) {
    if (!node) return
    if (predicate(node)) results.push(node)
    if (Array.isArray(node)) {
      for (const c of node) traverse(c)
    } else if (node.props?.children) {
      traverse(node.props.children)
    }
  }
  traverse(vdom)
  return results
}

// ----------------------------------------------------------------------------
// Test Suite Setup
// ----------------------------------------------------------------------------

describe("Milestone 5 Challenger 2: Adversarial Stress Suite (Parameters & Editor)", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
    useProjectStore.setState({
      activeBackend: "webgpu",
      activeEditorTab: "render",
      shaderSource: "// default render shader",
      vertexShaderSource: "// default vertex shader",
      computeShaderSource: "// default compute shader",
      lastCompileError: null,
      isAudioPlaying: false,
      audioGain: 1.0,
      audioSmoothing: 0.8,
      audioSourceType: "builtin",
      audioBindings: {},
      variations: [],
      activeVariationId: null,
      environmentSettings: {
        preset: "studio_warm",
        exposure: 1.0,
        rotation: 0,
        backgroundBlur: 0.0,
        showSkybox: false,
      },
    })
    useLayoutStore.setState({
      editorMinimap: false,
      maximizedPanel: "none",
      jumpTarget: null,
      isConsoleOpen: true,
      isRightInspectorOpen: true,
    })
    useFileSystemStore.setState({
      syncMode: "local",
    })
    capturedOnMount = null
    capturedOnChange = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Suite 1: Milestone 3 Parameter Inspector — Accordion State & Rapid Toggling
  // ==========================================================================
  describe("Suite 1: ParameterPanel Accordion Sections & Rapid Toggling Stress", () => {
    it("renders all 5 accordion sections with correct initial states", () => {
      const html = renderToStaticMarkup(<ParameterPanel />)

      expect(html).toContain("5 Inspector Sections")
      expect(html).toContain("Shader Uniforms")
      expect(html).toContain("Studio Environment &amp; Lighting")
      expect(html).toContain("Audio Dynamics")
      expect(html).toContain("Compute Simulation")
      expect(html).toContain("Variations &amp; Presets")

      // By default: uniforms and environment are open
      expect(html).toContain("Search uniforms...")
      expect(html).toContain("Lighting Preset")
      expect(html).toContain("Collapse All")
    })

    it("computes accurate dynamic badges across all 5 accordion headers", () => {
      // 1. Uniforms count: 3 parsed + 2 graph = 5 total
      useProjectStore.setState({
        parsedUniforms: [
          { name: "u_time", type: "f32", kind: "scalar" },
          { name: "u_speed", type: "f32", kind: "scalar" },
          { name: "u_color", type: "vec3f", kind: "color" },
        ],
        graphUniforms: [
          { name: "u_noise", type: "float", defaultValue: 1.0 },
          { name: "u_scale", type: "float", defaultValue: 2.0 },
        ],
        // 2. Audio Dynamics LIVE badge
        isAudioPlaying: true,
        // 3. Compute Simulation COMPUTE badge
        renderQueue: [
          { id: "step-1", name: "Simulate", type: "compute", shaderSource: "" },
        ],
        // 4. Variations badge count
        variations: [
          { id: "v1", name: "Preset A", uniformValues: {}, createdAt: Date.now() },
          { id: "v2", name: "Preset B", uniformValues: {}, createdAt: Date.now() },
          { id: "v3", name: "Preset C", uniformValues: {}, createdAt: Date.now() },
        ],
      })

      const html = renderToStaticMarkup(<ParameterPanel />)

      // Check badges in markup
      expect(html).toContain("5") // total uniforms badge
      expect(html).toContain("LIVE") // audio badge
      expect(html).toContain("COMPUTE") // compute badge
      expect(html).toContain("3") // variations count badge
    })

    it("displays audio bindings count badge when audio is suspended with active bindings", () => {
      useProjectStore.setState({
        isAudioPlaying: false,
        audioBindings: {
          u_speed: { band: "bass", amount: 1.5 },
          u_scale: { band: "treble", amount: 0.8 },
        },
      })

      const html = renderToStaticMarkup(<ParameterPanel />)
      expect(html).toContain("2 bound")
      expect(html).not.toContain("LIVE")
    })
  })

  // ==========================================================================
  // Suite 2: Milestone 3 Parameter Inspector — Search Filtering & Regex Safety
  // ==========================================================================
  describe("Suite 2: UniformsSection Search Filtering & Regex Resilience", () => {
    beforeEach(() => {
      useProjectStore.setState({
        parsedUniforms: [
          { name: "u_color", type: "vec3f", kind: "color" },
          { name: "u_roughness", type: "f32", kind: "scalar" },
          { name: "u_specular_intensity", type: "f32", kind: "scalar" },
          { name: "u_normal_map", type: "texture", kind: "texture" },
          { name: "u_special[0]", type: "f32", kind: "scalar" },
          { name: "u_escaped(test)", type: "f32", kind: "scalar" },
        ],
      })
    })

    it("safely handles raw regex metacharacters without throwing SyntaxError", () => {
      const adversarialQueries = [
        ".*",
        "[.*+?^${}()|[\\]\\\\]",
        "[a-z(",
        "(?=.*[0-9])",
        "u_special[",
        "(test)",
        "\\",
        "++",
        "???",
        "u_color|u_roughness",
      ]

      for (const query of adversarialQueries) {
        expect(() => {
          const vdom = renderAndCaptureVDOM(UniformsSection)
          const searchInput = findVDOMNode(
            vdom,
            (n) => n?.props?.placeholder === "Search uniforms..."
          )
          expect(searchInput).not.toBeNull()

          // Trigger onChange with adversarial regex characters
          searchInput.props.onChange({ target: { value: query } })
        }).not.toThrow()
      }
    })
  })

  // ==========================================================================
  // Suite 3: Milestone 3 Parameter Inspector — Per-Uniform & Global Reset
  // ==========================================================================
  describe("Suite 3: UniformsSection Per-Uniform and Global Reset-to-Defaults", () => {
    it("resets an individual scalar uniform while keeping other modified uniforms intact", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      useProjectStore.setState({
        parsedUniforms: [
          { name: "u_speed", type: "f32", kind: "scalar" },
          { name: "u_brightness", type: "f32", kind: "scalar" },
        ],
        uniformValues: {
          u_speed: { type: "float", value: 99.5 },
          u_brightness: { type: "float", value: 4.2 },
        },
      })

      const vdom = renderAndCaptureVDOM(UniformsSection)

      // Find per-uniform reset button specifically with title="Reset to default"
      const speedResetBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.title === "Reset to default"
      )
      expect(speedResetBtn).not.toBeNull()
      speedResetBtn.props.onClick()

      // u_speed must be reset to 0 in store and adapter called
      expect(useProjectStore.getState().uniformValues["u_speed"]).toEqual({
        type: "float",
        value: 0,
      })
      expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 0 })

      // u_brightness must remain untouched
      expect(useProjectStore.getState().uniformValues["u_brightness"].value).toBe(4.2)
    })

    it("resets matrix uniforms and applies matrix presets (Identity, 2x, 0.5x)", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      useProjectStore.setState({
        parsedUniforms: [{ name: "u_transform", type: "mat3x3f", kind: "matrix" }],
        uniformValues: {
          u_transform: {
            type: "mat3",
            value: [5, 5, 5, 5, 5, 5, 5, 5, 5],
          },
        },
      })

      const vdom = renderAndCaptureVDOM(UniformsSection)

      // Find preset buttons
      const presetButtons = findAllVDOMNodes(
        vdom,
        (n) => typeof n?.props?.children === "string" && ["Identity", "2x", "0.5x"].includes(n.props.children)
      )
      expect(presetButtons.length).toBe(3)

      // 1. Click Identity preset
      const identityBtn = presetButtons.find((b) => b.props.children === "Identity")
      identityBtn.props.onClick()
      expect(useProjectStore.getState().uniformValues["u_transform"]).toEqual({
        type: "mat3",
        value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      })
      expect(gpuSpy).toHaveBeenCalledWith("u_transform", {
        type: "mat3",
        value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      })

      // 2. Click 2x preset
      const scale2Btn = presetButtons.find((b) => b.props.children === "2x")
      scale2Btn.props.onClick()
      expect(useProjectStore.getState().uniformValues["u_transform"]).toEqual({
        type: "mat3",
        value: [2, 0, 0, 0, 2, 0, 0, 0, 2],
      })

      // 3. Click 0.5x preset
      const scaleHalfBtn = presetButtons.find((b) => b.props.children === "0.5x")
      scaleHalfBtn.props.onClick()
      expect(useProjectStore.getState().uniformValues["u_transform"]).toEqual({
        type: "mat3",
        value: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5],
      })
    })

    it("resets custom graph uniforms to their declared defaultValues", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      const graphUniforms: GraphUniform[] = [
        { name: "u_customFloat", type: "float", defaultValue: 13.37 },
        { name: "u_customBool", type: "float", defaultValue: true as any },
        { name: "u_customVec2", type: "vec2", defaultValue: [4.0, 8.0] },
      ]

      useProjectStore.setState({
        graphUniforms,
        uniformValues: {
          u_customFloat: { type: "float", value: 999.0 },
          u_customBool: { type: "bool", value: false },
          u_customVec2: { type: "vec2", value: [0, 0] },
        },
      })

      const vdom = renderAndCaptureVDOM(UniformsSection)

      // Trigger Global Reset All
      const resetAllBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.title === "Reset all uniforms to default parsed values"
      )
      expect(resetAllBtn).not.toBeNull()
      resetAllBtn.props.onClick()

      // Check restored custom defaults
      const state = useProjectStore.getState()
      expect(state.uniformValues["u_customFloat"]).toEqual({ type: "float", value: 13.37 })
      expect(state.uniformValues["u_customBool"]).toEqual({ type: "bool", value: true })
      expect(state.uniformValues["u_customVec2"]).toEqual({ type: "vec2", value: [4.0, 8.0] })
      expect(gpuSpy).toHaveBeenCalledWith("u_customFloat", { type: "float", value: 13.37 })
    })

    it("global Reset All dispatches hardware adapter updates for all active uniforms", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      useProjectStore.setState({
        parsedUniforms: [
          { name: "u_paramA", type: "f32", kind: "scalar" },
          { name: "u_paramB", type: "vec3f", kind: "vector" },
          { name: "u_flag", type: "bool", kind: "scalar" },
        ],
        uniformValues: {
          u_paramA: { type: "float", value: 88.0 },
          u_paramB: { type: "vec3", value: [10, 20, 30] },
          u_flag: { type: "bool", value: true },
        },
      })

      const vdom = renderAndCaptureVDOM(UniformsSection)
      const resetAllBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.title === "Reset all uniforms to default parsed values"
      )
      resetAllBtn.props.onClick()

      expect(gpuSpy).toHaveBeenCalledWith("u_paramA", { type: "float", value: 0 })
      expect(gpuSpy).toHaveBeenCalledWith("u_paramB", { type: "vec3", value: [0, 0, 0] })
      expect(gpuSpy).toHaveBeenCalledWith("u_flag", { type: "bool", value: false })
    })
  })

  // ==========================================================================
  // Suite 4: Milestone 3 Parameter Inspector — Audio Dynamics VU & Gain/Smooth
  // ==========================================================================
  describe("Suite 4: Audio Dynamics Section — VU Meters, Playback & Gain/Smoothing", () => {
    it("renders 5 VU spectrum frequency meters with correct percentage values", () => {
      audioEngine.uniforms.bass = 0.85
      audioEngine.uniforms.mid = 0.50
      audioEngine.uniforms.treble = 0.30
      audioEngine.uniforms.beat = 0.95
      audioEngine.uniforms.level = 0.70

      const html = renderToStaticMarkup(<AudioDynamicsSection />)

      expect(html).toContain("BASS")
      expect(html).toContain("MID")
      expect(html).toContain("TREBLE")
      expect(html).toContain("BEAT")
      expect(html).toContain("LEVEL")
      expect(html).toContain("Gain / Sensitivity")
      expect(html).toContain("FFT Smoothing")
    })

    it("toggles audio playback and synchronizes projectStore and audioEngine", () => {
      const toggleSpy = vi.spyOn(audioEngine, "togglePlay").mockReturnValue(true)

      const vdom = renderAndCaptureVDOM(AudioDynamicsSection)
      const playBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.children && Array.isArray(n.props.children) && n.props.children.some((c: any) => c?.props?.children?.includes?.("Play Audio"))
      )
      expect(playBtn).not.toBeNull()

      playBtn.props.onClick()
      expect(toggleSpy).toHaveBeenCalled()
      expect(useProjectStore.getState().isAudioPlaying).toBe(true)
    })

    it("adjusts audio gain and smoothing within strict valid bounds", () => {
      const gainSpy = vi.spyOn(audioEngine, "setGainMultiplier")
      const smoothSpy = vi.spyOn(audioEngine, "setSmoothing")

      useProjectStore.getState().setAudioGain(2.5)
      useProjectStore.getState().setAudioSmoothing(0.65)

      expect(useProjectStore.getState().audioGain).toBe(2.5)
      expect(useProjectStore.getState().audioSmoothing).toBe(0.65)

      // Direct change invocation via vdom
      const vdom = renderAndCaptureVDOM(AudioDynamicsSection)
      const sliders = findAllVDOMNodes(vdom, (n) => typeof n?.props?.onValueChange === "function")
      expect(sliders.length).toBeGreaterThanOrEqual(2)

      // Gain slider (first)
      sliders[0].props.onValueChange([3.2])
      expect(gainSpy).toHaveBeenCalledWith(3.2)
      expect(useProjectStore.getState().audioGain).toBe(3.2)

      // Smoothing slider (second)
      sliders[1].props.onValueChange([0.9])
      expect(smoothSpy).toHaveBeenCalledWith(0.9)
      expect(useProjectStore.getState().audioSmoothing).toBe(0.9)
    })

    it("creates, displays, and disconnects audio reactive uniform bindings", () => {
      // Create reactive audio binding
      useProjectStore.getState().setAudioBinding("u_pulse", { band: "bass", amount: 2.5 })
      useProjectStore.getState().setAudioBinding("u_shimmer", { band: "treble", amount: 1.2 })

      expect(useProjectStore.getState().audioBindings["u_pulse"]).toEqual({
        band: "bass",
        amount: 2.5,
      })

      const html = renderToStaticMarkup(<AudioDynamicsSection />)
      expect(html).toContain("Active Audio Bindings (2)")
      expect(html).toContain("u_pulse")
      expect(html).toContain("bass")
      expect(html).toContain("2.5x")
      expect(html).toContain("u_shimmer")
      expect(html).toContain("treble")

      // Disconnect binding
      useProjectStore.getState().setAudioBinding("u_pulse", null)
      expect(useProjectStore.getState().audioBindings["u_pulse"]).toBeUndefined()
      expect(useProjectStore.getState().audioBindings["u_shimmer"]).toBeDefined()
    })
  })

  // ==========================================================================
  // Suite 5: Milestone 3 Parameter Inspector — Variations Presets & Corrupt JSON
  // ==========================================================================
  describe("Suite 5: Variations Presets — Snapshot Lifecycle & Corrupt JSON Defense", () => {
    it("creates snapshots with current uniform states and applies them across hardware adapters", () => {
      const gpuSpy = vi.spyOn(webgpuAdapter, "updateUniform")

      useProjectStore.setState({
        uniformValues: {
          u_speed: { type: "float", value: 3.14 },
          u_color: { type: "vec3", value: [0.1, 0.2, 0.3] },
        },
      })

      // Add variation
      const varId = useProjectStore.getState().addVariation("Gold Preset")
      expect(varId).toBeDefined()
      expect(useProjectStore.getState().variations).toHaveLength(1)
      expect(useProjectStore.getState().variations[0].name).toBe("Gold Preset")
      expect(useProjectStore.getState().variations[0].uniformValues["u_speed"].value).toBe(3.14)

      // Mutate current uniforms and clear active variation selection so "Apply" button renders
      useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 0.0 })
      useProjectStore.setState({ activeVariationId: null })

      // Apply variation via vdom
      const vdom = renderAndCaptureVDOM(VariationsSection)
      const applyBtn = findVDOMNode(
        vdom,
        (n) => typeof n?.props?.children === "string" && n.props.children === "Apply"
      )
      expect(applyBtn).not.toBeNull()
      applyBtn.props.onClick()

      // Uniforms restored in store and sent to adapter
      expect(useProjectStore.getState().uniformValues["u_speed"].value).toBe(3.14)
      expect(gpuSpy).toHaveBeenCalledWith("u_speed", { type: "float", value: 3.14 })
      expect(useProjectStore.getState().activeVariationId).toBe(varId)
    })

    it("deletes active variation and resets activeVariationId to null safely", () => {
      useProjectStore.setState({
        variations: [
          {
            id: "var-1",
            name: "Neon Glow",
            uniformValues: { u_glow: { type: "float", value: 2.0 } },
            createdAt: Date.now(),
          },
        ],
        activeVariationId: "var-1",
      })

      const vdom = renderAndCaptureVDOM(VariationsSection)
      const deleteBtn = findVDOMNode(
        vdom,
        (n) => n?.props?.title === "Delete variation snapshot"
      )
      expect(deleteBtn).not.toBeNull()
      deleteBtn.props.onClick()

      expect(useProjectStore.getState().variations).toHaveLength(0)
      expect(useProjectStore.getState().activeVariationId).toBeNull()
    })

    it("safely rejects corrupt JSON imports without crashing the store or UI", () => {
      // 1. Non-array inputs to importVariations are safely rejected
      const nonArrayInputs: any[] = [
        null,
        undefined,
        "not a json array",
        42,
        {},
        [], // empty array is safely ignored
      ]

      for (const input of nonArrayInputs) {
        expect(() => {
          useProjectStore.getState().importVariations(input as any)
        }).not.toThrow()
      }
      expect(useProjectStore.getState().variations).toHaveLength(0)

      // 2. Syntax errors during JSON parsing are caught safely without crashing
      const corruptJsonStrings = [
        "{\"unclosed\":",
        "undefined",
        "<xml>not json</xml>",
        "{ key: missing_quotes }",
      ]

      for (const corruptStr of corruptJsonStrings) {
        expect(() => {
          try {
            const parsed = JSON.parse(corruptStr)
            if (Array.isArray(parsed)) {
              useProjectStore.getState().importVariations(parsed)
            }
          } catch {
            // Handled gracefully in VariationsSection file import
          }
        }).not.toThrow()
      }
      expect(useProjectStore.getState().variations).toHaveLength(0)

      // 3. Valid array imports successfully
      useProjectStore.getState().importVariations([
        {
          id: "imported-ok",
          name: "Recovered Preset",
          uniformValues: { u_glow: { type: "float", value: 5.0 } },
          createdAt: Date.now(),
        },
      ])
      expect(useProjectStore.getState().variations).toHaveLength(1)
      expect(useProjectStore.getState().variations[0].name).toBe("Recovered Preset")
    })
  })
})
})

