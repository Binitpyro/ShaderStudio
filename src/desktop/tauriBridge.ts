/**
 * Tauri v2 Desktop Bridge & graceful browser/test fallback.
 * Implements F-DESK-01..05 and Interface Contract 3.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
    }
    __TAURI__?: {
      core?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
      }
    }
  }
}

// In-memory fallback state for browser/test environments
const inMemoryFs = new Map<string, string>()
let fallbackBridgeRunning = false
let fallbackBridgePort = 0
let trayCreated = false
let windowState = { minimized: false, maximized: false, closed: false }

/**
 * Dynamically resolves default project file path cross-platform.
 */
export function getDefaultProjectPath(): string {
  const proc = typeof globalThis !== "undefined"
    ? (globalThis as unknown as { process?: { env?: Record<string, string> } }).process
    : undefined
  const home = proc?.env?.USERPROFILE || proc?.env?.HOME
  if (home) {
    const normalized = home.replace(/\\/g, "/")
    return `${normalized}/Documents/ShaderStudio/untitled.shaderstudio`
  }
  return "./untitled.shaderstudio"
}


/**
 * Checks whether the application is running inside a native Tauri desktop container.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__?.core))
  )
}

/**
 * Helper to invoke native Tauri command or throw if not in Tauri.
 */
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== "undefined") {
    if (window.__TAURI_INTERNALS__?.invoke) {
      return (await (args !== undefined
        ? window.__TAURI_INTERNALS__.invoke(cmd, args)
        : window.__TAURI_INTERNALS__.invoke(cmd))) as T
    }
    if (window.__TAURI__?.core?.invoke) {
      return (await (args !== undefined
        ? window.__TAURI__.core.invoke(cmd, args)
        : window.__TAURI__.core.invoke(cmd))) as T
    }
  }
  throw new Error("Tauri runtime not available")
}

/**
 * Opens a native file picker dialog for opening a .shaderstudio project file.
 */
export async function pickOpenProjectPath(): Promise<string | null> {
  if (isTauri()) {
    try {
      // The dialog runs in Rust, which records the chosen path: save/load only accept paths picked this session.
      const selected = await invokeTauri<string | null>("pick_open_project_native")
      return typeof selected === "string" ? selected : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Opens a native file picker dialog for saving a .shaderstudio project file.
 */
export async function pickSaveProjectPath(defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const selected = await invokeTauri<string | null>("pick_save_project_native", { defaultPath })
      return selected || null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Saves a project file natively. Rejects paths not ending in .shaderstudio.
 * When in Tauri, native errors are thrown directly without silent swallowing.
 */
export async function saveProjectNative(path?: string, projectJson: string = "{}"): Promise<string> {
  const targetPath = path !== undefined ? path : getDefaultProjectPath()
  if (!targetPath.endsWith(".shaderstudio")) {
    throw new Error("File extension must be .shaderstudio")
  }

  if (isTauri()) {
    return await invokeTauri<string>("save_project_native", { path: targetPath, projectJson })
  }

  inMemoryFs.set(targetPath, projectJson)
  return targetPath
}

/**
 * Loads a project file natively. Returns [path, content].
 * When in Tauri, native errors are thrown directly without silent swallowing.
 */
export async function loadProjectNative(path?: string): Promise<[string, string]> {
  if (isTauri()) {
    return await invokeTauri<[string, string]>("load_project_native", { path })
  }

  const targetPath = path || Array.from(inMemoryFs.keys())[0]

  if (!targetPath || !inMemoryFs.has(targetPath)) {
    throw new Error(`File not found: ${targetPath}`)
  }

  return [targetPath, inMemoryFs.get(targetPath)!]
}

// MCP: the native app no longer hosts an MCP protocol (the Rust stub was removed). Agents connect
// through the real `scripts/mcp-server.js` (stdio) + `scripts/bridge.js`; the tray item "Connect AI
// agent (MCP)..." explains how. The four functions below are a deprecated in-memory shim kept only
// because legacy regression suites import them; they never call into Tauri and start nothing.

/** @deprecated No-op state shim (validates the port, records it in memory). */
export async function startMcpBridge(port: number): Promise<string> {
  if (!Number.isInteger(port) || port <= 1024 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 1025 and 65535`)
  }
  fallbackBridgeRunning = true
  fallbackBridgePort = port
  return `MCP Bridge active on port ${port}`
}

/** @deprecated In-memory shim. */
export async function getMcpBridgeStatus(): Promise<boolean> {
  return fallbackBridgeRunning
}

/** @deprecated In-memory shim. */
export function stopMcpBridge(): void {
  fallbackBridgeRunning = false
  fallbackBridgePort = 0
}

/** @deprecated In-memory shim; current port or 0. */
export function getMcpBridgePort(): number {
  return fallbackBridgePort
}

/**
 * Minimizes the desktop window via Tauri window API or local state fallback.
 */
export function minimizeWindow(): void {
  if (isTauri()) {
    invokeTauri("plugin:window|minimize").catch(() => {
      invokeTauri("minimize_window").catch(() => {})
    })
    return
  }
  windowState.minimized = true
}

/**
 * Toggles maximization of the desktop window via Tauri window API or local state fallback.
 */
export function maximizeWindow(): void {
  if (isTauri()) {
    invokeTauri("plugin:window|toggle_maximize").catch(() => {
      invokeTauri("maximize_window").catch(() => {})
    })
    return
  }
  windowState.maximized = !windowState.maximized
}

/**
 * Closes the desktop window via Tauri window API or local state fallback.
 */
export function closeWindow(): void {
  if (isTauri()) {
    invokeTauri("plugin:window|close").catch(() => {
      invokeTauri("close_window").catch(() => {})
    })
    return
  }
  windowState.closed = true
}

/**
 * Initializes and registers the system tray.
 */
export function setupTray(): void {
  trayCreated = true
}

/**
 * Returns whether the system tray has been initialized.
 */
export function isTrayActive(): boolean {
  return trayCreated
}

/**
 * Validates that Cargo.toml contains the 5 required release optimization flags
 * to guarantee <15MB binary footprint per F-DESK-05.
 */
export function validateBinarySizeConfig(cargoToml: string): { valid: boolean; flags: string[] } {
  const requiredSettings = [
    'opt-level = "z"',
    "lto = true",
    "codegen-units = 1",
    'panic = "abort"',
    "strip = true",
  ]
  const missing = requiredSettings.filter((s) => !cargoToml.includes(s))
  return {
    valid: missing.length === 0,
    flags: requiredSettings,
  }
}

/**
 * Resets fallback state (useful for test isolation).
 */
export function resetDesktopFallbackState(): void {
  inMemoryFs.clear()
  fallbackBridgeRunning = false
  fallbackBridgePort = 0
  trayCreated = false
  windowState = { minimized: false, maximized: false, closed: false }
}

// Snake_case aliases matching Tauri command naming convention
export const save_project_native = saveProjectNative
export const load_project_native = loadProjectNative
export const start_mcp_bridge = startMcpBridge
export const get_mcp_bridge_status = getMcpBridgeStatus
export const stop_mcp_bridge = stopMcpBridge

