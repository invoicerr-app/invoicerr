/**
 * DE — direct-load content spec: reads `de.json` straight off disk rather than through `data/all.ts`
 * (wiring "de" in is a separate decision, made in `data/all.ts`), and re-runs the exact load-time
 * gate (`assertValidVatRateProvenance`) independently. Same shape as `pt.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadDe(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'de.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('DE — vat-rates/data/de.json', () => {
  const de = loadDe();

  it('declares countryCode DE with exactly three rates — 19 / 7 / 0 — every one "legal"', () => {
    expect(de.countryCode).toBe('DE');
    const rates = de.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 7, 19]);
    for (const rate of de.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-13');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of de.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'de.json (test)')).not.toThrow();
    }
  });

  it('pins the standard rate to 19% (UStG § 12 Abs. 1)', () => {
    const standard = de.rates.find((r) => r.id === 'de-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/19 Prozent/);
    }
  });

  it('pins the reduced rate to 7% (UStG § 12 Abs. 2)', () => {
    const reduced = de.rates.find((r) => r.id === 'de-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/sieben Prozent/);
    }
  });

  it(
    'pins the photovoltaic 0% rate as a genuine ZERO-category rate, not EXEMPT — it sits in § 12 ' +
      '("Steuersätze"), not § 4 ("Steuerbefreiungen")',
    () => {
      const zero = de.rates.find((r) => r.id === 'de-zero-pv')!;
      expect(zero.category).toBe('ZERO');
      if (zero.provenance.kind === 'legal') {
        expect(zero.provenance.sourceText).toMatch(/0 Prozent/);
        expect(zero.provenance.sourceText).toMatch(/Photovoltaikanlage/);
      }
      expect(zero.notes).toMatch(/Steuersätze/);
      expect(zero.notes).toMatch(/Steuerbefreiungen/);
    },
  );

  it('no SUPER_REDUCED or EXEMPT entry exists for Germany — only two ordinary tiers plus the narrow zero rate', () => {
    const categories = de.rates.map((r) => r.category);
    expect(categories).not.toContain('SUPER_REDUCED');
    expect(categories).not.toContain('EXEMPT');
  });

  it('every rate id is unique', () => {
    const ids = de.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flags in notes that its labels are administrative convention, not literal statutory terms', () => {
    expect(de.notes ?? '').toMatch(/Regelsteuersatz/);
    expect(de.notes ?? '').toMatch(/UStG NEVER NAMES/);
  });
});
