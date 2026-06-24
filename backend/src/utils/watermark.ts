// ISO 3166-1 alpha-2 country codes — keep in sync with frontend/src/lib/constants/countries.ts
// (the list backing the CountrySelect component).
const countryCodes = [
    "AF", "AL", "DZ", "AD", "AO", "AG", "AR", "AM", "AU", "AT",
    "AZ", "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BT",
    "BO", "BA", "BW", "BR", "BN", "BG", "BF", "BI", "CV", "KH",
    "CM", "CA", "CF", "TD", "CL", "CN", "CO", "KM", "CG", "CD",
    "CR", "CI", "HR", "CU", "CY", "CZ", "DK", "DJ", "DM", "DO",
    "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FJ", "FI",
    "FR", "GA", "GM", "GE", "DE", "GH", "GR", "GD", "GT", "GN",
    "GW", "GY", "HT", "HN", "HU", "IS", "IN", "ID", "IR", "IQ",
    "IE", "IL", "IT", "JM", "JP", "JO", "KZ", "KE", "KI", "KP",
    "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI",
    "LT", "LU", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MR",
    "MU", "MX", "FM", "MD", "MC", "MN", "ME", "MA", "MZ", "MM",
    "NA", "NR", "NP", "NL", "NZ", "NI", "NE", "NG", "MK", "NO",
    "OM", "PK", "PW", "PA", "PG", "PY", "PE", "PH", "PL", "PT",
    "QA", "RO", "RU", "RW", "KN", "LC", "VC", "WS", "SM", "ST",
    "SA", "SN", "RS", "SC", "SL", "SG", "SK", "SI", "SB", "SO",
    "ZA", "SS", "ES", "LK", "SD", "SR", "SE", "CH", "SY", "TJ",
    "TZ", "TH", "TL", "TG", "TO", "TT", "TN", "TR", "TM", "TV",
    "UG", "UA", "AE", "GB", "US", "UY", "UZ", "VU", "VA", "VE",
    "VN", "YE", "ZM", "ZW",
];

// Resolved against the same country list used by the frontend CountrySelect, since the saved
// Company.country value is a localized display name (e.g. "Germany"/"Allemagne"/"Deutschland")
// rather than an ISO code.
const RESOLVABLE_LOCALES = ['en', 'fr', 'de', 'es'];

const DRAFT_LABEL_BY_LANGUAGE: Record<string, string> = {
    fr: 'BROUILLON',
    de: 'ENTWURF',
    es: 'BORRADOR',
};

// Only countries whose main official language is one we have a translated word for.
const LANGUAGE_BY_COUNTRY_CODE: Record<string, string> = {
    FR: 'fr', MC: 'fr',
    DE: 'de', AT: 'de',
    ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es',
    EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es',
    SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es',
};

const resolveCountryCode = (country: string): string | null => {
    const normalized = country.trim().toLowerCase();
    for (const locale of RESOLVABLE_LOCALES) {
        const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
        const match = countryCodes.find((code) => displayNames.of(code)?.toLowerCase() === normalized);
        if (match) return match;
    }
    return null;
};

export const getDraftWatermarkLabel = (country?: string | null): string => {
    if (!country) return 'DRAFT';
    const code = resolveCountryCode(country);
    const language = code ? LANGUAGE_BY_COUNTRY_CODE[code] : undefined;
    return language ? DRAFT_LABEL_BY_LANGUAGE[language] : 'DRAFT';
};
