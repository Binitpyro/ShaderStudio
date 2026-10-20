import { useState, useEffect } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { Sliders, Sun, Activity, Cpu, Sparkles, ChevronsUpDown } from "lucide-react"
import {
  AccordionSection,
  UniformsSection,
  EnvironmentSection,
  AudioDynamicsSection,
  ComputeSimulationSection,
  VariationsSection,
  NodePreviewViewport,
} from "@/components/inspector"

export type AccordionSectionKey =
  | "uniforms"
  | "environment"
  | "audio"
  | "compute"
  | "variations"

export function ParameterPanel() {
  const parsedUniforms = useProjectStore((state) => state.parsedUniforms)
  const graphUniforms = useProjectStore((state) => state.graphUniforms)
  const isAudioPlaying = useProjectStore((state) => state.isAudioPlaying)
  const audioBindings = useProjectStore((state) => state.audioBindings)
  const variations = useProjectStore((state) => state.variations)
  const renderQueue = useProjectStore((state) => state.renderQueue)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const setSelectedNodeId = useProjectStore((state) => state.setSelectedNodeId)
  const selectedNode = useProjectStore((state) => state._graphNodes.find((n) => n.id === state.selectedNodeId))

  const hasCompute = renderQueue?.some((step) => step.type === "compute")
  const activeBindingCount = Object.keys(audioBindings).length
  const totalUniformCount =
    parsedUniforms.length > 0
      ? parsedUniforms.length + graphUniforms.length
      : 1 + graphUniforms.length

  const [openSections, setOpenSections] = useState<Set<AccordionSectionKey>>(
    () => new Set<AccordionSectionKey>(["uniforms", "environment"])
  )

  useEffect(() => {
    if (!selectedNodeId) return
    if (selectedNodeId.startsWith("audio")) {
      setOpenSections((prev) => new Set([...prev, "audio"]))
    } else if (selectedNodeId.startsWith("mat") || selectedNodeId.startsWith("mesh")) {
      setOpenSections((prev) => new Set([...prev, "uniforms"]))
    } else if (selectedNodeId.startsWith("comp")) {
      setOpenSections((prev) => new Set([...prev, "compute"]))
    }
  }, [selectedNodeId])

  const toggleSection = (key: AccordionSectionKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (openSections.size > 0) {
      setOpenSections(new Set())
    } else {
      setOpenSections(
        new Set<AccordionSectionKey>([
          "uniforms",
          "environment",
          "audio",
          "compute",
          "variations",
        ])
      )
    }
  }

  return (
    <div
      data-testid="parameter-panel"
      className="flex h-full flex-col overflow-hidden bg-card text-card-foreground select-none"
    >
      {/* Quick Actions Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/50 bg-muted/10 px-3 text-[11px] font-mono text-muted-foreground">
        <span>5 Inspector Sections</span>
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title={openSections.size > 0 ? "Collapse all sections" : "Expand all sections"}
        >
          <ChevronsUpDown className="h-3 w-3" />
          <span>{openSections.size > 0 ? "Collapse All" : "Expand All"}</span>
        </button>
      </div>

      {/* Selected Node Live Preview (R1d) */}
      {selectedNode && (
        <div className="mx-3 mt-2 shrink-0">
          <NodePreviewViewport
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}

      {/* Accordion List Container */}
      <div className="flex-1 overflow-y-auto">
        {/* Section 1: Shader Uniforms */}
        <AccordionSection
          id="uniforms"
          title="Shader Uniforms"
          icon={<Sliders className="h-3.5 w-3.5" />}
          badge={totalUniformCount}
          isOpen={openSections.has("uniforms")}
          onToggle={() => toggleSection("uniforms")}
        >
          <UniformsSection />
        </AccordionSection>

        {/* Section 2: Studio Environment & Lighting */}
        <AccordionSection
          id="environment"
          title="Studio Environment & Lighting"
          icon={<Sun className="h-3.5 w-3.5 text-amber-400" />}
          isOpen={openSections.has("environment")}
          onToggle={() => toggleSection("environment")}
        >
          <EnvironmentSection />
        </AccordionSection>

        {/* Section 3: Audio Dynamics */}
        <AccordionSection
          id="audio"
          title="Audio Dynamics"
          icon={<Activity className="h-3.5 w-3.5 text-emerald-400" />}
          badge={
            isAudioPlaying
              ? "LIVE"
              : activeBindingCount > 0
              ? `${activeBindingCount} bound`
              : undefined
          }
          isOpen={openSections.has("audio")}
          onToggle={() => toggleSection("audio")}
        >
          <AudioDynamicsSection />
        </AccordionSection>

        {/* Section 4: Compute Simulation */}
        <AccordionSection
          id="compute"
          title="Compute Simulation"
          icon={<Cpu className="h-3.5 w-3.5 text-cyan-400" />}
          badge={hasCompute ? "COMPUTE" : undefined}
          isOpen={openSections.has("compute")}
          onToggle={() => toggleSection("compute")}
        >
          <ComputeSimulationSection />
        </AccordionSection>

        {/* Section 5: Variations & Presets */}
        <AccordionSection
          id="variations"
          title="Variations & Presets"
          icon={<Sparkles className="h-3.5 w-3.5 text-purple-400" />}
          badge={variations.length > 0 ? variations.length : undefined}
          isOpen={openSections.has("variations")}
          onToggle={() => toggleSection("variations")}
        >
          <VariationsSection />
        </AccordionSection>
      </div>
    </div>
  )
}
