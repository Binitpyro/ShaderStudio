import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

// 28px hit target around a 4px track; nodrag/nopan keep React Flow from stealing the pointer.
const Slider = React.forwardRef<React.ComponentRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(({ className, onPointerDown, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex h-7 w-full touch-none select-none items-center nodrag nopan data-[disabled]:opacity-50", className)}
    onPointerDown={(e) => {
      onPointerDown?.(e)
      e.stopPropagation()
    }}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-active"><SliderPrimitive.Range className="absolute h-full bg-brand" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-3.5 rounded-full border-2 border-brand bg-panel shadow-sm transition-transform hover:scale-110 active:scale-95 disabled:pointer-events-none" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName
export { Slider }
