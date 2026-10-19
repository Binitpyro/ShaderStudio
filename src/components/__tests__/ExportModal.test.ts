import { describe, it, expect, beforeEach } from "vitest"
import { useProjectStore } from "@/stores/projectStore"

describe("Export Deliverables Generator", () => {
  beforeEach(() => {
    useProjectStore.getState().setShaderSource("precision highp float; out vec4 fragColor; void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }")
    useProjectStore.getState().setParsedUniforms([
      { name: "u_speed", type: "f32", kind: "scalar" },
      { name: "u_tint", type: "vec3f", kind: "color" },
    ])
  })

  it("populates shader source and uniforms in project store", () => {
    const state = useProjectStore.getState()
    expect(state.shaderSource).toContain("fragColor = vec4(1.0, 0.0, 0.0, 1.0);")
    expect(state.parsedUniforms.map((u) => u.name)).toContain("u_speed")
    expect(state.parsedUniforms.map((u) => u.name)).toContain("u_tint")
  })
})
