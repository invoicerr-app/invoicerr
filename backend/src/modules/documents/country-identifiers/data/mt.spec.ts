/**
 * MT — direct-load content spec, added by the MT country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as country-identifiers/data/lv.spec.ts: reads `mt.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT/EE/GR/CY/LV/LU only — wiring "mt" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadMt(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'mt.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('MT — country-identifiers/data/mt.json', () => {
  const mt = loadMt();

  it('declares countryCode MT with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(mt.countryCode).toBe('MT');
    const schemes = mt.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of mt.schemes) {
      expect(() => assertValidProvenance(fact, 'mt.json (test)')).not.toThrow();
    }
  });

  it('VAT is universally required (no domestic-threshold carve-out at article 10 itself, unlike lv.json/ee.json), MT + 8 digits, sourced to the Value Added Tax Act art. 10(1)(a)', () => {
    const vat = mt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(true);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('MT12345678')).toBe(true); // MT + 8 digits
    expect(regex.test('MT1234567')).toBe(false); // 7 digits — too short
    expect(regex.test('LV12345678901')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/not registered under this article or under article 11/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/thirty-five thousand euro/);
  });

  it('LEGAL_ID is COMPANY-only (the Companies Act governs commercial partnerships, not sole traders) and stays "unverified" — art. 6(1) covers business letters/order forms, art. 6(5) covers invoices but only requires the NAME, never the registration number', () => {
    const legalId = mt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    expect(legalId.pattern).toBeUndefined();
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/article 6\(1\)/);
      expect(legalId.provenance.resolutionNote).toMatch(/article 6\(5\)/);
    }
    expect(legalId.notes).toMatch(/Companies Act/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = mt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = mt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
    expect(legalId.label).not.toBe(vat.label);
  });
});
