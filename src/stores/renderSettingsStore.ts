import { create } from "zustand"
import type { RenderSettings } from "@/adapters/types"

/** Defaults mirror the values the adapters initialise their own state with. */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  renderMode: "forward",
  shadows: { enabled: false, resolution: 2048, filterMode: "pcf", bias: 0.005, normalBias: 0.01, pointShadows: false },
  antiAliasing: "none",
  ssao: { enabled: false, radius: 0.5, intensity: 1.5, sampleCount: 16, bias: 0.025 },
  ssr: { enabled: false, maxSteps: 64, thickness: 0.02, falloff: 0.8, iblBlend: 0.5 },
  dof: { enabled: false, focalDistance: 5.0, aperture: 0.05, bokehShape: "circle", maxBlur: 8 },
  atmosphere: { timeOfDay: 12.0, sunIntensity: 1.0, turbidity: 2.5, solarElevationDeg: 90.0 },
  gbufferDebugView: "none",
}

type SettingsSection = "shadows" | "ssao" | "ssr" | "dof" | "atmosphere"

interface RenderSettingsState {
  settings: RenderSettings
  setRenderMode: (mode: RenderSettings["renderMode"]) => void
  setAntiAliasing: (mode: RenderSettings["antiAliasing"]) => void
  setGBufferDebugView: (view: RenderSettings["gbufferDebugView"]) => void
  /** Shallow-merges a patch into one settings section (shadows, ssao, ssr, dof, atmosphere). */
  updateSection: <K extends SettingsSection>(section: K, patch: Partial<RenderSettings[K]>) => void
  reset: () => void
}

export const useRenderSettingsStore = create<RenderSettingsState>((set) => ({
  settings: DEFAULT_RENDER_SETTINGS,
  setRenderMode: (renderMode) => set((s) => ({ settings: { ...s.settings, renderMode } })),
  setAntiAliasing: (antiAliasing) => set((s) => ({ settings: { ...s.settings, antiAliasing } })),
  setGBufferDebugView: (gbufferDebugView) => set((s) => ({ settings: { ...s.settings, gbufferDebugView } })),
  updateSection: (section, patch) =>
    set((s) => ({ settings: { ...s.settings, [section]: { ...s.settings[section], ...patch } } })),
  reset: () => set({ settings: DEFAULT_RENDER_SETTINGS }),
}))
