import type { BackendType, UniformValue } from "@/stores/projectStore"
import templatesJson from "./templatesData.json"

export interface ShaderTemplate {
  id: string
  name: string
  category: "Sci-Fi & VFX" | "Atmospheric" | "Surfaces & PBR" | "Retro & Stylized" | "Raymarching & SDF"
  description: string
  backend: BackendType
  geometry: "sphere" | "torus_knot" | "plane" | "cube"
  shaderSource: string
  uniforms: Record<string, UniformValue>
}

export const SHADER_TEMPLATES: ShaderTemplate[] = templatesJson as unknown as ShaderTemplate[]
