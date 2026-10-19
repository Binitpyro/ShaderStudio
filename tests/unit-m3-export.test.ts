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

describe("Milestone 3 Unit Tests: Export & Ecosystem Expansion (R3a–R3f)", () => {
  // ==========================================================================
  // R3a: Unreal Engine 5 HLSL Export
  // ==========================================================================
  describe("R3a: Unreal Engine 5 HLSL Transpiler", () => {
    it("maps uniforms to UE5 parameter types (scalar, vector, texture)", () => {
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

      // Custom expression annotations
      expect(result.customExpressionHLSL).toContain("// UE5 ScalarParameter: u_roughness")
      expect(result.customExpressionHLSL).toContain("// UE5 VectorParameter: u_tint")
      expect(result.customExpressionHLSL).toContain("// UE5 Texture2D: u_albedoMap")
    })

    it("generates WorldPosition, CameraVector, and returns float4 in Custom Expression block", () => {
      const result = transpileToUE5("vec3 normal = vec3(0.0, 1.0, 0.0);", [])
      expect(result.customExpressionHLSL).toContain("float3 WorldPosition = GetWorldPosition(Parameters);")
      expect(result.customExpressionHLSL).toContain("float3 ViewDir = GetCameraVector(Parameters);")
      expect(result.customExpressionHLSL).toContain("return float4(1.0, 1.0, 1.0, 1.0);")
    })

    it("transpiles GLSL built-ins to HLSL equivalents (frac, lerp, fmod, atan2)", () => {
      const glslSource = `
        vec2 p = fract(gl_FragCoord.xy / u_resolution.xy);
        float a = mix(0.0, 1.0, u_time);
        float m = mod(p.x, 2.0);
        float angle = atan(p.y, p.x);
      `
      const result = transpileToUE5(glslSource, [])
      expect(result.customExpressionHLSL).toContain("frac(")
      expect(result.customExpressionHLSL).toContain("lerp(")
      expect(result.customExpressionHLSL).toContain("fmod(")
      expect(result.customExpressionHLSL).toContain("atan2(")
      expect(result.customExpressionHLSL).toContain("float2 p =")
    })

    it("generates complete Material Function HLSL struct and function", () => {
      const result = transpileToUE5("void main() {}", [
        { name: "u_specular", type: "float", kind: "scalar" },
      ])
      expect(result.materialFunctionHLSL).toContain("struct MaterialFunctionOutput")
      expect(result.materialFunctionHLSL).toContain("float3 BaseColor;")
      expect(result.materialFunctionHLSL).toContain("float Roughness;")
      expect(result.materialFunctionHLSL).toContain("float Metallic;")
      expect(result.materialFunctionHLSL).toContain("float3 Normal;")
    })

    it("transpileToUnrealHLSL formats human-readable documentation with both blocks", () => {
      const formatted = transpileToUnrealHLSL({
        shaderName: "Custom/HeroShield",
        shaderSource: "float pulse = sin(u_time);",
        parsedUniforms: [{ name: "u_glow", type: "float", kind: "scalar" }],
      })
      expect(formatted).toContain("SECTION 1: Custom Expression Node HLSL")
      expect(formatted).toContain("SECTION 2: Material Function (.ush) HLSL")
      expect(formatted).toContain("Custom/HeroShield")
    })
  })

  // ==========================================================================
  // R3b: glTF 2.0 Material Export
  // ==========================================================================
  describe("R3b: glTF 2.0 Material Exporter", () => {
    it("exports valid glTF 2.0 asset metadata and PBR specular glossiness by default", () => {
      const res = exportGltf2Material("GoldPBR", false)
      expect(res.gltfJson.asset.version).toBe("2.0")
      expect(res.gltfJson.asset.generator).toBe("ShaderStudio-glTF-Exporter")
      expect(res.extensionsUsed).toContain("KHR_materials_pbrSpecularGlossiness")
      expect(res.gltfJson.materials[0].name).toBe("GoldPBR")
      expect(res.gltfJson.materials[0].extensions.KHR_materials_pbrSpecularGlossiness).toBeDefined()
    })

    it("exports KHR_materials_unlit when unlit option is true", () => {
      const res = exportGltf2Material("NeonSign", true)
      expect(res.extensionsUsed).toContain("KHR_materials_unlit")
      expect(res.gltfJson.materials[0].extensions.KHR_materials_unlit).toEqual({})
      expect(res.extensionsUsed).not.toContain("KHR_materials_pbrSpecularGlossiness")
    })

    it("embeds baked texture maps into glTF images and material slots", () => {
      const res = exportGltf2Material("TerrainMat", false, {
        bakedMaps: {
          albedo: { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
          normal: { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgNormal==" },
          ao: { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAO==" },
        },
      })
      expect(res.gltfJson.images).toHaveLength(3)
      expect(res.gltfJson.materials[0].pbrMetallicRoughness.baseColorTexture).toBeDefined()
      expect(res.gltfJson.materials[0].normalTexture).toBeDefined()
      expect(res.gltfJson.materials[0].occlusionTexture).toBeDefined()
    })

    it("packs separate AO, Roughness, and Metallic buffers into an ORM texture buffer", () => {
      const width = 2
      const height = 2
      const totalBytes = width * height * 4
      const ao = new Uint8ClampedArray(totalBytes)
      const roughness = new Uint8ClampedArray(totalBytes)
      const metallic = new Uint8ClampedArray(totalBytes)

      // Set distinct values for pixel 0
      ao[0] = 50 // R (AO)
      roughness[0] = 120 // G (Roughness)
      metallic[0] = 200 // B (Metallic)

      const orm = packOrmTexture(ao, roughness, metallic, width, height)

      expect(orm).toHaveLength(totalBytes)
      expect(orm[0]).toBe(50) // R = AO
      expect(orm[1]).toBe(120) // G = Roughness
      expect(orm[2]).toBe(200) // B = Metallic
      expect(orm[3]).toBe(255) // Alpha = 255
    })

    it("createGltfBundle returns valid stringified JSON", () => {
      const bundle = createGltfBundle("TestMat", false)
      const parsed = JSON.parse(bundle)
      expect(parsed.asset.version).toBe("2.0")
      expect(parsed.materials[0].name).toBe("TestMat")
    })
  })

  // ==========================================================================
  // R3c: Blender Cycles Open Shading Language (OSL)
  // ==========================================================================
  describe("R3c: Blender Cycles OSL Export", () => {
    it("generates #include <stdosl.h>, shader ShaderStudioMaterial, and closure BSDF", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "float", defaultValue: 0.25 },
        { name: "u_albedo", type: "color", defaultValue: [0.8, 0.2, 0.2] },
        { name: "u_offset", type: "vec2", defaultValue: [0, 0] },
      ]

      const osl = transpileToBlenderOSL("BSDF = diffuse(N);", uniforms)

      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("float u_roughness = 0.25")
      expect(osl).toContain("color u_albedo = color(1.0, 1.0, 1.0)")
      expect(osl).toContain("point u_offset = point(0.0, 0.0, 0.0)")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("BSDF = diffuse(N);")
    })

    it("supports EngineExportOptions parameter signature", () => {
      const osl = transpileToBlenderOSL({
        shaderSource: "void main() {}",
        parsedUniforms: [{ name: "u_speed", type: "f32", kind: "scalar" }],
      })
      expect(osl).toContain("shader ShaderStudioMaterial")
      expect(osl).toContain("float u_speed = 0.0")
    })
  })

  // ==========================================================================
  // R3d: npm-Publishable Material Packages
  // ==========================================================================
  describe("R3d: npm-Publishable Material Packages", () => {
    it("generates package.json with peerDependencies and TypeScript loader module", () => {
      const pkg = generateNpmPackage("@shaderstudio/hologram", "precision highp float; void main() {}")

      expect(pkg.packageJson.name).toBe("@shaderstudio/hologram")
      expect(pkg.packageJson.version).toBe("1.0.0")
      expect(pkg.packageJson.main).toBe("dist/index.js")
      expect(pkg.packageJson.module).toBe("dist/index.mjs")
      expect(pkg.packageJson.types).toBe("dist/index.d.ts")
      expect(pkg.packageJson.peerDependencies.three).toBeDefined()
      expect(pkg.indexTs).toContain("export const shaderSource =")
      expect(pkg.indexTs).toContain("export function createMaterial(renderer: any)")
      expect(pkg.readmeMd).toContain("# @shaderstudio/hologram")
      expect(pkg.tsconfigJson.compilerOptions.declaration).toBe(true)
    })

    it("creates a valid zip archive containing all package files with PKZIP header", () => {
      const zipBytes = createNpmPackageZip("@shaderstudio/fire", "void main() {}")
      expect(zipBytes).toBeInstanceOf(Uint8Array)
      expect(zipBytes.length).toBeGreaterThan(100)

      // Verify PKZIP local file header magic number: 'PK\x03\x04' = 0x50, 0x4B, 0x03, 0x04
      expect(zipBytes[0]).toBe(0x50)
      expect(zipBytes[1]).toBe(0x4b)
      expect(zipBytes[2]).toBe(0x03)
      expect(zipBytes[3]).toBe(0x04)
    })
  })

  // ==========================================================================
  // R3e: Shadertoy Importer
  // ==========================================================================
  describe("R3e: Shadertoy Import System", () => {
    it("maps standard Shadertoy uniforms (iTime, iResolution, iMouse, iChannel0..3)", () => {
      const shadertoyCode = `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord / iResolution.xy;
          float t = iTime;
          vec4 m = iMouse;
          vec4 c0 = texture(iChannel0, uv);
          vec4 c1 = texture(iChannel1, uv);
          fragColor = c0 + c1 * sin(t) + m.x;
        }
      `
      const imported = importShadertoy(shadertoyCode)

      expect(imported.convertedSource).toContain("u_resolution")
      expect(imported.convertedSource).toContain("u_time")
      expect(imported.convertedSource).toContain("u_mouse")
      expect(imported.convertedSource).toContain("u_channel0")
      expect(imported.convertedSource).toContain("u_channel1")
      expect(imported.channels).toEqual([0, 1])
      expect(imported.convertedSource).toContain("#version 300 es")
      expect(imported.convertedSource).toContain("void main() {")
      expect(imported.convertedSource).toContain("mainImage(fragColor, gl_FragCoord.xy);")
    })

    it("gracefully handles code with no channels (boundary test)", () => {
      const pureProcedural = `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          fragColor = vec4(1.0, 0.5, 0.2, 1.0);
        }
      `
      const imported = importShadertoy(pureProcedural)
      expect(imported.channels).toHaveLength(0)
      expect(imported.convertedSource).toContain("void main()")
    })

    it("createProjectFromShadertoy generates a valid ProjectData graph structure", () => {
      const project = createProjectFromShadertoy("void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }", "WaterRipples")
      expect(project.name).toBe("WaterRipples")
      expect(project.backend).toBe("webgl2")
      expect(project.graphNodes).toHaveLength(3) // geometry, material, output
      expect(project.graphEdges).toHaveLength(2)
      expect(project.uniformValues.u_time).toBeDefined()
      expect(project.uniformValues.u_resolution).toBeDefined()
    })
  })

  // ==========================================================================
  // R3f: React Three Fiber (R3F) Export Upgrades
  // ==========================================================================
  describe("R3f: React Three Fiber Export Upgrades", () => {
    it("generates export with @react-three/drei shaderMaterial, extend, and Storybook preview", () => {
      const r3fCode = generateR3FExport("PlasmaOrb")

      expect(r3fCode).toContain("import * as THREE from 'three';")
      expect(r3fCode).toContain("import { extend } from '@react-three/fiber';")
      expect(r3fCode).toContain("import { shaderMaterial } from '@react-three/drei';")
      expect(r3fCode).toContain("export const PlasmaOrbMaterial = shaderMaterial(")
      expect(r3fCode).toContain("extend({ PlasmaOrbMaterial });")
      expect(r3fCode).toContain("export const StorybookPreview = () => (")
      expect(r3fCode).toContain("<PlasmaOrbMaterial />")
    })

    it("binds custom uniforms into shaderMaterial properties", () => {
      const r3fCode = generateR3FExport("HeroGlow", {
        uniforms: [
          { name: "u_intensity", type: "f32", kind: "scalar" },
          { name: "u_tint", type: "vec3f", kind: "color" },
          { name: "u_scale", type: "vec2f", kind: "vector" },
        ],
        uniformValues: {
          u_intensity: { type: "float", value: 1.5 },
          u_tint: { type: "color", value: [1, 0.5, 0.2] },
          u_scale: { type: "vec2", value: [2, 2] },
        },
      })

      expect(r3fCode).toContain("u_intensity: 1.5")
      expect(r3fCode).toContain("u_tint: new THREE.Color(1, 0.5, 0.2)")
      expect(r3fCode).toContain("u_scale: new THREE.Vector2(2, 2)")
    })

    it("converts GLSL ES 3.0 out vec4 fragColor to gl_FragColor for three.js ShaderMaterial compatibility", () => {
      const source = `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() {
          fragColor = vec4(1.0);
        }
      `
      const r3fCode = generateR3FExport("Shader300", { shaderSource: source })
      expect(r3fCode).not.toContain("out vec4 fragColor;")
      expect(r3fCode).toContain("gl_FragColor = vec4(1.0);")
    })
  })
})
