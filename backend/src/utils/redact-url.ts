/**
 * Turn a connection URL into something safe to put in a log line, an exception message, or a support
 * bundle — WITHOUT throwing away the part an operator actually needs.
 *
 * A connection string is two things at once: a destination (scheme, host, port, database) that is the
 * whole point of naming it in a diagnostic, and a credential (the password in the userinfo, or one
 * hiding in a query parameter) that must never be written down. Redacting the line as a whole is the
 * easy answer and the wrong one — a "Redis is unreachable" crash that refuses to say WHERE it tried
 * is a crash nobody can act on. So the destination is kept verbatim and only the secret is replaced.
 *
 * The username is deliberately KEPT. It is not the secret, and it is frequently the thing that is
 * wrong: a Redis ACL user that does not exist, or a managed provider's per-instance user typo'd into
 * the wrong environment, is diagnosable from the log only if the log says which user was presented.
 *
 * Unparseable input is redacted rather than passed through. Anything this function cannot understand
 * may still be carrying a password (an operator's typo does not make a secret stop being one), so the
 * fallback is a textual strip of the userinfo, never the original string.
 */

/** Stand-in written in place of a secret. Fixed-width and obviously not a value, so nobody reading a
 *  log mistakes it for the configured password. */
const REDACTED = '***';

/** A query parameter whose NAME suggests it carries a credential. Names vary by client and provider
 *  (`password`, `auth_token`, `sslkey`, `apikey`…), so this matches on substrings rather than trying
 *  to enumerate them — over-redacting a query parameter costs an operator nothing, since the
 *  destination they need is in the scheme/host/port/path that is never touched. */
const SECRET_PARAM = /pass|secret|token|auth|key|credential/i;

/** Textual fallback for input `new URL()` refuses: everything between `://` and the LAST `@` is
 *  userinfo, and the last `@` is the right one because a password may legally contain one. */
function stripUserinfo(raw: string): string {
  return raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)@/, `$1${REDACTED}@`);
}

export function redactUrlCredentials(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return stripUserinfo(raw);
  }

  if (url.password) url.password = REDACTED;
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.set(name, REDACTED);
  }

  return url.toString();
}
