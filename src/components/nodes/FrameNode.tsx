import { memo, useState, useCallback } from "react"
import { NodeResizer } from "@xyflow/react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { FrameNodeData } from "@/core/graphCompiler"
import { LayoutGrid } from "lucide-react"

const THEMES: Record<string, { border: string; bg: string; headerBg: string; text: string }> = {
  default: {
    border: "border-line-strong",
    bg: "bg-raised",
    headerBg: "bg-raised",
    text: "text-fg",
  },
  cyan: {
    border: "border-cyan-500/50",
    bg: "bg-cyan-950/10",
    headerBg: "bg-cyan-500/20",
    text: "text-cyan-400",
  },
  purple: {
    border: "border-purple-500/50",
    bg: "bg-purple-950/10",
    headerBg: "bg-purple-500/20",
    text: "text-purple-400",
  },
  emerald: {
    border: "border-emerald-500/50",
    bg: "bg-emerald-950/10",
    headerBg: "bg-emerald-500/20",
    text: "text-emerald-400",
  },
  amber: {
    border: "border-amber-500/50",
    bg: "bg-amber-950/10",
    headerBg: "bg-amber-500/20",
    text: "text-amber-400",
  },
  rose: {
    border: "border-rose-500/50",
    bg: "bg-rose-950/10",
    headerBg: "bg-rose-500/20",
    text: "text-rose-400",
  },
}

function FrameNodeComponent({ id, data, selected }: FlowNodeProps<FrameNodeData>) {
  const [label, setLabel] = useState(data.label || "Group Frame")
  const [color, setColor] = useState<string>(data.color || "default")

  const currentTheme = THEMES[color] || THEMES.default

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setLabel(val)
      data.label = val
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, label: val } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
  )

  const handleColorChange = useCallback(
    (c: string) => {
      setColor(c)
      data.color = c as any
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, color: c } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
  )

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 border-dashed transition-all duration-150 h-full w-full pointer-events-auto backdrop-blur-2xs",
        currentTheme.border,
        currentTheme.bg,
        selected ? "ring-2 ring-primary/50 shadow-xl border-solid" : ""
      )}
      style={{
        minWidth: 150,
        minHeight: 100,
      }}
    >
      <NodeResizer
        minWidth={150}
        minHeight={100}
        isVisible={selected}
        lineClassName="border-primary"
        handleClassName="h-3 w-3 bg-brand border-2 border-background rounded-xs"
      />

      {/* Frame Header Bar */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-t-lg border-b border-inherit select-none",
          currentTheme.headerBg
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <LayoutGrid className={cn("h-3.5 w-3.5 shrink-0", currentTheme.text)} />
          <input
            type="text"
            value={label}
            onChange={handleLabelChange}
            className={cn(
              "bg-transparent text-xs font-bold focus:outline-none w-full truncate font-mono",
              currentTheme.text
            )}
            placeholder="Frame Title"
          />
        </div>

        {/* Color Palette Switcher */}
        <div className="flex items-center gap-1 shrink-0 nodrag">
          {(["default", "cyan", "purple", "emerald", "amber", "rose"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleColorChange(c)}
              className={cn(
                "w-2.5 h-2.5 rounded-full border transition-transform",
                c === "default" ? "bg-zinc-400 border-zinc-500" :
                c === "cyan" ? "bg-cyan-400 border-cyan-500" :
                c === "purple" ? "bg-purple-400 border-purple-500" :
                c === "emerald" ? "bg-emerald-400 border-emerald-500" :
                c === "amber" ? "bg-amber-400 border-amber-500" :
                "bg-rose-400 border-rose-500",
                color === c ? "scale-125 ring-1 ring-fg" : "hover:scale-110"
              )}
              title={c}
              aria-label={`Set colour: ${c}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export const FrameNode = memo(FrameNodeComponent)
