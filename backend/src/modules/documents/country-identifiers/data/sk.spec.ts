/**
 * SK — direct-load content spec, added by the SK country agent (TODO_DOCUMENTS.md, vague B, lot 7 —
 * dernier lot). Same rationale as country-identifiers/data/cz.spec.ts: reads `sk.json` straight off
 * disk rather than through `data/all.ts` (wiring "sk" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadSk(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'sk.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('SK — country-identifiers/data/sk.json', () => {
  const sk = loadSk();

  it('declares countryCode SK with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(sk.countryCode).toBe('SK');
    const schemes = sk.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of sk.schemes) {
      expect(() => assertValidProvenance(fact, 'sk.json (test)')).not.toThrow();
    }
  });

  it('VAT is the IČ DPH: BOTH party types, not required (50 000 € turnover threshold), SK + 10 digits, sourced to zákon o DPH § 4 ods. 1', () => {
    const vat = sk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('SK1234567890')).toBe(true); // SK + 10 digits
    expect(regex.test('SK123456789')).toBe(false); // 9 digits — too short
    expect(regex.test('CZ1234567890')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe(
        'Zdaniteľná osoba, ktorá má sídlo, miesto podnikania alebo prevádzkareň v tuzemsku, [...] sa ' +
          'stáva platiteľom dane (ďalej len „platiteľ“) a) prvým dňom kalendárneho roka nasledujúceho po ' +
          'kalendárnom roku, za ktorý hodnota bez dane dodaných tovarov alebo služieb touto osobou, ktoré ' +
          'sa zahŕňajú do obratu podľa odseku 15, presiahla 50 000 eur.',
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(vat.notes).toMatch(/50 000 €/);
    expect(vat.notes).toMatch(/§ 74 ods\. 1 písm\. a\)/);
  });

  it('the VAT format is corroborated by TWO convergent secondary sources (en.wikipedia.org and sk.wikipedia.org) since the daňový poriadok itself never fixes a digit count, and IČ DPH is documented as identical to the DIČ merely prefixed "SK"', () => {
    const vat = sk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/en\.wikipedia\.org/);
    expect(vat.notes).toMatch(/sk\.wikipedia\.org/);
    expect(vat.notes).toMatch(/identique au DIČ/);
  });

  it('LEGAL_ID is the IČO: appliesTo BOTH (companies AND sole-trader entrepreneurs, unlike ie.json\'s own COMPANY-only Companies Act finding), the identifier acronym itself is "legal" but its requirement ON AN INVOICE stays "unverified" — and MORE CLEARLY negative than cz.json\'s own finding', () => {
    const legalId = sk.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    expect(legalId.pattern).toBe('^\\d{8}$');
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/§ 3a/);
      expect(legalId.provenance.resolutionNote).toMatch(/obchodné listy a objednávky/);
      expect(legalId.provenance.resolutionNote).toMatch(/faktúra.{0,30}N'APPARAÎT PAS/);
    }
    expect(legalId.notes).toMatch(/§ 9 ods\. 1/);
    expect(legalId.notes).toMatch(/§ 9 ods\. 2/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = sk.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = sk.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.label).not.toBe(vat.label);
    expect(legalId.pattern).not.toBe(vat.pattern);
  });

  it('the file-level notes flag the Obchodný zákonník § 3a finding as NARROWER than cz.json\'s own NOZ § 435 (a closed, named pair — "obchodné listy a objednávky" — rather than an open "obchodní listiny" category), closer in structure to the Irish business-letters-and-order-forms clause', () => {
    expect(sk.notes).toMatch(/PLUS ÉTROITE/);
    expect(sk.notes).toMatch(/obchodné listy a objednávky/);
    expect(sk.notes).toMatch(/clause irlandaise/);
  });
});
