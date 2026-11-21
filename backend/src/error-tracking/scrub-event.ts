import type { ErrorEvent } from '@sentry/node';
import { redactLogText, redactLogValue } from '../logger/redaction';

/**
 * Last filter before an event leaves the process. The SDK already runs with every `dataCollection` switch off;
 * this removes what it could still attach on its own: request bodies, cookies, headers, query strings,
 * the user object (an `ip_address`, or the `{{auto}}` marker that asks the server to fill one in from
 * the connection) and breadcrumbs, which can quote any earlier log line. Free text that remains (the
 * exception message, extra context) goes through the same redaction as the logs.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  delete event.server_name;

  if (event.request) {
    const url = stripQuery(event.request.url);
    event.request = { method: event.request.method, ...(url ? { url } : {}) };
  }

  if (event.message) event.message = redactLogText(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactLogText(exception.value);
  }

  if (event.extra) event.extra = redactLogValue(event.extra) as Record<string, unknown>;

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (key === 'runtime' || key === 'os' || key === 'app' || key === 'trace') continue;
      event.contexts[key] = redactLogValue(event.contexts[key]) as Record<string, unknown>;
    }
  }

  return event;
}

/** Keeps origin and path only: query strings and fragments carry tokens and search terms. */
export function stripQuery(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
