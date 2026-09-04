/**
 * BG — direct-load content spec, added by the BG country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as country-identifiers/data/se.spec.ts: reads `bg.json` straight off disk rather
 * than through `data/all.ts` (wiring "bg" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadBg(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'bg.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('BG — country-identifiers/data/bg.json', () => {
  const bg = loadBg();

  it('declares countryCode BG with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(bg.countryCode).toBe('BG');
    const schemes = bg.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of bg.schemes) {
      expect(() => assertValidProvenance(fact, 'bg.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID is the ЕИК/код по БУЛСТАТ: COMPANY only, required, 9 digits, sourced to ДОПК чл. 84 composed with Закон за регистър БУЛСТАТ чл. 6', () => {
    const legalId = bg.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('123456789')).toBe(true); // 9 digits
    expect(regex.test('12345678')).toBe(false); // 8 — too short
    expect(regex.test('1234567890')).toBe(false); // 10 — too long
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      // Tripwire: the dual identification regime (БУЛСТАТ registrants vs. Trade Register
      // registrants) must survive verbatim — dropping either half silently overclaims a single
      // unified regime.
      expect(legalId.provenance.sourceText).toMatch(/единен идентификационен код БУЛСТАТ/);
      expect(legalId.provenance.sourceText).toMatch(/Закона за търговския регистър/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(legalId.notes).toMatch(/чл\. 6, ал\. 1/);
    expect(legalId.notes).toMatch(/9-значен/);
  });

  it("LEGAL_ID's notes cross-cite the ЗТРРЮЛНЦ чл. 23, ал. 1 mandatory clause AND the ЕИК/БУЛСТАТ terminological equivalence (Закон за регистър БУЛСТАТ чл. 7)", () => {
    const legalId = bg.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.notes).toMatch(/ЗАДЪЛЖИТЕЛЕН за търговците/);
    expect(legalId.notes).toMatch(/ЕИК \(код по БУЛСТАТ\)/);
  });

  it('VAT is the ДДС номер: BOTH party types, required, "BG" + 9 or 10 digits, sourced to ЗДДС чл. 94, ал. 2', () => {
    const vat = bg.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(true);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('BG123456789')).toBe(true); // BG + 9 digits
    expect(regex.test('BG1234567890')).toBe(true); // BG + 10 digits
    expect(regex.test('BG12345678')).toBe(false); // 8 digits — too short
    expect(regex.test('FR123456789')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      // Tripwire: the exact quoted-string prefix requirement, not a paraphrase.
      expect(vat.provenance.sourceText).toMatch(/пред който е поставен знакът "BG"/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it("VAT's notes are honest that the digit-count composite (9 or 10) is an INTERNAL cross-reference to LEGAL_ID, not a fact stated by ЗДДС чл. 94 itself", () => {
    const vat = bg.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/ne précise PAS lui-même/);
    expect(vat.notes).toMatch(/ДОПК чл\. 84/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = bg.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = bg.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.pattern).not.toBe(vat.pattern);
    expect(legalId.label).not.toBe(vat.label);
  });

  it("file-level notes name the three primary texts read (ДОПК, ЗТРРЮЛНЦ, Закон за регистър БУЛСТАТ) served as official PDFs by registryagency.bg, and flag lex.bg's own search backend as non-functional this session", () => {
    expect(bg.notes).toMatch(/registryagency\.bg/);
    expect(bg.notes).toMatch(/ДОПК/);
    expect(bg.notes).toMatch(/ЗТРРЮЛНЦ/);
    expect(bg.notes).toMatch(/Закон за регистър БУЛСТАТ/);
    expect(bg.notes).toMatch(/pdftotext/);
    expect(bg.notes).toMatch(/NON FONCTIONNEL/);
  });
});
