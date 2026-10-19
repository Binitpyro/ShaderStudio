import type { Node, Edge } from "@xyflow/react"

import type { PostProcessPassType } from "./postProcessChain"
import type { SdfPrimitiveType, SdfPrimitiveParams } from "./sdf/sdfPrimitives"
import { DEFAULT_PRIMITIVE_PARAMS } from "./sdf/sdfPrimitives"
import type { SdfOperatorType, SdfOperatorParams } from "./sdf/sdfOperators"
import {
  compileSdfToGlsl,
  compileSdfToWgsl,
  type SdfTreeNode,
  type SdfCompileOptions,
} from "./sdf/sdfCompiler"
import type { SubGraphDefinition, SubGraphLibrary, SubGraphNodeData } from "./subGraphLibrary"
import { subGraphLibrary } from "./subGraphLibrary"
import { customNodeRegistry } from "./customNodeSdk"

export type { SubGraphNodeData } from "./subGraphLibrary"

export interface CustomNodeData extends Record<string, unknown> {
  type: "custom"
  manifestId: string
  parameters?: Record<string, any>
  customComponent?: string
}

export interface MathExpressionNodeData extends Record<string, unknown> {
  type: "math_expression"
  expression: string
  inputNames?: string[]
  outputType?: "float" | "vec2" | "vec3" | "vec4"
  error?: string | null
  syntaxError?: string | null
}

export interface CommentNodeData extends Record<string, unknown> {
  type: "comment"
  title?: string
  text: string
  color?: "yellow" | "blue" | "emerald" | "purple" | "neutral"
  fontSize?: "sm" | "base" | "lg"
}

export interface FrameNodeData extends Record<string, unknown> {
  type: "frame"
  label: string
  color?: "default" | "cyan" | "purple" | "emerald" | "amber" | "rose"
  width?: number
  height?: number
}

export type ComputePreset = "curl_noise" | "gravity" | "boids" | "galaxy" | "audio_vortex" | "custom"

export interface MeshNodeData extends Record<string, unknown> { type: "mesh"; geometry: "cube" | "sphere" | "plane" | "torus_knot" | "custom" }
export interface ComputeNodeData extends Record<string, unknown> {
  type: "compute"
  preset: ComputePreset
  particleCount: number
  params?: Record<string, number | number[]>
  computeSource?: string
}
export interface MaterialNodeData extends Record<string, unknown> { type: "material"; shaderPath: string | null }
export interface TextureNodeData extends Record<string, unknown> { type: "texture"; textureId: string | null; name: string }
export interface UniformNodeData extends Record<string, unknown> { type: "uniform"; uniformId: string; name: string; uniformType: "float" | "vec2" | "vec3" | "vec4" | "color" | "bool"; defaultValue: number | number[] | boolean }
export interface TimeNodeData extends Record<string, unknown> { type: "time" }
export interface PostProcessNodeData extends Record<string, unknown> {
  type: "postprocess"
  passType?: PostProcessPassType
  params?: Record<string, number | number[]>
  customSource?: string
}
export interface AudioNodeData extends Record<string, unknown> {
  type: "audio"
  sourceType?: "builtin" | "file" | "mic"
  volume?: number
  smoothing?: number
  gain?: number
}
export interface OutputNodeData extends Record<string, unknown> { type: "output" }

export interface SdfPrimitiveNodeData extends Record<string, unknown> {
  type: "sdf_primitive"
  primitiveType: SdfPrimitiveType
  params: SdfPrimitiveParams
}

export interface SdfOperatorNodeData extends Record<string, unknown> {
  type: "sdf_operator"
  operatorType: SdfOperatorType
  params: SdfOperatorParams
}

export interface RaymarchNodeData extends Record<string, unknown> {
  type: "raymarch"
  maxSteps?: number
  maxDistance?: number
  hitEpsilon?: number
  enableShadows?: boolean
  enableAo?: boolean
  baseColor?: [number, number, number]
}

export type GraphNodeData =
  | MeshNodeData
  | ComputeNodeData
  | MaterialNodeData
  | TextureNodeData
  | UniformNodeData
  | TimeNodeData
  | PostProcessNodeData
  | AudioNodeData
  | OutputNodeData
  | SdfPrimitiveNodeData
  | SdfOperatorNodeData
  | RaymarchNodeData
  | SubGraphNodeData
  | CustomNodeData
  | MathExpressionNodeData
  | CommentNodeData
  | FrameNodeData

export interface MeshStep { type: "mesh"; geometry: "cube" | "sphere" | "plane" | "torus_knot" | "custom" }
export interface ComputeStep {
  type: "compute"
  id: string
  preset: ComputePreset
  particleCount: number
  computeSource?: string
  params: Record<string, number | number[]>
}
export interface AudioStep {
  type: "audio"
  id: string
  sourceType: "builtin" | "file" | "mic"
  volume?: number
  gain?: number
  smoothing?: number
}
export interface TextureStep { type: "texture"; id: string; src: string; binding: number }
export interface MaterialStep { type: "material"; shaderPath: string; textureBindings: Record<string, string> }
export interface PostProcessStep {
  type: "postprocess"
  id?: string
  pass: PostProcessPassType
  customSource?: string
  uniforms?: Record<string, number | number[]>
}
export interface RaymarchStep {
  type: "raymarch"
  id: string
  glslSource: string
  wgslSource: string
  options?: SdfCompileOptions
}
export interface CustomStep {
  type: "custom"
  id: string
  manifestId: string
  parameters: Record<string, any>
  snippet?: string
}
export type RenderStep =
  | MeshStep
  | ComputeStep
  | AudioStep
  | TextureStep
  | MaterialStep
  | PostProcessStep
  | RaymarchStep
  | CustomStep
export type RenderQueue = RenderStep[]

export interface CompileResult { queue: RenderQueue; error: string | null }

interface NodeWithEdges { node: Node<GraphNodeData>; inputs: Edge[]; outputs: Edge[] }

export const MAX_SUBGRAPH_DEPTH = 8

export interface FlattenResult {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  error: string | null
}

export function flattenGraph(
  nodes: Node<GraphNodeData>[],
  edges: Edge[],
  library?: Map<string, SubGraphDefinition> | SubGraphLibrary,
  currentDepth = 0,
  expansionChain: string[] = []
): FlattenResult {
  if (currentDepth > MAX_SUBGRAPH_DEPTH) {
    return {
      nodes: [],
      edges: [],
      error: `Sub-graph nesting depth exceeds maximum allowed limit of ${MAX_SUBGRAPH_DEPTH} levels (encountered at sub-graph "${expansionChain[expansionChain.length - 1]}").`,
    }
  }

  const lib = library instanceof Map ? library : library?.getMap() ?? subGraphLibrary.getMap()
  const flattenedNodes: Node<GraphNodeData>[] = []
  let flattenedEdges: Edge[] = [...edges]

  for (const node of nodes) {
    if (node.data.type !== "subgraph") {
      flattenedNodes.push(node)
      continue
    }

    const subGraphNodeData = node.data as SubGraphNodeData
    const def = lib.get(subGraphNodeData.subGraphId)
    if (!def) {
      return {
        nodes: [],
        edges: [],
        error: `Unknown sub-graph definition: "${subGraphNodeData.subGraphId}" referenced by node "${node.id}".`,
      }
    }

    // Cycle detection
    if (expansionChain.includes(def.id)) {
      return {
        nodes: [],
        edges: [],
        error: `Cycle detected in sub-graph expansion: ${[...expansionChain, def.id].join(" -> ")}.`,
      }
    }

    if (currentDepth >= MAX_SUBGRAPH_DEPTH) {
      return {
        nodes: [],
        edges: [],
        error: `Sub-graph nesting depth exceeds maximum allowed limit of ${MAX_SUBGRAPH_DEPTH} levels (encountered at sub-graph "${def.id}").`,
      }
    }

    // Recursively flatten internal nodes of the sub-graph definition
    const innerResult = flattenGraph(
      def.nodes,
      def.edges,
      lib,
      currentDepth + 1,
      [...expansionChain, def.id]
    )
    if (innerResult.error) return innerResult

    // Prefix inner node IDs to guarantee global uniqueness
    const prefix = `${node.id}__`
    const namespacedInnerNodes = innerResult.nodes.map((innerNode) => {
      const namespacedData = { ...innerNode.data }
      if (namespacedData.type === "uniform") {
        const uData = namespacedData as UniformNodeData
        const origName = uData.name
        const safeNodeId = node.id.replace(/-/g, "_")
        const namespacedName = `u_${safeNodeId}_${origName}`
        const namespacedId = `${prefix}${uData.uniformId}`
        const overrideValue =
          subGraphNodeData.uniformValues?.[origName] ??
          subGraphNodeData.uniformValues?.[namespacedName] ??
          subGraphNodeData.uniformValues?.[`u_${node.id}_${origName}`]
        return {
          ...innerNode,
          id: `${prefix}${innerNode.id}`,
          data: {
            ...uData,
            name: namespacedName,
            uniformId: namespacedId,
            defaultValue: overrideValue !== undefined ? overrideValue : uData.defaultValue,
          },
        }
      }
      return {
        ...innerNode,
        id: `${prefix}${innerNode.id}`,
        data: namespacedData,
      }
    })

    // Prefix inner edges
    const namespacedInnerEdges = innerResult.edges.map((innerEdge) => ({
      ...innerEdge,
      id: `${prefix}${innerEdge.id}`,
      source: `${prefix}${innerEdge.source}`,
      target: `${prefix}${innerEdge.target}`,
    }))

    // Reroute external edges connected to the sub-graph node
    flattenedEdges = flattenedEdges.map((e) => {
      if (e.target === node.id) {
        const port = def.inputs.find((p) => p.id === e.targetHandle) || def.inputs[0]
        if (port) {
          return {
            ...e,
            target: `${prefix}${port.internalNodeId}`,
            targetHandle: port.internalHandleId ?? e.targetHandle,
          }
        }
      }
      if (e.source === node.id) {
        const port = def.outputs.find((p) => p.id === e.sourceHandle) || def.outputs[0]
        if (port) {
          return {
            ...e,
            source: `${prefix}${port.internalNodeId}`,
            sourceHandle: port.internalHandleId ?? e.sourceHandle,
          }
        }
      }
      return e
    })

    flattenedNodes.push(...namespacedInnerNodes)
    flattenedEdges.push(...namespacedInnerEdges)
  }

  // Remove any remaining edges dangling to the collapsed node ID
  const validNodeIds = new Set(flattenedNodes.map((n) => n.id))
  flattenedEdges = flattenedEdges.filter(
    (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target)
  )

  return { nodes: flattenedNodes, edges: flattenedEdges, error: null }
}

export function compileGraph(
  rawNodes: Node<GraphNodeData>[],
  rawEdges: Edge[],
  library?: Map<string, SubGraphDefinition> | SubGraphLibrary
): CompileResult {
  const flattenResult = flattenGraph(rawNodes, rawEdges, library ?? subGraphLibrary)
  if (flattenResult.error) {
    return { queue: [], error: flattenResult.error }
  }

  const { nodes: flattenedNodes, edges: flattenedEdges } = flattenResult

  // Filter out annotation nodes (comment & frame) from compilation pipeline
  const renderableNodes = flattenedNodes.filter(
    (n) => n.data.type !== "comment" && n.data.type !== "frame"
  )

  const error = validateGraph(renderableNodes, flattenedEdges)
  if (error) return { queue: [], error }

  const outputNode = renderableNodes.find((n) => n.data.type === "output")!
  const nodeMap = new Map<string, NodeWithEdges>()

  for (const node of renderableNodes) {
    nodeMap.set(node.id, {
      node,
      inputs: flattenedEdges.filter((e) => e.target === node.id),
      outputs: flattenedEdges.filter((e) => e.source === node.id),
    })
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: Node<GraphNodeData>[] = []
  let cycleError: string | null = null

  function visit(nodeId: string) {
    if (cycleError) return
    if (visiting.has(nodeId)) {
      cycleError = `Cycle detected in node graph involving node "${nodeId}".`
      return
    }
    if (visited.has(nodeId)) return

    visiting.add(nodeId)
    const nodeInfo = nodeMap.get(nodeId)
    if (nodeInfo) {
      for (const edge of nodeInfo.inputs) {
        visit(edge.source)
        if (cycleError) return
      }
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    if (nodeInfo) {
      sorted.push(nodeInfo.node)
    }
  }

  visit(outputNode.id)
  if (cycleError) return { queue: [], error: cycleError }

  const queue: RenderQueue = []
  let textureBindingSlot = 0

  for (const node of sorted) {
    const nodeInfo = nodeMap.get(node.id)!
    const data = node.data

    switch (data.type) {
      case "mesh": queue.push({ type: "mesh", geometry: data.geometry }); break
      case "compute": {
        queue.push({
          type: "compute",
          id: node.id,
          preset: data.preset || "curl_noise",
          particleCount: data.particleCount || 50000,
          computeSource: data.computeSource,
          params: data.params || {},
        })
        break
      }
      case "texture": if (data.textureId) queue.push({ type: "texture", id: data.textureId, src: "", binding: textureBindingSlot++ }); break
      case "material": {
        const textureBindings: Record<string, string> = {}
        for (const inputEdge of nodeInfo.inputs) {
          const sourceNode = nodeMap.get(inputEdge.source)?.node
          if (sourceNode?.data.type === "texture") {
            const texData = sourceNode.data as TextureNodeData
            if (texData.textureId) textureBindings[texData.name || texData.textureId] = texData.textureId
          } else if (sourceNode?.data.type === "audio") {
            textureBindings["audioTexture"] = "audioTexture"
          }
        }
        queue.push({ type: "material", shaderPath: data.shaderPath || "default.wgsl", textureBindings }); break
      }
      case "audio": {
        queue.push({
          type: "audio",
          id: node.id,
          sourceType: data.sourceType || "builtin",
          volume: data.volume ?? 0.8,
          gain: data.gain ?? 1.2,
          smoothing: data.smoothing ?? 0.8,
        })
        break
      }
      case "postprocess": {
        const pass = data.passType || "passthrough"
        if (!data.passType && !data.params && !data.customSource) {
          queue.push({ type: "postprocess", pass: "passthrough" })
        } else {
          queue.push({
            type: "postprocess",
            id: node.id,
            pass,
            customSource: data.customSource,
            uniforms: data.params || {},
          })
        }
        break
      }
      case "raymarch": {
        const inputEdges = flattenedEdges.filter((e) => e.target === node.id)
        let rootSdfNode: SdfTreeNode
        if (inputEdges.length > 0) {
          rootSdfNode = buildSdfTree(inputEdges[0].source, renderableNodes, flattenedEdges)
        } else {
          rootSdfNode = {
            kind: "operator",
            id: "default_metaball",
            type: "smooth_union",
            params: { type: "smooth_union", smoothness: 0.25 },
            children: [
              { kind: "primitive", id: "sphere_a", type: "sphere", params: { type: "sphere", offset: [-0.6, 0, 0], radius: 0.8 } },
              { kind: "primitive", id: "sphere_b", type: "sphere", params: { type: "sphere", offset: [0.6, 0, 0], radius: 0.8 } },
            ],
          }
        }

        const compileOpts: SdfCompileOptions = {
          maxSteps: data.maxSteps ?? 128,
          maxDistance: data.maxDistance ?? 40.0,
          hitEpsilon: data.hitEpsilon ?? 0.001,
          enableSoftShadows: data.enableShadows ?? true,
          enableAmbientOcclusion: data.enableAo ?? true,
          baseColor: data.baseColor ?? [0.35, 0.65, 1.0],
        }

        const glslSource = compileSdfToGlsl(rootSdfNode, compileOpts)
        const wgslSource = compileSdfToWgsl(rootSdfNode, compileOpts)

        queue.push({ type: "mesh", geometry: "plane" })
        queue.push({
          type: "raymarch",
          id: node.id,
          glslSource,
          wgslSource,
          options: compileOpts,
        })
        break
      }
      case "sdf_primitive": case "sdf_operator": break
      case "uniform": case "time": break
      case "output": break
      case "custom": {
        const customData = data as CustomNodeData
        const manifest = customNodeRegistry.get(customData.manifestId)
        queue.push({
          type: "custom",
          id: node.id,
          manifestId: customData.manifestId,
          parameters: customData.parameters || {},
          snippet: manifest?.wgsl || manifest?.glsl || "",
        })
        break
      }
      case "math_expression":
      case "comment":
      case "frame":
      case "subgraph":
        break
    }
  }

  return { queue, error: null }
}

export function buildSdfTree(
  nodeId: string,
  nodes: Node<GraphNodeData>[],
  edges: Edge[],
  visited = new Set<string>()
): SdfTreeNode {
  if (visited.has(nodeId)) {
    return {
      kind: "primitive",
      id: "fallback_sphere",
      type: "sphere",
      params: DEFAULT_PRIMITIVE_PARAMS.sphere,
    }
  }
  visited.add(nodeId)

  const node = nodes.find((n) => n.id === nodeId)
  if (!node) {
    return {
      kind: "primitive",
      id: "fallback_sphere",
      type: "sphere",
      params: DEFAULT_PRIMITIVE_PARAMS.sphere,
    }
  }

  if (node.data.type === "sdf_primitive") {
    return {
      kind: "primitive",
      id: node.id,
      type: node.data.primitiveType,
      params: { ...node.data.params, type: node.data.primitiveType },
    }
  }

  if (node.data.type === "sdf_operator") {
    const inputEdges = edges
      .filter((e) => e.target === node.id)
      .sort((a, b) => {
        const handleA = a.targetHandle || ""
        const handleB = b.targetHandle || ""
        return handleA.localeCompare(handleB)
      })

    const children: SdfTreeNode[] = inputEdges.map((e) =>
      buildSdfTree(e.source, nodes, edges, new Set(visited))
    )

    if (children.length === 0) {
      children.push({
        kind: "primitive",
        id: `${node.id}_child_a`,
        type: "sphere",
        params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, offset: [-0.6, 0, 0] },
      })
      if (node.data.operatorType !== "repetition" && node.data.operatorType !== "twist") {
        children.push({
          kind: "primitive",
          id: `${node.id}_child_b`,
          type: "sphere",
          params: { ...DEFAULT_PRIMITIVE_PARAMS.sphere, offset: [0.6, 0, 0] },
        })
      }
    }

    return {
      kind: "operator",
      id: node.id,
      type: node.data.operatorType,
      params: { ...node.data.params, type: node.data.operatorType },
      children,
    }
  }

  const inputs = edges.filter((e) => e.target === node.id)
  if (inputs.length > 0) {
    return buildSdfTree(inputs[0].source, nodes, edges, visited)
  }

  return {
    kind: "primitive",
    id: "default_sphere",
    type: "sphere",
    params: DEFAULT_PRIMITIVE_PARAMS.sphere,
  }
}

function validateGraph(nodes: Node<GraphNodeData>[], edges: Edge[]): string | null {
  const outputNodes = nodes.filter((n) => n.data.type === "output")
  if (outputNodes.length === 0) return "No output node found. Add an Output node to render."
  if (outputNodes.length > 1) return "Multiple output nodes found. Only one Output node is allowed."

  const outputNode = outputNodes[0]
  const reachable = new Set<string>()
  const queue = [outputNode.id]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    for (const edge of edges) {
      if (edge.target === current) queue.push(edge.source)
    }
  }

  const materialNodes = nodes.filter((n) => n.data.type === "material" && reachable.has(n.id))
  for (const matNode of materialNodes) {
    const meshInput = edges.find((e) => e.target === matNode.id && (e.targetHandle === "mesh" || e.targetHandle === null || e.targetHandle === "geometry"))
    if (!meshInput) return `Material node "${matNode.id}" is missing a mesh input.`
    const sourceNode = nodes.find((n) => n.id === meshInput.source)
    if (!sourceNode || (sourceNode.data.type !== "mesh" && sourceNode.data.type !== "compute" && sourceNode.data.type !== "raymarch")) {
      return `Material node "${matNode.id}" must be connected to a Mesh node.`
    }
  }

  const customNodes = nodes.filter((n) => n.data.type === "custom" && reachable.has(n.id))
  for (const cNode of customNodes) {
    const cData = cNode.data as CustomNodeData
    if (!cData.manifestId || !customNodeRegistry.has(cData.manifestId)) {
      return `Custom node "${cNode.id}" references unknown manifest "${cData.manifestId}".`
    }
  }

  return null
}

export function getGraphUniforms(nodes: Node<GraphNodeData>[]): Array<{ id: string; name: string; type: string; defaultValue: unknown }> {
  return nodes.filter((n) => n.data.type === "uniform").map((n) => {
    const data = n.data as UniformNodeData
    return { id: data.uniformId, name: data.name, type: data.uniformType, defaultValue: data.defaultValue }
  })
}

export function hasTimeNode(nodes: Node<GraphNodeData>[]): boolean {
  return nodes.some((n) => n.data.type === "time")
}

export function hasPostProcessNode(nodes: Node<GraphNodeData>[]): boolean {
  return nodes.some((n) => n.data.type === "postprocess")
}

export function hasComputeNode(nodes: Node<GraphNodeData>[]): boolean {
  return nodes.some((n) => n.data.type === "compute")
}

export function hasAudioNode(nodes: Node<GraphNodeData>[]): boolean {
  return nodes.some((n) => n.data.type === "audio")
}

export function hasRaymarchNode(nodes: Node<GraphNodeData>[]): boolean {
  return nodes.some((n) => n.data.type === "raymarch")
}
