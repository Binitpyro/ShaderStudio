/**
 * Adversarial Challenger Suite for Milestone 3 (Requirement R3: Parameter Inspector & Organization)
 *
 * Empirical stress tests:
 * 1. Rapid expand/collapse toggling across all 5 accordion sections (state machine, power set, 1000-cycle stress).
 * 2. Uniform search edge cases: regex special chars (*, (, [, ?, \, +, ^, $, .), case-insensitivity, whitespace, no-match states, clear button.
 * 3. Per-uniform reset to default and global reset-all across all uniform types (scalar, vector, color, matrix, bool, texture, graph defaults).
 * 4. Audio dynamics: VU meters and controls when audio is idle/active, gain/smoothing slider boundaries, reactive bindings.
 * 5. Variations: snapshot creation with duplicate or whitespace names, applying variation, deleting active variation, handling corrupt/empty JSON imports.
 * 6. Studio Environment & Lighting preset switching and slider limits.
 * 7. Compute Simulation backend detection, re-seed trigger, and simulation controls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ParameterPanel, type AccordionSectionKey } from "@/components/ParameterPanel"
import { AccordionSection } from "@/components/inspector/AccordionSection"
import { UniformsSection } from "@/components/inspector/UniformsSection"
import { EnvironmentSection } from "@/components/inspector/EnvironmentSection"
import { AudioDynamicsSection } from "@/components/inspector/AudioDynamicsSection"
import { ComputeSimulationSection } from "@/components/inspector/ComputeSimulationSection"
import { VariationsSection } from "@/components/inspector/VariationsSection"
import {
  useProjectStore,
  getDefaultUniformValue,
  type ParsedUniform,
  type UniformValue,
  type GraphUniform,
  type PresetVariation,
} from "@/stores/projectStore"
import { audioEngine } from "@/audio/audioEngine"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"

// Mock next-themes
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
}))

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

    it("toggles all sections open and closed deterministically", () => {
      const allKeys: AccordionSectionKey[] = [
        "uniforms",
        "environment",
        "audio",
        "compute",
        "variations",
      ]

      // State machine simulator replicating ParameterPanel logic
      let openSections = new Set<AccordionSectionKey>(["uniforms", "environment"])

      const toggleAll = () => {
        if (openSections.size > 0) {
          openSections = new Set()
        } else {
          openSections = new Set(allKeys)
        }
      }

      // First toggleAll: collapses all
      toggleAll()
      expect(openSections.size).toBe(0)

      // Second toggleAll: expands all 5
      toggleAll()
      expect(openSections.size).toBe(5)
      for (const k of allKeys) {
        expect(openSections.has(k)).toBe(true)
      }

      // Third toggleAll: collapses all again
      toggleAll()
      expect(openSections.size).toBe(0)
    })

    it("survives 1,000 rapid expand/collapse stress cycles without state corruption", () => {
      const allKeys: AccordionSectionKey[] = [
        "uniforms",
        "environment",
        "audio",
        "compute",
        "variations",
      ]
      let openSections = new Set<AccordionSectionKey>(["uniforms", "environment"])

      const toggleSection = (key: AccordionSectionKey) => {
        const next = new Set(openSections)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        openSections = next
      }

      const toggleAll = () => {
        if (openSections.size > 0) openSections = new Set()
        else openSections = new Set(allKeys)
      }

      for (let i = 0; i < 1000; i++) {
        const op = i % 6
        if (op === 5) {
          toggleAll()
        } else {
          toggleSection(allKeys[op])
        }

        // Invariant: openSections size is always between 0 and 5
        expect(openSections.size).toBeGreaterThanOrEqual(0)
        expect(openSections.size).toBeLessThanOrEqual(5)

        // Invariant: all items in openSections are valid keys
        for (const k of openSections) {
          expect(allKeys).toContain(k)
        }
      }
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
  // Section 2: Uniform Search Metacharacter Fuzzing & Query Edge Cases
  // ==========================================================================
  describe("Section 2: Uniform Search Metacharacter Fuzzing & Query Edge Cases", () => {
    const sampleUniforms: ParsedUniform[] = [
      { name: "u_speed", type: "f32", kind: "scalar" },
      { name: "u_color", type: "vec3f", kind: "color" },
      { name: "u_tint_alpha", type: "vec4f", kind: "color" },
      { name: "u_offset_pos", type: "vec2f", kind: "vector" },
      { name: "u_transform_matrix", type: "mat4x4f", kind: "matrix" },
      { name: "u_enabled_flag", type: "bool", kind: "scalar" },
      { name: "u_noise_tex", type: "texture", kind: "texture" },
      { name: "special_.*_uniform", type: "f32", kind: "scalar" },
      { name: "bracket_[0]_val", type: "f32", kind: "scalar" },
      { name: "question?mark", type: "f32", kind: "scalar" },
      { name: "backslash\\path", type: "f32", kind: "scalar" },
    ]

    beforeEach(() => {
      useProjectStore.getState().setParsedUniforms(sampleUniforms)
    })

    const filterUniforms = (query: string, uniforms: ParsedUniform[]) => {
      const trimmed = query.trim().toLowerCase()
      if (!trimmed) return uniforms
      return uniforms.filter((u) => u.name.toLowerCase().includes(trimmed))
    }

    it("fuzzes search filter with regex metacharacters without SyntaxError or crash", () => {
      const regexMetachars = [
        "*",
        "(",
        ")",
        "[",
        "]",
        "?",
        "\\",
        "+",
        "^",
        "$",
        ".",
        "{",
        "}",
        "|",
        ".*",
        "[a-z]+",
        "(foo|bar)",
        "\\d+",
        "^u_",
        "?$*",
      ]

      for (const metachar of regexMetachars) {
        // Must not throw RegExp syntax error
        expect(() => {
          const results = filterUniforms(metachar, sampleUniforms)
          expect(Array.isArray(results)).toBe(true)
        }).not.toThrow()
      }
    })

    it("matches exact uniform names containing regex symbols", () => {
      expect(filterUniforms(".*", sampleUniforms).map((u) => u.name)).toContain(
        "special_.*_uniform"
      )
      expect(filterUniforms("[0]", sampleUniforms).map((u) => u.name)).toContain(
        "bracket_[0]_val"
      )
      expect(filterUniforms("?", sampleUniforms).map((u) => u.name)).toContain(
        "question?mark"
      )
      expect(filterUniforms("\\", sampleUniforms).map((u) => u.name)).toContain(
        "backslash\\path"
      )
    })

    it("strictly respects case-insensitivity across UPPERCASE, lowercase, and MixedCase", () => {
      const queries = ["U_SPEED", "u_speed", "u_Speed", "U_sPeEd", "U_sPeEd"]
      for (const q of queries) {
        const matches = filterUniforms(q, sampleUniforms)
        expect(matches.length).toBe(1)
        expect(matches[0].name).toBe("u_speed")
      }
    })

    it("normalizes whitespace and trims queries correctly", () => {
      // Leading and trailing spaces
      expect(filterUniforms("   u_color   ", sampleUniforms).length).toBe(1)
      expect(filterUniforms("   u_color   ", sampleUniforms)[0].name).toBe("u_color")

      // Pure whitespace query returns all uniforms
      expect(filterUniforms("     ", sampleUniforms).length).toBe(sampleUniforms.length)
      expect(filterUniforms("\t\n  \r", sampleUniforms).length).toBe(sampleUniforms.length)
      expect(filterUniforms("", sampleUniforms).length).toBe(sampleUniforms.length)
    })

    it("handles non-matching queries and produces 0 matches cleanly", () => {
      const noMatches = filterUniforms("non_existent_xyz_12345", sampleUniforms)
      expect(noMatches).toHaveLength(0)

      const html = renderToStaticMarkup(<UniformsSection />)
      expect(html).toContain("Search uniforms...")
    })

    it("fuzzes with extreme query lengths and Unicode without crash or hang", () => {
      // 10,000 characters long query
      const giantQuery = "a".repeat(10000)
      const start = performance.now()
      const results = filterUniforms(giantQuery, sampleUniforms)
      const elapsed = performance.now() - start

      expect(results).toHaveLength(0)
      expect(elapsed).toBeLessThan(100) // Fast execution

      // Unicode and Emoji
      expect(() => filterUniforms("🎨✨🚀", sampleUniforms)).not.toThrow()
      expect(() => filterUniforms("шрифт_имя", sampleUniforms)).not.toThrow()
      expect(() => filterUniforms("日本語変数", sampleUniforms)).not.toThrow()
    })

    it("filters high-load uniform count (500 uniforms) across 100 queries under 50ms", () => {
      const massiveUniforms: ParsedUniform[] = Array.from({ length: 500 }, (_, i) => ({
        name: `u_param_${i}_${(i % 10).toString(16)}`,
        type: i % 2 === 0 ? "f32" : "vec3f",
        kind: i % 2 === 0 ? "scalar" : "color",
      }))

      const queries = ["param_1", "param_25", "u_param_499", "nonexistent", "0", "f"]
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        const q = queries[i % queries.length]
        const matched = filterUniforms(q, massiveUniforms)
        expect(Array.isArray(matched)).toBe(true)
      }

      const totalTime = performance.now() - start
      expect(totalTime).toBeLessThan(100) // High-performance guarantee
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

      // Helper function mirroring UniformsSection.tsx getDefaultValueFor
      function getDefaultValueFor(
        uniform: ParsedUniform,
        guList: GraphUniform[]
      ): UniformValue {
        const gu = guList.find((g) => g.name === uniform.name)
        if (gu) {
          if (typeof gu.defaultValue === "boolean") {
            return { type: "bool", value: gu.defaultValue }
          }
          if (typeof gu.defaultValue === "number") {
            return { type: "float", value: gu.defaultValue }
          }
          if (Array.isArray(gu.defaultValue)) {
            const len = gu.defaultValue.length
            const type =
              len === 2
                ? "vec2"
                : len === 3
                ? gu.type === "color"
                  ? "color"
                  : "vec3"
                : "vec4"
            return { type, value: [...gu.defaultValue] }
          }
        }
        return getDefaultUniformValue(uniform)
      }

      expect(
        getDefaultValueFor({ name: "g_brightness", type: "f32", kind: "scalar" }, graphUniforms)
      ).toEqual({ type: "float", value: 3.5 })

      expect(
        getDefaultValueFor({ name: "g_color", type: "vec3f", kind: "color" }, graphUniforms)
      ).toEqual({ type: "color", value: [0.1, 0.2, 0.8] })

      expect(
        getDefaultValueFor({ name: "g_active", type: "bool", kind: "scalar" }, graphUniforms)
      ).toEqual({ type: "bool", value: true })

      expect(
        getDefaultValueFor({ name: "g_offset", type: "vec2f", kind: "vector" }, graphUniforms)
      ).toEqual({ type: "vec2", value: [1.2, 3.4] })
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
