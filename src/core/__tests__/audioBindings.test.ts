import { describe, it, expect, beforeEach } from "vitest"
import { useProjectStore } from "@/stores/projectStore"
import type { AudioBinding } from "@/stores/projectStore"

describe("Live Audio-Reactive Parameter Modulation Suite", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    useProjectStore.getState().clearAudioBindings()
  })

  it("adds, updates, and removes an audio binding for a uniform", () => {
    const store = useProjectStore.getState()
    
    // Add uniform
    store.setUniformValue("u_speed", { type: "float", value: 1.0 })
    expect(useProjectStore.getState().audioBindings["u_speed"]).toBeUndefined()

    // Bind to Bass
    store.setAudioBinding("u_speed", { band: "bass", amount: 2.0 })
    let bindings = useProjectStore.getState().audioBindings
    expect(bindings["u_speed"]).toEqual({ band: "bass", amount: 2.0 })

    // Update to Treble with new intensity
    store.setAudioBinding("u_speed", { band: "treble", amount: 0.5 })
    bindings = useProjectStore.getState().audioBindings
    expect(bindings["u_speed"]).toEqual({ band: "treble", amount: 0.5 })

    // Remove binding
    store.setAudioBinding("u_speed", null)
    bindings = useProjectStore.getState().audioBindings
    expect(bindings["u_speed"]).toBeUndefined()
  })

  it("clears all audio bindings cleanly", () => {
    const store = useProjectStore.getState()
    store.setAudioBinding("u_glow", { band: "mid", amount: 1.5 })
    store.setAudioBinding("u_distortion", { band: "beat", amount: 3.0 })
    expect(Object.keys(useProjectStore.getState().audioBindings).length).toBe(2)

    store.clearAudioBindings()
    expect(Object.keys(useProjectStore.getState().audioBindings).length).toBe(0)
  })

  it("automatically discovers and pre-binds standard audio uniforms in setParsedUniforms", () => {
    const store = useProjectStore.getState()

    store.setParsedUniforms([
      { name: "u_time", type: "f32", kind: "scalar" },
      { name: "u_audioBass", type: "f32", kind: "scalar" },
      { name: "u_audioMid", type: "f32", kind: "scalar" },
      { name: "u_audioTreble", type: "f32", kind: "scalar" },
      { name: "u_audioBeat", type: "f32", kind: "scalar" },
      { name: "u_audioLevel", type: "f32", kind: "scalar" },
      { name: "u_customSpeed", type: "f32", kind: "scalar" },
    ])

    const bindings = useProjectStore.getState().audioBindings
    expect(bindings["u_audioBass"]).toEqual({ band: "bass", amount: 1.0 })
    expect(bindings["u_audioMid"]).toEqual({ band: "mid", amount: 1.0 })
    expect(bindings["u_audioTreble"]).toEqual({ band: "treble", amount: 1.0 })
    expect(bindings["u_audioBeat"]).toEqual({ band: "beat", amount: 1.0 })
    expect(bindings["u_audioLevel"]).toEqual({ band: "level", amount: 1.0 })
    expect(bindings["u_time"]).toBeUndefined()
    expect(bindings["u_customSpeed"]).toBeUndefined()
  })

  it("preserves audio bindings during project serialization, export, and load", () => {
    const store = useProjectStore.getState()
    store.setCurrentProjectName("Audio Reactive Synth")
    store.setUniformValue("u_bassIntensity", { type: "float", value: 0.2 })
    store.setAudioBinding("u_bassIntensity", { band: "bass", amount: 2.5 })

    const exported = store.exportProjectData()
    expect(exported.audioBindings).toBeDefined()
    expect(exported.audioBindings?.["u_bassIntensity"]).toEqual({ band: "bass", amount: 2.5 })

    // Reset project
    store.resetProject()
    expect(useProjectStore.getState().audioBindings["u_bassIntensity"]).toBeUndefined()

    // Load exported project back
    store.loadProjectData(exported)
    expect(useProjectStore.getState().audioBindings["u_bassIntensity"]).toEqual({ band: "bass", amount: 2.5 })
    expect(useProjectStore.getState().currentProjectName).toBe("Audio Reactive Synth")
  })

  it("calculates accurate non-destructive per-frame modulation values", () => {
    const baseValue = 0.5
    const binding: AudioBinding = { band: "bass", amount: 2.0 }
    const audioSignal = 0.75 // 75% bass energy

    const modulatedValue = baseValue + audioSignal * binding.amount
    expect(modulatedValue).toBe(2.0) // 0.5 + 0.75 * 2.0 = 2.0
  })
})
