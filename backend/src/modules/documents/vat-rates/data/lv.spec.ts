/**
 * LV — direct-load content spec, added by the LV country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as vat-rates/data/ee.spec.ts: reads `lv.json` straight off disk rather than through
 * `data/all.ts` (still AT/BE/FR/NL/EE/GR/CY only — wiring "lv" in is a mandataire decision), and
 * re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadLv(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'lv.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('LV — vat-rates/data/lv.json', () => {
  const lv = loadLv();

  it('declares countryCode LV with exactly four rates — 21 / 12 / 5 / 0 — every one "legal"', () => {
    expect(lv.countryCode).toBe('LV');
    const rates = lv.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 5, 12, 21]);
    for (const rate of lv.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of lv.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'lv.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 21% (Value Added Tax Law art. 41(1)(1), read from the primary text) — consistent with tax-systems/data/lv.json's own TEDB citation of the same article, no discrepancy this time", () => {
    const standard = lv.rates.find((r) => r.id === 'lv-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/21 per cent/);
    }
    expect(standard.notes).toMatch(/Section 41, Paragraph 1, Clause 1/);
  });

  it('pins each reduced/zero rate to its own art. 42/43 sub-provision, by id — never one generic citation reused', () => {
    const byId = (id: string) => lv.rates.find((r) => r.id === id)!;

    const r12 = byId('lv-reduced-12');
    expect(r12.category).toBe('REDUCED');
    if (r12.provenance.kind === 'legal') {
      expect(r12.provenance.sourceText).toMatch(/12 per cent/);
      expect(r12.provenance.sourceText).toMatch(/accommodation/);
    }

    const r5 = byId('lv-reduced-5');
    expect(r5.category).toBe('SUPER_REDUCED');
    if (r5.provenance.kind === 'legal') {
      expect(r5.provenance.sourceText).toMatch(/five per cent/);
      expect(r5.provenance.sourceText).toMatch(/books/);
    }

    const zero = byId('lv-zero');
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/zero per cent/);
      expect(zero.provenance.sourceText).toMatch(/exportation of goods/);
    }

    const texts = [r12, r5, zero].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(3);
  });

  it('every rate id is unique', () => {
    const ids = lv.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("12% is classified REDUCED and 5% SUPER_REDUCED — the higher of Latvia's two non-standard rates ranks above the lower one, same convention as at.json/ee.json", () => {
    const r12 = lv.rates.find((r) => r.id === 'lv-reduced-12')!;
    const r5 = lv.rates.find((r) => r.id === 'lv-reduced-5')!;
    expect(r12.rate).toBeGreaterThan(r5.rate);
    expect(r12.category).toBe('REDUCED');
    expect(r5.category).toBe('SUPER_REDUCED');
  });
});
