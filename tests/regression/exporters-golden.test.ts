import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { initSync } from "@/wasm/pkg/shaderstudio_wasm"
import { generateExport, type ExportProject, type ExportTarget } from "@/core/engineTranspiler"
import { STARTER_WGSL } from "@/core/defaultStarterScene"
import { SHADER_TEMPLATES } from "@/core/templates"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { getDefaultUniformValue, type UniformValue } from "@/stores/projectStore"

/**
 * Golden-file tests for the export targets. Fixtures live in tests/regression/__golden__/.
 * Regenerate after an intentional change:  UPDATE_GOLDEN=1 npx vitest run tests/regression/exporters-golden.test.ts
 * (PowerShell: $env:UPDATE_GOLDEN=1; npx vitest run ...), then review the fixture diff.
 */
const GOLDEN_DIR = resolve(process.cwd(), "tests/regression/__golden__")
const UPDATE = process.env.UPDATE_GOLDEN === "1"

function expectGolden(name: string, actual: string) {
  const file = resolve(GOLDEN_DIR, name)
  if (UPDATE) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, actual)
    return
  }
  if (!existsSync(file)) throw new Error(`Missing golden fixture ${name}. Generate it with UPDATE_GOLDEN=1.`)
  // fixtures are compared with LF line endings so a Windows checkout (autocrlf) doesn't churn them
  expect(actual).toBe(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
}

function withDefaults(project: ExportProject): ExportProject {
  const uniformValues: Record<string, UniformValue> = {}
  for (const u of project.parsedUniforms ?? []) uniformValues[u.name] = getDefaultUniformValue(u)
  return { ...project, uniformValues: { ...uniformValues, ...project.uniformValues } }
}

const synthwave = SHADER_TEMPLATES.find((t) => t.id === "synthwave-grid")!

const PROJECTS: Record<string, ExportProject> = {
  // WGSL only: GLSL targets go through naga, Unity through naga HLSL
  "starter-wgsl": withDefaults({
    geometry: "torus_knot",
    wgslSource: STARTER_WGSL,
    glslSource: "",
    parsedUniforms: parseWgslUniforms(STARTER_WGSL).filter((u) => u.name !== "mvp"),
    uniformValues: {
      pulseSpeed: { type: "float", value: 1.5 },
      fresnelPower: { type: "float", value: 3 },
      iridescence: { type: "float", value: 0.8 },
      color: { type: "color", value: [0.4, 0.6, 0.9] },
      roughness: { type: "float", value: 0.35 },
    },
  }),
  // GLSL only: the hand-written GLSL feeds every target, Unity through the GLSL -> HLSL path
  "synthwave-glsl": withDefaults({
    geometry: synthwave.geometry,
    wgslSource: "",
    glslSource: synthwave.glsl,
    parsedUniforms: parseGlslUniforms(synthwave.glsl),
    uniformValues: synthwave.uniforms,
  }),
}

const TARGETS: Array<[ExportTarget, string]> = [
  ["unity", "shader"],
  ["godot", "gdshader"],
  ["shadertoy", "glsl"],
  ["r3f", "tsx"],
  ["html", "html"],
  ["gltf", "gltf"],
]

beforeAll(() => {
  initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/pkg/shaderstudio_wasm_bg.wasm")) })
})

describe("export golden files", () => {
  for (const [projectName, project] of Object.entries(PROJECTS)) {
    describe(projectName, () => {
      for (const [target, ext] of TARGETS) {
        it(`${target} matches the golden fixture`, async () => {
          const res = await generateExport(target, project)
          if ("error" in res) throw new Error(`${target} failed: ${res.error}`)
          expectGolden(`${projectName}.${target}.${ext}`, res.code)
        })
      }
    })
  }

  it("fixtures are free of engine-incompatible leftovers", async () => {
    for (const [name, project] of Object.entries(PROJECTS)) {
      for (const target of ["godot", "shadertoy", "unity"] as const) {
        const res = await generateExport(target, project)
        if ("error" in res) throw new Error(res.error)
        const code = res.code
        expect(code, `${name} ${target}`).not.toMatch(/#version|precision\s+(highp|mediump)|\bvoid\s+main\s*\(/)
        expect(code, `${name} ${target}`).not.toMatch(/_group_\d+_binding_\d+|_vs2fs_location|_fs2p_location/)
        expect(code, `${name} ${target}`).not.toMatch(/\buniform\s+\w+\s*\{/)
      }
    }
  })

  it("braces and parentheses balance in every generated shader", async () => {
    for (const [name, project] of Object.entries(PROJECTS)) {
      for (const [target] of TARGETS) {
        const res = await generateExport(target, project)
        if ("error" in res) throw new Error(res.error)
        const code = res.code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/`[\s\S]*?`/g, "")
        for (const [o, c] of [["{", "}"], ["(", ")"]]) {
          expect(code.split(o).length, `${name} ${target} ${o}`).toBe(code.split(c).length)
        }
      }
    }
  })
})
