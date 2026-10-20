import * as React from "react"
import { cn } from "@/lib/utils"

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm border border-line-strong bg-raised px-1 font-mono text-2xs text-fg-muted", className)} {...props} />
}
