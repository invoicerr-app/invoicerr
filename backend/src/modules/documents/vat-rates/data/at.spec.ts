/**
 * Content-pinning + schema-gate spec for `data/at.json` — the AGENT PAYS AT deliverable (lot 1,
 * TODO_DOCUMENTS.md vague B). Reads `at.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `at` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidVatRateProvenance` — the same gate `all.ts` would run once this file is wired in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile, VatRateFact } from '../schema';

function loadAt(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'at.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

function rateFor(file: CountryVatRatesFile, id: string): VatRateFact {
  const rate = file.rates.find((r) => r.id === id);
  if (!rate) throw new Error(`No rate "${id}" in data/at.json`);
  return rate;
}

describe('AT — vat-rates/data/at.json', () => {
  const at = loadAt();

  it('declares countryCode "AT", matching its own filename', () => {
    expect(at.countryCode).toBe('AT');
  });

  it('declares exactly the three rates the task asked for: 20 / 13 / 10', () => {
    expect(at.rates.map((r) => r.rate).sort((a, b) => a - b)).toEqual([10, 13, 20]);
  });

  it('every rate passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rate of at.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'data/at.json')).not.toThrow();
    }
  });

  it('every rate is "legal" — a real research pass, not a placeholder', () => {
    expect(at.rates.every((r) => r.provenance.kind === 'legal')).toBe(true);
  });

  it('at-standard is 20% STANDARD, sourced to UStG 1994 §10 Abs. 1, cross-checked against TEDB', () => {
    const rate = rateFor(at, 'at-standard');
    expect(rate.rate).toBe(20);
    expect(rate.category).toBe('STANDARD');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/20%/);
    expect(rate.notes).toMatch(/TEDB/);
  });

  it('at-reduced-13 is 13% REDUCED (the higher of the two reduced rates), sourced to §10 Abs. 3', () => {
    const rate = rateFor(at, 'at-reduced-13');
    expect(rate.rate).toBe(13);
    expect(rate.category).toBe('REDUCED');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/13%/);
  });

  it('at-reduced-10 is 10% SUPER_REDUCED (the lower of the two reduced rates), sourced to §10 Abs. 2', () => {
    const rate = rateFor(at, 'at-reduced-10');
    expect(rate.rate).toBe(10);
    expect(rate.category).toBe('SUPER_REDUCED');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/10%/);
  });

  it('the file-level notes documents what was deliberately left out (Jungholz/Mittelberg, Kleinunternehmer)', () => {
    expect(at.notes ?? '').toMatch(/Jungholz/);
    expect(at.notes ?? '').toMatch(/Kleinunternehmer/);
  });
});
