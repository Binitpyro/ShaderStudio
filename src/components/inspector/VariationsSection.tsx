import { useState, useRef, type ChangeEvent, type KeyboardEvent } from "react"
import { useProjectStore } from "@/stores/projectStore"
import { getActiveAdapter } from "@/adapters/activeAdapter"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
    const name = variationName.trim() || `Variation ${variations.length + 1}`
    addVariation(name)
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
      for (const [name, val] of Object.entries(target.uniformValues)) {
        adapter?.updateUniform(name, val)
      }
    }
  }

  const handleExport = () => {
    if (variations.length === 0) return
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(variations, null, 2))
    const downloadAnchor = document.createElement("a")
    downloadAnchor.setAttribute("href", dataStr)
    downloadAnchor.setAttribute("download", `shader-variations-${Date.now()}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (Array.isArray(parsed)) {
          importVariations(parsed)
        }
      } catch (err) {
        console.error("Failed to import variations:", err)
      }
    }
    reader.readAsText(file)
    // Clear input so same file can be reloaded if desired
    e.target.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Create Variation Input Bar */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={variationName}
          onChange={(e) => setVariationName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Variation ${variations.length + 1}...`}
          className="h-7.5 flex-1 rounded border border-border bg-background px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleCreate}
          className="h-7.5 px-2.5 text-xs font-mono gap-1 shrink-0"
          title="Save current parameter state as a variation snapshot"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Save Variation</span>
        </Button>
      </div>

      {/* Variation Cards List */}
      <div className="flex flex-col gap-1.5">
        {variations.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground bg-muted/10 rounded-md border border-dashed border-border/60">
            No saved variations yet. Enter a name above and click Save Variation.
          </div>
        ) : (
          variations.map((v) => {
            const isActive = activeVariationId === v.id
            const timeStr = new Date(v.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
            const uniformCount = Object.keys(v.uniformValues || {}).length

            return (
              <div
                key={v.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded-md border transition-all text-xs",
                  isActive
                    ? "bg-primary/10 border-primary/40 shadow-xs"
                    : "bg-muted/10 border-border/40 hover:border-border"
                )}
              >
                <div className="flex flex-col gap-0.5 truncate mr-2">
                  <div className="flex items-center gap-1.5 truncate">
                    {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                    <span className="font-semibold text-foreground truncate font-mono">
                      {v.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span>{timeStr}</span>
                    <span>•</span>
                    <span>{uniformCount} {uniformCount === 1 ? "uniform" : "uniforms"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleApply(v.id)}
                    className="h-6 px-2 text-[11px] font-mono"
                  >
                    {isActive ? "Active" : "Apply"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => deleteVariation(v.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors cursor-pointer"
                    title="Delete variation snapshot"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Import / Export Controls */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="text-[10px] text-muted-foreground font-mono">
          {variations.length} {variations.length === 1 ? "snapshot" : "snapshots"}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            className="h-6 px-2 text-[10px] font-mono gap-1 text-muted-foreground hover:text-foreground"
            title="Import variation presets from JSON"
          >
            <Upload className="h-3 w-3" />
            <span>Import</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={variations.length === 0}
            className="h-6 px-2 text-[10px] font-mono gap-1 text-muted-foreground hover:text-foreground"
            title="Export variation presets to JSON file"
          >
            <Download className="h-3 w-3" />
            <span>Export</span>
          </Button>
        </div>
      </div>

      <input
        type="file"
        ref={importInputRef}
        accept=".json,application/json"
        className="hidden"
        onChange={handleImport}
      />
    </div>
  )
}
