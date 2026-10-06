import { countriesWithLocalCancel, resolveCancelPolicyForCountry } from './cancel-policy';
import { defaultCorrectionRoutesCatalog } from './registry';

/**
 * The country-by-country cancel MAP pinned against the real correction-routes catalog (never
 * mocked — see correction-routes.spec.ts's own discipline). This is THE central deliverable: who
 * has `cancel` grounded, who doesn't, and the PL/MX inversion (status "required" but NO real
 * mechanism behind it).
 */
describe('resolveCancelPolicyForCountry — the per-country map', () => {
  // US used to ground this same conclusion a third way, but its own data file was removed by the
  // 5-country prune (2026-09-10) — see cancel-policy.ts's own header.
  it('FR, DE: unrestricted local cancel — allowed, no status narrowing', () => {
    for (const countryCode of ['FR', 'DE']) {
      expect(resolveCancelPolicyForCountry(countryCode)).toEqual({ allowed: true });
    }
  });

  it('IT: local cancel allowed, but NARROWED to "send_failed" (post-scarto only, per data/it.json)', () => {
    expect(resolveCancelPolicyForCountry('IT')).toEqual({
      allowed: true,
      restrictedToStatuses: ['send_failed'],
    });
  });

  it('PL: refused — CANCEL_AND_REPLACE is "required" by data/pl.json, but its own notes say the route is executed only through corrective invoices, never an annulation mechanism', () => {
    const decision = resolveCancelPolicyForCountry('PL');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/PL/);
    // Cites the ROUTE's own words (its sourceText), never an invented explanation.
    expect(decision.reason).toMatch(/faktur/i);
  });

  // MX ('required', authority-side SAT step) and ES ('forbidden') both illustrated the same two
  // "not implementable" shapes PL and PT alone now carry — but both countries' own data files were
  // removed by the 5-country prune (2026-09-10). PT re-anchors the "not whitelisted" refusal
  // below, sourced this time on a genuine structural absence rather than an authority step.
  it('PT: refused — CANCEL_AND_REPLACE stays honestly "unverified", no clearance/refusal-then-reissue mechanism was found', () => {
    const decision = resolveCancelPolicyForCountry('PT');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/PT/);
    expect(decision.reason).toMatch(/clearance/i);
  });

  it('the INVERSION: PL declares CANCEL_AND_REPLACE "required", yet does not found a local cancel — required is not implementable', () => {
    // The map's own most important, non-obvious fact: a route being LEGALLY REQUIRED never implies
    // it is LOCALLY IMPLEMENTABLE (see this file's own header). Read straight off the real catalog to
    // prove the premise, not asserted blind. (MX used to illustrate the same inversion a second way —
    // removed by the 5-country prune, 2026-09-10 — PL alone proves the point.)
    const file = defaultCorrectionRoutesCatalog.fileFor('PL');
    expect(file).toBeDefined();
    const route = file!.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE');
    expect(route).toBeDefined();
    expect(route!.status).toBe('required');
    expect(resolveCancelPolicyForCountry('PL').allowed).toBe(false);
  });

  it('a country with no correction-routes file at all is refused, named, never a silent default', () => {
    const decision = resolveCancelPolicyForCountry('BE');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/BE/);
  });

  it('an unresolved (empty/undefined/null) country code is refused, named', () => {
    for (const value of [undefined, null, '', '   ']) {
      const decision = resolveCancelPolicyForCountry(value);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBeDefined();
    }
  });

  it('is case-insensitive on the country code, same convention as every other country-is-data catalog here', () => {
    expect(resolveCancelPolicyForCountry('fr')).toEqual({ allowed: true });
    expect(resolveCancelPolicyForCountry('Fr')).toEqual({ allowed: true });
  });

  it('countriesWithLocalCancel() enumerates exactly the countries whose data founds a local cancel', () => {
    expect(countriesWithLocalCancel()).toEqual(['DE', 'FR', 'IT']);
  });
});

/** The table this module used to hard-code, kept as test data: the data-driven resolver must give
 *  the exact same decision for every input the old one was ever asked about. */
const LEGACY_CANCEL_TABLE: Record<string, { expectedStatus: string; restrictedToStatuses?: string[] }> = {
  FR: { expectedStatus: 'allowed' },
  DE: { expectedStatus: 'allowed' },
  IT: { expectedStatus: 'allowed', restrictedToStatuses: ['send_failed'] },
};

function legacyDecision(countryCode: string | undefined | null): {
  allowed: boolean;
  restrictedToStatuses?: string[];
} {
  const resolved = (countryCode ?? '').trim().toUpperCase();
  const route = resolved
    ? defaultCorrectionRoutesCatalog.fileFor(resolved)?.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')
    : undefined;
  const entry = LEGACY_CANCEL_TABLE[resolved];
  if (!route || !entry) return { allowed: false };
  if (route.status !== entry.expectedStatus) throw new Error(`legacy table drifted for ${resolved}`);
  return entry.restrictedToStatuses
    ? { allowed: true, restrictedToStatuses: entry.restrictedToStatuses }
    : { allowed: true };
}

function decisionWithoutReason(countryCode: string | undefined | null) {
  const { reason, ...rest } = resolveCancelPolicyForCountry(countryCode);
  return { decision: rest, hasReason: reason !== undefined };
}

describe('resolveCancelPolicyForCountry: same decisions as the legacy hard-coded table', () => {
  const registryCountries = defaultCorrectionRoutesCatalog.countries();
  const inputs: Array<string | undefined | null> = [
    ...registryCountries,
    ...registryCountries.map((countryCode) => countryCode.toLowerCase()),
    'BE',
    'XX',
    '',
    '   ',
    undefined,
    null,
  ];

  it('covers every country the registry knows', () => {
    expect(registryCountries.length).toBeGreaterThan(0);
    expect(registryCountries).toEqual(expect.arrayContaining(Object.keys(LEGACY_CANCEL_TABLE)));
  });

  it.each(inputs.map((input) => [String(input), input]))('%s', (_label, input) => {
    const expected = legacyDecision(input);
    const { decision, hasReason } = decisionWithoutReason(input);
    expect(decision).toEqual(expected);
    expect(hasReason).toBe(!expected.allowed);
  });

  it('enumerates the same countries as the legacy table', () => {
    expect(countriesWithLocalCancel()).toEqual(Object.keys(LEGACY_CANCEL_TABLE).sort());
  });
});
