import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WebSocket } from "ws"
import { resolve, join } from "path"
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmdirSync,
  existsSync,
  symlinkSync,
} from "fs"
import {
  isAllowedOrigin,
  isSafePath,
  isTokenValid,
  extractToken,
  isAllowedAiUrl,
  createBridgeServer,
} from "../scripts/bridge.js"

const SECRET_TOKEN = "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
const STRESS_DIR = resolve(process.cwd(), "tests", "_temp_stress_test")
const OUTSIDE_DIR = resolve(process.cwd(), "tests", "_temp_stress_outside")
const STRESS_FILE = join(STRESS_DIR, "valid_shader.wgsl")
const OUTSIDE_FILE = join(OUTSIDE_DIR, "secret_outside.txt")
const SYMLINK_ESCAPE = join(STRESS_DIR, "symlink_escape.txt")

describe("Adversarial Stress-Testing: scripts/bridge.js", () => {
  let bridge: ReturnType<typeof createBridgeServer>
  let port: number
  let baseUrl: string
  let wsUrl: string
  let symlinkCreated = false

  beforeAll(async () => {
    if (!existsSync(STRESS_DIR)) mkdirSync(STRESS_DIR, { recursive: true })
    if (!existsSync(OUTSIDE_DIR)) mkdirSync(OUTSIDE_DIR, { recursive: true })

    writeFileSync(STRESS_FILE, "@fragment fn main() -> @location(0) vec4f { return vec4f(0.5); }")
    writeFileSync(OUTSIDE_FILE, "TOP_SECRET_CONTENT_DO_NOT_LEAK")

    // Attempt to create a symlink pointing outside root (may require privileges on Windows)
    try {
      if (existsSync(SYMLINK_ESCAPE)) unlinkSync(SYMLINK_ESCAPE)
      symlinkSync(OUTSIDE_FILE, SYMLINK_ESCAPE, "file")
      symlinkCreated = true
    } catch {
      symlinkCreated = false
    }

    bridge = createBridgeServer({
      port: 0,
      token: SECRET_TOKEN,
      directory: STRESS_DIR,
      quiet: true,
    })

    port = await bridge.listen(0)
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (bridge) await bridge.close()

    try {
      if (symlinkCreated && existsSync(SYMLINK_ESCAPE)) unlinkSync(SYMLINK_ESCAPE)
      if (existsSync(STRESS_FILE)) unlinkSync(STRESS_FILE)
      if (existsSync(STRESS_DIR)) rmdirSync(STRESS_DIR)
      if (existsSync(OUTSIDE_FILE)) unlinkSync(OUTSIDE_FILE)
      if (existsSync(OUTSIDE_DIR)) rmdirSync(OUTSIDE_DIR)
    } catch {
      /* ignore cleanup error */
    }
  })

  describe("1. Hostile CORS Origin Probes", () => {
    const hostileOrigins = [
      "null",
      "http://localhost.evil.com",
      "https://localhost.evil.com",
      "http://evil.com/localhost",
      "http://127.0.0.1.attacker.com",
      "http://127.0.0.1:5173.attacker.com",
      "http://attacker.com:5173",
      "http://localhost@attacker.com",
      "http://attacker.com#localhost",
      "http://attacker.com?localhost",
      "http://evil.com",
      "https://evil.com",
      "ftp://localhost:5173",
      "file://localhost:5173",
      "ws://localhost:5173",
      "wss://localhost:5173",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://0.0.0.0:5173",
      "http://[::1]:5173",
      "http://2130706433:5173", // decimal representation of 127.0.0.1
      "http://0177.0.0.1:5173", // octal representation
      "http://localhost:5173/", // trailing slash not valid origin header per RFC 6454
      "http://localhost:5173/api",
    ]

    for (const origin of hostileOrigins) {
      it(`strictly rejects hostile origin: "${origin}" in isAllowedOrigin`, () => {
        expect(isAllowedOrigin(origin)).toBe(false)
      })

      it(`returns 403 Forbidden with CORS rejection for OPTIONS with Origin: "${origin}"`, async () => {
        const res = await fetch(`${baseUrl}/api/agent/execute`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
          },
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: CORS origin not allowed" })
        expect(res.headers.get("access-control-allow-origin")).toBeNull()
      })

      it(`returns 403 Forbidden with CORS rejection for GET /api/status with Origin: "${origin}"`, async () => {
        const res = await fetch(`${baseUrl}/api/status`, {
          method: "GET",
          headers: {
            Origin: origin,
          },
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: CORS origin not allowed" })
        expect(res.headers.get("access-control-allow-origin")).toBeNull()
      })

      it(`returns 403 Forbidden with CORS rejection for POST /api/agent/execute with Origin: "${origin}"`, async () => {
        const res = await fetch(`${baseUrl}/api/agent/execute`, {
          method: "POST",
          headers: {
            Origin: origin,
            Authorization: `Bearer ${SECRET_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ source: "fn main() {}" }),
        })
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: CORS origin not allowed" })
        expect(res.headers.get("access-control-allow-origin")).toBeNull()
      })
    }

    it("verifies missing Origin header allows internal / CLI requests without CORS headers", async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: "GET",
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("access-control-allow-origin")).toBeNull()
      const data = await res.json()
      expect(data.status).toBe("online")
    })
  })

  describe("2. Path Traversal & Escaping Attack Probes", () => {
    const maliciousPaths = [
      // Standard POSIX and Windows traversals
      "../package.json",
      "..\\package.json",
      "../../package.json",
      "..\\..\\package.json",
      "../../../etc/passwd",
      "..\\..\\..\\Windows\\win.ini",
      "nested/../../package.json",
      "nested\\..\\..\\package.json",
      "nested/../../../package.json",
      "nested\\..\\..\\..\\package.json",
      "./../../package.json",
      ".\\..\\..\\package.json",
      "..//..//package.json",
      "..\\\\..\\\\package.json",
      "../..",
      "..\\..",

      // Null byte injection
      "valid_shader.wgsl\0.png",
      "valid_shader.wgsl\0/../../package.json",
      "\0/etc/passwd",
      "\0..\\..\\package.json",

      // Absolute Windows and POSIX escapes
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      "C:/Windows/System32/drivers/etc/hosts",
      "C:\\Windows\\win.ini",
      "\\Windows\\win.ini",
      "D:\\unauthorized.txt",
      "/etc/passwd",
      "/var/log/syslog",
      "\\\\127.0.0.1\\c$\\Windows\\win.ini",
      "\\\\localhost\\c$\\Windows\\win.ini",

      // Traversal to outside directory
      "../_temp_stress_outside/secret_outside.txt",
      "..\\_temp_stress_outside\\secret_outside.txt",

      // Traversal to non-existent file outside boundary
      "../../nonexistent_outside_file_98765.txt",
      "..\\..\\nonexistent_outside_file_98765.txt",
    ]

    for (const testPath of maliciousPaths) {
      it(`isSafePath rejects path traversal: "${testPath}"`, () => {
        expect(isSafePath(testPath, STRESS_DIR)).toBe(false)
      })

      it(`GET /api/file rejects path traversal: "${testPath}" with 403 Forbidden without leaking paths`, async () => {
        const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(testPath)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${SECRET_TOKEN}`,
          },
        })

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: path escapes root boundary" })

        // CRITICAL CHECK: Verify no filesystem paths are leaked in response
        const rawText = JSON.stringify(body)
        expect(rawText).not.toContain(STRESS_DIR)
        expect(rawText).not.toContain("C:\\")
        expect(rawText).not.toContain("/home/")
        expect(rawText).not.toContain("/Users/")
      })
    }

    const urlEncodedTraversals = [
      "%2e%2e/package.json",
      "%2e%2e\\package.json",
      "%2e%2e%2fpackage.json",
      "%2e%2e%5cpackage.json",
      "..%2fpackage.json",
      "..%5cpackage.json",
      "%2e%2e/%2e%2e/package.json",
      "..%2f..%2fpackage.json",
      "%2e%2e%2f_temp_stress_outside%2fsecret_outside.txt",
    ]

    for (const rawEncoded of urlEncodedTraversals) {
      it(`GET /api/file with raw URL-encoded traversal "${rawEncoded}" decodes and returns 403 Forbidden`, async () => {
        // Send directly in query without encodeURIComponent so the server's URL parser decodes the %-sequences
        const res = await fetch(`${baseUrl}/api/file?path=${rawEncoded}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${SECRET_TOKEN}`,
          },
        })

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: path escapes root boundary" })
      })
    }

    it("verifies double-encoded %252e%252e cannot escape root boundary or read outside files", async () => {
      const res = await fetch(`${baseUrl}/api/file?path=%252e%252e/package.json`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
      })

      // Double encoding decodes to literal "%2e%2e" inside STRESS_DIR, which does not exist -> 404
      // It MUST NOT return 200 (package.json contents)
      expect(res.status).not.toBe(200)
      const text = await res.text()
      expect(text).not.toContain("shader-studio")
    })

    it("prevents symlink breakout if symlink exists", async () => {
      if (!symlinkCreated) {
        // Skip if OS environment prevented unprivileged symlink creation
        return
      }

      // SYMLINK_ESCAPE is inside STRESS_DIR, but targets OUTSIDE_FILE
      const relativeSymlink = "symlink_escape.txt"
      const isSafe = isSafePath(relativeSymlink, STRESS_DIR)
      expect(isSafe).toBe(false)

      const res = await fetch(`${baseUrl}/api/file?path=${relativeSymlink}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body).toEqual({ error: "Forbidden: path escapes root boundary" })
      expect(JSON.stringify(body)).not.toContain("TOP_SECRET_CONTENT_DO_NOT_LEAK")
    })

    it("safely serves genuine file inside watched directory", async () => {
      const res = await fetch(`${baseUrl}/api/file?path=valid_shader.wgsl`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
      })

      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain("@fragment fn main()")
    })
  })

  describe("3. Ephemeral Auth Secret & Constant-Time Validation Stress", () => {
    it("timingSafeEqual comparison strictly rejects malformed, partial, or mismatched tokens", () => {
      expect(isTokenValid("", SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(" ", SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(SECRET_TOKEN.slice(0, 10), SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(SECRET_TOKEN + "x", SECRET_TOKEN)).toBe(false)
      expect(isTokenValid("x" + SECRET_TOKEN.slice(1), SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(SECRET_TOKEN.slice(0, -1) + "0", SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(null as unknown as string, SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(undefined as unknown as string, SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(12345 as unknown as string, SECRET_TOKEN)).toBe(false)
      expect(isTokenValid(SECRET_TOKEN, SECRET_TOKEN)).toBe(true)
    })

    it("verifies HTTP endpoints reject missing token with 401 Unauthorized", async () => {
      const endpoints = [
        { url: `${baseUrl}/api/agent/execute`, method: "POST", body: { source: "fn main() {}" } },
        { url: `${baseUrl}/api/agent/capture`, method: "POST", body: {} },
        { url: `${baseUrl}/api/ai/proxy`, method: "POST", body: { targetUrl: "https://api.openai.com" } },
        { url: `${baseUrl}/api/file?path=valid_shader.wgsl`, method: "GET" },
      ]

      for (const ep of endpoints) {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { "Content-Type": "application/json" },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        })

        expect(res.status).toBe(401)
        const body = await res.json()
        expect(body).toEqual({ error: "Unauthorized: missing authentication token" })
        expect(JSON.stringify(body)).not.toContain("C:\\")
      }
    })

    it("verifies HTTP endpoints reject invalid token with 403 Forbidden", async () => {
      const endpoints = [
        { url: `${baseUrl}/api/agent/execute`, method: "POST", body: { source: "fn main() {}" } },
        { url: `${baseUrl}/api/agent/capture`, method: "POST", body: {} },
        { url: `${baseUrl}/api/ai/proxy`, method: "POST", body: { targetUrl: "https://api.openai.com" } },
        { url: `${baseUrl}/api/file?path=valid_shader.wgsl`, method: "GET" },
      ]

      for (const ep of endpoints) {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer invalid_attack_token_12345",
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        })

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body).toEqual({ error: "Forbidden: invalid authentication token" })
        expect(JSON.stringify(body)).not.toContain("C:\\")
      }
    })
  })

  describe("4. WebSocket Upgrade Adversarial Probes", () => {
    it("rejects WebSocket connection with missing token with close code 4401", async () => {
      const code = await new Promise<number>((resolveDone) => {
        const ws = new WebSocket(wsUrl)
        ws.on("close", (c) => resolveDone(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("rejects WebSocket connection with invalid token with close code 4401", async () => {
      const code = await new Promise<number>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=forged-token-abc`)
        ws.on("close", (c) => resolveDone(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("rejects WebSocket connection with hostile Origin: http://evil.com with 403 Forbidden HTTP error", async () => {
      const result = await new Promise<{ errorEmitted: boolean; status: number | null }>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${SECRET_TOKEN}`, {
          headers: {
            Origin: "http://evil.com",
          },
        })
        ws.on("open", () => {
          ws.close()
          resolveDone({ errorEmitted: false, status: null })
        })
        ws.on("error", (err: Error) => {
          const match = err.message.match(/(\d{3})/)
          resolveDone({ errorEmitted: true, status: match ? parseInt(match[1], 10) : null })
        })
      })

      expect(result.errorEmitted).toBe(true)
      expect(result.status).toBe(403)
    })

    it("rejects WebSocket connection with hostile Origin: null with 403 Forbidden HTTP error", async () => {
      const result = await new Promise<{ errorEmitted: boolean; status: number | null }>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${SECRET_TOKEN}`, {
          headers: {
            Origin: "null",
          },
        })
        ws.on("open", () => {
          ws.close()
          resolveDone({ errorEmitted: false, status: null })
        })
        ws.on("error", (err: Error) => {
          const match = err.message.match(/(\d{3})/)
          resolveDone({ errorEmitted: true, status: match ? parseInt(match[1], 10) : null })
        })
      })

      expect(result.errorEmitted).toBe(true)
      expect(result.status).toBe(403)
    })

    it("rejects WebSocket connection with spoofed Origin: http://localhost.evil.com with 403 Forbidden HTTP error", async () => {
      const result = await new Promise<{ errorEmitted: boolean; status: number | null }>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${SECRET_TOKEN}`, {
          headers: {
            Origin: "http://localhost.evil.com",
          },
        })
        ws.on("open", () => {
          ws.close()
          resolveDone({ errorEmitted: false, status: null })
        })
        ws.on("error", (err: Error) => {
          const match = err.message.match(/(\d{3})/)
          resolveDone({ errorEmitted: true, status: match ? parseInt(match[1], 10) : null })
        })
      })

      expect(result.errorEmitted).toBe(true)
      expect(result.status).toBe(403)
    })

    it("accepts WebSocket connection with valid token and allowed Origin", async () => {
      const openSuccess = await new Promise<boolean>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${SECRET_TOKEN}`, {
          headers: {
            Origin: "http://localhost:5173",
          },
        })
        ws.on("open", () => {
          ws.close()
          resolveDone(true)
        })
        ws.on("error", () => resolveDone(false))
      })

      expect(openSuccess).toBe(true)
    })
  })

  describe("5. SSRF and AI Proxy Protection", () => {
    it("isAllowedAiUrl strictly allows only whitelisted AI endpoints", () => {
      expect(isAllowedAiUrl("https://api.openai.com/v1/chat/completions")).toBe(true)
      expect(isAllowedAiUrl("https://api.anthropic.com/v1/messages")).toBe(true)
      expect(isAllowedAiUrl("https://generativelanguage.googleapis.com/v1/models")).toBe(true)
      expect(isAllowedAiUrl("http://localhost:11434/api/generate")).toBe(true)
      expect(isAllowedAiUrl("http://127.0.0.1:11434/api/generate")).toBe(true)

      // SSRF attack targets
      expect(isAllowedAiUrl("http://169.254.169.254/latest/meta-data/")).toBe(false)
      expect(isAllowedAiUrl("http://192.168.1.1/admin")).toBe(false)
      expect(isAllowedAiUrl("https://evil-proxy.com/api")).toBe(false)
      expect(isAllowedAiUrl("ftp://api.openai.com")).toBe(false)
      expect(isAllowedAiUrl("file:///etc/passwd")).toBe(false)
      expect(isAllowedAiUrl("gopher://localhost:6379")).toBe(false)
      expect(isAllowedAiUrl("javascript:alert(1)")).toBe(false)
      expect(isAllowedAiUrl("not-a-url")).toBe(false)
    })

    it("POST /api/ai/proxy blocks disallowed targetUrl with 403 Forbidden", async () => {
      const res = await fetch(`${baseUrl}/api/ai/proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET_TOKEN}`,
        },
        body: JSON.stringify({
          targetUrl: "http://169.254.169.254/latest/meta-data/",
        }),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain("Forbidden: targetUrl domain is not in the allowed AI provider list")
    })
  })
})
