export function throttle<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastCall = 0
  return (...args: A) => {
    const now = Date.now()
    const timeSinceLastCall = now - lastCall
    if (timeoutId) clearTimeout(timeoutId)
    if (timeSinceLastCall >= delay) { fn(...args); lastCall = now }
    else timeoutId = setTimeout(() => { fn(...args); lastCall = Date.now(); timeoutId = null }, delay - timeSinceLastCall)
  }
}

export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  /** Drop any pending call. */
  cancel: () => void
  /** Run the pending call now (no-op when nothing is pending). */
  flush: () => void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null
  const debounced = ((...args: A) => {
    pending = args
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => { timeoutId = null; const a = pending!; pending = null; fn(...a) }, delay)
  }) as Debounced<A>
  debounced.cancel = () => { if (timeoutId) clearTimeout(timeoutId); timeoutId = null; pending = null }
  debounced.flush = () => {
    if (!timeoutId) return
    clearTimeout(timeoutId); timeoutId = null
    const a = pending!; pending = null
    fn(...a)
  }
  return debounced
}
