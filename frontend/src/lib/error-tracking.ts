import { getEnvVariable } from "./runtime-config"
import { scrubBrowserEvent } from "./error-tracking-scrub"

/**
 * Starts browser error tracking when the instance publishes a DSN in /config.json
 * (`SENTRY_FRONTEND_DSN`), and does nothing otherwise: the SDK is a separate chunk, only downloaded
 * in that case. Errors only, no tracing, no session replay, no breadcrumbs. Never under Cypress, so a
 * test run never reports into a real project.
 */
export async function initErrorTracking(): Promise<void> {
  const dsn = getEnvVariable("VITE_SENTRY_DSN")?.trim()
  if (!dsn || "Cypress" in window) return

  try {
    const Sentry = await import("@sentry/react")
    Sentry.init({
      dsn,
      environment: getEnvVariable("VITE_SENTRY_ENVIRONMENT")?.trim() || "production",
      release: getEnvVariable("VITE_SENTRY_RELEASE")?.trim() || undefined,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration(),
        Sentry.browserApiErrorsIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.eventFiltersIntegration(),
        Sentry.functionToStringIntegration(),
        Sentry.httpContextIntegration(),
      ],
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      beforeSendTransaction: () => null,
      beforeSend: (event) => scrubBrowserEvent(event),
    })
  } catch {
    // A tracker that fails to load must never keep the app from starting.
  }
}
