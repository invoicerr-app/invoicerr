import type { ErrorEvent, EventHint } from '@sentry/node';
import { causeChain, redactErrorReportValue, safeErrorCode, summarizeError } from '../logger/redaction-rules';

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
 * template the interceptor tags the event with remain. An error's own text never leaves: it can quote
 * a client's name, an address, an invoice line or an amount, which no pattern can recognise. Each
 * exception keeps its type, its code when it has one (an HTTP status, a business or database code)
 * and its stack trace; the event message becomes the same summary. `extra` still goes through the
 * rules shared with the logs and the browser (`logger/redaction-rules.ts`).
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

  delete event.logentry;

  const values = event.exception?.values ?? [];
  const chain = causeChain(hint?.originalException);
  for (const [index, exception] of values.entries()) {
    // The SDK lists the innermost cause first and the thrown error last.
    const error = chain[values.length - 1 - index];
    exception.value = summarizeError(exception.type, errorCode(error));
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }

  if (event.message) event.message = values[values.length - 1]?.value ?? '[redacted]';

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

/** An HTTP exception's status, or a `code` that reads as an identifier (`P2002`, `COMPANY_BLOCKED`). */
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, getStatus } = error as { code?: unknown; getStatus?: unknown };
  const safe = safeErrorCode(code);
  if (safe) return safe;
  if (typeof getStatus === 'function') {
    const status: unknown = getStatus.call(error);
    if (typeof status === 'number') return String(status);
  }
  return undefined;
}
