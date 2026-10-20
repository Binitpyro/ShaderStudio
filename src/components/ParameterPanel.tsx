import { useState, useEffect } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { ChevronsUpDown } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import {
  AccordionSection,
  UniformsSection,
  RenderSection,
  EnvironmentSection,
  AudioDynamicsSection,
  ComputeSimulationSection,
  VariationsSection,
  NodePreviewViewport,
} from "@/components/inspector"

export type AccordionSectionKey = "uniforms" | "render" | "environment" | "audio" | "compute" | "variations"

const ALL_KEYS: AccordionSectionKey[] = ["uniforms", "render", "environment", "audio", "compute", "variations"]
const DEFAULT_OPEN: AccordionSectionKey[] = ["uniforms", "render"]
export const INSPECTOR_SECTIONS_KEY = "shaderstudio.inspector.sections"

function loadOpen(): Set<AccordionSectionKey> {
  try {
    const raw = localStorage.getItem(INSPECTOR_SECTIONS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return new Set(parsed.filter((k): k is AccordionSectionKey => ALL_KEYS.includes(k as AccordionSectionKey)))
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return new Set(DEFAULT_OPEN)
}

export function ParameterPanel() {
  const uniformCount = useProjectStore((s) => (s.parsedUniforms.length > 0 ? s.parsedUniforms.length : 1) + s.graphUniforms.length)
  const isAudioPlaying = useProjectStore((s) => s.isAudioPlaying)
  const activeBindingCount = useProjectStore((s) => Object.keys(s.audioBindings).length)
  const variationCount = useProjectStore((s) => s.variations.length)
  const showCompute = useProjectStore((s) => s.activeBackend === "webgpu" && !!s.renderQueue?.some((step) => step.type === "compute"))
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId)
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId)
  const selectedNode = useProjectStore((s) => s._graphNodes.find((n) => n.id === s.selectedNodeId))

  const [open, setOpen] = useState<Set<AccordionSectionKey>>(loadOpen)

  useEffect(() => {
    try {
      localStorage.setItem(INSPECTOR_SECTIONS_KEY, JSON.stringify([...open]))
    } catch {
      /* ignore */
    }
  }, [open])

  useEffect(() => {
    if (!selectedNodeId) return
    const reveal = selectedNodeId.startsWith("audio") ? "audio" : selectedNodeId.startsWith("mat") || selectedNodeId.startsWith("mesh") ? "uniforms" : selectedNodeId.startsWith("comp") ? "compute" : null
    if (reveal) setOpen((prev) => (prev.has(reveal) ? prev : new Set([...prev, reveal])))
  }, [selectedNodeId])

  const toggle = (key: AccordionSectionKey) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const visible = ALL_KEYS.filter((k) => k !== "compute" || showCompute)
  const anyOpen = visible.some((k) => open.has(k))
  const toggleAll = () => setOpen(anyOpen ? new Set() : new Set(visible))

  const sectionProps = (key: AccordionSectionKey) => ({ id: key, isOpen: open.has(key), onToggle: () => toggle(key) })

  return (
    <div data-testid="parameter-panel" className="flex h-full flex-col overflow-hidden bg-panel text-fg select-none">
      <div className="flex h-8 shrink-0 items-center justify-end border-b border-line px-2">
        <IconButton label={anyOpen ? "Collapse all sections" : "Expand all sections"} onClick={toggleAll} className="size-7">
          <ChevronsUpDown className="size-3.5" />
        </IconButton>
      </div>

      {selectedNode ? (
        <div className="mx-3 mt-3 shrink-0">
          <NodePreviewViewport node={selectedNode} onClose={() => setSelectedNodeId(null)} />
        </div>
      ) : null}

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <AccordionSection {...sectionProps("uniforms")} title="Parameters" badge={uniformCount}>
          <UniformsSection />
        </AccordionSection>

        <AccordionSection {...sectionProps("render")} title="Render">
          <RenderSection />
        </AccordionSection>

        <AccordionSection {...sectionProps("environment")} title="Environment & lighting">
          <EnvironmentSection />
        </AccordionSection>

        <AccordionSection {...sectionProps("audio")} title="Audio" badge={isAudioPlaying ? "Live" : activeBindingCount > 0 ? `${activeBindingCount} bound` : undefined}>
          <AudioDynamicsSection />
        </AccordionSection>

        {showCompute ? (
          <AccordionSection {...sectionProps("compute")} title="Compute">
            <ComputeSimulationSection />
          </AccordionSection>
        ) : null}

        <AccordionSection {...sectionProps("variations")} title="Variations" badge={variationCount > 0 ? variationCount : undefined}>
          <VariationsSection />
        </AccordionSection>
      </div>
    </div>
  )
}
