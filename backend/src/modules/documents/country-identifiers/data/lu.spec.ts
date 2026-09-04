/**
 * LU — direct-load content spec, added by the LU country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as country-identifiers/data/ee.spec.ts: reads `lu.json` straight off disk rather
 * than through `data/all.ts` (wiring "lu" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadLu(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'lu.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('LU — country-identifiers/data/lu.json', () => {
  const lu = loadLu();

  it('declares countryCode LU with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(lu.countryCode).toBe('LU');
    const schemes = lu.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of lu.schemes) {
      expect(() => assertValidProvenance(fact, 'lu.json (test)')).not.toThrow();
    }
  });

  it('VAT is the matricule TVA: BOTH party types, not required (50,000 EUR art. 57bis threshold), LU + 8 digits, sourced to LTVA art. 63 §8', () => {
    const vat = lu.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('LU12345678')).toBe(true); // LU + 8 digits
    expect(regex.test('LU1234567')).toBe(false); // 7 digits — too short
    expect(regex.test('FR12345678')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/numéro d'identification TVA/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/57bis/);
    expect(vat.notes).toMatch(/50 000/);
  });

  it('LEGAL_ID is the numéro RCS: a letter followed by up to 6 digits, sourced to the Loi du 10 août 1915 art. 710-10 (SARL), corroborated by art. 462-1 (SA)', () => {
    const legalId = lu.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toMatch(/RCS/);
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('B123456')).toBe(true); // the classic SARL/SA RCS format
    expect(regex.test('123456')).toBe(false); // missing the leading letter
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/R\.C\.S\. Luxembourg/);
    }
    expect(legalId.notes).toMatch(/710-10/);
    expect(legalId.notes).toMatch(/462-1/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = lu.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = lu.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.pattern).not.toBe(vat.pattern);
  });

  it('the file-level notes documents the legilux SPARQL access method and that the 1915 companies law, unlike the LTVA, is kept as an up-to-date consolidation', () => {
    expect(lu.notes ?? '').toMatch(/sparqlendpoint/);
    expect(lu.notes ?? '').toMatch(/02\/06\/2026/);
  });
});
