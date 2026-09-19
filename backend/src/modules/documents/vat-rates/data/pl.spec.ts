/**
 * PL — direct-load content spec: reads `pl.json` straight off disk rather than through `data/all.ts`
 * (wiring "pl" in is a separate decision, made in `data/all.ts`), and re-runs the exact load-time
 * gate (`assertValidVatRateProvenance`) independently. Same shape as `pt.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadPl(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'pl.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('PL — vat-rates/data/pl.json', () => {
  const pl = loadPl();

  it('declares countryCode PL with exactly five rates — 23 / 8 / 5 / 0 / 0 — every one "legal"', () => {
    expect(pl.countryCode).toBe('PL');
    const rates = pl.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 0, 5, 8, 23]);
    for (const rate of pl.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-13');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of pl.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'pl.json (test)')).not.toThrow();
    }
  });

  it(
    "encodes the rates ACTUALLY IN FORCE (23%/8%) rather than the statute's own base figures " +
      '(22%/7%) — art. 41 sets the base, art. 146ef currently overrides it, both cited together',
    () => {
      const standard = pl.rates.find((r) => r.id === 'pl-standard')!;
      expect(standard.rate).toBe(23);
      expect(standard.category).toBe('STANDARD');
      if (standard.provenance.kind === 'legal') {
        expect(standard.provenance.sourceText).toMatch(/wynosi 22 %/);
        expect(standard.provenance.sourceText).toMatch(/Art\. 146ef/);
        expect(standard.provenance.sourceText).toMatch(/wynosi 23 %/);
      }
      expect(standard.notes).toMatch(/THIS IS NOT A FIXED RATE/);

      const reduced = pl.rates.find((r) => r.id === 'pl-reduced-8')!;
      expect(reduced.rate).toBe(8);
      expect(reduced.category).toBe('REDUCED');
      if (reduced.provenance.kind === 'legal') {
        expect(reduced.provenance.sourceText).toMatch(/wynosi 7 %/);
        expect(reduced.provenance.sourceText).toMatch(/Art\. 146ef/);
        expect(reduced.provenance.sourceText).toMatch(/wynosi 8 %/);
      }
    },
  );

  it('pins the 5% rate (art. 41 ust. 2a, załącznik nr 10) — untouched by the art. 146ef override', () => {
    const r5 = pl.rates.find((r) => r.id === 'pl-super-reduced-5')!;
    expect(r5.category).toBe('SUPER_REDUCED');
    if (r5.provenance.kind === 'legal') {
      expect(r5.provenance.sourceText).toMatch(/załączniku nr 10/);
      expect(r5.provenance.sourceText).toMatch(/wynosi 5 %/);
    }
  });

  it('pins the genuine 0% rate (WDT/export, art. 41 ust. 3-4), distinct from the EXEMPT entry', () => {
    const zero = pl.rates.find((r) => r.id === 'pl-zero')!;
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(
        /wewnątrzwspólnotowej dostawie towarów stawka podatku wynosi 0 %/,
      );
      expect(zero.provenance.sourceText).toMatch(/eksporcie towarów.*stawka podatku wynosi 0 %/);
    }
  });

  it('pins the art. 113 SME exemption threshold and documents the confirmed, dated 2026-01-01 rise to 240 000 zł', () => {
    const exempt = pl.rates.find((r) => r.id === 'pl-exempt-113')!;
    expect(exempt.category).toBe('EXEMPT');
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/200 000 zł/);
    }
    expect(exempt.notes).toMatch(/240 000 zł/);
    expect(exempt.notes).toMatch(/2026-01-01/);
  });

  it('every rate id is unique', () => {
    const ids = pl.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the conditional/annual nature of the art. 146ef override and the un-searched Monitor Polski end date at the file level', () => {
    expect(pl.notes ?? '').toMatch(/146ef/);
    expect(pl.notes ?? '').toMatch(/monitorpolski\.gov\.pl/);
  });
});
