import type { ErrorEvent } from "@sentry/react"

/**
 * Last filter before a browser event leaves the page. The SDK runs with every `dataCollection`
 * switch off; this also drops the user object (an `ip_address`, or the `{{auto}}` marker that asks
 * the server to fill one in from the connection), request headers, breadcrumbs (they quote clicked
 * text and visited URLs), and query strings and fragments, which carry invitation codes and tokens.
 */
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent {
  delete event.user
  delete event.breadcrumbs

  if (event.request) {
    const url = stripQuery(event.request.url)
    event.request = url ? { url } : {}
  }

  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      frame.abs_path = stripQuery(frame.abs_path)
      frame.filename = stripQuery(frame.filename)
    }
  }

  return event
}

export function stripQuery(url: string | undefined): string | undefined {
  if (!url) return undefined
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}
