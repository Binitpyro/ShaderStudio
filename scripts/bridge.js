#!/usr/bin/env node
import { createServer } from "http"
import { WebSocketServer } from "ws"
import { watch, readdirSync, readFileSync, statSync, realpathSync } from "fs"
import { join, extname, resolve, normalize, sep } from "path"
import { randomBytes, timingSafeEqual } from "crypto"
import { fileURLToPath } from "url"

const SHADER_EXTENSIONS = [".wgsl", ".glsl", ".frag", ".vert"]
const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MB

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
])

const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const ALLOWED_AI_HOSTS = new Set([
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "localhost",
  "127.0.0.1",
])

/**
 * Validates whether an origin is allowed by the strict CORS policy.
 */
export function isAllowedOrigin(origin, extraOrigins = []) {
  if (!origin || typeof origin !== "string") return false
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true
  if (LOCAL_ORIGIN_REGEX.test(origin)) return true
  if (Array.isArray(extraOrigins) && extraOrigins.includes(origin)) return true
  if (process.env.SHADER_STUDIO_ALLOWED_ORIGIN && origin === process.env.SHADER_STUDIO_ALLOWED_ORIGIN) return true
  return false
}

/**
 * Checks if a target path is safe and does not escape the root directory.
 * Prevents directory traversal, null-byte injection, and symlink breakout.
 */
export function isSafePath(targetPath, rootDir) {
  if (!targetPath || typeof targetPath !== "string") return false
  if (!rootDir || typeof rootDir !== "string") return false
  if (targetPath.includes("\0")) return false // Null byte injection rejection

  const resolvedRoot = resolve(rootDir)
  const resolvedTarget = resolve(resolvedRoot, targetPath)
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep

  const isWindows = process.platform === "win32"
  const normTarget = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget
  const normRoot = isWindows ? resolvedRoot.toLowerCase() : resolvedRoot
  const normPrefix = isWindows ? rootPrefix.toLowerCase() : rootPrefix

  if (normTarget !== normRoot && !normTarget.startsWith(normPrefix)) {
    return false
  }

  // Canonical realpath check to prevent symlink traversal escaping root
  try {
    const realRoot = realpathSync(resolvedRoot)
    const realTarget = realpathSync(resolvedTarget)
    const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep
    const normRealTarget = isWindows ? realTarget.toLowerCase() : realTarget
    const normRealRoot = isWindows ? realRoot.toLowerCase() : realRoot
    const normRealRootPrefix = isWindows ? realRootPrefix.toLowerCase() : realRootPrefix
    if (normRealTarget !== normRealRoot && !normRealTarget.startsWith(normRealRootPrefix)) {
      return false
    }
  } catch {
    // Target does not exist yet on disk; prefix check on normalized resolved paths passed
  }

  return true
}

/**
 * Validates token using constant-time comparison to prevent timing attacks.
 */
export function isTokenValid(providedToken, expectedToken) {
  if (!providedToken || typeof providedToken !== "string") return false
  if (!expectedToken || typeof expectedToken !== "string") return false
  const providedBuf = Buffer.from(providedToken, "utf8")
  const expectedBuf = Buffer.from(expectedToken, "utf8")
  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf) // Constant-time dummy op
    return false
  }
  return timingSafeEqual(providedBuf, expectedBuf)
}

/**
 * Extracts authentication token from HTTP headers or URL query parameters.
 */
export function extractToken(req, url) {
  if (req && req.headers) {
    const authHeader = req.headers["authorization"]
    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i)
      if (match) return match[1].trim()
      return authHeader.trim()
    }
    const xBridgeToken = req.headers["x-bridge-token"]
    if (xBridgeToken && typeof xBridgeToken === "string") {
      return xBridgeToken.trim()
    }
  }
  if (url && url.searchParams) {
    const queryToken = url.searchParams.get("token")
    if (queryToken) return queryToken.trim()
  }
  return null
}

/**
 * Validates target URL against SSRF whitelist.
 */
export function isAllowedAiUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
    if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return false
    }
    return ALLOWED_AI_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function readBodyJson(req, res, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolveBody) => {
    let body = ""
    let size = 0
    let closed = false

    req.on("data", (chunk) => {
      if (closed) return
      size += chunk.length
      if (size > maxBytes) {
        closed = true
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Payload too large. Maximum allowed size is 5MB." }))
        req.destroy()
        resolveBody(null)
        return
      }
      body += chunk
    })

    req.on("end", () => {
      if (closed) return
      try {
        const payload = JSON.parse(body || "{}")
        resolveBody(payload)
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON: " + err.message }))
        resolveBody(null)
      }
    })

    req.on("error", () => {
      if (!closed) resolveBody(null)
    })
  })
}

/**
 * Creates and configures the local bridge HTTP and WebSocket server.
 */
export function createBridgeServer(options = {}) {
  const port = options.port !== undefined ? options.port : 8642
  const directory = options.directory ? resolve(options.directory) : null
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []
  const token =
    options.token ||
    process.env.SHADER_STUDIO_BRIDGE_TOKEN ||
    process.env.SHADER_STUDIO_TOKEN ||
    randomBytes(24).toString("hex")
  const quiet = !!options.quiet

  const browserClients = new Set()
  const agentClients = new Set()
  const pendingRequests = new Map()

  const server = createServer(async (req, res) => {
    // 1. Strict CORS origin validation
    const origin = req.headers.origin
    if (origin) {
      if (!isAllowedOrigin(origin, allowedOrigins)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden: CORS origin not allowed" }))
        return
      }
      res.setHeader("Access-Control-Allow-Origin", origin)
      res.setHeader("Vary", "Origin")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Bridge-Token")
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    const host = req.headers.host || `localhost:${port}`
    const url = new URL(req.url, `http://${host}`)

    // 2. Public Status Endpoint
    if (url.pathname === "/api/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          status: "online",
          browserClients: browserClients.size,
          agentClients: agentClients.size,
          watchedDirectory: directory || null,
        })
      )
      return
    }

    // 3. File retrieval endpoint with path traversal sanitization
    if (url.pathname === "/api/file" && req.method === "GET") {
      const providedToken = extractToken(req, url)
      if (!providedToken) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized: missing authentication token" }))
        return
      }
      if (!isTokenValid(providedToken, token)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden: invalid authentication token" }))
        return
      }

      const requestedPath = url.searchParams.get("path")
      if (!requestedPath) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing required 'path' query parameter" }))
        return
      }

      const root = directory || process.cwd()
      if (!isSafePath(requestedPath, root)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden: path escapes root boundary" }))
        return
      }

      const fullPath = resolve(root, requestedPath)
      try {
        const content = readFileSync(fullPath, "utf-8")
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        res.end(content)
      } catch (err) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: `File not found: ${err.message}` }))
      }
      return
    }

    // 4. Enforce mandatory authentication on RPC endpoints
    const protectedPaths = ["/api/agent/execute", "/api/agent/capture", "/api/ai/proxy"]
    if (protectedPaths.includes(url.pathname)) {
      const providedToken = extractToken(req, url)
      if (!providedToken) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized: missing authentication token" }))
        return
      }
      if (!isTokenValid(providedToken, token)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden: invalid authentication token" }))
        return
      }
    }

    if (url.pathname === "/api/agent/execute" && req.method === "POST") {
      const payload = await readBodyJson(req, res)
      if (!payload) return

      if (!payload.source) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing required 'source' field in JSON body" }))
        return
      }

      if (payload.path && directory && !isSafePath(payload.path, directory)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden: path escapes root boundary" }))
        return
      }

      if (browserClients.size === 0) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "No Shader Studio client connected in browser. Open http://localhost:5173 first.",
          })
        )
        return
      }

      const id = "rpc_" + crypto.randomUUID()
      const msg = {
        type: "agent:execute",
        id,
        source: payload.source,
        backend: payload.backend,
        uniforms: payload.uniforms,
        captureSnapshot: payload.captureSnapshot !== false,
        snapshotOptions: payload.snapshotOptions,
      }

      const timer = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          res.writeHead(504, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Timed out waiting for Shader Studio render response" }))
        }
      }, 10000)

      pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(result))
        },
        reject: (statusCode, message) => {
          clearTimeout(timer)
          res.writeHead(statusCode, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: message }))
        },
      })

      const serialized = JSON.stringify(msg)
      for (const client of browserClients) {
        client.send(serialized)
      }
      return
    }

    if (url.pathname === "/api/agent/capture" && req.method === "POST") {
      const payload = await readBodyJson(req, res)
      if (!payload) return

      if (browserClients.size === 0) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "No Shader Studio browser client connected." }))
        return
      }

      const id = "cap_" + crypto.randomUUID()
      const msg = {
        type: "agent:capture",
        id,
        snapshotOptions: payload.snapshotOptions,
      }

      const timer = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          res.writeHead(504, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Timed out waiting for capture response" }))
        }
      }, 8000)

      pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(result))
        },
        reject: (statusCode, message) => {
          clearTimeout(timer)
          res.writeHead(statusCode, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: message }))
        },
      })

      const serialized = JSON.stringify(msg)
      for (const client of browserClients) {
        client.send(serialized)
      }
      return
    }

    if (url.pathname === "/api/ai/proxy" && req.method === "POST") {
      const payload = await readBodyJson(req, res)
      if (!payload) return

      const targetUrl = payload.targetUrl
      const headers = payload.headers || {}
      const data = payload.body

      if (!targetUrl) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing required 'targetUrl'" }))
        return
      }

      if (!isAllowedAiUrl(targetUrl)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "Forbidden: targetUrl domain is not in the allowed AI provider list.",
          })
        )
        return
      }

      try {
        const fetchResponse = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: typeof data === "string" ? data : JSON.stringify(data),
        })

        const text = await fetchResponse.text()
        res.writeHead(fetchResponse.status, { "Content-Type": "application/json" })
        res.end(text)
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: `Proxy failed: ${err.message}` }))
      }
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Endpoint not found" }))
  })

  // WebSocket Server Setup with Upgrade Interception
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    // 1. Origin check on upgrade
    const origin = req.headers.origin
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }

    // 2. Token check on upgrade
    const host = req.headers.host || `localhost:${port}`
    const url = new URL(req.url, `http://${host}`)
    const providedToken = extractToken(req, url)

    if (!providedToken) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(4401, "Unauthorized: missing authentication token")
      })
      return
    }

    if (!isTokenValid(providedToken, token)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(4401, "Forbidden: invalid authentication token")
      })
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req)
    })
  })

  function getShaderFiles(dir, root = dir) {
    if (!dir || !root) return []
    if (!isSafePath(dir, root)) return []
    const files = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (isSafePath(fullPath, root)) {
            files.push(...getShaderFiles(fullPath, root))
          }
        } else if (SHADER_EXTENSIONS.includes(extname(entry.name))) {
          if (isSafePath(fullPath, root)) {
            files.push(fullPath)
          }
        }
      }
    } catch {
      /* ignore */
    }
    return files
  }

  function broadcastFile(filePath, root = directory) {
    if (root && !isSafePath(filePath, root)) {
      if (!quiet) console.warn(`[Bridge] Blocked path traversal file read: ${filePath}`)
      return
    }
    try {
      const message = JSON.stringify({ type: "file", path: filePath, content: readFileSync(filePath, "utf-8") })
      for (const client of browserClients) client.send(message)
      if (!quiet) console.log(`[Bridge] Broadcast file: ${filePath}`)
    } catch (e) {
      if (!quiet) console.error(`[Bridge] Error reading file ${filePath}:`, e.message)
    }
  }

  wss.on("connection", (ws, req) => {
    const host = req.headers.host || `localhost:${port}`
    const url = new URL(req.url, `http://${host}`)
    const isAgent = url.searchParams.get("role") === "agent"

    if (isAgent) {
      agentClients.add(ws)
      if (!quiet) console.log(`[Bridge] External AI Agent connected (${agentClients.size} agent(s))`)
    } else {
      browserClients.add(ws)
      if (!quiet) console.log(`[Bridge] Browser Studio connected (${browserClients.size} client(s))`)
    }

    if (directory && !isAgent) {
      const files = getShaderFiles(directory, directory)
      ws.send(JSON.stringify({ type: "list", files }))
      if (files.length > 0) broadcastFile(files[0], directory)
    }

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString())

        // Response feedback from browser to pending HTTP RPC request
        if (data.type === "agent:feedback" && data.id) {
          const pending = pendingRequests.get(data.id)
          if (pending) {
            pendingRequests.delete(data.id)
            pending.resolve(data)
          }
          for (const agent of agentClients) {
            agent.send(JSON.stringify(data))
          }
          return
        }

        // If an external agent sends an execute/capture request over WebSocket
        if ((data.type === "agent:execute" || data.type === "agent:capture") && isAgent) {
          for (const client of browserClients) {
            client.send(JSON.stringify(data))
          }
        }
      } catch {
        /* ignore invalid JSON */
      }
    })

    ws.on("close", () => {
      browserClients.delete(ws)
      agentClients.delete(ws)
      if (!quiet) {
        console.log(`[Bridge] Client disconnected (Remaining: ${browserClients.size} browser, ${agentClients.size} agent)`)
      }

      if (browserClients.size === 0 && pendingRequests.size > 0) {
        for (const [id, pending] of pendingRequests.entries()) {
          pendingRequests.delete(id)
          if (pending.reject) {
            pending.reject(503, "Shader Studio browser client disconnected while processing request")
          }
        }
      }
    })
  })

  let watcher = null
  if (directory) {
    try {
      watcher = watch(directory, { recursive: true }, (event, filename) => {
        if (!filename) return
        const ext = extname(filename)
        if (!SHADER_EXTENSIONS.includes(ext)) return
        if (!isSafePath(filename, directory)) return
        const fullPath = join(directory, filename)
        try {
          const stat = statSync(fullPath)
          if (stat.isFile()) broadcastFile(fullPath, directory)
        } catch {
          /* file deleted */
        }
      })
    } catch (e) {
      if (!quiet) console.warn(`[Bridge] Could not watch directory "${directory}":`, e.message)
    }
  }

  return {
    server,
    wss,
    token,
    port,
    directory,
    browserClients,
    agentClients,
    close: () =>
      new Promise((resolveClose) => {
        if (watcher) watcher.close()
        for (const client of browserClients) client.terminate()
        for (const client of agentClients) client.terminate()
        wss.close(() => {
          server.close(() => resolveClose())
        })
      }),
    listen: (targetPort = port) =>
      new Promise((resolveListen) => {
        server.on("error", (err) => {
          console.error(`[bridge] server error: ${err.message}`)
          process.exit(1)
        })
        server.listen(targetPort, "127.0.0.1", () => {
          const boundPort = server.address().port
          if (!quiet) {
            console.log(`=======================================================`)
            console.log(`🚀 Shader Studio Bridge & Agent Server online on :${boundPort}`)
            console.log(`🔑 Ephemeral Auth Token: ${token}`)
            console.log(`📡 WebSocket: ws://localhost:${boundPort}?token=${token}`)
            console.log(`⚡ Agent REST API: http://localhost:${boundPort}/api/agent/execute`)
            if (directory) {
              console.log(`📂 Watching directory: ${directory}`)
            }
            console.log(`=======================================================`)
          }
          resolveListen(boundPort)
        })
      }),
  }
}

// Auto-run if executed directly via node scripts/bridge.js
const isDirectRun =
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("bridge.js"))

if (isDirectRun && process.env.NODE_ENV !== "test") {
  const args = process.argv.slice(2)
  const portArgIndex = args.indexOf("--port")
  const parsedPort = portArgIndex !== -1 ? parseInt(args[portArgIndex + 1], 10) : 8642

  const tokenArgIndex = args.indexOf("--token")
  const parsedToken = tokenArgIndex !== -1 ? args[tokenArgIndex + 1] : undefined

  const originArgIndex = args.indexOf("--allowed-origin")
  const parsedOrigin = originArgIndex !== -1 ? [args[originArgIndex + 1]] : []

  const directoryArg = args.find(
    (arg) =>
      !arg.startsWith("--") &&
      arg !== (portArgIndex !== -1 ? args[portArgIndex + 1] : "") &&
      arg !== (tokenArgIndex !== -1 ? args[tokenArgIndex + 1] : "") &&
      arg !== (originArgIndex !== -1 ? args[originArgIndex + 1] : "")
  )

  const bridge = createBridgeServer({
    port: parsedPort,
    token: parsedToken,
    allowedOrigins: parsedOrigin,
    directory: directoryArg,
  })

  bridge.listen(parsedPort)
}
