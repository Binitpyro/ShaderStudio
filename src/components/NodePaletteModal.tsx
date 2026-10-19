import { useState, useEffect, useRef } from "react"
import {
  Box,
  Circle,
  Layers,
  Sparkles,
  Music,
  Clock,
  Sliders,
  Tv,
  Image as ImageIcon,
  Cpu,
  Search,
  X,
  Shapes,
  Combine,
  Eye,
  Calculator,
  MessageSquare,
  LayoutGrid,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { GraphNodeData } from "@/core/graphCompiler"
import { DEFAULT_PRIMITIVE_PARAMS } from "@/core/sdf/sdfPrimitives"
import { DEFAULT_OPERATOR_PARAMS } from "@/core/sdf/sdfOperators"
import { customNodeRegistry } from "@/core/customNodeSdk"
import { subGraphLibrary } from "@/core/subGraphLibrary"

export interface PaletteNodeItem {
  id: string
  label: string
  type: string
  category: "Geometry" | "Shading" | "Post-Processing" | "Dynamics & Audio" | "SDF & Raymarching" | "Output" | "Custom"
  description: string
  icon: React.ElementType
  defaultData: GraphNodeData
}

export const NODE_PALETTE_ITEMS: PaletteNodeItem[] = [
  // Geometry
  {
    id: "mesh-sphere",
    label: "Sphere Mesh",
    type: "mesh",
    category: "Geometry",
    description: "Smooth 3D UV sphere geometry with customizable normals and tangents.",
    icon: Circle,
    defaultData: { type: "mesh", geometry: "sphere" },
  },
  {
    id: "mesh-torus-knot",
    label: "Torus Knot Mesh",
    type: "mesh",
    category: "Geometry",
    description: "Complex interlaced mathematical torus knot geometry.",
    icon: Layers,
    defaultData: { type: "mesh", geometry: "torus_knot" },
  },
  {
    id: "mesh-cube",
    label: "Cube Mesh",
    type: "mesh",
    category: "Geometry",
    description: "Standard six-sided 3D box geometry.",
    icon: Box,
    defaultData: { type: "mesh", geometry: "cube" },
  },
  {
    id: "mesh-plane",
    label: "Plane Mesh",
    type: "mesh",
    category: "Geometry",
    description: "2D flat quad surface ideal for screens, ocean waves, and grids.",
    icon: Tv,
    defaultData: { type: "mesh", geometry: "plane" },
  },
  {
    id: "mesh-custom",
    label: "Custom 3D Model Mesh",
    type: "mesh",
    category: "Geometry",
    description: "Import your own .glb, .gltf, or .obj 3D models with normalized scale.",
    icon: Box,
    defaultData: { type: "mesh", geometry: "custom" },
  },

  // Shading
  {
    id: "material",
    label: "Material Node",
    type: "material",
    category: "Shading",
    description: "Compiles fragment/vertex shaders and binds texture Samplers.",
    icon: Sparkles,
    defaultData: { type: "material", shaderPath: null },
  },
  {
    id: "texture",
    label: "Texture Map",
    type: "texture",
    category: "Shading",
    description: "2D image sampler resource for Albedo, Normal, Roughness, or Height.",
    icon: ImageIcon,
    defaultData: { type: "texture", textureId: null, name: "" },
  },
  {
    id: "uniform",
    label: "Uniform Parameter",
    type: "uniform",
    category: "Shading",
    description: "Injects dynamic scalars, vectors, or colors into shader uniforms.",
    icon: Sliders,
    defaultData: { type: "uniform", uniformId: "uniform_param", name: "u_custom", uniformType: "float", defaultValue: 1.0 },
  },
  {
    id: "time",
    label: "Time Provider",
    type: "time",
    category: "Shading",
    description: "Provides elapsed time clock (u_time) for animated vertex and pixel effects.",
    icon: Clock,
    defaultData: { type: "time" },
  },

  // Post-Processing
  {
    id: "postprocess-bloom",
    label: "Bloom Glow Pass",
    type: "postprocess",
    category: "Post-Processing",
    description: "High-intensity threshold bloom and volumetric emission glow.",
    icon: Sparkles,
    defaultData: { type: "postprocess", passType: "bloom", params: { bloomThreshold: 0.65, bloomIntensity: 0.8 } },
  },
  {
    id: "postprocess-aberration",
    label: "Chromatic Aberration",
    type: "postprocess",
    category: "Post-Processing",
    description: "RGB spectral lens dispersion with directional radial separation.",
    icon: Tv,
    defaultData: { type: "postprocess", passType: "chromatic_aberration", params: { aberrationOffset: 0.008 } },
  },
  {
    id: "postprocess-vignette",
    label: "Vignette Pass",
    type: "postprocess",
    category: "Post-Processing",
    description: "Smooth cinematic lens corner darkening falloff.",
    icon: Circle,
    defaultData: { type: "postprocess", passType: "vignette", params: { intensity: 0.5, radius: 0.8 } },
  },
  {
    id: "postprocess-blur",
    label: "Gaussian Blur",
    type: "postprocess",
    category: "Post-Processing",
    description: "Two-pass separable kernel Gaussian blur for depth and softness.",
    icon: Layers,
    defaultData: { type: "postprocess", passType: "blur", params: { blurAmount: 2.0 } },
  },
  {
    id: "postprocess-custom",
    label: "Custom Post-Process Shader",
    type: "postprocess",
    category: "Post-Processing",
    description: "Write full GLSL / WGSL custom fullscreen quad post-processing shader passes.",
    icon: Sparkles,
    defaultData: { type: "postprocess", passType: "custom" },
  },

  // Dynamics & Audio
  {
    id: "compute-particles",
    label: "Compute GPGPU Particles",
    type: "compute",
    category: "Dynamics & Audio",
    description: "Massively parallel GPU compute simulation (Curl noise, galaxy spiral, Lorenz attractor).",
    icon: Cpu,
    defaultData: {
      type: "compute",
      preset: "curl_noise",
      particleCount: 50000,
      params: { speed: 1.0, damping: 0.98, strength: 1.0, noiseScale: 1.0, pointSize: 4.0, blendMode: 1.0 },
    },
  },
  {
    id: "audio-dsp",
    label: "Audio DSP Analyzer",
    type: "audio",
    category: "Dynamics & Audio",
    description: "Real-time FFT audio spectrum, waveform buffer, and beat detection generator.",
    icon: Music,
    defaultData: { type: "audio", sourceType: "builtin", volume: 0.8, gain: 1.2, smoothing: 0.8 },
  },

  // SDF & Raymarching
  {
    id: "sdf-primitive",
    label: "SDF Primitive",
    type: "sdf_primitive",
    category: "SDF & Raymarching",
    description: "Mathematical Signed Distance Field primitive (Sphere, Box, Torus, Cylinder, Capsule, Plane).",
    icon: Shapes,
    defaultData: { type: "sdf_primitive", primitiveType: "sphere", params: DEFAULT_PRIMITIVE_PARAMS.sphere },
  },
  {
    id: "sdf-operator",
    label: "SDF Operator",
    type: "sdf_operator",
    category: "SDF & Raymarching",
    description: "Boolean blend & domain deformation operator (Smooth Union, Subtract, Intersect, Repeat, Twist).",
    icon: Combine,
    defaultData: { type: "sdf_operator", operatorType: "smooth_union", params: DEFAULT_OPERATOR_PARAMS.smooth_union },
  },
  {
    id: "raymarch-engine",
    label: "Raymarch Engine",
    type: "raymarch",
    category: "SDF & Raymarching",
    description: "Real-time procedural raymarching volumetric renderer with soft shadows and AO.",
    icon: Eye,
    defaultData: { type: "raymarch", maxSteps: 128, maxDistance: 40.0, hitEpsilon: 0.001, enableShadows: true, enableAo: true },
  },

  // Output
  {
    id: "output",
    label: "Viewport Output",
    type: "output",
    category: "Output",
    description: "Final rendering swapchain destination presented on the active canvas.",
    icon: Tv,
    defaultData: { type: "output" },
  },

  // Math Expression Node (R1c)
  {
    id: "math-expression",
    label: "Math Expression",
    type: "math_expression",
    category: "Shading",
    description: "Evaluates an inline GLSL/WGSL mathematical formula referencing connected inputs.",
    icon: Calculator,
    defaultData: {
      type: "math_expression",
      expression: "sin(uv.x * 10.0) * 0.5 + 0.5",
      inputNames: ["uv"],
      outputType: "float",
    },
  },

  // Built-in Library Sub-graphs (R1a)
  {
    id: "subgraph-fresnel-rim",
    label: "Fresnel Rim Lighting",
    type: "subgraph",
    category: "Shading",
    description: "Reusable sub-graph calculating smooth Fresnel rim lighting based on normal and power.",
    icon: Layers,
    defaultData: {
      type: "subgraph",
      subGraphId: "builtin-fresnel-rim",
      name: "Fresnel Rim Lighting",
    },
  },
  {
    id: "subgraph-noise-gen",
    label: "Noise Generator",
    type: "subgraph",
    category: "Dynamics & Audio",
    description: "Procedural 2D value noise generator sub-graph with scale and animation speed.",
    icon: Sparkles,
    defaultData: {
      type: "subgraph",
      subGraphId: "builtin-noise-gen",
      name: "Noise Generator",
    },
  },
  {
    id: "subgraph-uv-distortion",
    label: "UV Distortion",
    type: "subgraph",
    category: "Post-Processing",
    description: "Sub-graph distorting UV texture coordinates using flow map displacement.",
    icon: Combine,
    defaultData: {
      type: "subgraph",
      subGraphId: "builtin-uv-distortion",
      name: "UV Distortion",
    },
  },

  // Annotation Nodes (R1e)
  {
    id: "annotation-comment",
    label: "Comment Note",
    type: "comment",
    category: "Output",
    description: "Sticky-note visual annotation card for graph documentation and notes.",
    icon: MessageSquare,
    defaultData: {
      type: "comment",
      title: "Note",
      text: "Write documentation here...",
      color: "yellow",
    },
  },
  {
    id: "annotation-frame",
    label: "Frame Container",
    type: "frame",
    category: "Output",
    description: "Resizable visual bounding container grouping regions of related nodes.",
    icon: LayoutGrid,
    defaultData: {
      type: "frame",
      label: "Group Frame",
      color: "default",
      width: 320,
      height: 220,
    },
  },
]

const CATEGORIES = ["All", "Geometry", "Shading", "Post-Processing", "Dynamics & Audio", "SDF & Raymarching", "Output", "Custom"] as const

interface NodePaletteModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectNode: (type: string, data: GraphNodeData) => void
}

export function NodePaletteModal({ isOpen, onClose, onSelectNode }: NodePaletteModalProps) {
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string>("All")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setSearch("")
      setActiveCategory("All")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  if (!isOpen) return null

  const customItems = customNodeRegistry.getPaletteItems()
  const userSubGraphItems: PaletteNodeItem[] = subGraphLibrary
    .getAll()
    .filter((s) => !s.isBuiltin)
    .map((def) => ({
      id: `subgraph-${def.id}`,
      label: `${def.name} (Sub-graph)`,
      type: "subgraph",
      category: (def.category as any) || "Custom",
      description: def.description || "User-created reusable sub-graph.",
      icon: Layers,
      defaultData: {
        type: "subgraph",
        subGraphId: def.id,
        name: def.name,
      },
    }))
  const allItems: PaletteNodeItem[] = [
    ...NODE_PALETTE_ITEMS,
    ...(customItems as PaletteNodeItem[]),
    ...userSubGraphItems,
  ]
  const seenIds = new Set<string>()
  const uniqueItems = allItems.filter((item) => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    return true
  })

  const filteredItems = uniqueItems.filter((item) => {
    const matchesCategory = activeCategory === "All" || item.category === activeCategory
    const q = search.toLowerCase().trim()
    const matchesSearch =
      !q ||
      item.label.toLowerCase().includes(q) ||
      item.type.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    return matchesCategory && matchesSearch
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (filteredItems[selectedIndex]) {
        const item = filteredItems[selectedIndex]
        onSelectNode(item.type, item.defaultData)
        onClose()
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header Search Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/20">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search nodes (e.g. bloom, torus, audio, compute)..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedIndex(0)
            }}
            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 bg-muted/10 overflow-x-auto no-scrollbar shrink-0">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat)
                setSelectedIndex(0)
              }}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors shrink-0",
                activeCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Nodes Grid */}
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {filteredItems.length === 0 ? (
            <div className="col-span-2 text-center py-10 text-xs text-muted-foreground">
              No matching nodes found for "{search}"
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon
              const isSelected = idx === selectedIndex
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectNode(item.type, item.defaultData)
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-2.5 text-left transition-all cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/10 shadow-xs"
                      : "border-border/60 bg-card hover:border-primary/50 hover:bg-muted/30"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-md p-2 shrink-0 transition-colors",
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-foreground truncate">{item.label}</span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 uppercase tracking-wider">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer Shortcut Guide */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Use <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">↑</kbd> <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">↓</kbd> to navigate</span>
            <span>•</span>
            <span><kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to insert</span>
          </div>
          <span><kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  )
}
