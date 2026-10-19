import { describe, it, expect } from "vitest"
import * as THREE from "three"
import {
  generateNpmPackage,
  createNpmPackageZip,
  type NpmPackageOptions,
} from "@/core/npmPackageGenerator"
import {
  generateR3FExport,
  type R3FExportOptions,
} from "@/core/r3fExporter"
import {
  transpileToUE5,
  transpileToUnrealHLSL,
  transpileToBlenderOSL,
  exportGltf2Material,
  createGltfBundle,
  packOrmTexture,
} from "@/core/engineTranspiler"
import {
  importShadertoy,
  createProjectFromShadertoy,
} from "@/core/shadertoyImporter"
import { calculateCrc32 } from "@/utils/zipBuilder"

describe("Adversarial Challenger Verification Suite: Milestone 3 Remediation Re-Verification", () => {
  // ==========================================================================
  // Battery 1: npm Package Generator & Three.js Runtime Execution
  // ==========================================================================
  describe("Battery 1: npm Package Generator & Three.js Runtime Execution", () => {
    it("generates syntactically executable TypeScript module and executes createMaterial at runtime", () => {
      const shader = `
        precision highp float;
        uniform float u_time;
        uniform vec2 u_resolution;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(vUv, sin(u_time), 1.0);
        }
      `
      const pkg = generateNpmPackage("@shaderstudio/pulsar", shader, {
        version: "3.2.1",
        description: "Adversarial Pulsar Material",
        author: "Adversarial Challenger",
        license: "MIT",
        threeVersion: ">=0.160.0",
      })

      // package.json integrity
      expect(pkg.packageJson.name).toBe("@shaderstudio/pulsar")
      expect(pkg.packageJson.version).toBe("3.2.1")
      expect(pkg.packageJson.peerDependencies.three).toBe(">=0.160.0")

      // tsconfig.json integrity
      expect(pkg.tsconfigJson.compilerOptions.strict).toBe(true)
      expect(pkg.tsconfigJson.compilerOptions.declaration).toBe(true)

      // index.ts execution: Evaluate createMaterial in real THREE context
      // Strip import/export/interfaces for Function constructor evaluation
      const executableBody = `
        ${pkg.indexTs
          .replace(/import\s+.*?;/g, "")
          .replace(/export\s+interface\s+[\s\S]*?\}/g, "")
          .replace(/export\s+const\s+/g, "const ")
          .replace(/export\s+function\s+createMaterial\([^)]*\)(?::\s*[^{]+)?\s*\{/g, "function createMaterial(renderer) {")}
        return { shaderSource, defaultVertexShader, createMaterial };
      `
      const factory = new Function("THREE", executableBody)
      const exports = factory(THREE)

      expect(exports.shaderSource).toBe(shader)
      expect(typeof exports.createMaterial).toBe("function")

      // Execute createMaterial
      const mat = exports.createMaterial(null)
      expect(mat).toBeInstanceOf(THREE.ShaderMaterial)
      expect(mat.fragmentShader).toBe(shader)
      expect(mat.vertexShader).toBe(exports.defaultVertexShader)
      expect(mat.uniforms.u_time).toBeDefined()
      expect(mat.uniforms.u_time.value).toBe(0)
      expect(mat.uniforms.u_resolution).toBeDefined()
      expect(mat.uniforms.u_resolution.value).toBeInstanceOf(THREE.Vector2)
      expect(mat.uniforms.u_resolution.value.x).toBe(1920)
      expect(mat.uniforms.u_resolution.value.y).toBe(1080)
    })

    it("handles complex shader sources with escaped characters, backticks, and comments without syntax breakage", () => {
      const pathologicalShader = `
        // Backtick test \` and dollar sign \${1 + 1}
        precision highp float;
        /* multi-line
           comment with "quotes" and 'single' */
        void main() {
          gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
        }
      `
      const pkg = generateNpmPackage("@shaderstudio/pathological", pathologicalShader)
      const executableBody = `
        ${pkg.indexTs
          .replace(/import\s+.*?;/g, "")
          .replace(/export\s+interface\s+[\s\S]*?\}/g, "")
          .replace(/export\s+const\s+/g, "const ")
          .replace(/export\s+function\s+createMaterial\([^)]*\)(?::\s*[^{]+)?\s*\{/g, "function createMaterial(renderer) {")}
        return { shaderSource, createMaterial };
      `
      const factory = new Function("THREE", executableBody)
      const exports = factory(THREE)
      expect(exports.shaderSource).toBe(pathologicalShader)
      const mat = exports.createMaterial(null)
      expect(mat.fragmentShader).toBe(pathologicalShader)
    })
  })

  // ==========================================================================
  // Battery 2: PKZIP 2.0 Binary Layout & Decompression Integrity
  // ==========================================================================
  describe("Battery 2: PKZIP 2.0 Binary Layout & Decompression Integrity", () => {
    it("decompresses and validates all 4 files from createNpmPackageZip with 100% CRC32 and byte equality", () => {
      const shader = "void main() { gl_FragColor = vec4(1.0); }"
      const zipBytes = createNpmPackageZip("@shaderstudio/zip-verify", shader, {
        version: "1.0.0",
        description: "Zip Verification Package",
      })

      expect(zipBytes).toBeInstanceOf(Uint8Array)
      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength)

      // Traverse Local File Headers
      let cursor = 0
      const extractedFiles = new Map<string, { data: Uint8Array; crc: number }>()

      while (cursor < zipBytes.byteLength) {
        const sig = view.getUint32(cursor, true)
        if (sig === 0x04034b50) {
          // Local File Header
          const versionNeeded = view.getUint16(cursor + 4, true)
          const compMethod = view.getUint16(cursor + 8, true)
          const crc = view.getUint32(cursor + 14, true)
          const compSize = view.getUint32(cursor + 18, true)
          const uncompSize = view.getUint32(cursor + 22, true)
          const nameLen = view.getUint16(cursor + 26, true)
          const extraLen = view.getUint16(cursor + 28, true)

          expect(versionNeeded).toBe(20)
          expect(compMethod).toBe(0) // STORE
          expect(compSize).toBe(uncompSize)

          const nameBytes = zipBytes.subarray(cursor + 30, cursor + 30 + nameLen)
          const name = new TextDecoder().decode(nameBytes)

          const dataOffset = cursor + 30 + nameLen + extraLen
          const fileData = zipBytes.subarray(dataOffset, dataOffset + uncompSize)

          // Decompression verification: For STORE method, data is identical to payload
          const computedCrc = calculateCrc32(fileData)
          expect(computedCrc).toBe(crc)

          extractedFiles.set(name, { data: fileData, crc })
          cursor = dataOffset + uncompSize
        } else if (sig === 0x02014b50) {
          // Central directory begins
          break
        } else {
          cursor++
        }
      }

      // Verify all 4 required files are extracted
      expect(extractedFiles.has("package.json")).toBe(true)
      expect(extractedFiles.has("README.md")).toBe(true)
      expect(extractedFiles.has("tsconfig.json")).toBe(true)
      expect(extractedFiles.has("src/index.ts")).toBe(true)

      // Verify package.json content is valid JSON matching inputs
      const pkgData = extractedFiles.get("package.json")!.data
      const parsedPkg = JSON.parse(new TextDecoder().decode(pkgData))
      expect(parsedPkg.name).toBe("@shaderstudio/zip-verify")
      expect(parsedPkg.description).toBe("Zip Verification Package")

      // Verify Central Directory and EOCD integrity
      let eocdOffset = -1
      for (let i = zipBytes.byteLength - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdOffset = i
          break
        }
      }
      expect(eocdOffset).toBeGreaterThan(0)
      const totalEntries = view.getUint16(eocdOffset + 10, true)
      expect(totalEntries).toBe(4)
      const centralDirOffset = view.getUint32(eocdOffset + 16, true)
      expect(view.getUint32(centralDirOffset, true)).toBe(0x02014b50)
    })

    it("extracts cleanly via standard Windows OS PowerShell Expand-Archive without errors", async () => {
      const fs = await import("fs")
      const path = await import("path")
      const { execSync } = await import("child_process")

      const shader = "void main() { gl_FragColor = vec4(0.5, 0.8, 1.0, 1.0); }"
      const zipBytes = createNpmPackageZip("@shaderstudio/os-unzip-test", shader)

      const tempDir = path.resolve(process.cwd(), "node_modules", ".temp-zip-test")
      const zipPath = path.resolve(tempDir, "test-pkg.zip")
      const extractDir = path.resolve(tempDir, "extracted")

      try {
        fs.mkdirSync(tempDir, { recursive: true })
        fs.writeFileSync(zipPath, zipBytes)

        // Run Windows PowerShell Expand-Archive
        execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force"`, {
          timeout: 10000,
        })

        // Verify extracted files exist
        expect(fs.existsSync(path.join(extractDir, "package.json"))).toBe(true)
        expect(fs.existsSync(path.join(extractDir, "README.md"))).toBe(true)
        expect(fs.existsSync(path.join(extractDir, "tsconfig.json"))).toBe(true)
        expect(fs.existsSync(path.join(extractDir, "src", "index.ts"))).toBe(true)

        // Verify content of package.json
        const pkgRaw = fs.readFileSync(path.join(extractDir, "package.json"), "utf8")
        const parsed = JSON.parse(pkgRaw)
        expect(parsed.name).toBe("@shaderstudio/os-unzip-test")
        expect(parsed.peerDependencies.three).toBe(">=0.150.0")

        // Verify src/index.ts has createMaterial
        const indexTsRaw = fs.readFileSync(path.join(extractDir, "src", "index.ts"), "utf8")
        expect(indexTsRaw).toContain("createMaterial(renderer: any): THREE.ShaderMaterial")
      } finally {
        // Cleanup temp files
        try {
          fs.rmSync(tempDir, { recursive: true, force: true })
        } catch {}
      }
    })
  })

  // ==========================================================================
  // Battery 3: React Three Fiber (R3F) Exporter & Storybook Preview
  // ==========================================================================
  describe("Battery 3: React Three Fiber (R3F) Exporter & Storybook Preview", () => {
    it("handles complex GLSL ES 3.0 declarations with layout qualifiers, precision, and varied whitespace", () => {
      const glsl300WithLayout = `#version 300 es
layout(location = 0) out highp vec4 fragColor;
precision highp float;
void main() {
  fragColor = vec4(1.0, 0.5, 0.25, 1.0);
}`
      const exported = generateR3FExport("LayoutMat", { shaderSource: glsl300WithLayout })
      expect(exported).not.toContain("#version 300 es")
      expect(exported).not.toContain("fragColor;")
      expect(exported).toContain("gl_FragColor = vec4(1.0, 0.5, 0.25, 1.0);")
    })

    it("exports StorybookPreview component alongside shaderMaterial and extend", () => {
      const exported = generateR3FExport("HoloShield")
      expect(exported).toContain("import { shaderMaterial } from '@react-three/drei';")
      expect(exported).toContain("import { extend } from '@react-three/fiber';")
      expect(exported).toContain("export const HoloShieldMaterial = shaderMaterial(")
      expect(exported).toContain("extend({ HoloShieldMaterial });")
      expect(exported).toContain("export const StorybookPreview = () => (")
      expect(exported).toContain("<mesh>")
      expect(exported).toContain("<planeGeometry args={[2, 2]} />")
      expect(exported).toContain("<HoloShieldMaterial />")
    })

    it("correctly formats all uniform types: scalar, vector2, vector4, color, and sampler2D", () => {
      const exported = generateR3FExport("MegaMat", {
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

      expect(exported).toContain("u_scalar: 3.14")
      expect(exported).toContain("u_vec2: new THREE.Vector2(1.2, 3.4)")
      expect(exported).toContain("u_vec4: new THREE.Vector4(0.1, 0.2, 0.3, 0.4)")
      expect(exported).toContain("u_color: new THREE.Color(0.9, 0.8, 0.7)")
      expect(exported).toContain("u_tex: null")
    })
  })

  // ==========================================================================
  // Battery 4: glTF 2.0 Material Exporter & ORM Packing
  // ==========================================================================
  describe("Battery 4: glTF 2.0 Material Exporter & ORM Packing", () => {
    it("handles 1-channel grayscale buffers for AO, Roughness, and Metallic", () => {
      const w = 2
      const h = 2
      const totalPixels = w * h
      const aoGrayscale = new Uint8ClampedArray([10, 20, 30, 40])
      const roughGrayscale = new Uint8ClampedArray([50, 60, 70, 80])
      const metalGrayscale = new Uint8ClampedArray([90, 100, 110, 120])

      const orm = packOrmTexture(aoGrayscale, roughGrayscale, metalGrayscale, w, h)
      expect(orm).toHaveLength(totalPixels * 4)

      // Pixel 0: AO=10, Rough=50, Metal=90, A=255
      expect(orm[0]).toBe(10)
      expect(orm[1]).toBe(50)
      expect(orm[2]).toBe(90)
      expect(orm[3]).toBe(255)

      // Pixel 3: AO=40, Rough=80, Metal=120, A=255
      expect(orm[12]).toBe(40)
      expect(orm[13]).toBe(80)
      expect(orm[14]).toBe(120)
      expect(orm[15]).toBe(255)
    })

    it("exportGltf2Material correctly binds metallicRoughnessTexture when ORM map is supplied", () => {
      const res = exportGltf2Material("RobotArmor", false, {
        bakedMaps: {
          albedo: { dataUrl: "data:image/png;base64,albedoData" },
          orm: { dataUrl: "data:image/png;base64,ormData" },
        },
      })

      const mat = res.gltfJson.materials[0]
      expect(mat.pbrMetallicRoughness.baseColorTexture.index).toBe(0)
      expect(mat.pbrMetallicRoughness.metallicRoughnessTexture.index).toBe(1)
      expect(res.gltfJson.images[1].name).toBe("RobotArmor_orm")
      expect(res.gltfJson.images[1].uri).toBe("data:image/png;base64,ormData")
    })
  })

  // ==========================================================================
  // Battery 5: UE5 HLSL, Blender Cycles OSL, and Shadertoy Importer
  // ==========================================================================
  describe("Battery 5: UE5 HLSL, Blender Cycles OSL, and Shadertoy Importer", () => {
    it("UE5 preserves procedural shader math with variable names containing 'main'", () => {
      const glsl = `
        float domainMultiplier = 2.0;
        float remainderOffset = 0.25;
        float maintainScale = 1.5;
        vec4 mainColorOutput = vec4(domainMultiplier * remainderOffset * maintainScale);
        fragColor = mainColorOutput;
      `
      const res = transpileToUE5(glsl, [])
      expect(res.customExpressionHLSL).toContain("domainMultiplier")
      expect(res.customExpressionHLSL).toContain("remainderOffset")
      expect(res.customExpressionHLSL).toContain("maintainScale")
      expect(res.customExpressionHLSL).toContain("return mainColorOutput;")
      expect(res.customExpressionHLSL).not.toContain("// Inlined shader logic")
    })

    it("UE5 Material Function provides authentic MaterialFunction_ShaderStudio implementation", () => {
      const glsl = `
        void main() {
          vec3 c = vec3(0.2, 0.4, 0.8);
          fragColor = vec4(c, 1.0);
        }
      `
      const res = transpileToUE5(glsl, [
        { name: "u_roughness", type: "float", kind: "scalar" },
        { name: "u_metallic", type: "float", kind: "scalar" },
      ])

      expect(res.materialFunctionHLSL).toContain("struct MaterialFunctionOutput")
      expect(res.materialFunctionHLSL).toContain("MaterialFunctionOutput MaterialFunction_ShaderStudio(")
      expect(res.materialFunctionHLSL).toContain("Out.Roughness = u_roughness;")
      expect(res.materialFunctionHLSL).toContain("Out.Metallic = u_metallic;")
      expect(res.materialFunctionHLSL).toContain("Out.Normal = float3(0.0, 0.0, 1.0);")
      expect(res.materialFunctionHLSL).toContain("return Out;")
    })

    it("Blender Cycles OSL translates GLSL math and outputs closure BSDF", () => {
      const glsl = `
        vec2 p = uv * 3.0;
        float wave = sin(p.x + u_time);
        vec3 col = vec3(wave, 0.5, 1.0);
      `
      const osl = transpileToBlenderOSL(glsl, [])
      expect(osl).toContain("#include <stdosl.h>")
      expect(osl).toContain("shader ShaderStudioMaterial(")
      expect(osl).toContain("output closure color BSDF = 0")
      expect(osl).toContain("time")
      expect(osl).toContain("sin(p.x + time)")
      expect(osl).toContain("BSDF =")
    })

    it("Shadertoy importer strictly places #version 300 es on line 1 and declares u_delta and u_frame", () => {
      const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = vec4(float(iFrame), iTimeDelta, 0.0, 1.0);
      }`
      const res = importShadertoy(code)
      const lines = res.convertedSource.split("\n")
      expect(lines[0].trim()).toBe("#version 300 es")
      expect(res.convertedSource).toContain("uniform float u_delta;")
      expect(res.convertedSource).toContain("uniform int u_frame;")
    })
  })
})
