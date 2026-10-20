import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui"
import { Check, Layers } from "lucide-react"
import { SHADER_TEMPLATES, applyTemplate, type ShaderTemplate } from "@/core/templates"
import { SidebarFrame } from "./SidebarFrame"

/** Every template category, in display order. Categories found in data but not listed are appended. */
export const TEMPLATE_CATEGORIES = ["Sci-Fi & VFX", "Atmospheric", "Surfaces & PBR", "Retro & Stylized", "Raymarching & SDF"] as const

const geometryLabel = (g: string) => g.replace("_", " ").replace(/^./, (c) => c.toUpperCase())

export function TemplatesSidebar() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const loadedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(loadedTimer.current), [])

  const extra = [...new Set(SHADER_TEMPLATES.map((t) => t.category))].filter((c) => !(TEMPLATE_CATEGORIES as readonly string[]).includes(c))
  const categories = ["All", ...TEMPLATE_CATEGORIES, ...extra]

  const filteredTemplates = selectedCategory === "All" ? SHADER_TEMPLATES : SHADER_TEMPLATES.filter((t) => t.category === selectedCategory)

  const handleApplyTemplate = (template: ShaderTemplate) => {
    // Both languages + (SDF) graph are written; the user's active backend is kept.
    applyTemplate(template)
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
