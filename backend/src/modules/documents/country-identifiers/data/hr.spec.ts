/**
 * HR — direct-load content spec, added by the HR country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as country-identifiers/data/ee.spec.ts: reads `hr.json` straight off disk rather
 * than through `data/all.ts` (wiring "hr" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadHr(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'hr.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('HR — country-identifiers/data/hr.json', () => {
  const hr = loadHr();

  it('declares countryCode HR with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(hr.countryCode).toBe('HR');
    const schemes = hr.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of hr.schemes) {
      expect(() => assertValidProvenance(fact, 'hr.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID is the OIB: BOTH party types, REQUIRED (a frontal "on invoices" clause, unlike EE/LV\'s own unverified LEGAL_ID), 11 digits, sourced to Zakon o osobnom identifikacijskom broju čl. 6', () => {
    const legalId = hr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('12345678903')).toBe(true); // 11 digits
    expect(regex.test('1234567890')).toBe(false); // 10 — too short
    expect(regex.test('HR12345678903')).toBe(false); // must be the bare OIB, not the HR-prefixed VAT form
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(
        /na ispravama koje koriste u obavljanju poslova svoje djelatnosti \(računima/,
      );
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(legalId.notes).toMatch(/čl\. 3 st\. 1/);
    expect(legalId.notes).toMatch(/čl\. 5 t\. 1/);
  });

  it('VAT is the "HR" + OIB PDV identifikacijski broj: not required (60,000 EUR threshold), sourced to ZPDV čl. 77 st. 6', () => {
    const vat = hr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('HR12345678903')).toBe(true); // HR + 11 digits
    expect(regex.test('HR1234567890')).toBe(false); // 10 digits — too short
    expect(regex.test('FR12345678903')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe(
        'PDV identifikacijski broj je osobni identifikacijski broj (OIB) kojemu se dodaje predznak »HR«.',
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/60\.000,00 eura/);
  });

  it('LEGAL_ID and VAT genuinely differ in required/pattern/provenance — not one copied onto the other with only labels swapped', () => {
    const legalId = hr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = hr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.pattern).not.toBe(vat.pattern);
    // Both facts are "legal" (a genuinely well-sourced pair) — the VAT pattern is the LEGAL_ID pattern
    // with the "HR" prefix, per ZPDV čl. 77 st. 6 itself; assert that structural relationship directly.
    expect(vat.pattern).toBe(`^HR${legalId.pattern!.replace(/^\^/, '')}`);
  });

  it('the file-level notes documents the OIB-is-also-the-VAT-number particularity and the deliberate non-modeling of the MBS court register', () => {
    expect(hr.notes ?? '').toMatch(/MÊME nombre à 11 chiffres/);
    expect(hr.notes ?? '').toMatch(/MBS/);
  });
});
