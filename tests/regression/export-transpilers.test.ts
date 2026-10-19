import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as THREE from "three"
import {
  transpileToUnityHLSL,
  transpileToGodotShader,
  transpileToShadertoy,
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
  type EngineExportOptions,
} from "@/core/engineTranspiler"
import { createZipArchive, calculateCrc32 } from "@/utils/zipBuilder"
import { parseWgslUniforms } from "@/parsers/wgslUniforms"
import { parseGlslUniforms } from "@/parsers/glslUniforms"
import { computeUniformBufferLayout } from "@/core/uniformLayout"
import type { ParsedUniform } from "@/stores/projectStore"

import { setupE2ETestEnvironment, teardownE2ETestEnvironment } from "../e2e/mocks"
import { subGraphLibrary, collapseNodesToSubGraph, BUILTIN_FRESNEL_RIM, BUILTIN_NOISE_GEN, BUILTIN_UV_DISTORTION, type SubGraphDefinition } from "@/core/subGraphLibrary"
import { flattenGraph, compileGraph, buildSdfTree, MAX_SUBGRAPH_DEPTH, type GraphNodeData } from "@/core/graphCompiler"
import { customNodeRegistry, validateCustomNodeManifest, type CustomNodeManifest } from "@/core/customNodeSdk"
import { validateMathExpression, compileMathExpressionToGlsl, compileMathExpressionToWgsl } from "@/core/mathExpressionValidator"
import { type Node, type Edge } from "@xyflow/react"
import { webgpuAdapter } from "@/adapters/webgpu"
import { webgl2Adapter } from "@/adapters/webgl2"
import { threejsAdapter } from "@/adapters/threejs"
import { getDefaultProjectPath, saveProjectNative, loadProjectNative, startMcpBridge, getMcpBridgeStatus, getMcpBridgePort, stopMcpBridge, minimizeWindow, maximizeWindow, closeWindow, setupTray, isTrayActive, validateBinarySizeConfig, resetDesktopFallbackState } from "@/desktop/tauriBridge"
import { performanceTelemetry } from "@/core/performanceTelemetry"
import { checkMemoryThreshold, createDefaultMemoryBudget, MemoryBudgetManager } from "@/core/memoryBudget"
import { generateMeshLods, selectLodByDistance, decimateGeometryBuffer, decimateIndices } from "@/core/meshLod"
import { createTextureStreamer } from "@/core/textureStreamer"
/** In-process ZIP reader: walks the central directory (not just local headers) and checks CRC32 / sizes. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = -1
  for (let i = zip.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record")
  const total = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  expect(cdOffset + cdSize).toBe(eocd)

  const files = new Map<string, Uint8Array>()
  let p = cdOffset
  for (let n = 0; n < total; n++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen))

    // matching local header
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    expect(view.getUint16(localOffset + 4, true)).toBe(20)
    expect(view.getUint16(localOffset + 8, true)).toBe(0)
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = zip.subarray(dataStart, dataStart + size)

    expect(method).toBe(0) // STORE
    expect(compSize).toBe(size)
    expect(calculateCrc32(data)).toBe(crc)
    files.set(name, data)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe("export & transpilers", () => {
  describe("Unity URP / Godot / Shadertoy transpilers", () => {
    const shaderSource = `
struct MaterialUniforms {
    u_color: vec4f,
    u_intensity: f32,
};

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 col = u_color.rgb * sin(u_time * u_intensity);
    fragColor = vec4(col, 1.0);
}
`
    const options: EngineExportOptions = {
      shaderName: "ShaderStudio/PBRStandard",
      shaderSource,
      parsedUniforms: [
        { name: "u_color", type: "vec4f", kind: "color" },
        { name: "u_intensity", type: "f32", kind: "scalar" },
        { name: "u_roughness", type: "f32", kind: "scalar" },
        { name: "u_offset", type: "vec2f", kind: "vector" },
        { name: "u_normalMap", type: "texture", kind: "texture" },
      ],
      uniformValues: {
        u_color: { type: "color", value: [0.8, 0.4, 0.2, 1.0] },
        u_intensity: { type: "float", value: 3.5 },
        u_roughness: { type: "float", value: 0.25 },
        u_offset: { type: "vec2", value: [0.5, 0.5] },
      },
    }

    it("Unity: header, properties, SRP-batcher CBUFFER, HLSL program and keyword mapping", () => {
      const hlsl = transpileToUnityHLSL(options)
      for (const s of [
        'Shader "ShaderStudio/PBRStandard"',
        '"RenderPipeline" = "UniversalPipeline"',
        '"LightMode" = "UniversalForward"',
        '_u_color ("u_color", Color) = (0.8, 0.4, 0.2, 1)',
        '_u_intensity ("u_intensity", Float) = 3.5',
        '_u_roughness ("u_roughness", Float) = 0.25',
        '_u_offset ("u_offset", Vector) = (0.5, 0.5, 0.0, 0.0)',
        '_u_normalMap ("u_normalMap", 2D) = "white" {}',
        "CBUFFER_START(UnityPerMaterial)",
        "float4 _u_color;",
        "float _u_intensity;",
        "float2 _u_offset;",
        "CBUFFER_END",
        "TransformObjectToHClip",
        "TransformObjectToWorldNormal",
        "float4 frag(Varyings i) : SV_Target",
        "i.positionCS.xy",
        "_ScreenParams.xy",
        "_Time.y",
      ]) {
        expect(hlsl).toContain(s)
      }
    })

    it("Unity: accepts the legacy uniformValues-only form and maps u_time / gl_FragCoord", () => {
      const code = transpileToUnityHLSL({
        shaderName: "Custom/Plasma",
        shaderSource: "void main() { vec3 c = u_color * sin(u_time); gl_FragColor = vec4(c, 1.0); }",
        parsedUniforms: [{ name: "u_color", type: "vec3f", kind: "color" }],
        uniformValues: { u_color: { type: "vec3", value: [1, 0, 0] } },
      })
      expect(code).toContain('Shader "Custom/Plasma"')
      expect(code).toContain("CBUFFER_START(UnityPerMaterial)")
      expect(code).toContain("_Time.y")
      expect(code).toContain("SV_Target")
    })

    it("Godot: spatial shader with source_color hint, defaults and builtin mapping", () => {
      const g = transpileToGodotShader(options)
      for (const s of [
        "shader_type spatial;",
        "uniform vec4 u_color : source_color = vec4(0.8, 0.4, 0.2, 1);",
        "uniform float u_intensity = 3.5;",
        "uniform float u_roughness = 0.25;",
        "uniform vec2 u_offset = vec2(0.5, 0.5);",
        "TIME",
        "VIEWPORT_SIZE",
        "ALBEDO = fragColor.rgb;",
        "ALPHA = fragColor.a;",
      ]) {
        expect(g).toContain(s)
      }
      const small = transpileToGodotShader({
        shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; }",
        parsedUniforms: [{ name: "u_speed", type: "f32", kind: "scalar" }],
        uniformValues: { u_speed: { type: "float", value: 2.0 } },
      })
      expect(small).toContain("uniform float u_speed = 2;")
      expect(small).toContain("FRAGCOORD")
    })

    it("Shadertoy: mainImage entry and environment uniforms", () => {
      const st = transpileToShadertoy(options)
      expect(st).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
      expect(st).toContain("iTime")
      expect(st).toContain("iResolution.xy")
      expect(st).toContain("fragCoord.xy")
    })

    it("infers uniforms from uniformValues alone (color / vec4 / vec3 / vec2 / float) for Unity and Godot", () => {
      const only = {
        shaderSource: "void main() { fragColor = vec4(1.0); }",
        uniformValues: {
          u_c: { type: "color" as const, value: [1, 0, 0, 1] },
          u_v4: { type: "vec4" as const, value: [1, 2, 3, 4] },
          u_v3: { type: "vec3" as const, value: [0.1, 0.2, 0.3] },
          u_v2: { type: "vec2" as const, value: [0.5, 0.25] },
          u_f: { type: "float" as const, value: 2 },
        },
      }
      const unity = transpileToUnityHLSL(only)
      expect(unity).toContain('_u_c ("u_c", Color)')
      expect(unity).toContain('_u_v3 ("u_v3", Vector) = (0.1, 0.2, 0.3, 1.0)')
      expect(unity).toContain("float3 _u_v3;")
      expect(unity).toContain("float2 _u_v2;")
      expect(unity).toContain("float _u_f;")
      const godot = transpileToGodotShader(only)
      expect(godot).toContain("uniform vec4 u_c : source_color = vec4(1, 0, 0, 1);")
      expect(godot).toContain("uniform vec3 u_v3 = vec3(0.1, 0.2, 0.3);")
      expect(godot).toContain("uniform vec2 u_v2 = vec2(0.5, 0.25);")
      expect(godot).toContain("uniform float u_f = 2;")

      const ue5 = transpileToUE5({ ...only })
      expect(ue5.parameters.map((p) => p.name)).toEqual(["u_c", "u_v4", "u_v3", "u_v2", "u_f"])
      expect(transpileToUE5("float a = 1.0;", { ...only }).parameters).toHaveLength(5)
      expect(transpileToUnrealHLSL(only)).toContain("SECTION 1")
      expect(transpileToBlenderOSL(only)).toContain("float u_f")
    })

    it("Shadertoy: sources that already define mainImage are passed through", () => {
      const st = transpileToShadertoy({ shaderSource: "void mainImage( out vec4 fragColor, in vec2 fragCoord ) { fragColor = vec4(u_time); }" })
      expect(st).toContain("void mainImage(")
      expect(st.match(/void mainImage\(/g)).toHaveLength(1)
      expect(st).toContain("iTime")
    })

    it("handles empty and comment-only sources across targets", () => {
      const empty = { shaderSource: "", parsedUniforms: [], uniformValues: {} }
      expect(transpileToUnityHLSL(empty)).toContain('Shader "ShaderStudio/CustomEffect"')
      expect(transpileToUnityHLSL(empty)).toContain("CBUFFER_START(UnityPerMaterial)")
      expect(transpileToGodotShader(empty)).toContain("shader_type spatial;")
      expect(transpileToShadertoy(empty)).toContain("void mainImage(")

      const comments = "\n// just a comment\n/* block\ncomment */\n"
      expect(parseWgslUniforms(comments)).toEqual([])
      expect(parseGlslUniforms(comments)).toEqual([])
      expect(transpileToUnityHLSL({ shaderSource: comments }).length).toBeGreaterThan(0)
    })

    // fleet: fixed in W6 (keyword replacement is a bare substring regex: user_u_time -> user__Time.y)
    it.fails("does not mangle identifiers that merely contain a keyword (user_u_time)", () => {
      const hlsl = transpileToUnityHLSL({
        shaderSource: "void main() { float user_u_time = 1.0; fragColor = vec4(user_u_time); }",
        parsedUniforms: [],
      })
      expect(hlsl).toContain("user_u_time")
    })
  })

  describe("uniform reflection and std140 layout", () => {
    it("reflects WGSL struct fields and bare uniforms", () => {
      const u = parseWgslUniforms(`
struct CameraData { viewMatrix: mat4x4f, projMatrix: mat4x4f, cameraPos: vec3f, fov: f32, };
@group(0) @binding(1) var<uniform> u_albedo: vec4f;
@fragment fn fs_main() -> @location(0) vec4f { return u_albedo; }
`)
      expect(u.length).toBeGreaterThanOrEqual(4)
      expect(u.find((x) => x.name === "viewMatrix")?.type).toBe("mat4x4f")
      expect(u.find((x) => x.name === "cameraPos")?.type).toBe("vec3f")
      expect(u.find((x) => x.name === "fov")?.type).toBe("f32")
      expect(u.find((x) => x.name === "u_albedo")?.type).toBe("vec4f")
    })

    it("reflects GLSL uniform blocks and computes a 16-byte-aligned std140 layout", () => {
      const u = parseGlslUniforms(`#version 300 es
precision highp float;
layout(std140) uniform LightBlock { vec3 u_lightPos; float u_lightRadius; vec4 u_lightColor; };
uniform float u_metallic;
uniform vec2 u_tiling;
out vec4 fragColor;
void main() { fragColor = u_lightColor * u_metallic; }`)
      const names = u.map((x) => x.name)
      for (const n of ["u_lightPos", "u_lightRadius", "u_lightColor", "u_metallic", "u_tiling"]) expect(names).toContain(n)
      const layout = computeUniformBufferLayout(u)
      expect(layout.totalSize).toBeGreaterThan(0)
      expect(layout.totalSize % 16).toBe(0)
      expect(layout.fields["u_lightPos"]?.size).toBe(12)
    })

    it("keeps 16-byte alignment for 64 mixed-type uniforms", () => {
      const many: any[] = Array.from({ length: 64 }, (_, i) => ({
        name: `u_param_${i}`,
        type: i % 4 === 0 ? "vec4f" : i % 3 === 0 ? "vec3f" : i % 2 === 0 ? "vec2f" : "f32",
        kind: "scalar",
      }))
      const layout = computeUniformBufferLayout(many)
      expect(layout.totalSize).toBeGreaterThan(64 * 4)
      expect(layout.totalSize % 16).toBe(0)
      expect(Object.keys(layout.fields)).toHaveLength(64)
    })

    it("never throws on malformed WGSL / GLSL", () => {
      expect(Array.isArray(parseWgslUniforms("struct Incomplete { invalid : : syntax ;;; broken: array<"))).toBe(true)
      expect(
        Array.isArray(parseGlslUniforms("uniform ;\nuniform float ;\nuniform non_existent_type u_foo;\nlayout(broken syntax) uniform Block { ;;; };"))
      ).toBe(true)
    })
  })

  describe("Unreal Engine 5 HLSL", () => {
    it("maps uniform kinds/types to UE5 parameter types", () => {
      const uniforms: ParsedUniform[] = [
        { name: "u_roughness", type: "float", kind: "scalar" },
        { name: "u_tint", type: "vec3", kind: "color" },
        { name: "u_albedoMap", type: "sampler2D", kind: "texture" },
        { name: "u_emissive", type: "vec4", kind: "vector" },
        { name: "u_offset", type: "vec2" },
        { name: "u_scale", type: "vec2f" },
        { name: "u_skybox", type: "samplerCube" },
        { name: "u_volume", type: "sampler3D" },
        { name: "u_model", type: "mat4" },
        { name: "u_rotation", type: "mat3" },
        { name: "u_transform", type: "mat2" },
      ]
      const r = transpileToUE5("float4 color = float4(1.0);", uniforms)
      const t = (n: string) => r.parameters.find((p) => p.name === n)?.ue5Type
      expect(r.parameters).toHaveLength(uniforms.length)
      expect(t("u_roughness")).toBe("ScalarParameter")
      expect(t("u_tint")).toBe("VectorParameter")
      expect(t("u_albedoMap")).toBe("Texture2D")
      expect(t("u_emissive")).toBe("VectorParameter")
      expect(t("u_offset")).toBe("VectorParameter")
      expect(t("u_scale")).toBe("VectorParameter")
      expect(t("u_skybox")).toBe("TextureCube")
      expect(t("u_volume")).toBe("Texture2D")
      for (const m of ["u_model", "u_rotation", "u_transform"]) expect(t(m)).toBe("VectorParameter")
      expect(r.customExpressionHLSL).toContain("// UE5 ScalarParameter: u_roughness")
      expect(r.customExpressionHLSL).toContain("// UE5 VectorParameter: u_tint")
      expect(r.customExpressionHLSL).toContain("// UE5 Texture2D: u_albedoMap")
    })

    it("wraps the body with WorldPosition / ViewDir and a float4 return", () => {
      const r = transpileToUE5("vec3 normal = vec3(0.0, 1.0, 0.0);", [])
      expect(r.customExpressionHLSL).toContain("float3 WorldPosition = GetWorldPosition(Parameters);")
      expect(r.customExpressionHLSL).toContain("float3 ViewDir = GetCameraVector(Parameters);")
      expect(r.customExpressionHLSL).toContain("return float4(1.0, 1.0, 1.0, 1.0);")
    })

    it("translates GLSL built-ins to HLSL (frac, lerp, fmod, atan2, float2)", () => {
      const r = transpileToUE5(
        `vec2 p = fract(gl_FragCoord.xy / u_resolution.xy);
         float a = mix(0.0, 1.0, u_time);
         float m = mod(p.x, 2.0);
         float angle = atan(p.y, p.x);`,
        []
      )
      for (const s of ["frac(", "lerp(", "fmod(", "atan2(", "float2 p ="]) expect(r.customExpressionHLSL).toContain(s)
    })

    it("does not treat identifiers containing 'main' (domain, remainder, maintain) as main()", () => {
      const r = transpileToUE5(
        `float domainWarp = sin(u_time * 2.0);
         float maintainScale = 1.5;
         float remainderTerm = fmod(domainWarp, maintainScale);
         float mainstreamVal = remainderTerm * 0.5;
         float remainingEnergy = 1.0 - mainstreamVal;
         return float4(domainWarp, maintainScale, remainderTerm, remainingEnergy);`,
        []
      )
      expect(r.customExpressionHLSL).not.toContain("// Inlined shader logic")
      for (const id of ["domainWarp", "maintainScale", "remainderTerm", "mainstreamVal", "remainingEnergy"]) {
        expect(r.customExpressionHLSL).toContain(id)
      }
      const r2 = transpileToUE5(
        `float domainMultiplier = 2.0; vec4 mainColorOutput = vec4(domainMultiplier); fragColor = mainColorOutput;`,
        []
      )
      expect(r2.customExpressionHLSL).toContain("return mainColorOutput;")
    })

    it("extracts nested/oddly formatted main() bodies and keeps bare statements when there is none", () => {
      const nested = transpileToUE5(
        `precision highp float;
         out vec4 fragColor;
         void main() {
           vec4 col = vec4(0.0);
           for (int i = 0; i < 4; i++) {
             if (i > 1) { for (int j = 0; j < 2; j++) { col += vec4(float(i) * 0.1, float(j) * 0.2, 0.0, 1.0); } }
             else { col += vec4(0.05); }
           }
           fragColor = col;
         }`,
        []
      )
      expect(nested.customExpressionHLSL).not.toContain("// Inlined shader logic")
      expect(nested.customExpressionHLSL).toContain("for (int i = 0; i < 4; i++)")
      expect(nested.customExpressionHLSL).toContain("for (int j = 0; j < 2; j++)")
      expect(nested.customExpressionHLSL).toContain("return col;")

      const spaced = transpileToUE5("void\n main\n (\n )\n {\n float myCustomVar = 42.0;\n gl_FragColor = vec4(myCustomVar);\n }", [])
      expect(spaced.customExpressionHLSL).toContain("myCustomVar")
      expect(spaced.customExpressionHLSL).toContain("return float4(myCustomVar);")

      const bare = transpileToUE5("float a = 1.0; float b = 2.0; float c = a + b;", [])
      expect(bare.customExpressionHLSL).toContain("float a = 1.0;")
      expect(bare.customExpressionHLSL).toContain("float c = a + b;")
      expect(bare.customExpressionHLSL).toContain("return float4(1.0, 1.0, 1.0, 1.0);")
    })

    it("converts only two-argument atan to atan2, including nested calls", () => {
      const r = transpileToUE5(
        `float a1 = atan(uv.x);
         float a2 = atan(uv.y, uv.x);
         float a3 = atan2(uv.y, uv.x);
         float a4 = atan(sin(cos(uv.x)));
         float a5 = atan(max(uv.x, uv.y));
         float a6 = atan(clamp(uv.x, 0.0, 1.0));
         float b2 = atan(max(uv.x, uv.y), min(uv.x, uv.y));
         float b3 = atan(sin(uv.y), cos(uv.x));
         float c2 = atan(atan(uv.y, uv.x));
         float c3 = atan(atan2(uv.y, uv.x));`,
        []
      )
      const h = r.customExpressionHLSL
      for (const s of [
        "atan(uv.x)",
        "atan2(uv.y, uv.x)",
        "atan(sin(cos(uv.x)))",
        "atan(max(uv.x, uv.y))",
        "atan(clamp(uv.x, 0.0, 1.0))",
        "atan2(max(uv.x, uv.y), min(uv.x, uv.y))",
        "atan2(sin(uv.y), cos(uv.x))",
        "atan(atan2(uv.y, uv.x))",
      ]) {
        expect(h).toContain(s)
      }
      for (const s of ["atan2(uv.x)", "atan2(max(uv.x, uv.y))", "atan2(clamp", "atan22"]) expect(h).not.toContain(s)
    })

    it("emits a Material Function with struct output, typed arguments and default fallbacks", () => {
      const r = transpileToUE5(
        `void main() { vec3 sampled = texture(u_albedoMap, uv).rgb * u_baseColor; fragColor = vec4(sampled, 1.0); }`,
        [
          { name: "u_roughness", type: "float", kind: "scalar" },
          { name: "u_metallic", type: "float", kind: "scalar" },
          { name: "u_baseColor", type: "vec3", kind: "color" },
          { name: "u_albedoMap", type: "sampler2D", kind: "texture" },
          { name: "u_envMap", type: "samplerCube", kind: "texture" },
        ]
      )
      for (const s of [
        "struct MaterialFunctionOutput {",
        "float3 BaseColor;",
        "float Roughness;",
        "float Metallic;",
        "float3 Normal;",
        "MaterialFunctionOutput MaterialFunction_ShaderStudio(",
        "float u_roughness",
        "float u_metallic",
        "float3 u_baseColor",
        "Texture2D u_albedoMap",
        "TextureCube u_envMap",
        "float3 WorldPosition",
        "float3 ViewDir",
        "MaterialFunctionOutput Out;",
        "Out.Roughness = u_roughness;",
        "Out.Metallic = u_metallic;",
        "Out.Normal = float3(0.0, 0.0, 1.0);",
        "Out.BaseColor = calculatedColor.rgb;",
        "return Out;",
      ]) {
        expect(r.materialFunctionHLSL).toContain(s)
      }
      const d = transpileToUE5("float x = 1.0;", [])
      expect(d.materialFunctionHLSL).toContain("Out.Roughness = 0.5;")
      expect(d.materialFunctionHLSL).toContain("Out.Metallic = 0.0;")
      expect(d.materialFunctionHLSL).toContain("Out.BaseColor = float3(1.0, 1.0, 1.0);")
    })

    it("transpileToUnrealHLSL formats a documented two-section export", () => {
      const out = transpileToUnrealHLSL({
        shaderName: "Custom/HeroShield",
        shaderSource: "float pulse = sin(u_time);",
        parsedUniforms: [{ name: "u_glow", type: "float", kind: "scalar" }],
      })
      expect(out).toContain("SECTION 1: Custom Expression Node HLSL")
      expect(out).toContain("SECTION 2: Material Function (.ush) HLSL")
      expect(out).toContain("Custom/HeroShield")
    })
  })

  describe("Blender Cycles OSL", () => {
    it("emits stdosl.h, ShaderStudioMaterial, typed uniforms and a closure BSDF output", () => {
      const osl = transpileToBlenderOSL("BSDF = diffuse(N);", [
        { name: "u_roughness", type: "float", defaultValue: 0.25 },
        { name: "u_albedo", type: "color", defaultValue: [0.8, 0.2, 0.2] },
        { name: "u_offset", type: "vec2", defaultValue: [0, 0] },
      ])
      for (const s of [
        "#include <stdosl.h>",
        "shader ShaderStudioMaterial(",
        "float u_roughness = 0.25",
        "color u_albedo = color(1.0, 1.0, 1.0)",
        "point u_offset = point(0.0, 0.0, 0.0)",
        "output closure color BSDF = 0",
        "BSDF = diffuse(N);",
      ]) {
        expect(osl).toContain(s)
      }
    })

    it("accepts the EngineExportOptions signature", () => {
      const osl = transpileToBlenderOSL({
        shaderSource: "void main() {}",
        parsedUniforms: [{ name: "u_speed", type: "f32", kind: "scalar" }],
      })
      expect(osl).toContain("shader ShaderStudioMaterial")
      expect(osl).toContain("float u_speed = 0.0")
    })

    it("translates GLSL math (types, gl_FragCoord, fract, time) and appends a diffuse closure", () => {
      const osl = transpileToBlenderOSL(
        `void main() {
          vec2 st = gl_FragCoord.xy / u_resolution.xy;
          float t = fract(u_time * 0.5);
          vec3 tint = vec3(st.x, st.y, t);
          fragColor = vec4(tint, 1.0);
        }`,
        [
          { name: "u_scale", type: "vec2" },
          { name: "u_gain", type: "float", defaultValue: 2.5 } as any,
        ]
      )
      for (const s of [
        "point u_scale = point(0.0, 0.0, 0.0)",
        "float u_gain = 2.5",
        "point st = point(u, v, 0.0) / point(1.0, 1.0, 0.0);",
        "float t = fmod(time * 0.5);",
        "color tint = color(st.x, st.y, t);",
        "BSDF = finalColor * diffuse(N);",
      ]) {
        expect(osl).toContain(s)
      }
      const sin = transpileToBlenderOSL("vec2 p = uv * 3.0; float wave = sin(p.x + u_time);", [])
      expect(sin).toContain("sin(p.x + time)")
      expect(sin).toContain("BSDF =")
      const len = transpileToBlenderOSL("vec2 p = uv * 2.0 - 1.0; float r = length(p);", [])
      expect(len).toContain("length(p)")
    })

    it("keeps explicit OSL verbatim when BSDF is already assigned", () => {
      const osl = transpileToBlenderOSL("color myCol = color(1.0, 0.0, 0.0);\nBSDF = myCol * emission();", [])
      expect(osl).toContain("color myCol = color(1.0, 0.0, 0.0);")
      expect(osl).toContain("BSDF = myCol * emission();")
    })
  })

  describe("glTF 2.0 material export", () => {
    it("emits asset metadata and toggles KHR_materials_pbrSpecularGlossiness vs KHR_materials_unlit", () => {
      const pbr = exportGltf2Material("GoldPBR", false)
      expect(pbr.gltfJson.asset.version).toBe("2.0")
      expect(pbr.gltfJson.asset.generator).toBe("ShaderStudio-glTF-Exporter")
      expect(pbr.extensionsUsed).toContain("KHR_materials_pbrSpecularGlossiness")
      expect(pbr.extensionsUsed).not.toContain("KHR_materials_unlit")
      expect(pbr.gltfJson.materials[0].name).toBe("GoldPBR")
      expect(pbr.gltfJson.materials[0].extensions.KHR_materials_pbrSpecularGlossiness).toBeDefined()

      const unlit = exportGltf2Material("NeonSign", true)
      expect(unlit.extensionsUsed).toContain("KHR_materials_unlit")
      expect(unlit.extensionsUsed).not.toContain("KHR_materials_pbrSpecularGlossiness")
      expect(unlit.gltfJson.materials[0].extensions.KHR_materials_unlit).toEqual({})
    })

    it("embeds baked maps as images and binds them to material slots", () => {
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

    it("binds metallicRoughnessTexture for an 'orm' or 'metallicRoughness' map", () => {
      const orm = exportGltf2Material("RobotArmor", false, {
        bakedMaps: { albedo: { dataUrl: "data:image/png;base64,albedoData" }, orm: { dataUrl: "data:image/png;base64,ormData" } },
      })
      const mat = orm.gltfJson.materials[0]
      expect(mat.pbrMetallicRoughness.baseColorTexture.index).toBe(0)
      expect(mat.pbrMetallicRoughness.metallicRoughnessTexture.index).toBe(1)
      expect(orm.gltfJson.images[1].name).toBe("RobotArmor_orm")
      expect(orm.gltfJson.images[1].uri).toBe("data:image/png;base64,ormData")

      const only = exportGltf2Material("TestOrm", false, { bakedMaps: { orm: { dataUrl: "data:image/png;base64,ORM_DATA" } } })
      expect(only.gltfJson.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toEqual({ index: 0 })
      const mr = exportGltf2Material("TestMR", false, {
        bakedMaps: { metallicRoughness: { dataUrl: "data:image/png;base64,MR_DATA" } },
      })
      expect(mr.gltfJson.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toEqual({ index: 0 })
    })

    it("createGltfBundle returns stringified glTF JSON", () => {
      const parsed = JSON.parse(createGltfBundle("TestMat", false))
      expect(parsed.asset.version).toBe("2.0")
      expect(parsed.materials[0].name).toBe("TestMat")
    })

    it("packOrmTexture interleaves AO/Roughness/Metallic into RGBA with alpha 255", () => {
      const n = 2 * 2 * 4
      const ao = new Uint8ClampedArray(n)
      const ro = new Uint8ClampedArray(n)
      const me = new Uint8ClampedArray(n)
      ao[0] = 50
      ro[0] = 120
      me[0] = 200
      const orm = packOrmTexture(ao, ro, me, 2, 2)
      expect(orm).toHaveLength(n)
      expect([...orm.subarray(0, 4)]).toEqual([50, 120, 200, 255])

      const fill = (v: number, len: number) => new Uint8ClampedArray(len).fill(v)
      const big = packOrmTexture(fill(55, 24), fill(110, 24), fill(220, 24), 3, 2)
      for (let i = 0; i < 6; i++) expect([...big.subarray(i * 4, i * 4 + 4)]).toEqual([55, 110, 220, 255])
    })

    it("packOrmTexture defaults truncated channels (roughness 128, metallic 0) and accepts 1-channel buffers", () => {
      const w = 16
      const h = 9
      const orm = packOrmTexture(new Uint8ClampedArray(w * h * 4).fill(40), new Uint8ClampedArray(0), new Uint8ClampedArray(0), w, h)
      expect(orm).toHaveLength(w * h * 4)
      expect([...orm.subarray(0, 4)]).toEqual([40, 128, 0, 255])

      const ao = new Uint8ClampedArray([10, 20, 30, 40])
      const ro = new Uint8ClampedArray([50, 60, 70, 80])
      const me = new Uint8ClampedArray([90, 100, 110, 120])
      const gray = packOrmTexture(ao, ro, me, 2, 2)
      expect(gray).toHaveLength(16)
      for (let i = 0; i < 4; i++) expect([...gray.subarray(i * 4, i * 4 + 4)]).toEqual([ao[i], ro[i], me[i], 255])
    })
  })

  describe("npm package generator and ZIP archive", () => {
    it("generates package.json, tsconfig, README and a typed loader module", () => {
      const pkg = generateNpmPackage("@shaderstudio/hologram-fx", "void main() {}", {
        version: "2.1.0",
        description: "Holographic effect shader package",
        author: "ShaderStudio Core Team",
        license: "Apache-2.0",
        threeVersion: ">=0.150.0",
      })
      expect(pkg.packageJson).toMatchObject({
        name: "@shaderstudio/hologram-fx",
        version: "2.1.0",
        description: "Holographic effect shader package",
        main: "dist/index.js",
        module: "dist/index.mjs",
        types: "dist/index.d.ts",
        author: "ShaderStudio Core Team",
        license: "Apache-2.0",
      })
      expect(pkg.packageJson.scripts?.build).toBe("tsc")
      expect(pkg.packageJson.peerDependencies.three).toBe(">=0.150.0")
      expect(pkg.tsconfigJson.compilerOptions).toMatchObject({ declaration: true, strict: true, outDir: "./dist" })
      expect(pkg.readmeMd).toContain("# @shaderstudio/hologram-fx")
      for (const s of ["export const shaderSource =", "export interface MaterialUniforms", "export function createMaterial(renderer: any)"]) {
        expect(pkg.indexTs).toContain(s)
      }
      const defaults = generateNpmPackage("@shaderstudio/hologram", "void main() {}")
      expect(defaults.packageJson.version).toBe("1.0.0")
      expect(defaults.packageJson.peerDependencies.three).toBe(">=0.150.0")
    })

    const evalModule = (indexTs: string) => {
      const body = `
        ${indexTs
          .replace(/import\s+.*?;/g, "")
          .replace(/export\s+interface\s+[\s\S]*?\}/g, "")
          .replace(/export\s+const\s+/g, "const ")
          .replace(/export\s+function\s+createMaterial\([^)]*\)(?::\s*[^{]+)?\s*\{/g, "function createMaterial(renderer) {")}
        return { shaderSource, defaultVertexShader, createMaterial };`
      return new Function("THREE", body)(THREE)
    }

    it("the generated module executes against real three.js and builds a ShaderMaterial", () => {
      const shader = "precision highp float; uniform float u_time; varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, sin(u_time), 1.0); }"
      const mod = evalModule(generateNpmPackage("@shaderstudio/pulsar", shader).indexTs)
      expect(mod.shaderSource).toBe(shader)
      const mat = mod.createMaterial(null)
      expect(mat).toBeInstanceOf(THREE.ShaderMaterial)
      expect(mat.fragmentShader).toBe(shader)
      expect(mat.vertexShader).toBe(mod.defaultVertexShader)
      expect(mat.uniforms.u_time.value).toBe(0)
      expect(mat.uniforms.u_resolution.value).toBeInstanceOf(THREE.Vector2)
      expect([mat.uniforms.u_resolution.value.x, mat.uniforms.u_resolution.value.y]).toEqual([1920, 1080])
    })

    it("survives shader sources with backticks, ${} and comments", () => {
      const nasty = "// backtick ` and dollar ${1 + 1}\n/* \"quotes\" 'single' */\nvoid main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }"
      const mod = evalModule(generateNpmPackage("@shaderstudio/pathological", nasty).indexTs)
      expect(mod.shaderSource).toBe(nasty)
      expect(mod.createMaterial(null).fragmentShader).toBe(nasty)
    })

    it("createNpmPackageZip is a valid PKZIP: all 4 files with matching CRC32, sizes and central directory", () => {
      const shader = "void main() { gl_FragColor = vec4(1.0); }"
      const zip = createNpmPackageZip("@shaderstudio/zip-verify", shader, { version: "1.0.0", description: "Zip Verification Package" })
      expect(zip).toBeInstanceOf(Uint8Array)
      expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])

      const files = readZip(zip)
      expect([...files.keys()].sort()).toEqual(["README.md", "package.json", "src/index.ts", "tsconfig.json"])
      const pkg = JSON.parse(text(files.get("package.json")!))
      expect(pkg.name).toBe("@shaderstudio/zip-verify")
      expect(pkg.description).toBe("Zip Verification Package")
      expect(pkg.peerDependencies.three).toBe(">=0.150.0")
      expect(text(files.get("src/index.ts")!)).toContain("createMaterial(renderer: any): THREE.ShaderMaterial")
      expect(text(files.get("src/index.ts")!)).toContain(JSON.stringify(shader))
    })

    it("createZipArchive stores arbitrary (incl. unicode-named and empty) files losslessly", () => {
      const payload = new TextEncoder().encode("hello 世界")
      const zip = createZipArchive([
        { name: "a/b.txt", data: payload },
        { name: "empty.bin", data: new Uint8Array(0) },
      ] as never)
      const files = readZip(zip)
      expect([...files.keys()]).toEqual(["a/b.txt", "empty.bin"])
      expect(text(files.get("a/b.txt")!)).toBe("hello 世界")
      expect(files.get("empty.bin")!.length).toBe(0)
      expect(calculateCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
    })
  })

  describe("Shadertoy importer", () => {
    it("maps iTime/iResolution/iMouse/iChannelN to u_* uniforms and wraps mainImage", () => {
      const imp = importShadertoy(`
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord / iResolution.xy;
          float t = iTime;
          vec4 m = iMouse;
          vec4 c0 = texture(iChannel0, uv);
          vec4 c1 = texture(iChannel1, uv);
          fragColor = c0 + c1 * sin(t) + m.x;
        }`)
      for (const s of ["u_resolution", "u_time", "u_mouse", "u_channel0", "u_channel1", "#version 300 es", "void main() {", "mainImage(fragColor, gl_FragCoord.xy);"]) {
        expect(imp.convertedSource).toContain(s)
      }
      expect(imp.channels).toEqual([0, 1])
    })

    it("handles channel-free code and puts #version 300 es strictly on line 1", () => {
      const imp = importShadertoy("void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 0.5, 0.2, 1.0); }")
      expect(imp.channels).toHaveLength(0)
      expect(imp.convertedSource).toContain("void main()")
      expect(imp.convertedSource.split("\n")[0]).toBe("#version 300 es")
      expect(imp.convertedSource.indexOf("#version 300 es")).toBe(0)
    })

    it("declares and rewrites u_delta (iTimeDelta) and u_frame (iFrame), and exposes them in the project", () => {
      const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(iTimeDelta, float(iFrame), 0.0, 1.0); }`
      const imp = importShadertoy(code)
      expect(imp.convertedSource).toContain("uniform float u_delta;")
      expect(imp.convertedSource).toContain("uniform int u_frame;")
      expect(imp.convertedSource).toContain("fragColor = vec4(u_delta, float(u_frame), 0.0, 1.0);")

      const proj = createProjectFromShadertoy(code, "DeltaFrameDemo")
      expect(proj.uniformValues.u_delta.value).toBe(0.016)
      expect(proj.uniformValues.u_frame.value).toBe(0)
    })

    it("createProjectFromShadertoy builds a webgl2 geometry -> material -> output graph", () => {
      const proj = createProjectFromShadertoy(
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }",
        "WaterRipples"
      )
      expect(proj.name).toBe("WaterRipples")
      expect(proj.backend).toBe("webgl2")
      expect(proj.graphNodes).toHaveLength(3)
      expect(proj.graphEdges).toHaveLength(2)
      expect(proj.uniformValues.u_time).toBeDefined()
      expect(proj.uniformValues.u_resolution).toBeDefined()
    })
  })

  describe("React Three Fiber export", () => {
    it("emits drei shaderMaterial, extend() and a Storybook preview", () => {
      const code = generateR3FExport("PlasmaOrb")
      for (const s of [
        "import * as THREE from 'three';",
        "import { extend } from '@react-three/fiber';",
        "import { shaderMaterial } from '@react-three/drei';",
        "export const PlasmaOrbMaterial = shaderMaterial(",
        "extend({ PlasmaOrbMaterial });",
        "export const StorybookPreview = () => (",
        "<mesh>",
        "<planeGeometry args={[2, 2]} />",
        "<PlasmaOrbMaterial />",
      ]) {
        expect(code).toContain(s)
      }
    })

    it("formats scalar, vec2, vec4, color and texture uniform defaults", () => {
      const code = generateR3FExport("MegaMat", {
        uniforms: [
          { name: "u_scalar", type: "float", kind: "scalar" },
          { name: "u_vec2", type: "vec2", kind: "vector" },
          { name: "u_vec4", type: "vec4", kind: "vector" },
          { name: "u_color", type: "vec3", kind: "color" },
          { name: "u_tex", type: "sampler2D", kind: "texture" },
        ],
        uniformValues: {
          u_scalar: { type: "float", value: 3.14 },
          u_vec2: { type: "vec2", value: [1.2, 3.4] },
          u_vec4: { type: "vec4", value: [0.1, 0.2, 0.3, 0.4] },
          u_color: { type: "color", value: [0.9, 0.8, 0.7] },
          u_tex: { type: "texture", value: null },
        },
      })
      for (const s of [
        "u_scalar: 3.14",
        "u_vec2: new THREE.Vector2(1.2, 3.4)",
        "u_vec4: new THREE.Vector4(0.1, 0.2, 0.3, 0.4)",
        "u_color: new THREE.Color(0.9, 0.8, 0.7)",
        "u_tex: null",
      ]) {
        expect(code).toContain(s)
      }
    })

    it("converts GLSL ES 3.0 outputs to gl_FragColor without corrupting similar identifiers", () => {
      const simple = generateR3FExport("Shader300", {
        shaderSource: "#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }",
      })
      expect(simple).not.toContain("out vec4 fragColor;")
      expect(simple).toContain("gl_FragColor = vec4(1.0);")

      const ident = generateR3FExport("Glsl300Mat", {
        shaderSource: "#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { vec4 my_fragColor_tmp = vec4(1.0); fragColor = my_fragColor_tmp; }",
      })
      expect(ident).not.toContain("#version 300 es")
      expect(ident).toContain("gl_FragColor = my_fragColor_tmp;")
      expect(ident).toContain("my_fragColor_tmp")

      const layout = generateR3FExport("LayoutMat", {
        shaderSource: "#version 300 es\nlayout(location = 0) out highp vec4 fragColor;\nprecision highp float;\nvoid main() {\n  fragColor = vec4(1.0, 0.5, 0.25, 1.0);\n}",
      })
      expect(layout).not.toContain("#version 300 es")
      expect(layout).not.toContain("fragColor;")
      expect(layout).toContain("gl_FragColor = vec4(1.0, 0.5, 0.25, 1.0);")

      const spaced = generateR3FExport("Var1", { shaderSource: "#version 300 es\nout   vec4   fragColor;\nvoid main() { fragColor = vec4(1.0); }" })
      expect(spaced).toContain("gl_FragColor")
    })
  })
})

describe("Tier 5: Comprehensive White-Box Adversarial Coverage & Boundary Hardening", () => {
  beforeEach(() => {
    setupE2ETestEnvironment()
    subGraphLibrary.reset()
    customNodeRegistry.clear()
    customNodeRegistry.discoverBuiltinNodes()
    resetDesktopFallbackState()
    performanceTelemetry.reset()
  })

  afterEach(() => {
    teardownE2ETestEnvironment()
    resetDesktopFallbackState()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BATTERY 3: R3 Export & Ecosystem Transpilers Edge Conditions
  // ==========================================================================
  describe("Battery 3: R3 Export & Ecosystem Transpilers Edge Conditions", () => {
    it("3.1 transpileToUE5 maps parameters and translates coordinates and functions", () => {
      const glslSource = `
        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          float angle = atan(uv.y, uv.x);
          float t = fract(u_time * 0.5);
          fragColor = vec4(col * diffuseColor, 1.0);
        }
      `
      const res = transpileToUE5({
        shaderSource: glslSource,
        parsedUniforms: [
          { name: "speed", type: "float", kind: "scalar" },
          { name: "diffuseColor", type: "color", kind: "color" },
          { name: "noiseTex", type: "sampler2D", kind: "texture" },
        ],
      })

      expect(res.parameters).toHaveLength(3)
      expect(res.parameters.find((p) => p.name === "speed")?.ue5Type).toBe("ScalarParameter")
      expect(res.parameters.find((p) => p.name === "diffuseColor")?.ue5Type).toBe("VectorParameter")
      expect(res.parameters.find((p) => p.name === "noiseTex")?.ue5Type).toBe("Texture2D")

      expect(res.customExpressionHLSL).toContain("View.GameTime")
      expect(res.customExpressionHLSL).toContain("View.ViewSizeAndInvSize.xy")
      expect(res.customExpressionHLSL).toContain("atan2(")
      expect(res.customExpressionHLSL).toContain("frac(")

      const docs = transpileToUnrealHLSL({ shaderSource: glslSource, parsedUniforms: [] })
      expect(docs).toContain("SECTION 1: Custom Expression Node HLSL")
      expect(docs).toContain("SECTION 2: Material Function (.ush) HLSL")
    })

    it("3.2 transpileToBlenderOSL converts types to OSL point/color and diffuse closure", () => {
      const osl = transpileToBlenderOSL({
        shaderSource: `
          void main() {
            vec2 uv = gl_FragCoord.xy / u_resolution.xy;
            fragColor = vec4(baseColor, 1.0);
          }
        `,
        parsedUniforms: [
          { name: "scale", type: "float", kind: "scalar" },
          { name: "offset", type: "vec2", kind: "vector" },
          { name: "baseColor", type: "color", kind: "color" },
        ],
      })

      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("point offset = point(0.0, 0.0, 0.0)")
      expect(osl).toContain("color baseColor = color(1.0, 1.0, 1.0)")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("BSDF = finalColor * diffuse(N);")
    })

    it("3.3 exportGltf2Material and packOrmTexture produce valid PBR material and ORM buffer", () => {
      const gltf = exportGltf2Material("PBR_Hero", false, {
        baseColorFactor: [1.0, 0.5, 0.2, 1.0],
        roughnessFactor: 0.35,
        metallicFactor: 0.8,
      })
      expect(gltf.gltfJson.asset.version).toBe("2.0")
      expect(gltf.gltfJson.materials[0].name).toBe("PBR_Hero")
      expect(gltf.gltfJson.materials[0].pbrMetallicRoughness.roughnessFactor).toBe(0.35)
      expect(gltf.gltfJson.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0.8)

      // Unlit material includes extension
      const unlitGltf = exportGltf2Material("Unlit_Hero", true)
      expect(unlitGltf.extensionsUsed).toContain("KHR_materials_unlit")

      // ORM packing
      const ao = new Uint8ClampedArray([255, 255, 255, 255])
      const rough = new Uint8ClampedArray([128, 128, 128, 128])
      const metal = new Uint8ClampedArray([64, 64, 64, 64])
      const orm = packOrmTexture(ao, rough, metal, 2, 2)
      expect(orm.length).toBe(2 * 2 * 4)
      expect(orm[0]).toBe(255) // R: Occlusion
      expect(orm[1]).toBe(128) // G: Roughness
      expect(orm[2]).toBe(64)  // B: Metallic
      expect(orm[3]).toBe(255) // A: 255
    })

    it("3.4 generateNpmPackage creates publishable package scaffold", () => {
      const pkg = generateNpmPackage("@shaderstudio/water-ripple", "fn main() {}", {
        version: "1.2.0",
      })

      expect(pkg.packageJson).toBeDefined()
      expect(pkg.packageJson.name).toBe("@shaderstudio/water-ripple")
      expect(pkg.packageJson.version).toBe("1.2.0")
      expect(pkg.packageJson.main).toBe("dist/index.js")
      expect(pkg.packageJson.types).toBe("dist/index.d.ts")

      expect(pkg.indexTs).toContain("export const shaderSource")
      expect(pkg.readmeMd).toContain("@shaderstudio/water-ripple")
    })

    it("3.5 importShadertoy and createProjectFromShadertoy map inputs and channel samplers", () => {
      const shadertoyCode = `
        void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
          vec2 uv = fragCoord / iResolution.xy;
          vec4 tex = texture(iChannel0, uv);
          fragColor = vec4(uv, sin(iTime), 1.0);
        }
      `
      const imported = importShadertoy(shadertoyCode)
      expect(imported.mappedUniforms.iTime).toBe("u_time")
      expect(imported.mappedUniforms.iResolution).toBe("u_resolution")
      expect(imported.channels).toEqual([0])
      expect(imported.convertedSource).toContain("uniform sampler2D u_channel0;")
      expect(imported.convertedSource).toContain("mainImage(fragColor, gl_FragCoord.xy);")

      const project = createProjectFromShadertoy(shadertoyCode, "Imported Ripple")
      expect(project.name).toBe("Imported Ripple")
      expect(project.backend).toBe("webgl2")
      expect(project.graphNodes.some((n) => n.type === "material")).toBe(true)
      expect(project.uniformValues.u_time).toBeDefined()
    })

    it("3.6 generateR3FExport generates drei shaderMaterial and preview story", () => {
      const r3f = generateR3FExport("HologramMaterial", {
        vertexShader: "void main() {}",
        shaderSource: "void main() {}",
      })
      expect(r3f).toContain("shaderMaterial")
      expect(r3f).toContain("HologramMaterial")
      expect(r3f).toContain("StorybookPreview")
    })
  })
})
