import { useState, useEffect, useRef, useMemo } from "react"
import { useDialogA11y } from "@/lib/useDialogA11y"
import { useProjectStore } from "@/stores/projectStore"
import { Badge, Button, IconButton } from "@/components/ui"
import {
  X,
  Copy,
  Check,
  Download,
  Code2,
  Globe,
  Layers,
  Archive,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  Gamepad2,
  Package,
} from "lucide-react"
import { bakePbrMaps, type PbrBakeResult, type PbrResolution, type PbrMapItem } from "@/core/textureBaker"
// The exporters (and, lazily through them, the wasm engine) load with this lazily-mounted modal, never with the app entry.
import { generateExport, createNpmPackageZip, resolveGlslSource, type ExportTarget, type ExportResult, type ExportGeometry } from "@/core/engineTranspiler"
import { viewportCapture } from "@/utils/frameCapture"

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
}

type ExportTab = "r3f" | "html" | "raw" | "pbr" | "engine"
type EngineTarget = "unity" | "godot" | "unreal" | "osl" | "gltf" | "shadertoy"

/** Small stable string hash (djb2) so the memo key doesn't hold whole sources. */
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + ":" + s.length
}

const DEBOUNCE_MS = 250
const CACHE_LIMIT = 40

type View = { status: "loading" } | { status: "ready"; code: string; via: string } | { status: "error"; error: string; line?: number }

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const rawSource = useProjectStore((state) => state.shaderSource)
  const wgslSource = useProjectStore((state) => state.wgslSource)
  const glslSource = useProjectStore((state) => state.glslSource)
  const activeBackend = useProjectStore((state) => state.activeBackend)
  const uniformValues = useProjectStore((state) => state.uniformValues)
  const parsedUniforms = useProjectStore((state) => state.parsedUniforms)

  const [activeTab, setActiveTab] = useState<ExportTab>("r3f")
  const [engineTarget, setEngineTarget] = useState<EngineTarget>("unity")
  const [r3fFormat, setR3fFormat] = useState<"drei" | "component">("drei")
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, isOpen, onClose)

  // PBR Baker State
  const [pbrResolution, setPbrResolution] = useState<PbrResolution>(2048)
  const [normalStrength, setNormalStrength] = useState(2.0)
  const [invertNormalY, setInvertNormalY] = useState(false)
  const [metallicMode, setMetallicMode] = useState<"auto" | "metal" | "dielectric">("auto")
  const [aoStrength, setAoStrength] = useState(1.0)
  const [bakeResult, setBakeResult] = useState<PbrBakeResult | null>(null)
  const [isBaking, setIsBaking] = useState(false)
  const [bakeError, setBakeError] = useState<string | null>(null)

  // Only the selected target is generated. The tab/target decides what to build, a hash of the inputs decides whether
  // it must be rebuilt, and a debounce keeps a slider drag from running a transpile per tick. Nothing runs while closed.
  const target: ExportTarget | null =
    activeTab === "r3f" ? (r3fFormat === "drei" ? "r3f" : "r3f-component") : activeTab === "html" ? "html" : activeTab === "engine" ? engineTarget : null
  // baked maps only reach the glTF export, so they are hashed (once per bake) only when that target is selected
  const bakedKey = useMemo(
    () => (target === "gltf" && bakeResult ? hashString(Object.values(bakeResult.maps).map((m) => m.dataUrl).join("|")) : ""),
    [target, bakeResult],
  )
  const meshData = useProjectStore((state) => state._graphNodes.find((n) => n.type === "mesh")?.data) as { geometry?: ExportGeometry } | undefined
  const geometry = target === "html" || target === "r3f" || target === "r3f-component" ? meshData?.geometry : undefined
  const inputKey = useMemo(
    () =>
      isOpen && target
        ? [target, hashString(wgslSource), hashString(glslSource), hashString(JSON.stringify([parsedUniforms, uniformValues])), target === "gltf" ? bakedKey : "", geometry ?? ""].join("|")
        : "",
    [isOpen, target, wgslSource, glslSource, parsedUniforms, uniformValues, bakedKey, geometry],
  )

  const cache = useRef(new Map<string, View>())
  const [view, setView] = useState<View>({ status: "loading" })
  useEffect(() => {
    if (!inputKey || !target) return
    const hit = cache.current.get(inputKey)
    if (hit) {
      setView(hit)
      return
    }
    setView({ status: "loading" })
    let stale = false
    const timer = setTimeout(async () => {
      let res: ExportResult
      try {
        res = await generateExport(target, {
          wgslSource,
          glslSource,
          parsedUniforms,
          uniformValues,
          shaderName: "Custom/ShaderStudioEffect",
          geometry,
          bakedMaps: bakeResult ? Object.fromEntries(Object.entries(bakeResult.maps).map(([k, v]) => [k, { dataUrl: v.dataUrl }])) : undefined,
        })
      } catch (err) {
        res = { error: err instanceof Error ? err.message : String(err) }
      }
      if (stale) return
      const next: View = "error" in res ? { status: "error", error: res.error, line: res.line } : { status: "ready", code: res.code, via: res.via }
      if (cache.current.size >= CACHE_LIMIT) cache.current.clear()
      cache.current.set(inputKey, next)
      setView(next)
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
    // inputKey is the hash of every input read inside the effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey])

  if (!isOpen) return null

  const generated: View = activeTab === "raw" ? { status: "ready", code: rawSource, via: "raw" } : view
  const activeCode = generated.status === "ready" ? generated.code : ""

  const handleCopy = () => {
    if (!activeCode) return
    navigator.clipboard.writeText(activeCode)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!activeCode) return
    let filename = "ShaderStudio_Export.txt"
    if (activeTab === "r3f") {
      filename = r3fFormat === "drei" ? "CustomShaderMaterial.tsx" : "ShaderStudio_Component.tsx"
    } else if (activeTab === "html") {
      filename = "ShaderStudio_Embed.html"
    } else if (activeTab === "engine") {
      if (engineTarget === "unity") filename = "ShaderStudio_Unity_URP.shader"
      else if (engineTarget === "godot") filename = "ShaderStudio_Godot.gdshader"
      else if (engineTarget === "unreal") filename = "ShaderStudio_UE5.hlsl"
      else if (engineTarget === "osl") filename = "ShaderStudio_BlenderCycles.osl"
      else if (engineTarget === "gltf") filename = "ShaderStudio_Material.gltf"
      else filename = "ShaderStudio_Shadertoy.glsl"
    } else {
      const ext = activeBackend === "webgpu" ? "wgsl" : "glsl"
      filename = `ShaderStudio_Shader.${ext}`
    }

    const blob = new Blob([activeCode], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDownloadNpmZip = async () => {
    setActionError(null)
    try {
      // npm package ships GLSL for three.js: the project's GLSL, or WGSL through naga
      const glsl = await resolveGlslSource({ wgslSource, glslSource })
      if ("error" in glsl) {
        setActionError(glsl.error)
        return
      }
      const zipBytes = createNpmPackageZip("@shaderstudio/custom-material", glsl.code, { uniforms: parsedUniforms, uniformValues })
      const blob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "shaderstudio-material-package.zip"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Failed to generate npm package zip:", err)
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleBakePbr = async () => {
    setIsBaking(true)
    setBakeError(null)
    try {
      const res = await bakePbrMaps({
        resolution: pbrResolution,
        normalStrength,
        invertNormalY,
        metallicMode,
        aoStrength,
        canvas: viewportCapture.getCanvas(),
      })
      setBakeResult(res)
    } catch (e: any) {
      setBakeError(e?.message || "Failed to bake PBR maps")
    } finally {
      setIsBaking(false)
    }
  }

  const handleDownloadPbrZip = () => {
    if (!bakeResult) return
    const zipBytes = bakeResult.createZip()
    const blob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ShaderStudio_PBR_Maps_${pbrResolution}px.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDownloadSingleMap = (map: PbrMapItem) => {
    const a = document.createElement("a")
    a.href = map.dataUrl
    a.download = `${map.id}_${map.width}x${map.height}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Export" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 outline-none">
      <div className="flex flex-col h-[88vh] w-full max-w-5xl rounded-xl border border-line bg-overlay shadow-lg overflow-hidden">
        {/* Modal Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-brand-text" />
            <h2 className="text-sm font-medium text-fg">Export</h2>
            <Badge tone="brand">Production ready</Badge>
          </div>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </div>

        {/* Tab Switcher & Action Bar */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-canvas px-4">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setActiveTab("r3f")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                activeTab === "r3f" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              React Three Fiber (.tsx)
            </button>
            <button
              onClick={() => setActiveTab("html")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                activeTab === "html" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              HTML / Webflow Embed
            </button>
            <button
              onClick={() => setActiveTab("engine")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                activeTab === "engine" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              <Gamepad2 className="h-3.5 w-3.5" />
              Game Engines (Unity / Godot)
            </button>
            <button
              onClick={() => setActiveTab("raw")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                activeTab === "raw" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              Raw Shader ({activeBackend.toUpperCase()})
            </button>
            <button
              onClick={() => setActiveTab("pbr")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                activeTab === "pbr" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              PBR Texture Baker
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTab === "pbr" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBakePbr}
                  disabled={isBaking}
                  className="h-7 gap-1.5 text-xs"
                >
                  {isBaking ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-text" /> : <Sparkles className="h-3.5 w-3.5 text-brand-text" />}
                  {bakeResult ? "Re-bake Maps" : "Bake Maps"}
                </Button>
                {bakeResult && (
                  <Button
                    size="sm"
                    onClick={handleDownloadPbrZip}
                    className="h-7 gap-1.5 text-xs bg-brand hover:bg-brand text-white"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Download All (.zip)
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadNpmZip}
                  title="Download publishable npm package with package.json, TypeScript loader, and shaders"
                  className="h-7 gap-1.5 text-xs text-brand-text border-brand hover:bg-brand-soft"
                >
                  <Package className="h-3.5 w-3.5" />
                  npm Package (.zip)
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload} className="h-7 gap-1.5 text-xs">
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button size="sm" onClick={handleCopy} className="h-7 gap-1.5 text-xs">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy Code"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content Area */}
        {activeTab === "pbr" ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
            {/* PBR Settings Strip */}
            <div className="flex flex-wrap items-center gap-4 border-b border-line bg-overlay px-4 py-2 text-xs">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-fg-muted" />
                <span className="font-semibold text-fg">Bake Settings:</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-fg-muted">Resolution:</span>
                <select
                  value={pbrResolution}
                  onChange={(e) => setPbrResolution(Number(e.target.value) as PbrResolution)}
                  className="bg-canvas border border-line rounded px-2 py-0.5 text-xs focus:ring-1 focus:ring-brand"
                >
                  <option value={512}>512 x 512 (Preview)</option>
                  <option value={1024}>1024 x 1024 (1K)</option>
                  <option value={2048}>2048 x 2048 (2K Standard)</option>
                  <option value={4096}>4096 x 4096 (4K Ultra)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-fg-muted">Normal Strength:</span>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.5"
                  value={normalStrength}
                  onChange={(e) => setNormalStrength(Number(e.target.value))}
                  className="w-20 accent-primary"
                />
                <span className="font-mono text-xs text-fg w-6">{normalStrength.toFixed(1)}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-fg-muted">Normal Format:</span>
                <button
                  type="button"
                  onClick={() => setInvertNormalY(!invertNormalY)}
                  className="bg-active hover:bg-hover text-fg px-2 py-0.5 rounded text-xs border border-line cursor-pointer"
                >
                  {invertNormalY ? "DirectX (Y-)" : "OpenGL (Y+)"}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-fg-muted">Metallic Mode:</span>
                <select
                  value={metallicMode}
                  onChange={(e) => setMetallicMode(e.target.value as any)}
                  className="bg-canvas border border-line rounded px-2 py-0.5 text-xs focus:ring-1 focus:ring-brand"
                >
                  <option value="auto">Auto (Saturation detect)</option>
                  <option value="metal">Full Metal (1.0)</option>
                  <option value="dielectric">Full Dielectric (0.0)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-fg-muted">AO Strength:</span>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={aoStrength}
                  onChange={(e) => setAoStrength(Number(e.target.value))}
                  className="w-16 accent-primary"
                />
                <span className="font-mono text-xs text-fg w-6">{aoStrength.toFixed(1)}</span>
              </div>
            </div>

            {/* PBR Grid / Empty State */}
            <div className="flex-1 overflow-auto p-4">
              {isBaking ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-fg-muted">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-text" />
                  <div className="text-sm font-medium">Baking 6 PBR Texture Maps at {pbrResolution}x{pbrResolution}...</div>
                  <div className="text-xs text-fg-subtle">Computing Sobel normal tangents, height gradients, micro-roughness & AO</div>
                </div>
              ) : bakeError ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-danger">
                  <div className="text-sm font-medium">Baking Error: {bakeError}</div>
                  <Button size="sm" variant="outline" onClick={handleBakePbr}>Retry Bake</Button>
                </div>
              ) : bakeResult ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.values(bakeResult.maps).map((map) => (
                    <div key={map.id} className="flex flex-col rounded-lg border border-line bg-overlay p-3 shadow-xs">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-fg truncate">{map.title}</span>
                        <span className="text-2xs font-mono text-fg-muted bg-active px-1.5 py-0.5 rounded">
                          {map.width}x{map.height}
                        </span>
                      </div>

                      <div className="relative aspect-square w-full rounded border border-line overflow-hidden bg-black/40 mb-2.5 group">
                        <img
                          src={map.dataUrl}
                          alt={map.title}
                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      </div>

                      <p className="text-xs text-fg-muted leading-snug mb-3 line-clamp-2">
                        {map.description}
                      </p>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDownloadSingleMap(map)}
                        className="mt-auto h-7 w-full gap-1.5 text-xs"
                      >
                        <Download className="h-3 w-3" />
                        Download PNG
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center max-w-md mx-auto text-fg-muted">
                  <div className="p-4 rounded-full bg-brand-soft text-brand-text">
                    <Layers className="h-8 w-8" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-fg mb-1">Procedural PBR Map Extraction</h3>
                    <p className="text-xs text-fg-muted leading-relaxed">
                      Transform your procedural shader into game-engine ready PBR maps (Albedo, Tangent Normal, Roughness, Height, Metallic, and Ambient Occlusion) at up to 4K resolution.
                    </p>
                  </div>
                  <Button onClick={handleBakePbr} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Bake {pbrResolution}x{pbrResolution} PBR Maps
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Code View Area with Game Engine Sub-bar */
          <div className="flex-1 flex flex-col overflow-hidden bg-black">
            {activeTab === "r3f" && (
              <div className="flex items-center gap-2 border-b border-line bg-zinc-950 px-4 py-2">
                <span className="text-xs text-fg-muted font-medium">Export Preset:</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setR3fFormat("drei")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      r3fFormat === "drei"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    @react-three/drei shaderMaterial & Storybook
                  </button>
                  <button
                    onClick={() => setR3fFormat("component")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      r3fFormat === "component"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Standard R3F Component
                  </button>
                </div>
              </div>
            )}
            {activeTab === "engine" && (
              <div className="flex items-center gap-2 border-b border-line bg-zinc-950 px-4 py-2 flex-wrap">
                <span className="text-xs text-fg-muted font-medium">Target Engine:</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => setEngineTarget("unreal")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "unreal"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Unreal Engine 5 (.hlsl)
                  </button>
                  <button
                    onClick={() => setEngineTarget("osl")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "osl"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Blender Cycles (.osl)
                  </button>
                  <button
                    onClick={() => setEngineTarget("gltf")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "gltf"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    glTF 2.0 Material (.gltf)
                  </button>
                  <button
                    onClick={() => setEngineTarget("unity")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "unity"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Unity URP (.shader)
                  </button>
                  <button
                    onClick={() => setEngineTarget("godot")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "godot"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Godot 4 Spatial (.gdshader)
                  </button>
                  <button
                    onClick={() => setEngineTarget("shadertoy")}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      engineTarget === "shadertoy"
                        ? "bg-brand text-brand-fg font-semibold"
                        : "bg-raised text-fg-muted hover:text-fg"
                    }`}
                  >
                    Shadertoy GLSL (.glsl)
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs text-success">
              {generated.status === "ready" ? (
                <pre className="whitespace-pre-wrap break-all select-all">{activeCode}</pre>
              ) : generated.status === "loading" ? (
                <div className="flex items-center gap-2 text-fg-muted" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating export...
                </div>
              ) : (
                <div role="alert" className="text-danger whitespace-pre-wrap">
                  Export failed: {generated.error}
                </div>
              )}
              {actionError && (
                <div role="alert" className="mt-3 text-danger whitespace-pre-wrap">
                  npm package: {actionError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
