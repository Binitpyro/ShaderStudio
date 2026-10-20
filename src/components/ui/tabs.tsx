import * as React from "react"
import { cn } from "@/lib/utils"

type Ctx = { value: string; set: (v: string) => void; id: string }
const TabsCtx = React.createContext<Ctx | null>(null)
const useTabs = () => {
  const c = React.useContext(TabsCtx)
  if (!c) throw new Error("Tabs parts must be inside Tabs")
  return c
}

export function Tabs({ value, defaultValue = "", onValueChange, className, children }: { value?: string; defaultValue?: string; onValueChange?: (v: string) => void; className?: string; children: React.ReactNode }) {
  const [inner, setInner] = React.useState(defaultValue)
  const id = React.useId()
  const cur = value ?? inner
  const set = (v: string) => {
    if (value === undefined) setInner(v)
    onValueChange?.(v)
  }
  return <TabsCtx.Provider value={{ value: cur, set, id }}><div className={className}>{children}</div></TabsCtx.Provider>
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'))
    const i = tabs.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const t = tabs[(next + tabs.length) % tabs.length]
    t.focus()
    t.click()
  }
  return <div role="tablist" onKeyDown={onKeyDown} className={cn("flex h-9 items-center gap-1 border-b border-line px-2", className)} {...props} />
}

export function TabsTrigger({ value, className, ...props }: { value: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { value: cur, set, id } = useTabs()
  const on = cur === value
  return (
    <button
      type="button" role="tab" id={`${id}-t-${value}`} aria-selected={on} aria-controls={`${id}-p-${value}`} tabIndex={on ? 0 : -1}
      onClick={() => set(value)}
      className={cn("relative h-7 rounded-md px-2.5 text-xs font-medium transition-colors", on ? "text-fg after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-brand" : "text-fg-muted hover:bg-hover hover:text-fg", className)}
      {...props}
    />
  )
}

export function TabsContent({ value, className, ...props }: { value: string } & React.HTMLAttributes<HTMLDivElement>) {
  const { value: cur, id } = useTabs()
  if (cur !== value) return null
  return <div role="tabpanel" id={`${id}-p-${value}`} aria-labelledby={`${id}-t-${value}`} tabIndex={0} className={className} {...props} />
}
