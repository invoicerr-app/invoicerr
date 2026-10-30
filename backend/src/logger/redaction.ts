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
 * Redacted: email addresses anywhere in a string, bearer/basic credentials, tokens and query-string
 * secrets, invitation codes, and any value under a key that names one of those (deeply).
 */
export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted-email]';
export const REDACTED_SECRET = '[redacted-secret]';

/** Values longer than this are truncated — a log line is not a place to dump a document. */
const MAX_STRING_LENGTH = 2_000;
/** Depth beyond which a nested object is summarised rather than walked. */
const MAX_DEPTH = 6;
/** Arrays are capped so a 10 000-row payload cannot turn one log write into a megabyte. */
const MAX_ARRAY_ITEMS = 50;
/** Objects are capped for the same reason. */
const MAX_OBJECT_KEYS = 50;

/**
 * Exact key matches, normalized (`lowercased`, non-alphanumerics stripped): `new_email`, `newEmail`
 * and `NEW-EMAIL` all collapse to `newemail`.
 *
 * Exact rather than "contains" for the short ones on purpose — a `contains('code')` rule would eat
 * `countryCode`, `statusCode`, `postalCode` and `errorCode`, all of which are exactly the context a
 * log line needs. A bare `code` key is left alone for the same reason: it carries a named refusal
 * (`NO_FREE_SEAT`, a provider status) far more often than a credential, and a real invitation code
 * is still caught by the 32-hex rule below when it appears as a VALUE under any key. The
 * unambiguous fragments are handled by `SENSITIVE_KEY_FRAGMENTS`.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'email',
  'newemail',
  'oldemail',
  'emailaddress',
  'billingemail',
  'contactemail',
  'recipient',
  'recipientemail',
  'codehash',
  'invitationcode',
  'invitationcodehash',
  'otp',
  'otpcode',
  'verificationcode',
  'recoverycode',
  'resetcode',
  'couponcode',
  'password',
  'passwd',
  'pwd',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'idtoken',
  'bearertoken',
  'apikey',
  'api_key',
  'privatekey',
  'secret',
  'clientsecret',
  'webhooksecret',
  'authorization',
  'cookie',
  'setcookie',
  'iban',
  'bic',
  'phone',
  'phonenumber',
  'mobile',
  'body',
  'rawbody',
  'payload',
  'requestbody',
]);

/** Unambiguous substrings: `companyWebhookSecret`, `stripeApiKey`, `X-Api-Key`… */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'passwd',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'invitationcode',
  'clientsecret',
  'webhooksecret',
  'authorization',
  'cookie',
  'creditcard',
  'cardnumber',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Patterns that identify a secret inside free text — a message, an error message, a stack trace. The
 * email rule is what keeps the common case (`... for user@example.com`) out of both sinks even when a
 * call site interpolates it into the sentence instead of passing it in `details`.
 */
const TEXT_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  // RFC-5322-ish, deliberately conservative: needs a dot in the domain so file paths and versions
  // are left alone.
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: REDACTED_EMAIL },
  // JSON Web Tokens — header.payload.signature, base64url.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED_SECRET,
  },
  // "Bearer <token>" / "Basic <base64>" in a header dump, a URL, an error message.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1 ${REDACTED_SECRET}` },
  // Secrets passed as query parameters (?token=…, ?code=…, ?api_key=…).
  {
    pattern: /([?&](?:token|access_token|refresh_token|id_token|code|api_key|apikey|secret|password)=)[^&\s#]+/gi,
    replacement: `$1${REDACTED_SECRET}`,
  },
  // key=value pairs in a body-ish string (form-encoded, .env dump, connection string).
  {
    pattern: /\b(password|passwd|pwd|token|api[_-]?key|secret|client_secret)=([^&\s,;"']+)/gi,
    replacement: `$1=${REDACTED_SECRET}`,
  },
  // Provider keys that a thrown error or a debug line can carry verbatim. Their prefixes are unique
  // enough that no ordinary word collides, unlike a bare "32 random characters" rule.
  {
    pattern:
      /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|\b(?:ghp|gho|ghs)_[A-Za-z0-9]{8,}|\bxox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[0-9A-Z]{12,}\b/g,
    replacement: REDACTED_SECRET,
  },
  // Invitation codes are 32 hex characters. 32+ also covers a raw SHA-256/MD5 digest that a call
  // site might have interpolated; uuids carry dashes and are left intact (they are the ids a support
  // request needs).
  { pattern: /\b[0-9a-f]{32,}\b/gi, replacement: REDACTED_SECRET },
];

/** Free text → redacted free text. Never throws, never returns something longer than the cap. */
export function redactLogText(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}…` : redacted;
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
