/**
 * IT — direct-load content spec: reads `it.json` straight off disk rather than through `data/all.ts`
 * (wiring "it" in is a separate decision, made in `data/all.ts`), and re-runs the exact load-time
 * gate (`assertValidVatRateProvenance`) independently. Same shape as `pt.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadIt(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'it.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('IT — vat-rates/data/it.json', () => {
  const it_ = loadIt();

  it('declares countryCode IT with exactly four rates — 22 / 10 / 5 / 4 — every one "legal"', () => {
    expect(it_.countryCode).toBe('IT');
    const rates = it_.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([4, 5, 10, 22]);
    for (const rate of it_.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-13');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of it_.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'it.json (test)')).not.toThrow();
    }
  });

  it('pins the standard rate to 22% (DPR 633/1972, art. 16 comma 1)', () => {
    const standard = it_.rates.find((r) => r.id === 'it-standard')!;
    expect(standard.category).toBe('STANDARD');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/ventidue per cento/);
    }
  });

  it('pins 10% to Tabella A parte III, citing the amendment footnote that actually sets it (the parte heading itself is stale, "9%")', () => {
    const r10 = it_.rates.find((r) => r.id === 'it-reduced-10')!;
    expect(r10.category).toBe('REDUCED');
    if (r10.provenance.kind === 'legal') {
      expect(r10.provenance.sourceText).toMatch(/PARTE III/);
      expect(r10.provenance.sourceText).toMatch(/elevate, rispettivamente, al 10 e al 16 per cento/);
    }
  });

  it('pins 5% to Tabella A parte II-bis (no stale heading here, unlike parte II/III)', () => {
    const r5 = it_.rates.find((r) => r.id === 'it-super-reduced-5')!;
    expect(r5.category).toBe('SUPER_REDUCED');
    if (r5.provenance.kind === 'legal') {
      expect(r5.provenance.sourceText).toMatch(/Parte II-bis/);
      expect(r5.provenance.sourceText).toMatch(/ALIQUOTA DEL 5 PER CENTO/);
    }
  });

  it('pins 4% to Tabella A parte II, citing the amendment footnote that actually sets it (the parte heading itself is stale, "2%")', () => {
    const r4 = it_.rates.find((r) => r.id === 'it-super-reduced-4')!;
    expect(r4.category).toBe('SUPER_REDUCED');
    if (r4.provenance.kind === 'legal') {
      expect(r4.provenance.sourceText).toMatch(/PARTE II\b/);
      expect(r4.provenance.sourceText).toMatch(/dall'aliquota del quattro per cento/);
    }
  });

  it('no ZERO or EXEMPT entry is modeled — the statute has no literal "aliquota … zero", and "esente" vs "non imponibile" are two distinct regimes the flat EXEMPT bucket cannot tell apart', () => {
    const categories = it_.rates.map((r) => r.category);
    expect(categories).not.toContain('ZERO');
    expect(categories).not.toContain('EXEMPT');
    expect(it_.notes ?? '').toMatch(/esenti/);
    expect(it_.notes ?? '').toMatch(/non imponibil/);
  });

  it('does not model Tabella A parte I (the flat-rate farmer compensation mechanism under art. 34)', () => {
    expect(it_.notes ?? '').toMatch(/PARTE I\b/);
    expect(it_.notes ?? '').toMatch(/IS NOT MODELED/);
  });

  it('documents the 2027-01-01 repeal/renumbering to TUIVA art. 34 on every rate, keeping the same figures', () => {
    for (const rate of it_.rates) {
      expect(rate.notes).toMatch(/2027-01-01/);
      expect(rate.notes).toMatch(/TUIVA/);
    }
    expect(it_.notes ?? '').toMatch(/2027-01-01/);
  });

  it('every rate id is unique', () => {
    const ids = it_.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
