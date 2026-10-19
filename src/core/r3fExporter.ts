import type { ParsedUniform, UniformValue } from "@/stores/projectStore"

export interface R3FExportOptions {
  shaderSource?: string
  vertexShader?: string
  uniforms?: ParsedUniform[]
  uniformValues?: Record<string, UniformValue>
}

/**
 * Generates an upgraded React Three Fiber module using `@react-three/drei`'s `shaderMaterial`,
 * `@react-three/fiber`'s `extend`, and an exportable `StorybookPreview` component.
 */
export function generateR3FExport(
  materialName: string,
  options?: R3FExportOptions
): string {
  const safeName = materialName.replace(/[^a-zA-Z0-9_]/g, "") || "Custom"

  const vertexShader =
    options?.vertexShader ||
    `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

  let fragmentShader = options?.shaderSource || ""
  if (!fragmentShader) {
    fragmentShader = `uniform float u_time;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(vUv, sin(u_time), 1.0);
}`
  } else {
    // If it uses out vec4 fragColor, ensure gl_FragColor compatibility for three.js ShaderMaterial
    const fragColorDeclRegex = /(?:layout\s*\([^)]*\)\s*)?out\s+(?:(?:highp|mediump|lowp)\s+)?vec4\s+fragColor\s*;/i
    if (fragColorDeclRegex.test(fragmentShader) || fragmentShader.includes("out vec4 fragColor;")) {
      fragmentShader = fragmentShader
        .replace(/#version\s+300\s+es\s*/g, "")
        .replace(/(?:layout\s*\([^)]*\)\s*)?out\s+(?:(?:highp|mediump|lowp)\s+)?vec4\s+fragColor\s*;\s*/gi, "")
        .replace(/\bfragColor\b/g, "gl_FragColor")
    }
  }

  // Generate uniform initializers
  const uniformProps: string[] = [
    "u_time: 0",
    "u_resolution: new THREE.Vector2()",
  ]

  if (options?.uniforms) {
    for (const u of options.uniforms) {
      if (u.name === "u_time" || u.name === "u_resolution") continue
      const val = options.uniformValues?.[u.name]?.value
      const t = String(u.type)
      if (t === "vec3f" || t === "vec3" || t === "color" || u.kind === "color") {
        const arr = Array.isArray(val) ? val : [1, 1, 1]
        uniformProps.push(`${u.name}: new THREE.Color(${arr[0]}, ${arr[1]}, ${arr[2]})`)
      } else if (t === "vec2f" || t === "vec2") {
        const arr = Array.isArray(val) ? val : [1, 1]
        uniformProps.push(`${u.name}: new THREE.Vector2(${arr[0]}, ${arr[1]})`)
      } else if (t === "vec4f" || t === "vec4") {
        const arr = Array.isArray(val) ? val : [0, 0, 0, 1]
        uniformProps.push(`${u.name}: new THREE.Vector4(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]})`)
      } else if (t === "sampler2D" || t === "texture" || u.kind === "texture") {
        uniformProps.push(`${u.name}: null`)
      } else {
        const num = typeof val === "number" ? val : 0
        uniformProps.push(`${u.name}: ${num}`)
      }
    }
  }

  return `
import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

export const ${safeName}Material = shaderMaterial(
  { ${uniformProps.join(", ")} },
  /* vertex */ \`
${vertexShader.split("\n").map(l => "    " + l).join("\n")}
  \`,
  /* fragment */ \`
${fragmentShader.split("\n").map(l => "    " + l).join("\n")}
  \`
);

extend({ ${safeName}Material });

export const StorybookPreview = () => (
  <mesh>
    <planeGeometry args={[2, 2]} />
    <${safeName}Material />
  </mesh>
);
`.trim()
}
