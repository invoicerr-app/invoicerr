import type { ErrorEvent } from "@sentry/react"
// The same rules as the server and the logs, read from the one file both builds share (the Dockerfile's
// frontend stage copies it to the same relative path).
import {
  redactErrorReportText,
  redactErrorReportValue,
  redactUrl,
} from "../../../backend/src/logger/redaction-rules"

/**
 * Pages that never report, and on which the SDK is never started: they serve people outside the
 * account (a client on the portal, a signer on a public link) or not signed in yet (sign-in and legal
 * pages). Their URL also carries an access token.
 */
export const UNTRACKED_BROWSER_PATH_PREFIXES: readonly string[] = ["/portal", "/signature", "/auth", "/legal"]

export function isUntrackedBrowserPath(pathname: string): boolean {
  const path = pathname.toLowerCase()
  return UNTRACKED_BROWSER_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/** Contexts kept, as filled in by the SDK: browser and OS versions, and the random trace ids. Any other is dropped. */
export const KEPT_BROWSER_CONTEXTS: readonly string[] = ["browser", "os", "trace"]

/**
 * Last filter before a browser event leaves the page. The SDK runs with every `dataCollection`
 * switch off; this also drops the user object (an `ip_address`, or the `{{auto}}` marker that asks
 * the server to fill one in from the connection), request headers, breadcrumbs (they quote clicked
 * text and visited URLs), every context not listed above, and tags. Every URL left (stack frames)
 * loses its query string and fragment and any access token in its path. Free text (the message, the
 * exception text, `extra`) goes through the rules shared with the server, so an error message built
 * from a server reply (`use-fetch.ts`) cannot carry an email, an IBAN, a phone number or a token.
 */
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent {
  delete event.user
  delete event.breadcrumbs
  delete event.tags

  if (event.request) {
    const url = redactUrl(event.request.url)
    event.request = url ? { url } : {}
  }

  if (event.message) event.message = redactErrorReportText(event.message)

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactErrorReportText(exception.value)
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars
      frame.abs_path = redactUrl(frame.abs_path)
      frame.filename = redactUrl(frame.filename)
    }
  }

  if (event.extra) event.extra = redactErrorReportValue(event.extra) as Record<string, unknown>

  if (event.contexts) {
    const kept: NonNullable<ErrorEvent["contexts"]> = {}
    for (const key of KEPT_BROWSER_CONTEXTS) {
      const context = event.contexts[key]
      if (context) kept[key] = context
    }
    event.contexts = kept
  }

  return event
}
