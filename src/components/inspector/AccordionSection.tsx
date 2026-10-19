import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface AccordionSectionProps {
  id?: string
  title: string
  icon?: ReactNode
  badge?: string | number | ReactNode
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
  headerActions?: ReactNode
  className?: string
  contentClassName?: string
}

export function AccordionSection({
  id,
  title,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
  headerActions,
  className,
  contentClassName,
}: AccordionSectionProps) {
  return (
    <div
      data-testid={id ? `accordion-${id}` : undefined}
      className={cn("border-b border-border/60 transition-colors", className)}
    >
      <div className="flex items-center justify-between py-2 px-3 select-none hover:bg-muted/20 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex flex-1 items-center gap-2 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded py-0.5"
        >
          <span
            className={cn(
              "text-muted-foreground transition-transform duration-200 shrink-0",
              isOpen ? "rotate-0" : "-rotate-90"
            )}
            aria-hidden="true"
          >
            <ChevronDown className="h-4 w-4" />
          </span>
          {icon && <span className="text-primary/90 shrink-0 flex items-center">{icon}</span>}
          <span className="text-xs font-semibold tracking-wide text-foreground group-hover:text-primary transition-colors">
            {title}
          </span>
          {badge !== undefined && badge !== null && (
            <span className="ml-1 rounded-full bg-muted/80 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
              {badge}
            </span>
          )}
        </button>

        {headerActions && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 shrink-0 ml-2"
          >
            {headerActions}
          </div>
        )}
      </div>

      {isOpen && (
        <div className={cn("px-3 pb-3 pt-1", contentClassName)}>
          {children}
        </div>
      )}
    </div>
  )
}
