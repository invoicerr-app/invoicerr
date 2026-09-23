/**
 * Pragmatic e-mail address validator — this codebase has no shared one (`grep -rn "IsEmail"` over
 * `backend/src` turns up nothing; `class-validator` is used in a handful of DTOs but never for an
 * e-mail format, and `Company.email`/`billingEmail` have never been format-checked at write time).
 * Deliberately NOT RFC 5322-exact: that grammar accepts addresses (quoted local parts, bang paths,
 * IP-literal domains) no real mail server or settings form should have to think about, and rejecting
 * everything it does not cover would refuse addresses that work fine in practice. Same "close enough,
 * never a fabricated RFC-perfect parser" posture as `branding.service.ts`'s own hex-color regex.
 *
 * Requires exactly one "@", a non-empty local part and domain on either side, and at least one "."
 * in the domain with a non-empty label after it — enough to catch a typo'd Reply-To
 * ("bob@", "bob@company", "bob company.com") before it is ever stored, never enough to guarantee the
 * address actually receives mail.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
