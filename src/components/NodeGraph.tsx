import { useCallback, useEffect, useRef } from "react"
import { ReactFlow, type Node, type Edge, type Connection, type OnConnect, type OnNodesChange, type OnEdgesChange, type NodeTypes, addEdge, applyNodeChanges, applyEdgeChanges, Controls, Background, BackgroundVariant, Panel } from "@xyflow/react"
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
import { compileGraph, type GraphNodeData, hasPostProcessNode, hasRaymarchNode } from "@/core/graphCompiler"
import { useProjectStore } from "@/stores/projectStore"
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

import { STARTER_NODES, STARTER_EDGES } from "@/core/defaultStarterScene"

const DEFAULT_NODES: Node<GraphNodeData>[] = STARTER_NODES
const DEFAULT_EDGES: Edge[] = STARTER_EDGES

interface NodeGraphProps { className?: string }

export function NodeGraph({ className }: NodeGraphProps) {
  const [drawer, setDrawer] = useState<{ isOpen: boolean; nodeId: string | null; customSource?: string }>({
    isOpen: false,
    nodeId: null,
  })
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const setCompileError = useProjectStore((s) => s.setLastCompileError)
  const setRenderQueue = useProjectStore((s) => s.setRenderQueue)
  const setGraphNodes = useProjectStore((s) => s.setGraphNodes)
  const setGraphEdges = useProjectStore((s) => s.setGraphEdges)
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId)
  const storeNodes = useProjectStore((s) => s._graphNodes)
  const storeEdges = useProjectStore((s) => s._graphEdges)

  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>(DEFAULT_NODES)
  const [edges, setEdges] = useState<Edge[]>(DEFAULT_EDGES)
  const nodesRef = useRef<Node<GraphNodeData>[]>(DEFAULT_NODES)
  const edgesRef = useRef<Edge[]>(DEFAULT_EDGES)
  const initialized = useRef(false)

  const compileAndNotify = useCallback(() => {
    const result = compileGraph(nodesRef.current, edgesRef.current)
    const error = result.error
    const queue = result.queue
    if (error) {
      setCompileError(error)
      setRenderQueue(null)
    } else {
      setCompileError(null)
      setRenderQueue(queue)
      const raymarchStep = queue.find((s) => s.type === "raymarch")
      if (raymarchStep && raymarchStep.type === "raymarch") {
        const activeBackend = useProjectStore.getState().activeBackend
        const newSource = activeBackend === "webgpu" ? raymarchStep.wgslSource : raymarchStep.glslSource
        useProjectStore.getState().setShaderSource(newSource)
        useProjectStore.getState().triggerRecompile()
      }
    }
    if (hasPostProcessNode(nodesRef.current) || hasRaymarchNode(nodesRef.current)) {
      useProjectStore.getState().setHasUnsavedChanges(true)
    }
  }, [setCompileError, setRenderQueue])

  const updateNodes = useCallback(
    (updater: (prev: Node<GraphNodeData>[]) => Node<GraphNodeData>[]) => {
      setNodes((current) => {
        const updated = updater(current)
        nodesRef.current = updated
        setGraphNodes(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphNodes, compileAndNotify]
  )

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((current) => {
        const updated = applyNodeChanges(changes, current) as Node<GraphNodeData>[]
        nodesRef.current = updated
        setGraphNodes(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphNodes, compileAndNotify]
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setEdges((current) => {
        const updated = applyEdgeChanges(changes, current)
        edgesRef.current = updated
        setGraphEdges(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphEdges, compileAndNotify]
  )

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        const updated = addEdge(connection, current)
        edgesRef.current = updated
        setGraphEdges(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphEdges, compileAndNotify]
  )

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node<GraphNodeData>[] }) => {
      setSelectedNodeId(selectedNodes[0]?.id ?? null)
    },
    [setSelectedNodeId]
  )

  // Sync external store changes (from loadProjectData, resetProject, etc.)
  useEffect(() => {
    if (storeNodes && storeNodes.length > 0 && storeNodes !== nodesRef.current) {
      nodesRef.current = storeNodes
      setNodes(storeNodes)
      compileAndNotify()
    }
  }, [storeNodes, compileAndNotify])

  useEffect(() => {
    if (storeEdges && storeEdges !== edgesRef.current) {
      edgesRef.current = storeEdges
      setEdges(storeEdges)
      compileAndNotify()
    }
  }, [storeEdges, compileAndNotify])

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setGraphNodes(nodesRef.current)
      setGraphEdges(edgesRef.current)
      compileAndNotify()
    }
  }, [setGraphNodes, setGraphEdges, compileAndNotify])

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
      setNodes((current) => {
        const updated = [...current, newNode]
        nodesRef.current = updated
        setGraphNodes(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphNodes, compileAndNotify]
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
      setNodes((current) => {
        const updated = [...current, newNode]
        nodesRef.current = updated
        setGraphNodes(updated)
        compileAndNotify()
        return updated
      })
    },
    [setGraphNodes, compileAndNotify]
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
