import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Variants: primary | secondary | ghost | outline | danger (+ legacy aliases default/destructive/link). Sizes: sm(28px) | md(32px) | icon(32px).
const primary = "bg-brand text-brand-fg hover:bg-brand-hover"
const danger = "bg-danger-solid text-white hover:brightness-110"
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none transition-colors disabled:pointer-events-none disabled:text-fg-disabled disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary,
        default: primary,
        secondary: "bg-raised text-fg hover:bg-hover active:bg-active",
        ghost: "text-fg-muted hover:bg-hover hover:text-fg active:bg-active",
        outline: "border border-line-strong bg-transparent text-fg hover:bg-hover active:bg-active",
        danger,
        destructive: danger,
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 min-w-7 px-2.5 text-xs",
        md: "h-8 min-w-8 px-3 text-sm",
        default: "h-8 min-w-8 px-3 text-sm",
        lg: "h-9 px-4 text-base",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...(asChild ? {} : { type: type ?? "button" })} {...props} />
})
Button.displayName = "Button"
export { Button, buttonVariants }
