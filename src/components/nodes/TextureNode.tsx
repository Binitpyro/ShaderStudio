import { memo, useState, useRef } from "react"
import { Image as ImageIcon } from "lucide-react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/projectStore"
import type { TextureNodeData } from "@/core/graphCompiler"
import { NodeShell, Port, Position } from "./NodeShell"

function TextureNodeComponent({ data, selected, id }: FlowNodeProps<TextureNodeData>) {
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
    <NodeShell title="Texture" icon={ImageIcon} size="sm" selected={selected} ports={<Port type="source" position={Position.Right} portType="texture" />}>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn("flex h-16 w-full cursor-pointer items-center justify-center rounded-md border border-dashed transition-colors", isDragging ? "border-brand bg-brand-soft" : "border-line-strong bg-raised", preview && "border-solid")}
      >
        {preview ? <img src={preview} alt="Texture preview" className="h-full w-full rounded-md object-cover" /> : <span className="text-xs text-fg-subtle">Drop image</span>}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      {data.textureId && <div className="truncate text-2xs text-fg-muted">{data.name || "texture"}</div>}
    </NodeShell>
  )
}
export const TextureNode = memo(TextureNodeComponent)
