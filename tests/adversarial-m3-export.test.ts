import { describe, it, expect } from "vitest"
import {
  transpileToUE5,
  transpileToUnrealHLSL,
  transpileToBlenderOSL,
  exportGltf2Material,
  createGltfBundle,
  packOrmTexture,
  generateNpmPackage,
  createNpmPackageZip,
  importShadertoy,
  createProjectFromShadertoy,
  generateR3FExport,
} from "@/core/engineTranspiler"
import type { ParsedUniform } from "@/stores/projectStore"

describe("Adversarial Verification Suite: Milestone 3 (R3: Export & Ecosystem Expansion)", () => {
  // ==========================================================================
  // Section 1: Baseline Compliance Tests
  // ==========================================================================
  describe("1. Baseline Feature Compliance", () => {
    it("R3a: UE5 maps basic uniforms and generates annotations", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "float", kind: "scalar" },
        { name: "u_tint", type: "vec3", kind: "color" },
        { name: "u_albedoMap", type: "sampler2D", kind: "texture" },
        { name: "u_emissive", type: "vec4", kind: "vector" },
      ]
      const result = transpileToUE5("float4 color = float4(1.0);", uniforms)

      expect(result.parameters).toHaveLength(4)
      expect(result.parameters.find((p) => p.name === "u_roughness")?.ue5Type).toBe("ScalarParameter")
      expect(result.parameters.find((p) => p.name === "u_tint")?.ue5Type).toBe("VectorParameter")
      expect(result.parameters.find((p) => p.name === "u_albedoMap")?.ue5Type).toBe("Texture2D")
      expect(result.parameters.find((p) => p.name === "u_emissive")?.ue5Type).toBe("VectorParameter")
      expect(result.customExpressionHLSL).toContain("GetWorldPosition(Parameters)")
      expect(result.customExpressionHLSL).toContain("GetCameraVector(Parameters)")
      expect(result.materialFunctionHLSL).toContain("struct MaterialFunctionOutput")
    })

    it("R3b: glTF material toggles KHR_materials_unlit vs KHR_materials_pbrSpecularGlossiness", () => {
      const unlitRes = exportGltf2Material("UnlitMat", true)
      expect(unlitRes.extensionsUsed).toContain("KHR_materials_unlit")
      expect(unlitRes.extensionsUsed).not.toContain("KHR_materials_pbrSpecularGlossiness")
      expect(unlitRes.gltfJson.materials[0].extensions.KHR_materials_unlit).toBeDefined()

      const pbrRes = exportGltf2Material("PbrMat", false)
      expect(pbrRes.extensionsUsed).toContain("KHR_materials_pbrSpecularGlossiness")
      expect(pbrRes.extensionsUsed).not.toContain("KHR_materials_unlit")
      expect(pbrRes.gltfJson.materials[0].extensions.KHR_materials_pbrSpecularGlossiness).toBeDefined()
    })

    it("R3b: packOrmTexture correctly interleaves R=AO, G=Roughness, B=Metallic, A=255", () => {
      const width = 3
      const height = 2
      const totalBytes = width * height * 4
      const ao = new Uint8ClampedArray(totalBytes).fill(55)
      const roughness = new Uint8ClampedArray(totalBytes).fill(110)
      const metallic = new Uint8ClampedArray(totalBytes).fill(220)

      const orm = packOrmTexture(ao, roughness, metallic, width, height)
      expect(orm).toHaveLength(totalBytes)
      for (let i = 0; i < width * height; i++) {
        expect(orm[i * 4]).toBe(55)
        expect(orm[i * 4 + 1]).toBe(110)
        expect(orm[i * 4 + 2]).toBe(220)
        expect(orm[i * 4 + 3]).toBe(255)
      }
    })

    it("R3b: packOrmTexture handles non-square buffers and truncated buffers with defaults", () => {
      const width = 16
      const height = 9
      const totalBytes = width * height * 4
      const ao = new Uint8ClampedArray(totalBytes).fill(40)
      const roughness = new Uint8ClampedArray(0) // empty
      const metallic = new Uint8ClampedArray(0) // empty

      const orm = packOrmTexture(ao, roughness, metallic, width, height)
      expect(orm).toHaveLength(totalBytes)
      expect(orm[0]).toBe(40) // ao preserved
      expect(orm[1]).toBe(128) // roughness fallback default
      expect(orm[2]).toBe(0) // metallic fallback default
      expect(orm[3]).toBe(255) // alpha full
    })

    it("R3c: Blender OSL includes stdosl.h and closure BSDF output", () => {
      const osl = transpileToBlenderOSL("BSDF = diffuse(N);", [])
      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("BSDF = diffuse(N);")
    })

    it("R3d: npm package generates scaffolding and valid PKZIP binary", () => {
      const pkg = generateNpmPackage("@shaderstudio/glass", "void main() {}")
      expect(pkg.packageJson.name).toBe("@shaderstudio/glass")
      expect(pkg.packageJson.peerDependencies.three).toBeDefined()
      expect(pkg.tsconfigJson.compilerOptions.declaration).toBe(true)

      const zip = createNpmPackageZip("@shaderstudio/glass", "void main() {}")
      expect(zip[0]).toBe(0x50)
      expect(zip[1]).toBe(0x4b)
      expect(zip[2]).toBe(0x03)
      expect(zip[3]).toBe(0x04)
    })

    it("R3e: Shadertoy importer converts inputs and creates project data", () => {
      const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = vec4(fragCoord / iResolution.xy, sin(iTime), 1.0);
      }`
      const res = importShadertoy(code)
      expect(res.convertedSource).toContain("u_resolution")
      expect(res.convertedSource).toContain("u_time")
      expect(res.channels).toHaveLength(0)

      const project = createProjectFromShadertoy(code, "WaveDemo")
      expect(project.name).toBe("WaveDemo")
      expect(project.graphNodes.length).toBeGreaterThanOrEqual(3)
    })

    it("R3f: R3F export generates shaderMaterial, extend, and Storybook preview", () => {
      const r3f = generateR3FExport("Hologram")
      expect(r3f).toContain("import { shaderMaterial } from '@react-three/drei';")
      expect(r3f).toContain("import { extend } from '@react-three/fiber';")
      expect(r3f).toContain("export const HologramMaterial = shaderMaterial(")
      expect(r3f).toContain("extend({ HologramMaterial });")
      expect(r3f).toContain("export const StorybookPreview = () => (")
    })
  })

  // ==========================================================================
  // Section 2: Adversarial Defect Remediation & Verification Suite
  // ==========================================================================
  describe("2. Adversarial Remediation & Robustness Verification", () => {
    // ------------------------------------------------------------------------
    // Remediation 1: Genuine UE5 Transpilation & Substring Preservation
    // ------------------------------------------------------------------------
    it("REMEDIATION-1: transpileToUE5 preserves shader body on substrings matching 'main' (e.g. domain, remainder, maintain)", () => {
      // Common procedural shader variable: domain repetition / domain warping
      const code = "float domainWarp = sin(u_time * 2.0); float x = domainWarp + 1.0;"
      const result = transpileToUE5(code, [])

      // Verified: shader code is preserved, not replaced with placeholder
      expect(result.customExpressionHLSL).toContain("domainWarp")
      expect(result.customExpressionHLSL).not.toContain("// Inlined shader logic")
    })

    // ------------------------------------------------------------------------
    // Remediation 2: Accurate atan -> atan2 translation
    // ------------------------------------------------------------------------
    it("REMEDIATION-2: transpileToUE5 preserves single-arg atan(x) and converts only 2-arg atan(y, x) to atan2(y, x)", () => {
      const code = `
        float a1 = atan(uv.x);
        float a2 = atan(uv.y, uv.x);
        float a3 = atan2(uv.y, uv.x);
      `
      const result = transpileToUE5(code, [])

      expect(result.customExpressionHLSL).toContain("atan(uv.x)")
      expect(result.customExpressionHLSL).toContain("atan2(uv.y, uv.x)")
      expect(result.customExpressionHLSL).not.toContain("atan2(uv.x)")
      expect(result.customExpressionHLSL).not.toContain("atan22")
    })

    // ------------------------------------------------------------------------
    // Remediation 3: UE5 parameter reflection for vec2, cubemap, and matrices
    // ------------------------------------------------------------------------
    it("REMEDIATION-3: transpileToUE5 maps vec2, samplerCube, and matrices to appropriate UE5 parameter types", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_scale", type: "vec2" },
        { name: "u_cubemap", type: "samplerCube" },
        { name: "u_matrix", type: "mat4" },
      ]
      const result = transpileToUE5("float x = 1.0;", uniforms)

      const scaleParam = result.parameters.find((p) => p.name === "u_scale")
      const cubeParam = result.parameters.find((p) => p.name === "u_cubemap")
      const matParam = result.parameters.find((p) => p.name === "u_matrix")

      expect(scaleParam?.ue5Type).toBe("VectorParameter")
      expect(cubeParam?.ue5Type).toBe("TextureCube")
      expect(matParam?.ue5Type).toBe("VectorParameter")
    })

    // ------------------------------------------------------------------------
    // Remediation 4: Blender Cycles OSL preserves user GLSL calculations
    // ------------------------------------------------------------------------
    it("REMEDIATION-4: transpileToBlenderOSL preserves arbitrary GLSL shader calculations and closure assignments", () => {
      const glslSource = `
        vec2 p = uv * 2.0 - 1.0;
        float r = length(p);
        vec3 col = vec3(sin(r + u_time));
      `
      const osl = transpileToBlenderOSL(glslSource, [])

      const containsUserCalc = osl.includes("length(p)") && (osl.includes("time") || osl.includes("u_time"))
      expect(containsUserCalc).toBe(true)
      expect(osl).toContain("BSDF =")
    })

    // ------------------------------------------------------------------------
    // Remediation 5: glTF Material Exporter binds ORM baked maps
    // ------------------------------------------------------------------------
    it("REMEDIATION-5: exportGltf2Material assigns metallicRoughnessTexture when ORM map is provided", () => {
      const res = exportGltf2Material("IronGate", false, {
        bakedMaps: {
          albedo: { dataUrl: "data:image/png;base64,AAA" },
          orm: { dataUrl: "data:image/png;base64,BBB" },
          metallicRoughness: { dataUrl: "data:image/png;base64,CCC" },
        },
      })

      const mat = res.gltfJson.materials[0]
      expect(mat.pbrMetallicRoughness.baseColorTexture).toBeDefined()
      expect(mat.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined()
    })

    // ------------------------------------------------------------------------
    // Remediation 6: Shadertoy importer puts #version 300 es on line 1
    // ------------------------------------------------------------------------
    it("REMEDIATION-6: importShadertoy places #version 300 es strictly on line 1 per GLSL ES 3.0 specification", () => {
      const res = importShadertoy("void mainImage(out vec4 c, in vec2 f) { c = vec4(1.0); }")
      const lines = res.convertedSource.split("\n")

      expect(lines[0].trim()).toBe("#version 300 es")
    })

    // ------------------------------------------------------------------------
    // Remediation 7: Shadertoy importer declares u_delta and u_frame uniforms
    // ------------------------------------------------------------------------
    it("REMEDIATION-7: importShadertoy declares uniform float u_delta and uniform int u_frame", () => {
      const code = `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          float dt = iTimeDelta;
          int f = iFrame;
          fragColor = vec4(dt, float(f), 0.0, 1.0);
        }
      `
      const res = importShadertoy(code)

      expect(res.convertedSource).toContain("u_delta")
      expect(res.convertedSource).toContain("u_frame")
      expect(res.convertedSource).toContain("uniform float u_delta;")
      expect(res.convertedSource).toContain("uniform int u_frame;")
    })
  })
})
