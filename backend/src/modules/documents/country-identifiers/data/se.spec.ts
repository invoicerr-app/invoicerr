/**
 * SE — direct-load content spec, added by the SE country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as country-identifiers/data/lv.spec.ts: reads `se.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT/EE/GR/CY/LV/LU only — wiring "se" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadSe(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'se.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('SE — country-identifiers/data/se.json', () => {
  const se = loadSe();

  it('declares countryCode SE with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(se.countryCode).toBe('SE');
    const schemes = se.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of se.schemes) {
      expect(() => assertValidProvenance(fact, 'se.json (test)')).not.toThrow();
    }
  });

  it('VAT is the Momsregistreringsnummer: BOTH party types, not required (120,000 SEK small-business threshold), SE + 12 digits, sourced to Mervärdesskattelag 17 kap. 24 §', () => {
    const vat = se.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('SE123456789012')).toBe(true); // SE + 12 digits
    expect(regex.test('SE12345678901')).toBe(false); // 11 digits — too short
    expect(regex.test('LV12345678901')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/registreringsnummer för mervärdesskatt/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/120 000/);
  });

  it('VAT pattern (SE + 12 digits = 14 chars) cross-checks the vendored Peppol Schematron rules SE-R-001/SE-R-002', () => {
    const vat = se.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/SE-R-001/);
    expect(vat.notes).toMatch(/SE-R-002/);
    expect(vat.notes).toMatch(/PEPPOL-EN16931-UBL\.sch/);
  });

  it('LEGAL_ID is the Organisationsnummer: COMPANY only (not BOTH — a sole trader uses a personnummer instead), promoted "legal" via Aktiebolagslag 28 kap. 5 §, a FRONTAL invoice-content clause', () => {
    const legalId = se.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('Organisationsnummer');
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('5560000000')).toBe(true); // 10 digits
    expect(regex.test('556000000')).toBe(false); // 9 — too short
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/fakturor/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(legalId.notes).toMatch(/lagen \(1974:174\)/);
  });

  it("LEGAL_ID's 10-digit + Luhn check-digit format is confirmed by the PRIMARY text itself (lagen 1974:174 §4), not an inference, and cross-checked against the vendored u:checkSEOrgnr Schematron function", () => {
    const legalId = se.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.notes).toMatch(/kontrollsiffra/);
    expect(legalId.notes).toMatch(/u:checkSEOrgnr/);
    expect(legalId.notes).toMatch(/SE-R-013/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = se.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = se.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.label).not.toBe(vat.label);
  });
});
