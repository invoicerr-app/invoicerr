import { countriesWithLocalCancel, resolveCancelPolicyForCountry } from './cancel-policy';
import { defaultCorrectionRoutesCatalog } from './registry';

/**
 * The country-by-country cancel MAP pinned, contre le vrai catalogue
 * correction-routes (jamais mocké — cf. correction-routes.spec.ts's own discipline). C'est LE
 * livrable central : qui a `cancel` fondée, qui ne l'a pas, et l'inversion PL/MX (statut
 * "required" mais AUCUN mécanisme réel derrière).
 */
describe('resolveCancelPolicyForCountry — the per-country map', () => {
  // US used to ground this same conclusion a third way, but data/us.json was removed by the
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
  // "not implementable" shapes PL and PT alone now carry — but data/mx.json and data/es.json were
  // both removed by the 5-country prune (2026-09-10). PT re-anchors the "not whitelisted" refusal
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

  it('countriesWithLocalCancel() enumerates exactly the three whitelisted countries — the map, pinned', () => {
    expect(new Set(countriesWithLocalCancel())).toEqual(new Set(['FR', 'DE', 'IT']));
  });
});
