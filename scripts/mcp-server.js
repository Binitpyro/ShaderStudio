#!/usr/bin/env node
/**
 * Shader Studio MCP Server (Model Context Protocol)
 * Allows Cursor, Claude Desktop, Antigravity, and Windsurf agents to
 * compile, visually inspect, and iterate on WebGPU/WebGL shaders in real-time.
 */
import { createInterface } from "readline"
import TEMPLATES_CATALOG from "../src/core/templatesData.json" with { type: "json" }
import { transpileToUnityHLSL, transpileToGodotShader, transpileToShadertoy } from "../src/core/engineTranspiler.ts"

const BRIDGE_BASE_URL = process.env.SHADER_STUDIO_URL || "http://localhost:8642"

async function postJson(endpoint, data) {
  const res = await fetch(`${BRIDGE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Bridge returned HTTP ${res.status}: ${errText}`)
  }
  return res.json()
}

async function getJson(endpoint) {
  const res = await fetch(`${BRIDGE_BASE_URL}${endpoint}`)
  if (!res.ok) throw new Error(`Bridge returned HTTP ${res.status}`)
  return res.json()
}

const TOOLS = [
  {
    name: "render_shader",
    description: "Compile and render a WebGPU (WGSL), WebGL2 (GLSL), or Three.js shader in Shader Studio, returning compiler diagnostics and a high-resolution canvas snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Full shader source code (.wgsl or .glsl).",
        },
        backend: {
          type: "string",
          enum: ["webgpu", "webgl2", "threejs"],
          description: "Graphics backend to compile and render with (default: webgpu).",
        },
        uniforms: {
          type: "object",
          description: "Key-value pairs of uniform values to update (e.g. { u_speed: 1.5, u_color: [1, 0, 0] }).",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "get_viewport_snapshot",
    description: "Capture the current rendered frame from the Shader Studio canvas as a base64 image.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number", description: "Optional image width in pixels." },
        height: { type: "number", description: "Optional image height in pixels." },
      },
    },
  },
  {
    name: "get_bridge_status",
    description: "Check whether Shader Studio is running and connected in the browser.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_templates",
    description: "List all built-in curated production shader templates in Shader Studio (Holographic Energy Shield, Boiling Solar Plasma Orb, Cyberpunk Synthwave Grid, Liquid Chrome Iridescence, Tropical Ocean Caustics, Cosmic Nebula).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "load_template",
    description: "Load a curated production shader template by ID into the active Shader Studio instance and render it, returning a frame snapshot and active uniforms.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          enum: [
            "holographic-shield",
            "solar-plasma-orb",
            "synthwave-grid",
            "liquid-metal-iridescence",
            "ocean-caustics",
            "cosmic-nebula",
          ],
          description: "ID of the curated shader template to load.",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "transpile_shader",
    description: "Transpile a GLSL fragment shader into commercial game engine code: Unity URP ShaderLab/HLSL (.shader), Godot 4 Spatial (.gdshader), or Shadertoy GLSL.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "GLSL fragment shader source code to transpile.",
        },
        target: {
          type: "string",
          enum: ["unity", "godot", "shadertoy"],
          description: "Target game engine or platform format.",
        },
        shaderName: {
          type: "string",
          description: "Optional shader name (e.g. 'Custom/PlasmaShield').",
        },
        uniforms: {
          type: "object",
          description: "Optional dictionary of uniform values with { type, value }.",
        },
      },
      required: ["source", "target"],
    },
  },
]

async function handleToolCall(name, args) {
  if (name === "get_bridge_status") {
    try {
      const status = await getJson("/api/status")
      return {
        content: [
          {
            type: "text",
            text: `Shader Studio is online. Browser clients connected: ${status.browserClients}. Watched directory: ${status.watchedDirectory || "None"}.`,
          },
        ],
      }
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Shader Studio Bridge is offline. Make sure to run 'npm run bridge' and open http://localhost:5173. Error: ${e.message}`,
          },
        ],
      }
    }
  }

  if (name === "render_shader") {
    try {
      const result = await postJson("/api/agent/execute", {
        source: args.source,
        backend: args.backend || "webgpu",
        uniforms: args.uniforms,
        captureSnapshot: true,
      })

      const content = []

      if (result.status === "success") {
        content.push({
          type: "text",
          text: `✅ Shader compiled successfully on ${result.backend.toUpperCase()} in ${result.executionTimeMs}ms. FPS: ${result.perf?.fps || 60}. Active uniforms: ${(result.activeUniforms || []).join(", ") || "None"}.`,
        })

        if (result.screenshotBase64) {
          const cleanBase64 = result.screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, "")
          content.push({
            type: "image",
            data: cleanBase64,
            mimeType: "image/png",
          })
        }
      } else {
        const errorLines = (result.errors || []).map((e) =>
          e.line ? `Line ${e.line}:${e.column || 0}: ${e.message}` : e.message
        )
        content.push({
          type: "text",
          text: `❌ Compilation failed:\n${errorLines.join("\n")}`,
        })
      }

      return {
        isError: result.status !== "success",
        content,
      }
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Execution failed: ${e.message}` }],
      }
    }
  }

  if (name === "get_viewport_snapshot") {
    try {
      const result = await postJson("/api/agent/capture", {
        snapshotOptions: { width: args.width, height: args.height },
      })

      const content = []
      if (result.screenshotBase64) {
        const cleanBase64 = result.screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, "")
        content.push({
          type: "image",
          data: cleanBase64,
          mimeType: "image/png",
        })
      } else {
        content.push({ type: "text", text: "No canvas frame available." })
      }

      return { content }
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Capture failed: ${e.message}` }],
      }
    }
  }

  if (name === "list_templates") {
    const summary = TEMPLATES_CATALOG.map((t) => `- **${t.name}** (\`${t.id}\`): ${t.description} [${t.category}, ${t.geometry}]`).join("\n")
    return {
      content: [
        {
          type: "text",
          text: `Available Shader Studio Production Templates:\n\n${summary}\n\nUse load_template with the templateId to load and render any template.`,
        },
      ],
    }
  }

  if (name === "load_template") {
    const tmpl = TEMPLATES_CATALOG.find((t) => t.id === args.templateId)
    if (!tmpl) {
      return {
        isError: true,
        content: [{ type: "text", text: `Template not found: '${args.templateId}'. Call list_templates to see valid IDs.` }],
      }
    }

    try {
      const result = await postJson("/api/agent/execute", {
        source: tmpl.shaderSource,
        backend: tmpl.backend,
        uniforms: tmpl.uniforms,
        captureSnapshot: true,
      })

      const content = []
      content.push({
        type: "text",
        text: `✅ Loaded template "${tmpl.name}" (${tmpl.category}) on ${tmpl.backend.toUpperCase()}. Geometry: ${tmpl.geometry}.`,
      })

      if (result.screenshotBase64) {
        const cleanBase64 = result.screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, "")
        content.push({
          type: "image",
          data: cleanBase64,
          mimeType: "image/png",
        })
      }

      return {
        isError: result.status !== "success",
        content,
      }
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to load template: ${e.message}` }],
      }
    }
  }

  if (name === "transpile_shader") {
    try {
      let code = ""
      const target = args.target
      const shaderName = args.shaderName || "Custom/GeneratedShader"
      const uniformValues = args.uniforms || {}

      if (target === "unity") {
        code = transpileToUnityHLSL({ shaderName, shaderSource: args.source, uniformValues })
      } else if (target === "godot") {
        code = transpileToGodotShader({ shaderSource: args.source, uniformValues })
      } else if (target === "shadertoy") {
        code = transpileToShadertoy({ shaderSource: args.source })
      } else {
        throw new Error(`Unsupported target: '${target}'. Choose 'unity', 'godot', or 'shadertoy'.`)
      }

      return {
        content: [
          {
            type: "text",
            text: `// Transpiled to ${target.toUpperCase()} via Shader Studio\n\n${code}`,
          },
        ],
      }
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Transpilation failed: ${e.message}` }],
      }
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}

// JSON-RPC 2.0 stdio transport
const rl = createInterface({ input: process.stdin, terminal: false })

rl.on("line", async (line) => {
  if (!line.trim()) return
  try {
    const req = JSON.parse(line)
    const { id, method, params } = req

    if (method === "initialize") {
      const response = {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "shader-studio-mcp", version: "1.0.0" },
        },
      }
      process.stdout.write(JSON.stringify(response) + "\n")
      return
    }

    if (method === "notifications/initialized") {
      return
    }

    if (method === "tools/list") {
      const response = {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      }
      process.stdout.write(JSON.stringify(response) + "\n")
      return
    }

    if (method === "tools/call") {
      const toolResult = await handleToolCall(params?.name, params?.arguments || {})
      const response = {
        jsonrpc: "2.0",
        id,
        result: toolResult,
      }
      process.stdout.write(JSON.stringify(response) + "\n")
      return
    }

    // Default response for unhandled methods
    if (id !== undefined) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }) + "\n"
      )
    }
  } catch (err) {
    process.stderr.write(`Error processing line: ${err.message}\n`)
  }
})
