import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react"

/**
 * Theme preference: "light" | "dark" | "system". `resolvedTheme` is what is actually applied.
 * Initial value is read synchronously from localStorage in the useState initializer (pure); the
 * class is applied in useLayoutEffect, i.e. before first paint of React content.
 * For ZERO flash before the JS bundle loads, index.html needs this tiny inline snippet in <head>
 * (index.html is not owned by w4; it currently hardcodes class="dark", which is flash-free for dark users):
 *   <script>try{var t=localStorage.getItem("vite-ui-theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.remove("light","dark");document.documentElement.classList.add(t)}catch(e){}</script>
 */
export type Theme = "light" | "dark" | "system"
type Resolved = "light" | "dark"
type ThemeCtx = { theme: Theme; resolvedTheme: Resolved; setTheme: (t: Theme) => void }

const Ctx = createContext<ThemeCtx>({ theme: "dark", resolvedTheme: "dark", setTheme: () => {} })

const systemTheme = (): Resolved => {
  try { return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" } catch { return "dark" }
}
const resolve = (t: Theme): Resolved => (t === "system" ? systemTheme() : t)
const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system"

function apply(r: Resolved) {
  const el = document.documentElement
  el.classList.remove("light", "dark")
  el.classList.add(r)
}

export function ThemeProvider({ children, defaultTheme = "dark", storageKey = "vite-ui-theme" }: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    let t: Theme = defaultTheme
    try { const s = localStorage.getItem(storageKey); if (isTheme(s)) t = s } catch { /* storage blocked */ }
    return t
  })
  const [resolvedTheme, setResolved] = useState<Resolved>(() => resolve(theme))

  useLayoutEffect(() => {
    const r = resolve(theme)
    setResolved(r)
    apply(r)
    if (theme !== "system") return
    let mq: MediaQueryList
    try { mq = matchMedia("(prefers-color-scheme: dark)") } catch { return }
    const on = () => { const n = mq.matches ? "dark" : "light"; setResolved(n); apply(n) }
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [theme])

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(storageKey, t) } catch { /* storage blocked */ }
    setThemeState(t)
  }
  return <Ctx.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
