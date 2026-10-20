import { useEffect, type RefObject } from "react"

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Modal basics: focus into the dialog on open, restore on close, Tab trapped inside, Escape closes (unless `escape` is false). */
export function useDialogA11y(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void, escape = true) {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const prev = document.activeElement as HTMLElement | null
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!root.contains(document.activeElement)) (items()[0] ?? root).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escape) {
        e.stopPropagation()
        onClose()
      } else if (e.key === "Tab") {
        const f = items()
        if (f.length === 0) return e.preventDefault()
        const first = f[0]
        const last = f[f.length - 1]
        const cur = document.activeElement
        if (e.shiftKey && (cur === first || !root.contains(cur))) (e.preventDefault(), last.focus())
        else if (!e.shiftKey && (cur === last || !root.contains(cur))) (e.preventDefault(), first.focus())
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      prev?.focus?.()
    }
  }, [ref, active, onClose, escape])
}
