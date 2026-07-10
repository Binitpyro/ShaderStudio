#!/usr/bin/env node
import { createServer } from "http"
import { WebSocketServer } from "ws"
import { watch, readdirSync, readFileSync, statSync } from "fs"
import { join, extname } from "path"

const args = process.argv.slice(2)
const portArgIndex = args.indexOf("--port")
const port = portArgIndex !== -1 ? parseInt(args[portArgIndex + 1], 10) : 8642
const directory = args.find((arg) => !arg.startsWith("--") && arg !== args[portArgIndex + 1])

if (!directory) { console.error("Usage: node scripts/bridge.js <directory> [--port 8642]"); process.exit(1) }

const SHADER_EXTENSIONS = [".wgsl", ".glsl", ".frag", ".vert"]
const clients = new Set()
const server = createServer()
const wss = new WebSocketServer({ server })

function getShaderFiles(dir) {
  const files = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...getShaderFiles(fullPath))
      else if (SHADER_EXTENSIONS.includes(extname(entry.name))) files.push(fullPath)
    }
  } catch (e) { /* ignore */ }
  return files
}

function broadcastFile(filePath) {
  try {
    const message = JSON.stringify({ type: "file", path: filePath, content: readFileSync(filePath, "utf-8") })
    for (const client of clients) client.send(message)
    console.log(`Broadcast: ${filePath}`)
  } catch (e) { console.error(`Error reading file ${filePath}:`, e.message) }
}

wss.on("connection", (ws) => {
  clients.add(ws)
  console.log(`Client connected (${clients.size} total)`)
  const files = getShaderFiles(directory)
  ws.send(JSON.stringify({ type: "list", files }))
  if (files.length > 0) broadcastFile(files[0])
  ws.on("close", () => { clients.delete(ws); console.log(`Client disconnected (${clients.size} total)`) })
})

watch(directory, { recursive: true }, (event, filename) => {
  if (!filename) return
  const ext = extname(filename)
  if (!SHADER_EXTENSIONS.includes(ext)) return
  const fullPath = join(directory, filename)
  try {
    const stat = statSync(fullPath)
    if (stat.isFile()) broadcastFile(fullPath)
  } catch { /* file deleted */ }
})

server.listen(port, () => {
  console.log(`Shader Studio Bridge running on ws://localhost:${port}`)
  console.log(`Watching: ${directory}`)
  console.log(`Extensions: ${SHADER_EXTENSIONS.join(", ")}`)
})
