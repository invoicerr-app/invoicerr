export interface CountryInfo {
  name: string;
  flag: string;
}

// The product covers exactly five countries (the 2026-09-10 five-country pivot — see
// `documentation/compliance/README.md`). This list backs both the /compliance index page and the
// per-country routes the compliance-content-plugin generates from `documentation/compliance/
// <CC>-<Country>.md` — keep it in sync with which files exist there.
export const complianceCountries: Record<string, CountryInfo> = {
  DE: { name: 'Germany', flag: '🇩🇪' },
  FR: { name: 'France', flag: '🇫🇷' },
  IT: { name: 'Italy', flag: '🇮🇹' },
  PL: { name: 'Poland', flag: '🇵🇱' },
  PT: { name: 'Portugal', flag: '🇵🇹' },
};
