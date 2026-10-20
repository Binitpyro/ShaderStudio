import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WebSocket } from "ws"
import { join } from "path"
import { tmpdir } from "os"
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs"
import {
  isAllowedOrigin,
  isSafePath,
  isTokenValid,
  extractToken,
  isAllowedAiUrl,
  createBridgeServer,
  computeHandshakeProof,
} from "../../scripts/bridge.js"
import { verifyBridgeProof } from "@/bridge/bridgeProtocol"
import {
  getBridgeToken,
  setBridgeToken,
  getBridgeApiHeaders,
  getBridgeHttpUrl,
} from "@/bridge/wsBridgeClient"

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"
const SHADER = "@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }"

const wsClose = (url: string, opts?: ConstructorParameters<typeof WebSocket>[1]) =>
  new Promise<number>((done) => {
    const ws = new WebSocket(url, opts)
    ws.on("close", (c) => done(c))
    ws.on("error", () => {})
  })

const wsOpens = (url: string, opts?: ConstructorParameters<typeof WebSocket>[1]) =>
  new Promise<boolean>((done) => {
    const ws = new WebSocket(url, opts)
    ws.on("open", () => {
      ws.close()
      done(true)
    })
    ws.on("close", () => done(false))
    ws.on("error", () => done(false))
  })

const wsUpgradeStatus = (url: string, origin: string) =>
  new Promise<number | null>((done) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } })
    ws.on("open", () => {
      ws.close()
      done(null)
    })
    ws.on("error", (err: Error) => {
      const m = err.message.match(/(\d{3})/)
      done(m ? parseInt(m[1], 10) : null)
    })
  })

async function waitUntil(cond: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition")
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe("Local bridge RPC security (scripts/bridge.js)", () => {
  let base: string
  let root: string
  let bridge: ReturnType<typeof createBridgeServer>
  let baseUrl: string
  let wsUrl: string
  let symlinkCreated = false

  const auth = { Authorization: `Bearer ${SECRET}` }
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), "ss-bridge-"))
    root = join(base, "root")
    const outside = join(base, "outside")
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(root, "sample.wgsl"), SHADER)
    writeFileSync(join(outside, "secret.txt"), "TOP_SECRET_CONTENT_DO_NOT_LEAK")
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "symlink_escape.txt"), "file")
      symlinkCreated = true
    } catch {
      symlinkCreated = false // needs privileges on Windows
    }
    bridge = createBridgeServer({ port: 0, token: SECRET, directory: root, quiet: true })
    const port = await bridge.listen(0)
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await bridge?.close()
    rmSync(base, { recursive: true, force: true })
    setBridgeToken(null)
  })

  describe("CORS origin validation", () => {
    it("allows Vite dev/preview origins and arbitrary local ports", () => {
      for (const o of [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
        "https://localhost:8443",
        "http://localhost",
        "http://127.0.0.1",
      ]) {
        expect(isAllowedOrigin(o)).toBe(true)
      }
    })

    it("honours extraOrigins and SHADER_STUDIO_ALLOWED_ORIGIN", () => {
      expect(isAllowedOrigin("https://studio.example.com")).toBe(false)
      expect(isAllowedOrigin("https://studio.example.com", ["https://studio.example.com"])).toBe(true)
      process.env.SHADER_STUDIO_ALLOWED_ORIGIN = "https://env.example.com"
      try {
        expect(isAllowedOrigin("https://env.example.com")).toBe(true)
      } finally {
        delete process.env.SHADER_STUDIO_ALLOWED_ORIGIN
      }
    })

    const hostile = [
      "null",
      "",
      "https://evil-attacker.com",
      "http://localhost.evil.com",
      "https://localhost.evil.com",
      "http://evil.com/localhost",
      "http://127.0.0.1.attacker.com",
      "http://127.0.0.1:5173.attacker.com",
      "http://attacker.com:5173",
      "http://localhost@attacker.com",
      "http://attacker.com#localhost",
      "http://attacker.com?localhost",
      "ftp://localhost:5173",
      "file://localhost:5173",
      "ws://localhost:5173",
      "wss://localhost:5173",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://0.0.0.0:5173",
      "http://[::1]:5173",
      "http://2130706433:5173",
      "http://0177.0.0.1:5173",
      "http://localhost:5173/",
      "http://localhost:5173/api",
    ]

    it("rejects spoofed, malformed, and non-http origins (and non-string input)", () => {
      for (const o of hostile) expect(isAllowedOrigin(o), o).toBe(false)
      expect(isAllowedOrigin(null as unknown as string)).toBe(false)
      expect(isAllowedOrigin(undefined as unknown as string)).toBe(false)
    })

    it("answers 403 on OPTIONS / GET / POST for every hostile origin, without CORS headers", async () => {
      for (const origin of hostile.filter((o) => o)) {
        for (const [method, path] of [
          ["OPTIONS", "/api/agent/execute"],
          ["GET", "/api/status"],
          ["POST", "/api/agent/execute"],
        ] as const) {
          const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { Origin: origin, ...auth, "Content-Type": "application/json" },
            body: method === "POST" ? JSON.stringify({ source: "x" }) : undefined,
          })
          expect(res.status, `${method} ${origin}`).toBe(403)
          expect(await res.json()).toEqual({ error: "Forbidden: CORS origin not allowed" })
          expect(res.headers.get("access-control-allow-origin")).toBeNull()
        }
      }
    })

    it("answers 204 with reflected CORS headers for an allowed-origin preflight", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, Authorization, X-Bridge-Token",
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
      expect(res.headers.get("vary")).toBe("Origin")
      expect(res.headers.get("access-control-allow-headers")).toContain("Authorization")
      expect(res.headers.get("access-control-allow-headers")).toContain("X-Bridge-Token")
      expect(res.headers.get("access-control-allow-methods")).toContain("POST")
    })

    it("lets originless (CLI/MCP) requests through without CORS headers", async () => {
      const res = await fetch(`${baseUrl}/api/status`, { headers: auth })
      expect(res.status).toBe(200)
      expect(res.headers.get("access-control-allow-origin")).toBeNull()
      expect(await res.json()).toMatchObject({ status: "online", browserClients: 0, agentClients: 0 })
    })
  })

  describe("path traversal sanitisation", () => {
    it("isSafePath accepts normalised in-root paths", () => {
      for (const p of ["sample.wgsl", "./sample.wgsl", "sub/file.glsl", "sub/nested/../file.glsl", "a/../sample.wgsl"]) {
        expect(isSafePath(p, root), p).toBe(true)
      }
    })

    const malicious = [
      "../package.json",
      "..\\package.json",
      "../../etc/passwd",
      "..\\..\\..\\Windows\\win.ini",
      "nested/../../package.json",
      "nested\\..\\..\\package.json",
      "./../../package.json",
      ".\\..\\..\\package.json",
      "..//..//package.json",
      "..\\\\..\\\\package.json",
      "../..",
      "sub/../../outside.txt",
      "../../../../../../../../../../../windows/system.ini",
      "src/..\\../outside.txt",
      "a/../../b/../../c/../../etc/passwd",
      "sample.wgsl\0.png",
      "sample.wgsl\0/../../package.json",
      "\0/etc/passwd",
      "sub/\0/file.wgsl",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      "C:/Windows/win.ini",
      "D:\\unauthorized.txt",
      "/etc/passwd",
      "\\\\127.0.0.1\\c$\\Windows\\win.ini",
      "../outside/secret.txt",
      "..\\outside\\secret.txt",
      "../../nonexistent_outside_file_98765.txt",
    ]

    it("isSafePath rejects traversal, null-byte and absolute-path escapes", () => {
      for (const p of malicious) expect(isSafePath(p, root), JSON.stringify(p)).toBe(false)
      expect(isSafePath("", root)).toBe(false)
      expect(isSafePath(null as unknown as string, root)).toBe(false)
      expect(isSafePath(undefined as unknown as string, root)).toBe(false)
      expect(isSafePath("sample.wgsl", "")).toBe(false)
    })

    it("GET /api/file answers 403 for every escape, without leaking filesystem paths", async () => {
      for (const p of malicious) {
        const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(p)}`, { headers: auth })
        expect(res.status, JSON.stringify(p)).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: path escapes root boundary" })
        const raw = JSON.stringify(body)
        expect(raw).not.toContain(root)
        expect(raw).not.toContain("C:\\")
      }
    })

    it("decodes raw percent-encoded traversal before checking (and never serves 200)", async () => {
      for (const enc of [
        "%2e%2e/package.json",
        "%2e%2e%2fpackage.json",
        "%2e%2e%5cpackage.json",
        "..%2fpackage.json",
        "..%5cpackage.json",
        "%2e%2e/%2e%2e/package.json",
        "..%2f..%2fpackage.json",
      ]) {
        const res = await fetch(`${baseUrl}/api/file?path=${enc}`, { headers: auth })
        expect(res.status, enc).toBe(403)
        expect(await res.json()).toEqual({ error: "Forbidden: path escapes root boundary" })
      }
      // double-encoded decodes to a literal "%2e%2e" name inside root -> missing, never package.json
      const res = await fetch(`${baseUrl}/api/file?path=%252e%252e/package.json`, { headers: auth })
      expect(res.status).not.toBe(200)
      expect(await res.text()).not.toContain("shader-studio")
    })

    it("blocks symlink breakout when a symlink can be created", async () => {
      if (!symlinkCreated) return
      expect(isSafePath("symlink_escape.txt", root)).toBe(false)
      const res = await fetch(`${baseUrl}/api/file?path=symlink_escape.txt`, { headers: auth })
      expect(res.status).toBe(403)
      expect(JSON.stringify(await res.json())).not.toContain("TOP_SECRET_CONTENT_DO_NOT_LEAK")
    })

    it("serves in-root files, 404s missing ones, and 400s a missing path param", async () => {
      const ok = await fetch(`${baseUrl}/api/file?path=sample.wgsl`, { headers: auth })
      expect(ok.status).toBe(200)
      expect(await ok.text()).toContain("@fragment fn main()")
      expect((await fetch(`${baseUrl}/api/file?path=missing.wgsl`, { headers: auth })).status).toBe(404)
      expect((await fetch(`${baseUrl}/api/file`, { headers: auth })).status).toBe(400)
    })

    it("rejects an agent execute payload with an out-of-bounds path", async () => {
      const res = await post("/api/agent/execute", { source: "fn main() {}", path: "../../secret.ts" }, auth)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: "Forbidden: path escapes root boundary" })
    })
  })

  describe("token generation and validation", () => {
    it("generates a 48-char hex token by default and honours an explicit one", () => {
      const eph = createBridgeServer({ port: 0, quiet: true })
      expect(eph.token).toMatch(/^[0-9a-f]{48}$/i)
      expect(createBridgeServer({ port: 0, token: "custom-secret", quiet: true }).token).toBe("custom-secret")
    })

    it("listen() rejects (instead of exiting the process) when the port is taken", async () => {
      const taken = createBridgeServer({ port: 0, token: SECRET, quiet: true })
      const port = await taken.listen(0)
      try {
        await expect(createBridgeServer({ port, token: SECRET, quiet: true }).listen(port)).rejects.toMatchObject({ code: "EADDRINUSE" })
      } finally {
        await taken.close()
      }
    })

    it("isTokenValid accepts only the exact token and never throws on odd input", () => {
      expect(isTokenValid(SECRET, SECRET)).toBe(true)
      for (const bad of [
        "",
        " ",
        "a",
        SECRET.slice(0, 47),
        SECRET + "x",
        SECRET.repeat(2),
        "x".repeat(10000),
        "x" + SECRET.slice(1),
        SECRET.slice(0, -1) + "0",
        SECRET.slice(0, 10) + "\0" + SECRET.slice(11),
        "\u{1F525}".repeat(12),
        null,
        undefined,
        12345,
        {},
        [],
        true,
      ]) {
        expect(isTokenValid(bad as unknown as string, SECRET)).toBe(false)
      }
      expect(isTokenValid(SECRET, null as unknown as string)).toBe(false)
      expect(isTokenValid(SECRET, "")).toBe(false)
      const emoji = "\u{1F525}".repeat(12)
      expect(isTokenValid(emoji, emoji)).toBe(true)
    })

    it("compares mismatches in comparable time regardless of mismatch position", () => {
      const first = "a" + SECRET.slice(1)
      const last = SECRET.slice(0, -1) + "a"
      for (let i = 0; i < 1000; i++) {
        isTokenValid(first, SECRET)
        isTokenValid(last, SECRET)
      }
      // best-of-7 per candidate so a scheduler hiccup on a loaded machine does not skew the ratio
      const time = (t: string) =>
        Math.min(
          ...Array.from({ length: 7 }, () => {
            const s0 = performance.now()
            for (let i = 0; i < 5000; i++) isTokenValid(t, SECRET)
            return performance.now() - s0
          })
        )
      const a = time(first)
      const b = time(last)
      expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(3.5)
    })

    it("extractToken reads Bearer, raw Authorization, X-Bridge-Token and ?token=", () => {
      expect(extractToken({ headers: { authorization: "Bearer my-token-123" } } as never, null)).toBe("my-token-123")
      expect(extractToken({ headers: { authorization: `Bearer   ${SECRET}  ` } } as never, null)).toBe(SECRET)
      expect(extractToken({ headers: { authorization: "raw-token-456" } } as never, null)).toBe("raw-token-456")
      expect(extractToken({ headers: { "x-bridge-token": "custom-bridge-token" } } as never, null)).toBe("custom-bridge-token")
      expect(extractToken({} as never, new URL("http://localhost:8642/x?token=query-token"))).toBe("query-token")
      expect(extractToken({ headers: {} } as never, new URL("http://localhost:8642"))).toBeNull()
    })
  })

  describe("mandatory auth on HTTP endpoints", () => {
    const protectedEndpoints = ["/api/agent/execute", "/api/agent/capture", "/api/ai/proxy"]
    const tampered = SECRET.slice(0, -1) + (SECRET.endsWith("f") ? "e" : "f")
    const isFile = (ep: string) => ep.startsWith("/api/file")
    const call = (ep: string, headers: Record<string, string>, suffix = "") =>
      fetch(`${baseUrl}${ep}${suffix}`, {
        method: isFile(ep) ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: isFile(ep) ? undefined : JSON.stringify({ source: "void main(){}" }),
      })

    it("answers 401 for missing/empty credentials on every protected endpoint", async () => {
      for (const ep of [...protectedEndpoints, "/api/file?path=sample.wgsl"]) {
        for (const [headers, suffix] of [
          [{}, ""],
          [{ Authorization: "" }, ""],
          [{}, ep.includes("?") ? "&token=" : "?token="],
        ] as const) {
          const res = await call(ep, headers, suffix)
          expect(res.status, `${ep}${suffix}`).toBe(401)
          expect(await res.json()).toEqual({ error: "Unauthorized: missing authentication token" })
        }
      }
    })

    it("answers 403 for wrong, tampered, wrong-length and wrong-scheme tokens", async () => {
      for (const ep of [...protectedEndpoints, "/api/file?path=sample.wgsl"]) {
        for (const a of [
          "Bearer invalid-token-xyz",
          `Bearer ${tampered}`,
          "Bearer short_token",
          `Bearer ${SECRET}_extra_characters_123456`,
          "Bearer",
          "Basic dXNlcjpwYXNz",
        ]) {
          const res = await call(ep, { Authorization: a })
          expect(res.status, `${ep} ${a}`).toBe(403)
          expect(await res.json()).toEqual({ error: "Forbidden: invalid authentication token" })
        }
      }
      const res = await call("/api/agent/execute", { Authorization: "Bearer " })
      expect([401, 403]).toContain(res.status)
    })

    it("enforces auth before method routing (GET on protected POST endpoints)", async () => {
      for (const ep of protectedEndpoints) {
        expect((await fetch(`${baseUrl}${ep}`)).status).toBe(401)
        expect((await fetch(`${baseUrl}${ep}`, { headers: { Authorization: "Bearer bad" } })).status).toBe(403)
      }
    })

    it("accepts a valid token via Bearer header or X-Bridge-Token (then 503: no browser attached)", async () => {
      for (const h of [auth, { "X-Bridge-Token": SECRET }]) {
        const res = await post("/api/agent/execute", { source: "fn main() {}" }, h)
        expect(res.status).toBe(503)
        expect((await res.json()).error).toContain("No Shader Studio client connected")
      }
      expect((await post("/api/agent/capture", {}, auth)).status).toBe(503)
    })

    it("survives 100 concurrent brute-force guesses and stays healthy", async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          post("/api/agent/execute", { source: "test" }, { Authorization: `Bearer guess_${Math.random().toString(36).padEnd(48, "0")}` })
        )
      )
      for (const r of results) expect(r.status).toBe(403)
      expect((await (await fetch(`${baseUrl}/api/status`, { headers: auth })).json()).status).toBe("online")
    })

    it("requires the token for /api/status (it leaks the watched path) while /api/health stays minimal and public", async () => {
      expect((await fetch(`${baseUrl}/api/status`)).status).toBe(401)
      expect((await fetch(`${baseUrl}/api/status`, { headers: { Authorization: "Bearer nope" } })).status).toBe(403)
      const ok = await (await fetch(`${baseUrl}/api/status`, { headers: auth })).json()
      expect(ok.watchedDirectory).toBe(root)
      const health = await fetch(`${baseUrl}/api/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true })
    })

    it("404s unknown endpoints", async () => {
      const res = await fetch(`${baseUrl}/api/nope`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Endpoint not found" })
    })

    it("returns 400 for malformed JSON and for a missing source field", async () => {
      const bad = await post("/api/agent/execute", "{ malformed json...", auth)
      expect(bad.status).toBe(400)
      expect((await bad.json()).error).toMatch(/Invalid JSON/i)
      const missing = await post("/api/agent/execute", {}, auth)
      expect(missing.status).toBe(400)
      expect((await missing.json()).error).toMatch(/source/)
    })

    it("returns 413 for payloads over 5MB", async () => {
      let status: number | null = null
      let failure: any = null
      try {
        status = (await post("/api/agent/execute", JSON.stringify({ source: "x".repeat(5 * 1024 * 1024 + 10) }), auth)).status
      } catch (err) {
        failure = err
      }
      // the server destroys the socket after replying, so the client sees either the 413 or a reset
      if (failure) {
        const code = failure?.cause?.code ?? failure?.code
        expect(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]).toContain(code)
      } else {
        expect(status).toBe(413)
      }
    })
  })

  describe("SSRF protection on the AI proxy", () => {
    it("isAllowedAiUrl allows only whitelisted providers (https) and localhost (http)", () => {
      for (const u of [
        "https://api.anthropic.com/v1/messages",
        "https://generativelanguage.googleapis.com/v1beta/models",
        "https://api.openai.com/v1/chat/completions",
        "http://localhost:11434/api/generate",
        "http://127.0.0.1:1234/v1/chat/completions",
      ]) {
        expect(isAllowedAiUrl(u), u).toBe(true)
      }
      for (const u of [
        "http://169.254.169.254/latest/meta-data/",
        "https://169.254.169.254/secret",
        "http://192.168.1.1/admin",
        "http://10.0.0.1/router",
        "https://evil-attacker.com/steal-keys",
        "ftp://api.openai.com",
        "file:///etc/passwd",
        "gopher://localhost:6379",
        "javascript:alert(1)",
        "not-a-url",
        "",
      ]) {
        expect(isAllowedAiUrl(u), u).toBe(false)
      }
    })

    it("blocks disallowed targets with 403 even with a valid token, and 400s a missing targetUrl", async () => {
      for (const targetUrl of ["http://169.254.169.254/latest/meta-data/", "https://internal-secret-service.local/keys"]) {
        const res = await post("/api/ai/proxy", { targetUrl }, auth)
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatch(/not in the allowed AI provider list/i)
      }
      expect((await post("/api/ai/proxy", {}, auth)).status).toBe(400)
    })
  })

  describe("WebSocket upgrade auth and agent RPC relay", () => {
    it("closes with 4401 for missing, empty, wrong, short or bad-header tokens", async () => {
      expect(await wsClose(wsUrl)).toBe(4401)
      expect(await wsClose(`${wsUrl}?token=`)).toBe(4401)
      expect(await wsClose(`${wsUrl}?token=incorrect-token-string`)).toBe(4401)
      expect(await wsClose(`${wsUrl}?token=${SECRET.slice(0, 10)}`)).toBe(4401)
      expect(await wsClose(wsUrl, { headers: { Authorization: "Bearer wrong_bearer_token" } })).toBe(4401)
    })

    it("closes 30 concurrent unauthorized attempts with 4401", async () => {
      const codes = await Promise.all(Array.from({ length: 30 }, (_, i) => wsClose(`${wsUrl}?token=unauth_${i}`)))
      expect(codes.every((c) => c === 4401)).toBe(true)
    })

    it("accepts a valid token via query or Authorization header, with an allowed Origin", async () => {
      expect(await wsOpens(`${wsUrl}?token=${SECRET}`)).toBe(true)
      expect(await wsOpens(wsUrl, { headers: auth })).toBe(true)
      expect(await wsOpens(`${wsUrl}?token=${SECRET}`, { headers: { Origin: "http://localhost:5173" } })).toBe(true)
    })

    it("rejects hostile Origins on upgrade with HTTP 403", async () => {
      for (const o of ["https://evil-attacker.com", "null", "http://localhost.evil.com"]) {
        expect(await wsUpgradeStatus(`${wsUrl}?token=${SECRET}`, o), o).toBe(403)
      }
    })

    it("sends a browser client the file list, relays agent:execute, and resolves the HTTP call from feedback", async () => {
      const browser = new WebSocket(`${wsUrl}?token=${SECRET}`)
      const received: Record<string, unknown>[] = []
      browser.on("message", (raw) => {
        const msg = JSON.parse(raw.toString())
        received.push(msg)
        if (msg.type === "agent:execute") {
          browser.send(JSON.stringify({ type: "agent:feedback", id: msg.id, status: "success", backend: msg.backend, errors: [] }))
        }
        if (msg.type === "agent:capture") {
          browser.send(JSON.stringify({ type: "agent:feedback", id: msg.id, status: "success", screenshotBase64: "data:image/png;base64,AA==" }))
        }
      })
      await new Promise((r) => browser.once("open", r))
      await waitUntil(() => received.some((m) => m.type === "list"))
      expect(received.find((m) => m.type === "list")).toMatchObject({ files: [expect.stringContaining("sample.wgsl")] })

      const exec = await post("/api/agent/execute", { source: "fn main() {}", backend: "webgpu" }, auth)
      expect(exec.status).toBe(200)
      expect(await exec.json()).toMatchObject({ type: "agent:feedback", status: "success", backend: "webgpu" })
      expect(received.find((m) => m.type === "agent:execute")).toMatchObject({ source: "fn main() {}", captureSnapshot: true })

      const cap = await post("/api/agent/capture", { snapshotOptions: { width: 8 } }, auth)
      expect(cap.status).toBe(200)
      expect((await cap.json()).screenshotBase64).toContain("data:image/png")

      browser.close()
      await waitUntil(() => bridge.browserClients.size === 0)
    })

    it("answers a ?nonce= handshake with an HMAC proof of the token, first", async () => {
      const ws = new WebSocket(`${wsUrl}?token=${SECRET}&nonce=abc123`)
      const first = await new Promise<Record<string, unknown>>((done) => ws.once("message", (raw) => done(JSON.parse(raw.toString()))))
      ws.close()
      expect(first).toEqual({ type: "hello", proof: computeHandshakeProof(SECRET, "abc123") })
      expect(await verifyBridgeProof(SECRET, "abc123", first.proof as string)).toBe(true)
      expect(await verifyBridgeProof("some-other-token", "abc123", first.proof as string)).toBe(false)
      expect(await verifyBridgeProof(SECRET, "different-nonce", first.proof as string)).toBe(false)
    })

    it("forwards agent:diagnostics from an agent socket to browser clients", async () => {
      const browser = new WebSocket(`${wsUrl}?token=${SECRET}`)
      const received: Record<string, unknown>[] = []
      browser.on("message", (raw) => received.push(JSON.parse(raw.toString())))
      await new Promise((r) => browser.once("open", r))
      const agent = new WebSocket(`${wsUrl}?token=${SECRET}&role=agent`)
      await new Promise((r) => agent.once("open", r))
      agent.send(JSON.stringify({ type: "agent:diagnostics", id: "diag_1" }))
      await waitUntil(() => received.some((m) => m.type === "agent:diagnostics"))
      expect(received.find((m) => m.type === "agent:diagnostics")).toEqual({ type: "agent:diagnostics", id: "diag_1" })
      agent.close()
      browser.close()
      await waitUntil(() => bridge.browserClients.size === 0)
    })

    it("answers pending HTTP calls with 503 when the browser client disconnects mid-request", async () => {
      const browser = new WebSocket(`${wsUrl}?token=${SECRET}`)
      browser.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "agent:execute") browser.close()
      })
      await new Promise((r) => browser.once("open", r))
      const res = await post("/api/agent/execute", { source: "fn main() {}" }, auth)
      expect(res.status).toBe(503)
      expect((await res.json()).error).toMatch(/disconnected/)
    })
  })

  describe("client integration (wsBridgeClient)", () => {
    it("stores the token and builds auth headers only when one is set", () => {
      setBridgeToken(null)
      expect(getBridgeToken()).toBeNull()
      const bare = getBridgeApiHeaders()
      expect(bare["Content-Type"]).toBe("application/json")
      expect(bare["Authorization"]).toBeUndefined()
      expect(bare["X-Bridge-Token"]).toBeUndefined()

      setBridgeToken("active-auth-token-12345")
      expect(getBridgeToken()).toBe("active-auth-token-12345")
      const headers = getBridgeApiHeaders({ "X-Custom-Header": "TestValue" })
      expect(headers["Authorization"]).toBe("Bearer active-auth-token-12345")
      expect(headers["X-Bridge-Token"]).toBe("active-auth-token-12345")
      expect(headers["X-Custom-Header"]).toBe("TestValue")
    })

    it("getBridgeHttpUrl normalises the leading slash", () => {
      expect(getBridgeHttpUrl("/api/agent/execute")).toBe("http://localhost:8642/api/agent/execute")
      expect(getBridgeHttpUrl("api/status")).toBe("http://localhost:8642/api/status")
    })
  })
})
