/**
 * Coverage guard for the SHIPPED VAT rate catalog — same role country-policy/data/all.spec.ts plays
 * for its own files. The shipped scope is pinned here as a fact rather than left as an unverified
 * impression of the directory listing.
 */
import { ALL_VAT_RATE_FILES } from './all';

describe('vat-rates/data — the shipped DE/FR/IT/PL/PT catalog', () => {
  // Re-pinned by the 5-country prune (2026-09-10): every lot-1/lot-2 country (BE/NL/AT/EE/GR/CY/…)
  // was `git rm`'d along with its data/xx.json, leaving only the 5 kept countries as CANDIDATES —
  // FR and PT already had a vat-rates file at that point, while DE/PL/IT temporarily had none (their
  // standard rate was derived from tax-systems/ instead, see tax-systems/schema.ts's own header).
  // RE-PINNED AGAIN (2026-09-13): DE/IT/PL each gained a real `data/xx.json`, sourced to primary law
  // (UStG § 12 for DE, DPR 633/1972 art. 16 + Tabella A for IT, ustawa o VAT art. 41/146ef for PL —
  // see each file's own `notes` and data/de.spec.ts / data/it.spec.ts / data/pl.spec.ts for the
  // content pins), so this mechanism now ships all 5 kept countries. tax-systems/'s own DE/IT/PL
  // facts keep their EXPLICIT `standardRate` regardless (see tax-systems/registry.ts#toTaxSystemSpec:
  // an explicit rate always wins over a derived one), so this addition changes nothing there — it
  // only populates the vat-rates dropdown these three countries lacked until now.
  it('loads exactly DE, DZ, FR, IT, PL and PT', () => {
    expect(ALL_VAT_RATE_FILES.map((f) => f.countryCode).sort()).toEqual(['DE', 'DZ', 'FR', 'IT', 'PL', 'PT']);
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

  // The 2026-09-01 legal verification read every one of these five articles at its own text on
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
    expect(byId('fr-intermediate')?.notes).toMatch(/278 bis AND art\. 279/);
    expect(byId('fr-reduced')?.notes).toMatch(/278-0 bis/);
    expect(byId('fr-particular')?.notes).toMatch(/281 quater, 281 octies AND 298 septies/);
    expect(byId('fr-exempt-293b')?.notes).toMatch(/293 B/);
  });
});

// BE's own vat-rates data file was removed by the 5-country prune (2026-09-10)
// along with every other country outside FR/PL/IT/PT/DE — it was never
// registered in data/all.ts to begin with, so nothing here re-anchors it. DE/IT/PL/PT's own content
// is pinned instead by this same directory's dedicated data/de.spec.ts, data/it.spec.ts,
// data/pl.spec.ts and data/pt.spec.ts — only FR's content stays pinned inline above.

// The "drop-in invariant" that used to live here (re-reading this directory's own `*.json` listing
// against `ALL_VAT_RATE_FILES`) tested a mechanism that moved: `data/all.ts` no longer reads this
// directory at all (issue #603 step 6) - it derives from `defaultComposedCountryCatalog`, which
// itself is discovered from `countries/data/*.json`. The equivalent proof now lives in
// `countries/data/all.spec.ts`.
