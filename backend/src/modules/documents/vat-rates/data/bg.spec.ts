/**
 * BG — direct-load content spec, added by the BG country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as vat-rates/data/se.spec.ts: reads `bg.json` straight off disk rather than through
 * `data/all.ts` (wiring "bg" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadBg(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'bg.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('BG — vat-rates/data/bg.json', () => {
  const bg = loadBg();

  it('declares countryCode BG with exactly three entries — 20 / 9 / 0 — every one "legal"', () => {
    expect(bg.countryCode).toBe('BG');
    const rates = bg.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 9, 20]);
    for (const rate of bg.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of bg.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'bg.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 20% (ЗДДС чл. 66, ал. 1) — consistent with tax-systems/data/bg.json's own TEDB citation, no discrepancy", () => {
    const standard = bg.rates.find((r) => r.id === 'bg-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/20 на сто/);
    }
    expect(standard.notes).toMatch(/tax\/tax-systems\/data\/bg\.json/);
  });

  it('pins the reduced rate to 9% (ЗДДС чл. 66а) covering all THREE named categories in one entry — accommodation, books/press, baby food/diapers', () => {
    const reduced = bg.rates.find((r) => r.id === 'bg-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    expect(reduced.provenance.kind).toBe('legal');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/9 на сто/);
      // Tripwire: all three category fragments must survive verbatim — dropping any one would
      // silently narrow what this single rate actually covers.
      expect(reduced.provenance.sourceText).toMatch(/настаняване, предоставяно в хотели/);
      expect(reduced.provenance.sourceText).toMatch(/доставка на книги/);
      expect(reduced.provenance.sourceText).toMatch(/бебешки пелени/);
    }
  });

  it('pins the zero rate (ЗДДС чл. 66б composed with чл. 53, ал. 1) as a genuine ZERO category — the chapter title itself names it "нулева ставка" with credit right, passing the be-zero-press/ie-zero litmus test', () => {
    const zero = bg.rates.find((r) => r.id === 'bg-zero')!;
    expect(zero.category).toBe('ZERO');
    expect(zero.rate).toBe(0);
    expect(zero.provenance.kind).toBe('legal');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/Нулева ставка на данъка се прилага/);
      expect(zero.provenance.sourceText).toMatch(/вътреобщностните доставки по чл\. 7/);
    }
    expect(zero.notes).toMatch(/ОСВОБОЖДАВАНЕ С ПРАВО НА ПРИСПАДАНЕ НА ДАНЪЧЕН КРЕДИТ/);
  });

  it("bg-zero's notes are honest that TEDB does NOT corroborate this rate, and explain why that is EXPECTED rather than a contradiction (TEDB catalogs national rate choices, not the uniform EU cross-border zero-rating)", () => {
    const zero = bg.rates.find((r) => r.id === 'bg-zero')!;
    expect(zero.notes).toMatch(/NON CORROBORÉ PAR TEDB/);
    expect(zero.notes).toMatch(/ATTENDU/);
  });

  it('every rate id is unique', () => {
    const ids = bg.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('file-level notes name lex.bg as the raw-text source (windows-1251 re-encoded) and cross-cite tax/tax-systems/data/bg.json for the standard-rate TEDB convergence', () => {
    expect(bg.notes).toMatch(/lex\.bg/);
    expect(bg.notes).toMatch(/windows-1251/);
    expect(bg.notes).toMatch(/tax\/tax-systems\/data\/bg\.json/);
  });
});
