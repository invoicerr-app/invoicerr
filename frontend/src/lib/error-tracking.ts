import { isUntrackedBrowserPath, scrubBrowserEvent } from "./error-tracking-scrub"

/** What the backend hands a signed-in user who agreed to error reporting (`GET /api/error-tracking/consent`). */
export interface BrowserErrorTrackingConfig {
  dsn: string
  environment: string
  release: string
}

type SentryModule = typeof import("@sentry/react")

let sentry: SentryModule | null = null
let runningDsn: string | null = null
// The latest wish, so a stop that arrives while the SDK is still downloading wins over the start.
let wanted: BrowserErrorTrackingConfig | null = null

/**
 * Starts browser error tracking for a user who agreed to it. Called only by
 * `ErrorTrackingConsentController`, which is mounted in the signed-in layout and reads the user's
 * stored decision: nothing here runs before sign-in, and the SDK (a separate chunk) is not even
 * downloaded before a "yes". There is no DSN anywhere in the bundle or in `/config.json`: the
 * backend only returns it with a valid grant.
 *
 * Errors only: no tracing, no session replay, no breadcrumbs, no unhandled promise rejections (they
 * quote request failures, `use-fetch.ts`), and no request context (the URL of a portal or signature
 * page carries its access token). Never under Cypress, so a test run never reports into a real project.
 */
export async function startErrorTracking(config: BrowserErrorTrackingConfig): Promise<void> {
  if ("Cypress" in window) return
  if (sentry && runningDsn === config.dsn) return
  if (sentry) await stopErrorTracking()
  wanted = config

  try {
    const Sentry = await import("@sentry/react")
    if (wanted !== config) return
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release || undefined,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: false }),
        Sentry.browserApiErrorsIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.eventFiltersIntegration(),
        Sentry.functionToStringIntegration(),
      ],
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      beforeBreadcrumb: () => null,
      beforeSendTransaction: () => null,
      // A page the user reached by a link while the SDK runs (a public signature or legal page)
      // never reports.
      beforeSend: (event, hint) =>
        isUntrackedBrowserPath(window.location.pathname) ? null : scrubBrowserEvent(event, hint),
    })
    sentry = Sentry
    runningDsn = config.dsn
  } catch {
    // A tracker that fails to load must never break the app.
  }
}

/** Stops the SDK at once (a withdrawal, a sign-out): nothing more is captured or sent. */
export async function stopErrorTracking(): Promise<void> {
  wanted = null
  const running = sentry
  sentry = null
  runningDsn = null
  if (!running) return
  try {
    await running.close(2_000)
  } catch {
    // Already closed or never fully started: nothing left to stop.
  }
}

export function isErrorTrackingRunning(): boolean {
  return sentry !== null
}
