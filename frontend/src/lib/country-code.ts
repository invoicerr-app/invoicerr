import { countryCodes } from "@/lib/constants/countries"

// Resolved against the same country list used by CountrySelect (frontend/src/components/country-select.tsx),
// since the saved Company.country value is a localized display name (e.g. "Germany"/"Allemagne"/"Deutschland")
// rather than an ISO code.
const RESOLVABLE_LOCALES = ["en", "fr", "de", "es"]

export const resolveCountryCode = (country: string): string | null => {
  const normalized = country.trim().toLowerCase()
  for (const locale of RESOLVABLE_LOCALES) {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" })
    const match = countryCodes.find((code) => displayNames.of(code)?.toLowerCase() === normalized)
    if (match) return match
  }
  return null
}
