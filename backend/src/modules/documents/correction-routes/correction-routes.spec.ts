import { resolveCorrectionRoutesForCountry } from './correction-routes';

describe('resolveCorrectionRoutesForCountry', () => {
  it('returns undefined for an unresolved (empty/undefined/null) country code', () => {
    expect(resolveCorrectionRoutesForCountry(undefined)).toBeUndefined();
    expect(resolveCorrectionRoutesForCountry(null)).toBeUndefined();
    expect(resolveCorrectionRoutesForCountry('')).toBeUndefined();
    expect(resolveCorrectionRoutesForCountry('   ')).toBeUndefined();
  });

  it('returns undefined for a country with no shipped file — the honest-refusal case a caller turns into a NAMED 404', () => {
    // JP has never had a correction-routes file — a clean "not covered" stand-in (BE's own file,
    // added in lot 1, was later removed by the 5-country prune, 2026-09-10, so it would work too).
    expect(resolveCorrectionRoutesForCountry('JP')).toBeUndefined();
  });

  it('is case-insensitive on the country code, same convention as every other country-is-data catalog here', () => {
    expect(resolveCorrectionRoutesForCountry('fr')).toBeDefined();
    expect(resolveCorrectionRoutesForCountry('Fr')).toBeDefined();
  });

  it('FR: INTERNAL_CREDIT_NOTE is required, its label is the verbatim legal citation, and it is the one route this repo implements', () => {
    const decision = resolveCorrectionRoutesForCountry('FR')!;
    expect(decision.countryCode).toBe('FR');
    const route = decision.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(route.status).toBe('required');
    expect(route.implemented).toBe(true);
    // Verbatim citation, never a summary — the exact quote fr.json carries.
    expect(route.label).toContain('annulation comptable (avoir interne)');
    expect(route.label).toContain('checked 2026-08-29');
  });

  it('PL: INTERNAL_CREDIT_NOTE is forbidden — the canonical FR/PL inversion, visible at the read side too', () => {
    const decision = resolveCorrectionRoutesForCountry('PL')!;
    const route = decision.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(route.status).toBe('forbidden');
    // Still not implemented for Poland — "implemented" reflects what THIS REPO built, never a
    // country's own status; a forbidden route is never wired regardless.
    expect(route.implemented).toBe(true);
  });

  it('an unverified route carries a plain "unverified — <note>" label, never a fabricated citation', () => {
    const decision = resolveCorrectionRoutesForCountry('FR')!;
    const route = decision.routes.find((r) => r.routeId === 'COUNTERPARTY_OBJECTION')!;
    expect(route.status).toBe('unverified');
    expect(route.label).toMatch(/^unverified — /);
  });

  it('every route across all five shipped countries is implemented=false EXCEPT INTERNAL_CREDIT_NOTE (always) and CANCEL_AND_REPLACE (country-aware) — the hard, honest mapping', () => {
    // FR/DE ground an unrestricted local cancel, IT a narrower one (see cancel-policy.ts's own
    // header) — PL/PT do NOT, despite PL declaring CANCEL_AND_REPLACE `required` (the exact nuance
    // cancel-policy.ts's whitelist exists to hold). (ES/MX/US used to widen this same set — all three
    // removed by the 5-country prune, 2026-09-10.)
    const localCancelCountries = new Set(['FR', 'DE', 'IT']);
    for (const countryCode of ['FR', 'IT', 'PL', 'DE', 'PT']) {
      const decision = resolveCorrectionRoutesForCountry(countryCode)!;
      for (const route of decision.routes) {
        if (route.routeId === 'INTERNAL_CREDIT_NOTE') {
          expect(route.implemented).toBe(true);
        } else if (route.routeId === 'CANCEL_AND_REPLACE') {
          expect(route.implemented).toBe(localCancelCountries.has(countryCode));
        } else {
          expect(route.implemented).toBe(false);
        }
      }
    }
  });

  it('CANCEL_AND_REPLACE is implemented for FR/DE/IT (a real local cancel), never for PL/PT (declared, but no real mechanism founds it)', () => {
    for (const countryCode of ['FR', 'DE', 'IT']) {
      const decision = resolveCorrectionRoutesForCountry(countryCode)!;
      const route = decision.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
      expect(route.implemented).toBe(true);
    }
    for (const countryCode of ['PL', 'PT']) {
      const decision = resolveCorrectionRoutesForCountry(countryCode)!;
      const route = decision.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
      expect(route.implemented).toBe(false);
    }
  });

  it('always carries the seller-only "limitation" text naming the unwritten seller×buyer composition', () => {
    const decision = resolveCorrectionRoutesForCountry('FR')!;
    expect(decision.limitation).toMatch(/seller/i);
    expect(decision.limitation).toMatch(/buyer/i);
  });
});
