import type { ErrorEvent, EventHint } from "@sentry/react"
// The same rules as the server and the logs, read from the one file both builds share (the Dockerfile's
// frontend stage copies it to the same relative path).
import { redactErrorReportValue, redactUrl } from "../../../backend/src/logger/redaction-rules"

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
 * loses its query string and fragment and any access token in its path. An error's own text never
 * leaves, since a message built from a server reply (`use-fetch.ts`) can quote a client's name, an
 * address or an amount: each exception keeps its type, its code (the reply's `code`, or its HTTP
 * status) and its stack trace, and the event message becomes the same summary. `extra` goes through
 * the rules shared with the server.
 */
export function scrubBrowserEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  delete event.user
  delete event.breadcrumbs
  delete event.tags

  if (event.request) {
    const url = redactUrl(event.request.url)
    event.request = url ? { url } : {}
  }

  delete event.logentry

  const values = event.exception?.values ?? []
  const chain = causeChain(hint?.originalException)
  for (const [index, exception] of values.entries()) {
    // The SDK lists the innermost cause first and the thrown error last.
    const error = chain[values.length - 1 - index]
    exception.value = summarizeError(exception.type, errorCode(error))
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars
      frame.abs_path = redactUrl(frame.abs_path)
      frame.filename = redactUrl(frame.filename)
    }
  }

  if (event.message) event.message = values[values.length - 1]?.value ?? "[redacted]"

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

/** `Type code`, `Type` without a code, `[redacted]` when even the type is unknown. */
export function summarizeError(type: string | undefined, code: string | undefined): string {
  if (!type) return code ? `code ${code}` : "[redacted]"
  return code ? `${type} ${code}` : type
}

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/

/** A `code` that reads as an identifier (`COMPANY_BLOCKED`), else the reply's HTTP `status`. */
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const { code, status } = error as { code?: unknown; status?: unknown }
  if ((typeof code === "string" || typeof code === "number") && SAFE_CODE.test(String(code))) {
    return String(code)
  }
  if (typeof status === "number") return String(status)
  return undefined
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let current = error
  while (current && chain.length < 10 && !chain.includes(current)) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}
