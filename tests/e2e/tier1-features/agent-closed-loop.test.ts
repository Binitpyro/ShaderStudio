import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../mocks"
import { executeShaderLocally } from "@/bridge/wsBridgeClient"
import { useProjectStore } from "@/stores/projectStore"
import { viewportCapture } from "@/utils/frameCapture"
import { webgl2Adapter } from "@/adapters/webgl2"

describe("Agent Closed-Loop Execution & Frame Capture", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(async () => {
    env = setupE2ETestEnvironment()
    const canvas = env.createCanvas()
    viewportCapture.registerCanvas(canvas as any)
    await webgl2Adapter.mount(canvas as any)
    useProjectStore.getState().setActiveBackend("webgl2")
  })

  afterEach(() => {
    webgl2Adapter.dispose()
    viewportCapture.unregisterCanvas()
    teardownE2ETestEnvironment()
  })

  it("successfully compiles shader and returns structured feedback", async () => {
    const feedback = await executeShaderLocally({
      id: "test_1",
      source: "void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }",
      backend: "webgl2",
      captureSnapshot: true,
    })

    expect(feedback.id).toBe("test_1")
    expect(feedback.status).toBe("success")
    expect(feedback.errors).toHaveLength(0)
    expect(feedback.backend).toBe("webgl2")
    expect(feedback.executionTimeMs).toBeGreaterThanOrEqual(0)
    expect(feedback.perf).toBeDefined()
  })

  it("catches syntax errors and parses diagnostic line/message info", async () => {
    const feedback = await executeShaderLocally({
      id: "test_err",
      source: "SYNTAX_ERROR_TRIGGER: invalid glsl ;;;",
      backend: "webgl2",
      captureSnapshot: false,
    })

    expect(feedback.id).toBe("test_err")
    expect(feedback.status).toBe("error")
    expect(feedback.errors.length).toBeGreaterThan(0)
    expect(feedback.errors[0].message).toContain("Fragment shader error")
  })

  it("updates uniforms as requested in the execute message", async () => {
    await executeShaderLocally({
      id: "test_uniforms",
      source: "uniform float u_speed;\nvoid main() { fragColor = vec4(1.0); }",
      backend: "webgl2",
      uniforms: {
        u_speed: 2.5,
        u_color: [0.2, 0.4, 0.8],
      },
    })

    const uniformValues = useProjectStore.getState().uniformValues
    expect(uniformValues["u_speed"]).toBeDefined()
    expect(uniformValues["u_speed"].value).toBe(2.5)
    expect(uniformValues["u_color"]).toBeDefined()
    expect(uniformValues["u_color"].value).toEqual([0.2, 0.4, 0.8])
  })

  it("captures canvas snapshot via viewportCapture", () => {
    const snapshot = viewportCapture.captureBase64()
    expect(snapshot).toBeDefined()
    expect(typeof snapshot).toBe("string")
    expect(snapshot).toContain("data:image/png;base64")
  })
})
