import { ISO_COUNTRIES, ISO_COUNTRY_CODES } from './iso-countries';

describe('ISO_COUNTRIES', () => {
  it('loads (well) more than the ~40-country union the registry used to enumerate', () => {
    expect(ISO_COUNTRIES.length).toBeGreaterThanOrEqual(240);
    expect(ISO_COUNTRY_CODES.length).toBe(ISO_COUNTRIES.length);
  });

  it('has unique, well-formed alpha-2 codes', () => {
    const codes = ISO_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('carries a non-empty English name for every code', () => {
    for (const country of ISO_COUNTRIES) {
      expect(country.name.length).toBeGreaterThan(0);
    }
  });

  it('includes the countries the rest of the backend already assumes exist', () => {
    const codes = new Set(ISO_COUNTRY_CODES);
    // Primary markets, the biggest no-dedicated-register gaps, and TV which has no provider at all.
    for (const cc of ['FR', 'PL', 'IT', 'US', 'DE', 'GB', 'TW', 'LI', 'TV']) {
      expect(codes.has(cc)).toBe(true);
    }
  });
});
