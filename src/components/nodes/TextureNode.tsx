import { memo, useState, useRef } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/projectStore"
import type { TextureNodeData } from "@/core/graphCompiler"

function TextureNodeComponent({ data, selected, id }: NodeProps<TextureNodeData>) {
  const [isDragging, setIsDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const addTextureResource = useProjectStore((s) => s.addTextureResource)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file && file.type.startsWith("image/")) loadTexture(file) }
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) loadTexture(file) }

  const loadTexture = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const src = event.target?.result as string
      const textureId = `tex_${id}`
      const name = file.name
      setPreview(src)
      addTextureResource({ id: textureId, name, src })
      const updateEvent = new CustomEvent("textureLoaded", { detail: { nodeId: id, textureId, name }, bubbles: true })
      document.dispatchEvent(updateEvent)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className={cn("bg-card border rounded-md p-3 min-w-[100px] shadow-sm", selected ? "border-primary" : "border-border")} onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
      <div className="text-xs font-semibold text-foreground mb-2">Texture</div>
      <div className={cn("w-full h-16 border border-dashed rounded flex items-center justify-center cursor-pointer transition-colors", isDragging ? "border-primary bg-primary/10" : "border-border bg-background", preview && "border-solid")} onClick={() => fileInputRef.current?.click()}>
        {preview ? <img src={preview} alt="Texture preview" className="w-full h-full object-cover rounded" /> : <span className="text-xs text-muted-foreground">Drop image</span>}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      {data.textureId && <div className="text-[10px] text-muted-foreground mt-1 truncate">{data.name || "texture"}</div>}
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-orange-500 border-2 border-background" />
    </div>
  )
}
export const TextureNode = memo(TextureNodeComponent)
