import type { Node, Edge } from "@xyflow/react"
import type { GraphNodeData } from "@/core/graphCompiler"

export type SubGraphPortType =
  | "mesh"
  | "texture"
  | "audio"
  | "float"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color"
  | "sampler2D"
  | "any"

export interface SubGraphPort {
  id: string
  name: string
  type: SubGraphPortType
  direction: "input" | "output"
  internalNodeId: string
  internalHandleId?: string
  defaultValue?: any
}

export interface SubGraphDefinition {
  id: string
  name: string
  description: string
  category: "Lighting" | "Procedural" | "Distortion" | "Utility" | "User"
  isBuiltin: boolean
  inputs: SubGraphPort[]
  outputs: SubGraphPort[]
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  uniforms?: Array<{ id: string; name: string; type: string; defaultValue: any }>
  version?: string
}

export interface SubGraphNodeData extends Record<string, unknown> {
  type: "subgraph"
  subGraphId: string
  name: string
  uniformValues?: Record<string, any>
  isCollapsed?: boolean
}

// ----------------------------------------------------------------------------
// Built-in Library Sub-graphs
// ----------------------------------------------------------------------------

export const BUILTIN_FRESNEL_RIM: SubGraphDefinition = {
  id: "builtin-fresnel-rim",
  name: "Fresnel Rim Lighting",
  description: "Calculates smooth Fresnel rim lighting based on surface normal, view direction, and falloff power.",
  category: "Lighting",
  isBuiltin: true,
  version: "1.0.0",
  inputs: [
    {
      id: "normal",
      name: "Normal",
      type: "vec3",
      direction: "input",
      internalNodeId: "mat_rim",
      internalHandleId: "normal",
      defaultValue: [0, 0, 1],
    },
    {
      id: "power",
      name: "Power",
      type: "float",
      direction: "input",
      internalNodeId: "u_power",
      internalHandleId: "value",
      defaultValue: 3.0,
    },
    {
      id: "rimColor",
      name: "Rim Color",
      type: "color",
      direction: "input",
      internalNodeId: "u_color",
      internalHandleId: "value",
      defaultValue: [0.2, 0.8, 1.0],
    },
  ],
  outputs: [
    {
      id: "rimOutput",
      name: "Rim Output",
      type: "color",
      direction: "output",
      internalNodeId: "mat_rim",
      internalHandleId: "color",
    },
  ],
  nodes: [
    {
      id: "mesh_rim",
      type: "mesh",
      position: { x: 50, y: 100 },
      data: { type: "mesh", geometry: "torus_knot" },
    },
    {
      id: "u_power",
      type: "uniform",
      position: { x: 50, y: 220 },
      data: {
        type: "uniform",
        uniformId: "power",
        name: "power",
        uniformType: "float",
        defaultValue: 3.0,
      },
    },
    {
      id: "u_color",
      type: "uniform",
      position: { x: 50, y: 340 },
      data: {
        type: "uniform",
        uniformId: "rimColor",
        name: "rimColor",
        uniformType: "color",
        defaultValue: [0.2, 0.8, 1.0],
      },
    },
    {
      id: "mat_rim",
      type: "material",
      position: { x: 300, y: 150 },
      data: { type: "material", shaderPath: "builtin/fresnel_rim.wgsl" },
    },
  ],
  edges: [
    { id: "e1", source: "mesh_rim", target: "mat_rim", targetHandle: "mesh" },
    { id: "e2", source: "u_power", target: "mat_rim" },
    { id: "e3", source: "u_color", target: "mat_rim" },
  ],
}

export const BUILTIN_NOISE_GEN: SubGraphDefinition = {
  id: "builtin-noise-gen",
  name: "Noise Generator",
  description: "Procedural pseudo-random 2D noise generator with configurable scale and animation speed.",
  category: "Procedural",
  isBuiltin: true,
  version: "1.0.0",
  inputs: [
    {
      id: "uv",
      name: "UV",
      type: "vec2",
      direction: "input",
      internalNodeId: "mat_noise",
      internalHandleId: "uv",
      defaultValue: [0, 0],
    },
    {
      id: "scale",
      name: "Scale",
      type: "float",
      direction: "input",
      internalNodeId: "u_scale",
      internalHandleId: "value",
      defaultValue: 10.0,
    },
    {
      id: "speed",
      name: "Speed",
      type: "float",
      direction: "input",
      internalNodeId: "u_speed",
      internalHandleId: "value",
      defaultValue: 1.0,
    },
  ],
  outputs: [
    {
      id: "noise",
      name: "Noise Output",
      type: "float",
      direction: "output",
      internalNodeId: "mat_noise",
      internalHandleId: "color",
    },
  ],
  nodes: [
    {
      id: "time_noise",
      type: "time",
      position: { x: 50, y: 80 },
      data: { type: "time" },
    },
    {
      id: "u_scale",
      type: "uniform",
      position: { x: 50, y: 180 },
      data: {
        type: "uniform",
        uniformId: "scale",
        name: "scale",
        uniformType: "float",
        defaultValue: 10.0,
      },
    },
    {
      id: "u_speed",
      type: "uniform",
      position: { x: 50, y: 280 },
      data: {
        type: "uniform",
        uniformId: "speed",
        name: "speed",
        uniformType: "float",
        defaultValue: 1.0,
      },
    },
    {
      id: "mesh_quad",
      type: "mesh",
      position: { x: 50, y: 380 },
      data: { type: "mesh", geometry: "plane" },
    },
    {
      id: "mat_noise",
      type: "material",
      position: { x: 300, y: 180 },
      data: { type: "material", shaderPath: "builtin/noise_gen.wgsl" },
    },
  ],
  edges: [
    { id: "ne1", source: "mesh_quad", target: "mat_noise", targetHandle: "mesh" },
    { id: "ne2", source: "time_noise", target: "mat_noise" },
    { id: "ne3", source: "u_scale", target: "mat_noise" },
    { id: "ne4", source: "u_speed", target: "mat_noise" },
  ],
}

export const BUILTIN_UV_DISTORTION: SubGraphDefinition = {
  id: "builtin-uv-distortion",
  name: "UV Distortion",
  description: "Distorts standard UV texture coordinates using normal or flow map displacement.",
  category: "Distortion",
  isBuiltin: true,
  version: "1.0.0",
  inputs: [
    {
      id: "uv",
      name: "UV",
      type: "vec2",
      direction: "input",
      internalNodeId: "mat_distort",
      internalHandleId: "uv",
      defaultValue: [0, 0],
    },
    {
      id: "strength",
      name: "Strength",
      type: "float",
      direction: "input",
      internalNodeId: "u_strength",
      internalHandleId: "value",
      defaultValue: 0.05,
    },
    {
      id: "distortionTex",
      name: "Distortion Map",
      type: "texture",
      direction: "input",
      internalNodeId: "tex_distort",
      internalHandleId: "src",
      defaultValue: null,
    },
  ],
  outputs: [
    {
      id: "distortedUv",
      name: "Distorted UV",
      type: "vec2",
      direction: "output",
      internalNodeId: "mat_distort",
      internalHandleId: "output",
    },
  ],
  nodes: [
    {
      id: "mesh_plane",
      type: "mesh",
      position: { x: 50, y: 50 },
      data: { type: "mesh", geometry: "plane" },
    },
    {
      id: "tex_distort",
      type: "texture",
      position: { x: 50, y: 150 },
      data: { type: "texture", textureId: "tex_flow", name: "flowMap" },
    },
    {
      id: "u_strength",
      type: "uniform",
      position: { x: 50, y: 260 },
      data: {
        type: "uniform",
        uniformId: "strength",
        name: "strength",
        uniformType: "float",
        defaultValue: 0.05,
      },
    },
    {
      id: "mat_distort",
      type: "material",
      position: { x: 300, y: 150 },
      data: { type: "material", shaderPath: "builtin/uv_distortion.wgsl" },
    },
  ],
  edges: [
    { id: "ue1", source: "mesh_plane", target: "mat_distort", targetHandle: "mesh" },
    { id: "ue2", source: "tex_distort", target: "mat_distort" },
    { id: "ue3", source: "u_strength", target: "mat_distort" },
  ],
}

// ----------------------------------------------------------------------------
// SubGraphLibrary Class
// ----------------------------------------------------------------------------

export class SubGraphLibrary {
  private library = new Map<string, SubGraphDefinition>()

  constructor() {
    this.reset()
  }

  public reset(): void {
    this.library.clear()
    this.register(BUILTIN_FRESNEL_RIM)
    this.register(BUILTIN_NOISE_GEN)
    this.register(BUILTIN_UV_DISTORTION)
  }

  public register(def: SubGraphDefinition): void {
    this.library.set(def.id, def)
  }

  public unregister(id: string): boolean {
    const item = this.library.get(id)
    if (!item) return false
    if (item.isBuiltin) return false
    return this.library.delete(id)
  }

  public get(id: string): SubGraphDefinition | undefined {
    return this.library.get(id)
  }

  public has(id: string): boolean {
    return this.library.has(id)
  }

  public getAll(): SubGraphDefinition[] {
    return Array.from(this.library.values())
  }

  public getByCategory(category: string): SubGraphDefinition[] {
    return Array.from(this.library.values()).filter((d) => d.category === category)
  }

  public getMap(): Map<string, SubGraphDefinition> {
    return this.library
  }
}

export const subGraphLibrary = new SubGraphLibrary()

// ----------------------------------------------------------------------------
// Selection-to-Sub-graph Collapser Helper
// ----------------------------------------------------------------------------

export function collapseNodesToSubGraph(
  selectedNodes: Node<GraphNodeData>[],
  allEdges: Edge[],
  options?: {
    id?: string
    name?: string
    description?: string
    category?: "Lighting" | "Procedural" | "Distortion" | "Utility" | "User"
  }
): {
  definition: SubGraphDefinition
  subGraphNode: Node<GraphNodeData>
  remainingEdges: Edge[]
} {
  if (selectedNodes.length === 0) {
    throw new Error("Cannot collapse empty selection into a sub-graph.")
  }

  const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
  const subGraphId = options?.id || `subgraph-${Date.now()}`
  const name = options?.name || "Grouped Sub-graph"
  const description = options?.description || "User-defined sub-graph collapsed from selection."
  const category = options?.category || "User"

  // Partition edges
  const internalEdges: Edge[] = []
  const externalIncomingEdges: Edge[] = []
  const externalOutgoingEdges: Edge[] = []
  const unrelatedEdges: Edge[] = []

  for (const edge of allEdges) {
    const isSourceInternal = selectedNodeIds.has(edge.source)
    const isTargetInternal = selectedNodeIds.has(edge.target)

    if (isSourceInternal && isTargetInternal) {
      internalEdges.push(edge)
    } else if (!isSourceInternal && isTargetInternal) {
      externalIncomingEdges.push(edge)
    } else if (isSourceInternal && !isTargetInternal) {
      externalOutgoingEdges.push(edge)
    } else {
      unrelatedEdges.push(edge)
    }
  }

  // Derive input ports from external incoming edges
  const inputPorts: SubGraphPort[] = []
  const seenInputPorts = new Set<string>()

  for (const edge of externalIncomingEdges) {
    const portId = `in_${edge.target}_${edge.targetHandle || "default"}`
    if (!seenInputPorts.has(portId)) {
      seenInputPorts.add(portId)
      inputPorts.push({
        id: portId,
        name: edge.targetHandle || "Input",
        type: "any",
        direction: "input",
        internalNodeId: edge.target,
        internalHandleId: edge.targetHandle || undefined,
      })
    }
  }

  // Derive output ports from external outgoing edges
  const outputPorts: SubGraphPort[] = []
  const seenOutputPorts = new Set<string>()

  for (const edge of externalOutgoingEdges) {
    const portId = `out_${edge.source}_${edge.sourceHandle || "default"}`
    if (!seenOutputPorts.has(portId)) {
      seenOutputPorts.add(portId)
      outputPorts.push({
        id: portId,
        name: edge.sourceHandle || "Output",
        type: "any",
        direction: "output",
        internalNodeId: edge.source,
        internalHandleId: edge.sourceHandle || undefined,
      })
    }
  }

  // Calculate center position for the new SubGraphNode
  const minX = Math.min(...selectedNodes.map((n) => n.position.x))
  const minY = Math.min(...selectedNodes.map((n) => n.position.y))

  const definition: SubGraphDefinition = {
    id: subGraphId,
    name,
    description,
    category,
    isBuiltin: false,
    version: "1.0.0",
    inputs: inputPorts,
    outputs: outputPorts,
    nodes: selectedNodes,
    edges: internalEdges,
  }

  // Register in library
  subGraphLibrary.register(definition)

  const subGraphNode: Node<GraphNodeData> = {
    id: subGraphId,
    type: "subgraph",
    position: { x: minX, y: minY },
    data: {
      type: "subgraph",
      subGraphId,
      name,
      isCollapsed: true,
    },
  }

  // Rewire edges connecting to the new subGraphNode
  const rewiredIncomingEdges = externalIncomingEdges.map((edge) => {
    const portId = `in_${edge.target}_${edge.targetHandle || "default"}`
    return {
      ...edge,
      target: subGraphId,
      targetHandle: portId,
    }
  })

  const rewiredOutgoingEdges = externalOutgoingEdges.map((edge) => {
    const portId = `out_${edge.source}_${edge.sourceHandle || "default"}`
    return {
      ...edge,
      source: subGraphId,
      sourceHandle: portId,
    }
  })

  const remainingEdges = [
    ...unrelatedEdges,
    ...rewiredIncomingEdges,
    ...rewiredOutgoingEdges,
  ]

  return { definition, subGraphNode, remainingEdges }
}
