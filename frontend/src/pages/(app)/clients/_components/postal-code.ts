/**
 * Loose format check for a client's postal code — this form has no per-country postal rule (unlike
 * the backend's own country-identifiers/), so it only rejects values that plainly aren't a postal
 * code at all, never a specific country's own scheme.
 *
 * Empty is valid: some countries have no postal code system, and an anchored, non-empty-minimum
 * pattern would otherwise reject a blank value exactly like it rejects a malformed one — there is no
 * way to tell the two apart from the string alone, so a blank string is trusted rather than blocked.
 * Case-insensitive: a UK ("SW1A 1AA") or NL ("1234 AB") code typed in lowercase is still a valid code,
 * not a format error — the field is never normalized to uppercase, so the check has to accept what
 * was actually typed.
 */
export function isValidPostalCode(value: string | null | undefined): boolean {
  if (!value) return true
  return /^[0-9A-Z\s-]{3,10}$/i.test(value)
}
