import * as React from "react"
import { cn } from "@/lib/utils"

export const fieldBase = "w-full rounded-md border border-line-strong bg-raised text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle/60 focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(fieldBase, "h-8 px-2.5", className)} {...props} />
))
Input.displayName = "Input"
export { Input }
