import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { WebGPUAdapter } from "@/adapters/webgpu"
import { WebGL2Adapter, webgl2Adapter } from "@/adapters/webgl2"
import { useProjectStore, type ParsedUniform } from "@/stores/projectStore"
import { viewportCapture } from "@/utils/frameCapture"
import { executeShaderLocally } from "@/bridge/wsBridgeClient"
import { compileGraph, flattenGraph, type GraphNodeData, type RenderStep } from "@/core/graphCompiler"
import type { SubGraphDefinition } from "@/core/subGraphLibrary"
import { CustomNodeRegistry, type CustomNodeManifest } from "@/core/customNodeSdk"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { parseOBJ } from "@/core/modelLoader"
import { generatePbrPixelBuffers } from "@/core/textureBaker"
import { createZipArchive } from "@/utils/zipBuilder"
import {
  transpileToUE5,
  transpileToBlenderOSL,
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
  exportGltf2Material,
  generateR3FExport,
  packOrmTexture,
} from "@/core/engineTranspiler"
import { parseDiagnosticErrors } from "@/utils/diagnosticParser"
import { saveProjectNative, loadProjectNative, startMcpBridge, stopMcpBridge, getMcpBridgeStatus, resetDesktopFallbackState } from "@/desktop/tauriBridge"

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  const { MockThreeRenderer } = await import("../e2e/mocks/mockThreeJS")
  return { ...actual, WebGLRenderer: MockThreeRenderer }
})

type Backend = "webgpu" | "webgl2" | "threejs"
const BACKENDS: Backend[] = ["webgpu", "webgl2", "threejs"]

async function makeAdapter(backend: Backend): Promise<any> {
  if (backend === "webgpu") return new WebGPUAdapter()
  if (backend === "webgl2") return new WebGL2Adapter()
  const { ThreeJSAdapter } = await import("@/adapters/threejs")
  return new ThreeJSAdapter()
}

describe("cross-feature combinations", () => {
  let env: ReturnType<typeof setupE2ETestEnvironment>

  beforeEach(() => {
    env = setupE2ETestEnvironment()
    resetDesktopFallbackState()
  })
  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  describe("backend matrices", () => {
    for (const backend of BACKENDS) {
      it(`${backend}: renders every geometry without a compile error`, async () => {
        for (const geometry of ["cube", "sphere", "plane"] as const) {
          const adapter = await makeAdapter(backend)
          await adapter.mount(env.createCanvas(800, 600) as any)
          adapter.setRenderQueue([{ type: "mesh", geometry }])
          env.clock.step(16)
          expect(useProjectStore.getState().lastCompileError, geometry).toBeNull()
          adapter.dispose()
        }
      })

      it(`${backend}: accepts 0/1/2 textures with scalar, color and matrix uniforms`, async () => {
        const uniformSets: Array<Record<string, unknown>> = [
          { u_speed: 1.5 },
          { color: [1, 0, 0] },
          { u_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        ]
        for (let textureCount = 0; textureCount < 3; textureCount++) {
          const adapter = await makeAdapter(backend)
          await adapter.mount(env.createCanvas(640, 480) as any)
          const queue: RenderStep[] = [{ type: "mesh", geometry: "cube" }]
          for (let i = 0; i < textureCount; i++) {
            const id = `tex-${backend}-${textureCount}-${i}`
            useProjectStore.getState().addTextureResource({ id, name: `tex${i}.png`, src: "data:image" })
            queue.push({ type: "texture", id, src: "data:image", binding: i })
          }
          adapter.setRenderQueue(queue)
          for (const [key, val] of Object.entries(uniformSets[textureCount])) {
            const type = Array.isArray(val) && val.length === 3 ? "color" : typeof val === "number" ? "float" : "mat4"
            useProjectStore.getState().setUniformValue(key, { type: type as any, value: val as any })
            adapter.updateUniform(key, { type: type as any, value: val as any })
          }
          env.clock.step(16)
          expect(useProjectStore.getState().lastCompileError, `${textureCount} textures`).toBeNull()
          adapter.dispose()
        }
      })

      it(`${backend}: runs none / single / chained post-process passes`, async () => {
        const pass = { type: "postprocess" as const, pass: "passthrough" as const }
        for (const passes of [[], [pass], [pass, pass]]) {
          const adapter = await makeAdapter(backend)
          await adapter.mount(env.createCanvas() as any)
          adapter.setRenderQueue([
            { type: "mesh", geometry: "sphere" },
            { type: "material", shaderPath: "default.wgsl", textureBindings: {} },
            ...passes,
          ])
          env.clock.step(16)
          expect(useProjectStore.getState().lastCompileError, `${passes.length} passes`).toBeNull()
          adapter.dispose()
        }
      })

      it(`${backend}: survives repeated resizes during the render loop`, async () => {
        const adapter = await makeAdapter(backend)
        await adapter.mount(env.createCanvas(400, 300) as any)
        adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
        env.clock.step(16)
        adapter.resize(800, 600)
        env.clock.step(16)
        adapter.resize(1280, 720)
        env.clock.step(16)
        expect(useProjectStore.getState().lastCompileError).toBeNull()
        adapter.dispose()
      })
    }
  })

  describe("application scenarios (real adapters + store)", () => {
    it("compiles a 5-node graph and executes it on all three backends without leaking loops", async () => {
      const nodes: Node<GraphNodeData>[] = [
        { id: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "cube" } },
        { id: "tex", position: { x: 0, y: 100 }, data: { type: "texture", textureId: "tex-stone", name: "u_stone" } },
        { id: "mat", position: { x: 200, y: 50 }, data: { type: "material", shaderPath: "stone.wgsl" } },
        { id: "pp", position: { x: 400, y: 50 }, data: { type: "postprocess" } },
        { id: "out", position: { x: 600, y: 50 }, data: { type: "output" } },
      ]
      const edges: Edge[] = [
        { id: "e1", source: "mesh", target: "mat", targetHandle: "mesh" },
        { id: "e2", source: "tex", target: "mat" },
        { id: "e3", source: "mat", target: "pp" },
        { id: "e4", source: "pp", target: "out" },
      ]
      useProjectStore.getState().addTextureResource({ id: "tex-stone", name: "stone.png", src: "data:image/png;base64,stone" })

      const compilation = compileGraph(nodes, edges)
      expect(compilation.error).toBeNull()
      expect(compilation.queue).toHaveLength(4)

      for (const backend of BACKENDS) {
        const adapter = await makeAdapter(backend)
        await adapter.mount(env.createCanvas(800, 600) as any)
        adapter.setRenderQueue(compilation.queue)
        env.clock.step(16)
        adapter.dispose()
      }
      expect(env.clock.activeCallbackCount).toBe(0)
    })

    it("applies slider-driven uniform changes on the same frame", async () => {
      const adapter = new WebGL2Adapter()
      await adapter.mount(env.createCanvas() as any)
      for (let frame = 1; frame <= 10; frame++) {
        useProjectStore.getState().setUniformValue("u_roughness", { type: "float", value: frame * 0.1 })
        env.clock.step(16.666)
        expect(env.webgl2.getLastContext()!.uniformValues.get("u_roughness")).toBeCloseTo(frame * 0.1, 2)
      }
      adapter.dispose()
    })

    it("recovers from a mid-edit syntax error and keeps the render loop alive", async () => {
      const adapter = new WebGL2Adapter()
      await adapter.mount(env.createCanvas() as any)
      adapter.recompileShader("void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }")
      env.clock.step(16)
      expect(useProjectStore.getState().lastCompileError).toBeNull()

      adapter.recompileShader("SYNTAX_ERROR_TRIGGER: void main() { fragColor = ")
      env.clock.step(16)
      expect(useProjectStore.getState().lastCompileError).not.toBeNull()
      expect(env.clock.activeCallbackCount).toBe(1)

      adapter.recompileShader("void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }")
      env.clock.step(16)
      expect(useProjectStore.getState().lastCompileError).toBeNull()
      adapter.dispose()
    })

    it("tracks responsive viewport sizes in the GL viewport", async () => {
      const adapter = new WebGL2Adapter()
      await adapter.mount(env.createCanvas(800, 600) as any)
      for (const vp of [
        { w: 1024, h: 768 },
        { w: 1280, h: 720 },
        { w: 1920, h: 1080 },
        { w: 375, h: 667 },
      ]) {
        adapter.resize(vp.w, vp.h)
        env.clock.step(16)
        const gl = env.webgl2.getLastContext()!
        expect([gl.viewportRect.width, gl.viewportRect.height]).toEqual([vp.w, vp.h])
      }
      adapter.dispose()
    })

    it("a chained post-process queue issues extra draws", async () => {
      const adapter = new WebGL2Adapter()
      await adapter.mount(env.createCanvas(800, 600) as any)
      adapter.setRenderQueue([
        { type: "mesh", geometry: "cube" },
        { type: "postprocess", pass: "passthrough" },
      ])
      const gl = env.webgl2.getLastContext()!
      const before = gl.drawCount
      env.clock.step(16)
      expect(gl.drawCount).toBeGreaterThanOrEqual(before + 2)
      adapter.dispose()
    })

    it("keeps uniforms and textures in the store across a webgpu -> webgl2 -> threejs session", async () => {
      const store = useProjectStore.getState()
      store.setUniformValue("u_albedo", { type: "color", value: [0.8, 0.2, 0.5] })
      store.addTextureResource({ id: "tex-wood", name: "wood.png", src: "data:wood" })
      const canvas = env.createCanvas(800, 600)
      for (const backend of BACKENDS) {
        store.setActiveBackend(backend)
        const adapter = await makeAdapter(backend)
        await adapter.mount(canvas as any)
        adapter.setRenderQueue([{ type: "mesh", geometry: "cube" }])
        env.clock.step(16)
        adapter.dispose()
      }
      expect(useProjectStore.getState().uniformValues["u_albedo"].value).toEqual([0.8, 0.2, 0.5])
      expect(useProjectStore.getState().textureResources).toHaveLength(1)
      expect(env.clock.activeCallbackCount).toBe(0)
    })
  })

  describe("agent closed loop (executeShaderLocally)", () => {
    beforeEach(async () => {
      viewportCapture.registerCanvas(env.createCanvas() as any)
      await webgl2Adapter.mount(env.createCanvas() as any)
      useProjectStore.getState().setActiveBackend("webgl2")
    })
    afterEach(() => {
      webgl2Adapter.dispose()
      viewportCapture.unregisterCanvas()
    })

    it("compiles a shader and returns structured success feedback", async () => {
      const fb = await executeShaderLocally({
        id: "test_1",
        source: "void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }",
        backend: "webgl2",
        captureSnapshot: true,
      })
      expect(fb.id).toBe("test_1")
      expect(fb.status).toBe("success")
      expect(fb.errors).toHaveLength(0)
      expect(fb.backend).toBe("webgl2")
      expect(fb.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(fb.perf).toBeDefined()
    })

    it("reports compile errors with parsed diagnostics", async () => {
      const fb = await executeShaderLocally({ id: "test_err", source: "SYNTAX_ERROR_TRIGGER: invalid glsl ;;;", backend: "webgl2", captureSnapshot: false })
      expect(fb.id).toBe("test_err")
      expect(fb.status).toBe("error")
      expect(fb.errors.length).toBeGreaterThan(0)
      expect(fb.errors[0].message).toContain("Fragment shader error")
    })

    it("applies requested uniforms to the store", async () => {
      await executeShaderLocally({
        id: "test_uniforms",
        source: "uniform float u_speed;\nvoid main() { fragColor = vec4(1.0); }",
        backend: "webgl2",
        uniforms: { u_speed: 2.5, u_color: [0.2, 0.4, 0.8] },
      })
      const u = useProjectStore.getState().uniformValues
      expect(u["u_speed"].value).toBe(2.5)
      expect(u["u_color"].value).toEqual([0.2, 0.4, 0.8])
    })

    it("captures a PNG data URL from the registered viewport canvas", () => {
      expect(viewportCapture.captureBase64()).toContain("data:image/png;base64")
    })
  })

  describe("asset -> shader -> export pipelines", () => {
    it("normalizes an OBJ, bakes PBR maps and exports Unity HLSL with uniform buffers", () => {
      const geometry = parseOBJ("v -2 -2 0\nv 2 -2 0\nv 0 2 0\nf 1 2 3", "combo_mesh.obj")
      expect([geometry.vertexCount, geometry.positions.length]).toEqual([3, 9])

      const pbr = generatePbrPixelBuffers(
        { data: new Uint8ClampedArray(16 * 16 * 4).fill(180), width: 16, height: 16 } as unknown as ImageData,
        { normalStrength: 1.5, invertNormalY: false, metallicMode: "metal" }
      )
      expect(pbr.normal).toHaveLength(16 * 16 * 4)
      expect(pbr.metallic[0]).toBe(255)

      const hlsl = transpileToUnityHLSL({
        shaderName: "Combo/NormalizedAssetShader",
        shaderSource: "void main() { fragColor = u_color; }",
        parsedUniforms: [
          { name: "u_color", type: "vec4f", kind: "color" },
          { name: "u_metallic", type: "f32", kind: "scalar" },
        ],
        uniformValues: { u_color: { type: "color", value: [0.9, 0.5, 0.1, 1.0] }, u_metallic: { type: "float", value: 1.0 } },
      })
      for (const s of ["CBUFFER_START(UnityPerMaterial)", "float4 _u_color;", "float _u_metallic;"]) expect(hlsl).toContain(s)
    })

    it("ingests an OBJ, bakes six maps and packages a ZIP bundle", () => {
      const geometry = parseOBJ("v -50 -50 0\nv 50 -50 0\nv 0 50 0\nf 1 2 3", "character_shield.obj")
      expect([geometry.positions.length, geometry.normals.length]).toEqual([9, 9])
      expect(Math.max(...geometry.positions.map(Math.abs))).toBeLessThan(2.0)

      const baked = generatePbrPixelBuffers(
        { data: new Uint8ClampedArray(32 * 32 * 4).fill(200), width: 32, height: 32 } as unknown as ImageData,
        { normalStrength: 2.0, invertNormalY: true, metallicMode: "auto", aoStrength: 1.0 }
      )
      for (const k of ["albedo", "normal", "roughness", "heightMap", "metallic", "ao"] as const) expect(baked[k]).toHaveLength(32 * 32 * 4)

      const zip = createZipArchive([
        { name: "albedo.raw", data: new Uint8Array(baked.albedo.buffer) },
        { name: "normal.raw", data: new Uint8Array(baked.normal.buffer) },
        { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({ name: "character_shield", vertexCount: geometry.vertexCount })) },
      ] as never)
      expect(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true)).toBe(0x04034b50)
    })

    it("exports one shader to Unity, Godot and Shadertoy with consistent uniform defaults", () => {
      const options = {
        shaderName: "Game/HologramPulse",
        shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; vec3 col = u_tint.rgb * sin(u_time * u_pulseSpeed); fragColor = vec4(col, 1.0); }",
        parsedUniforms: [
          { name: "u_tint", type: "vec4f", kind: "color" as const },
          { name: "u_pulseSpeed", type: "f32", kind: "scalar" as const },
        ],
        uniformValues: {
          u_tint: { type: "color" as const, value: [0.2, 0.9, 0.8, 1.0] },
          u_pulseSpeed: { type: "float" as const, value: 4.0 },
        },
      }
      const unity = transpileToUnityHLSL(options)
      expect(unity).toContain('_u_tint ("u_tint", Color) = (0.2, 0.9, 0.8, 1)')
      expect(unity).toContain('_u_pulseSpeed ("u_pulseSpeed", Float) = 4')
      const godot = transpileToGodotShader(options)
      expect(godot).toContain("uniform vec4 u_tint : source_color = vec4(0.2, 0.9, 0.8, 1);")
      expect(godot).toContain("uniform float u_pulseSpeed = 4;")
      expect(transpileToShadertoy(options)).toContain("iResolution.xy")
    })

    it("transpiles a broken shader without throwing and parses driver diagnostics separately", () => {
      const godot = transpileToGodotShader({
        shaderSource: "void main() {\n vec3 col = u_unknown_val * 2.0;\n fragColor = vec4(col, 1.0)\n",
        parsedUniforms: [],
      })
      expect(godot).toContain("shader_type spatial;")

      const diags = parseDiagnosticErrors("ERROR: 0:4: 'u_unknown_val' : undeclared identifier\n:5:1 error: expected ';' for statement")
      expect(diags).toHaveLength(2)
      expect(diags[0].line).toBe(4)
      expect(diags[0].message).toContain("undeclared identifier")
      expect([diags[1].line, diags[1].column]).toEqual([5, 1])
      expect(diags[1].message).toContain("expected ';'")
    })

    it("drives the diagnostics parser from the store's compile error through an edit-fix cycle", () => {
      const store = () => useProjectStore.getState()
      store().setLastCompileError(null)
      expect(parseDiagnosticErrors(store().lastCompileError)).toEqual([])

      store().setLastCompileError(":14:22 error: unexpected token 'var', expected ')'\n    fn compute(x: f32, var y: f32)")
      const markers = parseDiagnosticErrors(store().lastCompileError)
      expect(markers).toHaveLength(1)
      expect([markers[0].line, markers[0].column]).toEqual([14, 22])
      expect(markers[0].message).toContain("unexpected token 'var'")

      store().setLastCompileError(null)
      expect(parseDiagnosticErrors(store().lastCompileError)).toEqual([])
    })
  })

  describe("graph compiler -> exporters under pathological graphs", () => {
    it("flattens an exact 8-level sub-graph tree and feeds its uniforms to UE5 / glTF / OSL / R3F", () => {
      const lib = new Map<string, SubGraphDefinition>()
      lib.set("sg_level_8", {
        id: "sg_level_8",
        name: "Deep Leaf Stage 8",
        inputs: [{ id: "in_val", name: "val", type: "float", direction: "input", internalNodeId: "u_leaf_val" }],
        outputs: [{ id: "out_val", name: "val", type: "float", direction: "output", internalNodeId: "u_leaf_val" }],
        nodes: [
          { id: "u_leaf_val", type: "uniform", position: { x: 0, y: 0 }, data: { type: "uniform", uniformId: "u_depth_8_param", name: "depth8Weight", uniformType: "float", defaultValue: 8.88 } },
        ],
        edges: [],
      } as SubGraphDefinition)
      for (let lvl = 7; lvl >= 1; lvl--) {
        lib.set(`sg_level_${lvl}`, {
          id: `sg_level_${lvl}`,
          name: `Nested SubGraph Level ${lvl}`,
          inputs: [{ id: "in_flow", name: "flow", type: "float", direction: "input", internalNodeId: `inner_sg_${lvl + 1}` }],
          outputs: [{ id: "out_flow", name: "flow", type: "float", direction: "output", internalNodeId: `inner_sg_${lvl + 1}` }],
          nodes: [
            {
              id: `inner_sg_${lvl + 1}`,
              type: "subgraph",
              position: { x: 100, y: 100 },
              data: { type: "subgraph", subGraphId: `sg_level_${lvl + 1}`, subGraphName: `SubGraph Level ${lvl + 1}`, uniformValues: { [`depth${lvl + 1}Weight`]: (lvl + 1) * 1.1 } },
            },
            { id: `u_tier_${lvl}`, type: "uniform", position: { x: 0, y: 50 }, data: { type: "uniform", uniformId: `u_tier_${lvl}_param`, name: `tier${lvl}Factor`, uniformType: "float", defaultValue: lvl * 0.5 } },
          ],
          edges: [],
        } as SubGraphDefinition)
      }

      const flat = flattenGraph(
        [{ id: "root_subgraph_node", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: "sg_level_1", subGraphName: "SubGraph Level 1", uniformValues: { tier1Factor: 1.25 } } }] as Node<GraphNodeData>[],
        [],
        lib
      )
      expect(flat.error).toBeNull()
      const uniformNodes = flat.nodes.filter((n) => n.data.type === "uniform")
      expect(uniformNodes).toHaveLength(8)

      const uniforms: ParsedUniform[] = uniformNodes.map((n) => ({ name: (n.data as any).name, type: "f32", kind: "scalar" }))
      const glsl = `precision highp float;
${uniforms.map((u) => `uniform float ${u.name};`).join("\n")}
varying vec2 vUv;
void main() {
  float acc = 0.0;
${uniforms.map((u) => `  acc += ${u.name};`).join("\n")}
  gl_FragColor = vec4(vec3(fract(acc)), 1.0);
}`
      const ue5 = transpileToUE5(glsl, uniforms)
      expect(ue5.customExpressionHLSL).toContain("ScalarParameter:")
      expect(ue5.materialFunctionHLSL).toContain("MaterialFunctionOutput")
      expect(ue5.parameters).toHaveLength(8)
      expect(exportGltf2Material("Deep8TierMaterial", false).gltfJson.materials[0].name).toBe("Deep8TierMaterial")
      const osl = transpileToBlenderOSL(glsl, uniforms)
      expect(osl).toContain("shader ShaderStudioMaterial")
      expect(osl).toContain("output closure color BSDF = 0")
      const r3f = generateR3FExport("Deep8TierMaterial", { shaderSource: glsl, uniforms })
      for (const s of ["@react-three/drei", "shaderMaterial", "export const StorybookPreview"]) expect(r3f).toContain(s)
    })

    it("reports self-cycles, mutual recursion and >8-level depth breaches", () => {
      const lib = new Map<string, SubGraphDefinition>()
      const sub = (id: string, child?: string) =>
        ({
          id,
          name: id,
          inputs: [],
          outputs: [],
          nodes: child
            ? [{ id: `n_${child}`, type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: child } }]
            : [{ id: "leaf", type: "time", position: { x: 0, y: 0 }, data: { type: "time" } }],
          edges: [],
        }) as SubGraphDefinition
      const rootOf = (id: string) => [{ id: "root", type: "subgraph", position: { x: 0, y: 0 }, data: { type: "subgraph", subGraphId: id } }] as Node<GraphNodeData>[]

      lib.set("sg_self", sub("sg_self", "sg_self"))
      const self = flattenGraph(rootOf("sg_self"), [], lib)
      expect(self.error).toMatch(/Cycle detected/i)
      expect(self.nodes).toHaveLength(0)

      lib.set("sg_A", sub("sg_A", "sg_B"))
      lib.set("sg_B", sub("sg_B", "sg_C"))
      lib.set("sg_C", sub("sg_C", "sg_A"))
      const mutual = flattenGraph(rootOf("sg_A"), [], lib)
      expect(mutual.error).toMatch(/Cycle detected/i)
      expect(mutual.error).toContain("sg_A -> sg_B -> sg_C -> sg_A")

      for (let i = 1; i <= 10; i++) lib.set(`sg_depth_${i}`, sub(`sg_depth_${i}`, i < 10 ? `sg_depth_${i + 1}` : undefined))
      const deep = flattenGraph(rootOf("sg_depth_1"), [], lib)
      expect(deep.error).toMatch(/exceeds maximum allowed limit of 8 levels/i)
      expect(deep.nodes).toHaveLength(0)
    })

    it("inlines a validated math expression into a custom node and UE5 export", () => {
      const expr = "clamp(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 - floor(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453), 0.0, 1.0)"
      const v = validateMathExpression(expr, ["uv"])
      expect(v.isValid).toBe(true)
      expect(v.referencedInputs).toContain("uv")
      const glslSnippet = compileMathExpressionToGlsl(expr, "hashNoise", "float")
      expect(glslSnippet).toContain("float hashNoise = clamp(")
      expect(compileMathExpressionToWgsl(expr, "hashNoise", "float")).toContain("let hashNoise: f32 = clamp(")

      const manifest: CustomNodeManifest = {
        type: "procedural_hash_noise",
        title: "Procedural Hash Noise Generator",
        category: "generator",
        inputs: [{ name: "uv", type: "vec2" }],
        outputs: [{ name: "noiseVal", type: "float" }],
        parameters: [
          { name: "seed", type: "float", default: 1.0, min: 0.1, max: 100.0 },
          { name: "tint", type: "vec3", default: [0.9, 0.4, 0.2] },
        ],
        glsl: `float procedural_hash_noise(vec2 uv, float seed) {\n  ${glslSnippet}\n  return hashNoise * seed;\n}`,
      }
      const registry = new CustomNodeRegistry()
      expect(registry.register(manifest)).toBe(true)
      expect(registry.has("procedural_hash_noise")).toBe(true)

      const ue5 = transpileToUE5(
        `precision highp float;\nuniform float u_seed;\nuniform vec3 u_tint;\nvarying vec2 vUv;\n${manifest.glsl}\nvoid main() {\n  float n = procedural_hash_noise(vUv, u_seed);\n  gl_FragColor = vec4(u_tint * n, 1.0);\n}`,
        [
          { name: "u_seed", type: "f32", kind: "scalar" },
          { name: "u_tint", type: "vec3f", kind: "color" },
        ]
      )
      expect(ue5.customExpressionHLSL).toContain("procedural_hash_noise")
      expect(ue5.customExpressionHLSL).toContain("ScalarParameter: u_seed")
      expect(ue5.customExpressionHLSL).toContain("VectorParameter: u_tint")

      const orm = packOrmTexture(new Uint8Array([255, 255, 255, 255]), new Uint8Array([128, 128, 128, 128]), new Uint8Array([0, 0, 0, 0]), 2, 2)
      expect(orm).toHaveLength(16)
      expect([...orm.subarray(0, 4)]).toEqual([255, 128, 0, 255])
    })

    it("strips 40 comment and 10 frame nodes without altering the render queue", () => {
      const render: Node<GraphNodeData>[] = [
        { id: "mesh_1", type: "mesh", position: { x: 0, y: 0 }, data: { type: "mesh", geometry: "torus_knot" } },
        { id: "mat_1", type: "material", position: { x: 200, y: 0 }, data: { type: "material", shaderPath: "hero.wgsl" } },
        { id: "out_1", type: "output", position: { x: 400, y: 0 }, data: { type: "output" } },
      ]
      const annotations: Node<GraphNodeData>[] = []
      for (let i = 0; i < 40; i++) annotations.push({ id: `comment_${i}`, type: "comment", position: { x: i * 20, y: -100 }, data: { type: "comment", text: `Note #${i}` } })
      for (let j = 0; j < 10; j++) annotations.push({ id: `frame_${j}`, type: "frame", position: { x: j * 100, y: -200 }, width: 300, height: 400, data: { type: "frame", label: `Group ${j}` } })
      const res = compileGraph(
        [...render, ...annotations],
        [
          { id: "e1", source: "mesh_1", target: "mat_1", targetHandle: "mesh" },
          { id: "e2", source: "mat_1", target: "out_1" },
        ]
      )
      expect(res.error).toBeNull()
      expect(res.queue.map((s) => s.type)).toEqual(["mesh", "material"])
    })
  })

  describe("project persistence (tauri fallback + store)", () => {
    it("saves a multi-tier project natively, reloads it losslessly and ingests it into the store", async () => {
      const project = {
        name: "HyperWorkstationProject",
        version: "2.0.0",
        backend: "webgpu" as const,
        graphNodes: [
          { id: "sg_fresnel_node", type: "subgraph", position: { x: 50, y: 50 }, data: { type: "subgraph", subGraphId: "builtin-fresnel-rim", uniformValues: { u_rimPower: 4.5, u_rimColor: [0.1, 0.7, 1.0] } } },
          { id: "math_expr_1", type: "math_expression", position: { x: 300, y: 50 }, data: { type: "math_expression", expression: "sin(uv.x * 12.0) * cos(uv.y * 12.0)", outputType: "float" } },
          { id: "comment_note", type: "comment", position: { x: 50, y: 0 }, data: { type: "comment", text: "Studio Grade Production PBR Graph" } },
        ],
        graphEdges: [{ id: "e1", source: "sg_fresnel_node", target: "math_expr_1" }],
        uniformValues: { u_time: { type: "float" as const, value: 42.5 }, u_tint: { type: "color" as const, value: [1.0, 0.5, 0.2] } },
        graphUniforms: [],
        shaderSources: { wgsl: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }", compute: "@compute @workgroup_size(64) fn cs() {}" },
        audioSettings: { sourceType: "builtin" as const, volume: 0.9, gain: 1.5, smoothing: 0.85 },
        audioBindings: { u_bassKick: { track: "low" as const, multiplier: 2.0 } },
        variations: [{ id: "var_1", name: "Sunset Gold", uniformValues: { u_time: { type: "float" as const, value: 18.0 } }, createdAt: 123456 }],
        environmentSettings: { preset: "sunset_warm" as any, exposure: 1.25, rotation: 45.0, backgroundBlur: 0.1, showSkybox: true },
        memoryBudget: { textureBudgetMB: 1024, geometryBudgetMB: 512, totalVramBudgetMB: 2048, warnThresholdRatio: 0.85 },
      }
      const path = "C:/Users/binit/Documents/ShaderStudio/studio_hyper.shaderstudio"
      expect(await saveProjectNative(path, JSON.stringify(project))).toBe(path)
      const [loadedPath, json] = await loadProjectNative(path)
      expect(loadedPath).toBe(path)
      const rehydrated = JSON.parse(json)
      expect(rehydrated).toEqual(project)

      useProjectStore.getState().loadProjectData(rehydrated)
      const s = useProjectStore.getState()
      expect(s.currentProjectName).toBe("HyperWorkstationProject")
      expect(s.activeBackend).toBe("webgpu")
      expect(s.memoryBudget.totalVramBudgetMB).toBe(2048)
      expect(s.variations).toHaveLength(1)
      expect(s.variations[0].name).toBe("Sunset Gold")
    })

    it("loadProjectData tolerates sparse and corrupted payloads and applies defaults", () => {
      const store = useProjectStore.getState()
      expect(() => store.loadProjectData({ name: "SparseProject", backend: "webgl2", shaderSources: { glsl: "void main(){}" } } as any)).not.toThrow()
      expect(useProjectStore.getState().currentProjectName).toBe("SparseProject")
      expect(useProjectStore.getState().memoryBudget.textureBudgetMB).toBe(512)

      expect(() =>
        store.loadProjectData({ name: "MalformedProject", backend: "threejs", graphNodes: null, graphEdges: null, environmentSettings: null, memoryBudget: null, shaderSources: {} } as any)
      ).not.toThrow()
      expect(useProjectStore.getState().currentProjectName).toBe("MalformedProject")
      expect(useProjectStore.getState().environmentSettings.preset).toBe("studio_warm")
    })

    it("tolerates 20 interleaved bridge start/stop calls and ends clean", async () => {
      await expect(
        Promise.all(Array.from({ length: 20 }, async (_, i) => (i % 2 === 0 ? await startMcpBridge(5000 + i) : (stopMcpBridge(), "stopped"))))
      ).resolves.toBeDefined()
      stopMcpBridge()
      expect(await getMcpBridgeStatus()).toBe(false)
    })
  })
})
