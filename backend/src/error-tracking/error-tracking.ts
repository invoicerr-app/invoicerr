import type * as SentryNode from '@sentry/node';
import { type ErrorTrackingRole, readErrorTrackingConfig } from './error-tracking-config';
import { scrubEvent } from './scrub-event';

let sentry: typeof SentryNode | null = null;

/**
 * Starts the Sentry-compatible SDK when `SENTRY_DSN` is set, and does nothing otherwise: the SDK is
 * only loaded in that case, so an instance without error tracking pays nothing for it.
 *
 * This is the operator's choice, made for the server under legitimate interest: no end-user consent
 * is asked for it, so the events it sends must not identify anyone (see `scrub-event.ts`). It never
 * reports anything from the routes that serve people outside the account (client portal, public
 * signature and document links, sign-in, legal pages): see `error-tracking.interceptor.ts`.
 *
 * Errors only. Unhandled promise rejections are not reported: the ones that matter reach the
 * interceptor or the uncaught-exception handler, and the others are mostly noise. Tracing, breadcrumbs and the auto-instrumentation integrations stay off: they would
 * duplicate what the metrics and logs already carry, and every one of them is another place a
 * request detail could leak from. `enableOpenTelemetrySetup` stays false so the SDK never registers
 * a tracer provider competing with an OpenTelemetry exporter.
 */
export function initErrorTracking(role: ErrorTrackingRole): boolean {
  const config = readErrorTrackingConfig(role);
  if (!config || sentry) return sentry !== null;

  // Loaded lazily on purpose, see the function comment.
  const sdk = require('@sentry/node') as typeof SentryNode;
  sdk.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // The SDK's own collection switches (what `sendDefaultPii: false` used to cover), all off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    enableOpenTelemetrySetup: false,
    defaultIntegrations: false,
    integrations: [
      sdk.onUncaughtExceptionIntegration(),
      sdk.linkedErrorsIntegration(),
      sdk.dedupeIntegration(),
      sdk.eventFiltersIntegration(),
      sdk.functionToStringIntegration(),
    ],
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSendTransaction: () => null,
    beforeSend: (event, hint) => scrubEvent(event, hint),
    initialScope: { tags: { role: config.role } },
  });
  sentry = sdk;
  return true;
}

/**
 * Reports an error the application caught itself. No-op when error tracking is off. `route` is the
 * route template (`/api/documents/:id`), never the concrete path, which would carry record ids.
 */
export function captureServerError(error: unknown, context: { route?: string } = {}): void {
  if (!sentry) return;
  if (!context.route) {
    sentry.captureException(error);
    return;
  }
  const route = context.route;
  sentry.withScope((scope) => {
    scope.setTag('route', route);
    sentry?.captureException(error);
  });
}

/**
 * A failed boot exits right after logging, so the event has to be flushed first or it is lost with the
 * process. Bounded so an unreachable tracker never holds the exit.
 */
export async function reportBootFailure(error: unknown): Promise<void> {
  if (!sentry) return;
  sentry.captureException(error);
  await sentry.flush(2_000).catch(() => undefined);
}
