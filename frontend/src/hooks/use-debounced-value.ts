import { useEffect, useState } from "react"

/**
 * Trails `value` by `delayMs` — for a value driven by every keystroke (e.g. a form field watched
 * live) that feeds a network query, so the query fires once typing pauses rather than once per
 * character. Re-debounces from scratch on every `value` change, the standard trailing-edge shape.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
