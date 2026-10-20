import { memo, useState, useEffect, useRef } from "react"
import { Badge, Button, Select } from "@/components/ui"
import { NodeShell, NodeDetails, DetailRow, Port, Position } from "./NodeShell"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { MeshNodeData } from "@/core/graphCompiler"
import { customModelRegistry } from "@/core/customModelRegistry"
import type { ParsedGeometry } from "@/core/modelLoader"
import { UploadCloud, Box, Loader2, CheckCircle2, AlertCircle, Layers } from "lucide-react"
import { generateMeshLods, selectLodByDistance, type LodLevel } from "@/core/meshLod"

function MeshNodeComponent({ data, selected }: FlowNodeProps<MeshNodeData>) {
  const [model, setModel] = useState<ParsedGeometry | null>(customModelRegistry.getActiveModel())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [lodMode, setLodMode] = useState<"auto" | LodLevel>("auto")
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return customModelRegistry.subscribe((newModel) => {
      setModel(newModel)
    })
  }, [])

  const handleFile = async (file: File) => {
    setIsLoading(true)
    setError(null)
    try {
      const { loadModelFile } = await import("@/core/modelLoader")
      const parsed = await loadModelFile(file)
      customModelRegistry.setActiveModel(parsed)
      const event = new CustomEvent("meshGeometryChange", {
        detail: { geometry: "custom" },
        bubbles: true,
      })
      fileInputRef.current?.dispatchEvent(event)
    } catch (err: any) {
      setError(err?.message || "Failed to load model file")
    } finally {
      setIsLoading(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const detailRows =
    data.geometry === "torus_knot" ? [["Vertices", "1,728"], ["Triangles", "576"], ["Parameters", "p=2, q=3, r=1.0"]]
    : data.geometry === "cube" ? [["Vertices", "36"], ["Triangles", "12"], ["Extents", "1.0 x 1.0 x 1.0"]]
    : data.geometry === "sphere" ? [["Vertices", "720"], ["Triangles", "240"], ["Segments", "32 rings x 16"]]
    : data.geometry === "plane" ? [["Vertices", "6"], ["Triangles", "2"], ["Size", "2.0 x 2.0 quad"]]
    : [["Model triangles", model?.triangleCount?.toLocaleString() ?? "No model loaded"]]

  return (
    <NodeShell
      title="Mesh Geometry"
      icon={Box}
      selected={selected}
      ports={<Port type="source" position={Position.Right} portType="geometry" />}
    >
      <Select
        aria-label="Geometry"
        value={data.geometry}
        onChange={(e) => {
          const select = e.target
          const event = new CustomEvent("meshGeometryChange", { detail: { geometry: select.value }, bubbles: true })
          select.dispatchEvent(event)
        }}
        className="nodrag"
      >
        <option value="cube">Cube</option>
        <option value="sphere">Sphere</option>
        <option value="plane">Plane</option>
        <option value="torus_knot">Torus Knot</option>
        <option value="custom">Custom 3D Model</option>
      </Select>

      {data.geometry === "custom" && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf,.obj"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong bg-raised p-3 text-xs text-fg-muted">
              <Loader2 className="size-4 animate-spin text-brand-text" />
              <span>Parsing 3D mesh...</span>
            </div>
          ) : model ? (
            <div className="flex flex-col gap-1 rounded-md bg-raised p-2 text-xs">
              <div className="flex items-center gap-1.5 truncate font-medium text-fg">
                <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                <span className="truncate">{model.name}</span>
              </div>
              <div className="num pl-5 text-2xs text-fg-muted">{model.triangleCount.toLocaleString()} triangles</div>
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="mt-1 nodrag">Change model</Button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-2.5 text-center text-2xs transition-colors",
                isDragging ? "border-brand bg-brand-soft text-brand-text" : "border-line-strong bg-raised text-fg-muted hover:border-fg-subtle"
              )}
            >
              <UploadCloud className="mb-1 size-4" />
              <span className="font-medium">Drop .glb / .obj</span>
              <span className="text-fg-subtle">or click to browse</span>
            </div>
          )}

          {error && (
            <div className="mt-1 flex items-start gap-1 text-2xs leading-tight text-danger" role="alert">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {selected && (
        <>
          <NodeDetails title="Geometry details">
            {detailRows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
          </NodeDetails>

          <div className="flex flex-col gap-1.5 border-t border-line pt-2 text-2xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-medium text-fg"><Layers className="size-3 text-fg-muted" />Level of detail</span>
              <Badge tone="brand" className="num">
                {lodMode === "auto" ? `${selectLodByDistance(10).toUpperCase()} (Auto)` : lodMode.toUpperCase()}
              </Badge>
            </div>
            <Select aria-label="Level of detail" value={lodMode} onChange={(e) => setLodMode(e.target.value as "auto" | LodLevel)} className="nodrag">
              <option value="auto">Auto (Distance)</option>
              <option value="lod0">LOD 0 (100% Detail)</option>
              <option value="lod1">LOD 1 (50% Detail)</option>
              <option value="lod2">LOD 2 (25% Detail)</option>
            </Select>
            {(() => {
              const baseVertices = data.geometry === "torus_knot" ? 1728
                : data.geometry === "cube" ? 36
                : data.geometry === "sphere" ? 720
                : data.geometry === "plane" ? 6
                : model ? (model.triangleCount * 3) : 0
              const lods = generateMeshLods(baseVertices)
              return (
                <div className="grid grid-cols-3 gap-1 text-center">
                  {([["L0", lods.lod0], ["L1", lods.lod1], ["L2", lods.lod2]] as const).map(([k, v]) => (
                    <div key={k} className="rounded-md bg-raised py-1">
                      <div className="text-fg-muted">{k}</div>
                      <div className="num text-fg">{v}v</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </>
      )}
    </NodeShell>
  )
}
export const MeshNode = memo(MeshNodeComponent)
