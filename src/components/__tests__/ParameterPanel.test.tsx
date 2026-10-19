import { describe, it, expect, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ParameterPanel } from "../ParameterPanel"
import { AccordionSection } from "../inspector/AccordionSection"
import { UniformsSection } from "../inspector/UniformsSection"
import { EnvironmentSection } from "../inspector/EnvironmentSection"
import { AudioDynamicsSection } from "../inspector/AudioDynamicsSection"
import { ComputeSimulationSection } from "../inspector/ComputeSimulationSection"
import { VariationsSection } from "../inspector/VariationsSection"
import { useProjectStore, getDefaultUniformValue, type ParsedUniform } from "@/stores/projectStore"

describe("Parameter Inspector Components (Requirement R3)", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  // --------------------------------------------------------------------------
  // 1. AccordionSection Reusable Container
  // --------------------------------------------------------------------------
  describe("AccordionSection", () => {
    it("renders title, icon, badge, and header action slot", () => {
      const html = renderToStaticMarkup(
        <AccordionSection
          id="test-sec"
          title="Custom Settings"
          icon={<span data-testid="test-icon">ICON</span>}
          badge="42"
          isOpen={true}
          onToggle={() => {}}
          headerActions={<button data-testid="test-action">Action</button>}
        >
          <div data-testid="test-content">Accordion Content Body</div>
        </AccordionSection>
      )

      expect(html).toContain("Custom Settings")
      expect(html).toContain("data-testid=\"test-icon\"")
      expect(html).toContain("42")
      expect(html).toContain("data-testid=\"test-action\"")
      expect(html).toContain("Accordion Content Body")
      expect(html).toContain("aria-expanded=\"true\"")
      expect(html).toContain("rotate-0")
    })

    it("hides content when collapsed and rotates chevron", () => {
      const html = renderToStaticMarkup(
        <AccordionSection
          id="test-collapsed"
          title="Collapsed Settings"
          isOpen={false}
          onToggle={() => {}}
        >
          <div data-testid="hidden-content">Should Not Render</div>
        </AccordionSection>
      )

      expect(html).toContain("Collapsed Settings")
      expect(html).not.toContain("Should Not Render")
      expect(html).toContain("aria-expanded=\"false\"")
      expect(html).toContain("-rotate-90")
    })
  })

  // --------------------------------------------------------------------------
  // 2. ParameterPanel 5-Accordion Layout
  // --------------------------------------------------------------------------
  describe("ParameterPanel Container", () => {
    it("renders all 5 collapsible accordion sections and collapse/expand all control", () => {
      const html = renderToStaticMarkup(<ParameterPanel />)

      expect(html).toContain("data-testid=\"parameter-panel\"")
      expect(html).toContain("5 Inspector Sections")
      expect(html).toContain("Collapse All")

      // All 5 section titles
      expect(html).toContain("Shader Uniforms")
      expect(html).toContain("Studio Environment &amp; Lighting")
      expect(html).toContain("Audio Dynamics")
      expect(html).toContain("Compute Simulation")
      expect(html).toContain("Variations &amp; Presets")

      // By default: uniforms and environment are open
      expect(html).toContain("Search uniforms...")
      expect(html).toContain("Lighting Preset")
    })
  })

  // --------------------------------------------------------------------------
  // 3. Section 1: Shader Uniforms
  // --------------------------------------------------------------------------
  describe("UniformsSection", () => {
    it("renders search bar, reset-all button, and controls for parsed uniforms", () => {
      const sampleUniforms: ParsedUniform[] = [
        { name: "u_speed", type: "f32", kind: "scalar" },
        { name: "u_tint", type: "vec4f", kind: "color" },
        { name: "u_offset", type: "vec2f", kind: "vector" },
        { name: "u_transform", type: "mat3x3f", kind: "matrix" },
        { name: "u_enabled", type: "bool", kind: "scalar" },
        { name: "u_albedo", type: "texture", kind: "texture" },
      ]
      useProjectStore.getState().setParsedUniforms(sampleUniforms)

      const html = renderToStaticMarkup(<UniformsSection />)

      // Search and global reset
      expect(html).toContain("Search uniforms...")
      expect(html).toContain("Reset All")

      // Individual controls
      expect(html).toContain("u_speed")
      expect(html).toContain("u_tint")
      expect(html).toContain("u_offset")
      expect(html).toContain("u_transform")
      expect(html).toContain("u_enabled")
      expect(html).toContain("u_albedo")

      // Vector components
      expect(html).toContain(".x")
      expect(html).toContain(".y")

      // Matrix presets
      expect(html).toContain("Identity")
      expect(html).toContain("2x")
      expect(html).toContain("0.5x")

      // Texture status
      expect(html).toContain("Texture bound via Node Graph")
    })

    it("getDefaultUniformValue returns accurate defaults for all uniform kinds", () => {
      const scalarU: ParsedUniform = { name: "u_float", type: "f32", kind: "scalar" }
      const boolU: ParsedUniform = { name: "u_flag", type: "bool", kind: "scalar" }
      const colorU: ParsedUniform = { name: "u_color", type: "vec4f", kind: "color" }
      const vec3U: ParsedUniform = { name: "u_pos", type: "vec3f", kind: "vector" }
      const mat4U: ParsedUniform = { name: "u_mat", type: "mat4x4f", kind: "matrix" }

      expect(getDefaultUniformValue(scalarU)).toEqual({ type: "float", value: 0 })
      expect(getDefaultUniformValue(boolU)).toEqual({ type: "bool", value: false })
      expect(getDefaultUniformValue(colorU)).toEqual({ type: "vec4", value: [0.5, 0.5, 0.5, 1.0] })
      expect(getDefaultUniformValue(vec3U)).toEqual({ type: "vec3", value: [0, 0, 0] })
      expect(getDefaultUniformValue(mat4U).type).toBe("mat4")
      expect((getDefaultUniformValue(mat4U).value as number[]).length).toBe(16)
    })
  })

  // --------------------------------------------------------------------------
  // 4. Section 2: Studio Environment & Lighting
  // --------------------------------------------------------------------------
  describe("EnvironmentSection", () => {
    it("renders 5 lighting preset pills, sliders, and skybox toggle", () => {
      const html = renderToStaticMarkup(<EnvironmentSection />)

      // 5 Presets
      expect(html).toContain("Studio Warm")
      expect(html).toContain("Cyberpunk")
      expect(html).toContain("Sunset")
      expect(html).toContain("Nebula")
      expect(html).toContain("Neutral")

      // Sliders & controls
      expect(html).toContain("Exposure")
      expect(html).toContain("Rotation")
      expect(html).toContain("Background Blur")
      expect(html).toContain("Show Skybox")
    })
  })

  // --------------------------------------------------------------------------
  // 5. Section 3: Audio Dynamics
  // --------------------------------------------------------------------------
  describe("AudioDynamicsSection", () => {
    it("renders live VU meters, playback controls, input source selector, and reactive bindings", () => {
      useProjectStore.getState().setAudioBinding("u_audioPulse", { band: "bass", amount: 2.0 })
      useProjectStore.getState().setIsAudioPlaying(true)

      const html = renderToStaticMarkup(<AudioDynamicsSection />)

      // Audio engine active
      expect(html).toContain("Audio Engine Active")
      expect(html).toContain("Pause Audio")

      // Input source options
      expect(html).toContain("Built-in")
      expect(html).toContain("File")
      expect(html).toContain("Mic")

      // 5 VU Spectrum Bands
      expect(html).toContain("BASS")
      expect(html).toContain("MID")
      expect(html).toContain("TREBLE")
      expect(html).toContain("BEAT")
      expect(html).toContain("LEVEL")

      // Sensitivity and smoothing
      expect(html).toContain("Gain / Sensitivity")
      expect(html).toContain("FFT Smoothing")

      // Active bindings list
      expect(html).toContain("Active Audio Bindings (1)")
      expect(html).toContain("u_audioPulse")
      expect(html).toContain("2.0x")
    })
  })

  // --------------------------------------------------------------------------
  // 6. Section 4: Compute Simulation
  // --------------------------------------------------------------------------
  describe("ComputeSimulationSection", () => {
    it("renders backend notice on non-WebGPU and full simulation controls", () => {
      useProjectStore.getState().setActiveBackend("webgl2")
      const htmlWebGL = renderToStaticMarkup(<ComputeSimulationSection />)
      expect(htmlWebGL).toContain("Active on WebGPU backend")
      expect(htmlWebGL).toContain("Switch to WebGPU")

      useProjectStore.getState().setActiveBackend("webgpu")
      const htmlWebGPU = renderToStaticMarkup(<ComputeSimulationSection />)
      expect(htmlWebGPU).toContain("WebGPU Compute Pipeline")
      expect(htmlWebGPU).toContain("Re-seed")
      expect(htmlWebGPU).toContain("Simulation Speed")
      expect(htmlWebGPU).toContain("Damping")
      expect(htmlWebGPU).toContain("Gravity / Force")
      expect(htmlWebGPU).toContain("Particle Size")
      expect(htmlWebGPU).toContain("Additive Blend Mode")
    })
  })

  // --------------------------------------------------------------------------
  // 7. Section 5: Variations & Presets
  // --------------------------------------------------------------------------
  describe("VariationsSection", () => {
    it("renders snapshot creation input, save button, variation cards, and import/export", () => {
      useProjectStore.getState().setUniformValue("u_specular", { type: "float", value: 0.75 })
      const varId = useProjectStore.getState().addVariation("Studio Gold")
      expect(varId).toBeDefined()

      const html = renderToStaticMarkup(<VariationsSection />)

      // Creation bar
      expect(html).toContain("Save Variation")

      // Card
      expect(html).toContain("Studio Gold")
      expect(html).toContain("Active")
      expect(html).toContain("1 uniform")

      // Import & Export buttons
      expect(html).toContain("Import")
      expect(html).toContain("Export")
    })

    it("supports variation import into projectStore", () => {
      useProjectStore.getState().importVariations([
        {
          id: "imported-1",
          name: "Cyber Neon",
          uniformValues: { u_color: { type: "vec3", value: [0.0, 1.0, 1.0] } },
          createdAt: Date.now(),
        },
      ])

      expect(useProjectStore.getState().variations).toHaveLength(1)
      expect(useProjectStore.getState().variations[0].name).toBe("Cyber Neon")
    })
  })
})
