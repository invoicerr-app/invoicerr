/**
 * FI — direct-load content spec, added by the FI country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as vat-rates/data/se.spec.ts: reads `fi.json` straight off disk rather than through
 * `data/all.ts` (wiring "fi" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 *
 * Finland's standard rate (25.5%) is the one DECIMAL standard VAT rate in the EU — this suite pins
 * that the schema needed NO change to carry it (`VatRateFact.rate` is a bare `number`, and
 * `vat-rates/data/fr.json`'s own "fr-reduced" already ships 5.5 in this exact catalog).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadFi(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'fi.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('FI — vat-rates/data/fi.json', () => {
  const fi = loadFi();

  it('declares countryCode FI with exactly four entries — 25.5 / 13.5 / 10 / 0 (exempt) — every one "legal"', () => {
    expect(fi.countryCode).toBe('FI');
    const rates = fi.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 10, 13.5, 25.5]);
    for (const rate of fi.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate — the schema accepts a non-integer rate with no change needed', () => {
    for (const rate of fi.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'fi.json (test)')).not.toThrow();
    }
    const standard = fi.rates.find((r) => r.id === 'fi-standard')!;
    expect(standard.rate).toBe(25.5);
    expect(Number.isInteger(standard.rate)).toBe(false);
  });

  it("pins the standard rate to 25.5% (Arvonlisäverolaki 84 §, in force since 1 September 2024) — consistent with tax-systems/data/fi.json's own TEDB citation, no discrepancy", () => {
    const standard = fi.rates.find((r) => r.id === 'fi-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe(
        'Suoritettava vero on 25,5 prosenttia veron perusteesta, ellei 85 tai 85 a §:ssä toisin säädetä.',
      );
    }
    expect(standard.notes).toMatch(/2024-09-01|1\.9\.2024/);
    expect(standard.notes).toMatch(/fr-reduced/);
  });

  it('fi-reduced-13-5 documents the CORRECTED trajectory — NOT 14% as a stale briefing assumed, but 13.5% since 1 January 2026 (replacing 14%, itself replacing an earlier 10%)', () => {
    const reduced = fi.rates.find((r) => r.id === 'fi-reduced-13-5')!;
    expect(reduced.category).toBe('REDUCED');
    expect(reduced.rate).toBe(13.5);
    expect(reduced.provenance.kind).toBe('legal');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/13,5 prosenttia/);
    }
    expect(reduced.notes).toMatch(/1358\/2025/);
    expect(reduced.notes).toMatch(/14 prosenttia/);
    expect(reduced.notes).toMatch(/1\.1\.2026|2026-01-01|1er janvier 2026/);
  });

  it('fi-reduced-10 is narrowed to newspapers/periodicals only since 1 January 2026 — the Yleisradio licence-fee item moved to fi-reduced-13-5 the same day', () => {
    const superReduced = fi.rates.find((r) => r.id === 'fi-reduced-10')!;
    expect(superReduced.category).toBe('SUPER_REDUCED');
    expect(superReduced.rate).toBe(10);
    expect(superReduced.provenance.kind).toBe('legal');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toMatch(/sanoma- ja aikakauslehtien/);
    }
    expect(superReduced.notes).toMatch(/921\/2024/);
    expect(superReduced.notes).toMatch(/Yleisradio/);
  });

  it('fi-exempt-3 composes the 20,000 EUR small-business threshold (3 §, in force since 1 January 2025) with the general no-VAT-mention clause (209 e §11), cross-referencing country-identifiers/data/fi.json', () => {
    const exempt = fi.rates.find((r) => r.id === 'fi-exempt-3')!;
    expect(exempt.category).toBe('EXEMPT');
    expect(exempt.rate).toBe(0);
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/20 000 euroa/);
    }
    expect(exempt.notes).toMatch(/15 000 euroa/);
    expect(exempt.notes).toMatch(/448\/2024/);
  });

  it('no ZERO-category rate is modeled — the file-level notes explain exports sit outside chapter 8 entirely', () => {
    const zeroRates = fi.rates.filter((r) => r.category === 'ZERO');
    expect(zeroRates.length).toBe(0);
    expect(fi.notes).toMatch(/veroton/);
  });

  it('every rate id is unique', () => {
    const ids = fi.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("13.5% is classified REDUCED and 10% SUPER_REDUCED — the higher of Finland's two non-standard rates ranks above the lower one, same convention as se.json/lv.json", () => {
    const reduced = fi.rates.find((r) => r.id === 'fi-reduced-13-5')!;
    const superReduced = fi.rates.find((r) => r.id === 'fi-reduced-10')!;
    expect(reduced.rate).toBeGreaterThan(superReduced.rate);
    expect(reduced.category).toBe('REDUCED');
    expect(superReduced.category).toBe('SUPER_REDUCED');
  });
});
