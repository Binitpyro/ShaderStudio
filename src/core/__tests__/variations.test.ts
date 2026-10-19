import { describe, it, expect, beforeEach } from "vitest"
import { useProjectStore } from "@/stores/projectStore"

describe("Preset Variations & Project Serialization Engine", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  it("adds and tracks a new parameter variation", () => {
    useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 4.2 })
    useProjectStore.getState().setUniformValue("u_color", { type: "vec3", value: [1.0, 0.2, 0.5] })

    const varId = useProjectStore.getState().addVariation("Hyperdrive Pink")

    const state = useProjectStore.getState()
    expect(state.variations).toHaveLength(1)
    expect(state.variations[0].id).toBe(varId)
    expect(state.variations[0].name).toBe("Hyperdrive Pink")
    expect(state.variations[0].uniformValues.u_speed.value).toBe(4.2)
    expect(state.activeVariationId).toBe(varId)
  })

  it("switches and applies variation values to active project uniforms", () => {
    useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 1.0 })
    const varA = useProjectStore.getState().addVariation("Slow")

    useProjectStore.getState().setUniformValue("u_speed", { type: "float", value: 10.0 })
    const varB = useProjectStore.getState().addVariation("Fast")

    expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(10.0)

    // Switch back to Variation A
    useProjectStore.getState().applyVariation(varA)
    expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(1.0)
    expect(useProjectStore.getState().activeVariationId).toBe(varA)

    // Switch to Variation B
    useProjectStore.getState().applyVariation(varB)
    expect(useProjectStore.getState().uniformValues.u_speed.value).toBe(10.0)
    expect(useProjectStore.getState().activeVariationId).toBe(varB)
  })

  it("deletes a variation and clears activeVariationId if deleted", () => {
    const varA = useProjectStore.getState().addVariation("To Delete")
    expect(useProjectStore.getState().variations).toHaveLength(1)
    expect(useProjectStore.getState().activeVariationId).toBe(varA)

    useProjectStore.getState().deleteVariation(varA)
    expect(useProjectStore.getState().variations).toHaveLength(0)
    expect(useProjectStore.getState().activeVariationId).toBeNull()
  })

  it("serializes and exports variations within project data and loads them back", () => {
    useProjectStore.getState().setCurrentProjectName("CyberWave")
    useProjectStore.getState().setActiveBackend("threejs")
    useProjectStore.getState().setShaderSource("void main() { gl_FragColor = vec4(1.0); }")
    useProjectStore.getState().setUniformValue("u_density", { type: "float", value: 3.14 })

    const varId = useProjectStore.getState().addVariation("Dense Core")

    const exported = useProjectStore.getState().exportProjectData()
    expect(exported.name).toBe("CyberWave")
    expect(exported.backend).toBe("threejs")
    expect(exported.variations).toBeDefined()
    expect(exported.variations).toHaveLength(1)
    expect(exported.variations![0].id).toBe(varId)

    // Reset store
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().variations).toHaveLength(0)

    // Re-load exported data
    useProjectStore.getState().loadProjectData(exported)
    const reloaded = useProjectStore.getState()
    expect(reloaded.currentProjectName).toBe("CyberWave")
    expect(reloaded.activeBackend).toBe("threejs")
    expect(reloaded.variations).toHaveLength(1)
    expect(reloaded.variations[0].name).toBe("Dense Core")
    expect(reloaded.uniformValues.u_density.value).toBe(3.14)
  })

  it("resets project to default clean state", () => {
    useProjectStore.getState().setCurrentProjectName("Temporary")
    useProjectStore.getState().setShaderSource("custom shader")
    useProjectStore.getState().addVariation("Temp Var")

    useProjectStore.getState().resetProject()

    const state = useProjectStore.getState()
    expect(state.currentProjectName).toBe("Untitled")
    expect(state.shaderSource).toBe("")
    expect(state.variations).toHaveLength(0)
    expect(state.activeVariationId).toBeNull()
    expect(state.hasUnsavedChanges).toBe(false)
  })
})
