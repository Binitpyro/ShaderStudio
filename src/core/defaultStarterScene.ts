import type { Node, Edge } from "@xyflow/react"
import type { GraphNodeData } from "@/core/graphCompiler"
import type { ProjectData, UniformValue, PresetVariation, AudioBinding, EnvironmentSettings } from "@/stores/projectStore"
import starterWgslSource from "@/shaders/starter.wgsl?raw"
import starterFragSource from "@/shaders/starter.frag?raw"
import starterVertSource from "@/shaders/starter.vert?raw"

export const STARTER_WGSL = starterWgslSource
export const STARTER_GLSL = starterFragSource
export const STARTER_VERT_GLSL = starterVertSource

export const STARTER_NODES: Node<GraphNodeData>[] = [
  {
    id: "mesh-1",
    type: "mesh",
    position: { x: 50, y: 60 },
    data: { type: "mesh", geometry: "torus_knot" },
  },
  {
    id: "audio-1",
    type: "audio",
    position: { x: 50, y: 250 },
    data: {
      type: "audio",
      sourceType: "builtin",
      volume: 0.8,
      gain: 1.2,
      smoothing: 0.8,
    },
  },
  {
    id: "material-1",
    type: "material",
    position: { x: 270, y: 130 },
    data: { type: "material", shaderPath: "starter.wgsl" },
  },
  {
    id: "postprocess-1",
    type: "postprocess",
    position: { x: 490, y: 0 },
    data: {
      type: "postprocess",
      passType: "bloom",
      params: { intensity: 0.75, threshold: 0.55 },
    },
  },
  {
    id: "postprocess-2",
    type: "postprocess",
    position: { x: 490, y: 190 },
    data: {
      type: "postprocess",
      passType: "vignette",
      params: { intensity: 0.45, radius: 0.85 },
    },
  },
  {
    id: "output-1",
    type: "output",
    position: { x: 490, y: 390 },
    data: { type: "output" },
  },
]

export const STARTER_EDGES: Edge[] = [
  { id: "e-mesh-mat", source: "mesh-1", target: "material-1", sourceHandle: null, targetHandle: "mesh" },
  { id: "e-aud-mat", source: "audio-1", target: "material-1", sourceHandle: null, targetHandle: "audio" },
  { id: "e-mat-pp1", source: "material-1", target: "postprocess-1", sourceHandle: null, targetHandle: null },
  { id: "e-pp1-pp2", source: "postprocess-1", target: "postprocess-2", sourceHandle: null, targetHandle: null },
  { id: "e-pp2-out", source: "postprocess-2", target: "output-1", sourceHandle: null, targetHandle: null },
]

export const STARTER_UNIFORMS: Record<string, UniformValue> = {
  color: { type: "color", value: [0.1, 0.75, 1.0] },
  u_color: { type: "color", value: [0.1, 0.75, 1.0] },
  fresnelPower: { type: "float", value: 2.8 },
  u_fresnelPower: { type: "float", value: 2.8 },
  iridescence: { type: "float", value: 1.6 },
  u_iridescence: { type: "float", value: 1.6 },
  roughness: { type: "float", value: 0.2 },
  u_roughness: { type: "float", value: 0.2 },
  pulseSpeed: { type: "float", value: 1.5 },
  u_pulseSpeed: { type: "float", value: 1.5 },
  u_audio_bass: { type: "float", value: 0.0 },
  u_audio_mid: { type: "float", value: 0.0 },
  u_audio_treble: { type: "float", value: 0.0 },
  u_audio_beat: { type: "float", value: 0.0 },
}

export const STARTER_AUDIO_BINDINGS: Record<string, AudioBinding> = {
  u_audio_bass: { band: "bass", amount: 1.0 },
  u_audio_mid: { band: "mid", amount: 1.0 },
  u_audio_treble: { band: "treble", amount: 1.0 },
  u_audio_beat: { band: "beat", amount: 1.0 },
}

export const STARTER_VARIATIONS: PresetVariation[] = [
  {
    id: "var-liquid-chrome",
    name: "Liquid Chrome",
    createdAt: 1700000000001,
    uniformValues: {
      color: { type: "color", value: [0.88, 0.92, 0.98] },
      u_color: { type: "color", value: [0.88, 0.92, 0.98] },
      fresnelPower: { type: "float", value: 3.5 },
      u_fresnelPower: { type: "float", value: 3.5 },
      iridescence: { type: "float", value: 1.1 },
      u_iridescence: { type: "float", value: 1.1 },
      roughness: { type: "float", value: 0.08 },
      u_roughness: { type: "float", value: 0.08 },
      pulseSpeed: { type: "float", value: 1.0 },
      u_pulseSpeed: { type: "float", value: 1.0 },
    },
  },
  {
    id: "var-cyber-neon",
    name: "Cyber Neon",
    createdAt: 1700000000002,
    uniformValues: {
      color: { type: "color", value: [0.0, 0.95, 1.0] },
      u_color: { type: "color", value: [0.0, 0.95, 1.0] },
      fresnelPower: { type: "float", value: 1.8 },
      u_fresnelPower: { type: "float", value: 1.8 },
      iridescence: { type: "float", value: 2.2 },
      u_iridescence: { type: "float", value: 2.2 },
      roughness: { type: "float", value: 0.15 },
      u_roughness: { type: "float", value: 0.15 },
      pulseSpeed: { type: "float", value: 2.4 },
      u_pulseSpeed: { type: "float", value: 2.4 },
    },
  },
  {
    id: "var-molten-gold",
    name: "Molten Gold",
    createdAt: 1700000000003,
    uniformValues: {
      color: { type: "color", value: [1.0, 0.65, 0.08] },
      u_color: { type: "color", value: [1.0, 0.65, 0.08] },
      fresnelPower: { type: "float", value: 2.4 },
      u_fresnelPower: { type: "float", value: 2.4 },
      iridescence: { type: "float", value: 0.75 },
      u_iridescence: { type: "float", value: 0.75 },
      roughness: { type: "float", value: 0.28 },
      u_roughness: { type: "float", value: 0.28 },
      pulseSpeed: { type: "float", value: 1.2 },
      u_pulseSpeed: { type: "float", value: 1.2 },
    },
  },
  {
    id: "var-bioluminescent",
    name: "Bioluminescent",
    createdAt: 1700000000004,
    uniformValues: {
      color: { type: "color", value: [0.12, 0.88, 0.68] },
      u_color: { type: "color", value: [0.12, 0.88, 0.68] },
      fresnelPower: { type: "float", value: 4.2 },
      u_fresnelPower: { type: "float", value: 4.2 },
      iridescence: { type: "float", value: 2.6 },
      u_iridescence: { type: "float", value: 2.6 },
      roughness: { type: "float", value: 0.32 },
      u_roughness: { type: "float", value: 0.32 },
      pulseSpeed: { type: "float", value: 0.85 },
      u_pulseSpeed: { type: "float", value: 0.85 },
    },
  },
]

export const STARTER_ENVIRONMENT: EnvironmentSettings = {
  preset: "studio_warm",
  exposure: 1.2,
  rotation: 45.0,
  backgroundBlur: 0.0,
  showSkybox: false,
}

export function createStarterProjectData(): ProjectData {
  return {
    name: "Iridescent Torus Hero",
    version: "1.0",
    backend: "webgpu",
    graphNodes: STARTER_NODES,
    graphEdges: STARTER_EDGES,
    uniformValues: STARTER_UNIFORMS,
    graphUniforms: [],
    shaderSources: {
      wgsl: STARTER_WGSL,
      glsl: STARTER_GLSL,
      vertex: STARTER_VERT_GLSL,
    },
    audioSettings: {
      sourceType: "builtin",
      volume: 0.8,
      gain: 1.2,
      smoothing: 0.8,
    },
    audioBindings: STARTER_AUDIO_BINDINGS,
    variations: STARTER_VARIATIONS,
    environmentSettings: STARTER_ENVIRONMENT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
