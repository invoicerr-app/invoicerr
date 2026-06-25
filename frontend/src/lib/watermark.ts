import { countryCodes } from "@/lib/constants/countries"

// Resolved against the same country list used by CountrySelect (frontend/src/components/country-select.tsx),
// since the saved Company.country value is a localized display name (e.g. "Germany"/"Allemagne"/"Deutschland")
// rather than an ISO code.
const RESOLVABLE_LOCALES = ["en", "fr", "de", "es"]

const DRAFT_LABEL_BY_LANGUAGE: Record<string, string> = {
    fr: "BROUILLON",
    de: "ENTWURF",
    es: "BORRADOR",
}

// Only countries whose main official language is one we have a translated word for.
const LANGUAGE_BY_COUNTRY_CODE: Record<string, string> = {
    FR: "fr", MC: "fr",
    DE: "de", AT: "de",
    ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
    EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
    SV: "es", NI: "es", CR: "es", PA: "es", UY: "es",
}

const resolveCountryCode = (country: string): string | null => {
    const normalized = country.trim().toLowerCase()
    for (const locale of RESOLVABLE_LOCALES) {
        const displayNames = new Intl.DisplayNames([locale], { type: "region" })
        const match = countryCodes.find((code) => displayNames.of(code)?.toLowerCase() === normalized)
        if (match) return match
    }
    return null
}

export const getDraftWatermarkLabel = (country?: string | null): string => {
    if (!country) return "DRAFT"
    const code = resolveCountryCode(country)
    const language = code ? LANGUAGE_BY_COUNTRY_CODE[code] : undefined
    return language ? DRAFT_LABEL_BY_LANGUAGE[language] : "DRAFT"
}
