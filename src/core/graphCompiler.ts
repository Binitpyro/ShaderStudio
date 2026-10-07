import type { Node, Edge } from "reactflow"

export interface MeshNodeData { type: "mesh"; geometry: "cube" | "sphere" | "plane" }
export interface MaterialNodeData { type: "material"; shaderPath: string | null }
export interface TextureNodeData { type: "texture"; textureId: string | null; name: string }
export interface UniformNodeData { type: "uniform"; uniformId: string; name: string; uniformType: "float" | "vec2" | "vec3" | "vec4" | "color" | "bool"; defaultValue: number | number[] | boolean }
export interface TimeNodeData { type: "time" }
export interface PostProcessNodeData { type: "postprocess" }
export interface OutputNodeData { type: "output" }

export type GraphNodeData = MeshNodeData | MaterialNodeData | TextureNodeData | UniformNodeData | TimeNodeData | PostProcessNodeData | OutputNodeData

export interface MeshStep { type: "mesh"; geometry: "cube" | "sphere" | "plane" }
export interface TextureStep { type: "texture"; id: string; src: string; binding: number }
export interface MaterialStep { type: "material"; shaderPath: string; textureBindings: Record<string, string> }
export interface PostProcessStep { type: "postprocess"; pass: "passthrough" }
export type RenderStep = MeshStep | TextureStep | MaterialStep | PostProcessStep
export type RenderQueue = RenderStep[]

export interface CompileResult { queue: RenderQueue; error: string | null }

interface NodeWithEdges { node: Node<GraphNodeData>; inputs: Edge[]; outputs: Edge[] }

export function compileGraph(nodes: Node<GraphNodeData>[], edges: Edge[]): CompileResult {
  const error = validateGraph(nodes, edges)
  if (error) return { queue: [], error }

  const outputNode = nodes.find((n) => n.data.type === "output")!
  const nodeMap = new Map<string, NodeWithEdges>()

  for (const node of nodes) {
    nodeMap.set(node.id, {
      node,
      inputs: edges.filter((e) => e.target === node.id),
      outputs: edges.filter((e) => e.source === node.id),
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
      case "texture": if (data.textureId) queue.push({ type: "texture", id: data.textureId, src: "", binding: textureBindingSlot++ }); break
      case "material": {
        const textureBindings: Record<string, string> = {}
        for (const inputEdge of nodeInfo.inputs) {
          const sourceNode = nodeMap.get(inputEdge.source)?.node
          if (sourceNode?.data.type === "texture") {
            const texData = sourceNode.data as TextureNodeData
            if (texData.textureId) textureBindings[texData.name || texData.textureId] = texData.textureId
          }
        }
        queue.push({ type: "material", shaderPath: data.shaderPath || "default.wgsl", textureBindings }); break
      }
      case "postprocess": queue.push({ type: "postprocess", pass: "passthrough" }); break
      case "uniform": case "time": break
      case "output": break
    }
  }

  return { queue, error: null }
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
    const meshInput = edges.find((e) => e.target === matNode.id && e.targetHandle === "mesh")
    if (!meshInput) return `Material node "${matNode.id}" is missing a mesh input.`
    const sourceNode = nodes.find((n) => n.id === meshInput.source)
    if (!sourceNode || sourceNode.data.type !== "mesh") return `Material node "${matNode.id}" must be connected to a Mesh node.`
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
