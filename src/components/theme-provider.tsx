import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type Theme = "light" | "dark"
type ThemeCtx = { theme: Theme; resolvedTheme: Theme; setTheme: (t: Theme) => void }

const Ctx = createContext<ThemeCtx>({ theme: "dark", resolvedTheme: "dark", setTheme: () => {} })

export function ThemeProvider({ children, defaultTheme = "dark", storageKey = "vite-ui-theme" }: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem(storageKey) as Theme) || defaultTheme } catch { return defaultTheme }
  })
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(theme)
    try { localStorage.setItem(storageKey, theme) } catch { /* storage blocked */ }
  }, [theme, storageKey])
  return <Ctx.Provider value={{ theme, resolvedTheme: theme, setTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
