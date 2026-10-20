import * as React from "react"
import { Button, type ButtonProps } from "./button"
import { Tooltip } from "./tooltip"

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children" | "asChild"> {
  /** Required: becomes aria-label and the tooltip text. */
  label: string
  children: React.ReactNode
  /** Show the CSS tooltip (default true). */
  tooltip?: boolean
}

/** 32px icon-only button. Always labelled. */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(({ label, tooltip = true, variant = "ghost", children, ...props }, ref) => {
  const btn = <Button ref={ref} size="icon" variant={variant} aria-label={label} {...props}>{children}</Button>
  return tooltip ? <Tooltip label={label}>{btn}</Tooltip> : btn
})
IconButton.displayName = "IconButton"
export { IconButton }
