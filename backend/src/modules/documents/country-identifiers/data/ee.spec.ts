/**
 * EE — direct-load content spec, added by the EE country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as country-identifiers/data/nl.spec.ts: reads `ee.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT only — wiring "ee" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadEe(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'ee.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('EE — country-identifiers/data/ee.json', () => {
  const ee = loadEe();

  it('declares countryCode EE with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(ee.countryCode).toBe('EE');
    const schemes = ee.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of ee.schemes) {
      expect(() => assertValidProvenance(fact, 'ee.json (test)')).not.toThrow();
    }
  });

  it('VAT is the KMKR: BOTH party types, not required (40,000 EUR registration threshold), EE + 9 digits, sourced to Käibemaksuseadus § 37(7)', () => {
    const vat = ee.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('EE123456789')).toBe(true); // EE + 9 digits
    expect(regex.test('EE12345678')).toBe(false); // 8 digits — too short
    expect(regex.test('FR123456789')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/registration number as a taxable person/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('LEGAL_ID is the registrikood: 8 digits, but stays "unverified" — no invoice-content clause found in the VAT Act, the Äriseadustik, or the (unreached) Äriregistri seadus', () => {
    const legalId = ee.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('Registrikood');
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('70000349')).toBe(true); // the empirical EMTA example itself (8 digits)
    expect(regex.test('7000034')).toBe(false); // 7 — too short
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/Äriregistri seadus/);
    }
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = ee.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = ee.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
  });
});
