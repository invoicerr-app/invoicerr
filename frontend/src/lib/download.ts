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
