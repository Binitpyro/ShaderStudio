import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { createInterface } from "readline"
import { resolve, join } from "path"
import { tmpdir } from "os"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { WebSocket } from "ws"
// @ts-expect-error -- untyped JS script
import { createBridgeServer } from "../../../scripts/bridge.js"
import { SHADER_TEMPLATES } from "@/core/templates"
import { transpileToUnityHLSL, transpileToGodotShader, transpileToShadertoy } from "@/core/engineTranspiler"

describe("MCP Server Engine & Catalog", () => {
  it("provides all curated production templates with full metadata", () => {
    expect(SHADER_TEMPLATES.length).toBeGreaterThanOrEqual(6)
    const ids = SHADER_TEMPLATES.map((t) => t.id)
    expect(ids).toContain("holographic-shield")
    expect(ids).toContain("solar-plasma-orb")
    expect(ids).toContain("synthwave-grid")
    expect(ids).toContain("liquid-metal-iridescence")
    expect(ids).toContain("ocean-caustics")
    expect(ids).toContain("cosmic-nebula")

    for (const tmpl of SHADER_TEMPLATES) {
      expect(tmpl.name).toBeTruthy()
      expect(tmpl.shaderSource).toBeTruthy()
      expect(tmpl.geometry).toBeTruthy()
      expect(tmpl.backend).toBe("threejs")
      expect(Object.keys(tmpl.uniforms).length).toBeGreaterThan(0)
    }
  })

  it("transpiles GLSL to Unity URP HLSL through engine transpiler", () => {
    const code = transpileToUnityHLSL({
      shaderName: "Custom/Plasma",
      shaderSource: "void main() { vec3 c = u_color * sin(u_time); gl_FragColor = vec4(c, 1.0); }",
      parsedUniforms: [
        { name: "u_color", type: "vec3f", kind: "color" },
      ],
      uniformValues: {
        u_color: { type: "vec3", value: [1, 0, 0] },
      },
    })
    expect(code).toContain('Shader "Custom/Plasma"')
    expect(code).toContain("CBUFFER_START(UnityPerMaterial)")
    expect(code).toContain("_Time.y")
    expect(code).toContain("SV_Target")
  })

  it("transpiles GLSL to Godot 4 Spatial Shader through Node transpiler", () => {
    const code = transpileToGodotShader({
      shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; }",
      parsedUniforms: [
        { name: "u_speed", type: "f32", kind: "scalar" },
      ],
      uniformValues: {
        u_speed: { type: "float", value: 2.0 },
      },
    })
    expect(code).toContain("shader_type spatial;")
    expect(code).toContain("uniform float u_speed = 2;")
    expect(code).toContain("VIEWPORT_SIZE")
    expect(code).toContain("FRAGCOORD")
  })

  it("transpiles GLSL to Shadertoy format through Node transpiler", () => {
    const code = transpileToShadertoy({
      shaderSource: "void main() { vec2 uv = gl_FragCoord.xy / u_resolution.xy; }",
      parsedUniforms: [],
      uniformValues: {},
    })
    expect(code).toContain("void mainImage( out vec4 fragColor, in vec2 fragCoord )")
    expect(code).toContain("iResolution.xy")
  })
})

describe("scripts/mcp-server.js over stdio JSON-RPC (real process, real bridge)", () => {
  const TOKEN = "mcp-test-token-0123456789abcdef0123456789abcdef"
  let bridge: ReturnType<typeof createBridgeServer>
  let browser: WebSocket
  let child: ChildProcessWithoutNullStreams
  let bridgePort = 0
  let nextId = 1
  const pending = new Map<number, (msg: any) => void>()

  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((done, fail) => {
      const id = nextId++
      const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out`)), 15000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        done(msg)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const executed: Array<{ source?: string }> = []
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await rpc("tools/call", { name, arguments: args })).result

  beforeAll(async () => {
    bridge = createBridgeServer({ port: 0, token: TOKEN, quiet: true })
    const port = (bridgePort = await bridge.listen(0))

    // Fake Shader Studio browser tab that answers agent RPCs.
    browser = new WebSocket(`ws://127.0.0.1:${port}?token=${TOKEN}`)
    browser.on("message", (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === "agent:execute") executed.push(msg)
      if (msg.type === "agent:execute" || msg.type === "agent:capture") {
        browser.send(
          JSON.stringify({
            type: "agent:feedback",
            id: msg.id,
            status: "success",
            backend: msg.backend ?? "webgpu",
            executionTimeMs: 3,
            errors: [],
            activeUniforms: ["u_time"],
            screenshotBase64: "data:image/png;base64,AAAA",
          })
        )
      }
    })
    await new Promise((r) => browser.once("open", r))

    // Plain `node scripts/mcp-server.js`, exactly what `npm run mcp` runs: no loader flags.
    child = spawn(process.execPath, [resolve(process.cwd(), "scripts/mcp-server.js")], {
      env: { ...process.env, SHADER_STUDIO_URL: `http://127.0.0.1:${port}`, SHADER_STUDIO_BRIDGE_TOKEN: TOKEN },
      stdio: ["pipe", "pipe", "pipe"],
    })
    createInterface({ input: child.stdout }).on("line", (line) => {
      const msg = JSON.parse(line)
      pending.get(msg.id)?.(msg)
      pending.delete(msg.id)
    })
  })

  afterAll(async () => {
    child?.kill()
    browser?.terminate()
    await bridge?.close()
  })

  it("initializes with protocol version and tools capability", async () => {
    const { result } = await rpc("initialize")
    expect(result.protocolVersion).toBe("2024-11-05")
    expect(result.capabilities).toEqual({ tools: {} })
    expect(result.serverInfo.name).toBe("shader-studio-mcp")
  })

  it("tools/list advertises the six tools with schemas", async () => {
    const { result } = await rpc("tools/list")
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      "render_shader",
      "get_viewport_snapshot",
      "get_bridge_status",
      "list_templates",
      "load_template",
      "transpile_shader",
    ])
    for (const t of result.tools) expect(t.inputSchema.type).toBe("object")
  })

  it("answers unknown methods with JSON-RPC -32601", async () => {
    const msg = await rpc("resources/list")
    expect(msg.error.code).toBe(-32601)
  })

  it("get_bridge_status reports the connected browser (authenticated)", async () => {
    const result = await call("get_bridge_status")
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("Browser clients connected: 1")
  })

  it("list_templates lists every curated template", async () => {
    const result = await call("list_templates")
    for (const t of SHADER_TEMPLATES) expect(result.content[0].text).toContain(t.id)
  })

  it("load_template rejects unknown ids locally", async () => {
    const result = await call("load_template", { templateId: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Template not found")
  })

  it("load_template sends the joined GLSL source, and explains graph-only SDF templates", async () => {
    const mesh = SHADER_TEMPLATES.find((t) => !t.graph)!
    const ok = await call("load_template", { templateId: mesh.id })
    expect(ok.isError).toBe(false)
    expect(executed.at(-1)?.source).toBe(mesh.glsl)
    expect(executed.at(-1)?.source).not.toContain("undefined")

    const sdf = SHADER_TEMPLATES.find((t) => t.graph)!
    const before = executed.length
    const msg = await call("load_template", { templateId: sdf.id })
    expect(msg.isError).toBe(true)
    expect(msg.content[0].text).toContain("graph-based")
    expect(executed.length).toBe(before)
  })

  it("transpile_shader handles unity, godot and shadertoy, and rejects other targets", async () => {
    const source = "void main() { gl_FragColor = vec4(1.0); }"
    expect((await call("transpile_shader", { source, target: "unity" })).content[0].text).toContain("Shader ")
    expect((await call("transpile_shader", { source, target: "godot" })).content[0].text).toContain("shader_type spatial;")
    expect((await call("transpile_shader", { source, target: "shadertoy" })).content[0].text).toContain("mainImage")
    const bad = await call("transpile_shader", { source, target: "unreal" })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain("Unsupported target")
  })

  it("MCP tool calls authenticate to the bridge", async () => {
    const render = await call("render_shader", { source: "void main(){}" })
    expect(render.isError).toBe(false)
    expect(render.content[0].text).toContain("compiled successfully")
    const snap = await call("get_viewport_snapshot")
    expect(snap.isError).toBeUndefined()
    expect(snap.content[0].type).toBe("image")
  })

  it("replies to unknown tools and thrown errors with JSON-RPC error objects", async () => {
    const unknown = await rpc("tools/call", { name: "no_such_tool", arguments: {} })
    expect(unknown.error.code).toBe(-32602)
    expect(unknown.error.message).toContain("Unknown tool")
  })

  it("load_template enum lists only templates with stored shader source (graph-only SDF ones are left out)", async () => {
    const { result } = await rpc("tools/list")
    const tool = result.tools.find((t: { name: string }) => t.name === "load_template")
    const loadable = SHADER_TEMPLATES.filter((t) => !t.graph).map((t) => t.id)
    const graphOnly = SHADER_TEMPLATES.filter((t) => t.graph).map((t) => t.id)
    expect(graphOnly.length).toBeGreaterThan(0)
    expect(tool.inputSchema.properties.templateId.enum).toEqual(loadable)
    for (const id of graphOnly) expect(tool.inputSchema.properties.templateId.enum).not.toContain(id)
    expect(tool.inputSchema.properties.templateId.enum.length).toBeGreaterThan(6)
  })

  it("rejects calls with a wrong token (no silent success)", async () => {
    const bad = spawn(process.execPath, [resolve(process.cwd(), "scripts/mcp-server.js")], {
      env: { ...process.env, SHADER_STUDIO_URL: `http://127.0.0.1:${bridgePort}`, SHADER_STUDIO_BRIDGE_TOKEN: "wrong-token", SHADER_STUDIO_TOKEN_FILE: join(tmpdir(), "ss-no-such-token-file") },
      stdio: ["pipe", "pipe", "pipe"],
    })
    try {
      const reply = await new Promise<any>((done) => {
        createInterface({ input: bad.stdout }).once("line", (l) => done(JSON.parse(l)))
        bad.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_bridge_status", arguments: {} } }) + "\n")
      })
      expect(reply.result.isError).toBe(true)
      expect(reply.result.content[0].text).toContain("403")
    } finally {
      bad.kill()
    }
  })

  it("reads the token from the token file the bridge writes when no env var is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ss-token-"))
    const file = join(dir, "bridge-token")
    writeFileSync(file, TOKEN + "\n")
    const env: NodeJS.ProcessEnv = { ...process.env, SHADER_STUDIO_URL: `http://127.0.0.1:${bridgePort}`, SHADER_STUDIO_TOKEN_FILE: file }
    delete env.SHADER_STUDIO_BRIDGE_TOKEN
    const viaFile = spawn(process.execPath, [resolve(process.cwd(), "scripts/mcp-server.js")], { env, stdio: ["pipe", "pipe", "pipe"] })
    try {
      const reply = await new Promise<any>((done) => {
        createInterface({ input: viaFile.stdout }).once("line", (l) => done(JSON.parse(l)))
        viaFile.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_bridge_status", arguments: {} } }) + "\n")
      })
      expect(reply.result.isError).toBeUndefined()
    } finally {
      viaFile.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("npm run mcp starts under plain node", async () => {
    const plain = spawn(process.execPath, [resolve(process.cwd(), "scripts/mcp-server.js")], { stdio: ["pipe", "pipe", "pipe"] })
    try {
      const reply = await new Promise<string | null>((done) => {
        const timer = setTimeout(() => done(null), 8000)
        plain.stdout.once("data", (d) => {
          clearTimeout(timer)
          done(String(d))
        })
        plain.once("exit", () => {
          clearTimeout(timer)
          done(null)
        })
        plain.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n")
      })
      expect(reply).toContain("shader-studio-mcp")
    } finally {
      plain.kill()
    }
  })
})
