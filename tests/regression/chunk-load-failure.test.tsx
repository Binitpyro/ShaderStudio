/**
 * w3-fixup M2: lazy chunk-load failures (adapters, audio engine) surface an error and a later call retries,
 * instead of a blank viewport / a rejected promise cached forever.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const chunk = vi.hoisted(() => ({ failAdapter: true, failAudio: true }))
vi.mock("@/adapters/threejs", () => {
  if (chunk.failAdapter) throw new Error("Failed to fetch dynamically imported module: threejs")
  return { threejsAdapter: { id: "threejs" } }
})
vi.mock("@/audio/audioEngine", async () => {
  if (chunk.failAudio) throw new Error("Failed to fetch dynamically imported module: audioEngine")
  return { audioEngine: { id: "engine" } }
})
vi.mock("@/adapters/webgpu", () => ({ webgpuAdapter: { id: "webgpu" } }))
vi.mock("@/adapters/webgl2", () => ({ webgl2Adapter: { id: "webgl2" } }))

import { loadAdapter, getActiveAdapter } from "@/adapters/activeAdapter"
import { loadAudioEngine, withAudioEngine } from "@/audio/audioRegistry"
import { Viewport } from "@/components/Viewport"
import { useProjectStore } from "@/stores/projectStore"

const internals = () => (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

describe("Viewport surfaces an adapter chunk-load failure", () => {
  it("sets lastCompileError and shows the banner instead of a silent blank viewport", async () => {
    chunk.failAdapter = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    useProjectStore.setState({ activeBackend: "threejs", lastCompileError: null })

    const effects: Array<() => unknown> = []
    const notices: unknown[] = []
    function Probe() {
      const original = internals().H
      let n = 0
      internals().H = {
        ...original,
        useEffect: (e: () => unknown) => void effects.push(e),
        useRef: () => ({ current: {} }), // a (fake) canvas so the mount effect proceeds to loadAdapter
        useState: (init: unknown) => {
          const i = n++
          return [typeof init === "function" ? (init as () => unknown)() : init, (v: unknown) => { if (i === 0) notices.push(v) }]
        },
      }
      try { (Viewport as any)({}) } finally { internals().H = original }
      return null
    }
    renderToStaticMarkup(React.createElement(Probe))
    for (const e of effects) { try { e() } catch { /* unrelated effects need a DOM */ } }

    await vi.waitFor(() => expect(useProjectStore.getState().lastCompileError).toMatch(/Failed to load the threejs renderer/))
    expect(notices.some((v) => typeof v === "string" && v.includes("threejs"))).toBe(true)
    expect(getActiveAdapter()).toBeNull()
    err.mockRestore()
  })
})

describe("lazy registries drop rejected loads", () => {
  beforeEach(() => { chunk.failAdapter = true; chunk.failAudio = true })

  it("loadAdapter rejects on a failed chunk and succeeds on retry", async () => {
    await expect(loadAdapter("threejs")).rejects.toThrow()
    chunk.failAdapter = false
    vi.resetModules()
    await expect(loadAdapter("threejs")).resolves.toMatchObject({ id: "threejs" })
  })

  it("loadAudioEngine does not cache the rejection; withAudioEngine swallows and logs it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(loadAudioEngine()).rejects.toThrow()
    withAudioEngine(() => {})
    await vi.waitFor(() => expect(err).toHaveBeenCalled())
    chunk.failAudio = false
    vi.resetModules()
    await expect(loadAudioEngine()).resolves.toMatchObject({ id: "engine" })
    err.mockRestore()
  })
})
