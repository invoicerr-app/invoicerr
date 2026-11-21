import type { ErrorEvent, EventHint } from '@sentry/node';
import { redactErrorReportText, redactErrorReportValue } from '../logger/redaction-rules';

/**
 * Contexts an event may keep, all filled in by the SDK and describing the process, never the request
 * or the person: the runtime and OS versions, the app's own memory and start time, and the random
 * trace ids. They are kept as they are (redacting would mangle the trace id, which is 32 hex
 * characters). Anything else, including a context an integration adds later, is dropped rather than
 * filtered, so a new context has to be added here on purpose.
 */
export const KEPT_CONTEXTS: readonly string[] = ['runtime', 'os', 'app', 'trace'];

/**
 * Last filter before an event leaves the process. The SDK already runs with every `dataCollection`
 * switch off; this removes what it could still attach on its own: request bodies, cookies, headers,
 * query strings, the user object (an `ip_address`, or the `{{auto}}` marker that asks the server to
 * fill one in from the connection) and breadcrumbs, which can quote any earlier log line. The request
 * URL goes too: its path carries record ids (a client, an invoice), so only the method and the route
 * template the interceptor tags the event with remain. Free text that remains (the exception message,
 * extra context) goes through the rules shared with the logs and the browser
 * (`logger/redaction-rules.ts`), plus IP addresses. A database error keeps only its name and code:
 * its message quotes the query's values.
 *
 * Nothing that identifies the user who made the request is ever attached: no id, no email, no IP,
 * no session or company. An error raised while serving a request reads the same as one raised by a
 * background job.
 */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  delete event.server_name;

  if (event.request) {
    event.request = event.request.method ? { method: event.request.method } : {};
  }

  if (event.message) event.message = redactErrorReportText(event.message);

  const databaseErrorCode = prismaErrorCode(hint?.originalException);
  for (const exception of event.exception?.values ?? []) {
    if (exception.type && isPrismaErrorName(exception.type)) {
      exception.value = databaseErrorCode ? `code ${databaseErrorCode}` : '[redacted]';
    } else if (exception.value) {
      exception.value = redactErrorReportText(exception.value);
    }
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }

  if (event.extra) event.extra = redactErrorReportValue(event.extra) as Record<string, unknown>;

  if (event.contexts) {
    const kept: NonNullable<ErrorEvent['contexts']> = {};
    for (const key of KEPT_CONTEXTS) {
      const context = event.contexts[key];
      if (context) kept[key] = context;
    }
    event.contexts = kept;
  }

  return event;
}

/** Prisma's error classes: `PrismaClientKnownRequestError`, `PrismaClientValidationError`, ... */
export function isPrismaErrorName(name: string): boolean {
  return name.startsWith('PrismaClient');
}

function prismaErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !isPrismaErrorName(error.name)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined;
}
