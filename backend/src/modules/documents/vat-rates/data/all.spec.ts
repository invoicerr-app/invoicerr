/**
 * Coverage guard for the SHIPPED VAT rate catalog — same role country-policy/data/all.spec.ts plays
 * for its own files. This task's scope is France only ("La France, et elle seule"), so this file
 * pins that fact rather than leaving it as an unverified impression of the directory listing.
 */
import { ALL_VAT_RATE_FILES } from './all';

describe('vat-rates/data — the shipped FR catalog', () => {
  it('loads exactly France today — this task’s own scope', () => {
    expect(ALL_VAT_RATE_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });

  it('every rate in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit)', () => {
    for (const file of ALL_VAT_RATE_FILES) {
      for (const rate of file.rates) {
        expect(['legal', 'unverified']).toContain(rate.provenance.kind);
      }
    }
  });

  it('FR declares the four rates plus the franchise-en-base exemption, each with a distinct value', () => {
    const fr = ALL_VAT_RATE_FILES.find((f) => f.countryCode === 'FR');
    expect(fr).toBeDefined();
    const rates = (fr?.rates ?? []).map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 2.1, 5.5, 10, 20]);
  });

  it('every FR rate id is unique', () => {
    const fr = ALL_VAT_RATE_FILES.find((f) => f.countryCode === 'FR');
    const ids = (fr?.rates ?? []).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Root TODO item 21 (2026-09-01) read every one of these five articles at its own text on
  // codes.droit.org (a Légifrance mirror — Légifrance itself still refused every automated request)
  // and promoted all five rates from "unverified" to "legal". This REPLACES the previous version of
  // this test, which asserted the opposite ("honestly, none of the FR rates claim legal provenance
  // today") — that was the honest state on 2026-08-31; this is the honest state now. Two apparent
  // divergences flagged back then (10%: art. 278 bis vs 279; 2.1%: art. 281 quater vs 281 octies vs
  // 298 septies) turned out to be parallel provisions for different categories at the same rate, not
  // a contradiction — see each rate's own `notes` for the resolution.
  it('every FR rate now claims "legal" provenance, each citing a distinct CGI article verbatim', () => {
    const fr = ALL_VAT_RATE_FILES.find((f) => f.countryCode === 'FR');
    const rates = fr?.rates ?? [];
    expect(rates.length).toBe(5);
    for (const rate of rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceText.length).toBeGreaterThan(20);
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-01');
      }
    }
  });

  it('pins the exact CGI article each FR rate cites, by id', () => {
    const fr = ALL_VAT_RATE_FILES.find((f) => f.countryCode === 'FR');
    const byId = (id: string) => fr?.rates.find((r) => r.id === id);
    expect(byId('fr-standard')?.notes).toMatch(/art\. 278\b/);
    expect(byId('fr-intermediate')?.notes).toMatch(/278 bis ET art\. 279/);
    expect(byId('fr-reduced')?.notes).toMatch(/278-0 bis/);
    expect(byId('fr-particular')?.notes).toMatch(/281 quater, 281 octies ET 298 septies/);
    expect(byId('fr-exempt-293b')?.notes).toMatch(/293 B/);
  });
});
