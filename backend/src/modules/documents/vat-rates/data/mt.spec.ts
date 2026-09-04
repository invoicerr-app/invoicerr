/**
 * MT — direct-load content spec, added by the MT country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as vat-rates/data/lv.spec.ts: reads `mt.json` straight off disk rather than through
 * `data/all.ts` (still AT/BE/FR/NL/EE/GR/CY/LV/LU only — wiring "mt" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadMt(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'mt.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('MT — vat-rates/data/mt.json', () => {
  const mt = loadMt();

  it('declares countryCode MT with exactly four rates — 18 / 12 / 7 / 5 — every one "legal"', () => {
    expect(mt.countryCode).toBe('MT');
    const rates = mt.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([5, 7, 12, 18]);
    for (const rate of mt.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of mt.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'mt.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 18% (Value Added Tax Act art. 19(1)) — consistent with tax-systems/data/mt.json's own TEDB citation of the same rate, no discrepancy", () => {
    const standard = mt.rates.find((r) => r.id === 'mt-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/eighteen per cent/);
    }
  });

  it('pins each reduced rate to its own Eighth Schedule table row, by id — never one generic citation reused', () => {
    const byId = (id: string) => mt.rates.find((r) => r.id === id)!;

    const r12 = byId('mt-reduced-12');
    expect(r12.category).toBe('REDUCED');
    if (r12.provenance.kind === 'legal') {
      expect(r12.provenance.sourceText).toMatch(/Custody and management of securities/);
      expect(r12.provenance.sourceText).toMatch(/12%/);
    }

    const r7 = byId('mt-reduced-7');
    expect(r7.category).toBe('SUPER_REDUCED');
    if (r7.provenance.kind === 'legal') {
      expect(r7.provenance.sourceText).toMatch(/sporting facilities/);
      expect(r7.provenance.sourceText).toMatch(/7%/);
    }

    const r5 = byId('mt-reduced-5');
    expect(r5.category).toBe('SUPER_REDUCED');
    if (r5.provenance.kind === 'legal') {
      expect(r5.provenance.sourceText).toMatch(/supply of electricity/);
      expect(r5.provenance.sourceText).toMatch(/5%/);
    }

    const texts = [r12, r7, r5].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(3);
  });

  it('every rate id is unique', () => {
    const ids = mt.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('12% is REDUCED, 7% and 5% are BOTH SUPER_REDUCED — Malta carries three non-standard tiers (the FR three-tier pattern), not the LV/EE/AT two-tier one', () => {
    const r12 = mt.rates.find((r) => r.id === 'mt-reduced-12')!;
    const r7 = mt.rates.find((r) => r.id === 'mt-reduced-7')!;
    const r5 = mt.rates.find((r) => r.id === 'mt-reduced-5')!;
    expect(r12.category).toBe('REDUCED');
    expect(r7.category).toBe('SUPER_REDUCED');
    expect(r5.category).toBe('SUPER_REDUCED');
    expect(r12.rate).toBeGreaterThan(r7.rate);
    expect(r7.rate).toBeGreaterThan(r5.rate);
  });

  it('does not model a ZERO-category rate — the Fifth Schedule "exempt with credit" export regime is a real finding, but the Act never attaches a numeric 0%/nil figure to it (unlike lv.json), so it stays undeclared here rather than promoted by analogy', () => {
    const zeroOrExempt = mt.rates.filter((r) => r.category === 'ZERO' || r.category === 'EXEMPT');
    expect(zeroOrExempt.length).toBe(0);
    expect(mt.notes).toMatch(/Exemptions with credit/i);
    expect(mt.notes).toMatch(/PROMOTION PAR ANALOGIE/);
  });
});
