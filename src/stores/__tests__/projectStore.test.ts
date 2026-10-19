import { describe, it, expect, beforeEach } from "vitest"
import { useProjectStore } from "../projectStore"

describe("Project Store Persistence & Default Merging", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  it("merges partial environmentSettings with full defaults when loading legacy project data", () => {
    const legacyProjectData: any = {
      name: "Legacy Project",
      backend: "webgl2",
      shaderSources: { glsl: "void main() {}" },
      // Legacy data missing backgroundBlur and showSkybox
      environmentSettings: {
        preset: "cyberpunk_neon",
        exposure: 1.5,
      },
    }

    useProjectStore.getState().loadProjectData(legacyProjectData)
    const env = useProjectStore.getState().environmentSettings

    expect(env.preset).toBe("cyberpunk_neon")
    expect(env.exposure).toBe(1.5)
    expect(env.rotation).toBe(0.0)
    expect(env.backgroundBlur).toBe(0.0)
    expect(env.showSkybox).toBe(false)
  })

  it("falls back cleanly to default environment settings when environmentSettings is omitted", () => {
    const minimalProjectData: any = {
      name: "Minimal Project",
      backend: "webgpu",
      shaderSources: { wgsl: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }" },
    }

    useProjectStore.getState().loadProjectData(minimalProjectData)
    const env = useProjectStore.getState().environmentSettings

    expect(env.preset).toBe("studio_warm")
    expect(env.exposure).toBe(1.0)
    expect(env.rotation).toBe(0.0)
    expect(env.backgroundBlur).toBe(0.0)
    expect(env.showSkybox).toBe(false)
  })
})
