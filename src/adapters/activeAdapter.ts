import { useProjectStore } from "@/stores/projectStore"
import type { RenderAdapter } from "@/adapters/types"

type Backend = "webgpu" | "webgl2" | "threejs"

// All backends load lazily and register once loaded, keeping adapters (and three.js) out of the entry chunk.
const registry: Partial<Record<Backend, RenderAdapter>> = {}

/** Loads (once) and registers the adapter for a backend. */
export async function loadAdapter(backend: string): Promise<RenderAdapter> {
  if (backend === "webgl2") return (registry.webgl2 ??= (await import("@/adapters/webgl2")).webgl2Adapter as unknown as RenderAdapter)
  if (backend === "threejs") return (registry.threejs ??= (await import("@/adapters/threejs")).threejsAdapter as unknown as RenderAdapter)
  return (registry.webgpu ??= (await import("@/adapters/webgpu")).webgpuAdapter as unknown as RenderAdapter)
}

/** Adapter for the project's active backend, or null until loadAdapter() has resolved for it. */
export function getActiveAdapter(): RenderAdapter | null {
  return registry[useProjectStore.getState().activeBackend as Backend] ?? null
}

/** Already-loaded webgpu adapter (compute UI hooks); null before load, when Viewport compiles current state on mount. */
export function getLoadedWebgpuAdapter(): RenderAdapter | null {
  return registry.webgpu ?? null
}
