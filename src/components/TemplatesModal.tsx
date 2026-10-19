import { useState } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui/button"
import { X, Sparkles, Zap, Layers, Box, Check } from "lucide-react"
import { SHADER_TEMPLATES, type ShaderTemplate } from "@/core/templates"

interface TemplatesModalProps {
  isOpen: boolean
  onClose: () => void
}

export function TemplatesModal({ isOpen, onClose }: TemplatesModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [loadedId, setLoadedId] = useState<string | null>(null)

  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)
  const setUniformValue = useProjectStore((state) => state.setUniformValue)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)
  const setGraphNodes = useProjectStore((state) => state.setGraphNodes)
  const graphNodes = useProjectStore((state) => state._graphNodes)

  if (!isOpen) return null

  const categories = ["All", "Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized"]

  const filteredTemplates = selectedCategory === "All"
    ? SHADER_TEMPLATES
    : SHADER_TEMPLATES.filter((t) => t.category === selectedCategory)

  const handleApplyTemplate = (template: ShaderTemplate) => {
    setActiveBackend(template.backend)
    setShaderSource(template.shaderSource)

    // Set uniform values in store
    for (const [key, val] of Object.entries(template.uniforms)) {
      setUniformValue(key, val)
    }

    // Update geometry on mesh node in graph
    if (graphNodes.length > 0) {
      const updatedNodes = graphNodes.map((n) => {
        if (n.type === "mesh") {
          return {
            ...n,
            data: {
              ...n.data,
              geometry: template.geometry,
            },
          }
        }
        return n
      })
      setGraphNodes(updatedNodes)
    }

    triggerRecompile()
    setLoadedId(template.id)
    setTimeout(() => {
      setLoadedId(null)
      onClose()
    }, 600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex flex-col h-[85vh] w-full max-w-4xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Production Shader Gallery</h2>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary uppercase">
              Curated Presets
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Filter categories bar */}
        <div className="flex items-center gap-1.5 border-b border-border bg-background/50 px-4 py-2 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Templates Grid */}
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => {
            const isLoaded = loadedId === template.id
            return (
              <div
                key={template.id}
                className="flex flex-col rounded-lg border border-border bg-card/80 p-4 shadow-xs hover:border-primary/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                    {template.category}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Box className="h-3 w-3" />
                    <span className="capitalize">{template.geometry.replace("_", " ")}</span>
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">
                  {template.name}
                </h3>

                <p className="text-xs text-muted-foreground leading-relaxed mb-4 line-clamp-3">
                  {template.description}
                </p>

                <div className="mt-auto pt-2 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {Object.keys(template.uniforms).length} uniforms
                  </span>

                  <Button
                    size="sm"
                    onClick={() => handleApplyTemplate(template)}
                    className={`h-7 gap-1.5 text-xs transition-all ${
                      isLoaded ? "bg-emerald-600 text-white" : ""
                    }`}
                  >
                    {isLoaded ? <Check className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                    {isLoaded ? "Loaded!" : "Load Shader"}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
