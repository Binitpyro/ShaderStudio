import type { RenderQueue } from "@/core/graphCompiler"
import type { UniformValue } from "@/stores/projectStore"

export interface PerfMetrics { fps: number; frameTime: number; timestamp: number }

export interface RenderAdapter {
  mount(canvas: HTMLCanvasElement): Promise<boolean>
  setRenderQueue(queue: RenderQueue | null): void
  recompileShader(source: string): void
  updateUniform(name: string, value: UniformValue): void
  resize(width: number, height: number): void
  dispose(): void
  readonly backendType: "webgpu" | "webgl2" | "threejs"
  setPerfCallback?(callback: (metrics: PerfMetrics) => void): void
}
