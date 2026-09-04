/**
 * SK — direct-load content spec, added by the SK country agent (TODO_DOCUMENTS.md, vague B, lot 7 —
 * dernier lot). Same rationale as vat-rates/data/cz.spec.ts: reads `sk.json` straight off disk rather
 * than through `data/all.ts` (wiring "sk" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadSk(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'sk.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('SK — vat-rates/data/sk.json', () => {
  const sk = loadSk();

  it('declares countryCode SK with exactly three entries — 5 / 19 / 23 — all "legal"', () => {
    expect(sk.countryCode).toBe('SK');
    const rates = sk.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([5, 19, 23]);
    for (const rate of sk.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-05');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of sk.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'sk.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 23% (zákon o DPH § 27 ods. 1) — consistent with tax-systems/data/sk.json's own TEDB citation, no discrepancy", () => {
    const standard = sk.rates.find((r) => r.id === 'sk-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe(
        'Základná sadzba dane na tovary a služby je 23 % zo základu dane.',
      );
    }
    expect(standard.notes).toMatch(/20250101\.html/);
    expect(standard.notes).toMatch(/20 % zo základu dane/);
    expect(standard.notes).toMatch(/278\/2024/);
  });

  it('pins the reduced rate to 19% (zákon o DPH § 27 ods. 2) — a BRAND NEW bracket the 2025 reform created (no 19% bracket existed before)', () => {
    const reduced = sk.rates.find((r) => r.id === 'sk-reduced-19')!;
    expect(reduced.rate).toBe(19);
    expect(reduced.category).toBe('REDUCED');
    expect(reduced.provenance.kind).toBe('legal');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/Znížená sadzba dane 19 % zo základu dane/);
    }
    expect(reduced.notes).toMatch(/10 %/);
    expect(reduced.notes).toMatch(/N'EXISTAIT PAS avant la réforme/);
  });

  it('pins the super-reduced rate to 5% (zákon o DPH § 27 ods. 3) — an EXISTING bracket the reform WIDENED, not created from scratch, a nuance this file records precisely', () => {
    const superReduced = sk.rates.find((r) => r.id === 'sk-super-reduced-5')!;
    expect(superReduced.rate).toBe(5);
    expect(superReduced.category).toBe('SUPER_REDUCED');
    expect(superReduced.provenance.kind).toBe('legal');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toMatch(/Znížená sadzba dane 5 % zo základu dane/);
    }
    expect(superReduced.notes).toMatch(/ÉLARGI/);
  });

  it('the file-level notes document the 2025 REFORM (standard 20→23, single reduced 10 split into 19/5) by DIRECT COMPARISON of two official consolidated versions of the same law, dated precisely to 1 January 2025, and name the consolidation act 278/2024 Z. z.', () => {
    expect(sk.notes).toMatch(/20240701\.html/);
    expect(sk.notes).toMatch(/20250101\.html/);
    expect(sk.notes).toMatch(/1er janvier 2025/);
    expect(sk.notes).toMatch(/278\/2024/);
    expect(sk.notes).not.toMatch(/20 % s'applique aujourd'hui/);
  });

  it('no ZERO-category rate is modeled — zákon o DPH uses "oslobodenie od dane" (exemption) for exports, never a numeric "0 %"/"nulová sadzba" in the passages read, same honest omission as cz.json/se.json/mt.json', () => {
    const zero = sk.rates.find((r) => r.category === 'ZERO');
    expect(zero).toBeUndefined();
    expect(sk.notes).toMatch(/nulová sadzba/);
    expect(sk.notes).toMatch(/oslobodenie od dane/);
  });

  it('every rate id is unique', () => {
    const ids = sk.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the file-level notes cross-check tax-systems/data/sk.json (TEDB, standardRate 23, situationOn 2026/07/01) with no discrepancy reported', () => {
    expect(sk.notes).toMatch(/tax-systems\/data\/sk\.json/);
    expect(sk.notes).toMatch(/AUCUNE DIVERGENCE/);
  });
});
