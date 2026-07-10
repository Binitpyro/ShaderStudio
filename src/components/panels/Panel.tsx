import { cn } from "@/lib/utils"

interface PanelProps {
  title?: string
  children: React.ReactNode
  className?: string
  headerRight?: React.ReactNode
}

export function Panel({ title, children, className, headerRight }: PanelProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      {title && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          {headerRight}
        </div>
      )}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
