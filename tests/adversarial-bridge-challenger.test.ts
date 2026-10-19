import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WebSocket } from "ws"
import { resolve, join } from "path"
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from "fs"
import {
  isAllowedOrigin,
  isSafePath,
  isTokenValid,
  extractToken,
  isAllowedAiUrl,
  createBridgeServer,
} from "../scripts/bridge.js"
import {
  getBridgeToken,
  setBridgeToken,
  getBridgeApiHeaders,
  getBridgeHttpUrl,
} from "@/bridge/wsBridgeClient"

const CHALLENGER_SECRET = "9f8e7d6c5b4a32109f8e7d6c5b4a32109f8e7d6c5b4a3210"
const TEST_DIR = resolve(process.cwd(), "tests", "_temp_challenger_test")
const TEST_FILE = join(TEST_DIR, "shader.wgsl")

describe("Adversarial Stress Test: Milestone 1 Bridge RPC Security (R4)", () => {
  let bridge: ReturnType<typeof createBridgeServer>
  let port: number
  let baseUrl: string
  let wsUrl: string

  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    writeFileSync(TEST_FILE, "@fragment fn main() -> @location(0) vec4f { return vec4f(0.5); }")

    bridge = createBridgeServer({
      port: 0,
      token: CHALLENGER_SECRET,
      directory: TEST_DIR,
      quiet: true,
    })
    port = await bridge.listen(0)
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (bridge) {
      await bridge.close()
    }
    try {
      if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE)
      if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR)
    } catch {
      /* ignore */
    }
  })

  // ==========================================================================
  // Section 1: HTTP Endpoints Authentication & Status Codes Matrix
  // ==========================================================================
  describe("1. HTTP Endpoints Authentication Matrix (/api/agent/execute, /api/agent/capture, /api/ai/proxy, /api/file)", () => {
    const protectedPostEndpoints = [
      "/api/agent/execute",
      "/api/agent/capture",
      "/api/ai/proxy",
    ]

    for (const endpoint of protectedPostEndpoints) {
      describe(`Endpoint ${endpoint}`, () => {
        it("returns 401 when Authorization header is missing completely", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(401)
          const body = await res.json()
          expect(body.error).toMatch(/Unauthorized: missing authentication token/i)
        })

        it("returns 401 when Authorization header is empty string", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "",
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(401)
          const body = await res.json()
          expect(body.error).toMatch(/Unauthorized: missing authentication token/i)
        })

        it("returns 401 when token query param is empty string (?token=)", async () => {
          const res = await fetch(`${baseUrl}${endpoint}?token=`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(401)
          const body = await res.json()
          expect(body.error).toMatch(/Unauthorized: missing authentication token/i)
        })

        it("returns 403 when Authorization token is invalid (different value, same length)", async () => {
          const tamperedToken = CHALLENGER_SECRET.slice(0, -1) + (CHALLENGER_SECRET.slice(-1) === "0" ? "1" : "0")
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tamperedToken}`,
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body.error).toMatch(/Forbidden: invalid authentication token/i)
        })

        it("returns 403 when Authorization token has length mismatch (shorter)", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer short_token",
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body.error).toMatch(/Forbidden: invalid authentication token/i)
        })

        it("returns 403 when Authorization token has length mismatch (longer)", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CHALLENGER_SECRET}_extra_characters_123456`,
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body.error).toMatch(/Forbidden: invalid authentication token/i)
        })

        it("returns 403 on malformed Bearer header without token ('Bearer')", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer",
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body.error).toMatch(/Forbidden: invalid authentication token/i)
        })

        it("handles Bearer with trailing whitespace ('Bearer ')", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer ",
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect([401, 403]).toContain(res.status)
        })

        it("returns 403 on non-Bearer schemes (Basic, Digest)", async () => {
          const res = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Basic dXNlcjpwYXNz",
            },
            body: JSON.stringify({ source: "void main(){}" }),
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body.error).toMatch(/Forbidden: invalid authentication token/i)
        })

        it("returns 401/403 even when HTTP method is non-POST (e.g. GET)", async () => {
          const resGetNoToken = await fetch(`${baseUrl}${endpoint}`, { method: "GET" })
          expect(resGetNoToken.status).toBe(401)

          const resGetBadToken = await fetch(`${baseUrl}${endpoint}`, {
            method: "GET",
            headers: { Authorization: "Bearer bad" },
          })
          expect(resGetBadToken.status).toBe(403)
        })
      })
    }

    it("verifies GET /api/file requires authentication and rejects missing (401) and invalid (403)", async () => {
      // 1. Missing token
      const resNoToken = await fetch(`${baseUrl}/api/file?path=shader.wgsl`)
      expect(resNoToken.status).toBe(401)
      expect(await resNoToken.json()).toEqual({ error: "Unauthorized: missing authentication token" })

      // 2. Invalid token
      const resBadToken = await fetch(`${baseUrl}/api/file?path=shader.wgsl`, {
        headers: { Authorization: "Bearer wrong-token" },
      })
      expect(resBadToken.status).toBe(403)
      expect(await resBadToken.json()).toEqual({ error: "Forbidden: invalid authentication token" })

      // 3. Valid token
      const resValid = await fetch(`${baseUrl}/api/file?path=shader.wgsl`, {
        headers: { Authorization: `Bearer ${CHALLENGER_SECRET}` },
      })
      expect(resValid.status).toBe(200)
      const content = await resValid.text()
      expect(content).toContain("@fragment fn main()")
    })

    it("survives rapid token brute-force attempts without crashing or leaking memory", async () => {
      const attempts = 100
      const promises: Promise<Response>[] = []

      for (let i = 0; i < attempts; i++) {
        const candidate = "guess_" + Math.random().toString(36).padEnd(48, "0")
        promises.push(
          fetch(`${baseUrl}/api/agent/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${candidate}`,
            },
            body: JSON.stringify({ source: "test" }),
          })
        )
      }

      const results = await Promise.all(promises)
      for (const res of results) {
        expect(res.status).toBe(403)
      }

      // Check server status afterwards to ensure it is healthy
      const statusRes = await fetch(`${baseUrl}/api/status`)
      expect(statusRes.status).toBe(200)
      const statusBody = await statusRes.json()
      expect(statusBody.status).toBe("online")
    })

    it("handles malformed JSON body gracefully returning 400 Bad Request", async () => {
      const res = await fetch(`${baseUrl}/api/agent/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHALLENGER_SECRET}`,
        },
        body: "{ malformed json...",
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid JSON/i)
    })

    it("enforces SSRF protection on POST /api/ai/proxy even with valid token", async () => {
      // Disallowed external domain
      const resSsrf = await fetch(`${baseUrl}/api/ai/proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CHALLENGER_SECRET}`,
        },
        body: JSON.stringify({ targetUrl: "https://internal-secret-service.local/keys" }),
      })
      expect(resSsrf.status).toBe(403)
      const body = await resSsrf.json()
      expect(body.error).toMatch(/not in the allowed AI provider list/i)
    })
  })

  // ==========================================================================
  // Section 2: Timing-Safe Comparison & Edge Cases
  // ==========================================================================
  describe("2. Constant-Time Comparison (isTokenValid) Robustness", () => {
    it("returns true for exact string match", () => {
      expect(isTokenValid(CHALLENGER_SECRET, CHALLENGER_SECRET)).toBe(true)
    })

    it("returns false without throwing on null, undefined, and non-string inputs", () => {
      expect(isTokenValid(null as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(undefined as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(12345 as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid({} as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid([] as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(true as unknown as string, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(CHALLENGER_SECRET, null as unknown as string)).toBe(false)
      expect(isTokenValid(CHALLENGER_SECRET, undefined as unknown as string)).toBe(false)
      expect(isTokenValid("", CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(CHALLENGER_SECRET, "")).toBe(false)
    })

    it("returns false without throwing on variable buffer lengths", () => {
      // Shorter strings
      expect(isTokenValid("a", CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid("0123456789", CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(CHALLENGER_SECRET.slice(0, 47), CHALLENGER_SECRET)).toBe(false)

      // Longer strings
      expect(isTokenValid(CHALLENGER_SECRET + "x", CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(CHALLENGER_SECRET.repeat(2), CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid("x".repeat(10000), CHALLENGER_SECRET)).toBe(false)
    })

    it("handles multi-byte UTF-8 sequences correctly", () => {
      const unicodeToken = "🔥".repeat(12) // 12 emoji * 4 bytes = 48 bytes
      expect(isTokenValid(unicodeToken, CHALLENGER_SECRET)).toBe(false)
      expect(isTokenValid(unicodeToken, unicodeToken)).toBe(true)
    })

    it("handles embedded null bytes and binary characters", () => {
      const nullToken = CHALLENGER_SECRET.slice(0, 10) + "\0" + CHALLENGER_SECRET.slice(11)
      expect(isTokenValid(nullToken, CHALLENGER_SECRET)).toBe(false)
    })

    it("executes timing test showing consistent duration regardless of mismatch position", () => {
      const iterations = 5000
      const firstByteMismatch = "a" + CHALLENGER_SECRET.slice(1)
      const lastByteMismatch = CHALLENGER_SECRET.slice(0, -1) + "a"

      // Warm up JIT
      for (let i = 0; i < 1000; i++) {
        isTokenValid(firstByteMismatch, CHALLENGER_SECRET)
        isTokenValid(lastByteMismatch, CHALLENGER_SECRET)
      }

      const startFirst = performance.now()
      for (let i = 0; i < iterations; i++) {
        isTokenValid(firstByteMismatch, CHALLENGER_SECRET)
      }
      const durFirst = performance.now() - startFirst

      const startLast = performance.now()
      for (let i = 0; i < iterations; i++) {
        isTokenValid(lastByteMismatch, CHALLENGER_SECRET)
      }
      const durLast = performance.now() - startLast

      expect(durFirst).toBeLessThan(200)
      expect(durLast).toBeLessThan(200)
      const ratio = durFirst > durLast ? durFirst / durLast : durLast / durFirst
      expect(ratio).toBeLessThan(3.5)
    })
  })

  // ==========================================================================
  // Section 3: WebSocket Upgrade Authentication & Termination
  // ==========================================================================
  describe("3. WebSocket Upgrade Authentication & Termination", () => {
    it("terminates connection with close code 4401 when token query param is missing", async () => {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(wsUrl)
        ws.on("close", (c) => done(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("terminates connection with close code 4401 when token query param is empty (?token=)", async () => {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(`${wsUrl}?token=`)
        ws.on("close", (c) => done(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("terminates connection with close code 4401 when token is invalid string", async () => {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(`${wsUrl}?token=completely_wrong_token`)
        ws.on("close", (c) => done(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("terminates connection with close code 4401 when token has length mismatch", async () => {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(`${wsUrl}?token=${CHALLENGER_SECRET.slice(0, 10)}`)
        ws.on("close", (c) => done(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("terminates connection with close code 4401 when Authorization header is invalid", async () => {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: "Bearer wrong_bearer_token" },
        })
        ws.on("close", (c) => done(c))
        ws.on("error", () => {})
      })
      expect(code).toBe(4401)
    })

    it("successfully establishes WebSocket connection with valid token in query param", async () => {
      const success = await new Promise<boolean>((done) => {
        const ws = new WebSocket(`${wsUrl}?token=${CHALLENGER_SECRET}`)
        ws.on("open", () => {
          ws.close()
          done(true)
        })
        ws.on("close", () => done(false))
        ws.on("error", () => done(false))
      })
      expect(success).toBe(true)
    })

    it("successfully establishes WebSocket connection with valid token in Authorization header", async () => {
      const success = await new Promise<boolean>((done) => {
        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${CHALLENGER_SECRET}` },
        })
        ws.on("open", () => {
          ws.close()
          done(true)
        })
        ws.on("close", () => done(false))
        ws.on("error", () => done(false))
      })
      expect(success).toBe(true)
    })

    it("handles 30 concurrent unauthorized WebSocket attempts and closes all with 4401", async () => {
      const attempts = 30
      const promises: Promise<number>[] = []

      for (let i = 0; i < attempts; i++) {
        promises.push(
          new Promise<number>((done) => {
            const ws = new WebSocket(`${wsUrl}?token=unauth_${i}`)
            ws.on("close", (c) => done(c))
            ws.on("error", () => {})
          })
        )
      }

      const codes = await Promise.all(promises)
      for (const code of codes) {
        expect(code).toBe(4401)
      }
    })

    it("destroys socket immediately with 403 Forbidden on disallowed Origin header during upgrade", async () => {
      const result = await new Promise<{ error: boolean; code: number | null }>((done) => {
        const ws = new WebSocket(`${wsUrl}?token=${CHALLENGER_SECRET}`, {
          headers: { Origin: "http://malicious-origin.com" },
        })
        ws.on("open", () => {
          ws.close()
          done({ error: false, code: null })
        })
        ws.on("error", (err: Error & { message: string }) => {
          const match = err.message.match(/(\d{3})/)
          done({ error: true, code: match ? parseInt(match[1], 10) : null })
        })
      })
      expect(result.error).toBe(true)
      expect(result.code).toBe(403)
    })
  })

  // ==========================================================================
  // Section 4: Path Traversal Adversarial Stress Testing
  // ==========================================================================
  describe("4. Path Traversal Adversarial Stress Testing", () => {
    it("rejects absolute paths pointing outside directory boundary", () => {
      expect(isSafePath("C:\\Windows\\system32\\cmd.exe", TEST_DIR)).toBe(false)
      expect(isSafePath("D:\\another_drive\\secret.txt", TEST_DIR)).toBe(false)
    })

    it("rejects deeply nested dot-dot traversal variants", () => {
      expect(isSafePath("../../../../../../../../../../../windows/system.ini", TEST_DIR)).toBe(false)
      expect(isSafePath("sub/../../../../outside.txt", TEST_DIR)).toBe(false)
      expect(isSafePath(".\\..\\.\\..\\secret", TEST_DIR)).toBe(false)
      expect(isSafePath("..\\..\\..\\..\\etc\\passwd", TEST_DIR)).toBe(false)
    })

    it("rejects null byte injection variants", () => {
      expect(isSafePath("shader.wgsl\0.png", TEST_DIR)).toBe(false)
      expect(isSafePath("\0shader.wgsl", TEST_DIR)).toBe(false)
      expect(isSafePath("sub/\0/file.wgsl", TEST_DIR)).toBe(false)
    })
  })

  // ==========================================================================
  // Section 5: Client Integration & Token Propagation
  // ==========================================================================
  describe("5. Client Bridge Token Propagation & API Headers", () => {
    afterAll(() => {
      setBridgeToken(null)
    })

    it("manages active token state correctly", () => {
      setBridgeToken(null)
      expect(getBridgeToken()).toBeNull()

      setBridgeToken("test_secret_abc123")
      expect(getBridgeToken()).toBe("test_secret_abc123")
    })

    it("getBridgeApiHeaders omits auth headers when token is null", () => {
      setBridgeToken(null)
      const headers = getBridgeApiHeaders()
      expect(headers["Content-Type"]).toBe("application/json")
      expect(headers["Authorization"]).toBeUndefined()
      expect(headers["X-Bridge-Token"]).toBeUndefined()
    })

    it("getBridgeApiHeaders populates Authorization Bearer and X-Bridge-Token when token is set", () => {
      setBridgeToken("secret_token_xyz")
      const headers = getBridgeApiHeaders({ "Custom-Header": "value" })
      expect(headers["Content-Type"]).toBe("application/json")
      expect(headers["Authorization"]).toBe("Bearer secret_token_xyz")
      expect(headers["X-Bridge-Token"]).toBe("secret_token_xyz")
      expect(headers["Custom-Header"]).toBe("value")
    })

    it("getBridgeHttpUrl correctly constructs endpoint URLs", () => {
      expect(getBridgeHttpUrl("api/agent/execute")).toBe("http://localhost:8642/api/agent/execute")
      expect(getBridgeHttpUrl("/api/status")).toBe("http://localhost:8642/api/status")
    })
  })
})
