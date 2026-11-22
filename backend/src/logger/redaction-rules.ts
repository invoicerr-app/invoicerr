/**
 * The redaction rules themselves, with no dependency at all (no Node API, no import) so the one file is
 * used by every place that filters text on its way out of the application:
 * - `redaction.ts`, the boundary every log line crosses;
 * - `error-tracking/scrub-event.ts`, the last filter before a server error report leaves the process;
 * - `frontend/src/lib/error-tracking-scrub.ts`, the last filter before a browser error report leaves
 *   the page. The frontend imports this file by relative path, and the Dockerfile's frontend stage
 *   copies it to the same relative location, so both builds read the same rules instead of two copies
 *   drifting apart.
 *
 * Keep it dependency-free and free of Node globals (`Buffer`, `process`): the browser bundle compiles it.
 */
export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted-email]';
export const REDACTED_SECRET = '[redacted-secret]';
export const REDACTED_IBAN = '[redacted-iban]';
export const REDACTED_PHONE = '[redacted-phone]';
export const REDACTED_COMPANY_ID = '[redacted-company-id]';
export const REDACTED_IP = '[redacted-ip]';

/** Values longer than this are truncated: a log line or an error report is not a place to dump a document. */
export const MAX_REDACTED_TEXT_LENGTH = 2_000;

/**
 * Exact key matches, normalized (`lowercased`, non-alphanumerics stripped): `new_email`, `newEmail`
 * and `NEW-EMAIL` all collapse to `newemail`.
 *
 * Exact rather than "contains" for the short ones on purpose: a `contains('code')` rule would eat
 * `countryCode`, `statusCode`, `postalCode` and `errorCode`, all of which are exactly the context a
 * log line needs. A bare `code` key is left alone for the same reason: it carries a named refusal
 * (`NO_FREE_SEAT`, a provider status) far more often than a credential, and a real invitation code
 * is still caught by the 32-hex rule below when it appears as a VALUE under any key. The
 * unambiguous fragments are handled by `SENSITIVE_KEY_FRAGMENTS`.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
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
  'apitoken',
  'csrftoken',
  'sessionid',
  'apikey',
  'api_key',
  'privatekey',
  'secret',
  'jwtsecret',
  'secretkey',
  'encryptionkey',
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
  'sessionid',
  'token',
  'secret',
  'invitationcode',
  'encryptionkey',
  'authorization',
  'cookie',
  'creditcard',
  'cardnumber',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Patterns that identify a secret inside free text (a message, an error message, a stack trace). The
 * email rule is what keeps the common case (`... for user@example.com`) out of both sinks even when a
 * call site interpolates it into the sentence instead of passing it in `details`.
 */
export const TEXT_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  // RFC-5322-ish, deliberately conservative: needs a dot in the domain so file paths and versions
  // are left alone.
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: REDACTED_EMAIL },
  // JSON Web Tokens: header.payload.signature, base64url.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED_SECRET,
  },
  // "Bearer <token>" / "Basic <base64>" in a header dump, a URL, an error message.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1 ${REDACTED_SECRET}` },
  // Secrets passed as query parameters (?token=…, ?code=…, ?api_key=…).
  {
    pattern:
      /([?&](?:token|access_token|refresh_token|id_token|code|api_key|apikey|secret|password)=)[^&\s#]+/gi,
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
  // Bank account numbers (IBAN): country letters, two check digits, then 11 to 30 alphanumerics,
  // printed in groups of four or run together. The look-ahead asks for at least eight more digits so
  // an upper-case word followed by a number ("ID12 USER NAME") is left alone.
  {
    pattern: /\b[A-Z]{2}\d{2}(?=(?: ?[A-Z]*\d){8})(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
    replacement: REDACTED_IBAN,
  },
  // Phone numbers in international form: a leading `+`, then 7 to 15 digits with optional spaces,
  // dots or dashes, and an optional "(0)" trunk prefix.
  { pattern: /\+\d{1,3}(?:[ .-]?\(0\))?(?:[ .-]?\d){6,14}\b/g, replacement: REDACTED_PHONE },
  // Phone numbers in national form: a trunk `0`, then nine digits printed in pairs or run together.
  { pattern: /\b0\d(?:[ .-]?\d{2}){4}\b/g, replacement: REDACTED_PHONE },
  // Company registration numbers: a 9-digit SIREN, or a 14-digit SIRET (SIREN plus a 5-digit
  // establishment number), run together or printed in groups of three. They name a client or the
  // issuing company. Runs after the phone rules so a phone number is not half-matched as one.
  { pattern: /\b\d{3} ?\d{3} ?\d{3}(?: ?\d{5})?\b/g, replacement: REDACTED_COMPANY_ID },
  // Invitation codes are 32 hex characters. 32+ also covers a raw SHA-256/MD5 digest that a call
  // site might have interpolated; uuids carry dashes and are left intact (they are the ids a support
  // request needs).
  { pattern: /\b[0-9a-f]{32,}\b/gi, replacement: REDACTED_SECRET },
];

/** Free text → redacted free text. Never throws, never returns something longer than the cap. */
export function redactText(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > MAX_REDACTED_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_REDACTED_TEXT_LENGTH)}…`
    : redacted;
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Eight colon-joined hex groups, or a `::`-compressed form: matches IPv6 addresses without catching
// clock times (`12:30:45`) or `host:port`.
const IPV6 =
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|(?:\b[0-9a-f]{1,4})?(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?\b/gi;

/**
 * IP addresses. Not part of `TEXT_PATTERNS`: the logs keep them on purpose (abuse and rate-limit
 * investigations), error reports never need them.
 */
export function redactIpAddresses(text: string): string {
  return text.replace(IPV4, REDACTED_IP).replace(IPV6, (match) => (match.length > 2 ? REDACTED_IP : match));
}

/** The text rules plus IP addresses: what an error report's free text goes through. */
export function redactErrorReportText(value: string): string {
  return redactIpAddresses(redactText(value));
}

// A path segment that is a capability token (client portal, signature link, invitation): 32 or more
// hex characters, the same shape the 32-hex text rule catches.
const TOKEN_PATH_SEGMENT = /(^|\/)[0-9a-f]{32,}(?=\/|$)/gi;

/**
 * A URL as it may appear in an error report: query string and fragment dropped (tokens, search
 * terms), capability tokens in the path replaced, then the text rules (an email in a path segment).
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const cut = url.search(/[?#]/);
  const withoutQuery = cut === -1 ? url : url.slice(0, cut);
  return redactErrorReportText(withoutQuery.replace(TOKEN_PATH_SEGMENT, `$1${REDACTED_SECRET}`));
}

const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

/**
 * Deep-redacts a JSON-like value (an error report's `extra` or `contexts`): values under a sensitive
 * key are replaced, every string goes through `redactErrorReportText`, and depth and size are capped.
 */
export function redactErrorReportValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return redactErrorReportText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[unserializable]';
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((item) => redactErrorReportValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactErrorReportValue(entry, depth + 1);
    }
    return result;
  }
  return '[unserializable]';
}
