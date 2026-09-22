/**
 * Pure decisions behind the DNS TXT domain-ownership challenge for per-company SSO — no Prisma, no
 * `node:dns`, so every rule here is exercised directly in `sso-domain-verification.spec.ts` without a
 * database or a network round-trip. The actual DNS lookup and the Prisma read/write live in
 * `modules/company/sso/sso.controller.ts` (the ONLY place `CompanySsoDomain.verifiedAt` is ever
 * written) and reuse these functions rather than re-deriving the record shape or the match rule.
 *
 * Why a challenge is needed at all: `CompanySsoProvider` (and now `CompanySsoDomain`) lets a company
 * CLAIM an email domain so the anonymous `/api/sso/lookup` endpoint can route a matching address at
 * that company's own IdP. A claim alone is not proof — anyone could type "gmail.com" — so nothing may
 * be treated as verified until the claimant has demonstrated control of the domain's own DNS zone,
 * which only its real owner (or someone the real owner trusts) can do.
 */

import { randomBytes } from 'node:crypto';

// 256 bits — comfortably over the "≥128 bits of entropy" floor this token needs, and the same order of
// magnitude as the other bearer tokens this codebase mints (`signature-token.ts`, `api-key.ts`).
// `crypto.randomBytes` is a CSPRNG; `Math.random()` is NOT (it is a fast, non-cryptographic PRNG whose
// output is predictable from a handful of samples) — this codebase already had to fix exactly that
// mistake once for the quote e-signature OTP (see `documents/signatures/otp.ts`'s own header), so this
// module never repeats it.
const TOKEN_BYTES = 32;

/**
 * A fresh, unguessable verification token. Base64url ("-"/"_", no padding) rather than plain base64 or
 * hex: it ends up published as a DNS TXT value AND rendered/copied on a settings screen, and base64url
 * has no character ("+", "/", "=") that a browser, a shell, or a copy-paste into another tool might
 * mangle or need escaping for.
 */
export function generateVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The DNS record NAME the caller must create a TXT record under, for the given domain.
 *
 * A dedicated `_invoicerr-sso.` label, never the bare apex (`domain` itself): a company's apex TXT
 * records already carry SPF, DMARC, and other verification codes from unrelated vendors, all of which
 * live at one name and must be entered as separate values under it. Asking the caller to touch that
 * shared apex record risks them replacing (rather than adding to) an existing SPF/DMARC entry and
 * breaking their own mail flow — the same reason Google/Microsoft/every other domain-verification flow
 * uses its own subdomain label (e.g. "_acme-challenge" for ACME/Let's Encrypt) instead of the apex.
 */
export function buildVerificationRecordName(domain: string): string {
  return `_invoicerr-sso.${domain}`;
}

/** The DNS record VALUE the caller must publish at `buildVerificationRecordName(domain)`. */
export function buildVerificationRecordValue(token: string): string {
  return `invoicerr-sso-verification=${token}`;
}

/**
 * Whether ANY of the resolved TXT records proves control of the domain for `token`.
 *
 * `dns.resolveTxt` (Node's `node:dns` promises API) resolves to `string[][]`: one entry per TXT record
 * in the zone, and each record is itself an array of the raw character-string CHUNKS DNS split it into
 * (a single TXT value longer than 255 bytes is transmitted as several consecutive chunks, per RFC 1035
 * §3.3.14, and Node surfaces that framing instead of hiding it). Our value is short and will only ever
 * be a single chunk in practice, but comparing chunk-by-chunk instead of joining first would be relying
 * on an implementation detail rather than the documented contract — so every record's chunks are always
 * joined into one string before it is compared against the expected value.
 *
 * Matches against ANY record, not just the first: a zone legitimately carries many unrelated TXT
 * records (SPF, DMARC, other vendors' own verification codes) at the SAME name is not expected here
 * because `buildVerificationRecordName` uses a dedicated label, but nothing stops an operator from
 * adding more than one TXT value under it (e.g. while rotating), so every record must be checked.
 */
export function matchesVerificationToken(records: string[][], token: string): boolean {
  const expected = buildVerificationRecordValue(token);
  return records.some((chunks) => {
    // Trim first, then tolerate a literal pair of surrounding double quotes some resolvers/zone files
    // still hand back verbatim (most zone-file syntaxes require quoting a TXT value; Node's own
    // resolver already strips them in the common case, but stripping defensively here costs nothing
    // and protects against a resolver or a test fixture that does not).
    const joined = chunks.join('').trim();
    const unquoted = joined.startsWith('"') && joined.endsWith('"') ? joined.slice(1, -1) : joined;
    return unquoted.trim() === expected;
  });
}

// No `timingSafeEqual` here, deliberately: this token is published in PUBLIC DNS by the caller
// themselves as the whole point of the exercise, so there is no secret on either side of this
// comparison for a timing side-channel to leak. Swapping the `===` above for a constant-time compare
// would add complexity to guard against an attack that does not exist for this value — do not "fix"
// this without first identifying what secret it would protect.
