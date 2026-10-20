import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-2xs font-medium leading-none", {
  variants: {
    tone: {
      neutral: "bg-raised text-fg-muted",
      brand: "bg-brand-soft text-brand-text",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
export { badgeVariants }
