/**
 * HR — direct-load content spec, added by the HR country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as vat-rates/data/ee.spec.ts: reads `hr.json` straight off disk rather than through
 * `data/all.ts` (wiring "hr" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadHr(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'hr.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('HR — vat-rates/data/hr.json', () => {
  const hr = loadHr();

  it('declares countryCode HR with exactly four rates — 25 / 13 / 5 / 0 — every one "legal"', () => {
    expect(hr.countryCode).toBe('HR');
    const rates = hr.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 5, 13, 25]);
    for (const rate of hr.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of hr.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'hr.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 25% (ZPDV čl. 38 st. 1) with no discrepancy against tax-systems/data/hr.json's own TEDB-sourced value", () => {
    const standard = hr.rates.find((r) => r.id === 'hr-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe('PDV se obračunava i plaća po stopi od 25%.');
    }
    expect(standard.notes).toMatch(/PAS DE DIVERGENCE/);
  });

  it('pins each reduced/zero rate to its own čl. 38 sub-provision, by id — never one generic citation reused', () => {
    const byId = (id: string) => hr.rates.find((r) => r.id === id)!;

    const r13 = byId('hr-reduced-13');
    expect(r13.category).toBe('REDUCED');
    if (r13.provenance.kind === 'legal') {
      expect(r13.provenance.sourceText).toMatch(/13%/);
      expect(r13.provenance.sourceText).toMatch(/smještaja/);
    }

    const r5 = byId('hr-reduced-5');
    expect(r5.category).toBe('SUPER_REDUCED');
    if (r5.provenance.kind === 'legal') {
      expect(r5.provenance.sourceText).toMatch(/5%/);
      expect(r5.provenance.sourceText).toMatch(/kruha/);
    }

    const zero = byId('hr-zero');
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/0%/);
      expect(zero.provenance.sourceText).toMatch(/solarnih ploča/);
    }

    const texts = [r13, r5, zero].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(3);
  });

  it('every rate id is unique', () => {
    const ids = hr.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("13% is classified REDUCED and 5% SUPER_REDUCED — the higher of Croatia's two non-standard rates ranks above the lower one, same convention as ee.json/at.json", () => {
    const r13 = hr.rates.find((r) => r.id === 'hr-reduced-13')!;
    const r5 = hr.rates.find((r) => r.id === 'hr-reduced-5')!;
    expect(r13.rate).toBeGreaterThan(r5.rate);
    expect(r13.category).toBe('REDUCED');
    expect(r5.category).toBe('SUPER_REDUCED');
  });

  it('the zero rate is a narrow incentive rate (solar panels), not a general export/intra-EU zero-rating — documented honestly rather than assumed', () => {
    const zero = hr.rates.find((r) => r.id === 'hr-zero')!;
    expect(zero.notes).toMatch(/PARTICULARITÉ CROATE/);
    expect(zero.notes).toMatch(/PAS un régime général d'exportation/);
  });

  it('the expired temporary 5% gas/heating window (čl. 38 st. 4-5, until 31 March 2026) is documented but not modeled as a live rate', () => {
    const r13 = hr.rates.find((r) => r.id === 'hr-reduced-13')!;
    expect(r13.notes).toMatch(/31 mars 2026/);
    expect(r13.notes).toMatch(/ÉCHUE/);
  });
});
