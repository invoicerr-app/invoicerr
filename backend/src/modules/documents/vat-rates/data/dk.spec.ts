/**
 * DK — direct-load content spec, added by the DK country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as vat-rates/data/se.spec.ts: reads `dk.json` straight off disk rather than through
 * `data/all.ts` (wiring "dk" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadDk(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'dk.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('DK — vat-rates/data/dk.json', () => {
  const dk = loadDk();

  it('declares countryCode DK with exactly TWO entries — 25 (standard) / 0 (exempt) — every one "legal"', () => {
    expect(dk.countryCode).toBe('DK');
    const rates = dk.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 25]);
    for (const rate of dk.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of dk.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'dk.json (test)')).not.toThrow();
    }
  });

  it('pins the standard rate to 25% (momsloven § 33, "Afgiftssatsen" — THE rate, singular)', () => {
    const standard = dk.rates.find((r) => r.id === 'dk-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe('Afgiften udgør 25 pct. af afgiftsgrundlaget.');
    }
    // tripwire: the singular-chapter-title finding is the load-bearing fact of this file — a
    // summarizer that drops "Afgiftssatsen" (singular) loses the whole singularity claim.
    expect(standard.notes).toMatch(/Afgiftssatsen/);
    expect(standard.notes).toMatch(/SEUL État membre/);
  });

  it('NO REDUCED-category rate exists at all — Denmark has exactly one positive VAT rate, unlike every other country file in this catalog', () => {
    const reduced = dk.rates.filter((r) => r.category === 'REDUCED' || r.category === 'SUPER_REDUCED');
    expect(reduced.length).toBe(0);
    expect(dk.rates.length).toBe(2);
  });

  it('no ZERO-category rate is modeled — file-level notes explain exports are structurally "fritagelser" (exemptions, Kapitel 8), not an explicit 0% rate under Kapitel 7', () => {
    const zeroRates = dk.rates.filter((r) => r.category === 'ZERO');
    expect(zeroRates.length).toBe(0);
    expect(dk.notes).toMatch(/nulsats|nul procent/);
    expect(dk.notes).toMatch(/Afgiftsfritagelser/);
  });

  it('file-level notes pre-empt the "0-sats" red herring found in momsbekendtgørelsen § 62 (an invoice-annotation example, not a rate) without letting it contradict the no-reduced-rate finding', () => {
    expect(dk.notes).toMatch(/0-sats/);
    expect(dk.notes).toMatch(/PAS une catégorie de TAUX substantielle/);
  });

  it("dk-exempt-48 composes the 50,000 DKK small-business threshold (§ 48 stk. 1) with the no-VAT-on-invoice rule (§ 52 a stk. 6), cross-referencing country-identifiers/data/dk.json's own VAT.required=false", () => {
    const exempt = dk.rates.find((r) => r.id === 'dk-exempt-48')!;
    expect(exempt.category).toBe('EXEMPT');
    expect(exempt.rate).toBe(0);
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/50\.000 kr\. årligt/);
      expect(exempt.provenance.sourceText).toMatch(/må ikke på fakturaen anføre afgiftsbeløb/);
    }
  });

  it('every rate id is unique', () => {
    const ids = dk.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
