import { describe, it, expect, vi } from "vitest"

const h = vi.hoisted(() => ({ status: "unverified" as "unverified" | "success" }))
vi.mock("@/bridge/wsBridgeClient", () => ({
  executeShaderLocally: vi.fn(async () => ({ type: "agent:feedback", id: "x", status: h.status, backend: "webgpu", errors: [] })),
}))
vi.mock("../providers", () => ({
  dispatchAICall: vi.fn(async () => "```wgsl\n@fragment fn fragment_main() {}\n```"),
  extractShaderCode: (s: string) => s,
}))

import { runAIShaderGeneration } from "../aiAgentRunner"
import { executeShaderLocally } from "@/bridge/wsBridgeClient"
import type { AISettings } from "../types"

const settings = { activeProvider: "ollama", models: {}, maxAutoFixRetries: 2, visualCritique: false } as unknown as AISettings

describe("AI agent runner: an unverified compile is not a success", () => {
  it("fails the session without burning auto-fix retries when the adapter never reported", async () => {
    h.status = "unverified"
    const session = await runAIShaderGeneration("a red sphere", settings)
    expect(session.status).toBe("error")
    expect(session.errorMessage).toContain("could not be verified")
    const compileStep = session.steps.find((s) => s.type === "compile_check")!
    expect(compileStep.status).toBe("error")
    expect(compileStep.errorMessages?.[0]).toContain("unverified")
    expect(vi.mocked(executeShaderLocally)).toHaveBeenCalledTimes(1)
  })
})
