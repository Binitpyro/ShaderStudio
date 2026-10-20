import { useState, useRef, type ChangeEvent, type KeyboardEvent } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { getActiveAdapter } from "@/adapters/activeAdapter"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, Download, Upload, Check } from "lucide-react"

export function VariationsSection() {
  const variations = useProjectStore((s) => s.variations)
  const activeVariationId = useProjectStore((s) => s.activeVariationId)
  const addVariation = useProjectStore((s) => s.addVariation)
  const applyVariation = useProjectStore((s) => s.applyVariation)
  const deleteVariation = useProjectStore((s) => s.deleteVariation)
  const importVariations = useProjectStore((s) => s.importVariations)

  const [variationName, setVariationName] = useState("")
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleCreate = () => {
    addVariation(variationName.trim() || `Variation ${variations.length + 1}`)
    setVariationName("")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleCreate()
    }
  }

  const handleApply = (id: string) => {
    applyVariation(id)
    const target = variations.find((v) => v.id === id)
    if (target) {
      const adapter = getActiveAdapter()
      for (const [name, val] of Object.entries(target.uniformValues)) adapter?.updateUniform(name, val)
    }
  }

  const handleExport = () => {
    if (variations.length === 0) return
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(variations, null, 2))
    const a = document.createElement("a")
    a.setAttribute("href", dataStr)
    a.setAttribute("download", `shader-variations-${Date.now()}.json`)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (Array.isArray(parsed)) importVariations(parsed)
      } catch (err) {
        console.error("Failed to import variations:", err)
      }
    }
    reader.readAsText(file)
    // Clear input so the same file can be reloaded
    e.target.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Input aria-label="Variation name" value={variationName} onChange={(e) => setVariationName(e.target.value)} onKeyDown={handleKeyDown} placeholder={`Variation ${variations.length + 1}...`} className="flex-1" />
        <Button variant="secondary" size="sm" onClick={handleCreate} title="Save current parameter state as a variation snapshot">
          <Plus />
          Save Variation
        </Button>
      </div>

      {variations.length === 0 ? (
        <div className="rounded-md border border-dashed border-line p-4 text-center text-xs text-fg-subtle">No saved variations yet. Enter a name above and click Save Variation.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {variations.map((v) => {
            const isActive = activeVariationId === v.id
            const timeStr = new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            const uniformCount = Object.keys(v.uniformValues || {}).length
            return (
              <div key={v.id} className={cn("flex items-center justify-between gap-2 rounded-md border py-1.5 pl-2.5 pr-1.5", isActive ? "border-brand bg-brand-soft" : "border-line bg-raised/50")}>
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-1.5">
                    {isActive ? <Check className="size-3 shrink-0 text-brand-text" /> : null}
                    <span className="truncate text-xs text-fg">{v.name}</span>
                  </div>
                  <span className="num text-2xs text-fg-subtle">
                    {timeStr} · {uniformCount} {uniformCount === 1 ? "uniform" : "uniforms"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant={isActive ? "primary" : "outline"} size="sm" onClick={() => handleApply(v.id)}>
                    {isActive ? "Active" : "Apply"}
                  </Button>
                  <IconButton label="Delete variation" className="size-7" onClick={() => deleteVariation(v.id)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="num text-xs text-fg-subtle">
          {variations.length} {variations.length === 1 ? "snapshot" : "snapshots"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()} title="Import variation presets from JSON">
            <Upload />
            Import
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} disabled={variations.length === 0} title="Export variation presets to JSON file">
            <Download />
            Export
          </Button>
        </div>
      </div>

      <input type="file" ref={importInputRef} accept=".json,application/json" aria-label="Import variations file" className="hidden" onChange={handleImport} />
    </div>
  )
}
