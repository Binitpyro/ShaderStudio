import { describe, it, expect } from "vitest"
import {
  transpileToUE5,
  transpileToUnrealHLSL,
  transpileToBlenderOSL,
  exportGltf2Material,
  packOrmTexture,
} from "@/core/engineTranspiler"
import {
  importShadertoy,
  createProjectFromShadertoy,
} from "@/core/shadertoyImporter"
import type { ParsedUniform } from "@/stores/projectStore"

describe("Gate 3 Round 2 Adversarial Stress Test: All 7 Defect Areas", () => {
  // ==========================================================================
  // Area 1: UE5 main extraction, inlining, and substring collisions
  // ==========================================================================
  describe("Area 1: UE5 main function extraction and inlining", () => {
    it("handles multiple tricky substrings containing 'main' without code stripping", () => {
      const hostileShader = `
        float domainWarp = sin(u_time * 2.0);
        float maintainScale = 1.5;
        float remainderTerm = fmod(domainWarp, maintainScale);
        float mainstreamVal = remainderTerm * 0.5;
        float remainingEnergy = 1.0 - mainstreamVal;
        return float4(domainWarp, maintainScale, remainderTerm, remainingEnergy);
      `
      const result = transpileToUE5(hostileShader, [])

      expect(result.customExpressionHLSL).not.toContain("// Inlined shader logic")
      expect(result.customExpressionHLSL).toContain("domainWarp")
      expect(result.customExpressionHLSL).toContain("maintainScale")
      expect(result.customExpressionHLSL).toContain("remainderTerm")
      expect(result.customExpressionHLSL).toContain("mainstreamVal")
      expect(result.customExpressionHLSL).toContain("remainingEnergy")
    })

    it("correctly extracts deeply nested void main() with braces and control flow", () => {
      const nestedMainShader = `
        precision highp float;
        out vec4 fragColor;
        void main() {
          vec4 col = vec4(0.0);
          for (int i = 0; i < 4; i++) {
            if (i > 1) {
              for (int j = 0; j < 2; j++) {
                col += vec4(float(i) * 0.1, float(j) * 0.2, 0.0, 1.0);
              }
            } else {
              col += vec4(0.05);
            }
          }
          fragColor = col;
        }
      `
      const result = transpileToUE5(nestedMainShader, [])

      expect(result.customExpressionHLSL).not.toContain("// Inlined shader logic")
      expect(result.customExpressionHLSL).toContain("for (int i = 0; i < 4; i++)")
      expect(result.customExpressionHLSL).toContain("for (int j = 0; j < 2; j++)")
      expect(result.customExpressionHLSL).toContain("return col;")
    })

    it("handles void main with arbitrary formatting and whitespace", () => {
      const spacedMainShader = `
        void
        main
        (
        )
        {
          float myCustomVar = 42.0;
          gl_FragColor = vec4(myCustomVar);
        }
      `
      const result = transpileToUE5(spacedMainShader, [])

      expect(result.customExpressionHLSL).not.toContain("// Inlined shader logic")
      expect(result.customExpressionHLSL).toContain("myCustomVar")
      expect(result.customExpressionHLSL).toContain("return float4(myCustomVar);")
    })

    it("handles shader without main() function by preserving all statements and appending return", () => {
      const rawShader = `float a = 1.0; float b = 2.0; float c = a + b;`
      const result = transpileToUE5(rawShader, [])

      expect(result.customExpressionHLSL).toContain("float a = 1.0;")
      expect(result.customExpressionHLSL).toContain("float c = a + b;")
      expect(result.customExpressionHLSL).toContain("return float4(1.0, 1.0, 1.0, 1.0);")
    })
  })

  // ==========================================================================
  // Area 2: UE5 atan vs atan2 differentiation
  // ==========================================================================
  describe("Area 2: UE5 atan vs atan2 differentiation", () => {
    it("preserves 1-arg atan with nested calls and inner commas", () => {
      const code = `
        float a1 = atan(uv.x);
        float a2 = atan(sin(cos(uv.x)));
        float a3 = atan(max(uv.x, uv.y));
        float a4 = atan(clamp(uv.x, 0.0, 1.0));
      `
      const result = transpileToUE5(code, [])

      expect(result.customExpressionHLSL).toContain("atan(uv.x)")
      expect(result.customExpressionHLSL).toContain("atan(sin(cos(uv.x)))")
      expect(result.customExpressionHLSL).toContain("atan(max(uv.x, uv.y))")
      expect(result.customExpressionHLSL).toContain("atan(clamp(uv.x, 0.0, 1.0))")
      expect(result.customExpressionHLSL).not.toContain("atan2(uv.x)")
      expect(result.customExpressionHLSL).not.toContain("atan2(max")
      expect(result.customExpressionHLSL).not.toContain("atan2(clamp")
    })

    it("converts 2-arg atan to atan2 even with complex nested expressions", () => {
      const code = `
        float b1 = atan(uv.y, uv.x);
        float b2 = atan(max(uv.x, uv.y), min(uv.x, uv.y));
        float b3 = atan(sin(uv.y), cos(uv.x));
      `
      const result = transpileToUE5(code, [])

      expect(result.customExpressionHLSL).toContain("atan2(uv.y, uv.x)")
      expect(result.customExpressionHLSL).toContain("atan2(max(uv.x, uv.y), min(uv.x, uv.y))")
      expect(result.customExpressionHLSL).toContain("atan2(sin(uv.y), cos(uv.x))")
    })

    it("does not corrupt existing atan2 calls or nested atan inside atan", () => {
      const code = `
        float c1 = atan2(uv.y, uv.x);
        float c2 = atan(atan(uv.y, uv.x));
        float c3 = atan(atan2(uv.y, uv.x));
      `
      const result = transpileToUE5(code, [])

      expect(result.customExpressionHLSL).not.toContain("atan22")
      expect(result.customExpressionHLSL).toContain("atan2(uv.y, uv.x)")
      expect(result.customExpressionHLSL).toContain("atan(atan2(uv.y, uv.x))")
    })
  })

  // ==========================================================================
  // Area 3: UE5 Material Function
  // ==========================================================================
  describe("Area 3: UE5 Material Function", () => {
    it("generates authentic MaterialFunction_ShaderStudio with struct output and arguments", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "float", kind: "scalar" },
        { name: "u_metallic", type: "float", kind: "scalar" },
        { name: "u_baseColor", type: "vec3", kind: "color" },
        { name: "u_albedoMap", type: "sampler2D", kind: "texture" },
        { name: "u_envMap", type: "samplerCube", kind: "texture" },
      ]
      const shader = `
        void main() {
          vec3 sampled = texture(u_albedoMap, uv).rgb * u_baseColor;
          fragColor = vec4(sampled, 1.0);
        }
      `
      const result = transpileToUE5(shader, uniforms)

      // Struct definition
      expect(result.materialFunctionHLSL).toContain("struct MaterialFunctionOutput {")
      expect(result.materialFunctionHLSL).toContain("float3 BaseColor;")
      expect(result.materialFunctionHLSL).toContain("float Roughness;")
      expect(result.materialFunctionHLSL).toContain("float Metallic;")
      expect(result.materialFunctionHLSL).toContain("float3 Normal;")

      // Function definition and arguments
      expect(result.materialFunctionHLSL).toContain("MaterialFunctionOutput MaterialFunction_ShaderStudio(")
      expect(result.materialFunctionHLSL).toContain("float u_roughness")
      expect(result.materialFunctionHLSL).toContain("float u_metallic")
      expect(result.materialFunctionHLSL).toContain("float3 u_baseColor")
      expect(result.materialFunctionHLSL).toContain("Texture2D u_albedoMap")
      expect(result.materialFunctionHLSL).toContain("TextureCube u_envMap")
      expect(result.materialFunctionHLSL).toContain("float3 WorldPosition")
      expect(result.materialFunctionHLSL).toContain("float3 ViewDir")

      // Body and assignments
      expect(result.materialFunctionHLSL).toContain("MaterialFunctionOutput Out;")
      expect(result.materialFunctionHLSL).toContain("Out.Roughness = u_roughness;")
      expect(result.materialFunctionHLSL).toContain("Out.Metallic = u_metallic;")
      expect(result.materialFunctionHLSL).toContain("Out.Normal = float3(0.0, 0.0, 1.0);")
      expect(result.materialFunctionHLSL).toContain("Out.BaseColor = calculatedColor.rgb;")
      expect(result.materialFunctionHLSL).toContain("return Out;")
    })

    it("falls back to default roughness and metallic when uniforms are omitted", () => {
      const result = transpileToUE5("float x = 1.0;", [])

      expect(result.materialFunctionHLSL).toContain("Out.Roughness = 0.5;")
      expect(result.materialFunctionHLSL).toContain("Out.Metallic = 0.0;")
      expect(result.materialFunctionHLSL).toContain("Out.BaseColor = float3(1.0, 1.0, 1.0);")
    })
  })

  // ==========================================================================
  // Area 4: Blender Cycles OSL translation
  // ==========================================================================
  describe("Area 4: Blender Cycles OSL translation", () => {
    it("translates GLSL procedural math and maps vec3/vec4 and gl_FragCoord to OSL", () => {
      const glslCode = `
        void main() {
          vec2 st = gl_FragCoord.xy / u_resolution.xy;
          float t = fract(u_time * 0.5);
          vec3 tint = vec3(st.x, st.y, t);
          fragColor = vec4(tint, 1.0);
        }
      `
      const uniforms: ParsedUniform[] = [
        { name: "u_scale", type: "vec2" },
        { name: "u_gain", type: "float", defaultValue: 2.5 } as any,
      ]
      const osl = transpileToBlenderOSL(glslCode, uniforms)

      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("point u_scale = point(0.0, 0.0, 0.0)")
      expect(osl).toContain("float u_gain = 2.5")
      expect(osl).toContain("output closure color BSDF = 0")

      // Converted types & built-ins
      expect(osl).toContain("point st = point(u, v, 0.0) / point(1.0, 1.0, 0.0);")
      expect(osl).toContain("float t = fmod(time * 0.5);")
      expect(osl).toContain("color tint = color(st.x, st.y, t);")
      expect(osl).toContain("BSDF = finalColor * diffuse(N);")
    })

    it("preserves explicit OSL shaders verbatim when BSDF is already present", () => {
      const rawOsl = `
        color myCol = color(1.0, 0.0, 0.0);
        BSDF = myCol * emission();
      `
      const osl = transpileToBlenderOSL(rawOsl, [])

      expect(osl).toContain("color myCol = color(1.0, 0.0, 0.0);")
      expect(osl).toContain("BSDF = myCol * emission();")
    })
  })

  // ==========================================================================
  // Area 5: glTF ORM interleaving and material binding
  // ==========================================================================
  describe("Area 5: glTF ORM buffer interleaving and texture binding", () => {
    it("handles 1-channel grayscale buffers correctly without stride skipping", () => {
      const w = 2
      const h = 2
      const totalPixels = w * h
      // 1-channel buffers (length = 4)
      const ao1 = new Uint8ClampedArray([50, 60, 70, 80])
      const rough1 = new Uint8ClampedArray([100, 110, 120, 130])
      const metal1 = new Uint8ClampedArray([200, 210, 220, 230])

      const orm = packOrmTexture(ao1, rough1, metal1, w, h)
      expect(orm).toHaveLength(totalPixels * 4)

      for (let i = 0; i < totalPixels; i++) {
        expect(orm[i * 4]).toBe(ao1[i])
        expect(orm[i * 4 + 1]).toBe(rough1[i])
        expect(orm[i * 4 + 2]).toBe(metal1[i])
        expect(orm[i * 4 + 3]).toBe(255)
      }
    })

    it("binds metallicRoughnessTexture when bakedMaps contains 'orm' or 'metallicRoughness'", () => {
      const resOrm = exportGltf2Material("TestOrm", false, {
        bakedMaps: {
          orm: { dataUrl: "data:image/png;base64,ORM_DATA" },
        },
      })
      expect(resOrm.gltfJson.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toEqual({ index: 0 })

      const resMR = exportGltf2Material("TestMR", false, {
        bakedMaps: {
          metallicRoughness: { dataUrl: "data:image/png;base64,MR_DATA" },
        },
      })
      expect(resMR.gltfJson.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toEqual({ index: 0 })
    })
  })

  // ==========================================================================
  // Area 6: Shadertoy importer line 1 compliance and uniforms
  // ==========================================================================
  describe("Area 6: Shadertoy importer line 1 compliance and uniforms", () => {
    it("ensures #version 300 es is strictly the first line without any leading text", () => {
      const res = importShadertoy("void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }")
      const lines = res.convertedSource.split("\n")

      expect(lines[0]).toBe("#version 300 es")
      expect(res.convertedSource.indexOf("#version 300 es")).toBe(0)
    })

    it("declares and exposes u_delta and u_frame in shader and project model", () => {
      const code = `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          fragColor = vec4(iTimeDelta, float(iFrame), 0.0, 1.0);
        }
      `
      const res = importShadertoy(code)
      expect(res.convertedSource).toContain("uniform float u_delta;")
      expect(res.convertedSource).toContain("uniform int u_frame;")
      expect(res.convertedSource).toContain("fragColor = vec4(u_delta, float(u_frame), 0.0, 1.0);")

      const proj = createProjectFromShadertoy(code, "DeltaFrameDemo")
      expect(proj.uniformValues.u_delta).toBeDefined()
      expect(proj.uniformValues.u_delta.value).toBe(0.016)
      expect(proj.uniformValues.u_frame).toBeDefined()
      expect(proj.uniformValues.u_frame.value).toBe(0)
    })
  })

  // ==========================================================================
  // Area 7: Parameter reflection for vec2, cubemap, and matrices
  // ==========================================================================
  describe("Area 7: Parameter reflection for vec2, cubemap, and matrices", () => {
    it("reflects vec2/vec2f, samplerCube, and matrix types accurately for UE5", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_offset", type: "vec2" },
        { name: "u_scale", type: "vec2f" },
        { name: "u_skybox", type: "samplerCube" },
        { name: "u_volume", type: "sampler3D" },
        { name: "u_model", type: "mat4" },
        { name: "u_rotation", type: "mat3" },
        { name: "u_transform", type: "mat2" },
      ]
      const result = transpileToUE5("float x = 1.0;", uniforms)

      expect(result.parameters.find((p) => p.name === "u_offset")?.ue5Type).toBe("VectorParameter")
      expect(result.parameters.find((p) => p.name === "u_scale")?.ue5Type).toBe("VectorParameter")
      expect(result.parameters.find((p) => p.name === "u_skybox")?.ue5Type).toBe("TextureCube")
      expect(result.parameters.find((p) => p.name === "u_volume")?.ue5Type).toBe("Texture2D")
      expect(result.parameters.find((p) => p.name === "u_model")?.ue5Type).toBe("VectorParameter")
      expect(result.parameters.find((p) => p.name === "u_rotation")?.ue5Type).toBe("VectorParameter")
      expect(result.parameters.find((p) => p.name === "u_transform")?.ue5Type).toBe("VectorParameter")
    })
  })
})
