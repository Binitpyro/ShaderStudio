import { useCallback, useEffect, useRef } from "react"
import {
  ReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  Panel,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { MeshNode } from "@/components/nodes/MeshNode"
import { ComputeNode } from "@/components/nodes/ComputeNode"
import { AudioNode } from "@/components/nodes/AudioNode"
import { MaterialNode } from "@/components/nodes/MaterialNode"
import { TextureNode } from "@/components/nodes/TextureNode"
import { UniformNode } from "@/components/nodes/UniformNode"
import { TimeNode } from "@/components/nodes/TimeNode"
import { PostProcessNode } from "@/components/nodes/PostProcessNode"
import { OutputNode } from "@/components/nodes/OutputNode"
import { SdfPrimitiveNode } from "@/components/nodes/SdfPrimitiveNode"
import { SdfOperatorNode } from "@/components/nodes/SdfOperatorNode"
import { RaymarchNode } from "@/components/nodes/RaymarchNode"
import { SubGraphNode } from "@/components/nodes/SubGraphNode"
import { GenericCustomNode } from "@/components/nodes/GenericCustomNode"
import { MathExpressionNode } from "@/components/nodes/MathExpressionNode"
import { CommentNode } from "@/components/nodes/CommentNode"
import { FrameNode } from "@/components/nodes/FrameNode"
import { Button } from "@/components/ui/button"
import { compileGraph, buildSdfTree, type GraphNodeData, type RenderQueue } from "@/core/graphCompiler"
import { useProjectStore, registerLiveGraphProvider } from "@/stores/projectStore"
import { collectSdfUniforms } from "@/core/sdf/sdfCompiler"
import { debounce, type Debounced } from "@/utils/throttle"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"

import { PostProcessDrawer } from "@/components/PostProcessDrawer"
import { NodePaletteModal } from "@/components/NodePaletteModal"
import { useState } from "react"

export const nodeTypes: NodeTypes = {
  mesh: MeshNode,
  compute: ComputeNode,
  audio: AudioNode,
  material: MaterialNode,
  texture: TextureNode,
  uniform: UniformNode,
  time: TimeNode,
  postprocess: PostProcessNode,
  output: OutputNode,
  sdf_primitive: SdfPrimitiveNode,
  sdf_operator: SdfOperatorNode,
  raymarch: RaymarchNode,
  subgraph: SubGraphNode,
  custom: GenericCustomNode,
  math_expression: MathExpressionNode,
  comment: CommentNode,
  frame: FrameNode,
}

// ---------------------------------------------------------------------------
// Graph <-> store synchronisation (module level so it is unit-testable without a DOM).
//
// React Flow owns the live nodes/edges (positions included). The store only receives:
//   - a serializable snapshot on structure/data edits (immediately) and after drags (debounced),
//   - compile results (render queue / errors / generated raymarch sources) on structure/data edits.
// Position / select / dimension changes never compile and never touch the GPU pipeline.
// ---------------------------------------------------------------------------

export interface NodeChangeKinds {
  /** add / remove / structure-affecting replace: compile + publish. */
  structural: boolean
  /** position / explicit resize / no-op replace: layout only -> debounced snapshot + dirty flag, no compile. */
  layout: boolean
  /** replace that only changed parameter values (SDF params, uniform default): push values + debounced snapshot, no compile. */
  params: boolean
}

/** Per node kind: the data keys that are pure parameter values (everything else in `data` is structure). */
const PARAM_KEYS: Record<string, readonly string[]> = {
  sdf_primitive: ["params"],
  sdf_operator: ["params"],
  uniform: ["defaultValue"],
}

type ReplaceKind = "structural" | "params" | "layout"

function withoutKeys(data: Record<string, unknown>, keys: readonly string[]): string {
  const rest: Record<string, unknown> = {}
  for (const k of Object.keys(data)) if (!keys.includes(k)) rest[k] = data[k]
  return JSON.stringify(rest)
}

/**
 * React Flow's controlled setNodes diff (used by updateNodeData) emits "replace" for ANY data edit.
 * Only a change to type / structural data (ports, kind, source path, expression, subgraph contents ...)
 * needs a compile; value-only edits and no-op replaces must not.
 */
function classifyReplace(prev: Node<GraphNodeData> | undefined, next: Node<GraphNodeData>): ReplaceKind {
  if (!prev || prev.type !== next.type || prev.data.type !== next.data.type) return "structural"
  const keys = PARAM_KEYS[next.data.type]
  if (!keys) return JSON.stringify(prev.data) === JSON.stringify(next.data) ? "layout" : "structural"
  if (withoutKeys(prev.data, keys) !== withoutKeys(next.data, keys)) return "structural"
  return "params"
}

/** `current` enables value-only replace detection; without it every replace is structural. */
export function classifyNodeChanges(changes: NodeChange[], current?: Node<GraphNodeData>[]): NodeChangeKinds {
  let structural = false
  let layout = false
  let params = false
  // A subgraph flattens into the compiled graph, so any replace while one exists is treated as structural.
  const hasSubgraph = !current || current.some((n) => n.data.type === "subgraph")
  for (const c of changes) {
    if (c.type === "add" || c.type === "remove") structural = true
    else if (c.type === "replace") {
      const kind = hasSubgraph ? "structural" : classifyReplace(current!.find((n) => n.id === c.id), c.item as Node<GraphNodeData>)
      if (kind === "structural") structural = true
      else if (kind === "params") params = true
      else layout = true
    } else if (c.type === "position" || (c.type === "dimensions" && c.setAttributes)) layout = true
    // select / plain measurement (dimensions without setAttributes): ignored entirely
  }
  return { structural, layout, params }
}

export function isStructuralEdgeChange(c: EdgeChange): boolean {
  return c.type === "add" || c.type === "remove" || c.type === "replace"
}

interface GraphSyncState {
  publishedNodes: Node<GraphNodeData>[] | null
  publishedEdges: Edge[] | null
  /** Last generated raymarch sources pushed to the store (skip recompiles when unchanged). */
  raymarchSources: string | null
  /** Signature of the last queue pushed to the store, ignoring SDF uniform values. */
  queueSignature: string | null
}

const sync: GraphSyncState = { publishedNodes: null, publishedEdges: null, raymarchSources: null, queueSignature: null }

/** Test hook / project switch: forget what was last pushed so the next compile re-applies everything. */
export function resetGraphSync() {
  sync.publishedNodes = null
  sync.publishedEdges = null
  sync.raymarchSources = null
  sync.queueSignature = null
}

function queueSignature(queue: RenderQueue): string {
  // sdfUniforms are values, not structure: slider drags must not look like a queue change.
  return JSON.stringify(queue, (key, value) => (key === "sdfUniforms" ? undefined : value))
}

function mergeSdfUniforms(values: Record<string, number>) {
  const store = useProjectStore.getState()
  const changed: Record<string, { type: "float"; value: number }> = {}
  for (const [name, value] of Object.entries(values)) {
    const existing = store.uniformValues[name]
    if (!existing || existing.value !== value) changed[name] = { type: "float", value }
  }
  if (Object.keys(changed).length > 0) store.mergeUniformValues(changed)
}

/** Value-only edit: push SDF values (tree walk only: no source generation, no compileGraph) and uniform node defaults. */
function pushParamValues(nodes: Node<GraphNodeData>[], edges: Edge[]) {
  for (const n of nodes) {
    if (n.data.type === "raymarch") {
      const input = edges.find((e) => e.target === n.id)
      if (input) mergeSdfUniforms(collectSdfUniforms(buildSdfTree(input.source, nodes, edges)))
    } else if (n.data.type === "uniform") {
      const u = n.data
      const store = useProjectStore.getState()
      const gu = store.graphUniforms.find((g) => g.id === (u.uniformId || `uniform_${n.id}`))
      if (gu && JSON.stringify(gu.defaultValue) !== JSON.stringify(u.defaultValue)) {
        store.updateGraphUniform(gu.id, { defaultValue: u.defaultValue })
      }
    }
  }
}

/** Compile the graph and publish the result to the store, skipping work whose output is unchanged. */
export function compileAndPublish(nodes: Node<GraphNodeData>[], edges: Edge[]) {
  const store = useProjectStore.getState()
  if (nodes.length === 0) {
    // Empty graph: nothing to render, and "no output node" is not an error worth surfacing.
    if (store.lastCompileError !== null) store.setLastCompileError(null)
    if (store.renderQueue !== null) store.setRenderQueue(null)
    sync.queueSignature = null
    sync.raymarchSources = null
    return
  }

  const result = compileGraph(nodes, edges)
  if (result.error) {
    store.setLastCompileError(result.error)
    store.setRenderQueue(null)
    sync.queueSignature = null
    return
  }
  if (store.lastCompileError !== null) store.setLastCompileError(null)

  const raymarch = result.queue.find((step) => step.type === "raymarch")
  if (raymarch && raymarch.type === "raymarch") {
    // 1. SDF parameter values flow through the normal uniform path (adapters read store.uniformValues).
    if (raymarch.sdfUniforms) {
      mergeSdfUniforms(raymarch.sdfUniforms)
    }
    // 2. Only a different generated source (graph structure) rebuilds the pipeline.
    const key = raymarch.wgslSource + "\u0000" + raymarch.glslSource
    if (key !== sync.raymarchSources) {
      sync.raymarchSources = key
      store.setGeneratedSources({ wgsl: raymarch.wgslSource, glsl: raymarch.glslSource })
      store.triggerRecompile()
    }
  } else {
    sync.raymarchSources = null
  }

  const signature = queueSignature(result.queue)
  if (signature !== sync.queueSignature) {
    sync.queueSignature = signature
    store.setRenderQueue(result.queue)
  }
}

function removedUniformIds(prev: Node<GraphNodeData>[], next: Node<GraphNodeData>[]): string[] {
  const alive = new Set(next.map((n) => n.id))
  const ids: string[] = []
  for (const n of prev) {
    if (n.data.type === "uniform" && !alive.has(n.id)) ids.push(n.data.uniformId || `uniform_${n.id}`)
  }
  return ids
}

/** A real structure/data edit: compile, publish the snapshot, drop deleted uniform nodes' graph uniforms, mark dirty. */
export function publishStructure(prevNodes: Node<GraphNodeData>[], nextNodes: Node<GraphNodeData>[], edges: Edge[]) {
  const store = useProjectStore.getState()
  for (const id of removedUniformIds(prevNodes, nextNodes)) store.removeGraphUniform(id)
  compileAndPublish(nextNodes, edges)
  sync.publishedNodes = nextNodes
  sync.publishedEdges = edges
  store.setGraphNodes(nextNodes, { markDirty: false })
  store.setGraphEdges(edges, { markDirty: false })
  if (!useProjectStore.getState().hasUnsavedChanges) store.setHasUnsavedChanges(true)
}

/** Layout-only snapshot (after drags settle): no compile, but the project is dirty. */
export function publishLayout(nodes: Node<GraphNodeData>[]) {
  sync.publishedNodes = nodes
  useProjectStore.getState().setGraphNodes(nodes) // marks dirty
}

/**
 * Apply React Flow node changes. Pure with respect to React state: callers set the returned array.
 * Position / select / dimension changes never compile; only structural changes do.
 */
export function processNodeChanges(
  changes: NodeChange[],
  current: Node<GraphNodeData>[],
  edges: Edge[],
  onLayout: () => void,
  /** Debounced snapshot after value-only edits (defaults to onLayout). */
  onData: () => void = onLayout
): Node<GraphNodeData>[] {
  const next = applyNodeChanges(changes, current) as Node<GraphNodeData>[]
  const kinds = classifyNodeChanges(changes, current)
  if (kinds.structural) publishStructure(current, next, edges)
  else if (kinds.params) {
    pushParamValues(next, edges)
    onData()
  } else if (kinds.layout) onLayout()
  return next
}

export function processEdgeChanges(
  changes: EdgeChange[],
  nodes: Node<GraphNodeData>[],
  current: Edge[]
): Edge[] {
  const next = applyEdgeChanges(changes, current)
  if (changes.some(isStructuralEdgeChange)) publishStructure(nodes, nodes, next)
  return next
}

/** Did the store receive a graph the NodeGraph did not publish itself (load / reset / template)? */
export function isExternalGraphWrite(storeNodes: Node<GraphNodeData>[], storeEdges: Edge[]) {
  return storeNodes !== sync.publishedNodes || storeEdges !== sync.publishedEdges
}

interface NodeGraphProps { className?: string }

export function NodeGraph({ className }: NodeGraphProps) {
  const [drawer, setDrawer] = useState<{ isOpen: boolean; nodeId: string | null; customSource?: string }>({
    isOpen: false,
    nodeId: null,
  })
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId)
  const storeNodes = useProjectStore((s) => s._graphNodes)
  const storeEdges = useProjectStore((s) => s._graphEdges)

  // Mount from the store snapshot (NOT a hard-coded starter), so New Project / remounts stay consistent.
  const [nodes, setNodes] = useNodesState<Node<GraphNodeData>>(useProjectStore.getState()._graphNodes)
  const [edges, setEdges] = useEdgesState<Edge>(useProjectStore.getState()._graphEdges)
  const nodesRef = useRef<Node<GraphNodeData>[]>(nodes)
  const edgesRef = useRef<Edge[]>(edges)
  if (sync.publishedNodes === null) {
    sync.publishedNodes = nodesRef.current
    sync.publishedEdges = edgesRef.current
  }

  const commitNodes = useCallback((next: Node<GraphNodeData>[]) => {
    nodesRef.current = next
    setNodes(next)
  }, [setNodes])
  const commitEdges = useCallback((next: Edge[]) => {
    edgesRef.current = next
    setEdges(next)
  }, [setEdges])

  const layoutSnapshotRef = useRef<Debounced<[]> | null>(null)
  if (!layoutSnapshotRef.current) layoutSnapshotRef.current = debounce(() => publishLayout(nodesRef.current), 300)
  const layoutSnapshot = layoutSnapshotRef.current

  /** Data edit helper for the node-level custom events below. No side effects inside state updaters. */
  const updateNodes = useCallback(
    (updater: (prev: Node<GraphNodeData>[]) => Node<GraphNodeData>[]) => {
      const prev = nodesRef.current
      const next = updater(prev)
      if (next === prev) return
      commitNodes(next)
      publishStructure(prev, next, edgesRef.current)
    },
    [commitNodes]
  )

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      commitNodes(processNodeChanges(changes, nodesRef.current, edgesRef.current, layoutSnapshot))
    },
    [commitNodes, layoutSnapshot]
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      commitEdges(processEdgeChanges(changes, nodesRef.current, edgesRef.current))
    },
    [commitEdges]
  )

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const next = addEdge(connection, edgesRef.current)
      commitEdges(next)
      publishStructure(nodesRef.current, nodesRef.current, next)
    },
    [commitEdges]
  )

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node<GraphNodeData>[] }) => {
      const id = selectedNodes[0]?.id ?? null
      if (useProjectStore.getState().selectedNodeId !== id) setSelectedNodeId(id)
    },
    [setSelectedNodeId]
  )

  // External store writes (loadProjectData, resetProject, starter scene, templates) -> React Flow.
  // Nodes and edges are applied together so we compile once against a consistent graph.
  useEffect(() => {
    if (!isExternalGraphWrite(storeNodes, storeEdges)) return
    layoutSnapshot.cancel()
    sync.publishedNodes = storeNodes
    sync.publishedEdges = storeEdges
    sync.raymarchSources = null
    sync.queueSignature = null
    nodesRef.current = storeNodes
    edgesRef.current = storeEdges
    setNodes(storeNodes)
    setEdges(storeEdges)
    compileAndPublish(storeNodes, storeEdges)
  }, [storeNodes, storeEdges, setNodes, setEdges, layoutSnapshot])

  // Mount: make sure the render queue matches the graph, expose the live graph to save/export,
  // and on unmount flush a pending drag snapshot so the store never keeps stale positions.
  useEffect(() => {
    compileAndPublish(nodesRef.current, edgesRef.current)
    registerLiveGraphProvider(() => ({ nodes: nodesRef.current, edges: edgesRef.current }))
    return () => {
      layoutSnapshot.flush()
      registerLiveGraphProvider(null)
    }
  }, [layoutSnapshot])

  useEffect(() => {
    const handleMeshChange = (e: CustomEvent) => {
      const target = e.target as HTMLElement
      const nodeEl = target.closest("[data-id]")
      const nodeId = nodeEl?.getAttribute("data-id")
      if (nodeId) {
        updateNodes((nds) =>
          nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, geometry: e.detail.geometry } } : n))
        )
      }
    }
    document.addEventListener("meshGeometryChange", handleMeshChange as EventListener)
    return () => {
      document.removeEventListener("meshGeometryChange", handleMeshChange as EventListener)
    }
  }, [updateNodes])

  useEffect(() => {
    const handleTexture = (e: CustomEvent) => {
      const { nodeId, textureId, name } = e.detail
      updateNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, textureId, name } } : n))
      )
    }
    document.addEventListener("textureLoaded", handleTexture as EventListener)
    return () => {
      document.removeEventListener("textureLoaded", handleTexture as EventListener)
    }
  }, [updateNodes])

  useEffect(() => {
    const handleTypeChange = (e: CustomEvent) => {
      const { nodeId, passType, params } = e.detail
      updateNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  passType,
                  params: { ...((n.data as any).params || {}), ...params },
                },
              }
            : n
        )
      )
    }

    const handleParamChange = (e: CustomEvent) => {
      const { nodeId, allParams } = e.detail
      updateNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  params: allParams,
                },
              }
            : n
        )
      )
    }

    const handleEditShader = (e: CustomEvent) => {
      const { nodeId, customSource } = e.detail
      setDrawer({
        isOpen: true,
        nodeId,
        customSource,
      })
    }

    const handleComputePreset = (e: CustomEvent) => {
      const { nodeId, preset } = e.detail
      updateNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, preset } } : n))
      )
    }

    const handleComputeCount = (e: CustomEvent) => {
      const { nodeId, particleCount } = e.detail
      updateNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, particleCount } } : n))
      )
    }

    const handleComputeParams = (e: CustomEvent) => {
      const { nodeId, params } = e.detail
      updateNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, params: { ...((n.data as any).params || {}), ...params } } }
            : n
        )
      )
    }

    const handleAudioSource = (e: CustomEvent) => {
      const { nodeId, sourceType } = e.detail
      updateNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, sourceType } } : n))
      )
    }

    const handleNodeDataChanged = (e: CustomEvent) => {
      const { nodeId, data } = e.detail
      updateNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n))
      )
    }

    document.addEventListener("postProcessTypeChange", handleTypeChange as EventListener)
    document.addEventListener("postProcessParamChange", handleParamChange as EventListener)
    document.addEventListener("editPostProcessShader", handleEditShader as EventListener)
    document.addEventListener("computePresetChange", handleComputePreset as EventListener)
    document.addEventListener("computeCountChange", handleComputeCount as EventListener)
    document.addEventListener("computeParamChange", handleComputeParams as EventListener)
    document.addEventListener("audioSourceChange", handleAudioSource as EventListener)
    document.addEventListener("nodeDataChanged", handleNodeDataChanged as EventListener)
    return () => {
      document.removeEventListener("postProcessTypeChange", handleTypeChange as EventListener)
      document.removeEventListener("postProcessParamChange", handleParamChange as EventListener)
      document.removeEventListener("editPostProcessShader", handleEditShader as EventListener)
      document.removeEventListener("computePresetChange", handleComputePreset as EventListener)
      document.removeEventListener("computeCountChange", handleComputeCount as EventListener)
      document.removeEventListener("computeParamChange", handleComputeParams as EventListener)
      document.removeEventListener("audioSourceChange", handleAudioSource as EventListener)
      document.removeEventListener("nodeDataChanged", handleNodeDataChanged as EventListener)
    }
  }, [updateNodes])

  const handleSaveCustomShader = useCallback(
    (nodeId: string, code: string) => {
      updateNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  customSource: code,
                },
              }
            : n
        )
      )
    },
    [updateNodes]
  )

  const addNode = useCallback(
    (type: string) => {
      const id = `${type}-${Date.now()}`
      const position = { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 }
      let data: GraphNodeData
      switch (type) {
        case "mesh":
          data = { type: "mesh", geometry: "cube" }
          break
        case "compute":
          data = {
            type: "compute",
            preset: "curl_noise",
            particleCount: 50000,
            params: { speed: 1.0, damping: 0.98, strength: 1.0, noiseScale: 1.0, pointSize: 4.0, blendMode: 1.0 },
          }
          break
        case "audio":
          data = { type: "audio", sourceType: "builtin", volume: 0.8, gain: 1.2, smoothing: 0.8 }
          break
        case "material":
          data = { type: "material", shaderPath: null }
          break
        case "texture":
          data = { type: "texture", textureId: null, name: "" }
          break
        case "uniform":
          data = { type: "uniform", uniformId: `uniform_${id}`, name: "param", uniformType: "float", defaultValue: 0.5 }
          break
        case "time":
          data = { type: "time" }
          break
        case "postprocess":
          data = { type: "postprocess", passType: "vignette", params: { intensity: 0.5, radius: 0.8 } }
          break
        case "output":
          data = { type: "output" }
          break
        case "subgraph":
          data = { type: "subgraph", subGraphId: "builtin-fresnel-rim", name: "Fresnel Rim Lighting" }
          break
        case "custom":
          data = { type: "custom", manifestId: "custom-grayscale", parameters: { intensity: 1.0 } }
          break
        case "math_expression":
          data = { type: "math_expression", expression: "sin(uv.x * 10.0) * 0.5 + 0.5", inputNames: ["uv"], outputType: "float" }
          break
        case "comment":
          data = { type: "comment", title: "Note", text: "Add annotation notes here..." }
          break
        case "frame":
          data = { type: "frame", label: "Group Frame", color: "default", width: 300, height: 200 }
          break
        default:
          return
      }
      const newNode: Node<GraphNodeData> = { id, type, position, data }
      updateNodes((current) => [...current, newNode])
    },
    [updateNodes]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setIsPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleAddPaletteNode = useCallback(
    (type: string, data: GraphNodeData) => {
      const id = `${type}-${Date.now()}`
      const position = { x: 250 + Math.random() * 80, y: 150 + Math.random() * 80 }
      const newNode: Node<GraphNodeData> = { id, type, position, data }
      updateNodes((current) => [...current, newNode])
    },
    [updateNodes]
  )

  return (
    <div className={cn("h-full w-full relative", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        className="bg-background"
      >
        <Background color="var(--border)" variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls className="!bg-card !border-border !rounded" />
        <Panel position="top-left" className="!m-2 max-w-[calc(100%-1rem)]">
          <div className="flex items-center gap-1.5 bg-card/90 backdrop-blur-xs p-1.5 rounded-lg border border-border shadow-md max-w-full overflow-x-auto scrollbar-none">
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsPaletteOpen(true)}
              className="text-xs h-7 px-2.5 gap-1.5 font-medium shadow-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Node</span>
              <kbd className="text-[10px] font-mono bg-primary-foreground/20 text-primary-foreground px-1 rounded">Space</kbd>
            </Button>
            <div className="h-4 w-px bg-border my-auto mx-0.5 shrink-0" />
            {["mesh", "compute", "audio", "material", "texture", "uniform", "time", "postprocess", "output"].map((type) => (
              <Button
                key={type}
                variant="ghost"
                size="sm"
                onClick={() => addNode(type)}
                className="text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
              >
                +{type.charAt(0).toUpperCase() + type.slice(1)}
              </Button>
            ))}
          </div>
        </Panel>
      </ReactFlow>
      <PostProcessDrawer
        isOpen={drawer.isOpen}
        nodeId={drawer.nodeId}
        initialCode={drawer.customSource}
        onClose={() => setDrawer({ isOpen: false, nodeId: null })}
        onSave={handleSaveCustomShader}
      />
      <NodePaletteModal
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onSelectNode={handleAddPaletteNode}
      />
    </div>
  )
}
