import { useCallback, useEffect, useRef, type CSSProperties } from "react"
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
  type EdgeTypes,
  addEdge,
  reconnectEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  Panel,
  useReactFlow,
  useStore,
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
import { DeletableEdge } from "@/components/nodes/DeletableEdge"
import { Button, Kbd, Separator } from "@/components/ui"
import { compileGraph, buildSdfTree, type GraphNodeData, type RenderQueue } from "@/core/graphCompiler"
import { useProjectStore, registerLiveGraphProvider } from "@/stores/projectStore"
import { collectSdfUniforms } from "@/core/sdf/sdfCompiler"
import { debounce, type Debounced } from "@/utils/throttle"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"

import { PostProcessDrawer } from "@/components/PostProcessDrawer"
import { NodePaletteModal } from "@/components/NodePaletteModal"
import { useState } from "react"

// minZoom 0.1: never clip a node to keep text bigger; the user can zoom in from the fitted view.
const FIT_OPTIONS = { padding: 0.12, minZoom: 0.1, maxZoom: 1 }

/** Re-fits when the pane resizes (sidebar drag / panel toggle) until the user pans or zooms themselves. */
function AutoFit({ userMoved }: { userMoved: { current: boolean } }) {
  const { fitView } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  useEffect(() => {
    if (!userMoved.current && width > 0 && height > 0) void fitView(FIT_OPTIONS)
  }, [width, height, fitView, userMoved])
  return null
}
/** Snap radius for dropping a connection, in screen pixels (React Flow takes it in graph units). */
const SNAP_SCREEN_PX = 30

/**
 * Reports the zoom (rounded) so port hit areas and the snap radius stay a constant size on screen:
 * the graph auto-fits a narrow sidebar at ~0.3x, where a 12px port would otherwise be a 4px target.
 */
function ZoomWatch({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useStore((s) => Math.round(s.transform[2] * 20) / 20)
  useEffect(() => { onZoom(zoom || 1) }, [zoom, onZoom])
  return null
}

// React Flow's own CSS variables, mapped to design tokens so Controls follow the active theme.
const RF_VARS = {
  "--xy-controls-button-background-color": "var(--ds-overlay)",
  "--xy-controls-button-background-color-hover": "var(--ds-hover)",
  "--xy-controls-button-color": "var(--ds-fg-muted)",
  "--xy-controls-button-color-hover": "var(--ds-fg)",
  "--xy-controls-button-border-color": "var(--ds-line)",
  "--xy-controls-box-shadow": "var(--ds-shadow-sm)",
} as CSSProperties

const QUICK_LABEL: Record<string, string> = {
  mesh: "Mesh", compute: "Compute", audio: "Audio", material: "Material", texture: "Texture",
  uniform: "Uniform", time: "Time", postprocess: "Post process", output: "Output",
}

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

export const edgeTypes: EdgeTypes = { default: DeletableEdge }

/** Delete works with both keys (React Flow's default is Backspace only, which Windows users don't reach for). */
export const DELETE_KEYS = ["Delete", "Backspace"]

/** Remove changes for every edge touching a node: used by "Disconnect all" and node deletion. */
export function edgeRemovalsForNode(nodeId: string, edges: Edge[]): EdgeChange[] {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => ({ type: "remove", id: e.id }))
}

type GraphMenu = { kind: "node" | "edge"; id: string; x: number; y: number }

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

/** Clear the error slot without counting as an adapter compile report (compileSeq stays put). */
const clearCompileError = () => useProjectStore.setState({ lastCompileError: null })

/** Compile the graph and publish the result to the store, skipping work whose output is unchanged. */
export function compileAndPublish(nodes: Node<GraphNodeData>[], edges: Edge[]) {
  const store = useProjectStore.getState()
  if (nodes.length === 0) {
    // Empty graph: nothing to render, and "no output node" is not an error worth surfacing.
    if (store.lastCompileError !== null) clearCompileError()
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
  if (store.lastCompileError !== null) clearCompileError()

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

  // Drag an edge end onto another port to re-wire it, or onto empty canvas to disconnect it.
  const reconnected = useRef(true)
  const onReconnectStart = useCallback(() => { reconnected.current = false }, [])
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      reconnected.current = true
      const next = reconnectEdge(oldEdge, connection, edgesRef.current)
      commitEdges(next)
      publishStructure(nodesRef.current, nodesRef.current, next)
    },
    [commitEdges]
  )
  const onReconnectEnd = useCallback(
    (_: unknown, edge: Edge) => {
      if (!reconnected.current) onEdgesChange([{ type: "remove", id: edge.id }])
      reconnected.current = true
    },
    [onEdgesChange]
  )

  const [zoom, setZoom] = useState(1)

  // Right-click menu on nodes and edges.
  const [menu, setMenu] = useState<GraphMenu | null>(null)
  const openMenu = useCallback((kind: GraphMenu["kind"], id: string, e: React.MouseEvent) => {
    e.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    // Keep the menu (min-w-40 = 160px, two items ≈ 80px) inside the panel: the sidebar clips overflow.
    const x = Math.max(4, Math.min(e.clientX - (box?.left ?? 0), (box?.width ?? 0) - 164))
    const y = Math.max(4, Math.min(e.clientY - (box?.top ?? 0), (box?.height ?? 0) - 84))
    setMenu({ kind, id, x, y })
  }, [])
  const deleteNode = useCallback((id: string) => {
    const removals = edgeRemovalsForNode(id, edgesRef.current)
    if (removals.length) onEdgesChange(removals)
    onNodesChange([{ type: "remove", id }])
  }, [onEdgesChange, onNodesChange])
  const disconnectNode = useCallback((id: string) => {
    const removals = edgeRemovalsForNode(id, edgesRef.current)
    if (removals.length) onEdgesChange(removals)
  }, [onEdgesChange])

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

  const containerRef = useRef<HTMLDivElement>(null)
  const userMovedRef = useRef(false)

  // Space opens the palette only while focus is inside the graph (never as a window-level listener, so it
  // cannot also toggle playback); the Toolbar ignores Space inside [data-node-graph].
  const handleGraphKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t.closest("input, textarea, select, button, [contenteditable='true']")) return
    if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      setIsPaletteOpen(true)
    }
  }, [])

  // Clicking empty canvas puts focus on the graph container so Space keeps working there.
  const handleGraphPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, button, [contenteditable='true']")) return
    containerRef.current?.focus({ preventScroll: true })
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
    <div
      ref={containerRef}
      data-node-graph
      tabIndex={-1}
      onKeyDown={handleGraphKeyDown}
      onPointerDownCapture={handleGraphPointerDown}
      className={cn(
        "relative h-full w-full outline-none",
        "[&_.react-flow__edge-path]:stroke-line-strong [&_.react-flow__edge-path]:transition-colors",
        "[&_.react-flow__edge.selected_.react-flow__edge-path]:stroke-brand [&_.react-flow__edge:hover_.react-flow__edge-path]:stroke-fg-subtle",
        "[&_.react-flow__connection-path]:stroke-brand",
        "[&_.react-flow__controls]:overflow-hidden [&_.react-flow__controls]:rounded-lg [&_.react-flow__controls]:border [&_.react-flow__controls]:border-line [&_.react-flow__controls]:bg-overlay [&_.react-flow__controls]:shadow-sm",
        "[&_.react-flow__controls-button]:border-line [&_.react-flow__controls-button]:bg-overlay [&_.react-flow__controls-button]:fill-fg-muted hover:[&_.react-flow__controls-button]:bg-hover",
        className
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        edgesReconnectable
        reconnectRadius={14}
        connectionRadius={SNAP_SCREEN_PX / zoom}
        deleteKeyCode={DELETE_KEYS}
        onNodeContextMenu={(e, node) => openMenu("node", node.id, e)}
        onEdgeContextMenu={(e, edge) => openMenu("edge", edge.id, e)}
        onPaneClick={() => setMenu(null)}
        onMoveStart={(e) => { if (e) userMovedRef.current = true; setMenu(null) }}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.1}
        style={{ ...RF_VARS, "--graph-zoom": zoom } as CSSProperties}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas"
      >
        <Background color="var(--ds-line, currentColor)" variant={BackgroundVariant.Dots} gap={20} size={1} />
        <AutoFit userMoved={userMovedRef} />
        <ZoomWatch onZoom={setZoom} />
        <Controls showInteractive={false} position="bottom-left" />
        <Panel position="top-left" className="!m-2 max-w-[calc(100%-1rem)]">
          <div className="scrollbar-none flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line bg-overlay p-1 shadow-sm">
            <Button variant="primary" size="sm" onClick={() => setIsPaletteOpen(true)} className="shrink-0">
              <Plus />
              <span>Add node</span>
              <Kbd className="border-transparent bg-brand-fg/20 text-brand-fg">Space</Kbd>
            </Button>
            <Separator orientation="vertical" className="mx-1 h-4" />
            {["mesh", "compute", "audio", "material", "texture", "uniform", "time", "postprocess", "output"].map((type) => (
              <Button key={type} variant="ghost" size="sm" onClick={() => addNode(type)} className="shrink-0 text-fg-muted">
                {QUICK_LABEL[type]}
              </Button>
            ))}
          </div>
        </Panel>
        {nodes.length === 0 && (
          <Panel position="top-center" className="!pointer-events-none !m-0 !top-1/2 -translate-y-1/2">
            <div data-testid="graph-empty-state" className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-fg-muted">This graph is empty</p>
              <p className="flex items-center gap-1.5 text-xs text-fg-subtle">Press <Kbd>Space</Kbd> to add a node</p>
            </div>
          </Panel>
        )}
      </ReactFlow>
      {menu && (
        <div
          role="menu"
          aria-label={menu.kind === "node" ? "Node actions" : "Connection actions"}
          onKeyDown={(e) => { if (e.key === "Escape") setMenu(null) }}
          className="absolute z-50 flex min-w-40 flex-col rounded-lg border border-line bg-overlay p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.kind === "node" ? (
            <>
              <button role="menuitem" autoFocus className="rounded-md px-2 py-1.5 text-left hover:bg-hover" onClick={() => { disconnectNode(menu.id); setMenu(null) }}>
                Disconnect all
              </button>
              <button role="menuitem" className="rounded-md px-2 py-1.5 text-left text-danger hover:bg-hover" onClick={() => { deleteNode(menu.id); setMenu(null) }}>
                Delete node <span className="float-right text-2xs text-fg-subtle">Del</span>
              </button>
            </>
          ) : (
            <button role="menuitem" autoFocus className="rounded-md px-2 py-1.5 text-left text-danger hover:bg-hover" onClick={() => { onEdgesChange([{ type: "remove", id: menu.id }]); setMenu(null) }}>
              Delete connection <span className="float-right text-2xs text-fg-subtle">Del</span>
            </button>
          )}
        </div>
      )}
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
