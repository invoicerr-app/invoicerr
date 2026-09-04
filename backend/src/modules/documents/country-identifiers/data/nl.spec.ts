/**
 * NL — direct-load content spec, added by the NL country agent (TODO_DOCUMENTS.md, vague B, lot 1).
 * Same rationale as country-policy/data/nl.spec.ts: reads `nl.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/GB/US only — wiring "nl" in is a mandataire decision), and
 * re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadNl(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'nl.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('NL — country-identifiers/data/nl.json', () => {
  const nl = loadNl();

  it('declares countryCode NL with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(nl.countryCode).toBe('NL');
    const schemes = nl.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of nl.schemes) {
      expect(() => assertValidProvenance(fact, 'nl.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID is the KVK-nummer: BOTH party types, required, 8 digits, sourced to Handelsregisterwet 2007 art. 27', () => {
    const legalId = nl.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('KVK-nummer');
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('12345678')).toBe(true); // 8 digits
    expect(regex.test('1234567')).toBe(false); // 7 — too short
    expect(regex.test('123456789')).toBe(false); // 9 — too long (that's an RSIN, not a KVK number)
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/facturen/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('VAT is the btw-id: BOTH party types, not required (kleineondernemersregeling), NL + 9 digits + B + 2 digits', () => {
    const vat = nl.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('NL000099998B57')).toBe(true); // the ondernemersplein.overheid.nl worked example
    expect(regex.test('NL12345678B01')).toBe(false); // only 8 digits before B — wrong length
    expect(regex.test('FR000099998B57')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
  });

  it('never models the omzetbelastingnummer (ob-nummer) — Belastingdienst is explicit it never appears on an invoice', () => {
    for (const fact of nl.schemes) {
      expect(fact.label.toLowerCase()).not.toMatch(/ob-nummer|omzetbelastingnummer/);
    }
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = nl.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = nl.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.pattern).not.toBe(vat.pattern);
  });
});
