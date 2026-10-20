import type { ComputePreset } from "@/core/graphCompiler"
import curlNoiseWgsl from "../shaders/compute/curl_noise.wgsl?raw"
import gravityWgsl from "../shaders/compute/gravity_attractor.wgsl?raw"
import boidsWgsl from "../shaders/compute/boids.wgsl?raw"
import galaxyWgsl from "../shaders/compute/galaxy.wgsl?raw"
import defaultComputeWgsl from "../shaders/compute/default.compute.wgsl?raw"
import audioVortexWgsl from "../shaders/compute/audio_vortex.wgsl?raw"

export function getComputePresetCode(preset: ComputePreset, customSource?: string): string {
  switch (preset) {
    case "curl_noise": return curlNoiseWgsl
    case "gravity": return gravityWgsl
    case "boids": return boidsWgsl
    case "galaxy": return galaxyWgsl
    case "audio_vortex": return audioVortexWgsl
    case "custom": return customSource || defaultComputeWgsl
    default: return curlNoiseWgsl
  }
}
