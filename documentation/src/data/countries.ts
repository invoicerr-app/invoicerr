export interface CountryInfo {
  name: string;
  flag: string;
}

// The product covers six countries (the 2026-09-10 five-country pivot, plus Algeria added by issue
// #558: see `documentation/compliance/README.md`). This list backs both the /compliance index page
// and the per-country routes the compliance-content-plugin generates from `documentation/compliance/
// <CC>-<Country>.md`: keep it in sync with which files exist there.
export const complianceCountries: Record<string, CountryInfo> = {
  DE: { name: 'Germany', flag: '🇩🇪' },
  DZ: { name: 'Algeria', flag: '🇩🇿' },
  FR: { name: 'France', flag: '🇫🇷' },
  IT: { name: 'Italy', flag: '🇮🇹' },
  PL: { name: 'Poland', flag: '🇵🇱' },
  PT: { name: 'Portugal', flag: '🇵🇹' },
};
