import { useCallback, useEffect, useRef } from "react"
import ReactFlow, { type Node, type Edge, type Connection, type OnConnect, type OnNodesChange, type OnEdgesChange, type NodeTypes, addEdge, applyNodeChanges, applyEdgeChanges, Controls, Background, BackgroundVariant, Panel } from "reactflow"
import "reactflow/dist/style.css"
import { MeshNode } from "@/components/nodes/MeshNode"
import { MaterialNode } from "@/components/nodes/MaterialNode"
import { TextureNode } from "@/components/nodes/TextureNode"
import { UniformNode } from "@/components/nodes/UniformNode"
import { TimeNode } from "@/components/nodes/TimeNode"
import { PostProcessNode } from "@/components/nodes/PostProcessNode"
import { OutputNode } from "@/components/nodes/OutputNode"
import { Button } from "@/components/ui/button"
import { compileGraph, type GraphNodeData, hasPostProcessNode } from "@/core/graphCompiler"
import { useProjectStore } from "@/stores/projectStore"
import { cn } from "@/lib/utils"

import { PostProcessDrawer } from "@/components/PostProcessDrawer"
import { useState } from "react"

const nodeTypes: NodeTypes = { mesh: MeshNode, material: MaterialNode, texture: TextureNode, uniform: UniformNode, time: TimeNode, postprocess: PostProcessNode, output: OutputNode }

const DEFAULT_NODES: Node<GraphNodeData>[] = [
  { id: "mesh-1", type: "mesh", position: { x: 50, y: 100 }, data: { type: "mesh", geometry: "cube" } },
  { id: "material-1", type: "material", position: { x: 230, y: 80 }, data: { type: "material", shaderPath: null } },
  { id: "postprocess-1", type: "postprocess", position: { x: 420, y: 60 }, data: { type: "postprocess", passType: "vignette", params: { intensity: 0.5, radius: 0.8 } } },
  { id: "output-1", type: "output", position: { x: 670, y: 100 }, data: { type: "output" } },
]

const DEFAULT_EDGES: Edge[] = [
  { id: "e1", source: "mesh-1", target: "material-1", sourceHandle: null, targetHandle: "mesh" },
  { id: "e2", source: "material-1", target: "postprocess-1", sourceHandle: null, targetHandle: null },
  { id: "e3", source: "postprocess-1", target: "output-1", sourceHandle: null, targetHandle: null },
]

interface NodeGraphProps { className?: string }

export function NodeGraph({ className }: NodeGraphProps) {
  const [drawer, setDrawer] = useState<{ isOpen: boolean; nodeId: string | null; customSource?: string }>({
    isOpen: false,
    nodeId: null,
  })
  const setCompileError = useProjectStore((s) => s.setLastCompileError)
  const setRenderQueue = useProjectStore((s) => s.setRenderQueue)
  const setGraphNodes = useProjectStore((s) => s.setGraphNodes)
  const setGraphEdges = useProjectStore((s) => s.setGraphEdges)

  const nodesRef = useRef<Node<GraphNodeData>[]>(DEFAULT_NODES)
  const edgesRef = useRef<Edge[]>(DEFAULT_EDGES)
  const initialized = useRef(false)

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    nodesRef.current = applyNodeChanges(changes, nodesRef.current) as Node<GraphNodeData>[]
    setGraphNodes([...nodesRef.current])
    compileAndNotify()
  }, [setGraphNodes])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    edgesRef.current = applyEdgeChanges(changes, edgesRef.current)
    setGraphEdges([...edgesRef.current])
    compileAndNotify()
  }, [setGraphEdges])

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    edgesRef.current = addEdge(connection, edgesRef.current)
    setGraphEdges([...edgesRef.current])
    compileAndNotify()
  }, [setGraphEdges])

  const compileAndNotify = useCallback(() => {
    const result = compileGraph(nodesRef.current, edgesRef.current)
    const error = result.error; const queue = result.queue
    if (error) { setCompileError(error); setRenderQueue(null) }
    else { setCompileError(null); setRenderQueue(queue) }
    // Check for post-process nodes
    if (hasPostProcessNode(nodesRef.current)) {
      // Set a flag for adapters to know post-processing is enabled
      useProjectStore.getState().setHasUnsavedChanges(true)
    }
  }, [setCompileError, setRenderQueue])

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
      const nodeEl = target.closest('[data-id]')
      const nodeId = nodeEl?.getAttribute("data-id")
      if (nodeId) {
        nodesRef.current = nodesRef.current.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, geometry: e.detail.geometry } } : n) as Node<GraphNodeData>[]
        setGraphNodes([...nodesRef.current])
        compileAndNotify()
      }
    }
    document.addEventListener("meshGeometryChange", handleMeshChange as EventListener)
    return () => { document.removeEventListener("meshGeometryChange", handleMeshChange as EventListener) }
  }, [setGraphNodes, compileAndNotify])

  useEffect(() => {
    const handleTexture = (e: CustomEvent) => {
      const { nodeId, textureId, name } = e.detail
      nodesRef.current = nodesRef.current.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, textureId, name } } : n) as Node<GraphNodeData>[]
      setGraphNodes([...nodesRef.current])
      compileAndNotify()
    }
    document.addEventListener("textureLoaded", handleTexture as EventListener)
    return () => { document.removeEventListener("textureLoaded", handleTexture as EventListener) }
  }, [setGraphNodes, compileAndNotify])

  useEffect(() => {
    const handleTypeChange = (e: CustomEvent) => {
      const { nodeId, passType, params } = e.detail
      nodesRef.current = nodesRef.current.map((n) =>
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
      ) as Node<GraphNodeData>[]
      setGraphNodes([...nodesRef.current])
      compileAndNotify()
    }

    const handleParamChange = (e: CustomEvent) => {
      const { nodeId, allParams } = e.detail
      nodesRef.current = nodesRef.current.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                params: allParams,
              },
            }
          : n
      ) as Node<GraphNodeData>[]
      setGraphNodes([...nodesRef.current])
    }

    const handleEditShader = (e: CustomEvent) => {
      const { nodeId, customSource } = e.detail
      setDrawer({
        isOpen: true,
        nodeId,
        customSource,
      })
    }

    document.addEventListener("postProcessTypeChange", handleTypeChange as EventListener)
    document.addEventListener("postProcessParamChange", handleParamChange as EventListener)
    document.addEventListener("editPostProcessShader", handleEditShader as EventListener)
    return () => {
      document.removeEventListener("postProcessTypeChange", handleTypeChange as EventListener)
      document.removeEventListener("postProcessParamChange", handleParamChange as EventListener)
      document.removeEventListener("editPostProcessShader", handleEditShader as EventListener)
    }
  }, [setGraphNodes, compileAndNotify])

  const handleSaveCustomShader = useCallback((nodeId: string, code: string) => {
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            data: {
              ...n.data,
              customSource: code,
            },
          }
        : n
    ) as Node<GraphNodeData>[]
    setGraphNodes([...nodesRef.current])
    compileAndNotify()
  }, [setGraphNodes, compileAndNotify])

  const addNode = useCallback((type: string) => {
    const id = `${type}-${Date.now()}`
    const position = { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 }
    let data: GraphNodeData
    switch (type) {
      case "mesh": data = { type: "mesh", geometry: "cube" }; break
      case "material": data = { type: "material", shaderPath: null }; break
      case "texture": data = { type: "texture", textureId: null, name: "" }; break
      case "uniform": data = { type: "uniform", uniformId: `uniform_${id}`, name: "param", uniformType: "float", defaultValue: 0.5 }; break
      case "time": data = { type: "time" }; break
      case "postprocess": data = { type: "postprocess", passType: "vignette", params: { intensity: 0.5, radius: 0.8 } }; break
      case "output": data = { type: "output" }; break
      default: return
    }
    nodesRef.current = [...nodesRef.current, { id, type, position, data }]
    setGraphNodes([...nodesRef.current])
    compileAndNotify()
  }, [setGraphNodes, compileAndNotify])

  return (
    <div className={cn("h-full w-full relative", className)}>
      <ReactFlow nodes={nodesRef.current} edges={edgesRef.current} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} className="bg-background">
        <Background color="var(--border)" variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls className="!bg-card !border-border !rounded" />
        <Panel position="top-left" className="!m-2">
          <div className="flex flex-wrap gap-1">
            {["mesh", "material", "texture", "uniform", "time", "postprocess", "output"].map((type) => (
              <Button key={type} variant="outline" size="sm" onClick={() => addNode(type)} className="text-[10px] h-6 px-2">+{type.charAt(0).toUpperCase() + type.slice(1)}</Button>
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
    </div>
  )
}
