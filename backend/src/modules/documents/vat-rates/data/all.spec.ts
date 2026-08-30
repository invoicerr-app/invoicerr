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

  it('honestly, none of the FR rates claim "legal" provenance today — each is corroborated, not quoted from the statute text itself (see fr.json’s own header)', () => {
    const fr = ALL_VAT_RATE_FILES.find((f) => f.countryCode === 'FR');
    const legal = (fr?.rates ?? []).filter((r) => r.provenance.kind === 'legal');
    expect(legal).toEqual([]);
  });
});
