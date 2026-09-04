/**
 * Content-pinning + schema-gate spec for `data/si.json` — the AGENT PAYS SI deliverable (lot 7,
 * TODO_DOCUMENTS.md vague B, dernier lot). Same rationale as `data/hr.spec.ts`: reads `si.json`
 * straight off disk rather than through `data/all.ts` (wiring "si" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadSi(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'si.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('SI — vat-rates/data/si.json', () => {
  const si = loadSi();

  it('declares countryCode SI with exactly three rates — 22 / 9.5 / 5 — every one "legal"', () => {
    expect(si.countryCode).toBe('SI');
    const rates = si.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([5, 9.5, 22]);
    for (const rate of si.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-05');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of si.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'si.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 22% (ZDDV-1 41. člen prvi odstavek) with no discrepancy against tax-systems/data/si.json's own TEDB-sourced value", () => {
    const standard = si.rates.find((r) => r.id === 'si-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe(
        'DDV se obračunava in plačuje po splošni stopnji 22% od davčne osnove in je enaka za dobavo blaga in storitev.',
      );
    }
    expect(standard.notes).toMatch(/PAS DE DIVERGENCE/);
  });

  it("pins the 9.5% rate — a decimal rate, same schema capability as fr.json's own 5.5% — to ZDDV-1 41. člen drugi odstavek, Priloga I", () => {
    const r95 = si.rates.find((r) => r.id === 'si-reduced-9-5')!;
    expect(r95.rate).toBe(9.5);
    expect(r95.category).toBe('REDUCED');
    expect(r95.provenance.kind).toBe('legal');
    if (r95.provenance.kind === 'legal') {
      expect(r95.provenance.sourceText).toMatch(/9,5 %/);
      expect(r95.provenance.sourceText).toMatch(/Priloge I/);
    }
    expect(r95.notes).toMatch(/PRILOGA I/);
    expect(r95.notes).toMatch(/pdftotext/);
  });

  it("pins the 5% super-reduced rate to the SAME 41. člen drugi odstavek alinea (both rates stated in one sentence — a genuine structural difference from hr.json's separate sub-clauses), and confirms it covers books/press via Priloga IV", () => {
    const r5 = si.rates.find((r) => r.id === 'si-reduced-5')!;
    expect(r5.rate).toBe(5);
    expect(r5.category).toBe('SUPER_REDUCED');
    expect(r5.provenance.kind).toBe('legal');
    const r95 = si.rates.find((r) => r.id === 'si-reduced-9-5')!;
    if (r5.provenance.kind === 'legal' && r95.provenance.kind === 'legal') {
      // Both rates are legislated in the SAME sentence of the SAME alinea — the citations are
      // therefore IDENTICAL by construction, not a copy-paste mistake. Documented explicitly in
      // both rates' own `notes` rather than silently sharing an unexplained sourceText.
      expect(r5.provenance.sourceText).toBe(r95.provenance.sourceText);
      expect(r5.provenance.sourceText).toMatch(/5 %/);
    }
    expect(r5.notes).toMatch(/Priloga IV/);
    expect(r5.notes).toMatch(/knjig/);
    expect(r5.notes).toMatch(/livres/);
  });

  it('every rate id is unique', () => {
    const ids = si.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("9.5% is classified REDUCED and 5% SUPER_REDUCED — the higher of Slovenia's two non-standard rates ranks above the lower one, same convention as hr.json/ee.json", () => {
    const r95 = si.rates.find((r) => r.id === 'si-reduced-9-5')!;
    const r5 = si.rates.find((r) => r.id === 'si-reduced-5')!;
    expect(r95.rate).toBeGreaterThan(r5.rate);
    expect(r95.category).toBe('REDUCED');
    expect(r5.category).toBe('SUPER_REDUCED');
  });

  it('no ZERO or EXEMPT rate is modeled — documented honestly as "pas de ZERO forcé", the 40./41. člen were read in full and name no explicit 0% rate', () => {
    expect(si.rates.some((r) => r.category === 'ZERO')).toBe(false);
    expect(si.rates.some((r) => r.category === 'EXEMPT')).toBe(false);
    expect(si.notes ?? '').toMatch(/PAS DE ZERO FORCÉ/);
  });

  it('the file-level notes documents the PISRS SPA/API access method including the annex-PDF (Priloga) extraction via pdftotext', () => {
    expect(si.notes ?? '').toMatch(/pisrs\.si/);
    expect(si.notes ?? '').toMatch(/api\/datoteke\/integracije/);
    expect(si.notes ?? '').toMatch(/pdftotext/);
  });
});
