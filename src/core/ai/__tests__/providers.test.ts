import { describe, it, expect } from "vitest"
import { extractShaderCode } from "../providers"

describe("AI Providers - Shader Code Extraction", () => {
  it("extracts WGSL block correctly from markdown", () => {
    const raw = `Here is your iridescent shader:
\`\`\`wgsl
@vertex fn vertex_main() -> VertexOutput {
  return VertexOutput();
}
@fragment fn fragment_main() -> @location(0) vec4f {
  return vec4f(1.0, 0.5, 0.2, 1.0);
}
\`\`\`
Hope you like it!`

    const extracted = extractShaderCode(raw, "webgpu")
    expect(extracted).toContain("@fragment fn fragment_main")
    expect(extracted).not.toContain("Here is your iridescent shader")
    expect(extracted).not.toContain("```")
  })

  it("extracts GLSL block correctly from markdown", () => {
    const raw = `\`\`\`glsl
#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0, 1.0, 0.0, 1.0);
}
\`\`\``

    const extracted = extractShaderCode(raw, "webgl2")
    expect(extracted).toContain("#version 300 es")
    expect(extracted).toContain("out vec4 fragColor;")
  })

  it("extracts generic code block when contains shader keywords", () => {
    const raw = `\`\`\`
void main() {
  vec4 color = vec4(1.0);
}
\`\`\``

    const extracted = extractShaderCode(raw, "webgl2")
    expect(extracted).toContain("void main()")
  })

  it("handles raw shader text without code fences gracefully", () => {
    const raw = `void main() {
  fragColor = vec4(0.5);
}`
    const extracted = extractShaderCode(raw, "webgl2")
    expect(extracted).toBe(raw)
  })
})
