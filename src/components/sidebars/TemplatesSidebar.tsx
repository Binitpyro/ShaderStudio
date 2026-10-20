import { useState, useRef, useEffect } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { Button } from "@/components/ui"
import { Check, Layers } from "lucide-react"
import { SHADER_TEMPLATES, type ShaderTemplate } from "@/core/templates"
import { SidebarFrame } from "./SidebarFrame"

/** Every template category, in display order. Categories found in data but not listed are appended. */
export const TEMPLATE_CATEGORIES = ["Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized", "Raymarching & SDF"] as const

const geometryLabel = (g: string) => g.replace("_", " ").replace(/^./, (c) => c.toUpperCase())

export function TemplatesSidebar() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const loadedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(loadedTimer.current), [])

  const setShaderSource = useProjectStore((state) => state.setShaderSource)
  const setActiveBackend = useProjectStore((state) => state.setActiveBackend)
  const setUniformValue = useProjectStore((state) => state.setUniformValue)
  const triggerRecompile = useProjectStore((state) => state.triggerRecompile)
  const setGraphNodes = useProjectStore((state) => state.setGraphNodes)

  const extra = [...new Set(SHADER_TEMPLATES.map((t) => t.category))].filter((c) => !(TEMPLATE_CATEGORIES as readonly string[]).includes(c))
  const categories = ["All", ...TEMPLATE_CATEGORIES, ...extra]

  const filteredTemplates = selectedCategory === "All" ? SHADER_TEMPLATES : SHADER_TEMPLATES.filter((t) => t.category === selectedCategory)

  const handleApplyTemplate = (template: ShaderTemplate) => {
    // Templates are GLSL: write the glsl slot and never leave a WebGPU (WGSL) backend active.
    setActiveBackend(template.backend === "webgpu" ? "webgl2" : template.backend)
    setShaderSource(template.shaderSource, "glsl")

    for (const [key, val] of Object.entries(template.uniforms)) {
      setUniformValue(key, val)
    }

    // Update geometry on the mesh node in the graph
    const graphNodes = useProjectStore.getState()._graphNodes
    if (graphNodes.length > 0) {
      setGraphNodes(graphNodes.map((n) => (n.type === "mesh" ? { ...n, data: { ...n.data, geometry: template.geometry } } : n)))
    }

    triggerRecompile()
    setLoadedId(template.id)
    clearTimeout(loadedTimer.current)
    loadedTimer.current = setTimeout(() => setLoadedId(null), 2000)
  }

  return (
    <SidebarFrame title="Templates" className="flex flex-col">
      <div role="group" aria-label="Template category" className="flex flex-wrap gap-1 px-3 py-2">
        {categories.map((cat) => (
          <Button
            key={cat}
            size="sm"
            variant={selectedCategory === cat ? "secondary" : "ghost"}
            aria-pressed={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat)}
            className={selectedCategory === cat ? "text-fg" : undefined}
          >
            {cat}
          </Button>
        ))}
      </div>

      <ul className="flex flex-col gap-2 px-3 pb-3">
        {filteredTemplates.map((template) => (
          <li key={template.id} className="rounded-lg bg-raised p-3 transition-colors hover:bg-hover">
            <h3 className="truncate text-sm font-medium text-fg">{template.name}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{template.description}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-xs text-fg-subtle">
                <Layers className="size-3" />
                {geometryLabel(template.geometry)} · {Object.keys(template.uniforms).length} uniforms
              </span>
              <Button size="sm" variant="secondary" onClick={() => handleApplyTemplate(template)} aria-label={loadedId === template.id ? `Loaded: ${template.name}` : `Load shader: ${template.name}`}>
                {loadedId === template.id ? (
                  <>
                    <Check className="text-success" /> Loaded
                  </>
                ) : (
                  "Load shader"
                )}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SidebarFrame>
  )
}
