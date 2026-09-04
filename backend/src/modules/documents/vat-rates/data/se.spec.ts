/**
 * SE — direct-load content spec, added by the SE country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as vat-rates/data/lv.spec.ts: reads `se.json` straight off disk rather than through
 * `data/all.ts` (still AT/BE/FR/NL/EE/GR/CY/LV/LU only — wiring "se" in is a mandataire decision), and
 * re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadSe(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'se.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('SE — vat-rates/data/se.json', () => {
  const se = loadSe();

  it('declares countryCode SE with exactly four entries — 25 / 12 / 6 / 0 (exempt) — every one "legal"', () => {
    expect(se.countryCode).toBe('SE');
    const rates = se.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 6, 12, 25]);
    for (const rate of se.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of se.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'se.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 25% (Mervärdesskattelag 9 kap. 2 §, read from the currently-in-force primary text) — consistent with tax-systems/data/se.json's own TEDB citation, no discrepancy", () => {
    const standard = se.rates.find((r) => r.id === 'se-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/25 procent/);
    }
    expect(standard.notes).toMatch(/2028-01-01/);
  });

  it('pins each reduced rate to its own 9 kap. sub-provision, by id — never one generic citation reused', () => {
    const byId = (id: string) => se.rates.find((r) => r.id === id)!;

    const r12 = byId('se-reduced-12');
    expect(r12.category).toBe('REDUCED');
    if (r12.provenance.kind === 'legal') {
      expect(r12.provenance.sourceText).toMatch(/12 procent/);
      expect(r12.provenance.sourceText).toMatch(/hotellrörelse/);
    }

    const r6 = byId('se-reduced-6');
    expect(r6.category).toBe('SUPER_REDUCED');
    if (r6.provenance.kind === 'legal') {
      expect(r6.provenance.sourceText).toMatch(/6 procent/);
      expect(r6.provenance.sourceText).toMatch(/persontransporttjänster/);
    }

    const texts = [r12, r6].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(2);
  });

  it("se-reduced-6's note flags the ALREADY-LEGISLATED future food-rate change (6% -> 12% on 2028-01-01, Lag 2026:119) without applying it early", () => {
    const r6 = se.rates.find((r) => r.id === 'se-reduced-6')!;
    expect(r6.notes).toMatch(/2028-01-01/);
    expect(r6.notes).toMatch(/Livsmedel|livsmedel/);
    expect(r6.rate).toBe(6); // still the CURRENTLY in-force rate, not the future 12%
  });

  it("se-exempt-18kap composes the 120,000 SEK small-business threshold (18 kap. 4 §) with the no-VAT-on-invoice rule (18 kap. 41 §), cross-referencing country-identifiers/data/se.json's own VAT.required=false", () => {
    const exempt = se.rates.find((r) => r.id === 'se-exempt-18kap')!;
    expect(exempt.category).toBe('EXEMPT');
    expect(exempt.rate).toBe(0);
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/120 000 kronor/);
      expect(exempt.provenance.sourceText).toMatch(/mervärdesskatt inte anges i fakturan/);
    }
  });

  it('no ZERO-category rate is modeled — the file-level notes explain the export exemption is structurally distinct (no explicit "0 procent" clause found in kap. 9)', () => {
    const zeroRates = se.rates.filter((r) => r.category === 'ZERO');
    expect(zeroRates.length).toBe(0);
    expect(se.notes).toMatch(/noll procent|0 procent/);
  });

  it('every rate id is unique', () => {
    const ids = se.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("12% is classified REDUCED and 6% SUPER_REDUCED — the higher of Sweden's two non-standard rates ranks above the lower one, same convention as lv.json/at.json", () => {
    const r12 = se.rates.find((r) => r.id === 'se-reduced-12')!;
    const r6 = se.rates.find((r) => r.id === 'se-reduced-6')!;
    expect(r12.rate).toBeGreaterThan(r6.rate);
    expect(r12.category).toBe('REDUCED');
    expect(r6.category).toBe('SUPER_REDUCED');
  });
});
