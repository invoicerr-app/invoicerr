/**
 * Pragmatic e-mail address validator — this codebase has no shared one (`grep -rn "IsEmail"` over
 * `backend/src` turns up nothing; `class-validator` is used in a handful of DTOs but never for an
 * e-mail format, and `Company.email`/`billingEmail` have never been format-checked at write time).
 * Deliberately NOT RFC 5322-exact: that grammar accepts addresses (quoted local parts, bang paths,
 * IP-literal domains) no real mail server or settings form should have to think about, and rejecting
 * everything it does not cover would refuse addresses that work fine in practice. Same "close enough,
 * never a fabricated RFC-perfect parser" posture as `branding.service.ts`'s own hex-color regex.
 *
 * Deliberately NOT a regex. The first version was `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which CodeQL
 * flagged live on PR #424 (`js/polynomial-redos`, high severity): `[^\s@]+` right before `\.` lets
 * the engine try every split point between the two quantifiers on a non-matching input (many "."
 * repetitions in particular), which is polynomial backtracking on a value that reaches this function
 * straight from a request body — a crafted Reply-To is a denial-of-service against the API. Manual
 * parsing (`indexOf`/`slice`/`split`, no backtracking possible by construction) does the same job in
 * genuinely linear time. See `is-valid-email.spec.ts` for the exact boundary this still enforces.
 *
 * Requires exactly one "@", a non-empty local part and domain on either side, no whitespace anywhere,
 * and a domain with at least two non-empty dot-separated labels — enough to catch a typo'd Reply-To
 * ("bob@", "bob@company", "bob company.com", "a@b@example.com") before it is ever stored, never
 * enough to guarantee the address actually receives mail.
 */
function containsWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Space, tab, LF, VT, FF, CR — the ASCII whitespace this validator cares about; a plausible
    // e-mail address never legitimately contains any of them, and this is the same set `[^\s@]`
    // effectively excluded for every input this function is actually asked about.
    if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true;
  }
  return false;
}

export function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (containsWhitespace(trimmed)) return false;

  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return false; // no '@', or empty local/domain
  if (atIndex !== trimmed.lastIndexOf('@')) return false; // more than one '@' — reject, never guess which

  const domain = trimmed.slice(atIndex + 1);
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0);
}
