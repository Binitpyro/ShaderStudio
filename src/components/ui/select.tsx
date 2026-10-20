import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { fieldBase } from "./input"

/** Native select (free keyboard + mobile support), restyled. Children are option elements. */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <span className={cn("relative inline-flex w-full", className)}>
    <select ref={ref} className={cn(fieldBase, "h-8 appearance-none pl-2.5 pr-7")} {...props}>{children}</select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
  </span>
))
Select.displayName = "Select"
export { Select }
