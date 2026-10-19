import { memo, useState, useEffect, useRef } from "react"
import { Handle, Position } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { MeshNodeData } from "@/core/graphCompiler"
import { customModelRegistry } from "@/core/customModelRegistry"
import { loadModelFile, type ParsedGeometry } from "@/core/modelLoader"
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

  return (
    <div
      className={cn(
        "bg-card border rounded-md p-3 shadow-sm select-none text-foreground transition-all duration-150",
        selected
          ? "border-primary ring-2 ring-primary/30 min-w-[210px] max-w-[240px] shadow-lg"
          : "border-border min-w-[160px] max-w-[220px]"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
        <Box className="w-3.5 h-3.5 text-primary" />
        <span>Mesh Geometry</span>
      </div>
      <select
        value={data.geometry}
        onChange={(e) => {
          const select = e.target
          const event = new CustomEvent("meshGeometryChange", { detail: { geometry: select.value }, bubbles: true })
          select.dispatchEvent(event)
        }}
        className="w-full bg-background text-xs border border-border rounded px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-primary nodrag"
      >
        <option value="cube">Cube</option>
        <option value="sphere">Sphere</option>
        <option value="plane">Plane</option>
        <option value="torus_knot">Torus Knot</option>
        <option value="custom">Custom 3D Model</option>
      </select>

      {data.geometry === "custom" && (
        <div className="mt-1">
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
            <div className="flex flex-col items-center justify-center p-3 border border-dashed border-border rounded bg-muted/20 text-muted-foreground text-[11px] gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>Parsing 3D mesh...</span>
            </div>
          ) : model ? (
            <div className="flex flex-col gap-1 p-2 bg-muted/30 border border-border/60 rounded text-[11px]">
              <div className="flex items-center gap-1.5 text-foreground font-medium truncate">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">{model.name}</span>
              </div>
              <div className="text-[10px] text-muted-foreground pl-5">
                {model.triangleCount.toLocaleString()} triangles
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 text-[10px] bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded text-center transition-colors cursor-pointer"
              >
                Change Model
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center p-2.5 border border-dashed rounded text-center cursor-pointer transition-colors text-[10px]",
                isDragging ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/60 bg-muted/10 text-muted-foreground"
              )}
            >
              <UploadCloud className="w-4 h-4 mb-1 text-muted-foreground" />
              <span className="font-medium">Drop .glb / .obj</span>
              <span className="text-[9px] text-muted-foreground/70">or click to browse</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1 mt-1 text-[10px] text-destructive leading-tight">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1.5 font-mono text-[10px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="font-semibold text-foreground text-[11px]">Geometry Details</span>
            <span className="text-[9px] text-primary font-bold uppercase">{data.geometry}</span>
          </div>

          <div className="p-1.5 rounded bg-muted/30 border border-border/50 flex flex-col gap-1">
            {data.geometry === "torus_knot" && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Vertices</span>
                  <span className="text-foreground font-semibold">1,728</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Triangles</span>
                  <span className="text-foreground font-semibold">576</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Parameters</span>
                  <span className="text-foreground">p=2, q=3, r=1.0</span>
                </div>
              </>
            )}
            {data.geometry === "cube" && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Vertices</span>
                  <span className="text-foreground font-semibold">36</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Triangles</span>
                  <span className="text-foreground font-semibold">12</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Extents</span>
                  <span className="text-foreground">1.0 × 1.0 × 1.0</span>
                </div>
              </>
            )}
            {data.geometry === "sphere" && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Vertices</span>
                  <span className="text-foreground font-semibold">720</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Triangles</span>
                  <span className="text-foreground font-semibold">240</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Segments</span>
                  <span className="text-foreground">32 rings × 16</span>
                </div>
              </>
            )}
            {data.geometry === "plane" && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Vertices</span>
                  <span className="text-foreground font-semibold">6</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Triangles</span>
                  <span className="text-foreground font-semibold">2</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Size</span>
                  <span className="text-foreground">2.0 × 2.0 Quad</span>
                </div>
              </>
            )}
            {data.geometry === "custom" && (
              <div className="flex justify-between text-muted-foreground">
                <span>Model Triangles</span>
                <span className="text-foreground font-semibold">{model?.triangleCount?.toLocaleString() ?? "No model loaded"}</span>
              </div>
            )}
          </div>

          {/* Mesh LOD System (R5c) */}
          <div className="p-1.5 rounded bg-muted/20 border border-border/40 flex flex-col gap-1 text-[10px]">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-foreground">
                <Layers className="w-3 h-3 text-primary" />
                <span>Level of Detail</span>
              </span>
              <span className="text-[9px] px-1 py-0.2 bg-primary/20 text-primary font-mono rounded">
                {lodMode === "auto" ? `${selectLodByDistance(10).toUpperCase()} (Auto)` : lodMode.toUpperCase()}
              </span>
            </div>
            <select
              value={lodMode}
              onChange={(e) => setLodMode(e.target.value as "auto" | LodLevel)}
              className="w-full bg-background text-[10px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary nodrag cursor-pointer"
            >
              <option value="auto">Auto (Distance)</option>
              <option value="lod0">LOD 0 (100% Detail)</option>
              <option value="lod1">LOD 1 (50% Detail)</option>
              <option value="lod2">LOD 2 (25% Detail)</option>
            </select>
            {(() => {
              const baseVertices = data.geometry === "torus_knot" ? 1728
                : data.geometry === "cube" ? 36
                : data.geometry === "sphere" ? 720
                : data.geometry === "plane" ? 6
                : model ? (model.triangleCount * 3) : 0
              const lods = generateMeshLods(baseVertices)
              return (
                <div className="grid grid-cols-3 gap-1 text-[9px] text-center pt-1 border-t border-border/30">
                  <div className="bg-background/80 rounded py-0.5 border border-border/40">
                    <div className="text-muted-foreground font-mono">L0</div>
                    <div className="text-foreground font-semibold">{lods.lod0}v</div>
                  </div>
                  <div className="bg-background/80 rounded py-0.5 border border-border/40">
                    <div className="text-muted-foreground font-mono">L1</div>
                    <div className="text-foreground font-semibold">{lods.lod1}v</div>
                  </div>
                  <div className="bg-background/80 rounded py-0.5 border border-border/40">
                    <div className="text-muted-foreground font-mono">L2</div>
                    <div className="text-foreground font-semibold">{lods.lod2}v</div>
                  </div>
                </div>
              )
            })()}
          </div>

          <div className="flex items-center justify-between text-[9px] text-muted-foreground pt-0.5 border-t border-border/30">
            <span>Buffer Layout: 12B stride</span>
            <span className="text-emerald-400">float32x3</span>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  )
}
export const MeshNode = memo(MeshNodeComponent)
