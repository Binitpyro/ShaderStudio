import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { createInterface } from "readline"
import { resolve, join } from "path"
import { tmpdir } from "os"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { pathToFileURL } from "url"
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
  let loaderDir: string
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
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await rpc("tools/call", { name, arguments: args })).result

  beforeAll(async () => {
    bridge = createBridgeServer({ port: 0, token: TOKEN, quiet: true })
    const port = await bridge.listen(0)

    // Fake Shader Studio browser tab that answers agent RPCs.
    browser = new WebSocket(`ws://127.0.0.1:${port}?token=${TOKEN}`)
    browser.on("message", (raw) => {
      const msg = JSON.parse(raw.toString())
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

    // Plain node cannot resolve the extensionless / "@/" imports inside src/core (see it.fails below), so the
    // handlers are exercised through a tiny resolve hook that maps them onto src/*.ts.
    loaderDir = mkdtempSync(join(tmpdir(), "ss-mcp-"))
    const src = pathToFileURL(resolve(process.cwd(), "src")).href
    writeFileSync(
      join(loaderDir, "hooks.mjs"),
      `const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"]
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (e) {
    const target = spec.startsWith("@/") ? ${JSON.stringify(src)} + "/" + spec.slice(2)
      : spec.startsWith(".") ? new URL(spec, ctx.parentURL).href : null
    if (target) for (const x of EXT) { try { return await next(target + x, ctx) } catch {} }
    throw e
  }
}
`
    )
    writeFileSync(
      join(loaderDir, "register.mjs"),
      `import { register } from "node:module"
register(${JSON.stringify(pathToFileURL(join(loaderDir, "hooks.mjs")).href)})
`
    )
    child = spawn(process.execPath, ["--import", pathToFileURL(join(loaderDir, "register.mjs")).href, resolve(process.cwd(), "scripts/mcp-server.js")], {
      env: { ...process.env, SHADER_STUDIO_URL: `http://127.0.0.1:${port}` },
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
    rmSync(loaderDir, { recursive: true, force: true })
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

  it("get_bridge_status reports the connected browser (public endpoint, no token needed)", async () => {
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

  it("transpile_shader handles unity, godot and shadertoy, and rejects other targets", async () => {
    const source = "void main() { gl_FragColor = vec4(1.0); }"
    expect((await call("transpile_shader", { source, target: "unity" })).content[0].text).toContain("Shader ")
    expect((await call("transpile_shader", { source, target: "godot" })).content[0].text).toContain("shader_type spatial;")
    expect((await call("transpile_shader", { source, target: "shadertoy" })).content[0].text).toContain("mainImage")
    const bad = await call("transpile_shader", { source, target: "unreal" })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain("Unsupported target")
  })

  // fleet: fixed in W6 (mcp-server.js postJson sends no bridge Authorization header -> bridge returns 401)
  it.fails("MCP tool calls authenticate to the bridge", async () => {
    const render = await call("render_shader", { source: "void main(){}" })
    expect(render.isError).toBe(false)
    expect(render.content[0].text).toContain("compiled successfully")
    const snap = await call("get_viewport_snapshot")
    expect(snap.isError).toBeUndefined()
    expect(snap.content[0].type).toBe("image")
  })

  // fleet: fixed in W6 (src/core/engineTranspiler.ts imports "./gltfExporter" without an extension, so `npm run mcp` dies with ERR_MODULE_NOT_FOUND)
  it.fails("npm run mcp starts under plain node", async () => {
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
