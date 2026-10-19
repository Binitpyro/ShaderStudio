import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { useProjectStore, type EnvironmentSettings } from "@/stores/projectStore"
import { threejsAdapter, ThreeJSAdapter } from "@/adapters/threejs"
import { webgl2Adapter, WebGL2Adapter } from "@/adapters/webgl2"
import { webgpuAdapter, WebGPUAdapter } from "@/adapters/webgpu"

describe("Tier 1: Studio Lighting & Image-Based Lighting (IBL / HDRI)", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    useProjectStore.getState().resetProject()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
  })

  it("initializes project store with default studio environment settings", () => {
    const env = useProjectStore.getState().environmentSettings
    expect(env).toBeDefined()
    expect(env?.preset).toBe("studio_warm")
    expect(env?.exposure).toBe(1.0)
    expect(env?.rotation).toBe(0)
    expect(env?.backgroundBlur).toBe(0.0)
    expect(env?.showSkybox).toBe(false)
  })

  it("updates environment preset and individual parameters via store actions", () => {
    const {
      setEnvironmentPreset,
      setEnvironmentExposure,
      setEnvironmentRotation,
      setEnvironmentSkybox,
      setEnvironmentSettings,
    } = useProjectStore.getState()

    setEnvironmentPreset("cyberpunk_neon")
    expect(useProjectStore.getState().environmentSettings?.preset).toBe("cyberpunk_neon")

    setEnvironmentExposure(2.5)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(2.5)

    setEnvironmentRotation(180)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(180)

    setEnvironmentSkybox(false)
    expect(useProjectStore.getState().environmentSettings?.showSkybox).toBe(false)

    setEnvironmentSettings({ backgroundBlur: 0.75 })
    expect(useProjectStore.getState().environmentSettings?.backgroundBlur).toBe(0.75)
  })

  it("serializes and restores environment settings in exportProjectData and loadProjectData", () => {
    const { setEnvironmentPreset, setEnvironmentExposure, setEnvironmentRotation } =
      useProjectStore.getState()

    setEnvironmentPreset("nebula")
    setEnvironmentExposure(1.85)
    setEnvironmentRotation(90)

    const exported = useProjectStore.getState().exportProjectData()
    expect(exported.environmentSettings).toBeDefined()
    expect(exported.environmentSettings?.preset).toBe("nebula")
    expect(exported.environmentSettings?.exposure).toBe(1.85)
    expect(exported.environmentSettings?.rotation).toBe(90)

    // Reset and reload
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().environmentSettings?.preset).toBe("studio_warm")

    useProjectStore.getState().loadProjectData(exported)
    const reloaded = useProjectStore.getState().environmentSettings
    expect(reloaded?.preset).toBe("nebula")
    expect(reloaded?.exposure).toBe(1.85)
    expect(reloaded?.rotation).toBe(90)
  })

  it("adapter contracts accept updateEnvironment without runtime crashes", () => {
    const customSettings: EnvironmentSettings = {
      preset: "sunset",
      exposure: 1.5,
      rotation: 45,
      backgroundBlur: 0.3,
      showSkybox: true,
    }

    expect(() => threejsAdapter.updateEnvironment?.(customSettings)).not.toThrow()
    expect(() => webgl2Adapter.updateEnvironment?.(customSettings)).not.toThrow()
    expect(() => webgpuAdapter.updateEnvironment?.(customSettings)).not.toThrow()
  })

  it("clamps and handles extreme environment exposure and rotation values", () => {
    const { setEnvironmentExposure, setEnvironmentRotation } = useProjectStore.getState()

    setEnvironmentExposure(0.0)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(0.1)

    setEnvironmentExposure(10.0)
    expect(useProjectStore.getState().environmentSettings?.exposure).toBe(4.0)

    setEnvironmentRotation(400)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(40)

    setEnvironmentRotation(-30)
    expect(useProjectStore.getState().environmentSettings?.rotation).toBe(330)
  })

  it("enables skybox rendering in WebGPU adapter and tears down cleanly when disabled", async () => {
    const adapter = new WebGPUAdapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Initially showSkybox is false
    expect((adapter as any).skyboxPipeline).toBeNull()

    // Enable skybox
    adapter.updateEnvironment({
      preset: "studio_warm",
      exposure: 1.5,
      rotation: 60,
      backgroundBlur: 0.2,
      showSkybox: true,
    })

    expect((adapter as any).skyboxPipeline).toBeDefined()
    expect((adapter as any).skyboxUniformBuffer).toBeDefined()

    // Render frame with skybox active
    expect(() => adapter.renderFrame(1000, 16)).not.toThrow()

    // Disable skybox
    adapter.updateEnvironment({
      preset: "studio_warm",
      exposure: 1.5,
      rotation: 60,
      backgroundBlur: 0.2,
      showSkybox: false,
    })

    expect((adapter as any).skyboxPipeline).toBeNull()
    expect((adapter as any).skyboxUniformBuffer).toBeNull()

    adapter.dispose()
  })

  it("enables skybox rendering in WebGL2 adapter and tears down cleanly when disabled", async () => {
    const adapter = new WebGL2Adapter()
    const canvas = env.createCanvas()
    await adapter.mount(canvas as any)

    // Initially showSkybox is false
    expect((adapter as any).skyboxProgram).toBeNull()

    // Enable skybox
    adapter.updateEnvironment({
      preset: "cyberpunk_neon",
      exposure: 2.0,
      rotation: 120,
      backgroundBlur: 0.5,
      showSkybox: true,
    })

    expect((adapter as any).skyboxProgram).toBeDefined()
    expect((adapter as any).skyboxVAO).toBeDefined()

    // Render frame with skybox active
    expect(() => adapter.renderFrame(1000, 16)).not.toThrow()

    // Disable skybox
    adapter.updateEnvironment({
      preset: "cyberpunk_neon",
      exposure: 2.0,
      rotation: 120,
      backgroundBlur: 0.5,
      showSkybox: false,
    })

    expect((adapter as any).skyboxProgram).toBeNull()
    expect((adapter as any).skyboxVAO).toBeNull()

    adapter.dispose()
  })
})

