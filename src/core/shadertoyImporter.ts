import type { ProjectData } from "@/stores/projectStore"

export interface ShadertoyImportResult {
  convertedSource: string
  mappedUniforms: Record<string, string>
  channels: number[]
}

/**
 * Standard mapping from Shadertoy inputs to ShaderStudio uniforms.
 */
export const SHADERTOY_UNIFORM_MAP: Record<string, string> = {
  iTime: "u_time",
  iResolution: "u_resolution",
  iMouse: "u_mouse",
  iChannel0: "u_channel0",
  iChannel1: "u_channel1",
  iChannel2: "u_channel2",
  iChannel3: "u_channel3",
  iTimeDelta: "u_delta",
  iFrame: "u_frame",
}

/**
 * Parses and converts raw Shadertoy GLSL code into ShaderStudio-compatible
 * GLSL ES 3.0 fragment shader source.
 */
export function importShadertoy(code: string): ShadertoyImportResult {
  const mappedUniforms: Record<string, string> = {
    iTime: "u_time",
    iResolution: "u_resolution",
    iMouse: "u_mouse",
    iChannel0: "u_channel0",
    iChannel1: "u_channel1",
    iChannel2: "u_channel2",
    iChannel3: "u_channel3",
    iTimeDelta: "u_delta",
    iFrame: "u_frame",
  }

  // Detect channels used (iChannel0, iChannel1, iChannel2, iChannel3)
  const channels: number[] = []
  for (let c = 0; c < 4; c++) {
    if (code.includes(`iChannel${c}`)) {
      channels.push(c)
    }
  }

  let converted = code
  for (const [shadertoy, studio] of Object.entries(mappedUniforms)) {
    // Replace whole identifiers where possible
    const regex = new RegExp(`\\b${shadertoy}\\b`, "g")
    converted = converted.replace(regex, studio)
  }

  // Generate channel sampler declarations if any channels exist
  const channelDeclarations = channels
    .map((c) => `uniform sampler2D u_channel${c};`)
    .join("\n")

  const headerParts = [
    "#version 300 es",
    "// Converted from Shadertoy",
    "precision highp float;",
    "uniform float u_time;",
    "uniform float u_delta;",
    "uniform int u_frame;",
    "uniform vec2 u_resolution;",
    "uniform vec4 u_mouse;",
  ]

  if (channelDeclarations) {
    headerParts.push(channelDeclarations)
  }
  headerParts.push("out vec4 fragColor;\n")

  const convertedSource = `${headerParts.join("\n")}
${converted.trim()}

void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}
`.trim()

  return { convertedSource, mappedUniforms, channels }
}

/**
 * Fetches shader code from a Shadertoy URL or shader ID.
 */
export async function importShadertoyFromUrl(urlOrId: string): Promise<string> {
  let shaderId = urlOrId.trim()
  const match = shaderId.match(/shadertoy\.com\/view\/([a-zA-Z0-9]+)/)
  if (match) {
    shaderId = match[1]
  }

  if (!shaderId) {
    throw new Error("Invalid Shadertoy URL or ID.")
  }

  try {
    const res = await fetch(`https://www.shadertoy.com/api/v1/shaders/${shaderId}?key=none`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(`Shadertoy API returned status ${res.status}`)
    }
    const data = await res.json()
    const renderPass = data.Shader?.renderpass?.find((p: any) => p.type === "image")
    if (!renderPass || !renderPass.code) {
      throw new Error("No image render pass found in Shadertoy response.")
    }
    return renderPass.code
  } catch (err: any) {
    throw new Error(
      `Unable to fetch directly from Shadertoy (${err.message}). Please paste the GLSL mainImage code directly.`
    )
  }
}

/**
 * Creates a complete ShaderStudio ProjectData structure from Shadertoy GLSL code.
 */
export function createProjectFromShadertoy(
  code: string,
  projectName = "Shadertoy Import"
): ProjectData {
  const { convertedSource } = importShadertoy(code)

  const defaultVert = `#version 300 es
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

  return {
    name: projectName,
    version: "1.0",
    backend: "webgl2",
    graphNodes: [
      {
        id: "mesh_1",
        type: "mesh",
        position: { x: 100, y: 150 },
        data: { type: "mesh", geometry: "plane" },
      },
      {
        id: "mat_1",
        type: "material",
        position: { x: 350, y: 150 },
        data: { type: "material", shaderPath: "shadertoy.glsl" },
      },
      {
        id: "time_1",
        type: "time",
        position: { x: 100, y: 300 },
        data: { type: "time" },
      },
    ],
    graphEdges: [
      { id: "e1", source: "mesh_1", target: "mat_1", sourceHandle: "out", targetHandle: "in" },
      { id: "e2", source: "time_1", target: "mat_1", sourceHandle: "out", targetHandle: "in" },
    ],
    uniformValues: {
      u_time: { type: "float", value: 0 },
      u_delta: { type: "float", value: 0.016 },
      u_frame: { type: "int", value: 0 },
      u_resolution: { type: "vec2", value: [1920, 1080] },
      u_mouse: { type: "vec4", value: [0, 0, 0, 0] },
    },
    graphUniforms: [],
    shaderSources: {
      glsl: convertedSource,
      vertex: defaultVert,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
