/**
 * EE — direct-load content spec, added by the EE country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as vat-rates/data/nl.spec.ts: reads `ee.json` straight off disk rather than through
 * `data/all.ts` (still AT/BE/FR/NL only — wiring "ee" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadEe(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'ee.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('EE — vat-rates/data/ee.json', () => {
  const ee = loadEe();

  it('declares countryCode EE with exactly four rates — 24 / 13 / 9 / 0 — every one "legal"', () => {
    expect(ee.countryCode).toBe('EE');
    const rates = ee.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 9, 13, 24]);
    for (const rate of ee.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of ee.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'ee.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 24% since 1 July 2025 (Käibemaksuseadus § 15(1), read from the primary text) — resolving a one-year discrepancy against tax-systems/data/ee.json's own TEDB-sourced date", () => {
    const standard = ee.rates.find((r) => r.id === 'ee-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/24 per cent/);
      expect(standard.provenance.sourceText).toMatch(/01\.07\.2025/);
    }
    expect(standard.notes).toMatch(/2026\/07\/01/);
  });

  it('pins each reduced/zero rate to its own § 15 sub-provision, by id — never one generic citation reused', () => {
    const byId = (id: string) => ee.rates.find((r) => r.id === id)!;

    const r13 = byId('ee-reduced-13');
    expect(r13.category).toBe('REDUCED');
    if (r13.provenance.kind === 'legal') {
      expect(r13.provenance.sourceText).toMatch(/13 per cent/);
      expect(r13.provenance.sourceText).toMatch(/accommodation/);
    }

    const r9 = byId('ee-reduced-9');
    expect(r9.category).toBe('SUPER_REDUCED');
    if (r9.provenance.kind === 'legal') {
      expect(r9.provenance.sourceText).toMatch(/9 per cent/);
      expect(r9.provenance.sourceText).toMatch(/books and educational literature/);
    }

    const zero = byId('ee-zero');
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/0 per cent/);
      expect(zero.provenance.sourceText).toMatch(/exported goods/);
    }

    const texts = [r13, r9, zero].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(3);
  });

  it('every rate id is unique', () => {
    const ids = ee.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("13% is classified REDUCED and 9% SUPER_REDUCED — the higher of Estonia's two non-standard rates ranks above the lower one, same convention as at.json", () => {
    const r13 = ee.rates.find((r) => r.id === 'ee-reduced-13')!;
    const r9 = ee.rates.find((r) => r.id === 'ee-reduced-9')!;
    expect(r13.rate).toBeGreaterThan(r9.rate);
    expect(r13.category).toBe('REDUCED');
    expect(r9.category).toBe('SUPER_REDUCED');
  });
});
