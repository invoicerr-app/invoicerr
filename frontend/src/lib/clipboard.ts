/**
 * Copies text to the clipboard and reports whether it actually landed there, instead of letting the
 * caller assume success. `navigator.clipboard` isn't available in every browsing context (no secure
 * context, no user-activation, or the API simply doesn't exist there), and even when it does exist
 * `writeText` returns a promise that REJECTS — rather than resolving — once the page loses focus or
 * the browser denies the permission. An unhandled rejection here used to propagate straight out of
 * the click handler: a caller that fired-and-forgot it either crashed outright under a strict
 * uncaught-exception policy, or (worse, silently) still showed a "copied" toast for a copy that never
 * happened. The `document.execCommand("copy")` fallback below is synchronous and focus-independent —
 * it acts on a real text selection rather than an async permission-gated API — so it also serves as
 * the primary path in engines that never shipped `navigator.clipboard` at all.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Falls through to the legacy path below rather than giving up — a rejection here (no focus,
      // permission denied) says nothing about whether the execCommand selection trick would work.
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  // Off-screen rather than `display: none` — a hidden element can't be selected, and
  // `execCommand("copy")` only ever acts on the current selection.
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.setAttribute("readonly", "")
  document.body.appendChild(textarea)
  const previousActiveElement = document.activeElement as HTMLElement | null
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    previousActiveElement?.focus?.()
  }
}
