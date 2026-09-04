/**
 * Content-pinning + schema-gate spec for `data/cy.json` — the AGENT PAYS CY deliverable (lot 2,
 * TODO_DOCUMENTS.md vague B). Reads `cy.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `cy` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidVatRateProvenance` — the same gate `all.ts` would run once this file is wired in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile, VatRateFact } from '../schema';

function loadCy(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'cy.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

function rateFor(file: CountryVatRatesFile, id: string): VatRateFact {
  const rate = file.rates.find((r) => r.id === id);
  if (!rate) throw new Error(`No rate "${id}" in data/cy.json`);
  return rate;
}

describe('CY — vat-rates/data/cy.json', () => {
  const cy = loadCy();

  it('declares countryCode "CY", matching its own filename', () => {
    expect(cy.countryCode).toBe('CY');
  });

  it('declares exactly the four rates found: 19 / 9 / 5 / 3', () => {
    expect(cy.rates.map((r) => r.rate).sort((a, b) => a - b)).toEqual([3, 5, 9, 19]);
  });

  it('every rate passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rate of cy.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'data/cy.json')).not.toThrow();
    }
  });

  it('every rate is "legal" — read directly from the primary law text, not a placeholder', () => {
    expect(cy.rates.every((r) => r.provenance.kind === 'legal')).toBe(true);
  });

  it('cy-standard is 19% STANDARD, sourced to Ν.95(Ι)/2000 art. 17, cross-checked against TEDB', () => {
    const rate = rateFor(cy, 'cy-standard');
    expect(rate.rate).toBe(19);
    expect(rate.category).toBe('STANDARD');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/δεκαεννέα τοις εκατόν \(19%\)/);
    expect(rate.notes).toMatch(/TEDB/);
    expect(rate.notes).toMatch(/tax-systems/);
  });

  it('cy-reduced-9 is 9% REDUCED, sourced to art. 18Α (Twelfth Schedule)', () => {
    const rate = rateFor(cy, 'cy-reduced-9');
    expect(rate.rate).toBe(9);
    expect(rate.category).toBe('REDUCED');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/εννέα τοις εκατόν \(9%\)/);
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/18Α/);
  });

  it('cy-reduced-5 is 5% SUPER_REDUCED (below the 9% reduced rate), sourced to art. 18 (Fifth Schedule)', () => {
    const rate = rateFor(cy, 'cy-reduced-5');
    expect(rate.rate).toBe(5);
    expect(rate.category).toBe('SUPER_REDUCED');
    expect((rate.provenance as { sourceText: string }).sourceText).toMatch(/πέντε τοις εκατόν \(5%\)/);
  });

  it('cy-reduced-3 is 3% SUPER_REDUCED — books/newspapers/periodicals, art. 18Β (Fifteenth Schedule)', () => {
    const rate = rateFor(cy, 'cy-reduced-3');
    expect(rate.rate).toBe(3);
    expect(rate.category).toBe('SUPER_REDUCED');
    const sourceText = (rate.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/τρία τοις εκατόν \(3%\)/);
    expect(sourceText).toMatch(/βιβλίων, εφημερίδων και περιοδικών/);
  });

  it('the file-level notes documents the deliberate exclusion of the art. 25 true zero rate', () => {
    expect(cy.notes ?? '').toMatch(/μηδενικός συντελεστής|Article 25/);
    expect(cy.notes ?? '').toMatch(/with deduction right/);
  });

  it('the file-level notes documents the mof.gov.cy/tax.mof.gov.cy access wall, honestly', () => {
    expect(cy.notes ?? '').toMatch(/mof\.gov\.cy/);
    expect(cy.notes ?? '').toMatch(/tax\.mof\.gov\.cy/);
  });
});
