/**
 * FI — direct-load content spec, added by the FI country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-identifiers/data/se.spec.ts: reads `fi.json` straight off disk rather
 * than through `data/all.ts` (wiring "fi" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadFi(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'fi.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('FI — country-identifiers/data/fi.json', () => {
  const fi = loadFi();

  it('declares countryCode FI with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(fi.countryCode).toBe('FI');
    const schemes = fi.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of fi.schemes) {
      expect(() => assertValidProvenance(fact, 'fi.json (test)')).not.toThrow();
    }
  });

  it('VAT is the ALV-numero: BOTH party types, not required (20,000 EUR small-business threshold since 2025), FI + 8 digits, sourced to Arvonlisäverolaki 209 e §3/4', () => {
    const vat = fi.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('FI12345678')).toBe(true); // FI + 8 digits
    expect(regex.test('FI1234567')).toBe(false); // 7 digits — too short
    expect(regex.test('SE123456789012')).toBe(false); // wrong country prefix/shape
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/arvonlisäverotunniste/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/20 000/);
  });

  it('VAT pattern is honestly flagged as an EU VIES convention, not itself confirmed against a dedicated Finnish format clause', () => {
    const vat = fi.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/NON confirmé/);
    expect(vat.notes).toMatch(/VIES/);
  });

  it('LEGAL_ID is the Y-tunnus: COMPANY, required is a product choice, format 7 digits + hyphen + check digit — but the REQUIREMENT stays honestly "unverified"', () => {
    const legalId = fi.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('Y-tunnus');
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('0194099-3')).toBe(true); // the real PRH open-data example
    expect(regex.test('01940993')).toBe(false); // missing the hyphen
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote.length).toBeGreaterThan(20);
    }
  });

  it("LEGAL_ID's resolutionNote documents a genuine four-level search (Arvonlisäverolaki 209 e/209 l, yritys- ja yhteisötietolaki §15, Osakeyhtiölaki, Kaupparekisterilaki) and the real Finlex access limit that stopped it short", () => {
    const legalId = fi.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const note = legalId.provenance.kind === 'unverified' ? legalId.provenance.resolutionNote : '';
    expect(note).toMatch(/209 l §/);
    expect(note).toMatch(/Kirjeissä ja lomakkeissa/);
    expect(note).toMatch(/Osakeyhtiölaki/);
    expect(note).toMatch(/Kaupparekisterilaki/);
    expect(note).toMatch(/mainPdf/);
  });

  it("LEGAL_ID's format is corroborated empirically by the PRH open-data API, never claimed as a legal citation", () => {
    const legalId = fi.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.notes).toMatch(/avoindata\.prh\.fi/);
    expect(legalId.notes).toMatch(/0194099-3/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = fi.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = fi.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.label).not.toBe(vat.label);
  });

  it('the file-level notes documents the Finlex access asymmetry (full text for the VAT Act vs ToC-only + missing PDF fallback for the 244/2001 identifiers law)', () => {
    expect(fi.notes ?? '').toMatch(/244\/2001/);
    expect(fi.notes ?? '').toMatch(/mainPdf/);
    expect(fi.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
