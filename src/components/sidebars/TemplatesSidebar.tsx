import { useState } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { Button } from "@/components/ui/button"
import { Palette, Check, Sparkles, PanelLeftClose } from "lucide-react"
import { SHADER_TEMPLATES, type ShaderTemplate } from "@/core/templates"

export function TemplatesSidebar() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [loadedId, setLoadedId] = useState<string | null>(null)

  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)
  const setUniformValue = useProjectStore((state) => state.setUniformValue)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)
  const setGraphNodes = useProjectStore((state) => state.setGraphNodes)

  const categories = ["All", "Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized"]

  const filteredTemplates = selectedCategory === "All"
    ? SHADER_TEMPLATES
    : SHADER_TEMPLATES.filter((t) => t.category === selectedCategory)

  const handleApplyTemplate = (template: ShaderTemplate) => {
    // Templates are GLSL: write the glsl slot and never leave a WebGPU (WGSL) backend active.
    setActiveBackend(template.backend === "webgpu" ? "webgl2" : template.backend)
    setShaderSource(template.shaderSource, "glsl")

    // Set uniform values in store
    for (const [key, val] of Object.entries(template.uniforms)) {
      setUniformValue(key, val)
    }

    // Update geometry on mesh node in graph
    const graphNodes = useProjectStore.getState()._graphNodes
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
    }, 2000)
  }

  const setLeftSidebarOpen = useLayoutStore((state) => state.setLeftSidebarOpen)

  return (
    <div className="flex h-full min-w-[240px] flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            Shader Gallery
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary/60" />
          <button
            type="button"
            onClick={() => setLeftSidebarOpen(false)}
            title="Close Sidebar (Ctrl+B)"
            aria-label="Close Sidebar"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex gap-1 overflow-x-auto p-2 border-b border-border text-xs">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
              selectedCategory === cat
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            className="rounded-md border border-border bg-background/50 p-2.5 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center justify-between gap-1">
              <h4 className="text-xs font-medium text-foreground truncate">{template.name}</h4>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                {template.backend}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
              {template.description}
            </p>
            <div className="mt-2.5 flex items-center justify-between pt-1 border-t border-border/50">
              <span className="text-[10px] text-muted-foreground font-mono">
                {template.geometry}
              </span>
              <Button
                size="sm"
                variant={loadedId === template.id ? "default" : "outline"}
                onClick={() => handleApplyTemplate(template)}
                className="h-6 px-2 text-xs"
              >
                {loadedId === template.id ? (
                  <>
                    <Check className="h-3 w-3 mr-1 text-green-400" /> Loaded
                  </>
                ) : (
                  "Load Shader"
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
