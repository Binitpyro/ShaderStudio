import { memo, useState, useCallback } from "react"
import type { FlowNodeProps } from "./types"
import { cn } from "@/lib/utils"
import type { CommentNodeData } from "@/core/graphCompiler"
import { MessageSquare } from "lucide-react"

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; header: string }> = {
  yellow: {
    bg: "bg-amber-950/20",
    border: "border-amber-500/40 hover:border-amber-500/70",
    text: "text-amber-200",
    header: "text-amber-400",
  },
  blue: {
    bg: "bg-sky-950/20",
    border: "border-sky-500/40 hover:border-sky-500/70",
    text: "text-sky-200",
    header: "text-sky-400",
  },
  emerald: {
    bg: "bg-emerald-950/20",
    border: "border-emerald-500/40 hover:border-emerald-500/70",
    text: "text-emerald-200",
    header: "text-emerald-400",
  },
  purple: {
    bg: "bg-purple-950/20",
    border: "border-purple-500/40 hover:border-purple-500/70",
    text: "text-purple-200",
    header: "text-purple-400",
  },
  neutral: {
    bg: "bg-card/70",
    border: "border-border hover:border-border/80",
    text: "text-foreground",
    header: "text-foreground",
  },
}

function CommentNodeComponent({ id, data, selected }: FlowNodeProps<CommentNodeData>) {
  const [title, setTitle] = useState(data.title || "Note")
  const [text, setText] = useState(data.text || "Write annotation or comments here...")
  const [color, setColor] = useState<string>(data.color || "yellow")

  const currentTheme = COLOR_MAP[color] || COLOR_MAP.yellow

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value
      setText(val)
      data.text = val
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, text: val } },
        bubbles: true,
      })
      document.dispatchEvent(evt)
    },
    [id, data]
  )

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setTitle(val)
      data.title = val
      const evt = new CustomEvent("nodeDataChanged", {
        detail: { nodeId: id, data: { ...data, title: val } },
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
        "rounded-lg border shadow-sm select-none transition-all duration-150 p-2.5 min-w-[200px] max-w-[280px] backdrop-blur-xs",
        currentTheme.bg,
        currentTheme.border,
        selected ? "ring-2 ring-primary/40 shadow-lg" : ""
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-border/40 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className={cn(
              "bg-transparent text-xs font-semibold focus:outline-none w-full truncate",
              currentTheme.header
            )}
            placeholder="Comment Title"
          />
        </div>

        {/* Color Palette Picker */}
        <div className="flex items-center gap-1 nodrag">
          {(["yellow", "blue", "emerald", "purple", "neutral"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleColorChange(c)}
              className={cn(
                "w-2.5 h-2.5 rounded-full border transition-transform",
                c === "yellow" ? "bg-amber-400 border-amber-500" :
                c === "blue" ? "bg-sky-400 border-sky-500" :
                c === "emerald" ? "bg-emerald-400 border-emerald-500" :
                c === "purple" ? "bg-purple-400 border-purple-500" :
                "bg-zinc-400 border-zinc-500",
                color === c ? "scale-125 ring-1 ring-foreground" : "hover:scale-110"
              )}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Multiline Editable Content */}
      <textarea
        value={text}
        onChange={handleTextChange}
        rows={4}
        className={cn(
          "w-full bg-transparent text-[11px] leading-relaxed resize-y focus:outline-none placeholder:text-muted-foreground/60 font-sans nodrag",
          currentTheme.text
        )}
        placeholder="Type note or documentation here..."
      />
    </div>
  )
}

export const CommentNode = memo(CommentNodeComponent)
