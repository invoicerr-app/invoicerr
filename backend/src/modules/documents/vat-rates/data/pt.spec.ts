/**
 * PT — direct-load content spec, added by the PT country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * dernier lot). Same rationale as vat-rates/data/hr.spec.ts: reads `pt.json` straight off disk rather
 * than through `data/all.ts` (wiring "pt" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadPt(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'pt.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('PT — vat-rates/data/pt.json', () => {
  const pt = loadPt();

  it('declares countryCode PT with exactly three mainland (continente) rates — 23 / 13 / 6 — every one "legal"', () => {
    expect(pt.countryCode).toBe('PT');
    const rates = pt.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([6, 13, 23]);
    for (const rate of pt.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of pt.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'pt.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 23% (CIVA art. 18.º n.º 1 alínea c)) with no discrepancy against tax-systems/data/pt.json's own TEDB-sourced value", () => {
    const standard = pt.rates.find((r) => r.id === 'pt-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe(
        'Para as restantes importações, transmissões de bens e prestações de serviços, a taxa de 23%.',
      );
    }
    expect(standard.notes).toMatch(/PAS DE DIVERGENCE/);
  });

  it('pins each reduced/super-reduced rate to its own art. 18.º n.º 1 alínea, by id — never one generic citation reused', () => {
    const r13 = pt.rates.find((r) => r.id === 'pt-reduced-13')!;
    expect(r13.category).toBe('REDUCED');
    if (r13.provenance.kind === 'legal') {
      expect(r13.provenance.sourceText).toMatch(/lista II/);
      expect(r13.provenance.sourceText).toMatch(/13%/);
    }

    const r6 = pt.rates.find((r) => r.id === 'pt-super-reduced-6')!;
    expect(r6.category).toBe('SUPER_REDUCED');
    if (r6.provenance.kind === 'legal') {
      expect(r6.provenance.sourceText).toMatch(/lista I anexa/);
      expect(r6.provenance.sourceText).toMatch(/6%/);
    }

    const texts = [r13, r6].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(2);
  });

  it('every rate id is unique', () => {
    const ids = pt.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("13% is classified REDUCED and 6% SUPER_REDUCED — the higher of Portugal's two non-standard mainland rates ranks above the lower one, same convention as hr.json/at.json", () => {
    const r13 = pt.rates.find((r) => r.id === 'pt-reduced-13')!;
    const r6 = pt.rates.find((r) => r.id === 'pt-super-reduced-6')!;
    expect(r13.rate).toBeGreaterThan(r6.rate);
    expect(r13.category).toBe('REDUCED');
    expect(r6.category).toBe('SUPER_REDUCED');
  });

  it('no ZERO rate is modeled — CIVA art. 14.º qualifies exports as "isentas", never a literal "taxa de 0%"', () => {
    expect(pt.rates.some((r) => r.category === 'ZERO')).toBe(false);
    expect(pt.notes ?? '').toMatch(/isentas do imposto/);
  });

  it('the file-level notes documents CIVA art. 18.º n.º 3 delegating regional rates to Madeira/Açores, and the TEDB-sourced 22%/16% regional standard-equivalent rates, without modeling them as separate VatRateFact entries', () => {
    expect(pt.notes ?? '').toMatch(/art\. 18\.º n\.º 3/);
    expect(pt.notes ?? '').toMatch(/Madeira Autonomous Region/);
    expect(pt.notes ?? '').toMatch(/Azores Autonomous Region/);
    expect(pt.notes ?? '').toMatch(/22\.0/);
    expect(pt.notes ?? '').toMatch(/16\.0/);
    expect(pt.rates.length).toBe(3);
  });
});
