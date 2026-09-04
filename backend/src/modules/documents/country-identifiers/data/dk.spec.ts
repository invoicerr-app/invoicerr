/**
 * DK — direct-load content spec, added by the DK country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-identifiers/data/se.spec.ts: reads `dk.json` straight off disk rather
 * than through `data/all.ts` (wiring "dk" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadDk(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'dk.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('DK — country-identifiers/data/dk.json', () => {
  const dk = loadDk();

  it('declares countryCode DK with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(dk.countryCode).toBe('DK');
    const schemes = dk.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of dk.schemes) {
      expect(() => assertValidProvenance(fact, 'dk.json (test)')).not.toThrow();
    }
  });

  it('VAT is the Momsregistreringsnummer: BOTH party types, not required (50,000 DKK small-business threshold), DK + 8 digits, sourced to momsbekendtgørelsen § 58 stk. 1 nr. 3', () => {
    const vat = dk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('DK12345678')).toBe(true); // DK + 8 digits
    expect(regex.test('DK1234567')).toBe(false); // 7 digits — too short
    expect(regex.test('SE123456789012')).toBe(false); // wrong country prefix/length
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe('Den registrerede virksomheds (sælgerens) registreringsnummer.');
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/50\.000 kr/);
  });

  it('VAT is definitionally "DK" + the cvr-/SE-nummer (momsbekendtgørelsen § 102), and its format cross-checks the vendored Peppol Schematron rule PEPPOL-COMMON-R053', () => {
    const vat = dk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/§ 102/);
    expect(vat.notes).toMatch(/PEPPOL-COMMON-R053/);
    expect(vat.notes).toMatch(/PEPPOL-EN16931-UBL\.sch/);
  });

  it('LEGAL_ID (CVR-nummer) stays honestly "unverified": the invoice-content mandate found is scoped to VAT registration, not an independent, unconditioned company-law duty — the CVR-loven itself was not reached', () => {
    const legalId = dk.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('CVR-nummer');
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      // tripwire: the honest gap must name the missing primary source, not just gesture at it.
      expect(legalId.provenance.resolutionNote).toMatch(/CVR-loven/);
      expect(legalId.provenance.resolutionNote).toMatch(/api\/documentsearch/);
    }
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('12345678')).toBe(true); // 8 digits, no country prefix
    expect(regex.test('DK12345678')).toBe(false); // that's the VAT form, not LEGAL_ID's own
  });

  it("LEGAL_ID's 8-digit format is cross-checked against the vendored Peppol Schematron rule PEPPOL-COMMON-R042 (schemeID 0184, DK CVR-number) rather than a Danish primary text", () => {
    const legalId = dk.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.notes).toMatch(/PEPPOL-COMMON-R042/);
    expect(legalId.notes).toMatch(/0184/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = dk.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = dk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.label).not.toBe(vat.label);
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
  });

  it('file-level notes flag the retsinformation.dk documentsearch API dead-end and the exhausted WebSearch budget honestly, rather than silently promoting LEGAL_ID', () => {
    expect(dk.notes).toMatch(/CVR-loven/);
    expect(dk.notes).toMatch(/0184/);
  });
});
