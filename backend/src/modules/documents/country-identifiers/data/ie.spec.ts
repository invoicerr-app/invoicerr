/**
 * IE — direct-load content spec, added by the IE country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-identifiers/data/se.spec.ts: reads `ie.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT/EE/GR/CY/LV/LU/MT/SE only — wiring "ie" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadIe(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'ie.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('IE — country-identifiers/data/ie.json', () => {
  const ie = loadIe();

  it('declares countryCode IE with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(ie.countryCode).toBe('IE');
    const schemes = ie.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of ie.schemes) {
      expect(() => assertValidProvenance(fact, 'ie.json (test)')).not.toThrow();
    }
  });

  it('VAT is the VAT registration number: BOTH party types, not required (goods/services threshold), IE + 7 digits + 1-2 letters, sourced to S.I. 639/2010 reg. 20(2)(c)', () => {
    const vat = ie.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('IE1234567T')).toBe(true); // 7 digits + 1 letter
    expect(regex.test('IE1234567FA')).toBe(true); // 7 digits + 2 letters (since Jan 2013)
    expect(regex.test('IE123456T')).toBe(false); // 6 digits — too short
    expect(regex.test('LV12345678901')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/registration number of the person who supplied/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/€85,000/);
    expect(vat.notes).toMatch(/€42,500/);
  });

  it('the VAT pattern deliberately EXCLUDES the old special-character format (documented in helpText/notes, never baked into the regex without primary corroboration)', () => {
    const vat = ie.schemes.find((s) => s.scheme === 'VAT')!;
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('IE1+23456T')).toBe(false); // old-style special-character format
    expect(vat.helpText).toMatch(/caractère spécial/);
    expect(vat.notes).toMatch(/phased out/);
  });

  it('LEGAL_ID is COMPANY-only (the Companies Act 2014 governs registered companies, not sole traders) and stays "unverified" — s. 151(2) covers business letters/order forms, and the word "invoice" never appears anywhere in the Act', () => {
    const legalId = ie.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    expect(legalId.pattern).toBeUndefined();
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/section 151\(2\)/);
      expect(legalId.provenance.resolutionNote).toMatch(/N'APPARAÎT NULLE PART/);
    }
    expect(legalId.notes).toMatch(/Companies Act 2014/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = ie.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = ie.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.label).not.toBe(vat.label);
  });

  it('the file-level notes flag the total absence of "invoice" across the full text of the Companies Act 2014 as a sharper negative finding than mt.json\'s own LEGAL_ID', () => {
    expect(ie.notes).toMatch(/ABSENCE TOTALE/);
    expect(ie.notes).toMatch(/mt\.json/);
  });
});
