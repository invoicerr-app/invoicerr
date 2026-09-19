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

  it('declares countryCode IT with exactly six rates — 22 / 10 / 5 / 4 / 0 (esente) / 0 (non imponibile) — every one "legal"', () => {
    expect(it_.countryCode).toBe('IT');
    const rates = it_.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 0, 4, 5, 10, 22]);
    for (const rate of it_.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        // The four positive rates were checked 2026-09-13; the two zero-rate entries (esente/non
        // imponibile — see the dedicated describe block below) were added 2026-09-17.
        expect(['2026-09-13', '2026-09-17']).toContain(rate.provenance.sourceCheckedAt);
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

  // THE MUTATION TARGET: the statute has no literal "aliquota … zero", but "esente" (art. 10) and
  // "non imponibile" (art. 8) are two REAL, distinct, sourced regimes — and this schema's category
  // enum already has two DIFFERENT buckets (EXEMPT/ZERO) that tell them apart without conflating
  // them into one. Before these two entries existed, a purely domestic Italian invoice line falling
  // under either regime (a medical service, a bank fee, an export) had NO valid catalog value at all.
  describe('esente (art. 10) and non imponibile (art. 8) — the two zero-rate regimes', () => {
    it('it-esente is category EXEMPT, sourced to art. 10 DPR 633/1972, rate 0', () => {
      const esente = it_.rates.find((r) => r.id === 'it-esente')!;
      expect(esente).toBeDefined();
      expect(esente.rate).toBe(0);
      expect(esente.category).toBe('EXEMPT');
      if (esente.provenance.kind === 'legal') {
        expect(esente.provenance.sourceText).toMatch(/Operazioni esenti dall'imposta/);
        expect(esente.provenance.sourceText).toMatch(/Sono esenti dall'imposta/);
      }
    });

    it('it-non-imponibile is category ZERO (deduction right preserved, unlike esente), sourced to art. 8 DPR 633/1972, rate 0', () => {
      const nonImponibile = it_.rates.find((r) => r.id === 'it-non-imponibile')!;
      expect(nonImponibile).toBeDefined();
      expect(nonImponibile.rate).toBe(0);
      expect(nonImponibile.category).toBe('ZERO');
      if (nonImponibile.provenance.kind === 'legal') {
        expect(nonImponibile.provenance.sourceText).toMatch(/Cessioni all'esportazione/);
        expect(nonImponibile.provenance.sourceText).toMatch(/non imponibili/);
      }
    });

    it('the two zero-rate entries have distinct ids and categories — never merged into one misleading EXEMPT bucket', () => {
      const esente = it_.rates.find((r) => r.id === 'it-esente')!;
      const nonImponibile = it_.rates.find((r) => r.id === 'it-non-imponibile')!;
      expect(esente.category).not.toBe(nonImponibile.category);
    });

    it('the field-kind dropdown offers "0" for Italy — the same string a "select" field would validate a domestic zero-rate line against', () => {
      const zeroOptions = it_.rates.filter((r) => r.rate === 0);
      expect(zeroOptions.length).toBe(2);
      for (const option of zeroOptions) {
        expect(String(option.rate)).toBe('0');
      }
    });
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
