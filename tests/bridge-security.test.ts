import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WebSocket } from "ws"
import { resolve, join } from "path"
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from "fs"
import {
  isAllowedOrigin,
  isSafePath,
  isTokenValid,
  extractToken,
  createBridgeServer,
} from "../scripts/bridge.js"
import {
  getBridgeToken,
  setBridgeToken,
  getBridgeApiHeaders,
  getBridgeHttpUrl,
} from "@/bridge/wsBridgeClient"

const TEST_SECRET_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef"
const TEST_DIR = resolve(process.cwd(), "tests", "_temp_bridge_test")
const TEST_FILE = join(TEST_DIR, "sample.wgsl")

describe("Milestone 1: Local Bridge RPC Security Hardening (Requirement R4)", () => {
  let bridgeInstance: ReturnType<typeof createBridgeServer>
  let serverPort: number
  let baseUrl: string
  let wsUrl: string

  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    writeFileSync(TEST_FILE, "@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }")

    // Bind to port 0 for an ephemeral OS-assigned free port to prevent collisions
    bridgeInstance = createBridgeServer({
      port: 0,
      token: TEST_SECRET_TOKEN,
      directory: TEST_DIR,
      quiet: true,
    })

    serverPort = await bridgeInstance.listen(0)
    baseUrl = `http://127.0.0.1:${serverPort}`
    wsUrl = `ws://127.0.0.1:${serverPort}`
  })

  afterAll(async () => {
    if (bridgeInstance) {
      await bridgeInstance.close()
    }
    try {
      if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE)
      if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR)
    } catch {
      /* ignore cleanup */
    }
  })

  describe("1. Strict CORS Origin Validation", () => {
    it("allows standard Vite dev/preview localhost and 127.0.0.1 origins", () => {
      expect(isAllowedOrigin("http://localhost:5173")).toBe(true)
      expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true)
      expect(isAllowedOrigin("http://localhost:4173")).toBe(true)
      expect(isAllowedOrigin("http://127.0.0.1:4173")).toBe(true)
    })

    it("allows arbitrary local development ports via local port regex", () => {
      expect(isAllowedOrigin("http://localhost:3000")).toBe(true)
      expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(true)
      expect(isAllowedOrigin("https://localhost:8443")).toBe(true)
      expect(isAllowedOrigin("http://localhost")).toBe(true)
      expect(isAllowedOrigin("http://127.0.0.1")).toBe(true)
    })

    it("rejects untrusted external and spoofed origins", () => {
      expect(isAllowedOrigin("https://evil-attacker.com")).toBe(false)
      expect(isAllowedOrigin("http://localhost.evil.com")).toBe(false)
      expect(isAllowedOrigin("http://127.0.0.1.attacker.net")).toBe(false)
      expect(isAllowedOrigin("null")).toBe(false)
      expect(isAllowedOrigin("")).toBe(false)
      expect(isAllowedOrigin(null as unknown as string)).toBe(false)
    })

    it("responds with 204 and CORS headers for allowed origin OPTIONS preflight", async () => {
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

    it("responds with 403 Forbidden for disallowed origin OPTIONS preflight", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil-site.com",
        },
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ error: "Forbidden: CORS origin not allowed" })
      expect(res.headers.get("access-control-allow-origin")).toBeNull()
    })

    it("responds with 403 Forbidden for disallowed origin on standard GET / POST requests", async () => {
      const resGet = await fetch(`${baseUrl}/api/status`, {
        method: "GET",
        headers: {
          Origin: "https://evil-site.com",
        },
      })
      expect(resGet.status).toBe(403)
      const dataGet = await resGet.json()
      expect(dataGet).toEqual({ error: "Forbidden: CORS origin not allowed" })

      const resPost = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          Origin: "https://evil-site.com",
          Authorization: `Bearer ${TEST_SECRET_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "fn main() {}" }),
      })
      expect(resPost.status).toBe(403)
      const dataPost = await resPost.json()
      expect(dataPost).toEqual({ error: "Forbidden: CORS origin not allowed" })
    })

    it("allows non-browser requests without Origin header to proceed to auth checks", async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        method: "GET",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe("online")
    })
  })

  describe("2. Canonical Path Traversal Sanitization", () => {
    it("isSafePath correctly validates paths against root directory", () => {
      const root = TEST_DIR

      // Safe relative and normalized paths
      expect(isSafePath("sample.wgsl", root)).toBe(true)
      expect(isSafePath("./sample.wgsl", root)).toBe(true)
      expect(isSafePath("sub/file.glsl", root)).toBe(true)
      expect(isSafePath("sub/nested/../file.glsl", root)).toBe(true)

      // Dangerous directory traversal attempts
      expect(isSafePath("../secret.txt", root)).toBe(false)
      expect(isSafePath("../../etc/passwd", root)).toBe(false)
      expect(isSafePath("sub/../../outside.txt", root)).toBe(false)
      expect(isSafePath("..\\secret.txt", root)).toBe(false)

      // Null byte injection attempts
      expect(isSafePath("sample.wgsl\0.png", root)).toBe(false)
      expect(isSafePath("\0/etc/passwd", root)).toBe(false)

      // Invalid arguments
      expect(isSafePath("", root)).toBe(false)
      expect(isSafePath(null as unknown as string, root)).toBe(false)
      expect(isSafePath(undefined as unknown as string, root)).toBe(false)
    })

    it("rejects path traversal escaping root boundary on file endpoint with 403 Forbidden", async () => {
      const res = await fetch(`${baseUrl}/api/file?path=../../package.json`, {
        headers: {
          Authorization: `Bearer ${TEST_SECRET_TOKEN}`,
        },
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ error: "Forbidden: path escapes root boundary" })
    })

    it("allows safe file access within watched directory", async () => {
      const res = await fetch(`${baseUrl}/api/file?path=sample.wgsl`, {
        headers: {
          Authorization: `Bearer ${TEST_SECRET_TOKEN}`,
        },
      })

      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain("@fragment fn main()")
    })

    it("rejects agent execute payload with out-of-bounds path parameter", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_SECRET_TOKEN}`,
        },
        body: JSON.stringify({
          source: "fn main() {}",
          path: "../../secret.ts",
        }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ error: "Forbidden: path escapes root boundary" })
    })
  })

  describe("3. Ephemeral Authentication Secret & Constant-Time Validation", () => {
    it("generates a 24-byte hex (48 characters) token when no token is specified", () => {
      const ephemeral = createBridgeServer({ port: 0, quiet: true })
      expect(typeof ephemeral.token).toBe("string")
      expect(ephemeral.token.length).toBe(48)
      expect(/^[0-9a-f]{48}$/i.test(ephemeral.token)).toBe(true)
    })

    it("respects explicit token parameter and environment configuration", () => {
      const custom = createBridgeServer({ port: 0, token: "custom-secret-key-12345", quiet: true })
      expect(custom.token).toBe("custom-secret-key-12345")
    })

    it("isTokenValid validates identical tokens and rejects invalid tokens", () => {
      const secret = "super-secret-token-abcdef123456"
      expect(isTokenValid(secret, secret)).toBe(true)
      expect(isTokenValid("wrong-token", secret)).toBe(false)
      expect(isTokenValid("", secret)).toBe(false)
      expect(isTokenValid(null as unknown as string, secret)).toBe(false)
      expect(isTokenValid(undefined as unknown as string, secret)).toBe(false)
      // Different length
      expect(isTokenValid("super-secret", secret)).toBe(false)
    })

    it("extractToken extracts token from Bearer header, X-Bridge-Token, and query param", () => {
      // 1. Authorization: Bearer
      const req1 = { headers: { authorization: "Bearer my-token-123" } }
      expect(extractToken(req1 as never, null)).toBe("my-token-123")

      // 2. Authorization: raw token
      const req2 = { headers: { authorization: "raw-token-456" } }
      expect(extractToken(req2 as never, null)).toBe("raw-token-456")

      // 3. X-Bridge-Token
      const req3 = { headers: { "x-bridge-token": "custom-bridge-token" } }
      expect(extractToken(req3 as never, null)).toBe("custom-bridge-token")

      // 4. URL query param
      const url = new URL("http://localhost:8642/api/agent/execute?token=query-param-token")
      expect(extractToken({} as never, url)).toBe("query-param-token")

      // 5. Missing token
      expect(extractToken({ headers: {} } as never, new URL("http://localhost:8642"))).toBeNull()
    })
  })

  describe("4. Mandatory Authentication Enforcement on HTTP Endpoints", () => {
    it("POST /api/agent/execute rejects missing token with 401 Unauthorized", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "fn main() {}" }),
      })

      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ error: "Unauthorized: missing authentication token" })
    })

    it("POST /api/agent/execute rejects invalid token with 403 Forbidden", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token-xyz",
        },
        body: JSON.stringify({ source: "fn main() {}" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ error: "Forbidden: invalid authentication token" })
    })

    it("POST /api/agent/execute accepts valid token via Authorization Bearer header", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_SECRET_TOKEN}`,
        },
        body: JSON.stringify({ source: "fn main() {}" }),
      })

      // Since no browser client is currently attached, server responds with 503 (not 401 or 403)
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data.error).toContain("No Shader Studio client connected")
    })

    it("POST /api/agent/execute accepts valid token via X-Bridge-Token header", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Token": TEST_SECRET_TOKEN,
        },
        body: JSON.stringify({ source: "fn main() {}" }),
      })

      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data.error).toContain("No Shader Studio client connected")
    })

    it("POST /api/agent/capture rejects missing token with 401 and invalid with 403", async () => {
      const resNoToken = await fetch(`${baseUrl}/api/agent/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(resNoToken.status).toBe(401)
      expect(await resNoToken.json()).toEqual({ error: "Unauthorized: missing authentication token" })

      const resBadToken = await fetch(`${baseUrl}/api/agent/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({}),
      })
      expect(resBadToken.status).toBe(403)
      expect(await resBadToken.json()).toEqual({ error: "Forbidden: invalid authentication token" })
    })

    it("POST /api/ai/proxy rejects missing token with 401 and invalid with 403", async () => {
      const resNoToken = await fetch(`${baseUrl}/api/ai/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl: "https://api.openai.com/v1/chat/completions" }),
      })
      expect(resNoToken.status).toBe(401)
      expect(await resNoToken.json()).toEqual({ error: "Unauthorized: missing authentication token" })

      const resBadToken = await fetch(`${baseUrl}/api/ai/proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({ targetUrl: "https://api.openai.com/v1/chat/completions" }),
      })
      expect(resBadToken.status).toBe(403)
      expect(await resBadToken.json()).toEqual({ error: "Forbidden: invalid authentication token" })
    })

    it("GET /api/status remains accessible without requiring authentication", async () => {
      const res = await fetch(`${baseUrl}/api/status`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe("online")
    })
  })

  describe("5. Mandatory WebSocket Upgrade Authentication", () => {
    it("rejects WebSocket connection without token with close code 4401", async () => {
      const code = await new Promise<number>((resolveDone) => {
        const ws = new WebSocket(wsUrl)
        ws.on("close", (c) => resolveDone(c))
        ws.on("error", () => {})
      })

      expect(code).toBe(4401)
    })

    it("rejects WebSocket connection with invalid token with close code 4401", async () => {
      const code = await new Promise<number>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=incorrect-token-string`)
        ws.on("close", (c) => resolveDone(c))
        ws.on("error", () => {})
      })

      expect(code).toBe(4401)
    })

    it("accepts WebSocket connection with valid token in query param", async () => {
      const result = await new Promise<{ open: boolean; closeCode: number | null }>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${TEST_SECRET_TOKEN}`)
        ws.on("open", () => {
          ws.close()
          resolveDone({ open: true, closeCode: null })
        })
        ws.on("close", (c) => {
          resolveDone({ open: false, closeCode: c })
        })
        ws.on("error", () => {})
      })

      expect(result.open).toBe(true)
    })

    it("rejects WebSocket connection from disallowed Origin header with 403 Forbidden", async () => {
      const result = await new Promise<{ errorEmitted: boolean; status: number | null }>((resolveDone) => {
        const ws = new WebSocket(`${wsUrl}?token=${TEST_SECRET_TOKEN}`, {
          headers: {
            Origin: "https://evil-attacker.com",
          },
        })
        ws.on("open", () => {
          ws.close()
          resolveDone({ errorEmitted: false, status: null })
        })
        ws.on("error", (err: Error & { message: string }) => {
          const match = err.message.match(/(\d{3})/)
          resolveDone({ errorEmitted: true, status: match ? parseInt(match[1], 10) : null })
        })
      })

      expect(result.errorEmitted).toBe(true)
      expect(result.status).toBe(403)
    })
  })

  describe("6. Client Integration (wsBridgeClient.ts)", () => {
    it("stores and retrieves bridge authentication token", () => {
      setBridgeToken("test-client-token-998877")
      expect(getBridgeToken()).toBe("test-client-token-998877")
    })

    it("generates correct API headers with Authorization Bearer and X-Bridge-Token", () => {
      setBridgeToken("active-auth-token-12345")
      const headers = getBridgeApiHeaders({ "X-Custom-Header": "TestValue" })

      expect(headers["Content-Type"]).toBe("application/json")
      expect(headers["Authorization"]).toBe("Bearer active-auth-token-12345")
      expect(headers["X-Bridge-Token"]).toBe("active-auth-token-12345")
      expect(headers["X-Custom-Header"]).toBe("TestValue")
    })

    it("getBridgeHttpUrl builds correct HTTP endpoint URLs", () => {
      const url1 = getBridgeHttpUrl("/api/agent/execute")
      const url2 = getBridgeHttpUrl("api/status")

      expect(url1).toBe("http://localhost:8642/api/agent/execute")
      expect(url2).toBe("http://localhost:8642/api/status")
    })
  })
})
