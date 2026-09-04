/**
 * LV — direct-load content spec, added by the LV country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as country-identifiers/data/ee.spec.ts: reads `lv.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT/EE/GR/CY only — wiring "lv" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadLv(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'lv.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('LV — country-identifiers/data/lv.json', () => {
  const lv = loadLv();

  it('declares countryCode LV with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(lv.countryCode).toBe('LV');
    const schemes = lv.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of lv.schemes) {
      expect(() => assertValidProvenance(fact, 'lv.json (test)')).not.toThrow();
    }
  });

  it('VAT is the PVN: BOTH party types, not required (50,000 EUR registration threshold), LV + 11 digits, sourced to Value Added Tax Law art. 125(1)', () => {
    const vat = lv.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('LV12345678901')).toBe(true); // LV + 11 digits
    expect(regex.test('LV1234567890')).toBe(false); // 10 digits — too short
    expect(regex.test('EE123456789')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(
        /registration number of the supplier of goods or services in the State Revenue Service/,
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('LEGAL_ID is the Vienotais reģistrācijas numurs: promoted "legal" via Komerclikums art. 17(1), a FRONTAL invoice-content clause absent from ee.json/nl.json', () => {
    const legalId = lv.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('Vienotais reģistrācijas numurs');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('40003000000')).toBe(true); // 11 digits
    expect(regex.test('4000300000')).toBe(false); // 10 — too short
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(
        /business letters, invoices, and other documents of a merchant/,
      );
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(legalId.notes).toMatch(/Komerclikums/);
    expect(legalId.notes).toMatch(/INFÉRENCE/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = lv.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = lv.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.label).not.toBe(vat.label);
  });
});
