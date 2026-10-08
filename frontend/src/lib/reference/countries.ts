import { DOCUMENT_LANGUAGE_CODES } from "@/components/document-language-select"
import countries from "./countries.json"

export type DocumentLanguage = (typeof DOCUMENT_LANGUAGE_CODES)[number]

interface CountryReference {
  currency?: string
  documentLanguage?: string
}

const REFERENCE: Partial<Record<string, CountryReference>> = countries

function referenceFor(countryCode: string | null | undefined): CountryReference | undefined {
  const normalized = countryCode?.trim().toUpperCase()
  return normalized ? REFERENCE[normalized] : undefined
}

function isDocumentLanguage(language: string | undefined): language is DocumentLanguage {
  return DOCUMENT_LANGUAGE_CODES.some((code) => code === language)
}

/** ISO 4217 currency most invoices to or from this ISO 3166-1 alpha-2 country use. */
export function currencyForCountry(countryCode: string | null | undefined): string | undefined {
  return referenceFor(countryCode)?.currency
}

/** Document language to suggest for a new client in this country, if there is one clear choice. */
export function documentLanguageForCountry(
  countryCode: string | null | undefined,
): DocumentLanguage | undefined {
  const language = referenceFor(countryCode)?.documentLanguage
  return isDocumentLanguage(language) ? language : undefined
}
