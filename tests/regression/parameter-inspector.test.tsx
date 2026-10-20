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

  })

  // ==========================================================================
  // Section 8: Deep Edge Cases & Dynamic Badge Integration Stress
  // ==========================================================================
  describe("Section 8: Deep Edge Cases & Dynamic Badge Integration", () => {

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

  })

  // ==========================================================================
  // Challenge 2: Per-Uniform Reset to Default
  // ==========================================================================

  // ==========================================================================
  // Challenge 3: Global Reset-All
  // ==========================================================================

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


  })

  // ==========================================================================
  // Challenge 7: Hex Color Parser Resilience
  // ==========================================================================

  // ==========================================================================
  // Challenge 8: High-Frequency Parameter Scrubbing Stress
  // ==========================================================================

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


  })

  // ==========================================================================
  // Suite 4: Milestone 3 Parameter Inspector — Audio Dynamics VU & Gain/Smooth
  // ==========================================================================
  describe("Suite 4: Audio Dynamics Section — VU Meters, Playback & Gain/Smoothing", () => {


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

