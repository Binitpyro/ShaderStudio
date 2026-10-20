import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { SHADER_TEMPLATES, TEMPLATE_CATEGORY_NAMES, applyTemplate, normalizeTemplate, type RawShaderTemplate } from "@/core/templates"
import { TEMPLATE_CATEGORIES } from "@/components/sidebars/TemplatesSidebar"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { computeUniformBufferLayout } from "@/core/uniformLayout"
import { compileGraph } from "@/core/graphCompiler"
import { useProjectStore } from "@/stores/projectStore"
import * as wasm from "@/wasm/pkg/shaderstudio_wasm"

const strip = (n: string) => n.replace(/^u_/, "")
// mvp is the vertex stage's matrix (GLSL gets it from the vertex shader); the rest of the names must match 1:1.
const names = (list: { name: string }[]) => new Set(list.map((u) => strip(u.name)).filter((n) => n !== "mvp"))
const plain = SHADER_TEMPLATES.filter((t) => !t.graph)
const sdf = SHADER_TEMPLATES.filter((t) => t.graph)

describe("templates run on every backend", () => {
  it("has both sources for every template", () => {
    for (const t of SHADER_TEMPLATES) {
      expect(t.wgsl.trim().length, t.id).toBeGreaterThan(100)
      expect(t.glsl.trim().length, t.id).toBeGreaterThan(100)
    }
  })

  describe.each(plain.map((t) => [t.id, t] as const))("%s", (_id, t) => {
    const w = parseWgslUniforms(t.wgsl)
    const g = parseGlslUniforms(t.glsl)

    it("WGSL and GLSL declare the same uniform names", () => {
      expect([...names(w)].sort()).toEqual([...names(g)].sort())
    })

    it("every template uniform exists in both sources with a valid default and range", () => {
      for (const [key, val] of Object.entries(t.uniforms)) {
        expect(names(w).has(strip(key)), `${key} in wgsl`).toBe(true)
        expect(names(g).has(strip(key)), `${key} in glsl`).toBe(true)
        if (val.type === "float") {
          const r = t.ranges[key]
          expect(r, `${key} range`).toBeDefined()
          expect(val.value as number).toBeGreaterThanOrEqual(r[0])
          expect(val.value as number).toBeLessThanOrEqual(r[1])
        }
      }
    })

    it("WGSL has the adapter's entry points, binding and a packable uniform block", () => {
      expect(t.wgsl).toContain("@group(0) @binding(0) var<uniform> uniforms: Uniforms;")
      expect(t.wgsl).toContain("fn vertex_main(")
      expect(t.wgsl).toContain("fn fragment_main(")
      expect(t.wgsl).toContain("@location(0) position: vec3<f32>")
      expect(w.some((u) => u.name === "mvp")).toBe(true)
      const layout = computeUniformBufferLayout(w.filter((u) => u.kind !== "texture"))
      expect(layout.fields["mvp"].offset).toBe(0)
      expect(layout.totalSize % 16).toBe(0)
      for (const c of [t.wgsl, t.glsl]) {
        expect([...c].filter((ch) => ch === "{").length).toBe([...c].filter((ch) => ch === "}").length)
        expect([...c].filter((ch) => ch === "(").length).toBe([...c].filter((ch) => ch === ")").length)
      }
    })

    it("GLSL is ES 3.00 and matches the starter vertex stage", () => {
      expect(t.glsl.startsWith("#version 300 es")).toBe(true)
      expect(t.glsl).toContain("in vec3 v_world_pos;")
      expect(t.glsl).toContain("out vec4 fragColor;")
      expect(t.glsl).not.toContain("gl_FragColor")
    })
  })

  describe.each(sdf.map((t) => [t.id, t] as const))("%s (SDF graph)", (_id, t) => {
    it("graph compiles to non-empty sources in both languages", () => {
      const res = compileGraph(t.graph!.nodes, t.graph!.edges)
      expect(res.error).toBeNull()
      const step = res.queue.find((s) => s.type === "raymarch")
      expect(step).toBeDefined()
      if (step?.type !== "raymarch") return
      expect(step.glslSource.length).toBeGreaterThan(100)
      expect(step.wgslSource.length).toBeGreaterThan(100)
      expect(t.glsl).toBe(step.glslSource)
      expect(t.wgsl).toBe(step.wgslSource)
      expect(Object.keys(step.sdfUniforms ?? {}).length).toBeGreaterThan(0)
      expect(parseWgslUniforms(t.wgsl).length).toBeGreaterThan(0)
      expect(parseGlslUniforms(t.glsl).length).toBeGreaterThan(0)
    })

    it("every called SDF helper is defined in both sources", () => {
      const calls = (src: string) => [...new Set([...src.matchAll(/\b((?:sd|op)[A-Z]\w*)\(/g)].map((m) => m[1]))]
      const defined = (src: string, fn: string) => new RegExp(`(?:float|vec3|fn)\\s+${fn}\\s*\\(`).test(src)
      for (const src of [t.glsl, t.wgsl]) {
        for (const fn of calls(src)) expect(defined(src, fn), `${fn} undefined`).toBe(true)
      }
    })
  })

  it("every category has a template and the sidebar lists them all", () => {
    for (const c of TEMPLATE_CATEGORY_NAMES) {
      expect(SHADER_TEMPLATES.filter((t) => t.category === c).length, c).toBeGreaterThanOrEqual(1)
      expect([...TEMPLATE_CATEGORIES]).toContain(c)
    }
    for (const t of SHADER_TEMPLATES) expect([...TEMPLATE_CATEGORIES]).toContain(t.category)
  })

  describe.each(SHADER_TEMPLATES.map((t) => [t.id, t] as const))("naga: %s", (_id, t) => {
    it("WGSL validates", () => {
      const fn = (wasm as unknown as { transpile_wgsl_wasm?: (s: string, target: string, stage?: string) => { error?: string } }).transpile_wgsl_wasm
      expect(typeof fn, "transpile_wgsl_wasm export").toBe("function")
      wasm.initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")) })
      expect(fn!(t.wgsl, "glsl").error).toBeUndefined()
    })
  })

  it("a broken graph warns with the template id instead of silently yielding empty sources", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const raw: RawShaderTemplate = { id: "broken-graph", name: "x", category: "Raymarching & SDF", description: "", geometry: "plane", graph: { nodes: [], edges: [] } }
    const t = normalizeTemplate(raw)
    expect(t.glsl).toBe("")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("broken-graph"))
    warn.mockRestore()
  })

  describe("applyTemplate", () => {
    beforeEach(() => useProjectStore.getState().resetProject?.())

    it.each(["webgpu", "webgl2", "threejs"] as const)("keeps the %s backend and writes both sources", (backend) => {
      for (const t of SHADER_TEMPLATES) {
        useProjectStore.setState({ activeBackend: backend })
        applyTemplate(t)
        const s = useProjectStore.getState()
        expect(s.activeBackend).toBe(backend)
        expect(s.wgslSource).toBe(t.wgsl)
        expect(s.glslSource).toBe(t.glsl)
        expect(s.shaderSource).toBe(backend === "webgpu" ? t.wgsl : t.glsl)
        const hasRaymarch = s._graphNodes.some((n) => n.data.type === "raymarch")
        expect(hasRaymarch).toBe(!!t.graph)
        if (!t.graph) expect(s._graphNodes.find((n) => n.type === "mesh")?.data.geometry).toBe(t.geometry)
      }
    })

    it("SDF apply: fullscreen pass on a plane, vertex stage without the MVP (WGSL + GLSL)", () => {
      for (const t of sdf) {
        applyTemplate(t)
        const s = useProjectStore.getState()
        // WGSL: the vertex stage never touches uniforms.mvp and draws from the vertex index
        const vs = t.wgsl.slice(t.wgsl.indexOf("fn vertex_main"), t.wgsl.indexOf("fn ", t.wgsl.indexOf("fn vertex_main") + 5))
        expect(vs, t.id).not.toMatch(/mvp/)
        expect(vs, t.id).toContain("input.vertexIndex")
        expect(t.wgsl, t.id).toContain("@builtin(vertex_index)")
        // GLSL: the project's vertex stage is the fullscreen one
        expect(s.vertexShaderSource, t.id).not.toMatch(/mvp/)
        expect(s.vertexShaderSource, t.id).toContain("gl_Position = vec4(clip")
        expect(s.vertexShaderSource, t.id).toContain("v_uv")
        // and the render queue draws a plane first
        const mesh = s.renderQueue?.find((q) => q.type === "mesh")
        expect(mesh && mesh.type === "mesh" ? mesh.geometry : null, t.id).toBe("plane")
      }
    })

    it("a mesh template after an SDF one restores the MVP vertex stage and its geometry", () => {
      applyTemplate(sdf[0])
      const mesh = plain[0]
      applyTemplate(mesh)
      const s = useProjectStore.getState()
      expect(s.vertexShaderSource).toContain("u_mvp")
      expect(s.vertexShaderSource).toContain("v_world_pos")
      const step = s.renderQueue?.find((q) => q.type === "mesh")
      expect(step && step.type === "mesh" ? step.geometry : null).toBe(mesh.geometry)
    })

    it("SDF apply loads the graph and its parameter uniforms", () => {
      const t = sdf[0]
      applyTemplate(t)
      const s = useProjectStore.getState()
      expect(s._graphNodes.map((n) => n.id)).toEqual(t.graph!.nodes.map((n) => n.id))
      for (const name of Object.keys(t.sdfUniforms!)) expect(s.uniformValues[name]).toBeDefined()
    })
  })
})
