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

/** A human-readable currency name from an ISO 4217 code, in the reader's own language - the same
 *  `Intl.DisplayNames` convention as `countryName` above, applied to a currency instead so a message
 *  never has to hardcode a name-per-currency table. Falls back to the raw code if the runtime cannot
 *  resolve one. */
export function currencyName(language: string, code?: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([language, "en"], { type: "currency" }).of(code) ?? code
  } catch {
    return code
  }
}
