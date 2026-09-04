/**
 * RO — direct-load content spec, added by the RO country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * last of the lot). Same rationale as vat-rates/data/bg.spec.ts: reads `ro.json` straight off disk
 * rather than through `data/all.ts` (wiring "ro" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadRo(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'ro.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('RO — vat-rates/data/ro.json', () => {
  const ro = loadRo();

  it('declares countryCode RO with exactly three entries — 21 / 11 / 0 — every one "legal"', () => {
    expect(ro.countryCode).toBe('RO');
    const rates = ro.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 11, 21]);
    for (const rate of ro.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-05');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of ro.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'ro.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 21% (Codul fiscal art. 291 alin. (1), as raised by Legea 141/2025) — consistent with tax-systems/data/ro.json's own TEDB citation, no discrepancy", () => {
    const standard = ro.rates.find((r) => r.id === 'ro-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/nivelul acesteia este 21%/);
    }
    expect(standard.notes).toMatch(/1 august 2025/);
    expect(standard.notes).toMatch(/tax\/tax-systems\/data\/ro\.json/);
  });

  it('pins the reduced rate to 11% (Codul fiscal art. 291 alin. (2)) — the SINGLE merged rate replacing the former 9%/5% pair, alin. (3) itself repealed', () => {
    const reduced = ro.rates.find((r) => r.id === 'ro-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    expect(reduced.provenance.kind).toBe('legal');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/Cota redusă de 11% se aplică/);
      // Tripwire: the exclusion sub-list for foodstuffs must survive verbatim.
      expect(reduced.provenance.sourceText).toMatch(/băuturilor alcoolice/);
    }
    expect(reduced.notes).toMatch(/se abrogă/);
  });

  it("ro-reduced's notes are honest about the narrow, near-expired transitional 9% housing rate (Legea 141/2025 art. III) and explain why it is NOT modeled as a separate catalog entry", () => {
    const reduced = ro.rates.find((r) => r.id === 'ro-reduced')!;
    expect(reduced.notes).toMatch(/1er août 2026/);
    expect(reduced.notes).toMatch(/NON modélisée comme un troisième taux/);
  });

  it('pins the zero rate (Codul fiscal art. 294 alin. (1) lit. a), exports) as a genuine ZERO category with an explicit deduction right (art. 297 alin. (4) lit. c))', () => {
    const zero = ro.rates.find((r) => r.id === 'ro-zero')!;
    expect(zero.category).toBe('ZERO');
    expect(zero.rate).toBe(0);
    expect(zero.provenance.kind).toBe('legal');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/expediate sau transportate în afara Uniunii Europene/);
    }
    expect(zero.notes).toMatch(/art\. 297/);
    expect(zero.notes).toMatch(/dreptul să deducă taxa/);
  });

  it('every rate id is unique', () => {
    const ids = ro.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('file-level notes name static.anaf.ro as the raw-text source (pdftotext -layout) and cross-cite tax/tax-systems/data/ro.json for the standard-rate TEDB convergence', () => {
    expect(ro.notes).toMatch(/static\.anaf\.ro/);
    expect(ro.notes).toMatch(/pdftotext/);
    expect(ro.notes).toMatch(/tax\/tax-systems\/data\/ro\.json/);
    expect(ro.notes).toMatch(/legislatie\.just\.ro a refusé/);
  });
});
