/** A human-readable country name from an ISO 3166-1 alpha-2 code, in the reader's own language -
 *  same `Intl.DisplayNames` convention `lib/apply-address-suggestion.ts` already uses; never a legal
 *  fact, purely a display nicety over a code the backend already resolved. */
export function countryName(language: string, code?: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([language, "en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}
