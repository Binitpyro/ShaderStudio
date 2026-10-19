import { describe, it, expect } from "vitest"
import {
  validateCorsOrigin,
  isSafePath,
  verifyAuthToken,
  ALLOWED_CORS_ORIGINS,
} from "../mocks/gen2Harness"
import { resolve } from "path"

describe("Tier 1: Feature Coverage — Local Bridge RPC Security Hardening", () => {
  const TEST_ROOT = resolve(process.cwd())
  const VALID_TOKEN = "sec_test_ephemeral_token_9876543210abcdef"

  // --------------------------------------------------------------------------
  // 1. Strict CORS Origin Validation
  // --------------------------------------------------------------------------
  describe("CORS Origin Validation Whitelist", () => {
    it("permits standard Vite dev and preview origins", () => {
      for (const origin of ALLOWED_CORS_ORIGINS) {
        expect(validateCorsOrigin(origin)).toBe(true)
      }
    })

    it("permits non-browser clients without Origin header (curl, CLI, MCP)", () => {
      expect(validateCorsOrigin(undefined)).toBe(true)
      expect(validateCorsOrigin(null)).toBe(true)
      expect(validateCorsOrigin("")).toBe(true)
    })

    it("permits localhost and 127.0.0.1 on custom ports", () => {
      expect(validateCorsOrigin("http://localhost:3000")).toBe(true)
      expect(validateCorsOrigin("http://127.0.0.1:8080")).toBe(true)
      expect(validateCorsOrigin("http://localhost:8642")).toBe(true)
    })

    it("strictly rejects untrusted external origins with 403 Forbidden contract", () => {
      expect(validateCorsOrigin("https://evil-attacker.com")).toBe(false)
      expect(validateCorsOrigin("http://malicious-site.org:5173")).toBe(false)
      expect(validateCorsOrigin("https://phishing.io")).toBe(false)
      expect(validateCorsOrigin("null")).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // 2. Filesystem Path Traversal Sanitization
  // --------------------------------------------------------------------------
  describe("Filesystem Path Traversal Sanitization", () => {
    it("allows valid relative shader paths within project root", () => {
      expect(isSafePath("src/shaders/sample.wgsl", TEST_ROOT)).toBe(true)
      expect(isSafePath("public/textures/checker.png", TEST_ROOT)).toBe(true)
      expect(isSafePath("shaders/demo.glsl", TEST_ROOT)).toBe(true)
    })

    it("rejects path traversal attempting to escape project root boundary", () => {
      expect(isSafePath("../../../windows/win.ini", TEST_ROOT)).toBe(false)
      expect(isSafePath("../../etc/passwd", TEST_ROOT)).toBe(false)
      expect(isSafePath("..\\..\\secret.env", TEST_ROOT)).toBe(false)
      expect(isSafePath("src/../../outside.txt", TEST_ROOT)).toBe(false)
    })

    it("rejects null byte injection in file paths", () => {
      expect(isSafePath("src/shaders/valid.wgsl\0/etc/passwd", TEST_ROOT)).toBe(false)
      expect(isSafePath("valid.glsl\0.png", TEST_ROOT)).toBe(false)
    })

    it("rejects URL-encoded path traversal attacks (%2e%2e)", () => {
      expect(isSafePath("%2e%2e/%2e%2e/etc/passwd", TEST_ROOT)).toBe(false)
      expect(isSafePath("%2E%2E/%2E%2E/windows/system32", TEST_ROOT)).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // 3. Ephemeral Authentication Token Enforcement
  // --------------------------------------------------------------------------
  describe("Ephemeral Token Authentication Enforcement", () => {
    it("returns 401 Unauthorized when authentication token is completely missing", () => {
      const resultNoHeader = verifyAuthToken(undefined, VALID_TOKEN)
      expect(resultNoHeader.valid).toBe(false)
      expect(resultNoHeader.statusCode).toBe(401)
      expect(resultNoHeader.error).toContain("Missing authentication token")

      const resultEmpty = verifyAuthToken("", VALID_TOKEN)
      expect(resultEmpty.valid).toBe(false)
      expect(resultEmpty.statusCode).toBe(401)
    })

    it("returns 403 Forbidden when authentication token is invalid or incorrect", () => {
      const resultBad = verifyAuthToken("Bearer wrong_secret_key", VALID_TOKEN)
      expect(resultBad.valid).toBe(false)
      expect(resultBad.statusCode).toBe(403)
      expect(resultBad.error).toContain("Invalid authentication token")

      const resultPartial = verifyAuthToken(VALID_TOKEN.slice(0, 10), VALID_TOKEN)
      expect(resultPartial.valid).toBe(false)
      expect(resultPartial.statusCode).toBe(403)
    })

    it("returns 200 OK when authentication token is valid (Bearer header or direct token)", () => {
      const resultBearer = verifyAuthToken(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)
      expect(resultBearer.valid).toBe(true)
      expect(resultBearer.statusCode).toBe(200)

      const resultDirect = verifyAuthToken(VALID_TOKEN, VALID_TOKEN)
      expect(resultDirect.valid).toBe(true)
      expect(resultDirect.statusCode).toBe(200)
    })
  })
})
