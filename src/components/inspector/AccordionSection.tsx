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

/** Controlled collapsible section (open state is owned + persisted by ParameterPanel). */
export function AccordionSection({ id, title, icon, badge, isOpen, onToggle, children, headerActions, className, contentClassName }: AccordionSectionProps) {
  return (
    <div data-testid={id ? `accordion-${id}` : undefined} className={cn("border-b border-line", className)}>
      <div className="flex h-10 items-center justify-between px-3 select-none">
        <button type="button" onClick={onToggle} aria-expanded={isOpen} className="group flex h-full flex-1 items-center gap-2 text-left">
          <span className={cn("shrink-0 text-fg-subtle transition-transform", isOpen ? "rotate-0" : "-rotate-90")} aria-hidden="true">
            <ChevronDown className="size-3.5" />
          </span>
          {icon ? <span className="flex shrink-0 items-center text-fg-subtle">{icon}</span> : null}
          <span className="text-sm font-medium text-fg">{title}</span>
          {badge !== undefined && badge !== null ? <span className="num rounded-full bg-raised px-1.5 text-2xs text-fg-muted">{badge}</span> : null}
        </button>
        {headerActions ? (
          <div onClick={(e) => e.stopPropagation()} className="ml-2 flex shrink-0 items-center gap-1">
            {headerActions}
          </div>
        ) : null}
      </div>
      {isOpen ? <div className={cn("px-3 pb-4 pt-1", contentClassName)}>{children}</div> : null}
    </div>
  )
}
