/**
 * The single redaction boundary every log line crosses before it reaches ANY sink — the `Log` table,
 * stdout, or a log shipper reading stdout. Two sinks, one filter: `logger.service.ts` calls these
 * helpers on its way to `persist()` and to the Nest console logger, and
 * `redacting-console-logger.ts` calls the same helpers for everything the FRAMEWORK logs (unhandled
 * exception traces included) once it is installed as the application logger.
 *
 * ## Why filter at the sink instead of fixing 300 call sites
 * Call sites are dozens of files and keep being written. A rule that only holds where someone
 * remembered it is not a rule. Filtering here means a future `logger.info('...', { details: { email } })`
 * is safe by default, while still failing closed on the key names that carry a credential. Call sites
 * that can avoid putting PII in a log line at all should still do so — this is the net, not the plan.
 *
 * ## What is redacted, and what is deliberately kept
 * Kept, because they are what makes a log line usable during an incident: request path, status code,
 * category, level, user id, company id, provider/transport names, error names, counts, ids (uuid).
 * Redacted: email addresses, IBANs, phone numbers and SIREN/SIRET numbers anywhere in a string,
 * bearer/basic credentials, tokens and query-string secrets, invitation codes, and any value under a
 * key that names one of those (deeply). The rules themselves live in `redaction-rules.ts`, shared with
 * the error-tracking filters of the server and the browser.
 */
import { isSensitiveKey, REDACTED, redactText } from './redaction-rules';

export { REDACTED, REDACTED_EMAIL, REDACTED_SECRET } from './redaction-rules';

/** Depth beyond which a nested object is summarised rather than walked. */
const MAX_DEPTH = 6;
/** Arrays are capped so a 10 000-row payload cannot turn one log write into a megabyte. */
const MAX_ARRAY_ITEMS = 50;
/** Objects are capped for the same reason. */
const MAX_OBJECT_KEYS = 50;

/** Free text → redacted free text. Never throws, never returns something longer than the cap. */
export function redactLogText(value: string): string {
  return redactText(value);
}

function redactError(error: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: redactLogText(error.message),
  };
  if (typeof error.stack === 'string') {
    result.stack = redactLogText(error.stack);
  }
  // A driver's own error object sometimes carries the failing query or a connection string on extra
  // enumerable fields (`code`, `detail`, `meta`) — copy the ones that are not sensitive by name, and
  // let the key rule drop the rest.
  for (const [key, value] of Object.entries(error as unknown as Record<string, unknown>)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    result[key] = redactLogValue(value, 1);
  }
  return result;
}

/**
 * Deep-redacts a value destined for `Log.details` (Prisma `Json`) or for the console. Handles the
 * shapes that actually appear in this codebase: plain objects, arrays, strings, numbers, booleans,
 * `null`/`undefined`, `Date`, and `Error` (flattened to name/message/stack so an error tracker or a
 * log screen can still show why something failed).
 */
export function redactLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[unserializable]';

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value);
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;

  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const capped = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactLogValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) capped.push(`[${value.length - MAX_ARRAY_ITEMS} more]`);
    return capped;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactLogValue(entryValue, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) result['[truncated]'] = `${entries.length - MAX_OBJECT_KEYS} more`;
    return result;
  }

  return String(value);
}

/** `details` is always an object map at the call sites; kept separate for readability. */
export function redactLogDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  const redacted = redactLogValue(details);
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : { value: redacted };
}
