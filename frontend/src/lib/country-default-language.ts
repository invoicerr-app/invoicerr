import type { DOCUMENT_LANGUAGE_CODES } from "@/components/document-language-select"

export type CountryDefaultLanguage = (typeof DOCUMENT_LANGUAGE_CODES)[number]

/**
 * ISO 3166-1 alpha-2 → the language a brand-new client from that country is most likely to want
 * their documents in. Read exactly ONCE, at client CREATION, to pre-fill `Client.language` with a
 * SUGGESTION the user can freely overwrite — never at send time, and never for an existing client
 * (see `Client.language`'s own schema comment in `schema.prisma`: a country names a jurisdiction,
 * not a language, and a silent guess there is worse than the English fallback that field's own
 * absence already falls back to). A pre-fill carries none of that risk precisely because it is a
 * starting point, not a decision made on the user's behalf.
 *
 * A country is deliberately absent (or present with `undefined`) for one of two reasons:
 *  - it has no single dominant language at all — Belgium (fr/nl/de), Switzerland (de/fr/it/rm) —
 *    so ANY single suggestion here would be exactly the kind of guess this whole feature exists to
 *    avoid;
 *  - its dominant language is real but outside `DOCUMENT_LANGUAGE_CODES` (the render layer has no
 *    chrome/email translations for it) — suggesting it would suggest a choice that silently falls
 *    back to English at render time anyway, which is worse than suggesting nothing.
 * Both read identically to a caller: no suggestion, the field stays whatever it already was.
 */
const COUNTRY_DEFAULT_LANGUAGE: Partial<Record<string, CountryDefaultLanguage>> = {
  // The five countries this product targets.
  FR: "fr",
  PL: "pl",
  IT: "it",
  PT: "pt",
  DE: "de",

  // Other countries with one unambiguous (business) language among the supported set.
  AT: "de", // Austria
  LI: "de", // Liechtenstein
  LU: "fr", // Luxembourg is trilingual (fr/de/lb), but French is the administrative/business language
  MC: "fr", // Monaco
  SM: "it", // San Marino
  VA: "it", // Vatican City
  BR: "pt", // Brazil
  AO: "pt", // Angola
  MZ: "pt", // Mozambique
  CV: "pt", // Cabo Verde
  GW: "pt", // Guinea-Bissau
  ST: "pt", // São Tomé and Príncipe
  TL: "pt", // Timor-Leste — Portuguese is co-official; the other (Tetum) isn't a render language here
  GB: "en",
  IE: "en",
  US: "en",
  CA: "en", // English, despite Quebec — one "evident" pick, not a claim Canada has a single language
  AU: "en",
  NZ: "en",

  // Explicitly ambiguous — see this file's own header. Listed so "no suggestion" reads as a
  // researched decision rather than a gap nobody noticed.
  BE: undefined,
  CH: undefined,
}

// Alpha-2 spellings seen in the wild that aren't the ISO code itself.
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  UK: "GB",
}

/**
 * `undefined` means "no suggestion" — either the country is unknown to this table, genuinely
 * ambiguous, or its language isn't one this product renders. Callers must treat that exactly like
 * "nothing to suggest", never like an error.
 */
export function getDefaultLanguageForCountry(
  countryCode: string | null | undefined,
): CountryDefaultLanguage | undefined {
  if (!countryCode) return undefined
  const normalized = countryCode.trim().toUpperCase()
  if (!normalized) return undefined
  const resolved = COUNTRY_CODE_ALIASES[normalized] ?? normalized
  return COUNTRY_DEFAULT_LANGUAGE[resolved]
}
