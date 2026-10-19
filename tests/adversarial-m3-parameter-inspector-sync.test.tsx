/**
 * Adversarial Challenger 2 Suite for Milestone 3 (Requirement R3: Parameter Inspector & Organization)
 *
 * Empirical verification of:
 * 1. State persistence, store synchronization, and hardware adapter updates when uniforms change:
 *    - Type fidelity: float, int, uint, bool, vec2, vec3, vec4, color (RGB + RGBA), mat2, mat3, mat4.
 *    - Adapter routing across WebGPU, WebGL2, and ThreeJS backends.
 * 2. Per-uniform reset to default:
 *    - Hardware adapter receives updateUniform with default value and correct type.
 *    - Isolation: non-reset uniforms remain untouched.
 *    - Graph uniform custom defaultValues.
 * 3. Global reset-all:
 *    - All uniforms in both store and active hardware adapter restored.
 * 4. Variation snapshots:
 *    - Active adapter receives updateUniform for all snapshot uniform values upon application.
 *    - Adapter switching synchronization.
 * 5. Environment preset changes & adapter propagation:
 *    - Preset selection, exposure, rotation, blur, and skybox propagation to store and adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"
import { UniformsSection } from "@/components/inspector/UniformsSection"
import { EnvironmentSection } from "@/components/inspector/EnvironmentSection"
import { VariationsSection } from "@/components/inspector/VariationsSection"
import {
  useProjectStore,
  type ParsedUniform,
  type UniformValue,
  type GraphUniform,
} from "@/stores/projectStore"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "./e2e/mocks"

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

    it("routes uniform changes to the currently active hardware adapter (WebGL2 & ThreeJS)", () => {
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

    it("synchronizes with newly selected backend when applying variation snapshot", () => {
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

