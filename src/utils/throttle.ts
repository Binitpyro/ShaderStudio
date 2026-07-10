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

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return (...args: A) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => { fn(...args); timeoutId = null }, delay)
  }
}
