/**
 * Hands a blob to the browser as a named download. Every exporter in this app funnels through here,
 * so the object-URL lifetime is decided in one place: Firefox reads the blob after `click()` returns,
 * and revoking at once can cancel the save.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 40_000)
}

/**
 * Hands a blob to the browser in a new tab (a preview, not a save). The object URL is never revoked,
 * as in every copy this replaced: the new tab reads it after `window.open` returns, and no copy ever
 * decided when that read is over.
 */
export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
}

/** The message a failed download surfaces: the backend's own `message` when the body carries one,
 *  `HTTP <status>` otherwise (no body, not JSON, or no `message`). */
export async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  return body?.message || `HTTP ${response.status}`
}
