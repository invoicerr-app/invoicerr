/**
 * CZ — direct-load content spec, added by the CZ country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as vat-rates/data/ie.spec.ts: reads `cz.json` straight off disk rather than through
 * `data/all.ts` (wiring "cz" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadCz(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'cz.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('CZ — vat-rates/data/cz.json', () => {
  const cz = loadCz();

  it('declares countryCode CZ with exactly two entries — 21 / 12 — both "legal"', () => {
    expect(cz.countryCode).toBe('CZ');
    const rates = cz.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([12, 21]);
    for (const rate of cz.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of cz.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'cz.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 21% (ZDPH § 47 odst. 1 písm. a)) — consistent with tax-systems/data/cz.json's own TEDB citation, no discrepancy", () => {
    const standard = cz.rates.find((r) => r.id === 'cz-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe(
        'U zdanitelného plnění nebo přijaté úplaty se uplatňuje a) základní sazba daně ve výši 21 %, ' +
          'nebo b) snížená sazba daně ve výši 12 %.',
      );
    }
  });

  it('pins the reduced rate to 12% (ZDPH § 47 odst. 1 písm. b)) — the SAME two-branch enumeration as the standard rate, one citation covering both', () => {
    const reduced = cz.rates.find((r) => r.id === 'cz-reduced-12')!;
    const standard = cz.rates.find((r) => r.id === 'cz-standard')!;
    expect(reduced.rate).toBe(12);
    expect(reduced.category).toBe('REDUCED');
    expect(reduced.provenance.kind).toBe('legal');
    expect(standard.provenance.kind).toBe('legal');
    if (reduced.provenance.kind === 'legal' && standard.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toBe(standard.provenance.sourceText);
      expect(reduced.provenance.sourceText).toMatch(/snížená sazba daně ve výši 12 %/);
    }
  });

  it('the reduced-rate note documents the 2024 MERGER of the former two reduced rates (15% / 10%) into the single current 12% — the headline this brief asked for, read from the CURRENT consolidated text, never from memory of the old regime', () => {
    const reduced = cz.rates.find((r) => r.id === 'cz-reduced-12')!;
    expect(reduced.notes).toMatch(/15 %/);
    expect(reduced.notes).toMatch(/10 %/);
    expect(reduced.notes).toMatch(/349\/2023/);
    expect(reduced.notes).toMatch(/1\.01\.2024|1er janvier 2024/);
    expect(reduced.notes).not.toMatch(/15 % s'applique aujourd'hui/);
  });

  it('no ZERO-category rate is modeled — ZDPH uses "osvobození od daně s nárokem na odpočet daně" (exemption with credit) for exports, never a numeric "0 %"/"nulová sazba" in the passages read, same honest omission as se.json/mt.json', () => {
    const zero = cz.rates.find((r) => r.category === 'ZERO');
    expect(zero).toBeUndefined();
    expect(cz.notes).toMatch(/osvobození od daně s nárokem na odpočet daně/);
  });

  it('every rate id is unique', () => {
    const ids = cz.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the file-level notes cross-check tax-systems/data/cz.json (TEDB, standardRate 21, situationOn 2026/07/01) with no discrepancy reported', () => {
    expect(cz.notes).toMatch(/tax-systems\/data\/cz\.json/);
    expect(cz.notes).toMatch(/AUCUNE DIVERGENCE/);
  });
});
