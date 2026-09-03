import { countriesWithLocalCancel, resolveCancelPolicyForCountry } from './cancel-policy';
import { defaultCorrectionRoutesCatalog } from './registry';

/**
 * TODO_CORRECTION.md C3 — the country-by-country cancel MAP pinned, contre le vrai catalogue
 * correction-routes (jamais mocké — cf. correction-routes.spec.ts's own discipline). C'est LE
 * livrable central de C3 : qui a `cancel` fondée, qui ne l'a pas, et l'inversion PL/MX (statut
 * "required" mais AUCUN mécanisme réel derrière).
 */
describe('resolveCancelPolicyForCountry — the per-country map', () => {
  it('FR, DE, US: unrestricted local cancel — allowed, no status narrowing', () => {
    for (const countryCode of ['FR', 'DE', 'US']) {
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

  it('MX: refused — CANCEL_AND_REPLACE is "required" too, but its own order names an authority-side cancellation step (SAT) this repo wires no channel for', () => {
    const decision = resolveCancelPolicyForCountry('MX');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/MX/);
    expect(decision.reason).toMatch(/cancelaci/i);
  });

  it('ES: refused — CANCEL_AND_REPLACE is plainly "forbidden"', () => {
    const decision = resolveCancelPolicyForCountry('ES');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/ES/);
  });

  it('the INVERSION this task turns on: PL and MX both declare CANCEL_AND_REPLACE "required", yet neither founds a local cancel — required is not implementable', () => {
    // The map's own most important, non-obvious fact: a route being LEGALLY REQUIRED never implies
    // it is LOCALLY IMPLEMENTABLE (see this file's own header). Read straight off the real catalog to
    // prove the premise, not asserted blind.
    for (const countryCode of ['PL', 'MX']) {
      const file = defaultCorrectionRoutesCatalog.fileFor(countryCode);
      expect(file).toBeDefined();
      const route = file!.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE');
      expect(route).toBeDefined();
      expect(route!.status).toBe('required');
    }
    expect(resolveCancelPolicyForCountry('PL').allowed).toBe(false);
    expect(resolveCancelPolicyForCountry('MX').allowed).toBe(false);
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

  it('countriesWithLocalCancel() enumerates exactly the four whitelisted countries — the map, pinned', () => {
    expect(new Set(countriesWithLocalCancel())).toEqual(new Set(['FR', 'DE', 'US', 'IT']));
  });
});
