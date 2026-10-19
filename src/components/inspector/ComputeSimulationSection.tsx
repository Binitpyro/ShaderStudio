import { useState } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { webgpuAdapter } from "@/adapters/webgpu"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { RotateCcw, Cpu } from "lucide-react"

export function ComputeSimulationSection() {
  const activeBackend = useProjectStore((s) => s.activeBackend)
  const setActiveBackend = useProjectStore((s) => s.setActiveBackend)

  const [params, setParams] = useState({
    speed: 1.0,
    damping: 0.98,
    strength: 1.0,
    noiseScale: 1.0,
    pointSize: 4.0,
    blendMode: 1.0,
  })

  const updateParam = (name: string, val: number) => {
    setParams((prev) => ({ ...prev, [name]: val }))
    webgpuAdapter.updateComputeUniform?.(name, val)
  }

  const handleReseed = () => {
    webgpuAdapter.reseedSimulation?.()
    useProjectStore.getState().triggerSimulationReset()
  }

  const isWebGPU = activeBackend === "webgpu"

  return (
    <div className="flex flex-col gap-3">
      {/* Backend Status Notice */}
      {!isWebGPU ? (
        <div className="flex items-center justify-between p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span>Active on WebGPU backend</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveBackend("webgpu")}
            className="h-5 text-[10px] px-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
          >
            Switch to WebGPU
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-foreground">WebGPU Compute Pipeline</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReseed}
            className="h-6 px-2 text-[11px] font-mono gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Re-seed</span>
          </Button>
        </div>
      )}

      {/* Simulation Controls */}
      <div className="flex flex-col gap-2.5">
        {/* Sim Speed */}
        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Simulation Speed</Label>
            <span className="text-muted-foreground">{params.speed.toFixed(2)}x</span>
          </div>
          <Slider
            value={[params.speed]}
            min={0.1}
            max={3.0}
            step={0.05}
            onValueChange={([v]) => updateParam("speed", v)}
          />
        </div>

        {/* Damping */}
        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Damping</Label>
            <span className="text-muted-foreground">{params.damping.toFixed(3)}</span>
          </div>
          <Slider
            value={[params.damping]}
            min={0.9}
            max={0.999}
            step={0.001}
            onValueChange={([v]) => updateParam("damping", v)}
          />
        </div>

        {/* Force / Gravity */}
        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Gravity / Force</Label>
            <span className="text-muted-foreground">{params.strength.toFixed(2)}</span>
          </div>
          <Slider
            value={[params.strength]}
            min={0.1}
            max={4.0}
            step={0.05}
            onValueChange={([v]) => updateParam("strength", v)}
          />
        </div>

        {/* Particle Size */}
        <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex items-center justify-between text-xs font-mono">
            <Label className="text-xs font-medium">Particle Size</Label>
            <span className="text-muted-foreground">{params.pointSize.toFixed(1)}px</span>
          </div>
          <Slider
            value={[params.pointSize]}
            min={1.0}
            max={12.0}
            step={0.5}
            onValueChange={([v]) => updateParam("pointSize", v)}
          />
        </div>

        {/* Additive Blend */}
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/10 border border-border/40">
          <div className="flex flex-col">
            <Label className="text-xs font-medium">Additive Blend Mode</Label>
            <span className="text-[10px] text-muted-foreground">
              Bright, luminous particle overlap
            </span>
          </div>
          <Switch
            checked={params.blendMode > 0.5}
            onCheckedChange={(checked) => updateParam("blendMode", checked ? 1.0 : 0.0)}
          />
        </div>
      </div>
    </div>
  )
}
