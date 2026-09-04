/**
 * CZ — direct-load content spec, added by the CZ country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as country-identifiers/data/ie.spec.ts: reads `cz.json` straight off disk rather
 * than through `data/all.ts` (wiring "cz" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadCz(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'cz.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('CZ — country-identifiers/data/cz.json', () => {
  const cz = loadCz();

  it('declares countryCode CZ with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(cz.countryCode).toBe('CZ');
    const schemes = cz.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of cz.schemes) {
      expect(() => assertValidProvenance(fact, 'cz.json (test)')).not.toThrow();
    }
  });

  it('VAT is the DIČ: BOTH party types, not required (2,000,000 Kč turnover threshold), CZ + 8-10 digits, sourced to daňový řád § 130', () => {
    const vat = cz.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('CZ12345678')).toBe(true); // 8 digits — legal entity (IČO)
    expect(regex.test('CZ1234567890')).toBe(true); // 10 digits — individual (rodné číslo)
    expect(regex.test('CZ1234567')).toBe(false); // 7 digits — too short
    expect(regex.test('SK1234567890')).toBe(false); // wrong country prefix
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe(
        'Daňové identifikační číslo obsahuje kód „CZ“ a kmenovou část, kterou tvoří obecný identifikátor, ' +
          'nebo vlastní identifikátor správce daně. [...] Obecným identifikátorem je u fyzické osoby ' +
          'rodné číslo, popřípadě jiný obecný identifikátor, stanoví-li tak zákon, a u právnické osoby ' +
          'identifikační číslo.',
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/2 000 000 Kč/);
    expect(vat.notes).toMatch(/§ 6 odst\. 1/);
  });

  it('the VAT format is corroborated by en.wikipedia.org (CZ + 8-10 digits) since the daňový řád itself never fixes a digit count', () => {
    const vat = cz.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/8-10 digits/);
    expect(vat.helpText).toMatch(/IČO/);
    expect(vat.helpText).toMatch(/rodné číslo/);
  });

  it('LEGAL_ID is the IČO: appliesTo BOTH (companies AND sole-trader entrepreneurs, unlike ie.json\'s own COMPANY-only Companies Act finding), the identifier definition itself is "legal" but its requirement ON AN INVOICE stays "unverified"', () => {
    const legalId = cz.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    expect(legalId.pattern).toBe('^\\d{8}$');
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/§ 435/);
      expect(legalId.provenance.resolutionNote).toMatch(/obchodní listin/);
      expect(legalId.provenance.resolutionNote).toMatch(/faktura.{0,20}4 fois/);
    }
    expect(legalId.notes).toMatch(/§ 24 písm\. c\)/);
    expect(legalId.notes).toMatch(/§ 25/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = cz.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = cz.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.provenance.kind).not.toBe(vat.provenance.kind);
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.label).not.toBe(vat.label);
    expect(legalId.pattern).not.toBe(vat.pattern);
  });

  it('the file-level notes flag the NOZ § 435 finding as more nuanced than ie.json\'s own TOTAL absence of "invoice" in the Companies Act (a real but broader clause, "obchodní listiny", never confirmed to name "faktura" itself)', () => {
    expect(cz.notes).toMatch(/PLUS NUANCÉE/);
    expect(cz.notes).toMatch(/ABSENCE TOTALE/);
    expect(cz.notes).toMatch(/ie\.json/);
  });
});
