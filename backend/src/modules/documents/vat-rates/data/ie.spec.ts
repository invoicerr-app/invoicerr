/**
 * IE — direct-load content spec, added by the IE country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as vat-rates/data/se.spec.ts: reads `ie.json` straight off disk rather than through
 * `data/all.ts` (still AT/BE/FR/NL/EE/GR/CY/LV/LU/MT/SE only — wiring "ie" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';
import { vatRateFieldOptions, VatRateCatalog } from '../registry';

function loadIe(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'ie.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('IE — vat-rates/data/ie.json', () => {
  const ie = loadIe();

  it('declares countryCode IE with exactly five entries — 23 / 13.5 / 9 / 4.8 / 0 — every one "legal"', () => {
    expect(ie.countryCode).toBe('IE');
    const rates = ie.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 4.8, 9, 13.5, 23]);
    for (const rate of ie.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of ie.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'ie.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 23% (VATCA s. 46(1)(a)) — consistent with tax-systems/data/ie.json's own TEDB citation, no discrepancy", () => {
    const standard = ie.rates.find((r) => r.id === 'ie-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/23 per cent/);
    }
  });

  it('pins each reduced rate to its own s. 46(1) sub-paragraph, by id — never one generic citation reused, and DECIMAL rates (13.5%, 4.8%) round-trip through the schema without any modification', () => {
    const byId = (id: string) => ie.rates.find((r) => r.id === id)!;

    const r135 = byId('ie-reduced-13.5');
    expect(r135.rate).toBe(13.5);
    expect(r135.category).toBe('REDUCED');
    if (r135.provenance.kind === 'legal') {
      expect(r135.provenance.sourceText).toMatch(/13\.5 per cent/);
    }

    const r9 = byId('ie-second-reduced-9');
    expect(r9.rate).toBe(9);
    expect(r9.category).toBe('SUPER_REDUCED');
    if (r9.provenance.kind === 'legal') {
      expect(r9.provenance.sourceText).toMatch(/9 per cent/);
      expect(r9.provenance.sourceText).toMatch(/paragraphs 7\(a\), 7A, 12 and 12A/);
    }

    const r48 = byId('ie-livestock-4.8');
    expect(r48.rate).toBe(4.8);
    expect(r48.category).toBe('SUPER_REDUCED');
    if (r48.provenance.kind === 'legal') {
      expect(r48.provenance.sourceText).toMatch(/4\.8 per cent/);
      expect(r48.provenance.sourceText).toMatch(/livestock/);
    }

    const texts = [r135, r9, r48].map((r) => (r.provenance.kind === 'legal' ? r.provenance.sourceText : ''));
    expect(new Set(texts).size).toBe(3);
  });

  it("decimal rates (13.5, 4.8) survive vatRateFieldOptions' String() conversion untouched — no schema rejection, no rounding — confirming the brief's 'schema might refuse decimals' concern does not apply here", () => {
    const catalog = new VatRateCatalog([ie]);
    const resolution = vatRateFieldOptions(catalog, 'IE');
    expect(resolution.known).toBe(true);
    const values = resolution.options.map((o) => o.value).sort();
    expect(values).toEqual(['0', '13.5', '23', '4.8', '9'].sort());
  });

  it('ie-zero is a genuine ZERO-category rate (VATCA s. 46(1)(b), the literal words "zero per cent") — unlike se.json (no zero rate found) and mt.json (export relief never numerically qualified as 0%/nil)', () => {
    const zero = ie.rates.find((r) => r.id === 'ie-zero')!;
    expect(zero.category).toBe('ZERO');
    expect(zero.rate).toBe(0);
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/zero per cent/);
    }
    expect(ie.notes).toMatch(/VRAI TAUX ZÉRO/);
  });

  it("ie-second-reduced-9's note honestly flags the Finance Act 2025 s. 71 hospitality/hairdressing rate cut (already past its 1 July 2026 effective date) without inventing a sixth catalog entry or silently resolving the LRC consolidation-lag discrepancy", () => {
    const r9 = ie.rates.find((r) => r.id === 'ie-second-reduced-9')!;
    expect(r9.notes).toMatch(/1 JULY 2026|1\.07\.2026/);
    expect(r9.notes).toMatch(/Prospective affecting provision/);
    expect(r9.notes).toMatch(/hairdressing/i);
  });

  it('every rate id is unique', () => {
    const ids = ie.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('13.5% ranks REDUCED above 9%/4.8% (both SUPER_REDUCED) — the same rank-not-value convention mt.json applies to its own three non-standard tiers', () => {
    const r135 = ie.rates.find((r) => r.id === 'ie-reduced-13.5')!;
    const r9 = ie.rates.find((r) => r.id === 'ie-second-reduced-9')!;
    const r48 = ie.rates.find((r) => r.id === 'ie-livestock-4.8')!;
    expect(r135.category).toBe('REDUCED');
    expect(r9.category).toBe('SUPER_REDUCED');
    expect(r48.category).toBe('SUPER_REDUCED');
    expect(r135.rate).toBeGreaterThan(r9.rate);
    expect(r9.rate).toBeGreaterThan(r48.rate);
  });
});
